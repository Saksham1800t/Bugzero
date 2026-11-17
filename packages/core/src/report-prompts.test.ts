import { describe, expect, it } from "vitest";
import {
  buildHuntDiagnosisPrompt,
  buildRescueFailurePrompt,
  buildRescueSuccessPrompt,
  capReportLogs,
  MAX_REPORT_LOG_CHARS,
} from "./report-prompts";

describe("capReportLogs", () => {
  it("returns logs within the limit unchanged", () => {
    expect(capReportLogs("small")).toBe("small");
  });

  it("keeps the start and the end of an oversized log and says what was dropped", () => {
    const capped = capReportLogs(`HEAD ${"x".repeat(100_000)} TAIL`);

    expect(capped.length).toBeLessThan(MAX_REPORT_LOG_CHARS + 200);
    expect(capped.startsWith("HEAD")).toBe(true);
    expect(capped.endsWith("TAIL")).toBe(true);
    expect(capped).toContain("omitted");
  });
});

describe("buildHuntDiagnosisPrompt", () => {
  it("lists only the checks that failed", () => {
    const prompt = buildHuntDiagnosisPrompt({
      build: { success: true, output: "" },
      lint: { success: false, output: "lint broke" },
      test: { success: true, output: "" },
    });

    expect(prompt).toContain("[LINT FAILURE]\nlint broke");
    expect(prompt).not.toContain("[BUILD FAILURE]");
    expect(prompt).not.toContain("[TEST FAILURE]");
  });

  it("splits the budget so one noisy check cannot crowd out the others", () => {
    const prompt = buildHuntDiagnosisPrompt({
      build: { success: false, output: `BUILD ${"x".repeat(200_000)}` },
      lint: { success: false, output: "short lint error" },
      test: { success: true, output: "" },
    });

    expect(prompt).toContain("short lint error"); // not truncated away
    expect(prompt).toContain("BUILD");
    expect(prompt.length).toBeLessThan(MAX_REPORT_LOG_CHARS + 2_000);
  });

  it("copes with a failing check that has no output", () => {
    const prompt = buildHuntDiagnosisPrompt({
      build: { success: false },
      lint: { success: true },
      test: { success: true },
    });

    expect(prompt).toContain("[BUILD FAILURE]");
  });
});

describe("buildRescueFailurePrompt", () => {
  it("includes the project, the attempt count and the logs", () => {
    const prompt = buildRescueFailurePrompt({ cwd: "/work/app", attempts: 3, rawOutput: "error TS1" });

    expect(prompt).toContain('"/work/app"');
    expect(prompt).toContain("after 3 attempts");
    expect(prompt).toContain("error TS1");
  });
});

describe("buildRescueSuccessPrompt", () => {
  it("names each patched file once and lists every patch", () => {
    const prompt = buildRescueSuccessPrompt({
      cwd: "/work/app",
      attempts: 2,
      appliedFix: {
        rootCause: "root",
        explanation: "why",
        patches: [
          { filePath: "a.ts", search: "one", replace: "two" },
          { filePath: "a.ts", search: "three", replace: "four" },
        ],
      },
    });

    expect(prompt).toContain("applying a patch to: a.ts.");
    expect(prompt).toContain("File 1: a.ts");
    expect(prompt).toContain("File 2: a.ts");
  });
});
