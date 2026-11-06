import { describe, expect, it } from "vitest";
import { getErrorHints } from "./error-hints";

const model = "deepseek/deepseek-chat";
const text = (ctx: { status?: number; message: string }) => getErrorHints({ ...ctx, model }).join("\n");

describe("getErrorHints", () => {
  it("points a 401 at the API key", () => {
    expect(text({ status: 401, message: "No auth credentials found" })).toContain("OPENROUTER_API_KEY");
  });

  it("treats 401 as an auth problem even when the message mentions credits or tokens", () => {
    const hint = text({ status: 401, message: "Invalid token or insufficient credits" });
    expect(hint).toContain("OPENROUTER_API_KEY");
    expect(hint).not.toContain("credit balance");
  });

  describe("insufficient credits", () => {
    it.each([
      ["a 402 status", { status: 402, message: "Payment Required" }],
      ["an 'insufficient credits' message with no status", { message: "Insufficient credits. Add more using the settings page." }],
      ["OpenRouter's token_limit_exceeded code (a credit-based cap)", { status: 400, message: "token_limit_exceeded" }],
    ])("is recognized from %s", (_label, ctx) => {
      const hint = text(ctx);
      expect(hint).toContain("credit balance is too low");
      expect(hint).toContain("https://openrouter.ai/settings/credits");
      expect(hint).toContain("bugzero vibe");
    });

    it("no longer recommends specific free models, which have all been retired", () => {
      expect(text({ status: 402, message: "Insufficient credits" })).not.toMatch(/:free/);
    });
  });

  it("describes a 429 as rate limiting, not a credit problem", () => {
    const hint = text({ status: 429, message: "Rate limit exceeded" });
    expect(hint).toContain("rate limiting");
    expect(hint).not.toContain("credit balance is too low");
  });

  describe("context length", () => {
    it.each([
      "This model's maximum context length is 8192 tokens. However, you requested 12000 tokens.",
      "context_length_exceeded",
      "string_too_long",
      "Input is too long for the model's context window",
    ])("is recognized from %j and is not blamed on credits", (message) => {
      const hint = text({ status: 400, message });
      expect(hint).toContain(`context window of "${model}"`);
      expect(hint).not.toContain("credit");
    });
  });

  describe("model not found", () => {
    it.each([
      ["a 404 status", { status: 404, message: "Not Found" }],
      ["an 'is not a valid model' message", { status: 400, message: "foo/bar is not a valid model ID" }],
      ["a 'no endpoints found' message", { message: "No endpoints found for foo/bar." }],
    ])("is recognized from %s and names the model", (_label, ctx) => {
      const hint = text(ctx);
      expect(hint).toContain(`"${model}"`);
      expect(hint).toContain("bugzero vibe");
    });
  });

  describe("does not over-match", () => {
    it.each([
      "Network timeout",
      "Unexpected token < in JSON at position 0",
      "Invalid token format",
      "OpenRouter API returned an empty token list",
    ])("gives no hint for %j", (message) => {
      expect(getErrorHints({ message, model })).toEqual([]);
    });
  });
});
