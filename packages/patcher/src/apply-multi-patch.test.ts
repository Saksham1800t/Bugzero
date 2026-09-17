import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyPatches } from "./apply-multi-patch";

describe("applyPatches", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bugzero-multipatch-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function write(relPath: string, content: string) {
    fs.writeFileSync(path.join(tmpDir, relPath), content, "utf-8");
  }

  function read(relPath: string) {
    return fs.readFileSync(path.join(tmpDir, relPath), "utf-8");
  }

  it("applies patches across multiple files", () => {
    write("a.ts", "export const a = 1;");
    write("b.ts", "export const b = 2;");

    const result = applyPatches(tmpDir, [
      { filePath: "a.ts", search: "export const a = 1;", replace: "export const a = 100;" },
      { filePath: "b.ts", search: "export const b = 2;", replace: "export const b = 200;" },
    ]);

    expect(result.success).toBe(true);
    expect(result.applied).toHaveLength(2);
    expect(result.applied.map((a) => a.filePath)).toEqual(["a.ts", "b.ts"]);
    expect(read("a.ts")).toBe("export const a = 100;");
    expect(read("b.ts")).toBe("export const b = 200;");
  });

  it("rolls back every already-applied file when a later patch fails", () => {
    write("a.ts", "export const a = 1;");
    write("b.ts", "export const b = 2;");

    const result = applyPatches(tmpDir, [
      { filePath: "a.ts", search: "export const a = 1;", replace: "export const a = 100;" },
      { filePath: "b.ts", search: "this text does not exist", replace: "irrelevant" },
    ]);

    expect(result.success).toBe(false);
    expect(result.error).toContain(`Failed to patch "b.ts"`);
    expect(result.applied).toEqual([]);

    // a.ts must be restored to its original content, not left half-patched.
    expect(read("a.ts")).toBe("export const a = 1;");
    expect(read("b.ts")).toBe("export const b = 2;");
    expect(fs.existsSync(path.join(tmpDir, "a.ts.opspilot.bak"))).toBe(false);
  });

  it("composes multiple sequential patches to the same file", () => {
    write("a.ts", "let x = 1;\nlet y = 2;");

    const result = applyPatches(tmpDir, [
      { filePath: "a.ts", search: "let x = 1;", replace: "let x = 10;" },
      { filePath: "a.ts", search: "let y = 2;", replace: "let y = 20;" },
    ]);

    expect(result.success).toBe(true);
    expect(read("a.ts")).toBe("let x = 10;\nlet y = 20;");
  });

  it("rolls back to the true original when a later patch to the same file fails", () => {
    write("a.ts", "let x = 1;\nlet y = 2;");

    const result = applyPatches(tmpDir, [
      { filePath: "a.ts", search: "let x = 1;", replace: "let x = 10;" },
      { filePath: "a.ts", search: "this does not exist in the file", replace: "irrelevant" },
    ]);

    expect(result.success).toBe(false);
    // Must be the ORIGINAL content, not the state after the first (successful) patch.
    expect(read("a.ts")).toBe("let x = 1;\nlet y = 2;");
  });

  it("fails and rolls back when a later patch targets a nonexistent file", () => {
    write("a.ts", "export const a = 1;");

    const result = applyPatches(tmpDir, [
      { filePath: "a.ts", search: "export const a = 1;", replace: "export const a = 100;" },
      { filePath: "missing.ts", search: "foo", replace: "bar" },
    ]);

    expect(result.success).toBe(false);
    expect(result.error).toContain("File not found");
    expect(read("a.ts")).toBe("export const a = 1;");
  });

  it("fails cleanly when given an empty patch list", () => {
    const result = applyPatches(tmpDir, []);

    expect(result.success).toBe(false);
    expect(result.error).toContain("No patches");
    expect(result.applied).toEqual([]);
  });

  it("reports the match strategy used for each applied file", () => {
    write("a.ts", ["function add(a, b) {", "    return   a + b;", "}"].join("\n"));

    const result = applyPatches(tmpDir, [
      {
        filePath: "a.ts",
        search: ["function add(a, b) {", "return a + b;", "}"].join("\n"),
        replace: ["function add(a, b) {", "    return a - b;", "}"].join("\n"),
      },
    ]);

    expect(result.success).toBe(true);
    expect(result.applied[0].matchStrategy).toBe("whitespace");
  });
});
