import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockInvoke, mockRunValidationPipeline, mockRunRepairWorkflow } = vi.hoisted(() => ({
  mockInvoke: vi.fn(),
  mockRunValidationPipeline: vi.fn(),
  mockRunRepairWorkflow: vi.fn(),
}));

vi.mock("@opspilot/ai-provider", () => ({
  OpenRouterProvider: class {
    invoke = mockInvoke;
  },
}));

vi.mock("@opspilot/analyzers", () => ({
  runBuild: vi.fn(),
  runLint: vi.fn(),
  runTests: vi.fn(),
  parseErrors: () => [],
  runValidationPipeline: mockRunValidationPipeline,
}));

vi.mock("@opspilot/agents", () => ({
  runRepairWorkflow: mockRunRepairWorkflow,
}));

import { orchestrateAndFix, REPORT_FILENAME } from "./orchestrator";

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
