import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { renderChangesFromBackups, renderUnifiedDiff } from "./diff";

const lines = (...text: string[]) => text.join("\n");
const numbered = (count: number) => Array.from({ length: count }, (_, i) => String(i + 1));

describe("renderUnifiedDiff", () => {
  it("shows a changed line with three lines of context either side", () => {
    const before = "a\nb\nc\nd\ne\nf\ng\nh\n";
    const after = "a\nb\nc\nD\ne\nf\ng\nh\n";

    expect(renderUnifiedDiff({ filePath: "f.txt", before, after })).toBe(
      lines("--- a/f.txt", "+++ b/f.txt", "@@ -1,7 +1,7 @@", " a", " b", " c", "-d", "+D", " e", " f", " g")
    );
  });

  it("shows an added line", () => {
    expect(renderUnifiedDiff({ filePath: "f.txt", before: "a\nb\n", after: "a\nb\nc\n" })).toBe(
      lines("--- a/f.txt", "+++ b/f.txt", "@@ -1,2 +1,3 @@", " a", " b", "+c")
    );
  });

  it("shows a removed line", () => {
    expect(renderUnifiedDiff({ filePath: "f.txt", before: "a\nb\nc\n", after: "a\nc\n" })).toBe(
      lines("--- a/f.txt", "+++ b/f.txt", "@@ -1,3 +1,2 @@", " a", "-b", " c")
    );
  });

  it("describes a file that grows from empty", () => {
    expect(renderUnifiedDiff({ filePath: "f.txt", before: "", after: "a\nb\n" })).toBe(
      lines("--- a/f.txt", "+++ b/f.txt", "@@ -0,0 +1,2 @@", "+a", "+b")
    );
  });

  it("writes a count of one as a single number", () => {
    expect(renderUnifiedDiff({ filePath: "f.txt", before: "old\n", after: "new\n" })).toBe(
      lines("--- a/f.txt", "+++ b/f.txt", "@@ -1 +1 @@", "-old", "+new")
    );
  });

  it("returns nothing when nothing changed", () => {
    expect(renderUnifiedDiff({ filePath: "f.txt", before: "same\n", after: "same\n" })).toBe("");
    expect(renderUnifiedDiff([])).toBe("");
  });

  describe("hunks", () => {
    it("keeps far-apart changes in separate hunks", () => {
      const before = numbered(20);
      const after = [...before];
      after[1] = "TWO";
      after[18] = "NINETEEN";

      const diff = renderUnifiedDiff({ filePath: "f.txt", before: before.join("\n") + "\n", after: after.join("\n") + "\n" });

      expect(diff.split("\n").filter((l) => l.startsWith("@@"))).toEqual(["@@ -1,5 +1,5 @@", "@@ -16,5 +16,5 @@"]);
    });

    it("merges changes whose context overlaps into one hunk", () => {
      const before = numbered(12);
      const after = [...before];
      after[2] = "THREE";
      after[7] = "EIGHT";

      const diff = renderUnifiedDiff({ filePath: "f.txt", before: before.join("\n") + "\n", after: after.join("\n") + "\n" });

      expect(diff.split("\n").filter((l) => l.startsWith("@@"))).toEqual(["@@ -1,11 +1,11 @@"]);
    });

    it("uses the context size it is given", () => {
      const before = "a\nb\nc\nd\ne\n";
      const after = "a\nb\nC\nd\ne\n";

      expect(renderUnifiedDiff({ filePath: "f.txt", before, after }, { context: 0 })).toBe(
        lines("--- a/f.txt", "+++ b/f.txt", "@@ -3 +3 @@", "-c", "+C")
      );
      expect(renderUnifiedDiff({ filePath: "f.txt", before, after }, { context: 1 })).toBe(
        lines("--- a/f.txt", "+++ b/f.txt", "@@ -2,3 +2,3 @@", " b", "-c", "+C", " d")
      );
    });

    it("numbers later hunks by their real line, after earlier lines were added or removed", () => {
      const before = numbered(30);
      const after = ["NEW-A", "NEW-B", ...before.slice(0, 28), "LAST"]; // two lines added at the top, line 29 and 30 replaced
      const diff = renderUnifiedDiff({ filePath: "f.txt", before: before.join("\n") + "\n", after: after.join("\n") + "\n" });

      const headers = diff.split("\n").filter((l) => l.startsWith("@@"));
      expect(headers[0]).toBe("@@ -1,3 +1,5 @@");
      expect(headers[1]).toMatch(/^@@ -26,5 \+28,4 @@$/);
    });
  });

  describe("the end of a file", () => {
    it("marks a file that has no newline at the end", () => {
      expect(renderUnifiedDiff({ filePath: "f.txt", before: "a\nb", after: "a\nB" })).toBe(
        lines("--- a/f.txt", "+++ b/f.txt", "@@ -1,2 +1,2 @@", " a", "-b", "\\ No newline at end of file", "+B", "\\ No newline at end of file")
      );
    });

    it("shows the change when only the final newline is added", () => {
      expect(renderUnifiedDiff({ filePath: "f.txt", before: "a", after: "a\n" })).toBe(
        lines("--- a/f.txt", "+++ b/f.txt", "@@ -1 +1 @@", "-a", "\\ No newline at end of file", "+a")
      );
    });
  });

  describe("line endings", () => {
    it("does not show carriage returns for a CRLF file", () => {
      const diff = renderUnifiedDiff({ filePath: "f.txt", before: "a\r\nb\r\nc\r\n", after: "a\r\nB\r\nc\r\n" });

      expect(diff).toBe(lines("--- a/f.txt", "+++ b/f.txt", "@@ -1,3 +1,3 @@", " a", "-b", "+B", " c"));
      expect(diff).not.toContain("\r");
    });

    it("still reports a file whose only change is its line endings", () => {
      const diff = renderUnifiedDiff({ filePath: "f.txt", before: "a\nb\n", after: "a\r\nb\r\n" });

      expect(diff).toContain("@@ -1,2 +1,2 @@");
      expect(diff.split("\n").filter((l) => l.startsWith("-") && !l.startsWith("---"))).toHaveLength(2);
    });
  });

  describe("several files", () => {
    it("renders each changed file in order and skips unchanged ones", () => {
      const diff = renderUnifiedDiff([
        { filePath: "src/a.ts", before: "one\n", after: "ONE\n" },
        { filePath: "src/unchanged.ts", before: "same\n", after: "same\n" },
        { filePath: "src\\b.ts", before: "two\n", after: "TWO\n" },
      ]);

      expect(diff).toBe(
        lines(
          "--- a/src/a.ts", "+++ b/src/a.ts", "@@ -1 +1 @@", "-one", "+ONE",
          "--- a/src/b.ts", "+++ b/src/b.ts", "@@ -1 +1 @@", "-two", "+TWO"
        )
      );
    });
  });

  describe("long lines and large files", () => {
    it("shortens a very long line and says how much was left out", () => {
      const diff = renderUnifiedDiff(
        { filePath: "min.js", before: "x".repeat(1000) + "\n", after: "y".repeat(1000) + "\n" },
        { maxLineLength: 50 }
      );

      expect(diff).toContain(`-${"x".repeat(50)}… [950 more characters]`);
      expect(diff).toContain(`+${"y".repeat(50)}… [950 more characters]`);
      expect(diff).not.toContain("x".repeat(51));
    });

    it("leaves lines within the limit alone", () => {
      const diff = renderUnifiedDiff({ filePath: "f.txt", before: "short\n", after: "shorter\n" });

      expect(diff).not.toContain("more characters");
    });

    it("handles a one-line change in a very large file quickly", () => {
      const before = numbered(50_000);
      const after = [...before];
      after[25_000] = "CHANGED";

      const start = Date.now();
      const diff = renderUnifiedDiff({ filePath: "big.txt", before: before.join("\n") + "\n", after: after.join("\n") + "\n" });

      expect(Date.now() - start).toBeLessThan(2000);
      expect(diff).toContain("-25001");
      expect(diff).toContain("+CHANGED");
    });

    it("copes when two large files share nothing, instead of running out of memory or time", () => {
      const before = Array.from({ length: 6000 }, (_, i) => `old line ${i}`);
      const after = Array.from({ length: 6000 }, (_, i) => `new line ${i}`);

      const start = Date.now();
      const diff = renderUnifiedDiff({ filePath: "big.txt", before: before.join("\n"), after: after.join("\n") });

      expect(Date.now() - start).toBeLessThan(3000);
      expect(diff).toContain("@@ -1,6000 +1,6000 @@");
      expect(diff.split("\n").filter((l) => l.startsWith("-old"))).toHaveLength(6000);
    });
  });
});

