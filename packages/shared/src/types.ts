export interface AnalysisResult {
  success: boolean;
  output: string;
}

export interface ParsedError {
  type: "typescript" | "eslint" | "jest" | "unknown";
  file?: string;
  line?: number;
  column?: number;
  message: string;
  raw: string;
}

export interface AIAnalysis {
  summary: string;
  rootCause: string;
  recommendation: string;
}

/** A single search-and-replace edit within an AI fix suggestion */
export interface AIPatch {
  /** Relative path from project root to the file that needs changing */
  filePath: string;
  /** Code snippet to search for (matched exactly, then via fuzzy fallback) */
  search: string;
  /** Replacement code that fixes the issue */
  replace: string;
}

/** Structured fix suggestion returned by the AI */
export interface AIFixSuggestion {
  rootCause: string;
  /** One or more file edits that together resolve the failure, applied atomically */
  patches: AIPatch[];
  /** Human-readable explanation of the change */
  explanation: string;
}

/** Result returned by orchestrateAndFix() */
export interface FixResult {
  success: boolean;
  attempts: number;
  finalOutput?: string;
  appliedFix?: AIFixSuggestion;
  error?: string;
  modelUsed?: string;
  promptTokens?: number;
  completionTokens?: number;
  /**
   * Set instead of running the repair when only the first prompt was requested (`rescue --print-prompt`):
   * the exact text that would have been sent to the AI model. Nothing was sent.
   */
  promptPreview?: string;
  /** How many proposed fixes the person declined (only set when approval was requested and some were declined) */
  declinedFixes?: number;
  /**
   * Set when the run stopped before using all its attempts: they were not making progress, or the token budget
   * did not leave enough for another request
   */
  stoppedEarly?: "no-progress" | "token-budget";
  /** Only set when a token budget was given and the run got far enough to use it */
  tokenBudget?: TokenBudgetUse;
}

/** How much of a run's token budget was used, by the fix attempts and the report together */
export interface TokenBudgetUse {
  limit: number;
  used: number;
  /** True when part of `used` is an estimate because the model did not report it */
  estimated: boolean;
}

/** What a person is shown before a proposed fix is written (see `rescue --approve`). */
export interface ApprovalRequest {
  /** Which attempt this fix came from, starting at 1 */
  attempt: number;
  maxAttempts: number;
  rootCause: string;
  explanation: string;
  /** The files the fix would change */
  files: string[];
  /** The whole fix as a unified diff */
  diff: string;
}

/** The person's answer. A note on a declined fix is passed on to the AI for its next attempt. */
export type ApprovalDecision = { approved: true } | { approved: false; note?: string };

/** Asks whether a proposed fix may be written. Nothing is changed until it answers `approved: true`. */
export type ApprovalHandler = (request: ApprovalRequest) => Promise<ApprovalDecision>;
