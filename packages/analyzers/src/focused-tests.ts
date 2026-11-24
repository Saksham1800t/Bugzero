import fs from "fs";
import path from "path";
import { resolveInsideProject } from "@opspilot/shared";
import { detectPackageManager, type PackageManager } from "./package-manager";
import { runCommand, type CommandResult, type RunCommandOptions } from "./run-command";
import { readScriptText } from "./scripts";

export type TestRunner = "vitest" | "jest";

/** A re-run of just the test files that failed last time. */
export interface FocusedTestPlan {
  runner: TestRunner;
  /** The failing test files, relative to the project, with forward slashes */
  files: string[];
  /** The exact command to run */
  command: string;
}

/** Past this many failing files, run everything: a partial run would hide the rest. */
const MAX_FOCUSED_FILES = 10;

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\u001b\[[0-9;]*[A-Za-z]/g;

// Jest: "FAIL src/sum.test.ts" or "FAIL  src/sum.test.ts (5.2 s)".
// Vitest: " FAIL  src/sum.test.ts > suite > test", or " FAIL  |project| src/sum.test.ts > ...".
const FAIL_LINE_RE = /^[ \t]*FAIL[ \t]+(?:\|[^|\n]*\|[ \t]+)?(\S+)/gm;

const TEST_FILE_RE = /\.(test|spec)\.[cm]?[jt]sx?$|(^|\/)__tests__\//;

// What a file name may contain to be put on a command line. The names come from test output, which a test or
// a dependency can influence, so anything that could mean something to a shell is left out, not escaped.
const SAFE_PATH_RE = /^[A-Za-z0-9_@.+/-]+$/;

/**
 * Which test runner a project's `test` script uses, or null when that cannot be told for certain. Only a single
 * plain command is recognised (optionally behind `npx`, `cross-env` and the like); a script that chains
 * commands, pipes, redirects or substitutes could do anything with extra arguments, so it is left alone.
 */
export function detectTestRunner(script: string | undefined): TestRunner | null {
  if (typeof script !== "string" || script.trim() === "") return null;
  if (/[&|;<>`$()]/.test(script)) return null;

  const names = new Set<TestRunner>();
  for (const token of script.trim().split(/\s+/)) {
    const name = token.split(/[\\/]/).pop();
    if (name === "vitest" || name === "jest") names.add(name);
  }
  return names.size === 1 ? [...names][0] : null;
}

/**
 * The test files named on the FAIL lines of Jest or Vitest output. Only files that exist inside the project and
 * look like test files are returned, with names that are safe to put on a command line. Returns an empty list
 * when there are more than a handful, since re-running only some of them would hide the others.
 */
export function findFailingTestFiles(cwd: string, output: string): string[] {
  const text = output.replace(ANSI_RE, "").replace(/\r\n/g, "\n");
  const files: string[] = [];

  for (const match of text.matchAll(FAIL_LINE_RE)) {
    const candidate = match[1].replace(/\\/g, "/").replace(/^\.\//, "");
    if (files.includes(candidate)) continue;
    if (!SAFE_PATH_RE.test(candidate) || candidate.startsWith("-") || candidate.split("/").includes("..")) continue;
    if (!TEST_FILE_RE.test(candidate)) continue;

    const resolved = resolveInsideProject(cwd, candidate);
    if (!resolved.ok) continue;
    try {
      if (!fs.statSync(resolved.absolutePath).isFile()) continue;
    } catch {
      continue;
    }
    files.push(candidate);
  }

  return files.length > MAX_FOCUSED_FILES ? [] : files;
}

/** How each package manager passes extra arguments on to a script. npm needs `--`; the others pass them as they are. */
function focusedCommand(manager: PackageManager, files: string[]): string {
  const args = files.map((file) => `"${file}"`).join(" ");
  return manager === "npm" ? `npm run test -- ${args}` : `${manager} run test ${args}`;
}

/**
 * Works out a re-run of only the test files named in `output`, or null when there is none to do: no `test` script,
 * a runner BugZero does not know how to point at a file, or no failing test file in the output.
 */
export function planFocusedTests(cwd: string, output: string): FocusedTestPlan | null {
  const runner = detectTestRunner(readScriptText(cwd, "test"));
  if (runner === null) return null;

  const files = findFailingTestFiles(cwd, output);
  if (files.length === 0) return null;

  return { runner, files, command: focusedCommand(detectPackageManager(cwd), files) };
}

export function runFocusedTests(plan: FocusedTestPlan, cwd: string, options?: RunCommandOptions): Promise<CommandResult> {
  return runCommand(plan.command, cwd, options);
}

/**
 * Whether a failed focused run is a real test failure that can be reported as the result. A run that fails
 * without naming any failing test file did not run the tests properly (the runner found no tests, or rejected
 * an argument), so it says nothing about the fix and the full pipeline should run instead. A timeout is real.
 */
export function usableFocusedResult(cwd: string, result: CommandResult): boolean {
  if (result.success) return false;
  if (result.timedOut) return true;
  return findFailingTestFiles(cwd, result.output).length > 0;
}
