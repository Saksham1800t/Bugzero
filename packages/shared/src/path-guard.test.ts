import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isInsideDirectory, isLexicallyInside, resolveInsideProject } from "./path-guard";

describe("isLexicallyInside", () => {
  const root = path.resolve("/work/project");

  it("accepts the root itself and anything nested inside it", () => {
    expect(isLexicallyInside(root, root)).toBe(true);
    expect(isLexicallyInside(root, path.join(root, "src", "a.ts"))).toBe(true);
  });

  it("rejects a parent, a sibling, and a sibling that merely shares the name prefix", () => {
    expect(isLexicallyInside(root, path.dirname(root))).toBe(false);
    expect(isLexicallyInside(root, path.resolve("/work/other"))).toBe(false);
    expect(isLexicallyInside(root, path.resolve("/work/project-evil/a.ts"))).toBe(false);
  });

  it("rejects a path that climbs out with ..", () => {
    expect(isLexicallyInside(root, path.join(root, "..", "x.ts"))).toBe(false);
    expect(isLexicallyInside(root, path.join(root, "src", "..", "..", "x.ts"))).toBe(false);
  });

  it("accepts a file whose name merely starts with two dots", () => {
    expect(isLexicallyInside(root, path.join(root, "..hidden.ts"))).toBe(true);
  });

  it.skipIf(process.platform !== "win32")("rejects a path on another drive", () => {
    expect(isLexicallyInside("C:\\work\\project", "D:\\work\\project\\a.ts")).toBe(false);
  });
});

describe("filesystem-aware checks", () => {
  let base: string;
  let project: string;
  let outside: string;

  beforeEach(() => {
    base = fs.mkdtempSync(path.join(os.tmpdir(), "bugzero-path-guard-test-"));
    project = path.join(base, "project");
    outside = path.join(base, "outside");
    fs.mkdirSync(project);
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(project, "a.ts"), "x");
    fs.writeFileSync(path.join(outside, "secret.ts"), "x");
  });

  afterEach(() => {
    fs.rmSync(base, { recursive: true, force: true });
  });

  function link(name: string): boolean {
    try {
      // A junction needs no special privileges on Windows; a normal symlink does.
      fs.symlinkSync(outside, path.join(project, name), process.platform === "win32" ? "junction" : "dir");
      return true;
    } catch {
      return false;
    }
  }

  describe("isInsideDirectory", () => {
    it("accepts an existing file and a not-yet-existing path inside the project", () => {
      expect(isInsideDirectory(project, path.join(project, "a.ts"))).toBe(true);
      expect(isInsideDirectory(project, path.join(project, "new", "file.ts"))).toBe(true);
    });

    it("rejects an existing file and a not-yet-existing path outside the project", () => {
      expect(isInsideDirectory(project, path.join(outside, "secret.ts"))).toBe(false);
      expect(isInsideDirectory(project, path.join(outside, "missing", "file.ts"))).toBe(false);
    });

    it("rejects a path that reaches outside through a symlinked directory", (ctx) => {
      if (!link("link")) ctx.skip();
      expect(isInsideDirectory(project, path.join(project, "link", "secret.ts"))).toBe(false);
      expect(isInsideDirectory(project, path.join(project, "link", "not-there-yet.ts"))).toBe(false);
    });

    it("works when the project root is itself reached through a different but equivalent spelling", () => {
      const withDots = path.join(project, "..", "project", "a.ts");
      expect(isInsideDirectory(project, withDots)).toBe(true);
    });
  });

  describe("resolveInsideProject", () => {
    it("resolves a relative path inside the project", () => {
      const result = resolveInsideProject(project, "a.ts");
      expect(result).toEqual({ ok: true, absolutePath: path.join(project, "a.ts") });
    });

    it("accepts an absolute path that points inside the project", () => {
      const inside = path.join(project, "a.ts");
      expect(resolveInsideProject(project, inside)).toEqual({ ok: true, absolutePath: inside });
    });

    it("rejects ../ escapes and absolute paths outside, naming the path in the message", () => {
      for (const bad of [path.join("..", "outside", "secret.ts"), path.join(outside, "secret.ts")]) {
        const result = resolveInsideProject(project, bad);
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error).toContain("outside the project");
          expect(result.error).toContain(bad);
        }
      }
    });

    it("rejects an empty path, a whitespace path, a null character, and the project directory itself", () => {
      for (const bad of ["", "   ", "a\0.ts", ".", project]) {
        expect(resolveInsideProject(project, bad).ok).toBe(false);
      }
    });
  });
});
