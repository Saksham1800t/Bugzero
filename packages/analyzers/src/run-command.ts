import { killProcessTree } from "./kill-tree";

export interface CommandResult {
  success: boolean;
  output: string;
  /** True when the step was not run because the project doesn't define that script. */
  skipped?: boolean;
  /** True when the command was stopped because it exceeded the configured timeout. */
  timedOut?: boolean;
}

export interface RunCommandOptions {
  /** Stop the command (and everything it spawned) if it runs longer than this many milliseconds. */
  timeoutMs?: number;
}

/** After the kill, how long to wait for the process to actually exit before giving up on it. */
const KILL_GRACE_MS = 5000;

export async function runCommand(
  command: string,
  cwd?: string,
  options: RunCommandOptions = {}
): Promise<CommandResult> {
  // Dynamic import because execa v7+ is ESM-only
  const { execa } = await import("execa");

  const subprocess = execa(command, {
    shell: true,
    cwd: cwd ?? process.cwd(),
    all: true,
    env: {
      ...process.env,
      CI: "true",
    },
  });

  const timedOutResult = (output: string, confirmedStopped: boolean): CommandResult => {
    const seconds = (options.timeoutMs as number) / 1000;
    const note = confirmedStopped ? "and was stopped" : "and could not be confirmed stopped";
    return {
      success: false,
      timedOut: true,
      output: `${output}\n\n[BugZero] Command timed out after ${seconds}s ${note}: ${command}`,
    };
  };

  let timedOut = false;
  let timer: NodeJS.Timeout | undefined;
  let graceTimer: NodeJS.Timeout | undefined;

  // Resolves only if the timeout fired but the process still hasn't exited after the
  // grace period — so a stubborn process can never make the timeout itself hang.
  const gaveUp = new Promise<CommandResult>((resolve) => {
    if (options.timeoutMs === undefined) return;
    timer = setTimeout(() => {
      timedOut = true;
      // execa's own `timeout` only kills the shell and leaves the real process (a hung
      // test run, a dev server) running as an orphan, so kill the whole tree instead.
      if (subprocess.pid !== undefined) killProcessTree(subprocess.pid);
      graceTimer = setTimeout(() => resolve(timedOutResult("", false)), KILL_GRACE_MS);
    }, options.timeoutMs);
  });

  const finished: Promise<CommandResult> = subprocess.then(
    (result) => ({ success: true, output: result.all ?? result.stdout }),
    (err: any) => {
      const output: string = err.all ?? err.stderr ?? err.stdout ?? err.message;
      return timedOut ? timedOutResult(output, true) : { success: false, output };
    }
  );

  try {
    return await Promise.race([finished, gaveUp]);
  } finally {
    clearTimeout(timer);
    clearTimeout(graceTimer);
  }
}
