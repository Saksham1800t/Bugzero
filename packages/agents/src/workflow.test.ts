import path from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockInvoke, mockApplyPatch, mockRunValidationPipeline } = vi.hoisted(() => ({
  mockInvoke: vi.fn(),
  mockApplyPatch: vi.fn(),
  mockRunValidationPipeline: vi.fn(),
}));

vi.mock("@opspilot/ai-provider", () => ({
  OpenRouterProvider: class {
    invoke = mockInvoke;
  },
}));

vi.mock("@opspilot/patcher", () => ({
  applyPatch: mockApplyPatch,
}));

vi.mock("@opspilot/analyzers", () => ({
  runValidationPipeline: mockRunValidationPipeline,
}));

import { workflow } from "./workflow";

const validFix = {
  rootCause: "Missing semicolon",
  filePath: "src/index.ts",
  search: "const x = 1",
  replace: "const x = 1;",
  explanation: "Added missing semicolon",
};

function aiResponse(content: string, promptTokens = 10, completionTokens = 5, model = "deepseek/deepseek-chat") {
  return {
    content,
    model,
    usage: { prompt_tokens: promptTokens, completion_tokens: completionTokens },
  };
}

describe("bugzero repair workflow", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("fixes the build on the first attempt", async () => {
    mockInvoke.mockResolvedValueOnce(aiResponse(JSON.stringify(validFix), 100, 50));
    mockApplyPatch.mockReturnValueOnce({ success: true, backupPath: "backup" });
    mockRunValidationPipeline.mockResolvedValueOnce({ success: true, step: "none", output: "" });

    const finalState = await workflow.invoke({
      cwd: "/project",
      logs: "original error logs",
      maxAttempts: 3,
      attempts: 0,
      success: false,
    });

    expect(finalState.success).toBe(true);
    expect(finalState.attempts).toBe(1);
    expect(finalState.fixSuggestion).toMatchObject({ filePath: "src/index.ts" });
    expect(finalState.modelUsed).toBe("deepseek/deepseek-chat");
    expect(finalState.promptTokens).toBe(100);
    expect(finalState.completionTokens).toBe(50);

    expect(mockApplyPatch).toHaveBeenCalledWith(
      path.resolve("/project", "src/index.ts"),
      "const x = 1",
      "const x = 1;"
    );
    expect(mockRunValidationPipeline).toHaveBeenCalledWith("/project");
  });

  it("gives up without patching when the AI response is not valid JSON", async () => {
    mockInvoke.mockResolvedValueOnce(aiResponse("I cannot help with that.", 20, 10));
    mockRunValidationPipeline.mockResolvedValueOnce({ success: false, step: "build", output: "still failing" });

    const finalState = await workflow.invoke({
      cwd: "/project",
      logs: "original error logs",
      maxAttempts: 1,
      attempts: 0,
      success: false,
    });

    expect(finalState.success).toBe(false);
    expect(finalState.attempts).toBe(1);
    expect(finalState.fixSuggestion).toBeNull();
    expect(mockApplyPatch).not.toHaveBeenCalled();
    expect(mockRunValidationPipeline).toHaveBeenCalledTimes(1);
    expect(finalState.logs).toBe("still failing");
  });

  it("skips re-validation and records a warning when the patch fails to apply", async () => {
    mockInvoke.mockResolvedValueOnce(aiResponse(JSON.stringify(validFix)));
    mockApplyPatch.mockReturnValueOnce({
      success: false,
      error: "Search string not found in index.ts.",
    });

    const finalState = await workflow.invoke({
      cwd: "/project",
      logs: "original error logs",
      maxAttempts: 1,
      attempts: 0,
      success: false,
    });

    expect(finalState.success).toBe(false);
    expect(finalState.attempts).toBe(1);
    expect(finalState.logs).toContain("[BugZero System Warning]");
    expect(finalState.logs).toContain("Search string not found in index.ts.");
    expect(mockRunValidationPipeline).not.toHaveBeenCalled();
  });

  it("retries after a failed verification and succeeds on the second attempt", async () => {
    mockInvoke
      .mockResolvedValueOnce(aiResponse(JSON.stringify(validFix), 10, 5))
      .mockResolvedValueOnce(aiResponse(JSON.stringify(validFix), 8, 4));
    mockApplyPatch.mockReturnValue({ success: true, backupPath: "backup" });
    mockRunValidationPipeline
      .mockResolvedValueOnce({ success: false, step: "build", output: "still broken" })
      .mockResolvedValueOnce({ success: true, step: "none", output: "" });

    const finalState = await workflow.invoke({
      cwd: "/project",
      logs: "original error logs",
      maxAttempts: 2,
      attempts: 0,
      success: false,
    });

    expect(finalState.success).toBe(true);
    expect(finalState.attempts).toBe(2);
    expect(mockInvoke).toHaveBeenCalledTimes(2);
    expect(mockApplyPatch).toHaveBeenCalledTimes(2);
    expect(mockRunValidationPipeline).toHaveBeenCalledTimes(2);
    expect(finalState.promptTokens).toBe(18);
    expect(finalState.completionTokens).toBe(9);
  });

  it("stops after maxAttempts without ever succeeding", async () => {
    mockInvoke.mockResolvedValue(aiResponse(JSON.stringify(validFix)));
    mockApplyPatch.mockReturnValue({ success: true, backupPath: "backup" });
    mockRunValidationPipeline.mockResolvedValue({ success: false, step: "build", output: "still broken" });

    const finalState = await workflow.invoke({
      cwd: "/project",
      logs: "original error logs",
      maxAttempts: 2,
      attempts: 0,
      success: false,
    });

    expect(finalState.success).toBe(false);
    expect(finalState.attempts).toBe(2);
    expect(mockInvoke).toHaveBeenCalledTimes(2);
  });
});
