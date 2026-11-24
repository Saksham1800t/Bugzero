import { parseErrors } from "@opspilot/analyzers";

/** The validation steps, in the order they run. A later step failing means the earlier ones now pass. */
export type PipelineStep = "build" | "lint" | "test" | "none";

const STEP_ORDER: Record<PipelineStep, number> = { build: 0, lint: 1, test: 2, none: 3 };

/** What one failing run of the project looked like. */
export interface ErrorSnapshot {
  step: PipelineStep;
  /** How many errors BugZero could count, or null when the output is in a format it does not parse */
  errorCount: number | null;
  /** The output with colours and line endings normalised, used to tell whether two runs failed identically */
  fingerprint: string;
}

/** Where a repair run stands: the best result so far, the latest, and how many attempts in a row did not beat the best. */
export interface ProgressTracker {
  best: ErrorSnapshot;
  last: ErrorSnapshot;
  stagnantAttempts: number;
}

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\u001b\[[0-9;]*[A-Za-z]/g;

export function snapshotOf(step: PipelineStep, output: string): ErrorSnapshot {
  const errors = parseErrors(output);
  const countable = errors.length > 0 && errors[0].type !== "unknown";
  return {
    step,
    errorCount: countable ? errors.length : null,
    fingerprint: output.replace(ANSI_RE, "").replace(/\r\n/g, "\n").trim(),
  };
}

/**
 * True when `current` is a real step forward from `best`: the failing step moved later (so the earlier steps
 * now pass), or it is the same step with fewer errors. When the errors cannot be counted, BugZero cannot say
 * whether the output got better, so any change counts as progress; only the very same output does not.
 */
export function isProgress(best: ErrorSnapshot, last: ErrorSnapshot, current: ErrorSnapshot): boolean {
  const stepDifference = STEP_ORDER[current.step] - STEP_ORDER[best.step];
  if (stepDifference !== 0) return stepDifference > 0;

  if (best.errorCount !== null && current.errorCount !== null) {
    return current.errorCount < best.errorCount;
  }
  return current.fingerprint !== best.fingerprint && current.fingerprint !== last.fingerprint;
}

export function startTracking(initial: ErrorSnapshot): ProgressTracker {
  return { best: initial, last: initial, stagnantAttempts: 0 };
}

/**
 * Records the result of one verified attempt. An attempt that beats the best result so far resets the count of
 * attempts without progress; any other attempt (flat, worse, or back to an earlier state) adds one.
 * With nothing to compare against yet, the result simply becomes the starting point.
 */
export function recordAttempt(tracker: ProgressTracker | null, current: ErrorSnapshot): ProgressTracker {
  if (tracker === null) return startTracking(current);
  if (isProgress(tracker.best, tracker.last, current)) {
    return { best: current, last: current, stagnantAttempts: 0 };
  }
  return { best: tracker.best, last: current, stagnantAttempts: tracker.stagnantAttempts + 1 };
}

/** A short description of a snapshot for log messages, such as "3 errors in build". */
export function describeSnapshot(snapshot: ErrorSnapshot): string {
  const where = snapshot.step === "none" ? "" : ` in ${snapshot.step}`;
  if (snapshot.errorCount === null) return `output it cannot count${where}`;
  return `${snapshot.errorCount} error${snapshot.errorCount === 1 ? "" : "s"}${where}`;
}
