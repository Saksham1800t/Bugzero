import type { orchestrateAndFix } from "@opspilot/core";
import { uniqueFilePaths } from "@opspilot/shared";

type RescueResult = Awaited<ReturnType<typeof orchestrateAndFix>>;

export interface StepInput {
  success: boolean;
  skipped?: boolean;
  timedOut?: boolean;
  output?: string;
}

export type StepStatus = "passed" | "failed" | "skipped";

export interface StepJson {
  status: StepStatus;
  /** Only present on failed steps */
  timedOut?: boolean;
  /** Only present on failed steps: what the command printed (including the timeout notice, if any) */
  output?: string;
}

export function stepStatus(step: StepInput): StepStatus {
  if (step.skipped) return "skipped";
  return step.success ? "passed" : "failed";
}

function stepJson(step: StepInput): StepJson {
  const status = stepStatus(step);
  if (status !== "failed") return { status };
  return { status, timedOut: step.timedOut === true, output: step.output ?? "" };
}

interface ProjectInfo {
  path: string;
  framework: string;
  packageManager: string;
  reportPath: string;
}

export interface HuntJson extends ProjectInfo {
  command: "hunt";
  success: boolean;
  steps: { build: StepJson; lint: StepJson; test: StepJson };
}

/** The result `bugzero hunt --json` prints. `success` is true when no step failed. */
export function buildHuntJson(
  info: ProjectInfo,
  steps: { build: StepInput; lint: StepInput; test: StepInput }
): HuntJson {
  return {
    command: "hunt",
    success: steps.build.success && steps.lint.success && steps.test.success,
    path: info.path,
    framework: info.framework,
    packageManager: info.packageManager,
    steps: { build: stepJson(steps.build), lint: stepJson(steps.lint), test: stepJson(steps.test) },
    reportPath: info.reportPath,
  };
}

export type RescueOutcome = "already-passing" | "fixed" | "failed" | "dry-run";

export interface RescueJson extends ProjectInfo {
  command: "rescue";
  outcome: RescueOutcome;
  success: boolean;
  dryRun: boolean;
  attempts: number;
  model: string | null;
  tokens: { prompt: number; completion: number; total: number } | null;
  fix: { rootCause: string; explanation: string; files: string[] } | null;
  error: string | null;
}

/**
 * The result `bugzero rescue --json` prints. `outcome` distinguishes the four
 * ways a run can end; a dry run that finds failures reports "dry-run" with
 * `success: false`, matching its non-zero exit code.
 */
export function buildRescueJson(result: RescueResult, info: ProjectInfo & { dryRun: boolean }): RescueJson {
  let outcome: RescueOutcome;
  if (result.success && result.attempts === 0) outcome = "already-passing";
  else if (result.success) outcome = "fixed";
  else if (info.dryRun) outcome = "dry-run";
  else outcome = "failed";

  const tokens =
    result.promptTokens !== undefined && result.completionTokens !== undefined
      ? {
          prompt: result.promptTokens,
          completion: result.completionTokens,
          total: result.promptTokens + result.completionTokens,
        }
      : null;

  return {
    command: "rescue",
    outcome,
    success: result.success,
    dryRun: info.dryRun,
    path: info.path,
    framework: info.framework,
    packageManager: info.packageManager,
    attempts: result.attempts,
    model: result.modelUsed || null,
    tokens,
    fix: result.appliedFix
      ? {
          rootCause: result.appliedFix.rootCause,
          explanation: result.appliedFix.explanation,
          files: uniqueFilePaths(result.appliedFix.patches),
        }
      : null,
    error: result.error ?? null,
    reportPath: info.reportPath,
  };
}

/** What either command prints in --json mode when it fails before producing a result. */
export function buildErrorJson(message: string): { success: false; error: string } {
  return { success: false, error: message };
}
