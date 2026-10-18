import { runBuild } from "./build";
import { runLint } from "./lint";
import { readScripts } from "./scripts";
import { runTests } from "./test";

export interface PipelineResult {
  success: boolean;
  step: "build" | "lint" | "test" | "none";
  output: string;
}

const STEPS = [
  { step: "build", label: "build", run: runBuild },
  { step: "lint", label: "lint", run: runLint },
  { step: "test", label: "tests", run: runTests },
] as const;

/**
 * Runs the project's build, lint, and test scripts in order, stopping at the
 * first failure. Steps the project doesn't define a script for are skipped.
 */
export async function runValidationPipeline(cwd?: string): Promise<PipelineResult> {
  const targetCwd = cwd ?? process.cwd();
  const scripts = readScripts(targetCwd);

  let ranAnyStep = false;

  for (const { step, label, run } of STEPS) {
    if (!scripts.includes(step)) {
      console.log(`[BugZero] Skipping ${label}: no "${step}" script in package.json.`);
      continue;
    }

    ranAnyStep = true;
    console.log(`[BugZero] Running ${label}...`);
    const result = await run(targetCwd);
    if (!result.success) {
      return { success: false, step, output: result.output };
    }
  }

  if (!ranAnyStep) {
    console.warn(`[BugZero] No build, lint, or test scripts found in package.json — nothing to validate.`);
  }

  return { success: true, step: "none", output: "" };
}
