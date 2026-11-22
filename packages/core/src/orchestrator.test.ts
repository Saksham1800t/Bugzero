import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockInvoke,
  mockRunValidationPipeline,
  mockRunRepairWorkflow,
  mockPreviewAnalysisPrompt,
  mockRunBuild,
  mockRunLint,
  mockRunTests,
} = vi.hoisted(() => ({
  mockInvoke: vi.fn(),
  mockPreviewAnalysisPrompt: vi.fn(),
  mockRunBuild: vi.fn(),
  mockRunLint: vi.fn(),
  mockRunTests: vi.fn(),
  mockRunValidationPipeline: vi.fn(),
  mockRunRepairWorkflow: vi.fn(),
}));

vi.mock("@opspilot/ai-provider", () => ({
  OpenRouterProvider: class {
    invoke = mockInvoke;
  },
}));

vi.mock("@opspilot/analyzers", () => ({
  runBuild: mockRunBuild,
  runLint: mockRunLint,
  runTests: mockRunTests,
  parseErrors: () => [],
  runValidationPipeline: mockRunValidationPipeline,
}));

vi.mock("@opspilot/agents", () => ({
  runRepairWorkflow: mockRunRepairWorkflow,
  previewAnalysisPrompt: mockPreviewAnalysisPrompt,
}));

import { orchestrate, orchestrateAndFix, REPORT_FILENAME } from "./orchestrator";

describe("orchestrateAndFix when the project already passes", () => {
  let projectDir: string;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "bugzero-orchestrator-test-"));
    fs.writeFileSync(path.join(projectDir, "package.json"), JSON.stringify({ name: "demo" }));
    mockRunValidationPipeline.mockResolvedValue({ success: true, step: "none", output: "" });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(projectDir, { recursive: true, force: true });
  });

  it("does not call the AI model", async () => {
    const result = await orchestrateAndFix({ cwd: projectDir });

    expect(result).toEqual({ success: true, attempts: 0, finalOutput: "" });
    expect(mockInvoke).not.toHaveBeenCalled();
    expect(mockRunRepairWorkflow).not.toHaveBeenCalled();
  });

  it("writes a report that says nothing needed fixing, not that a repair failed", async () => {
    await orchestrateAndFix({ cwd: projectDir });

    const report = fs.readFileSync(path.join(projectDir, REPORT_FILENAME), "utf-8");
    expect(report).toContain("already passes");
    expect(report).not.toMatch(/could not|failed to repair|unresolved/i);
  });
});

