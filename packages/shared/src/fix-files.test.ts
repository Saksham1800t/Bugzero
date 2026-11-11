import { describe, expect, it } from "vitest";
import { uniqueFilePaths } from "./fix-files";

describe("uniqueFilePaths", () => {
  it("returns each file once, in the order it first appears", () => {
    const patches = [
      { filePath: "src/b.ts" },
      { filePath: "src/a.ts" },
      { filePath: "src/b.ts" },
      { filePath: "src/a.ts" },
      { filePath: "src/c.ts" },
    ];

    expect(uniqueFilePaths(patches)).toEqual(["src/b.ts", "src/a.ts", "src/c.ts"]);
  });

  it("returns an empty list for no patches", () => {
    expect(uniqueFilePaths([])).toEqual([]);
  });
});
