import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Only the model is faked. The patcher, the validation pipeline (a real `npm run build`),
// and the filesystem are all real, so this checks what actually ends up on disk and in appliedFix.
const { scriptedReplies, receivedPrompts, receivedOptions, modelReports } = vi.hoisted(() => ({
  scriptedReplies: [] as string[],
  receivedPrompts: [] as string[],
  receivedOptions: [] as { maxTokens?: number }[],
  // What the fake model says about each reply, besides its text. Tests change it to report other token counts.
  modelReports: { extra: {} as Record<string, unknown> },
}));

vi.mock("@opspilot/ai-provider", () => ({
  OpenRouterProvider: class {
    async invoke(prompt: string, options: { maxTokens?: number } = {}) {
      receivedPrompts.push(prompt);
      receivedOptions.push(options);
      const content = scriptedReplies.shift();
      if (content === undefined) throw new Error("The fake model was asked for more replies than were scripted.");
      return { content, model: "fake-model", usage: { prompt_tokens: 1, completion_tokens: 1 }, ...modelReports.extra };
    }
  },
}));

import { undoChanges } from "@opspilot/patcher";
import { previewAnalysisPrompt, runRepairWorkflow } from "./workflow";

vi.setConfig({ testTimeout: 60_000 });

const reply = (filePath: string, rootCause: string) =>
  JSON.stringify({
    rootCause,
    explanation: `Fixed ${filePath}`,
    patches: [{ filePath, search: "broken", replace: "FIXED" }],
  });

