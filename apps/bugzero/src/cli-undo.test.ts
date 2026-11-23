import { spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.setConfig({ testTimeout: 60_000 });

// These tests run the real built CLI, so they prove the command is wired up and prints what it should.
const CLI = path.resolve(process.cwd(), "apps/bugzero/dist/index.js");

describe.skipIf(!fs.existsSync(CLI))("bugzero undo", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "bugzero-cli-undo-test-"));
    fs.writeFileSync(path.join(dir, "a.ts"), "const a = 10;\n");
    fs.writeFileSync(path.join(dir, "a.ts.opspilot.bak"), "const a = 1;\n");
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function undo(...args: string[]) {
    const result = spawnSync(process.execPath, [CLI, "undo", ...args], { cwd: dir, encoding: "utf8", timeout: 60_000 });
    return { stdout: result.stdout, stderr: result.stderr, status: result.status };
  }

  it("restores the file, removes the backup, and says so", () => {
    const result = undo();

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Restored a.ts");
    expect(fs.readFileSync(path.join(dir, "a.ts"), "utf8")).toBe("const a = 1;\n");
    expect(fs.existsSync(path.join(dir, "a.ts.opspilot.bak"))).toBe(false);
  });

  it("--dry-run changes nothing", () => {
    const result = undo("--dry-run");

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Would restore a.ts");
    expect(fs.readFileSync(path.join(dir, "a.ts"), "utf8")).toBe("const a = 10;\n");
    expect(fs.existsSync(path.join(dir, "a.ts.opspilot.bak"))).toBe(true);
  });

  it("works on another folder with --path", () => {
    const result = spawnSync(process.execPath, [CLI, "undo", "--path", dir], { cwd: os.tmpdir(), encoding: "utf8" });

    expect(result.status).toBe(0);
    expect(fs.readFileSync(path.join(dir, "a.ts"), "utf8")).toBe("const a = 1;\n");
  });

  it("reports when there is nothing to undo", () => {
    undo();

    const result = undo();

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Nothing to undo");
  });

  it("skips a file edited after the fix, exits 1, and --force restores it", () => {
    // A fingerprint of a different file content, as if BugZero had written something else
    fs.writeFileSync(path.join(dir, "a.ts.opspilot.bak.sha"), "0".repeat(64) + "\n");

    const skipped = undo();
    expect(skipped.status).toBe(1);
    expect(skipped.stdout).toContain("Skipped a.ts");
    expect(fs.readFileSync(path.join(dir, "a.ts"), "utf8")).toBe("const a = 10;\n");

    const forced = undo("--force");
    expect(forced.status).toBe(0);
    expect(fs.readFileSync(path.join(dir, "a.ts"), "utf8")).toBe("const a = 1;\n");
  });
});
