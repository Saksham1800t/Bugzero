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
    expect(result.matchStrategy).toBe("exact");
    expect(fs.readFileSync(filePath, "utf-8")).toBe("const x: number = 1;");

    const backupPath = filePath + ".opspilot.bak";
    expect(result.backupPath).toBe(backupPath);
    expect(fs.readFileSync(backupPath, "utf-8")).toBe("const x: number = 'oops';");
  });

  it("falls back to whitespace-normalized matching when only indentation/spacing differs", () => {
    const filePath = path.join(tmpDir, "file.ts");
    fs.writeFileSync(filePath, ["function add(a, b) {", "    return   a + b;", "}"].join("\n"), "utf-8");

    const result = applyPatch(
      filePath,
      ["function add(a, b) {", "return a + b;", "}"].join("\n"),
      ["function add(a, b) {", "    return a - b;", "}"].join("\n")
    );

    expect(result.success).toBe(true);
    expect(result.matchStrategy).toBe("whitespace");
    expect(fs.readFileSync(filePath, "utf-8")).toBe(
      ["function add(a, b) {", "    return a - b;", "}"].join("\n")
    );
  });

  it("falls back to similarity matching when the AI's snippet is a near-miss", () => {
    const filePath = path.join(tmpDir, "file.ts");
    fs.writeFileSync(filePath, `const message = "Hello, world!";`, "utf-8");

    // Missing the comma — not a whitespace-only difference.
    const result = applyPatch(filePath, `const message = "Hello world!";`, `const message = "Goodbye!";`);

    expect(result.success).toBe(true);
    expect(result.matchStrategy).toBe("similarity");
    expect(fs.readFileSync(filePath, "utf-8")).toBe(`const message = "Goodbye!";`);
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
    expect(result.error).toContain("fuzzy matching");
    expect(fs.readFileSync(filePath, "utf-8")).toBe("const x = 1;");
    expect(fs.existsSync(filePath + ".opspilot.bak")).toBe(false);
  });

  describe("line endings", () => {
    const counts = (text: string) => ({
      crlf: (text.match(/\r\n/g) ?? []).length,
      bareLf: (text.match(/(?<!\r)\n/g) ?? []).length,
    });
    const write = (name: string, content: string) => {
      const filePath = path.join(tmpDir, name);
      fs.writeFileSync(filePath, content, "utf-8");
      return filePath;
    };

    it("keeps a CRLF file pure CRLF when a whitespace-matched patch adds lines", () => {
      const filePath = write("a.ts", "function add(a, b) {\r\n    return a + b;\r\n}\r\n");

      const result = applyPatch(
        filePath,
        "function add(a, b) {\nreturn a + b;\n}",
        "function add(a, b) {\n  const sum = a - b;\n  return sum;\n}"
      );

      expect(result.matchStrategy).toBe("whitespace");
      const after = fs.readFileSync(filePath, "utf-8");
      expect(counts(after).bareLf).toBe(0);
      expect(after).toBe("function add(a, b) {\r\n  const sum = a - b;\r\n  return sum;\r\n}\r\n");
    });

    it("keeps a CRLF file pure CRLF when a similarity-matched patch is applied", () => {
      const filePath = write("a.ts", 'const greeting = "hello world";\r\nconst other = 1;\r\n');

      const result = applyPatch(
        filePath,
        'const greeting = "hello, world";',
        'const greeting = "hi";\nconst added = 2;'
      );

      expect(result.matchStrategy).toBe("similarity");
      expect(counts(fs.readFileSync(filePath, "utf-8")).bareLf).toBe(0);
    });

    it("keeps a CRLF file pure CRLF when an exact match is replaced with several lines", () => {
      const filePath = write("a.ts", "function add(a, b) {\r\n    return a + b;\r\n}\r\n");

      const result = applyPatch(filePath, "return a + b;", "const s = a + b;\n    return s;");

      expect(result.matchStrategy).toBe("exact");
      expect(fs.readFileSync(filePath, "utf-8")).toBe(
        "function add(a, b) {\r\n    const s = a + b;\r\n    return s;\r\n}\r\n"
      );
    });

    it("leaves an LF file with LF", () => {
      const filePath = write("a.ts", "function add(a, b) {\n    return a + b;\n}\n");

      applyPatch(filePath, "return a + b;", "const s = a + b;\n    return s;");

      expect(counts(fs.readFileSync(filePath, "utf-8"))).toEqual({ crlf: 0, bareLf: 4 });
    });

    it("does not change the line endings of the rest of a mixed file", () => {
      const original = "one\r\ntwo\nthree\r\nfour\nfive\r\n";
      const filePath = write("a.ts", original);

      applyPatch(filePath, "three", "THREE");

      expect(fs.readFileSync(filePath, "utf-8")).toBe(original.replace("three", "THREE"));
    });

    it("uses the ending of the lines it replaces in a mixed file", () => {
      const filePath = write("a.ts", "head\nalpha\r\nbeta\r\ntail\n");

      applyPatch(filePath, "alpha\r\nbeta", "alpha\ninserted\nbeta");

      expect(fs.readFileSync(filePath, "utf-8")).toBe("head\nalpha\r\ninserted\r\nbeta\r\ntail\n");
    });

    it("keeps CRLF in replacement text that already has it", () => {
      const filePath = write("a.ts", "a\r\nb\r\n");

      applyPatch(filePath, "a", "a1\r\na2");

      expect(fs.readFileSync(filePath, "utf-8")).toBe("a1\r\na2\r\nb\r\n");
    });
  });
});
