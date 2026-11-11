import { spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Each test starts a real CLI process (a few seconds, more when the machine is busy
// running the rest of the suite), which can blow past vitest's 5s default.
vi.setConfig({ testTimeout: 60_000 });

// These tests run the real built CLI. The property they protect — stdout holds
// exactly one JSON document — is the kind that breaks silently if anyone adds a
// stray console.log or the .env loader starts printing again.
const CLI = path.resolve(process.cwd(), "apps/bugzero/dist/index.js");

describe.skipIf(!fs.existsSync(CLI))("bugzero CLI --json", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bugzero-cli-json-test-"));
    // A .env in the project is what used to make dotenv print a promo line on stdout.
    fs.writeFileSync(path.join(tmpDir, ".env"), "BUGZERO_TEST=1\n");
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function makeProject(buildScript: string) {
    fs.writeFileSync(
      path.join(tmpDir, "package.json"),
      JSON.stringify({ name: "demo", scripts: { build: buildScript } })
    );
  }

  function run(...args: string[]) {
    const result = spawnSync(process.execPath, [CLI, ...args], {
      cwd: tmpDir,
      encoding: "utf8",
      timeout: 60_000,
      // An empty key makes any AI call fail instantly and offline, so the report falls back to its template.
      env: { ...process.env, OPENROUTER_API_KEY: "" },
    });
    return { stdout: result.stdout, stderr: result.stderr, status: result.status };
  }

  it("--version prints only the version, even when the project has a .env", () => {
    const { version } = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "apps/bugzero/package.json"), "utf8"));
    expect(run("--version").stdout.trim()).toBe(version);
  });

  it("hunt --json prints one JSON document for a passing project and exits 0", () => {
    makeProject(`node -e "console.log(1)"`);

    const { stdout, status } = run("hunt", "--json");
    const json = JSON.parse(stdout); // throws if anything else is mixed into stdout

    expect(status).toBe(0);
    expect(json).toMatchObject({
      command: "hunt",
      success: true,
      steps: { build: { status: "passed" }, lint: { status: "skipped" }, test: { status: "skipped" } },
    });
    expect(json.reportPath).toMatch(/bugzero-report\.md$/);
  });

  it("hunt --json reports a failing step with its output and exits 1", () => {
    makeProject(`node -e "console.error('boom');process.exit(1)"`);

    const { stdout, status } = run("hunt", "--json");
    const json = JSON.parse(stdout);

    expect(status).toBe(1);
    expect(json.success).toBe(false);
    expect(json.steps.build.status).toBe("failed");
    expect(json.steps.build.output).toContain("boom");
  });

  it("sends human-readable logs to stderr in --json mode", () => {
    makeProject(`node -e "console.log(1)"`);

    const { stdout, stderr } = run("hunt", "--json");

    expect(stderr).toContain("BugZero — Analyzing project");
    expect(stdout).not.toContain("BugZero — Analyzing project");
  });

  it("rescue --json reports an already-passing project", () => {
    makeProject(`node -e "console.log(1)"`);

    const { stdout, status } = run("rescue", "--json");
    const json = JSON.parse(stdout);

    expect(status).toBe(0);
    expect(json).toMatchObject({ command: "rescue", outcome: "already-passing", success: true, attempts: 0 });
  });

  it("rescue --json --dry-run reports detected failures without attempting a fix", () => {
    makeProject(`node -e "console.error('boom');process.exit(1)"`);

    const { stdout, status } = run("rescue", "--json", "--dry-run");
    const json = JSON.parse(stdout);

    expect(status).toBe(1);
    expect(json).toMatchObject({ outcome: "dry-run", success: false, dryRun: true, attempts: 0, fix: null });
  });

  it("prints a JSON error on stdout when the run can't start", () => {
    makeProject(`node -e "console.log(1)"`);

    const { stdout, status } = run("rescue", "--json", "-n", "abc");
    const json = JSON.parse(stdout);

    expect(status).toBe(1);
    expect(json.success).toBe(false);
    expect(json.error).toContain("--max-attempts must be a whole number");
  });

  it("without --json, still prints the human-readable summary on stdout", () => {
    makeProject(`node -e "console.log(1)"`);

    const { stdout } = run("hunt");

    expect(stdout).toContain("BugZero — Analyzing project");
    expect(stdout).toContain("All checks passed");
  });
});
