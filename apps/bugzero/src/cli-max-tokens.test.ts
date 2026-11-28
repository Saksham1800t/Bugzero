import { spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.setConfig({ testTimeout: 60_000 });

// These tests run the real built CLI with no API key. A budget too small for any request means nothing could be
// sent even with a key, so a whole rescue can run: it checks the project, refuses to call the model, and reports.
const CLI = path.resolve(process.cwd(), "apps/bugzero/dist/index.js");

describe.skipIf(!fs.existsSync(CLI))("bugzero rescue --max-tokens", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "bugzero-cli-tokens-test-"));
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "demo", scripts: { build: "node build.js" } }));
    fs.writeFileSync(path.join(dir, "build.js"), 'console.error("error: broken"); process.exit(1);');
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

    expect(result.stdout).toContain("--max-tokens <n>");
  });

  it.each(["abc", "-1", "1.5"])("rejects %s before running anything", (value) => {
    const result = rescue("--max-tokens", value);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("--max-tokens must be a whole number of 0 or more");
    expect(result.stdout).not.toContain("Running validation pipeline");
  });

  it("makes no AI request when the budget cannot cover one, and still writes a report", () => {
    const result = rescue("--max-tokens", "50");

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("Token budget: 50");
    expect(result.stdout).toContain("Could not fix build after 0 attempt(s)");
    expect(result.stdout).toContain("Token budget: 0 of 50 used");
    // Without a key, any request would have failed with this message
    expect(result.stderr).not.toContain("OPENROUTER_API_KEY");
    expect(fs.readFileSync(path.join(dir, "bugzero-report.md"), "utf8")).toContain("0 of 50 tokens used");
  });

  it("puts the budget in the JSON result", () => {
    const result = rescue("--max-tokens", "50", "--json");
    const json = JSON.parse(result.stdout);

    expect(json.stoppedEarly).toBe("token-budget");
    expect(json.tokenBudget).toEqual({ limit: 50, used: 0, estimated: false });
    expect(json.attempts).toBe(0);
  });

  it("reads maxTokens from .bugzerorc", () => {
    fs.writeFileSync(path.join(dir, ".bugzerorc"), JSON.stringify({ maxTokens: 60 }));

    const result = rescue();

    expect(result.stdout).toContain("Token budget: 0 of 60 used");
  });
});
