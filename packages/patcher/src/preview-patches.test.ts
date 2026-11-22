import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyPatches } from "./apply-multi-patch";
import { previewPatches } from "./preview-patches";

describe("previewPatches", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "bugzero-preview-test-"));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const write = (rel: string, content: string) => {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, "utf-8");
  };
  const read = (rel: string) => fs.readFileSync(path.join(dir, rel), "utf-8");

  it("returns the before and after text of each file without touching anything", () => {
    write("a.ts", "export const a = 1;\n");
    write("b.ts", "export const b = 2;\n");

    const result = previewPatches(dir, [
      { filePath: "a.ts", search: "= 1", replace: "= 100" },
      { filePath: "b.ts", search: "= 2", replace: "= 200" },
    ]);

    expect(result).toEqual({
      success: true,
      changes: [
        { filePath: "a.ts", before: "export const a = 1;\n", after: "export const a = 100;\n" },
        { filePath: "b.ts", before: "export const b = 2;\n", after: "export const b = 200;\n" },
      ],
    });
    expect(read("a.ts")).toBe("export const a = 1;\n");
    expect(read("b.ts")).toBe("export const b = 2;\n");
    expect(fs.existsSync(path.join(dir, "a.ts.opspilot.bak"))).toBe(false);
  });

  it("combines several patches to one file into a single change", () => {
    write("a.ts", "let x = 1;\nlet y = 2;\n");

    const result = previewPatches(dir, [
      { filePath: "a.ts", search: "let x = 1;", replace: "let x = 10;" },
      { filePath: "a.ts", search: "let y = 2;", replace: "let y = 20;" },
    ]);

    expect(result).toEqual({
      success: true,
      changes: [{ filePath: "a.ts", before: "let x = 1;\nlet y = 2;\n", after: "let x = 10;\nlet y = 20;\n" }],
    });
  });

  describe("shows exactly what applying the patches would write", () => {
    const scenarios: { name: string; content: string; search: string; replace: string }[] = [
      { name: "an exact match", content: "const a = 1;\nconst b = 2;\n", search: "const b = 2;", replace: "const b = 3;" },
      {
        name: "a whitespace-normalized match",
        content: "function f() {\n    return 1;\n}\n",
        search: "function f() {\nreturn 1;\n}",
        replace: "function f() {\n  return 2;\n}",
      },
      {
        name: "a similarity match",
        content: 'const greeting = "hello world";\nconst other = 1;\n',
        search: 'const greeting = "hello, world";',
        replace: 'const greeting = "hi";',
      },
      {
        name: "a CRLF file given LF replacement text",
        content: "function f() {\r\n    return 1;\r\n}\r\n",
        search: "return 1;",
        replace: "const x = 1;\n    return x;",
      },
    ];

    it.each(scenarios)("for $name", ({ content, search, replace }) => {
      write("f.ts", content);
      const patches = [{ filePath: "f.ts", search, replace }];

      const preview = previewPatches(dir, patches);
      const applied = applyPatches(dir, patches);

      expect(applied.success).toBe(true);
      expect(preview.success).toBe(true);
      if (preview.success) expect(preview.changes[0].after).toBe(read("f.ts"));
    });
  });

  describe("fails exactly where applying would fail", () => {
    it("when a search text is not in the file, with the same message", () => {
      write("a.ts", "export const a = 1;\n");
      const patches = [{ filePath: "a.ts", search: "this is not in the file", replace: "x" }];

      const preview = previewPatches(dir, patches);
      const applied = applyPatches(dir, patches);

      expect(preview.success).toBe(false);
      expect(preview).toEqual({ success: false, error: applied.error });
    });

    it("when one patch of several does not match, even if the others do", () => {
      write("a.ts", "export const a = 1;\n");
      write("b.ts", "export const b = 2;\n");

      const preview = previewPatches(dir, [
        { filePath: "a.ts", search: "= 1", replace: "= 100" },
        { filePath: "b.ts", search: "nope", replace: "x" },
      ]);

      expect(preview.success).toBe(false);
      expect(read("a.ts")).toBe("export const a = 1;\n");
    });

    it("for a file that does not exist", () => {
      const preview = previewPatches(dir, [{ filePath: "missing.ts", search: "a", replace: "b" }]);

      expect(preview).toMatchObject({ success: false });
      expect((preview as { error: string }).error).toContain("File not found");
    });

    it("for a path outside the project", () => {
      const preview = previewPatches(dir, [{ filePath: "../elsewhere.txt", search: "a", replace: "b" }]);

      expect(preview).toMatchObject({ success: false });
      expect((preview as { error: string }).error).toContain("outside the project");
    });

    it("for a protected file", () => {
      write(".env", "KEY=1\n");

      const preview = previewPatches(dir, [{ filePath: ".env", search: "1", replace: "2" }]);

      expect(preview).toMatchObject({ success: false });
      expect((preview as { error: string }).error).toMatch(/protected/i);
      expect(read(".env")).toBe("KEY=1\n");
    });

    it("for an empty list of patches", () => {
      expect(previewPatches(dir, [])).toMatchObject({ success: false });
    });
  });
});
