export const DEFAULT_MAX_ATTEMPTS = 3;

/**
 * Validates the per-command timeout and converts it to milliseconds.
 * `undefined` means no timeout. Anything that isn't a positive, finite number
 * is rejected rather than silently becoming "no timeout" or "instant timeout".
 */
export function resolveTimeoutMs(seconds: number | undefined): number | undefined {
  if (seconds === undefined) return undefined;
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new Error(`--timeout must be a positive number of seconds (received ${seconds}).`);
  }
  return Math.round(seconds * 1000);
}

/**
 * Validates the requested number of fix attempts. Without this, a value like
 * "abc" becomes NaN, which never satisfies the loop's stop condition and keeps
 * paying for AI calls.
 */
export function resolveMaxAttempts(value: number | undefined): number {
  const attempts = value ?? DEFAULT_MAX_ATTEMPTS;
  if (!Number.isInteger(attempts) || attempts < 1) {
    throw new Error(`--max-attempts must be a whole number of 1 or more (received ${value}).`);
  }
  return attempts;
}
