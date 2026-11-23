import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyPatches } from "./apply-multi-patch";
import { findBackups, undoChanges } from "./undo";

describe("undoChanges", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "bugzero-undo-test-"));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const write = (rel: string, content: string | Buffer) => {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  };
  const read = (rel: string) => fs.readFileSync(path.join(dir, rel), "utf-8");
  const exists = (rel: string) => fs.existsSync(path.join(dir, rel));

  it("returns the project to how it was before the run, and removes the backups", () => {
    write("src/a.ts", "const a = 1;\n");
    write("b.ts", "const b = 2;\n");
    applyPatches(dir, [
      { filePath: "src/a.ts", search: "= 1", replace: "= 10" },
      { filePath: "b.ts", search: "= 2", replace: "= 20" },
    ]);

    const entries = undoChanges(dir);

    expect(entries).toEqual([
      { filePath: "b.ts", status: "restored" },
      { filePath: "src/a.ts", status: "restored" },
    ]);
    expect(read("src/a.ts")).toBe("const a = 1;\n");
    expect(read("b.ts")).toBe("const b = 2;\n");
    expect(findBackups(dir)).toEqual([]);
    expect(exists("src/a.ts.opspilot.bak.sha")).toBe(false);
  });

  it("restores the original after two attempts patched the same file", () => {
    write("a.ts", "const a = 1;\nconst b = 2;\n");
    const first = applyPatches(dir, [{ filePath: "a.ts", search: "= 1", replace: "= 10" }]);
    applyPatches(dir, [{ filePath: "a.ts", search: "= 2", replace: "= 20" }], {
      alreadyBackedUp: first.applied.map((applied) => applied.absolutePath),
    });
    expect(read("a.ts")).toBe("const a = 10;\nconst b = 20;\n");

    undoChanges(dir);

    expect(read("a.ts")).toBe("const a = 1;\nconst b = 2;\n");
  });

  it("restores the exact bytes, including CRLF line endings", () => {
    write("a.ts", "line one\r\nline two\r\n");
    applyPatches(dir, [{ filePath: "a.ts", search: "line two", replace: "changed" }]);

    undoChanges(dir);

    expect(fs.readFileSync(path.join(dir, "a.ts")).toString("hex")).toBe(
      Buffer.from("line one\r\nline two\r\n").toString("hex")
    );
  });

  it("does nothing when there is nothing to undo, and a second undo does nothing", () => {
    expect(undoChanges(dir)).toEqual([]);

    write("a.ts", "x = 1\n");
    applyPatches(dir, [{ filePath: "a.ts", search: "1", replace: "2" }]);
    expect(undoChanges(dir)).toHaveLength(1);
    expect(undoChanges(dir)).toEqual([]);
    expect(read("a.ts")).toBe("x = 1\n");
  });

  describe("a file edited after BugZero fixed it", () => {
    beforeEach(() => {
      write("a.ts", "const a = 1;\n");
      applyPatches(dir, [{ filePath: "a.ts", search: "= 1", replace: "= 10" }]);
      write("a.ts", "const a = 10; // my own edit\n");
    });

    it("is left alone, with its backup, and reported", () => {
      const entries = undoChanges(dir);

      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({ filePath: "a.ts", status: "edited-since" });
      expect(entries[0].detail).toContain("--force");
      expect(read("a.ts")).toBe("const a = 10; // my own edit\n");
      expect(exists("a.ts.opspilot.bak")).toBe(true);
    });

    it("is restored anyway with force", () => {
      const entries = undoChanges(dir, { force: true });

      expect(entries).toEqual([{ filePath: "a.ts", status: "restored" }]);
      expect(read("a.ts")).toBe("const a = 1;\n");
      expect(exists("a.ts.opspilot.bak")).toBe(false);
    });
  });

  it("just removes the backup when the file was already put back by hand", () => {
    write("a.ts", "const a = 1;\n");
    applyPatches(dir, [{ filePath: "a.ts", search: "= 1", replace: "= 10" }]);
    write("a.ts", "const a = 1;\n");

    expect(undoChanges(dir)).toEqual([{ filePath: "a.ts", status: "restored" }]);
    expect(exists("a.ts.opspilot.bak")).toBe(false);
  });

  it("restores a file with no fingerprint note (a backup from an older version)", () => {
    write("a.ts", "new\n");
    write("a.ts.opspilot.bak", "old\n");

    expect(undoChanges(dir)).toEqual([{ filePath: "a.ts", status: "restored" }]);
    expect(read("a.ts")).toBe("old\n");
  });

  it("recreates a file that was deleted after the fix", () => {
    write("a.ts", "old\n");
    applyPatches(dir, [{ filePath: "a.ts", search: "old", replace: "new" }]);
    fs.rmSync(path.join(dir, "a.ts"));

    expect(undoChanges(dir)).toEqual([{ filePath: "a.ts", status: "restored" }]);
    expect(read("a.ts")).toBe("old\n");
  });

  it("a dry run reports what would be restored and changes nothing", () => {
    write("a.ts", "const a = 1;\n");
    applyPatches(dir, [{ filePath: "a.ts", search: "= 1", replace: "= 10" }]);

    expect(undoChanges(dir, { dryRun: true })).toEqual([{ filePath: "a.ts", status: "would-restore" }]);
    expect(read("a.ts")).toBe("const a = 10;\n");
    expect(exists("a.ts.opspilot.bak")).toBe(true);
  });

  it("ignores backups inside node_modules and .git", () => {
    write("node_modules/pkg/index.js.opspilot.bak", "x");
    write(".git/hooks/pre-commit.opspilot.bak", "x");
    write("node_modules/pkg/index.js", "y");

    expect(findBackups(dir)).toEqual([]);
    expect(undoChanges(dir)).toEqual([]);
    expect(read("node_modules/pkg/index.js")).toBe("y");
  });

  it("never writes a protected file, even if a backup for it was planted", () => {
    write(".env", "KEY=real\n");
    write(".env.opspilot.bak", "KEY=planted\n");

    const entries = undoChanges(dir);

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ filePath: ".env", status: "protected" });
    expect(read(".env")).toBe("KEY=real\n");
  });

  it("does not follow a linked folder out of the project", (ctx) => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "bugzero-undo-outside-"));
    try {
      fs.writeFileSync(path.join(outside, "x.ts"), "mine\n");
      fs.writeFileSync(path.join(outside, "x.ts.opspilot.bak"), "theirs\n");
      try {
        fs.symlinkSync(outside, path.join(dir, "link"), "junction");
      } catch {
        ctx.skip();
      }

      expect(undoChanges(dir)).toEqual([]);
      expect(fs.readFileSync(path.join(outside, "x.ts"), "utf-8")).toBe("mine\n");
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it("applying a fix saves a fingerprint next to the backup, and a failed batch leaves none", () => {
    write("a.ts", "const a = 1;\n");

    const failed = applyPatches(dir, [
      { filePath: "a.ts", search: "= 1", replace: "= 10" },
      { filePath: "a.ts", search: "not in the file", replace: "x" },
    ]);
    expect(failed.success).toBe(false);
    expect(exists("a.ts.opspilot.bak.sha")).toBe(false);

    applyPatches(dir, [{ filePath: "a.ts", search: "= 1", replace: "= 10" }]);
    expect(exists("a.ts.opspilot.bak.sha")).toBe(true);
  });
});
