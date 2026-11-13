import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Only the model is faked. The patcher, the validation pipeline (a real `npm run build`),
// and the filesystem are all real, so this checks what actually ends up on disk and in appliedFix.
const { scriptedReplies } = vi.hoisted(() => ({ scriptedReplies: [] as string[] }));

vi.mock("@opspilot/ai-provider", () => ({
  OpenRouterProvider: class {
    async invoke() {
      const content = scriptedReplies.shift();
      if (content === undefined) throw new Error("The fake model was asked for more replies than were scripted.");
      return { content, model: "fake-model", usage: { prompt_tokens: 1, completion_tokens: 1 } };
    }
  },
}));

import { runRepairWorkflow } from "./workflow";

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
