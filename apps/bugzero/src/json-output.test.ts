import { describe, expect, it } from "vitest";
import { buildErrorJson, buildHuntJson, buildRescueJson, stepStatus } from "./json-output";

const info = { path: "/work/app", framework: "typescript", packageManager: "pnpm", reportPath: "/work/app/bugzero-report.md" };

describe("stepStatus", () => {
  it("maps results to passed, failed, or skipped", () => {
    expect(stepStatus({ success: true })).toBe("passed");
    expect(stepStatus({ success: false })).toBe("failed");
    expect(stepStatus({ success: true, skipped: true })).toBe("skipped");
  });
});

describe("buildHuntJson", () => {
  it("reports success when every step passed or was skipped", () => {
    const json = buildHuntJson(info, {
      build: { success: true, output: "ok" },
      lint: { success: true, skipped: true, output: "" },
      test: { success: true, output: "ok" },
    });

    expect(json.success).toBe(true);
    expect(json.command).toBe("hunt");
    expect(json.steps).toEqual({
      build: { status: "passed" },
      lint: { status: "skipped" },
      test: { status: "passed" },
    });
    expect(json.reportPath).toBe("/work/app/bugzero-report.md");
  });

  it("includes output and timedOut only for failed steps", () => {
    const json = buildHuntJson(info, {
      build: { success: false, output: "error TS2304" },
      lint: { success: false, timedOut: true, output: "partial\n[BugZero] Command timed out after 5s" },
      test: { success: true, output: "ok" },
    });

    expect(json.success).toBe(false);
    expect(json.steps.build).toEqual({ status: "failed", timedOut: false, output: "error TS2304" });
    expect(json.steps.lint.timedOut).toBe(true);
    expect(json.steps.lint.output).toContain("timed out after 5s");
    expect(json.steps.test).toEqual({ status: "passed" });
  });
});

describe("buildRescueJson", () => {
  const rescueInfo = { ...info, dryRun: false };

  it("reports an already-passing project", () => {
    const json = buildRescueJson({ success: true, attempts: 0, finalOutput: "" }, rescueInfo);

    expect(json).toMatchObject({
      command: "rescue",
      outcome: "already-passing",
      success: true,
      attempts: 0,
      model: null,
      tokens: null,
      fix: null,
      error: null,
    });
  });

  it("reports a fix with its files, root cause, model, and token totals", () => {
    const json = buildRescueJson(
      {
        success: true,
        attempts: 2,
        modelUsed: "deepseek/deepseek-chat",
        promptTokens: 100,
        completionTokens: 20,
        appliedFix: {
          rootCause: "Missing semicolon",
          explanation: "Added missing semicolon",
          patches: [
            { filePath: "src/a.ts", search: "x", replace: "y" },
            { filePath: "src/b.ts", search: "x", replace: "y" },
          ],
        },
      },
      rescueInfo
    );

    expect(json.outcome).toBe("fixed");
    expect(json.success).toBe(true);
    expect(json.model).toBe("deepseek/deepseek-chat");
    expect(json.tokens).toEqual({ prompt: 100, completion: 20, total: 120 });
    expect(json.fix).toEqual({
      rootCause: "Missing semicolon",
      explanation: "Added missing semicolon",
      files: ["src/a.ts", "src/b.ts"],
    });
  });

  it("reports a failed repair with its error", () => {
    const json = buildRescueJson(
      { success: false, attempts: 3, error: "Max attempts (3) reached without a successful build." },
      rescueInfo
    );

    expect(json.outcome).toBe("failed");
    expect(json.success).toBe(false);
    expect(json.error).toBe("Max attempts (3) reached without a successful build.");
  });

  it("reports a dry run that found failures as 'dry-run', not 'failed'", () => {
    const json = buildRescueJson(
      { success: false, attempts: 0, error: "Dry-run: analysis complete, no files modified." },
      { ...rescueInfo, dryRun: true }
    );

    expect(json.outcome).toBe("dry-run");
    expect(json.dryRun).toBe(true);
    expect(json.success).toBe(false);
  });

  it("serializes to plain JSON with no undefined fields", () => {
    const json = buildRescueJson({ success: true, attempts: 0, finalOutput: "" }, rescueInfo);
    expect(JSON.parse(JSON.stringify(json))).toEqual(json);
  });
});

describe("buildErrorJson", () => {
  it("wraps a message", () => {
    expect(buildErrorJson("boom")).toEqual({ success: false, error: "boom" });
  });
});
