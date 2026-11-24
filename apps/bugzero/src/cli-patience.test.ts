import { spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.setConfig({ testTimeout: 60_000 });

// These tests run the real built CLI: a bad --patience must be refused before anything runs.
const CLI = path.resolve(process.cwd(), "apps/bugzero/dist/index.js");

describe.skipIf(!fs.existsSync(CLI))("bugzero rescue --patience", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "bugzero-cli-patience-test-"));
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

  it.each(["abc", "-1", "1.5"])("rejects %s before running anything", (value) => {
    const result = rescue("--patience", value);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("--patience must be a whole number of 0 or more");
    expect(result.stdout).not.toContain("Running validation pipeline");
  });

  it("accepts 0, which turns it off", () => {
    const result = rescue("--patience", "0");

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Patience:    off");
  });

  it("is shown in the help", () => {
    const result = spawnSync(process.execPath, [CLI, "rescue", "--help"], { encoding: "utf8" });

    expect(result.stdout).toContain("--patience <n>");
  });
});
