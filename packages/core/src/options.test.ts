import { describe, expect, it } from "vitest";
import { DEFAULT_MAX_ATTEMPTS, resolveMaxAttempts, resolveTimeoutMs } from "./options";

describe("resolveTimeoutMs", () => {
  it("means no timeout when no value is given", () => {
    expect(resolveTimeoutMs(undefined)).toBeUndefined();
  });

  it.each([
    [1, 1000],
    [30, 30_000],
    [2.5, 2500],
    [0.5, 500],
  ])("converts %d seconds to %d ms", (seconds, ms) => {
    expect(resolveTimeoutMs(seconds)).toBe(ms);
  });

  it.each([
    ["zero", 0],
    ["a negative number", -5],
    ["NaN (e.g. from a non-numeric flag)", NaN],
    ["Infinity", Infinity],
  ])("rejects %s", (_label, value) => {
    expect(() => resolveTimeoutMs(value)).toThrow("--timeout must be a positive number of seconds");
  });
});

describe("resolveMaxAttempts", () => {
  it("defaults to 3 when no value is given", () => {
    expect(DEFAULT_MAX_ATTEMPTS).toBe(3);
    expect(resolveMaxAttempts(undefined)).toBe(3);
  });

  it.each([1, 3, 10, 50])("accepts the whole number %i", (value) => {
    expect(resolveMaxAttempts(value)).toBe(value);
  });

  it.each([
    ["zero", 0],
    ["a negative number", -2],
    ["a fraction", 2.5],
    ["NaN (e.g. from a non-numeric flag)", NaN],
    ["Infinity", Infinity],
  ])("rejects %s", (_label, value) => {
    expect(() => resolveMaxAttempts(value)).toThrow("--max-attempts must be a whole number of 1 or more");
  });
});