// What gets sent to the model for each kind of report. The first group pins today's wording
// (so moving the templates around can't change it); the second group checks the size cap.
describe("report prompts", () => {
  let projectDir: string;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "bugzero-report-prompt-test-"));
    fs.writeFileSync(path.join(projectDir, "package.json"), JSON.stringify({ name: "demo" }));
    mockInvoke.mockResolvedValue({ content: "AI REPORT", model: "m", usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(projectDir, { recursive: true, force: true });
  });

  /** The prompt sent to the model, with the random temp folder replaced so it can be compared. */
  const sentPrompt = (): string => mockInvoke.mock.calls[0][0].split(projectDir).join("<project>");
  const failing = (output: string) => ({ success: false, output });
  const passing = { success: true, output: "" };

  describe("wording", () => {
    it("hunt: asks for a diagnosis of every failing check", async () => {
      mockRunBuild.mockResolvedValue(failing("build boom"));
      mockRunLint.mockResolvedValue(passing);
      mockRunTests.mockResolvedValue(failing("2 tests failed"));

      await orchestrate({ cwd: projectDir });

      expect(sentPrompt()).toMatchSnapshot();
    });

    it("rescue that could not fix the project: asks for an analysis of the unresolved errors", async () => {
      mockRunValidationPipeline.mockResolvedValue({ success: false, step: "build", output: "error TS2304: nope" });
      mockRunRepairWorkflow.mockResolvedValue({ success: false, attempts: 3, logs: "error TS2304: nope", appliedFix: null });

      await orchestrateAndFix({ cwd: projectDir, maxAttempts: 3 });

      expect(sentPrompt()).toMatchSnapshot();
    });

    it("rescue that fixed the project: asks for a summary of what was changed", async () => {
      mockRunValidationPipeline.mockResolvedValue({ success: false, step: "build", output: "error TS2304: nope" });
      mockRunRepairWorkflow.mockResolvedValue({
        success: true,
        attempts: 2,
        logs: "",
        appliedFix: {
          rootCause: "Missing import",
          explanation: "Added the import",
          patches: [
            { filePath: "src/a.ts", search: "foo()", replace: "import { foo } from './foo';\nfoo()" },
            { filePath: "src/b.ts", search: "bar", replace: "baz" },
          ],
        },
      });

      await orchestrateAndFix({ cwd: projectDir, maxAttempts: 3 });

      expect(sentPrompt()).toMatchSnapshot();
    });
  });

  describe("size cap", () => {
    // A huge failing run (thousands of test failures, a giant stack trace) must not be sent whole.
    const HUGE = "E".repeat(500_000);
    const CAP = 30_000;

    it("hunt: caps the combined logs, and still shows every failing check", async () => {
      mockRunBuild.mockResolvedValue(failing(`BUILD-START ${HUGE} BUILD-END`));
      mockRunLint.mockResolvedValue(failing(`LINT-START ${HUGE} LINT-END`));
      mockRunTests.mockResolvedValue(failing(`TEST-START ${HUGE} TEST-END`));

      await orchestrate({ cwd: projectDir });

      const prompt = sentPrompt();
      expect(prompt.length).toBeLessThan(CAP);
      for (const marker of ["BUILD-START", "BUILD-END", "LINT-START", "LINT-END", "TEST-START", "TEST-END"]) {
        expect(prompt).toContain(marker);
      }
      expect(prompt).toContain("omitted");
    });

    it("rescue that could not fix the project: caps the unresolved logs", async () => {
      mockRunValidationPipeline.mockResolvedValue(failing(HUGE));
      mockRunRepairWorkflow.mockResolvedValue({ success: false, attempts: 3, logs: `FIRST ${HUGE} LAST`, appliedFix: null });

      await orchestrateAndFix({ cwd: projectDir, maxAttempts: 3 });

      const prompt = sentPrompt();
      expect(prompt.length).toBeLessThan(CAP);
      expect(prompt).toContain("FIRST");
      expect(prompt).toContain("LAST");
    });

    it("dry run: caps the logs", async () => {
      mockRunValidationPipeline.mockResolvedValue(failing(`FIRST ${HUGE} LAST`));

      await orchestrateAndFix({ cwd: projectDir, dryRun: true });

      const prompt = sentPrompt();
      expect(prompt.length).toBeLessThan(CAP);
      expect(prompt).toContain("FIRST");
      expect(prompt).toContain("LAST");
    });

    it("leaves a log that is within the cap untouched", async () => {
      const log = "error: something small\n".repeat(50);
      mockRunValidationPipeline.mockResolvedValue(failing(log));

      await orchestrateAndFix({ cwd: projectDir, dryRun: true });

      expect(sentPrompt()).toContain(log);
      expect(sentPrompt()).not.toContain("omitted");
    });
  });
});

describe("hunt with --no-ai-report", () => {
  let projectDir: string;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "bugzero-hunt-offline-test-"));
    fs.writeFileSync(path.join(projectDir, "package.json"), JSON.stringify({ name: "demo" }));
    mockInvoke.mockResolvedValue({ content: "AI DIAGNOSIS", model: "m", usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
    mockRunBuild.mockResolvedValue({ success: false, output: "error TS2304: Cannot find name 'foo'." });
    mockRunLint.mockResolvedValue({ success: true, output: "" });
    mockRunTests.mockResolvedValue({ success: false, output: "1 test failed" });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(projectDir, { recursive: true, force: true });
  });

  const report = () => fs.readFileSync(path.join(projectDir, REPORT_FILENAME), "utf-8");

  it("never calls the AI model, even when checks fail", async () => {
    await orchestrate({ cwd: projectDir, aiReport: false });

    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("still writes a report with the status of each check and the raw logs", async () => {
    const result = await orchestrate({ cwd: projectDir, aiReport: false });

    expect(result.build.success).toBe(false);
    const text = report();
    expect(text).toContain("Build:");
    expect(text).toContain("Cannot find name 'foo'");
    expect(text).toContain("1 test failed");
  });

  it("says the AI report was turned off, not that an AI call failed", async () => {
    await orchestrate({ cwd: projectDir, aiReport: false });

    const text = report();
    expect(text).toMatch(/turned off/i);
    expect(text).not.toMatch(/AI call failed/i);
  });

  it("still calls the AI by default, so existing behaviour is unchanged", async () => {
    await orchestrate({ cwd: projectDir });

    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(report()).toContain("AI DIAGNOSIS");
  });
});