describe("repair workflow end to end (fake model, real patcher and pipeline)", () => {
  let projectDir: string;

  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    scriptedReplies.length = 0;
    receivedPrompts.length = 0;
    receivedOptions.length = 0;
    modelReports.extra = {};

    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "bugzero-workflow-int-"));
    // The build only passes once BOTH files have been fixed.
    fs.writeFileSync(
      path.join(projectDir, "package.json"),
      JSON.stringify({ name: "demo", scripts: { build: "node check.js" } })
    );
    fs.writeFileSync(
      path.join(projectDir, "check.js"),
      `const fs = require("fs");
       for (const file of ["a.txt", "b.txt"]) {
         if (!fs.readFileSync(file, "utf8").includes("FIXED")) { console.error("error: " + file + " is still broken"); process.exit(1); }
       }`
    );
    fs.writeFileSync(path.join(projectDir, "a.txt"), "state: broken\n");
    fs.writeFileSync(path.join(projectDir, "b.txt"), "state: broken\n");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(projectDir, { recursive: true, force: true });
  });

  it("reports every file a multi-attempt fix changed, matching what is on disk", async () => {
    scriptedReplies.push(reply("a.txt", "a.txt was broken"), reply("b.txt", "b.txt was also broken"));

    const state = await runRepairWorkflow({
      cwd: projectDir,
      logs: "error: a.txt is still broken",
      maxAttempts: 3,
    });

    expect(state.success).toBe(true);
    expect(state.attempts).toBe(2);

    // Attempt 1's edit to a.txt is still on disk, so it must still be part of the reported fix.
    expect(fs.readFileSync(path.join(projectDir, "a.txt"), "utf8")).toBe("state: FIXED\n");
    expect(fs.readFileSync(path.join(projectDir, "b.txt"), "utf8")).toBe("state: FIXED\n");
    expect(state.appliedFix?.patches.map((p) => p.filePath)).toEqual(["a.txt", "b.txt"]);
    expect(state.appliedFix?.rootCause).toBe("b.txt was also broken");
  });

  it("keeps the original content in the backup when later attempts edit the same file again", async () => {
    // Attempt 1 fixes a.txt only. Attempt 2 edits a.txt a second time and fixes b.txt.
    const tweakA = { filePath: "a.txt", search: "FIXED", replace: "FIXED-AGAIN" };
    const fixB = { filePath: "b.txt", search: "broken", replace: "FIXED" };
    scriptedReplies.push(
      reply("a.txt", "a.txt was broken"),
      JSON.stringify({ rootCause: "b.txt too", explanation: "Second pass", patches: [tweakA, fixB] })
    );

    const state = await runRepairWorkflow({
      cwd: projectDir,
      logs: "error: a.txt is still broken",
      maxAttempts: 3,
    });

    expect(state.success).toBe(true);
    expect(fs.readFileSync(path.join(projectDir, "a.txt"), "utf8")).toBe("state: FIXED-AGAIN\n");
    // Restoring the backup must bring back what the user had, not the result of attempt 1.
    expect(fs.readFileSync(path.join(projectDir, "a.txt.opspilot.bak"), "utf8")).toBe("state: broken\n");
    expect(fs.readFileSync(path.join(projectDir, "b.txt.opspilot.bak"), "utf8")).toBe("state: broken\n");
  });

  it("undo puts the whole project back as it was after a repair that took two attempts", async () => {
    const tweakA = { filePath: "a.txt", search: "FIXED", replace: "FIXED-AGAIN" };
    const fixB = { filePath: "b.txt", search: "broken", replace: "FIXED" };
    scriptedReplies.push(
      reply("a.txt", "a.txt was broken"),
      JSON.stringify({ rootCause: "b.txt too", explanation: "Second pass", patches: [tweakA, fixB] })
    );
    await runRepairWorkflow({ cwd: projectDir, logs: "error: a.txt is still broken", maxAttempts: 3 });
    expect(fs.readFileSync(path.join(projectDir, "a.txt"), "utf8")).toBe("state: FIXED-AGAIN\n");

    const entries = undoChanges(projectDir);

    expect(entries.map((entry) => entry.status)).toEqual(["restored", "restored"]);
    expect(fs.readFileSync(path.join(projectDir, "a.txt"), "utf8")).toBe("state: broken\n");
    expect(fs.readFileSync(path.join(projectDir, "b.txt"), "utf8")).toBe("state: broken\n");
    expect(fs.readdirSync(projectDir).filter((name) => name.includes(".opspilot.bak"))).toEqual([]);
  });

  describe("stopping early when attempts make no progress", () => {
    // The project fails with as many TypeScript-style errors as the number after "level:" in state.txt.
    // Each scripted reply changes that number, so the test controls exactly how the error count moves.
    const levelReply = (from: number, to: number) =>
      JSON.stringify({
        rootCause: "level is wrong",
        explanation: "changed the level",
        patches: [{ filePath: "state.txt", search: "level: " + from, replace: "level: " + to }],
      });

    const errorLines = (count: number) =>
      Array.from({ length: count }, (_, i) => "src/a.ts(" + (i + 1) + ",1): error TS2304: Cannot find name 'x'.").join("\n");

    beforeEach(() => {
      fs.writeFileSync(path.join(projectDir, "state.txt"), "level: 3\n");
      fs.writeFileSync(
        path.join(projectDir, "check.js"),
        'const n = Number(/level: ([0-9]+)/.exec(require("fs").readFileSync("state.txt", "utf8"))[1]);\n' +
          'for (let i = 1; i <= n; i++) console.error("src/a.ts(" + i + ",1): error TS2304: Cannot find name x.");\n' +
          "process.exit(n > 0 ? 1 : 0);\n"
      );
    });

    const run = (extra: { patience?: number; maxAttempts?: number }) =>
      runRepairWorkflow({
        cwd: projectDir,
        logs: errorLines(3),
        initialStep: "build",
        maxAttempts: extra.maxAttempts ?? 6,
        patience: extra.patience,
      });

    it("stops after 2 attempts in a row with the same number of errors, and says why", async () => {
      // 3 errors stay 3 errors: level 3 -> 3 would be a no-op, so shuffle with another file the build ignores.
      scriptedReplies.push(
        JSON.stringify({ rootCause: "a", explanation: "a", patches: [{ filePath: "a.txt", search: "broken", replace: "tweak1" }] }),
        JSON.stringify({ rootCause: "b", explanation: "b", patches: [{ filePath: "b.txt", search: "broken", replace: "tweak2" }] }),
        levelReply(3, 0)
      );

      const state = await run({ patience: 2 });

      expect(state.success).toBe(false);
      expect(state.attempts).toBe(2);
      expect(state.stoppedForNoProgress).toBe(true);
      expect(receivedPrompts).toHaveLength(2); // the third scripted reply was never asked for
    });

    it("stops when the error count grows", async () => {
      scriptedReplies.push(levelReply(3, 5), levelReply(5, 6), levelReply(6, 0));

      const state = await run({ patience: 2 });

      expect(state.stoppedForNoProgress).toBe(true);
      expect(state.attempts).toBe(2);
    });

    it("keeps going while the error count keeps shrinking, however many attempts that takes", async () => {
      scriptedReplies.push(levelReply(3, 2), levelReply(2, 1), levelReply(1, 0));

      const state = await run({ patience: 1 });

      expect(state.success).toBe(true);
      expect(state.attempts).toBe(3);
      expect(state.stoppedForNoProgress).toBe(false);
    });

    it("never stops early with patience 0, and uses every attempt", async () => {
      scriptedReplies.push(levelReply(3, 4), levelReply(4, 5), levelReply(5, 6), levelReply(6, 7));

      const state = await run({ patience: 0, maxAttempts: 4 });

      expect(state.success).toBe(false);
      expect(state.attempts).toBe(4);
      expect(state.stoppedForNoProgress).toBe(false);
    });

    it("does not stop early when no patience is given", async () => {
      scriptedReplies.push(levelReply(3, 4), levelReply(4, 5), levelReply(5, 6));

      const state = await run({ maxAttempts: 3 });

      expect(state.attempts).toBe(3);
      expect(state.stoppedForNoProgress).toBe(false);
    });

    it("lets the last attempt end the run normally rather than calling it an early stop", async () => {
      scriptedReplies.push(levelReply(3, 4), levelReply(4, 5));

      const state = await run({ patience: 2, maxAttempts: 2 });

      expect(state.attempts).toBe(2);
      expect(state.stoppedForNoProgress).toBe(false);
    });

    it("counts a run that fixes the build and then fails at lint as progress, even with more errors", async () => {
      fs.writeFileSync(
        path.join(projectDir, "package.json"),
        JSON.stringify({ name: "demo", scripts: { build: "node check.js", lint: "node lint.js" } })
      );
      fs.writeFileSync(
        path.join(projectDir, "lint.js"),
        'const n = Number(/lint: ([0-9]+)/.exec(require("fs").readFileSync("state.txt", "utf8"))[1]);\n' +
          'if (n > 0) { console.error("/p/src/a.ts"); for (let i = 1; i <= n; i++) console.error("  " + i + ":1  error  x is not defined  no-undef"); }\n' +
          "process.exit(n > 0 ? 1 : 0);\n"
      );
      fs.writeFileSync(path.join(projectDir, "state.txt"), "level: 1\nlint: 8\n");
      scriptedReplies.push(
        levelReply(1, 0), // the build passes, then lint fails with 8 errors: more than before, but a later step
        JSON.stringify({
          rootCause: "lint",
          explanation: "fixed lint",
          patches: [{ filePath: "state.txt", search: "lint: 8", replace: "lint: 0" }],
        })
      );

      const state = await runRepairWorkflow({
        cwd: projectDir,
        logs: errorLines(1),
        initialStep: "build",
        maxAttempts: 4,
        patience: 1,
      });

      expect(state.success).toBe(true);
      expect(state.attempts).toBe(2);
    });

    it("does not count attempts whose patch could not be applied", async () => {
      const wrong = JSON.stringify({
        rootCause: "guess",
        explanation: "guess",
        patches: [{ filePath: "state.txt", search: "text that is not there", replace: "x" }],
      });
      scriptedReplies.push(wrong, wrong, levelReply(3, 0));

      const state = await run({ patience: 2, maxAttempts: 4 });

      expect(state.success).toBe(true);
      expect(state.attempts).toBe(3);
    });
  });

  describe("working within a token budget", () => {
    const spending = (prompt: number, completion: number) => ({
      usage: { prompt_tokens: prompt, completion_tokens: completion, total_tokens: prompt + completion },
    });
    const run = (maxTokens: number | undefined) =>
      runRepairWorkflow({ cwd: projectDir, logs: "error: a.txt is still broken", maxAttempts: 3, maxTokens });
    const onDisk = (name: string) => fs.readFileSync(path.join(projectDir, name), "utf8");

    it("stops before a request the budget has no room for, keeping what was already fixed", async () => {
      modelReports.extra = spending(9000, 800);
      scriptedReplies.push(reply("a.txt", "a"), reply("b.txt", "b"));

      const state = await run(10_000);

      expect(state.success).toBe(false);
      expect(state.attempts).toBe(1);
      expect(receivedPrompts).toHaveLength(1);
      expect(state.budgetStop).toContain("token budget of 10000");
      expect(state.budgetStop).toContain("9800 already used");
      expect(onDisk("a.txt")).toBe("state: FIXED\n");
      expect(onDisk("b.txt")).toBe("state: broken\n");
    });

    it("limits each reply to what is left of the budget after the prompt", async () => {
      modelReports.extra = spending(1000, 200);
      scriptedReplies.push(reply("a.txt", "a"), reply("b.txt", "b"));

      const state = await run(6000);

      expect(state.success).toBe(true);
      const estimate = (prompt: string) => Math.ceil(prompt.length / 4);
      expect(receivedOptions[0].maxTokens).toBe(6000 - estimate(receivedPrompts[0]));
      expect(receivedOptions[1].maxTokens).toBe(6000 - 1200 - estimate(receivedPrompts[1]));
      expect(state.budgetStop).toBeNull();
    });

    it("makes no request at all when the budget cannot cover even the first one", async () => {
      scriptedReplies.push(reply("a.txt", "a"));

      const state = await run(100);

      expect(state.attempts).toBe(0);
      expect(receivedPrompts).toHaveLength(0);
      expect(state.budgetStop).toContain("token budget of 100");
      expect(onDisk("a.txt")).toBe("state: broken\n");
    });

    it("sets no reply limit and never stops when there is no budget", async () => {
      modelReports.extra = spending(10_000_000, 10_000_000);
      scriptedReplies.push(reply("a.txt", "a"), reply("b.txt", "b"));

      const state = await run(undefined);

      expect(state.success).toBe(true);
      expect(receivedOptions.map((o) => o.maxTokens)).toEqual([undefined, undefined]);
    });

    it("estimates a request the model does not report, says so, and still enforces the budget", async () => {
      modelReports.extra = { usage: undefined };
      scriptedReplies.push(reply("a.txt", "a"), reply("b.txt", "b"));

      const state = await run(50_000);

      expect(state.success).toBe(true);
      expect(state.tokensEstimated).toBe(true);
      expect(state.promptTokens).toBe(receivedPrompts.reduce((sum, p) => sum + Math.ceil(p.length / 4), 0));
      expect(state.completionTokens).toBeGreaterThan(0);
      expect(vi.mocked(console.log).mock.calls.flat().join(" ")).toContain("an estimate");
    });

    it("says when a reply was cut off by the budget", async () => {
      modelReports.extra = { truncated: true };
      scriptedReplies.push('{"rootCause": "cut', reply("a.txt", "a"), reply("b.txt", "b"));

      await runRepairWorkflow({ cwd: projectDir, logs: "error", maxAttempts: 1, maxTokens: 5000 });

      expect(vi.mocked(console.log).mock.calls.flat().join(" ")).toContain("cut off");
    });
  });

  describe("re-running only the failing tests", () => {
    // A stand-in for Jest at node_modules/.bin/jest. It records how it was called in runs.json, prints a FAIL line
    // for every test file that still says "broken", and can be told (with a file named reject-args) to refuse
    // arguments, the way a runner does when it cannot find the files it was given.
    const RUNNER = [
      'const fs = require("fs");',
      'const log = require(require("path").resolve("log.js"));',
      "const args = process.argv.slice(2);",
      'log("tests " + (args.length ? args.join(" ") : "(all)"));',
      'if (args.length && fs.existsSync("reject-args")) { console.error("No test files found, exiting with code 1"); process.exit(1); }',
      'if (args.length) console.log("ran-with-args");',
      'const files = args.length ? args : fs.readdirSync(".").filter((f) => f.endsWith(".test.js"));',
      "let failed = false;",
      'for (const f of files) if (fs.readFileSync(f, "utf8").includes("broken")) { console.log("FAIL " + f); failed = true; }',
      "process.exit(failed ? 1 : 0);",
    ].join("\n");

    const BUILD = [
      'const fs = require("fs");',
      'require(require("path").resolve("log.js"))("build");',
      'if (fs.readFileSync("flag.txt", "utf8").includes("broken")) { console.error("src/x.ts(1,1): error TS2304: Cannot find name y."); process.exit(1); }',
    ].join("\n");

    const FAILING = ["FAIL one.test.js", "FAIL two.test.js"].join("\n");

    const runs = (): string[] => JSON.parse(fs.readFileSync(path.join(projectDir, "runs.json"), "utf8"));

    beforeEach(() => {
      fs.writeFileSync(
        path.join(projectDir, "package.json"),
        JSON.stringify({ name: "demo", scripts: { build: "node build.js", test: "node node_modules/.bin/jest" } })
      );
      fs.writeFileSync(
        path.join(projectDir, "log.js"),
        [
          'const fs = require("fs");',
          "module.exports = (entry) => {",
          '  const list = fs.existsSync("runs.json") ? JSON.parse(fs.readFileSync("runs.json", "utf8")) : [];',
          "  list.push(entry);",
          '  fs.writeFileSync("runs.json", JSON.stringify(list));',
          "};",
        ].join("\n")
      );
      fs.mkdirSync(path.join(projectDir, "node_modules", ".bin"), { recursive: true });
      fs.writeFileSync(path.join(projectDir, "node_modules", ".bin", "jest"), RUNNER);
      fs.writeFileSync(path.join(projectDir, "build.js"), BUILD);
      fs.writeFileSync(path.join(projectDir, "flag.txt"), "state: FIXED\n");
      fs.writeFileSync(path.join(projectDir, "one.test.js"), "state: broken\n");
      fs.writeFileSync(path.join(projectDir, "two.test.js"), "state: broken\n");
    });

    const run = (extra: { focusTests?: boolean; maxAttempts?: number; logs?: string; initialStep?: "build" | "test" } = {}) =>
      runRepairWorkflow({
        cwd: projectDir,
        logs: extra.logs ?? FAILING,
        initialStep: extra.initialStep ?? "test",
        maxAttempts: extra.maxAttempts ?? 4,
        focusTests: extra.focusTests,
      });

    it("re-runs only the failing test files while they fail, then runs the full pipeline once they pass", async () => {
      scriptedReplies.push(reply("one.test.js", "one"), reply("two.test.js", "two"));

      const state = await run();

      expect(state.success).toBe(true);
      expect(state.attempts).toBe(2);
      expect(runs()).toEqual([
        "tests one.test.js two.test.js", // attempt 1: only the files that failed (two still does)
        "tests two.test.js", // attempt 2: now only the one that is left, which passes
        "build", // so the full pipeline confirms the fix
        "tests (all)",
      ]);
    });

    it("gives the model the focused output, not the whole run again", async () => {
      scriptedReplies.push(reply("one.test.js", "one"), reply("two.test.js", "two"));

      await run();

      expect(receivedPrompts[1]).toContain("ran-with-args");
      expect(receivedPrompts[1]).toContain("FAIL two.test.js");
      expect(receivedPrompts[1]).not.toContain("FAIL one.test.js");
    });

    it("reports a problem the full pipeline finds after the focused tests pass, instead of calling the fix done", async () => {
      fs.writeFileSync(path.join(projectDir, "flag.txt"), "state: broken\n");
      scriptedReplies.push(
        JSON.stringify({
          rootCause: "tests",
          explanation: "fixed both",
          patches: [
            { filePath: "one.test.js", search: "broken", replace: "FIXED" },
            { filePath: "two.test.js", search: "broken", replace: "FIXED" },
          ],
        })
      );

      const state = await run({ maxAttempts: 1 });

      expect(state.success).toBe(false);
      expect(runs()).toEqual(["tests one.test.js two.test.js", "build"]);
      expect(state.logs).toContain("TS2304");
    });

    it("runs the full pipeline every time when focusTests is false", async () => {
      scriptedReplies.push(reply("one.test.js", "one"), reply("two.test.js", "two"));

      const state = await run({ focusTests: false });

      expect(state.success).toBe(true);
      expect(runs()).toEqual(["build", "tests (all)", "build", "tests (all)"]);
    });

    it("does not narrow anything when the failing step was not the tests", async () => {
      fs.writeFileSync(path.join(projectDir, "flag.txt"), "state: broken\n");
      fs.writeFileSync(path.join(projectDir, "one.test.js"), "state: FIXED\n");
      fs.writeFileSync(path.join(projectDir, "two.test.js"), "state: FIXED\n");
      scriptedReplies.push(reply("flag.txt", "build"));

      const state = await run({ initialStep: "build", logs: "src/x.ts(1,1): error TS2304: Cannot find name y." });

      expect(state.success).toBe(true);
      expect(runs()).toEqual(["build", "tests (all)"]);
    });

    it("runs the full pipeline when the test script is not one it recognises", async () => {
      fs.writeFileSync(
        path.join(projectDir, "package.json"),
        JSON.stringify({ name: "demo", scripts: { build: "node build.js", test: "node runner.js" } })
      );
      fs.writeFileSync(path.join(projectDir, "runner.js"), RUNNER);
      scriptedReplies.push(
        JSON.stringify({
          rootCause: "tests",
          explanation: "fixed both",
          patches: [
            { filePath: "one.test.js", search: "broken", replace: "FIXED" },
            { filePath: "two.test.js", search: "broken", replace: "FIXED" },
          ],
        })
      );

      const state = await run();

      expect(state.success).toBe(true);
      expect(runs()).toEqual(["build", "tests (all)"]);
    });

    it("falls back to the full pipeline when the runner rejects the focused run, rather than trusting it", async () => {
      fs.writeFileSync(path.join(projectDir, "reject-args"), "");
      scriptedReplies.push(
        JSON.stringify({
          rootCause: "tests",
          explanation: "fixed both",
          patches: [
            { filePath: "one.test.js", search: "broken", replace: "FIXED" },
            { filePath: "two.test.js", search: "broken", replace: "FIXED" },
          ],
        })
      );

      const state = await run();

      expect(state.success).toBe(true);
      expect(runs()).toEqual(["tests one.test.js two.test.js", "build", "tests (all)"]);
    });
  });

  it("refuses a patch aimed outside the project, then still finishes the repair", async () => {
    const outsideFile = path.join(path.dirname(projectDir), `bugzero-outside-${path.basename(projectDir)}.txt`);
    fs.writeFileSync(outsideFile, "state: broken\n");
    try {
      const escaping = JSON.stringify({
        rootCause: "pointed at the wrong place",
        explanation: "A path outside the project",
        patches: [{ filePath: path.relative(projectDir, outsideFile), search: "broken", replace: "HACKED" }],
      });
      scriptedReplies.push(escaping, reply("a.txt", "a.txt was broken"), reply("b.txt", "b.txt was also broken"));

      const state = await runRepairWorkflow({
        cwd: projectDir,
        logs: "error: a.txt is still broken",
        maxAttempts: 4,
      });

      expect(fs.readFileSync(outsideFile, "utf8")).toBe("state: broken\n");
      expect(state.success).toBe(true);
      expect(state.appliedFix?.patches.map((p) => p.filePath)).toEqual(["a.txt", "b.txt"]);
    } finally {
      fs.rmSync(outsideFile, { force: true });
    }
  });

  describe("asking for approval before writing", () => {
    type Decision = { approved: true } | { approved: false; note?: string };
    const approver = (...decisions: Decision[]) => {
      const requests: any[] = [];
      const handler = async (request: any): Promise<Decision> => {
        requests.push(request);
        return decisions.shift() ?? { approved: true };
      };
      return { handler, requests };
    };
    const onDisk = (name: string) => fs.readFileSync(path.join(projectDir, name), "utf8");

    it("shows the diff of the proposed fix and applies it once approved", async () => {
      const { handler, requests } = approver({ approved: true }, { approved: true });
      scriptedReplies.push(reply("a.txt", "a.txt was broken"), reply("b.txt", "b.txt was also broken"));

      const state = await runRepairWorkflow({
        cwd: projectDir,
        logs: "error: a.txt is still broken",
        maxAttempts: 3,
        approve: handler,
      });

      expect(state.success).toBe(true);
      expect(requests).toHaveLength(2);
      expect(requests[0]).toMatchObject({
        attempt: 1,
        maxAttempts: 3,
        rootCause: "a.txt was broken",
        explanation: "Fixed a.txt",
        files: ["a.txt"],
      });
      expect(requests[0].diff).toContain("--- a/a.txt");
      expect(requests[0].diff).toContain("-state: broken");
      expect(requests[0].diff).toContain("+state: FIXED");
      expect(onDisk("a.txt")).toBe("state: FIXED\n");
    });

    it("writes nothing when the fix is declined, then asks the model again and tells it", async () => {
      const { handler } = approver({ approved: false, note: "please do not touch a.txt like that" }, { approved: true }, { approved: true });
      scriptedReplies.push(reply("a.txt", "first idea"), reply("a.txt", "second idea"), reply("b.txt", "b.txt was also broken"));

      const state = await runRepairWorkflow({
        cwd: projectDir,
        logs: "error: a.txt is still broken",
        maxAttempts: 4,
        approve: handler,
      });

      // After the first reply was declined the project had not changed at all.
      expect(receivedPrompts).toHaveLength(3);
      expect(receivedPrompts[1]).toContain("declined");
      expect(receivedPrompts[1]).toContain("please do not touch a.txt like that");
      expect(state.success).toBe(true);
      expect(state.attempts).toBe(3);
      expect(state.declinedFixes).toBe(1);
      expect(state.appliedFix?.patches.map((p) => p.filePath)).toEqual(["a.txt", "b.txt"]);
    });

    it("leaves every file and backup untouched when every fix is declined", async () => {
      const { handler } = approver({ approved: false }, { approved: false });
      scriptedReplies.push(reply("a.txt", "idea one"), reply("a.txt", "idea two"));

      const state = await runRepairWorkflow({
        cwd: projectDir,
        logs: "error: a.txt is still broken",
        maxAttempts: 2,
        approve: handler,
      });

      expect(state.success).toBe(false);
      expect(state.attempts).toBe(2); // a decline uses up an attempt
      expect(state.declinedFixes).toBe(2);
      expect(state.appliedFix).toBeNull();
      expect(onDisk("a.txt")).toBe("state: broken\n");
      expect(fs.existsSync(path.join(projectDir, "a.txt.opspilot.bak"))).toBe(false);
    });

    it("does not ask about a fix that could not be applied, and reports the failure to the model as usual", async () => {
      const { handler, requests } = approver({ approved: true }, { approved: true });
      const wrongSearch = JSON.stringify({
        rootCause: "guessed wrong",
        explanation: "bad search",
        patches: [{ filePath: "a.txt", search: "text that is not in the file", replace: "FIXED" }],
      });
      scriptedReplies.push(wrongSearch, reply("a.txt", "a.txt was broken"), reply("b.txt", "b.txt was also broken"));

      const state = await runRepairWorkflow({
        cwd: projectDir,
        logs: "error: a.txt is still broken",
        maxAttempts: 4,
        approve: handler,
      });

      expect(state.success).toBe(true);
      expect(requests).toHaveLength(2); // only the two fixes that could really be applied
      expect(receivedPrompts[1]).toContain("Search string not found");
    });

    it("asks nothing when approval was not requested", async () => {
      scriptedReplies.push(reply("a.txt", "a.txt was broken"), reply("b.txt", "b.txt was also broken"));

      const state = await runRepairWorkflow({ cwd: projectDir, logs: "error: a.txt is still broken", maxAttempts: 3 });

      expect(state.success).toBe(true);
      expect(state.declinedFixes).toBe(0);
    });
  });

  it("previews exactly the prompt it sends to the model first, without sending anything", async () => {
    fs.writeFileSync(path.join(projectDir, ".env"), "API_KEY=very-secret-value\n");
    const logs = 'error: a.txt is still broken (see "./.env")';

    const preview = previewAnalysisPrompt(projectDir, logs);
    expect(receivedPrompts).toHaveLength(0); // previewing never calls the model

    scriptedReplies.push(reply("a.txt", "a.txt was broken"), reply("b.txt", "b.txt was also broken"));
    await runRepairWorkflow({ cwd: projectDir, logs, maxAttempts: 3 });

    expect(receivedPrompts[0]).toBe(preview);
    expect(preview).toContain("a.txt is still broken");
    expect(preview).not.toContain("very-secret-value");
  });

  it("refuses a patch to a secret file, leaves it untouched, then still finishes the repair", async () => {
    fs.writeFileSync(path.join(projectDir, ".env"), "API_KEY=broken\n");
    const aimedAtSecret = JSON.stringify({
      rootCause: "wrong place",
      explanation: "Edit the env file",
      patches: [{ filePath: ".env", search: "broken", replace: "HACKED" }],
    });
    scriptedReplies.push(aimedAtSecret, reply("a.txt", "a.txt was broken"), reply("b.txt", "b.txt was also broken"));

    const state = await runRepairWorkflow({ cwd: projectDir, logs: "error: a.txt is still broken", maxAttempts: 4 });

    expect(fs.readFileSync(path.join(projectDir, ".env"), "utf8")).toBe("API_KEY=broken\n");
    expect(fs.existsSync(path.join(projectDir, ".env.opspilot.bak"))).toBe(false);
    expect(state.success).toBe(true);
    expect(state.appliedFix?.patches.map((p) => p.filePath)).toEqual(["a.txt", "b.txt"]);
  });

  it("lets a project allow editing a default-protected file through .bugzerorc", async () => {
    fs.writeFileSync(path.join(projectDir, ".bugzerorc"), JSON.stringify({ allow: [".env"] }));
    fs.writeFileSync(path.join(projectDir, ".env"), "state: broken\n");
    // The build now also needs .env fixed.
    fs.writeFileSync(
      path.join(projectDir, "check.js"),
      `const fs = require("fs");
       for (const file of ["a.txt", "b.txt", ".env"]) {
         if (!fs.readFileSync(file, "utf8").includes("FIXED")) { console.error("error: " + file + " is still broken"); process.exit(1); }
       }`
    );
    const fixAll = JSON.stringify({
      rootCause: "three broken files",
      explanation: "fixed them",
      patches: ["a.txt", "b.txt", ".env"].map((filePath) => ({ filePath, search: "broken", replace: "FIXED" })),
    });
    scriptedReplies.push(fixAll);

    const state = await runRepairWorkflow({ cwd: projectDir, logs: "error: a.txt is still broken", maxAttempts: 2 });

    expect(state.success).toBe(true);
    expect(fs.readFileSync(path.join(projectDir, ".env"), "utf8")).toBe("state: FIXED\n");
  });

  it("still verifies and finishes the repair after an early patch fails to apply", async () => {
    const wrongSearch = JSON.stringify({
      rootCause: "guessed the wrong text",
      explanation: "Search text that is not in the file",
      patches: [{ filePath: "a.txt", search: "this text is not in the file", replace: "FIXED" }],
    });
    scriptedReplies.push(wrongSearch, reply("a.txt", "a.txt was broken"), reply("b.txt", "b.txt was also broken"));

    const state = await runRepairWorkflow({
      cwd: projectDir,
      logs: "error: a.txt is still broken",
      maxAttempts: 4,
    });

    // Attempt 1 could not be applied. Attempts 2 and 3 must each be verified, so the run reaches success.
    expect(state.success).toBe(true);
    expect(state.attempts).toBe(3);
    expect(fs.readFileSync(path.join(projectDir, "a.txt"), "utf8")).toBe("state: FIXED\n");
    expect(fs.readFileSync(path.join(projectDir, "b.txt"), "utf8")).toBe("state: FIXED\n");
    expect(state.appliedFix?.patches.map((p) => p.filePath)).toEqual(["a.txt", "b.txt"]);
  });
});
