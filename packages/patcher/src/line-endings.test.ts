import { describe, expect, it } from "vitest";
import { detectLineEnding, withLineEnding } from "./line-endings";

describe("detectLineEnding", () => {
  it("uses CRLF when the replaced region contains CRLF breaks", () => {
    const text = "a\r\nb\r\nc\r\n";
    expect(detectLineEnding(text, 0, 4)).toBe("\r\n");
  });

  it("uses LF when the replaced region contains LF breaks", () => {
    const text = "a\nb\nc\n";
    expect(detectLineEnding(text, 0, 3)).toBe("\n");
  });

  it("uses the break that ends the line when the region has none", () => {
    const text = "x\ny\r\nz\n";
    // "y" is followed by CRLF even though the file as a whole is mostly LF.
    expect(detectLineEnding(text, 2, 3)).toBe("\r\n");
  });

  it("uses the break before the region when the region ends the file", () => {
    const text = "first\r\nlast";
    expect(detectLineEnding(text, 7, 11)).toBe("\r\n");
  });

  it("falls back to the file's most common ending, and LF when there are no breaks", () => {
    expect(detectLineEnding("only one line", 0, 4)).toBe("\n");
    expect(detectLineEnding("", 0, 0)).toBe("\n");
  });

  it("does not treat a CRLF as both a CRLF and an LF", () => {
    const text = "a\r\nb\r\nc\nd\r\n";
    // Region covers "b\r\nc\n": one CRLF and one LF is a tie, so the line's own break decides.
    expect(detectLineEnding(text, 3, 8)).toBe("\r\n");
  });
});

describe("withLineEnding", () => {
  it("converts LF to CRLF without doubling existing CRLF", () => {
    expect(withLineEnding("a\nb\r\nc", "\r\n")).toBe("a\r\nb\r\nc");
  });

  it("converts CRLF to LF", () => {
    expect(withLineEnding("a\r\nb\nc", "\n")).toBe("a\nb\nc");
  });

  it("leaves text without line breaks and lone carriage returns alone", () => {
    expect(withLineEnding("no breaks", "\r\n")).toBe("no breaks");
    expect(withLineEnding("a\rb", "\r\n")).toBe("a\rb");
  });
});
