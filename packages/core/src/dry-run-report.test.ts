import { describe, expect, it } from "vitest";
import { buildDryRunFallbackReport, buildDryRunMetadata, buildDryRunPrompt } from "./dry-run-report";

describe("buildDryRunPrompt", () => {
  const prompt = buildDryRunPrompt("/work/app", "error TS2304: Cannot find name 'foo'.");

  it("includes the project path and the error logs", () => {
    expect(prompt).toContain("/work/app");
    expect(prompt).toContain("Cannot find name 'foo'");
  });

  it("tells the model no fixes were attempted and no files were changed", () => {
    expect(prompt).toContain("dry-run mode");
    expect(prompt).toContain("NO fixes");
    expect(prompt).toContain("NO files");
  });

  it("does not claim a repair was tried and failed", () => {
    expect(prompt).not.toContain("tried to repair");
    expect(prompt).not.toContain("could not resolve");
    expect(prompt).not.toContain("fixes might have failed");
  });
});

describe("buildDryRunMetadata", () => {
  it("reports the mode, model, and token usage", () => {
    const text = buildDryRunMetadata({
      model: "deepseek/deepseek-chat",
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    });

    expect(text).toContain("Dry run (no fixes attempted, no files modified)");
    expect(text).toContain("deepseek/deepseek-chat");
    expect(text).toContain("Total: **15**");
  });

  it("handles a response with no usage or model", () => {
    const text = buildDryRunMetadata({});

    expect(text).toContain("`unknown`");
    expect(text).toContain("*N/A*");
  });
});

describe("buildDryRunFallbackReport", () => {
  const report = buildDryRunFallbackReport({
    cwd: "/work/app",
    framework: "typescript",
    rawOutput: "src/index.ts(1,1): error TS2304",
  });

  it("presents the run as a dry run with the detected errors", () => {
    expect(report).toContain("BugZero Dry Run Report");
    expect(report).toContain("no fixes were attempted and no files were modified");
    expect(report).toContain("`/work/app`");
    expect(report).toContain("`typescript`");
    expect(report).toContain("```text\nsrc/index.ts(1,1): error TS2304\n```");
    expect(report).toContain("Re-run without `--dry-run`");
  });

  it("does not describe a failed repair", () => {
    expect(report).not.toContain("Failed to Repair");
    expect(report).not.toContain("Could not repair");
    expect(report).not.toContain("Attempts:");
    expect(report).not.toContain("AI Brain");
  });

  it("only mentions the AI being unavailable when it actually was", () => {
    expect(report).not.toContain("AI diagnosis was unavailable");

    const withError = buildDryRunFallbackReport({
      cwd: "/work/app",
      framework: "typescript",
      rawOutput: "x",
      aiError: "Missing OPENROUTER_API_KEY environment variable.",
    });
    expect(withError).toContain("AI diagnosis was unavailable for this report: Missing OPENROUTER_API_KEY");
  });
});
