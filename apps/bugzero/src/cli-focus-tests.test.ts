import { spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.setConfig({ testTimeout: 60_000 });

// These tests run the real built CLI: a bad focusTests in .bugzerorc must be refused before anything runs.
const CLI = path.resolve(process.cwd(), "apps/bugzero/dist/index.js");

describe.skipIf(!fs.existsSync(CLI))("bugzero rescue --no-focus-tests", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "bugzero-cli-focus-test-"));
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "demo", scripts: { build: "node -e 1" } }));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function rescue(...args: string[]) {
    const env: NodeJS.ProcessEnv = { ...process.env, OPENROUTER_API_KEY: "" };
    const result = spawnSync(process.execPath, [CLI, "rescue", "--path", dir, ...args], { encoding: "utf8", env, timeout: 60_000 });
    return { stdout: result.stdout, stderr: result.stderr, status: result.status };
  }

  it("is shown in the help", () => {
    const result = spawnSync(process.execPath, [CLI, "rescue", "--help"], { encoding: "utf8" });

    expect(result.stdout).toContain("--no-focus-tests");
  });

  it("is accepted, and the banner says the full pipeline runs every time", () => {
    const result = rescue("--no-focus-tests");

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Focus tests: off");
  });

  it("says nothing about it by default", () => {
    const result = rescue();

    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain("Focus tests");
  });

  it("rejects a focusTests in .bugzerorc that is not true or false, before running anything", () => {
    fs.writeFileSync(path.join(dir, ".bugzerorc"), JSON.stringify({ focusTests: "sometimes" }));

    const result = rescue();

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("focusTests in .bugzerorc must be true or false");
    expect(result.stdout).not.toContain("Running validation pipeline");
  });
});
