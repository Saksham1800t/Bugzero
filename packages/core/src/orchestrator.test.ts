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

describe("rescue with a token budget", () => {
  let projectDir: string;

  const fix = { rootCause: "cause", explanation: "why", patches: [{ filePath: "a.ts", search: "x", replace: "y" }] };
  const loopResult = (overrides: Record<string, unknown> = {}) => ({
    success: true,
    attempts: 1,
    logs: "",
    appliedFix: fix,
    declinedFixes: 0,
    promptTokens: 3000,
    completionTokens: 1000,
    modelUsed: "m",
    ...overrides,
  });
  const reply = (extra: Record<string, unknown> = {}) => ({
    content: "# AI report",
    model: "m",
    usage: { prompt_tokens: 500, completion_tokens: 200, total_tokens: 700 },
    ...extra,
  });
  const report = () => fs.readFileSync(path.join(projectDir, REPORT_FILENAME), "utf8");

  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "bugzero-budget-test-"));
    fs.writeFileSync(path.join(projectDir, "package.json"), JSON.stringify({ name: "demo" }));
    mockRunValidationPipeline.mockResolvedValue({ success: false, step: "build", output: "build broke" });
    mockInvoke.mockResolvedValue(reply());
    mockRunRepairWorkflow.mockResolvedValue(loopResult());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(projectDir, { recursive: true, force: true });
  });

  it("has no limit by default, and the report says nothing about a budget", async () => {
    const result = await orchestrateAndFix({ cwd: projectDir });

    expect(mockRunRepairWorkflow.mock.calls[0][0].maxTokens).toBeUndefined();
    expect(mockInvoke.mock.calls[0][1].maxTokens).toBeUndefined();
    expect(result.tokenBudget).toBeUndefined();
    expect(report()).not.toContain("Token budget");
  });

  it("gives the repair loop the budget from .bugzerorc, which the option beats", async () => {
    fs.writeFileSync(path.join(projectDir, ".bugzerorc"), JSON.stringify({ maxTokens: 40_000 }));

    await orchestrateAndFix({ cwd: projectDir });
    await orchestrateAndFix({ cwd: projectDir, maxTokens: 90_000 });
    await orchestrateAndFix({ cwd: projectDir, maxTokens: 0 });

    expect(mockRunRepairWorkflow.mock.calls.map((call) => call[0].maxTokens)).toEqual([40_000, 90_000, undefined]);
  });

  it("rejects a bad maxTokens in .bugzerorc before running anything", async () => {
    fs.writeFileSync(path.join(projectDir, ".bugzerorc"), JSON.stringify({ maxTokens: "lots" }));

    await expect(orchestrateAndFix({ cwd: projectDir })).rejects.toThrow("maxTokens in .bugzerorc must be a whole number");
    expect(mockRunValidationPipeline).not.toHaveBeenCalled();
  });

  it("limits the report request to what is left, and counts it in the total", async () => {
    const result = await orchestrateAndFix({ cwd: projectDir, maxTokens: 10_000 });

    const [prompt, options] = mockInvoke.mock.calls[0];
    expect(options.maxTokens).toBe(10_000 - 4000 - Math.ceil(prompt.length / 4));
    expect(result.tokenBudget).toEqual({ limit: 10_000, used: 4700, estimated: false });
    // The fix attempts' own numbers stay what they were
    expect(result.promptTokens).toBe(3000);
    expect(result.completionTokens).toBe(1000);
    expect(report()).toContain("# AI report");
    expect(report()).toContain("4700 of 10000 tokens used");
  });

  it.each([
    ["a fix that worked", {}, "Fixed successfully"],
    ["a repair that failed", { success: false, appliedFix: null, logs: "still broke" }, "Could not repair"],
  ])("writes the report itself, without the AI, when there is no room left after %s", async (_name, overrides, status) => {
    mockRunRepairWorkflow.mockResolvedValue(loopResult({ promptTokens: 9000, completionTokens: 900, ...overrides }));

    const result = await orchestrateAndFix({ cwd: projectDir, maxTokens: 10_000 });

    expect(mockInvoke).not.toHaveBeenCalled();
    expect(report()).toContain(status);
    expect(report()).toContain("The AI did not write this report");
    expect(report()).toContain("token budget of 10000");
    expect(report()).toContain("9900 of 10000 tokens used");
    expect(result.tokenBudget?.used).toBe(9900);
  });

  it("explains a run stopped by the budget", async () => {
    mockRunRepairWorkflow.mockResolvedValue(
      loopResult({
        success: false,
        appliedFix: null,
        logs: "still broke",
        budgetStop: "The token budget of 10000 does not leave enough for the next AI request.",
      })
    );

    const result = await orchestrateAndFix({ cwd: projectDir, maxTokens: 10_000, maxAttempts: 5 });

    expect(result.stoppedEarly).toBe("token-budget");
    expect(result.error).toContain("Stopped: The token budget of 10000");
    expect(result.error).toContain("--max-tokens");
    expect(result.error).not.toContain("Max attempts");
  });

  it("marks the total as including estimates when the loop or the report had to estimate", async () => {
    mockInvoke.mockResolvedValue(reply({ usage: undefined }));

    const result = await orchestrateAndFix({ cwd: projectDir, maxTokens: 20_000 });

    expect(result.tokenBudget?.estimated).toBe(true);
    expect(result.tokenBudget?.used).toBeGreaterThan(4000);
    expect(report()).toContain("includes estimates");
  });

  it("notes a report that was cut off, and writes its own when the reply came back empty", async () => {
    mockInvoke.mockResolvedValue(reply({ content: "# Half a repo", truncated: true }));
    await orchestrateAndFix({ cwd: projectDir, maxTokens: 10_000 });
    expect(report()).toContain("# Half a repo");
    expect(report()).toContain("cut off");

    mockInvoke.mockResolvedValue(reply({ content: "", truncated: true }));
    const result = await orchestrateAndFix({ cwd: projectDir, maxTokens: 10_000 });
    expect(report()).toContain("Fixed successfully");
    expect(report()).toContain("empty reply");
    expect(result.tokenBudget?.used).toBe(4700);
  });

  it("applies the budget to a dry run's one request", async () => {
    const allowed = await orchestrateAndFix({ cwd: projectDir, dryRun: true, maxTokens: 10_000 });
    expect(mockInvoke.mock.calls[0][1].maxTokens).toBeGreaterThan(0);
    expect(allowed.tokenBudget).toEqual({ limit: 10_000, used: 700, estimated: false });

    mockInvoke.mockClear();
    const refused = await orchestrateAndFix({ cwd: projectDir, dryRun: true, maxTokens: 100 });
    expect(mockInvoke).not.toHaveBeenCalled();
    expect(refused.tokenBudget).toEqual({ limit: 100, used: 0, estimated: false });
    expect(report()).toContain("token budget of 100");
    expect(report()).toContain("build broke");
  });
});

