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

  function runFrom(cwd: string, ...args: string[]) {
    const env: NodeJS.ProcessEnv = { ...process.env, OPENROUTER_API_KEY: "" };
    delete env.BUGZERO_TEST; // only the project's .env may provide it
    const result = spawnSync(process.execPath, [CLI, ...args], {
      cwd,
      encoding: "utf8",
      timeout: 60_000,
      // An empty key makes any AI call fail instantly and offline, so the report falls back to its template.
      env,
    });
    return { stdout: result.stdout, stderr: result.stderr, status: result.status };
  }

  function run(...args: string[]) {
    return runFrom(tmpDir, ...args);
  }

  it("reads the .env of the --path project, not the folder the command was started from", () => {
    // The build only passes when BUGZERO_TEST (set in the project's .env) reaches it.
    makeProject(`node -e "process.exit(process.env.BUGZERO_TEST ? 0 : 1)"`);
    const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), "bugzero-cli-elsewhere-"));
    try {
      const { stdout, status } = runFrom(elsewhere, "rescue", "--path", tmpDir, "--json");

      expect(JSON.parse(stdout)).toMatchObject({ outcome: "already-passing", success: true });
      expect(status).toBe(0);
    } finally {
      fs.rmSync(elsewhere, { recursive: true, force: true });
    }
  });

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

  it("hunt --no-ai-report still reports the failure, and the report says the AI was turned off", () => {
    makeProject(`node -e "console.error('boom');process.exit(1)"`);

    const { stdout, status } = run("hunt", "--no-ai-report", "--json");
    const json = JSON.parse(stdout);

    expect(status).toBe(1);
    expect(json).toMatchObject({ command: "hunt", success: false });
    const report = fs.readFileSync(path.join(tmpDir, "bugzero-report.md"), "utf8");
    expect(report).toMatch(/AI report turned off/);
    expect(report).toContain("boom");
    expect(report).not.toMatch(/AI call failed/);
  });

  it("hunt without the flag still tries the AI report (which fails offline here, as before)", () => {
    makeProject(`node -e "console.error('boom');process.exit(1)"`);

    run("hunt", "--json");

    const report = fs.readFileSync(path.join(tmpDir, "bugzero-report.md"), "utf8");
    expect(report).toMatch(/AI call failed/);
  });

  describe("rescue --approve", () => {
    // The build leaves a marker behind, so a test can tell whether the project's commands were run at all.
    function makeMarkerProject() {
      fs.writeFileSync(path.join(tmpDir, "build.js"), `require("fs").writeFileSync("ran.txt", "x"); process.exit(1);`);
      makeProject("node build.js");
    }
    const ran = () => fs.existsSync(path.join(tmpDir, "ran.txt"));

    it("stops straight away, before running anything, when there is no terminal to answer in", () => {
      makeMarkerProject();

      const { stdout, stderr, status } = run("rescue", "--approve");

      expect(status).toBe(1);
      expect(stderr).toMatch(/interactive terminal/i);
      expect(stderr).toContain("--approve");
      expect(stdout).toBe("");
      expect(ran()).toBe(false); // the build was never run, and no AI tokens were spent
      expect(fs.existsSync(path.join(tmpDir, "bugzero-report.md"))).toBe(false);
    });

    it("reports that as a JSON error in --json mode", () => {
      makeMarkerProject();

      const { stdout, status } = run("rescue", "--approve", "--json");
      const json = JSON.parse(stdout);

      expect(status).toBe(1);
      expect(json.success).toBe(false);
      expect(json.error).toMatch(/interactive terminal/i);
      expect(ran()).toBe(false);
    });

    it("has no effect on --dry-run, which never writes anything, so it needs no terminal", () => {
      makeMarkerProject();

      const { stdout } = run("rescue", "--approve", "--dry-run", "--json");

      expect(JSON.parse(stdout)).toMatchObject({ outcome: "dry-run" });
    });

    it("has no effect on --print-prompt, which never writes anything either", () => {
      makeMarkerProject();

      const { stdout, status } = run("rescue", "--approve", "--print-prompt");

      expect(status).toBe(0);
      expect(stdout).toContain("You are an expert software engineer");
    });

    it("is listed in the help for rescue", () => {
      expect(run("rescue", "--help").stdout).toContain("--approve");
    });
  });

  describe("rescue --print-prompt", () => {
    // The build names the project's .env in its error, which used to put the file's contents in the prompt.
    function makeFailingProject() {
      fs.writeFileSync(
        path.join(tmpDir, "fail.js"),
        `console.error('error TS2304: Cannot find name foo while reading "./.env"'); process.exit(1);`
      );
      makeProject("node fail.js");
    }

    it("prints the exact prompt on stdout, sends nothing, writes no report, and exits 0", () => {
      makeFailingProject();

      const { stdout, stderr, status } = run("rescue", "--print-prompt");

      expect(status).toBe(0);
      expect(stdout).toContain("You are an expert software engineer specialising in fixing build");
      expect(stdout).toContain("Cannot find name foo");
      expect(stdout).not.toContain("BUGZERO_TEST=1"); // the .env contents stay out, as in a real run
      expect(stderr).toContain("BugZero Fix"); // progress goes to stderr so stdout is only the prompt
      expect(stdout).not.toContain("BugZero Fix");
      expect(fs.existsSync(path.join(tmpDir, "bugzero-report.md"))).toBe(false);
    });

    it("with --json, puts the prompt in the JSON result", () => {
      makeFailingProject();

      const { stdout, status } = run("rescue", "--print-prompt", "--json");
      const json = JSON.parse(stdout);

      expect(status).toBe(0);
      expect(json).toMatchObject({ command: "rescue", outcome: "prompt-preview", success: true, attempts: 0 });
      expect(json.prompt).toContain("Cannot find name foo");
    });

    it("says nothing would be sent when the project already passes", () => {
      makeProject(`node -e "console.log(1)"`);

      const { stdout, stderr, status } = run("rescue", "--print-prompt");

      expect(status).toBe(0);
      expect(stdout).toBe("");
      expect(stderr).toMatch(/nothing/i);
    });

    it("is listed in the help for rescue", () => {
      expect(run("rescue", "--help").stdout).toContain("--print-prompt");
    });
  });

  it("lists --no-ai-report in the help for hunt", () => {
    expect(run("hunt", "--help").stdout).toContain("--no-ai-report");
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
