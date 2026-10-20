export const DEFAULT_MAX_ATTEMPTS = 3;

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
