import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildChangeDiffLines, buildRescueSummary } from "./summary";

const appliedFix = {
  rootCause: "Missing semicolon",
  explanation: "Added missing semicolon",
  patches: [{ filePath: "src/index.ts", search: "a", replace: "b" }],
};

describe("buildRescueSummary", () => {
  it("reports nothing to fix when the project already passed", () => {
    const summary = buildRescueSummary({ success: true, attempts: 0, finalOutput: "" }, { dryRun: false });

    expect(summary.exitCode).toBe(0);
    expect(summary.lines).toEqual([
      "✅ Nothing to fix — your project already passes its build, lint, and tests.",
    ]);
  });

  it("describes a successful single-file fix with model, tokens, and reasoning", () => {
    const summary = buildRescueSummary(
      {
        success: true,
        attempts: 2,
        appliedFix,
        modelUsed: "deepseek/deepseek-chat",
        promptTokens: 100,
        completionTokens: 20,
      },
      { dryRun: false }
    );

    expect(summary.exitCode).toBe(0);
    expect(summary.lines).toEqual([
      "✅ Build fixed after 2 attempt(s)!",
      "   Model:  deepseek/deepseek-chat",
      "   Tokens: Prompt: 100 | Completion: 20 | Total: 120",
      "   File:   src/index.ts",
      "   Reason: Added missing semicolon",
      "   Root cause: Missing semicolon",
    ]);
  });

  it("lists every file for a multi-file fix", () => {
    const summary = buildRescueSummary(
      {
        success: true,
        attempts: 1,
        appliedFix: {
          ...appliedFix,
          patches: [
            { filePath: "src/a.ts", search: "a", replace: "b" },
            { filePath: "src/b.ts", search: "a", replace: "b" },
          ],
        },
      },
      { dryRun: false }
    );

    expect(summary.lines).toContain("   Files:   src/a.ts, src/b.ts");
  });

  it("lists a file once even when several attempts patched it", () => {
    const summary = buildRescueSummary(
      {
        success: true,
        attempts: 2,
        appliedFix: {
          ...appliedFix,
          patches: [
            { filePath: "src/a.ts", search: "a", replace: "b" },
            { filePath: "src/b.ts", search: "a", replace: "b" },
            { filePath: "src/a.ts", search: "a", replace: "b" },
          ],
        },
      },
      { dryRun: false }
    );

    expect(summary.lines).toContain("   Files:   src/a.ts, src/b.ts");
  });

  it("reports a real failure with the error and exits 1", () => {
    const summary = buildRescueSummary(
      {
        success: false,
        attempts: 3,
        error: "Max attempts (3) reached without a successful build.",
        modelUsed: "deepseek/deepseek-chat",
      },
      { dryRun: false }
    );

    expect(summary.exitCode).toBe(1);
    expect(summary.lines[0]).toBe("❌ Could not fix build after 3 attempt(s).");
    expect(summary.lines).toContain("   Max attempts (3) reached without a successful build.");
  });

  it("presents a dry run as a completed analysis, not a failed repair", () => {
    const summary = buildRescueSummary(
      {
        success: false,
        attempts: 0,
        finalOutput: "error TS2304",
        error: "Dry-run: analysis complete, no files modified.",
      },
      { dryRun: true }
    );

    const text = summary.lines.join("\n");
    expect(summary.exitCode).toBe(1);
    expect(text).toContain("Dry run complete");
    expect(text).toContain("no fixes were attempted and no files were modified");
    expect(text).toContain("Re-run without --dry-run");
    expect(text).not.toContain("Could not fix");
    expect(text).not.toContain("Model:");
  });

  it("still says nothing to fix for a dry run on an already-passing project", () => {
    const summary = buildRescueSummary({ success: true, attempts: 0, finalOutput: "" }, { dryRun: true });

    expect(summary.exitCode).toBe(0);
    expect(summary.lines[0]).toContain("Nothing to fix");
  });
});

describe("buildChangeDiffLines", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "bugzero-summary-diff-test-"));
    fs.mkdirSync(path.join(dir, "src"));
    fs.writeFileSync(path.join(dir, "src", "index.ts"), "export const a = 2;\n");
    fs.writeFileSync(path.join(dir, "src", "index.ts.opspilot.bak"), "export const a = 1;\n");
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const fixed = {
    success: true,
    attempts: 2,
    finalOutput: "",
    appliedFix: {
      rootCause: "r",
      explanation: "e",
      patches: [
        { filePath: "src/index.ts", search: "1", replace: "2" },
        { filePath: "src/index.ts", search: "x", replace: "y" }, // the same file edited twice is shown once
      ],
    },
  };

  it("shows what changed in each file, compared with its saved original", () => {
    const lines = buildChangeDiffLines(dir, fixed);

    expect(lines).toContain("--- a/src/index.ts");
    expect(lines).toContain("-export const a = 1;");
    expect(lines).toContain("+export const a = 2;");
    expect(lines.filter((l) => l === "--- a/src/index.ts")).toHaveLength(1);
    expect(lines.join("\n")).toMatch(/\.opspilot\.bak/); // says where the originals are kept
  });

  it("has nothing to show when the repair did not succeed or changed no file", () => {
    expect(buildChangeDiffLines(dir, { ...fixed, success: false })).toEqual([]);
    expect(buildChangeDiffLines(dir, { success: true, attempts: 0, finalOutput: "" })).toEqual([]);
  });

  it("shows nothing when the originals are not there", () => {
    fs.rmSync(path.join(dir, "src", "index.ts.opspilot.bak"));

    expect(buildChangeDiffLines(dir, fixed)).toEqual([]);
  });
});
