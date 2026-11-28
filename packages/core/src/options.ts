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

/**
 * Whether `rescue` may re-run only the failing test files while it is still failing them. On unless turned off
 * with `--no-focus-tests` or `"focusTests": false` in `.bugzerorc`; the flag wins. Anything in `.bugzerorc` that
 * is not true or false is rejected, naming the file, rather than being ignored.
 */
export function resolveFocusTests(flag: boolean | undefined, configured: unknown): boolean {
  if (flag !== undefined) return flag;
  if (configured === undefined) return true;
  if (typeof configured !== "boolean") {
    throw new Error(`focusTests in .bugzerorc must be true or false (received ${JSON.stringify(configured)}).`);
  }
  return configured;
}

/**
 * The token budget for a run: the `--max-tokens` flag if given, else `maxTokens` from `.bugzerorc`, else no
 * limit. 0 also means no limit, so the flag can lift one set in the file. A value that is not a whole number of 0
 * or more is rejected, naming where it came from.
 */
export function resolveMaxTokens(flag: number | undefined, configured: unknown): number | undefined {
  const source = flag !== undefined ? "--max-tokens" : "maxTokens in .bugzerorc";
  const value = flag !== undefined ? flag : configured;
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error(`${source} must be a whole number of 0 or more, where 0 means no limit (received ${JSON.stringify(value) ?? String(value)}).`);
  }
  return value === 0 ? undefined : value;
}

/** How many attempts in a row may make no progress before a run stops early, unless set otherwise. */
export const DEFAULT_PATIENCE = 2;

/**
 * Works out the patience for a run: the `--patience` flag if given, else `patience` from `.bugzerorc`, else the
 * default. 0 means never stop early. A value that is not a whole number of 0 or more is rejected, naming where it
 * came from, rather than being ignored.
 */
export function resolvePatience(flag: number | undefined, configured: unknown): number {
  const source = flag !== undefined ? "--patience" : "patience in .bugzerorc";
  const value = flag !== undefined ? flag : configured;
  if (value === undefined) return DEFAULT_PATIENCE;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error(`${source} must be a whole number of 0 or more, where 0 turns it off (received ${JSON.stringify(value) ?? String(value)}).`);
  }
  return value;
}