describe("renderChangesFromBackups", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "bugzero-diff-test-"));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("compares each file with the original saved in its .opspilot.bak", () => {
    fs.mkdirSync(path.join(dir, "src"));
    fs.writeFileSync(path.join(dir, "src", "a.ts"), "export const a = 2;\n");
    fs.writeFileSync(path.join(dir, "src", "a.ts.opspilot.bak"), "export const a = 1;\n");

    expect(renderChangesFromBackups(dir, ["src/a.ts"])).toBe(
      lines("--- a/src/a.ts", "+++ b/src/a.ts", "@@ -1 +1 @@", "-export const a = 1;", "+export const a = 2;")
    );
  });

  it("skips files with no backup, files that are unchanged, and files that are missing", () => {
    fs.writeFileSync(path.join(dir, "nobackup.ts"), "x\n");
    fs.writeFileSync(path.join(dir, "same.ts"), "x\n");
    fs.writeFileSync(path.join(dir, "same.ts.opspilot.bak"), "x\n");
    fs.writeFileSync(path.join(dir, "gone.ts.opspilot.bak"), "x\n");

    expect(renderChangesFromBackups(dir, ["nobackup.ts", "same.ts", "gone.ts", "never-existed.ts"])).toBe("");
  });

  it("will not read outside the project", () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "bugzero-diff-outside-"));
    try {
      fs.writeFileSync(path.join(outside, "secret.txt"), "after\n");
      fs.writeFileSync(path.join(outside, "secret.txt.opspilot.bak"), "before\n");

      expect(renderChangesFromBackups(dir, [path.join(outside, "secret.txt"), "../" + path.basename(outside) + "/secret.txt"])).toBe("");
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });
});
