import { describe, expect, it } from "vitest";
import {
  DEFAULT_MAX_ATTEMPTS,
  DEFAULT_PATIENCE,
  resolveFocusTests,
  resolveMaxAttempts,
  resolvePatience,
  resolveTimeoutMs,
} from "./options";

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

describe("resolvePatience", () => {
  it("defaults to 2 when nothing is set", () => {
    expect(DEFAULT_PATIENCE).toBe(2);
    expect(resolvePatience(undefined, undefined)).toBe(2);
  });

  it("uses the .bugzerorc value when there is no flag", () => {
    expect(resolvePatience(undefined, 4)).toBe(4);
  });

  it("lets the flag beat .bugzerorc", () => {
    expect(resolvePatience(1, 4)).toBe(1);
  });

  it("accepts 0, which turns it off", () => {
    expect(resolvePatience(0, undefined)).toBe(0);
    expect(resolvePatience(undefined, 0)).toBe(0);
  });

  it.each([
    ["a negative number", -1],
    ["a fraction", 1.5],
    ["NaN (e.g. from a non-numeric flag)", NaN],
    ["Infinity", Infinity],
  ])("rejects %s from the flag, naming the flag", (_label, value) => {
    expect(() => resolvePatience(value, undefined)).toThrow("--patience must be a whole number of 0 or more");
  });

  it.each([
    ["text", "two"],
    ["a negative number", -3],
    ["a fraction", 2.5],
    ["a list", [2]],
    ["null", null],
  ])("rejects %s from .bugzerorc, naming the file", (_label, value) => {
    expect(() => resolvePatience(undefined, value)).toThrow("patience in .bugzerorc must be a whole number of 0 or more");
  });

  it("does not let a bad .bugzerorc value matter when the flag is valid", () => {
    expect(resolvePatience(3, "nonsense")).toBe(3);
  });
});

describe("resolveFocusTests", () => {
  it("is on when nothing is set", () => {
    expect(resolveFocusTests(undefined, undefined)).toBe(true);
  });

  it("uses the .bugzerorc value when there is no flag", () => {
    expect(resolveFocusTests(undefined, false)).toBe(false);
    expect(resolveFocusTests(undefined, true)).toBe(true);
  });

  it("lets the flag beat .bugzerorc", () => {
    expect(resolveFocusTests(false, true)).toBe(false);
    expect(resolveFocusTests(true, false)).toBe(true);
  });

  it.each([
    ["text", "no"],
    ["a number", 0],
    ["null", null],
    ["a list", [false]],
  ])("rejects %s in .bugzerorc, naming the file", (_label, value) => {
    expect(() => resolveFocusTests(undefined, value)).toThrow("focusTests in .bugzerorc must be true or false");
  });

  it("does not let a bad .bugzerorc value matter when the flag is given", () => {
    expect(resolveFocusTests(false, "nonsense")).toBe(false);
  });
});
