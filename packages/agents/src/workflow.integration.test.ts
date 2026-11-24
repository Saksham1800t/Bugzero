import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Only the model is faked. The patcher, the validation pipeline (a real `npm run build`),
// and the filesystem are all real, so this checks what actually ends up on disk and in appliedFix.
const { scriptedReplies, receivedPrompts } = vi.hoisted(() => ({
  scriptedReplies: [] as string[],
  receivedPrompts: [] as string[],
}));

vi.mock("@opspilot/ai-provider", () => ({
  OpenRouterProvider: class {
    async invoke(prompt: string) {
      receivedPrompts.push(prompt);
      const content = scriptedReplies.shift();
      if (content === undefined) throw new Error("The fake model was asked for more replies than were scripted.");
      return { content, model: "fake-model", usage: { prompt_tokens: 1, completion_tokens: 1 } };
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
