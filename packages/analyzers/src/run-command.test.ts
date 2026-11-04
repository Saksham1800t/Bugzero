import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCommand } from "./run-command";

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitUntil(condition: () => boolean, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (condition()) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return condition();
}

describe("runCommand", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bugzero-run-command-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns the output of a successful command", async () => {
    const result = await runCommand(`node -e "console.log('hello')"`, tmpDir);

    expect(result.success).toBe(true);
    expect(result.output).toContain("hello");
    expect(result.timedOut).toBeUndefined();
  });

  it("returns failure and the output of a failing command", async () => {
    const result = await runCommand(`node -e "console.error('boom');process.exit(2)"`, tmpDir);

    expect(result.success).toBe(false);
    expect(result.output).toContain("boom");
    expect(result.timedOut).toBeUndefined();
  });

  it("lets a command that finishes within the timeout succeed normally", async () => {
    const result = await runCommand(`node -e "console.log('quick')"`, tmpDir, { timeoutMs: 20_000 });

    expect(result.success).toBe(true);
    expect(result.timedOut).toBeUndefined();
  });

  it(
    "stops a hung command at the timeout, keeps its partial output, and kills the whole process tree",
    async () => {
      // parent.js spawns a long-lived child (writing its pid) and then hangs itself,
      // so a shell-only kill would leave an orphan behind.
      fs.writeFileSync(
        path.join(tmpDir, "child.js"),
        `require("fs").writeFileSync(${JSON.stringify(path.join(tmpDir, "child.pid"))}, String(process.pid));
         console.log("child started");
         setInterval(() => {}, 1000);`
      );
      fs.writeFileSync(
        path.join(tmpDir, "parent.js"),
        `require("child_process").spawn(process.execPath, [${JSON.stringify(path.join(tmpDir, "child.js"))}], { stdio: "inherit" });
         console.log("parent started");
         setInterval(() => {}, 1000);`
      );

      const started = Date.now();
      const result = await runCommand("node parent.js", tmpDir, { timeoutMs: 2000 });
      const elapsed = Date.now() - started;

      expect(result.success).toBe(false);
      expect(result.timedOut).toBe(true);
      expect(result.output).toContain("parent started");
      expect(result.output).toContain("timed out after 2s");
      expect(elapsed).toBeLessThan(15_000);

      const childPid = Number(fs.readFileSync(path.join(tmpDir, "child.pid"), "utf-8"));
      const childGone = await waitUntil(() => !isAlive(childPid), 5000);
      if (!childGone) process.kill(childPid, "SIGKILL"); // don't leak it if the assertion below fails
      expect(childGone).toBe(true);
    },
    30_000
  );
});
