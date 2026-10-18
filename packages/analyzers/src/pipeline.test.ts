import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockRunCommand } = vi.hoisted(() => ({ mockRunCommand: vi.fn() }));

vi.mock("./run-command", () => ({ runCommand: mockRunCommand }));

import { runValidationPipeline } from "./pipeline";

describe("runValidationPipeline", () => {
  let tmpDir: string;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bugzero-pipeline-test-"));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeScripts(scripts: Record<string, string>) {
    fs.writeFileSync(path.join(tmpDir, "package.json"), JSON.stringify({ scripts }), "utf-8");
  }

  it("runs build, lint, and test in order when all are defined", async () => {
    writeScripts({ build: "x", lint: "x", test: "x" });
    mockRunCommand.mockResolvedValue({ success: true, output: "ok" });

    const result = await runValidationPipeline(tmpDir);

    expect(result).toEqual({ success: true, step: "none", output: "" });
    expect(mockRunCommand.mock.calls.map((c) => c[0])).toEqual([
      "npm run build",
      "npm run lint",
      "npm run test",
    ]);
  });

  it("skips steps the project has no script for instead of failing them", async () => {
    writeScripts({ test: "x" });
    mockRunCommand.mockResolvedValue({ success: true, output: "ok" });

    const result = await runValidationPipeline(tmpDir);

    expect(result.success).toBe(true);
    expect(mockRunCommand.mock.calls.map((c) => c[0])).toEqual(["npm run test"]);
  });

  it("stops at the first failing step and reports which one failed", async () => {
    writeScripts({ build: "x", lint: "x", test: "x" });
    mockRunCommand.mockResolvedValueOnce({ success: true, output: "ok" });
    mockRunCommand.mockResolvedValueOnce({ success: false, output: "lint exploded" });

    const result = await runValidationPipeline(tmpDir);

    expect(result).toEqual({ success: false, step: "lint", output: "lint exploded" });
    expect(mockRunCommand).toHaveBeenCalledTimes(2);
  });

  it("passes with a warning when the project defines none of the scripts", async () => {
    writeScripts({ start: "node ." });

    const result = await runValidationPipeline(tmpDir);

    expect(result).toEqual({ success: true, step: "none", output: "" });
    expect(mockRunCommand).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("nothing to validate"));
  });
});
