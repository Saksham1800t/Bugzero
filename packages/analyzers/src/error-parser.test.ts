import { describe, expect, it } from "vitest";
import { parseErrors } from "./error-parser";

describe("parseErrors", () => {
  it("parses TypeScript compiler errors", () => {
    const output = `src/index.ts(10,5): error TS2345: Argument of type 'string' is not assignable to parameter of type 'number'.`;
    const errors = parseErrors(output);

    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({
      type: "typescript",
      file: "src/index.ts",
      line: 10,
      column: 5,
      message: "Argument of type 'string' is not assignable to parameter of type 'number'.",
    });
  });

  it("parses multiple TypeScript errors from the same output", () => {
    const output = [
      `src/a.ts(1,1): error TS2304: Cannot find name 'foo'.`,
      `src/b.ts(2,2): error TS2322: Type 'number' is not assignable to type 'string'.`,
    ].join("\n");

    const errors = parseErrors(output);
    expect(errors).toHaveLength(2);
    expect(errors.map((e) => e.file)).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("parses ESLint errors when there is no TypeScript error", () => {
    const output = `
/project/src/index.ts
  10:5  error  'foo' is not defined  no-undef
`;
    const errors = parseErrors(output);

    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({
      type: "eslint",
      line: 10,
      column: 5,
    });
    expect(errors[0].message).toContain("'foo' is not defined");
  });

  it("parses Jest failures when there is no TypeScript or ESLint error", () => {
    const output = `
FAIL src/sum.test.ts
● sum › adds two numbers
`;
    const errors = parseErrors(output);

    expect(errors).toHaveLength(1);
    expect(errors[0].type).toBe("jest");
    expect(errors[0].file).toBe("src/sum.test.ts");
    expect(errors[0].message).toContain("sum › adds two numbers");
  });

  it("prefers TypeScript errors over ESLint/Jest patterns present in the same output", () => {
    const output = [
      `src/index.ts(1,1): error TS2304: Cannot find name 'foo'.`,
      `  2:2  error  'bar' is not defined  no-undef`,
    ].join("\n");

    const errors = parseErrors(output);
    expect(errors).toHaveLength(1);
    expect(errors[0].type).toBe("typescript");
  });

  it("falls back to an 'unknown' error for unrecognized non-empty output", () => {
    const output = "Something went wrong in a way we don't recognize.";
    const errors = parseErrors(output);

    expect(errors).toHaveLength(1);
    expect(errors[0].type).toBe("unknown");
    expect(errors[0].message).toBe(output);
    expect(errors[0].raw).toBe(output);
  });

  it("truncates unknown error messages to 500 characters", () => {
    const output = "x".repeat(1000);
    const errors = parseErrors(output);

    expect(errors[0].type).toBe("unknown");
    expect(errors[0].message).toHaveLength(500);
    expect(errors[0].raw).toHaveLength(1000);
  });

  it("returns an empty array for empty/whitespace-only output", () => {
    expect(parseErrors("")).toEqual([]);
    expect(parseErrors("   \n  ")).toEqual([]);
  });
});
