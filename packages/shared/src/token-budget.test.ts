import { describe, expect, it } from "vitest";
import { checkBudget, countCallTokens, estimateTokens, MAX_REPLY_TOKENS, MIN_REPLY_TOKENS } from "./token-budget";

/** A prompt that is estimated at exactly `tokens` tokens. */
const promptOf = (tokens: number) => "x".repeat(tokens * 4);

describe("estimateTokens", () => {
  it("counts about four characters per token, rounding up", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcde")).toBe(2);
    expect(estimateTokens("x".repeat(4000))).toBe(1000);
  });
});

describe("checkBudget", () => {
  it("allows everything, and caps nothing, when there is no budget", () => {
    expect(checkBudget(undefined, 5_000_000, promptOf(1_000_000))).toEqual({ allowed: true, maxReplyTokens: undefined });
  });

  it("caps the reply to what is left after the prompt", () => {
    expect(checkBudget(5000, 1000, promptOf(1500))).toEqual({ allowed: true, maxReplyTokens: 2500 });
  });

  it("never asks for a longer reply than the ceiling, however large the budget", () => {
    expect(MAX_REPLY_TOKENS).toBe(8192);
    expect(checkBudget(1_000_000, 0, promptOf(100))).toEqual({ allowed: true, maxReplyTokens: 8192 });
  });

  it("allows a call that leaves exactly the smallest useful reply", () => {
    expect(MIN_REPLY_TOKENS).toBe(500);
    expect(checkBudget(1500, 0, promptOf(1000))).toEqual({ allowed: true, maxReplyTokens: 500 });
  });

  it("refuses a call that would leave less than that, and says why", () => {
    const check = checkBudget(1499, 0, promptOf(1000));

    expect(check.allowed).toBe(false);
    if (check.allowed) return;
    expect(check.reason).toContain("token budget of 1499");
    expect(check.reason).toContain("about 1000 tokens");
    expect(check.reason).toContain("at least 500");
    expect(check.reason).toContain("0 already used");
  });

  it("refuses once the budget is used up or passed", () => {
    expect(checkBudget(2000, 2000, "hi").allowed).toBe(false);
    expect(checkBudget(2000, 9000, "hi").allowed).toBe(false);
  });
});

describe("countCallTokens", () => {
  const usage = { prompt_tokens: 120, completion_tokens: 30, total_tokens: 150 };

  it("uses the numbers the model reports", () => {
    expect(countCallTokens(1000, "prompt", { content: "reply", usage })).toEqual({
      promptTokens: 120,
      completionTokens: 30,
      estimated: false,
    });
  });

  it("estimates when a budget is set and the model reports nothing", () => {
    expect(countCallTokens(1000, promptOf(100), { content: promptOf(20) })).toEqual({
      promptTokens: 100,
      completionTokens: 20,
      estimated: true,
    });
  });

  it("estimates only the missing number", () => {
    const partial = { prompt_tokens: 120 } as typeof usage;

    expect(countCallTokens(1000, promptOf(100), { content: promptOf(20), usage: partial })).toEqual({
      promptTokens: 120,
      completionTokens: 20,
      estimated: true,
    });
  });

  it("does not trust numbers that make no sense", () => {
    const bad = { prompt_tokens: -5, completion_tokens: Number.NaN, total_tokens: 0 };

    expect(countCallTokens(1000, promptOf(100), { content: promptOf(20), usage: bad })).toEqual({
      promptTokens: 100,
      completionTokens: 20,
      estimated: true,
    });
  });

  it("does not estimate without a budget: unreported tokens count as nothing, as before", () => {
    expect(countCallTokens(undefined, promptOf(100), { content: "reply" })).toEqual({
      promptTokens: 0,
      completionTokens: 0,
      estimated: false,
    });
  });
});
