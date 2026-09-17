import axios from "axios";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OpenRouterProvider } from "./openrouter";

vi.mock("axios", () => ({
  default: {
    post: vi.fn(),
  },
}));

const mockPost = vi.mocked(axios.post);

describe("OpenRouterProvider", () => {
  const ORIGINAL_API_KEY = process.env.OPENROUTER_API_KEY;
  let tmpDir: string;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bugzero-provider-test-"));
    mockPost.mockReset();
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    consoleErrorSpy.mockRestore();
    if (ORIGINAL_API_KEY === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = ORIGINAL_API_KEY;
  });

  it("throws when OPENROUTER_API_KEY is not set", async () => {
    delete process.env.OPENROUTER_API_KEY;
    const provider = new OpenRouterProvider();

    await expect(provider.invoke("fix this", { cwd: tmpDir })).rejects.toThrow(
      "Missing OPENROUTER_API_KEY environment variable."
    );
    expect(mockPost).not.toHaveBeenCalled();
  });

  it("calls OpenRouter with the default model and returns the parsed result", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    mockPost.mockResolvedValueOnce({
      data: {
        choices: [{ message: { content: "fixed!" } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      },
    } as any);

    const provider = new OpenRouterProvider();
    const result = await provider.invoke("fix this", { cwd: tmpDir });

    expect(result).toEqual({
      content: "fixed!",
      model: "deepseek/deepseek-chat",
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    });

    expect(mockPost).toHaveBeenCalledWith(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        model: "deepseek/deepseek-chat",
        messages: [{ role: "user", content: "fix this" }],
      },
      {
        headers: {
          Authorization: "Bearer test-key",
          "Content-Type": "application/json",
        },
      }
    );
  });

  it("uses the model configured in .bugzerorc for the target cwd", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    fs.writeFileSync(path.join(tmpDir, ".bugzerorc"), JSON.stringify({ model: "openai/gpt-4o" }), "utf-8");
    mockPost.mockResolvedValueOnce({
      data: { choices: [{ message: { content: "ok" } }] },
    } as any);

    const provider = new OpenRouterProvider();
    const result = await provider.invoke("fix this", { cwd: tmpDir });

    expect(result.model).toBe("openai/gpt-4o");
    expect(mockPost).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ model: "openai/gpt-4o" }),
      expect.any(Object)
    );
  });

  it("throws a wrapped error when the response payload itself contains an error", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    mockPost.mockResolvedValueOnce({
      data: { error: { message: "model not found" } },
    } as any);

    const provider = new OpenRouterProvider();
    await expect(provider.invoke("fix this", { cwd: tmpDir })).rejects.toThrow(
      "OpenRouter API failed: model not found"
    );
  });

  it("prefers the response error message when the request itself fails", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    mockPost.mockRejectedValueOnce({
      message: "Request failed with status code 401",
      response: { status: 401, data: { error: { message: "Invalid API key" } } },
    });

    const provider = new OpenRouterProvider();
    await expect(provider.invoke("fix this", { cwd: tmpDir })).rejects.toThrow(
      "OpenRouter API failed: Invalid API key"
    );
  });

  it("falls back to the raw error message when there is no response payload", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    mockPost.mockRejectedValueOnce(new Error("Network timeout"));

    const provider = new OpenRouterProvider();
    await expect(provider.invoke("fix this", { cwd: tmpDir })).rejects.toThrow(
      "OpenRouter API failed: Network timeout"
    );
  });
});