describe("rescue with printPrompt", () => {
  let projectDir: string;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "bugzero-print-prompt-test-"));
    fs.writeFileSync(path.join(projectDir, "package.json"), JSON.stringify({ name: "demo" }));
    mockPreviewAnalysisPrompt.mockReturnValue("THE EXACT PROMPT");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(projectDir, { recursive: true, force: true });
  });

  const reportExists = () => fs.existsSync(path.join(projectDir, REPORT_FILENAME));

  it("returns the first prompt for a failing project, and sends and writes nothing", async () => {
    mockRunValidationPipeline.mockResolvedValue({ success: false, step: "build", output: "error TS2304: nope" });

    const result = await orchestrateAndFix({ cwd: projectDir, printPrompt: true });

    expect(result.promptPreview).toBe("THE EXACT PROMPT");
    expect(mockPreviewAnalysisPrompt).toHaveBeenCalledWith(projectDir, "error TS2304: nope");
    expect(mockInvoke).not.toHaveBeenCalled();
    expect(mockRunRepairWorkflow).not.toHaveBeenCalled();
    expect(reportExists()).toBe(false);
  });

  it("has nothing to show for a project that already passes, and writes nothing", async () => {
    mockRunValidationPipeline.mockResolvedValue({ success: true, step: "none", output: "" });

    const result = await orchestrateAndFix({ cwd: projectDir, printPrompt: true });

    expect(result).toMatchObject({ success: true, attempts: 0 });
    expect(result.promptPreview).toBeUndefined();
    expect(mockInvoke).not.toHaveBeenCalled();
    expect(reportExists()).toBe(false);
  });

  it("takes precedence over --dry-run, which would otherwise ask the AI for a report", async () => {
    mockRunValidationPipeline.mockResolvedValue({ success: false, step: "build", output: "boom" });

    const result = await orchestrateAndFix({ cwd: projectDir, printPrompt: true, dryRun: true });

    expect(result.promptPreview).toBe("THE EXACT PROMPT");
    expect(mockInvoke).not.toHaveBeenCalled();
    expect(reportExists()).toBe(false);
  });

  it("does not preview anything on a normal run", async () => {
    mockRunValidationPipeline.mockResolvedValue({ success: false, step: "build", output: "boom" });
    mockRunRepairWorkflow.mockResolvedValue({ success: false, attempts: 1, logs: "boom", appliedFix: null });
    mockInvoke.mockResolvedValue({ content: "r", model: "m", usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });

    const result = await orchestrateAndFix({ cwd: projectDir });

    expect(result.promptPreview).toBeUndefined();
    expect(mockPreviewAnalysisPrompt).not.toHaveBeenCalled();
    expect(mockRunRepairWorkflow).toHaveBeenCalledTimes(1);
  });
});

describe("rescue with an approval handler", () => {
  let projectDir: string;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "bugzero-approve-test-"));
    fs.writeFileSync(path.join(projectDir, "package.json"), JSON.stringify({ name: "demo" }));
    mockRunValidationPipeline.mockResolvedValue({ success: false, step: "build", output: "error TS2304: nope" });
    mockInvoke.mockResolvedValue({ content: "r", model: "m", usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(projectDir, { recursive: true, force: true });
  });

  it("gives the handler to the repair loop", async () => {
    const approve = vi.fn();
    mockRunRepairWorkflow.mockResolvedValue({ success: true, attempts: 1, logs: "", appliedFix: null, declinedFixes: 0 });

    await orchestrateAndFix({ cwd: projectDir, approve });

    expect(mockRunRepairWorkflow).toHaveBeenCalledWith(expect.objectContaining({ approve }));
  });

  it("says so when every proposed fix was declined, rather than blaming the attempt limit", async () => {
    mockRunRepairWorkflow.mockResolvedValue({ success: false, attempts: 3, logs: "x", appliedFix: null, declinedFixes: 3 });

    const result = await orchestrateAndFix({ cwd: projectDir, maxAttempts: 3, approve: vi.fn() });

    expect(result.success).toBe(false);
    expect(result.declinedFixes).toBe(3);
    expect(result.error).toMatch(/declined 3 proposed fixes/i);
    expect(result.error).toMatch(/nothing was changed/i);
  });

  it("mentions declined fixes alongside the attempt limit when some other fix was applied", async () => {
    mockRunRepairWorkflow.mockResolvedValue({
      success: false,
      attempts: 3,
      logs: "x",
      appliedFix: { rootCause: "r", explanation: "e", patches: [{ filePath: "a.ts", search: "a", replace: "b" }] },
      declinedFixes: 1,
    });

    const result = await orchestrateAndFix({ cwd: projectDir, maxAttempts: 3, approve: vi.fn() });

    expect(result.error).toMatch(/Max attempts \(3\) reached/);
    expect(result.error).toMatch(/declined 1 proposed fix\b/i);
  });

  it("keeps the usual message when nothing was declined", async () => {
    mockRunRepairWorkflow.mockResolvedValue({ success: false, attempts: 3, logs: "x", appliedFix: null, declinedFixes: 0 });

    const result = await orchestrateAndFix({ cwd: projectDir, maxAttempts: 3 });

    expect(result.error).toBe("Max attempts (3) reached without a successful build.");
    expect(result.declinedFixes).toBeUndefined();
  });
});
