import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createProtectedPathRules } from "@opspilot/shared";
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

  describe("backups hold the original content", () => {
    const backupOf = (relPath: string) => path.join(tmpDir, relPath + ".opspilot.bak");

    it("keeps the true original when one batch patches the same file twice", () => {
      write("a.ts", "let x = 1;\nlet y = 2;");

      const result = applyPatches(tmpDir, [
        { filePath: "a.ts", search: "let x = 1;", replace: "let x = 10;" },
        { filePath: "a.ts", search: "let y = 2;", replace: "let y = 20;" },
      ]);

      expect(result.success).toBe(true);
      expect(fs.readFileSync(backupOf("a.ts"), "utf-8")).toBe("let x = 1;\nlet y = 2;");
    });

    it("replaces a stale backup left by an earlier run", () => {
      write("a.ts", "let x = 1;");
      fs.writeFileSync(backupOf("a.ts"), "content from some earlier run", "utf-8");

      applyPatches(tmpDir, [{ filePath: "a.ts", search: "let x = 1;", replace: "let x = 2;" }]);

      expect(fs.readFileSync(backupOf("a.ts"), "utf-8")).toBe("let x = 1;");
    });

    it("does not overwrite the backup of a file that was already backed up earlier in the run", () => {
      write("a.ts", "let x = 1;");
      const first = applyPatches(tmpDir, [{ filePath: "a.ts", search: "let x = 1;", replace: "let x = 2;" }]);
      expect(first.success).toBe(true);

      const second = applyPatches(tmpDir, [{ filePath: "a.ts", search: "let x = 2;", replace: "let x = 3;" }], {
        alreadyBackedUp: first.applied.map((a) => a.absolutePath),
      });

      expect(second.success).toBe(true);
      expect(read("a.ts")).toBe("let x = 3;");
      expect(fs.readFileSync(backupOf("a.ts"), "utf-8")).toBe("let x = 1;");
      expect(second.applied[0].backupPath).toBe(backupOf("a.ts"));
    });

    it("keeps an earlier attempt's backup when a later batch fails and rolls back", () => {
      write("a.ts", "let x = 1;");
      write("b.ts", "let b = 1;");
      const first = applyPatches(tmpDir, [{ filePath: "a.ts", search: "let x = 1;", replace: "let x = 2;" }]);

      const second = applyPatches(
        tmpDir,
        [
          { filePath: "a.ts", search: "let x = 2;", replace: "let x = 3;" },
          { filePath: "b.ts", search: "this text does not exist", replace: "irrelevant" },
        ],
        { alreadyBackedUp: first.applied.map((a) => a.absolutePath) }
      );

      expect(second.success).toBe(false);
      // The failed batch is undone, but the backup from the earlier successful attempt must survive.
      expect(read("a.ts")).toBe("let x = 2;");
      expect(fs.readFileSync(backupOf("a.ts"), "utf-8")).toBe("let x = 1;");
      // A file first touched by the failed batch gets no leftover backup.
      expect(fs.existsSync(backupOf("b.ts"))).toBe(false);
    });
  });

  describe("protected files", () => {
    function writeAt(relPath: string, content: string) {
      const full = path.join(tmpDir, relPath);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content, "utf-8");
    }

    it.each([".env", "apps/web/.env.local", "pnpm-lock.yaml", ".github/workflows/ci.yml", "certs/server.pem"])(
      "refuses to edit %s and leaves it unchanged",
      (file) => {
        writeAt(file, "value: original");

        const result = applyPatches(tmpDir, [{ filePath: file, search: "original", replace: "CHANGED" }]);

        expect(result.success).toBe(false);
        expect(result.applied).toEqual([]);
        expect(result.error).toContain(`"${file}"`);
        expect(result.error).toMatch(/protected/i);
        expect(read(file)).toBe("value: original");
        expect(fs.existsSync(path.join(tmpDir, file + ".opspilot.bak"))).toBe(false);
      }
    );

    it("names the matching pattern in the message the model sees", () => {
      writeAt("apps/web/.env.local", "A=1");

      const result = applyPatches(tmpDir, [{ filePath: "apps/web/.env.local", search: "A=1", replace: "A=2" }]);

      expect(result.error).toContain('".env.*"');
    });

    it("changes nothing when only one patch in the batch targets a protected file", () => {
      write("a.ts", "export const a = 1;");
      write(".env", "KEY=original");

      const result = applyPatches(tmpDir, [
        { filePath: "a.ts", search: "export const a = 1;", replace: "export const a = 2;" },
        { filePath: ".env", search: "original", replace: "CHANGED" },
      ]);

      expect(result.success).toBe(false);
      expect(read("a.ts")).toBe("export const a = 1;");
      expect(read(".env")).toBe("KEY=original");
      expect(fs.existsSync(path.join(tmpDir, "a.ts.opspilot.bak"))).toBe(false);
    });

    it("still edits ordinary files", () => {
      write("a.ts", "export const a = 1;");

      const result = applyPatches(tmpDir, [{ filePath: "a.ts", search: "= 1", replace: "= 2" }]);

      expect(result.success).toBe(true);
      expect(read("a.ts")).toBe("export const a = 2;");
    });

    it("refuses a protected file reached through a folder link", (ctx) => {
      writeAt(".git/config", "[core] original");
      try {
        fs.symlinkSync(path.join(tmpDir, ".git"), path.join(tmpDir, "tools"), "junction");
      } catch {
        ctx.skip();
        return;
      }

      const result = applyPatches(tmpDir, [{ filePath: "tools/config", search: "original", replace: "HACKED" }]);

      expect(result.success).toBe(false);
      expect(read(".git/config")).toBe("[core] original");
    });

    it("lets a project allow one of the defaults", () => {
      write(".env.example", "KEY=original");

      const result = applyPatches(tmpDir, [{ filePath: ".env.example", search: "original", replace: "changed" }], {
        protection: createProtectedPathRules({ allow: [".env.example"] }),
      });

      expect(result.success).toBe(true);
      expect(read(".env.example")).toBe("KEY=changed");
    });

    it("lets a project protect more files", () => {
      writeAt("config/prod.json", "{ original }");

      const result = applyPatches(tmpDir, [{ filePath: "config/prod.json", search: "original", replace: "changed" }], {
        protection: createProtectedPathRules({ protect: ["config/prod.json"] }),
      });

      expect(result.success).toBe(false);
      expect(read("config/prod.json")).toBe("{ original }");
    });
  });

  describe("staying inside the project", () => {
    let outsideDir: string;

    beforeEach(() => {
      outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "bugzero-outside-test-"));
    });

    afterEach(() => {
      fs.rmSync(outsideDir, { recursive: true, force: true });
    });

    it("refuses a ../ path that escapes the project and leaves the outside file alone", () => {
      const outside = path.join(outsideDir, "secret.txt");
      fs.writeFileSync(outside, "original");

      const result = applyPatches(tmpDir, [
        { filePath: path.relative(tmpDir, outside), search: "original", replace: "HACKED" },
      ]);

      expect(result.success).toBe(false);
      expect(result.error).toContain("outside the project");
      expect(fs.readFileSync(outside, "utf-8")).toBe("original");
      expect(fs.existsSync(outside + ".opspilot.bak")).toBe(false);
    });

    it("refuses an absolute path outside the project", () => {
      const outside = path.join(outsideDir, "secret.txt");
      fs.writeFileSync(outside, "original");

      const result = applyPatches(tmpDir, [{ filePath: outside, search: "original", replace: "HACKED" }]);

      expect(result.success).toBe(false);
      expect(result.error).toContain("outside the project");
      expect(fs.readFileSync(outside, "utf-8")).toBe("original");
    });

    it("still accepts an absolute path that points inside the project", () => {
      write("a.ts", "export const a = 1;");

      const result = applyPatches(tmpDir, [
        { filePath: path.join(tmpDir, "a.ts"), search: "a = 1", replace: "a = 2" },
      ]);

      expect(result.success).toBe(true);
      expect(read("a.ts")).toBe("export const a = 2;");
    });

    it("checks every path before changing anything", () => {
      write("a.ts", "export const a = 1;");
      const outside = path.join(outsideDir, "secret.txt");
      fs.writeFileSync(outside, "original");

      const result = applyPatches(tmpDir, [
        { filePath: "a.ts", search: "a = 1", replace: "a = 2" },
        { filePath: path.relative(tmpDir, outside), search: "original", replace: "HACKED" },
      ]);

      expect(result.success).toBe(false);
      expect(read("a.ts")).toBe("export const a = 1;");
      expect(fs.existsSync(path.join(tmpDir, "a.ts.opspilot.bak"))).toBe(false);
      expect(fs.readFileSync(outside, "utf-8")).toBe("original");
    });

    it("refuses a path that goes through a symlinked directory pointing outside", (ctx) => {
      const outside = path.join(outsideDir, "secret.txt");
      fs.writeFileSync(outside, "original");
      try {
        // A junction needs no special privileges on Windows; a normal symlink does.
        fs.symlinkSync(outsideDir, path.join(tmpDir, "link"), process.platform === "win32" ? "junction" : "dir");
      } catch {
        ctx.skip();
      }

      const result = applyPatches(tmpDir, [{ filePath: "link/secret.txt", search: "original", replace: "HACKED" }]);

      expect(result.success).toBe(false);
      expect(result.error).toContain("outside the project");
      expect(fs.readFileSync(outside, "utf-8")).toBe("original");
    });
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
