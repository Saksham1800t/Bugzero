import { describe, expect, it } from "vitest";
import { findMatch, lineSimilarity } from "./fuzzy-match";

describe("lineSimilarity", () => {
  it("returns 1 for identical strings", () => {
    expect(lineSimilarity("const x = 1;", "const x = 1;")).toBe(1);
  });

  it("returns 1 for two empty strings", () => {
    expect(lineSimilarity("", "")).toBe(1);
  });

  it("returns a partial score proportional to edit distance", () => {
    expect(lineSimilarity("abc", "abd")).toBeCloseTo(2 / 3, 5);
  });

  it("returns a low score for completely different strings", () => {
    expect(lineSimilarity("abc", "xyz")).toBe(0);
  });
});

describe("findMatch", () => {
  it("finds an exact match first", () => {
    const content = "const x = 1;\nconst y = 2;\n";
    const match = findMatch(content, "const y = 2;");

    expect(match).not.toBeNull();
    expect(match!.strategy).toBe("exact");
    expect(match!.score).toBe(1);
    expect(content.slice(match!.start, match!.end)).toBe("const y = 2;");
  });

  it("falls back to a whitespace-normalized match when indentation/spacing differs", () => {
    const content = ["function add(a, b) {", "    return   a + b;", "}"].join("\n");
    const search = ["function add(a, b) {", "return a + b;", "}"].join("\n");

    const match = findMatch(content, search);

    expect(match).not.toBeNull();
    expect(match!.strategy).toBe("whitespace");
    expect(content.slice(match!.start, match!.end)).toBe(
      ["function add(a, b) {", "    return   a + b;", "}"].join("\n")
    );
  });

  it("falls back to a similarity match for a near-identical single line", () => {
    const content = `const message = "Hello, world!";`;
    const search = `const message = "Hello world!";`; // missing the comma

    const match = findMatch(content, search);

    expect(match).not.toBeNull();
    expect(match!.strategy).toBe("similarity");
    expect(match!.score).toBeGreaterThan(0.85);
    expect(content.slice(match!.start, match!.end)).toBe(content);
  });

  it("returns null when nothing is similar enough", () => {
    const content = "import fs from 'fs';";
    const search = "function totallyUnrelatedThing() { doSomethingElseEntirely(); }";

    expect(findMatch(content, search)).toBeNull();
  });

  it("returns null instead of guessing when two locations are equally plausible", () => {
    const content = ["function fooX() { return 1; }", "function fooY() { return 1; }"].join("\n");
    const search = "function foo_() { return 1; }";

    // Both lines are exactly one character away from `search`, so neither
    // candidate is a confidently better match than the other.
    expect(findMatch(content, search)).toBeNull();
  });

  it("returns null when the search has more lines than the file", () => {
    const content = "line one";
    const search = "line one\nline two\nline three";

    expect(findMatch(content, search)).toBeNull();
  });
});
