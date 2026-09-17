import path from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockInvoke, mockApplyPatches, mockRunValidationPipeline } = vi.hoisted(() => ({
  mockInvoke: vi.fn(),
  mockApplyPatches: vi.fn(),
  mockRunValidationPipeline: vi.fn(),
}));

vi.mock("@opspilot/ai-provider", () => ({
  OpenRouterProvider: class {
    invoke = mockInvoke;
  },
}));

vi.mock("@opspilot/patcher", () => ({
  applyPatches: mockApplyPatches,
}));

vi.mock("@opspilot/analyzers", () => ({
  runValidationPipeline: mockRunValidationPipeline,
}));

import { workflow } from "./workflow";

const validFix = {
  rootCause: "Missing semicolon",
  explanation: "Added missing semicolon",
  patches: [{ filePath: "src/index.ts", search: "const x = 1", replace: "const x = 1;" }],
};

const multiFileFix = {
  rootCause: "Renamed export not updated at its call site",
  explanation: "Renamed getUser to fetchUser and updated the only caller",
  patches: [
    { filePath: "src/user.ts", search: "export function getUser()", replace: "export function fetchUser()" },
    { filePath: "src/index.ts", search: "getUser()", replace: "fetchUser()" },
  ],
};

function aiResponse(content: string, promptTokens = 10, completionTokens = 5, model = "deepseek/deepseek-chat") {
  return {
    content,
    model,
    usage: { prompt_tokens: promptTokens, completion_tokens: completionTokens },
  };
}

function appliedPatch(filePath: string, cwd = "/project") {
  return {
    filePath,
    absolutePath: path.resolve(cwd, filePath),
    backupPath: `${filePath}.opspilot.bak`,
    matchStrategy: "exact" as const,
  };
}

describe("bugzero repair workflow", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("fixes the build on the first attempt", async () => {
    mockInvoke.mockResolvedValueOnce(aiResponse(JSON.stringify(validFix), 100, 50));
    mockApplyPatches.mockReturnValueOnce({ success: true, applied: [appliedPatch("src/index.ts")] });
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
    expect(finalState.fixSuggestion).toMatchObject({ patches: [{ filePath: "src/index.ts" }] });
    expect(finalState.modelUsed).toBe("deepseek/deepseek-chat");
    expect(finalState.promptTokens).toBe(100);
    expect(finalState.completionTokens).toBe(50);

    expect(mockApplyPatches).toHaveBeenCalledWith("/project", validFix.patches);
    expect(mockRunValidationPipeline).toHaveBeenCalledWith("/project");
  });

  it("applies patches to multiple files atomically in a single attempt", async () => {
    mockInvoke.mockResolvedValueOnce(aiResponse(JSON.stringify(multiFileFix)));
    mockApplyPatches.mockReturnValueOnce({
      success: true,
      applied: [appliedPatch("src/user.ts"), appliedPatch("src/index.ts")],
    });
    mockRunValidationPipeline.mockResolvedValueOnce({ success: true, step: "none", output: "" });

    const finalState = await workflow.invoke({
      cwd: "/project",
      logs: "original error logs",
      maxAttempts: 1,
      attempts: 0,
      success: false,
    });

    expect(finalState.success).toBe(true);
    expect(finalState.fixSuggestion?.patches).toHaveLength(2);
    expect(mockApplyPatches).toHaveBeenCalledWith("/project", multiFileFix.patches);
    expect(mockApplyPatches).toHaveBeenCalledTimes(1);
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
    expect(mockApplyPatches).not.toHaveBeenCalled();
    expect(mockRunValidationPipeline).toHaveBeenCalledTimes(1);
    expect(finalState.logs).toBe("still failing");
  });

  it("treats a response with an empty patches array as no fix suggestion", async () => {
    mockInvoke.mockResolvedValueOnce(
      aiResponse(JSON.stringify({ rootCause: "unsure", explanation: "no changes needed", patches: [] }))
    );
    mockRunValidationPipeline.mockResolvedValueOnce({ success: false, step: "build", output: "still failing" });

    const finalState = await workflow.invoke({
      cwd: "/project",
      logs: "original error logs",
      maxAttempts: 1,
      attempts: 0,
      success: false,
    });

    expect(finalState.fixSuggestion).toBeNull();
    expect(mockApplyPatches).not.toHaveBeenCalled();
  });

  it("rolls the whole attempt back to a warning when patching fails", async () => {
    mockInvoke.mockResolvedValueOnce(aiResponse(JSON.stringify(validFix)));
    mockApplyPatches.mockReturnValueOnce({
      success: false,
      error: `Failed to patch "src/index.ts": Search string not found in index.ts.`,
      applied: [],
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
    mockApplyPatches.mockReturnValue({ success: true, applied: [appliedPatch("src/index.ts")] });
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
    expect(mockApplyPatches).toHaveBeenCalledTimes(2);
    expect(mockRunValidationPipeline).toHaveBeenCalledTimes(2);
    expect(finalState.promptTokens).toBe(18);
    expect(finalState.completionTokens).toBe(9);
  });

  it("stops after maxAttempts without ever succeeding", async () => {
    mockInvoke.mockResolvedValue(aiResponse(JSON.stringify(validFix)));
    mockApplyPatches.mockReturnValue({ success: true, applied: [appliedPatch("src/index.ts")] });
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