describe("rescue stopping early when attempts make no progress", () => {
  let projectDir: string;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "bugzero-patience-test-"));
    fs.writeFileSync(path.join(projectDir, "package.json"), JSON.stringify({ name: "demo" }));
    mockRunValidationPipeline.mockResolvedValue({ success: false, step: "lint", output: "error" });
    mockInvoke.mockResolvedValue({ content: "r", model: "m", usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
    mockRunRepairWorkflow.mockResolvedValue({ success: false, attempts: 2, logs: "x", appliedFix: null, declinedFixes: 0 });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(projectDir, { recursive: true, force: true });
  });

  const patienceGiven = () => mockRunRepairWorkflow.mock.calls[0][0].patience;

  it("uses a patience of 2 and tells the loop which step failed first", async () => {
    await orchestrateAndFix({ cwd: projectDir });

    expect(patienceGiven()).toBe(2);
    expect(mockRunRepairWorkflow).toHaveBeenCalledWith(expect.objectContaining({ initialStep: "lint" }));
  });

  it("takes patience from .bugzerorc", async () => {
    fs.writeFileSync(path.join(projectDir, ".bugzerorc"), JSON.stringify({ patience: 4 }));

    await orchestrateAndFix({ cwd: projectDir });

    expect(patienceGiven()).toBe(4);
  });

  it("lets the option beat .bugzerorc, and 0 turns it off", async () => {
    fs.writeFileSync(path.join(projectDir, ".bugzerorc"), JSON.stringify({ patience: 4 }));

    await orchestrateAndFix({ cwd: projectDir, patience: 0 });

    expect(patienceGiven()).toBe(0);
  });

  it("rejects a bad patience in .bugzerorc before running anything", async () => {
    fs.writeFileSync(path.join(projectDir, ".bugzerorc"), JSON.stringify({ patience: "soon" }));

    await expect(orchestrateAndFix({ cwd: projectDir })).rejects.toThrow("patience in .bugzerorc must be a whole number");
    expect(mockRunValidationPipeline).not.toHaveBeenCalled();
  });

  it("explains an early stop, instead of saying max attempts were reached", async () => {
    mockRunRepairWorkflow.mockResolvedValue({
      success: false,
      attempts: 2,
      logs: "x",
      appliedFix: null,
      declinedFixes: 0,
      stoppedForNoProgress: true,
    });

    const result = await orchestrateAndFix({ cwd: projectDir, maxAttempts: 5 });

    expect(result.stoppedEarly).toBe("no-progress");
    expect(result.attempts).toBe(2);
    expect(result.error).toContain("Stopped early: 2 attempts in a row made no progress");
    expect(result.error).toContain("--patience 0");
    expect(result.error).not.toContain("Max attempts");
  });

  it("re-runs only the failing tests by default, and .bugzerorc or the option can turn that off", async () => {
    await orchestrateAndFix({ cwd: projectDir });
    expect(mockRunRepairWorkflow.mock.calls[0][0].focusTests).toBe(true);

    fs.writeFileSync(path.join(projectDir, ".bugzerorc"), JSON.stringify({ focusTests: false }));
    await orchestrateAndFix({ cwd: projectDir });
    expect(mockRunRepairWorkflow.mock.calls[1][0].focusTests).toBe(false);

    await orchestrateAndFix({ cwd: projectDir, focusTests: true });
    expect(mockRunRepairWorkflow.mock.calls[2][0].focusTests).toBe(true);
  });

  it("rejects a bad focusTests in .bugzerorc before running anything", async () => {
    fs.writeFileSync(path.join(projectDir, ".bugzerorc"), JSON.stringify({ focusTests: "sometimes" }));

    await expect(orchestrateAndFix({ cwd: projectDir })).rejects.toThrow("focusTests in .bugzerorc must be true or false");
    expect(mockRunValidationPipeline).not.toHaveBeenCalled();
  });

  it("does not report an early stop when the run simply used all its attempts", async () => {
    const result = await orchestrateAndFix({ cwd: projectDir, maxAttempts: 2 });

    expect(result.stoppedEarly).toBeUndefined();
    expect(result.error).toBe("Max attempts (2) reached without a successful build.");
  });
});
