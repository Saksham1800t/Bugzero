import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyPatch } from "./apply-patch";

describe("applyPatch", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bugzero-patcher-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("replaces the search string and backs up the original file", () => {
    const filePath = path.join(tmpDir, "file.ts");
    fs.writeFileSync(filePath, "const x: number = 'oops';", "utf-8");

    const result = applyPatch(filePath, "const x: number = 'oops';", "const x: number = 1;");

    expect(result.success).toBe(true);
    expect(fs.readFileSync(filePath, "utf-8")).toBe("const x: number = 1;");

    const backupPath = filePath + ".opspilot.bak";
    expect(result.backupPath).toBe(backupPath);
    expect(fs.readFileSync(backupPath, "utf-8")).toBe("const x: number = 'oops';");
  });

  it("only replaces the first occurrence of the search string", () => {
    const filePath = path.join(tmpDir, "file.ts");
    fs.writeFileSync(filePath, "dup(); dup();", "utf-8");

    const result = applyPatch(filePath, "dup();", "fixed();");

    expect(result.success).toBe(true);
    expect(fs.readFileSync(filePath, "utf-8")).toBe("fixed(); dup();");
  });

  it("fails when the target file does not exist", () => {
    const filePath = path.join(tmpDir, "missing.ts");

    const result = applyPatch(filePath, "foo", "bar");

    expect(result.success).toBe(false);
    expect(result.error).toContain("File not found");
    expect(result.backupPath).toBeUndefined();
  });

  it("fails without touching the file when the search string is not found", () => {
    const filePath = path.join(tmpDir, "file.ts");
    fs.writeFileSync(filePath, "const x = 1;", "utf-8");

    const result = applyPatch(filePath, "const y = 2;", "const y = 3;");

    expect(result.success).toBe(false);
    expect(result.error).toContain("Search string not found");
    expect(fs.readFileSync(filePath, "utf-8")).toBe("const x = 1;");
    expect(fs.existsSync(filePath + ".opspilot.bak")).toBe(false);
  });
});
