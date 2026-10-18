import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockRunCommand } = vi.hoisted(() => ({ mockRunCommand: vi.fn() }));

vi.mock("./run-command", () => ({ runCommand: mockRunCommand }));

import { readScripts, runScript } from "./scripts";

describe("scripts", () => {
  let tmpDir: string;

  beforeEach(() => {
    vi.resetAllMocks();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bugzero-scripts-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function write(name: string, content = "") {
    fs.writeFileSync(path.join(tmpDir, name), content, "utf-8");
  }

  describe("readScripts", () => {
    it("returns the script names from package.json", () => {
      write("package.json", JSON.stringify({ scripts: { build: "tsc", test: "vitest" } }));
      expect(readScripts(tmpDir)).toEqual(["build", "test"]);
    });

    it("returns an empty list when there is no package.json", () => {
      expect(readScripts(tmpDir)).toEqual([]);
    });

    it("returns an empty list for malformed package.json", () => {
      write("package.json", "{ not valid json");
      expect(readScripts(tmpDir)).toEqual([]);
    });

    it("returns an empty list when scripts is missing or not an object", () => {
      write("package.json", JSON.stringify({ name: "x" }));
      expect(readScripts(tmpDir)).toEqual([]);

      write("package.json", JSON.stringify({ scripts: "nope" }));
      expect(readScripts(tmpDir)).toEqual([]);
    });
  });

  describe("runScript", () => {
    it("skips a script the project doesn't define, without running anything", async () => {
      write("package.json", JSON.stringify({ scripts: { build: "tsc" } }));

      const result = await runScript("lint", tmpDir);

      expect(result).toEqual({ success: true, output: "", skipped: true });
      expect(mockRunCommand).not.toHaveBeenCalled();
    });

    it("runs a defined script with the project's package manager", async () => {
      write("package.json", JSON.stringify({ scripts: { build: "tsc" } }));
      write("pnpm-lock.yaml");
      mockRunCommand.mockResolvedValueOnce({ success: false, output: "boom" });

      const result = await runScript("build", tmpDir);

      expect(mockRunCommand).toHaveBeenCalledWith("pnpm run build", tmpDir);
      expect(result).toEqual({ success: false, output: "boom" });
    });
  });
});
