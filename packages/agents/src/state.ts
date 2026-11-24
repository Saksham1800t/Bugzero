import { Annotation } from "@langchain/langgraph";
import type { AIFixSuggestion, ApprovalHandler } from "@opspilot/shared";
import type { ProgressTracker } from "./progress";

export const GraphState = Annotation.Root({
  /** Absolute path to the project being fixed */
  cwd: Annotation<string>({
    reducer: (_, value) => value,
    default: () => process.cwd(),
  }),
  /** Raw error output from the failing command */
  logs: Annotation<string>({
    reducer: (_, value) => value,
    default: () => "",
  }),
  /** Full text response from the AI */
  analysis: Annotation<string>({
    reducer: (_, value) => value,
    default: () => "",
  }),
  /** Structured fix parsed from the AI response */
  fixSuggestion: Annotation<AIFixSuggestion | null>({
    reducer: (_, value) => value,
    default: () => null,
  }),
  /**
   * Everything that has actually been written to disk so far, across ALL attempts.
   * `fixSuggestion` is replaced on every attempt, so it can't answer "what changed?" —
   * earlier attempts' edits stay on disk even after a later attempt proposes something new.
   * Patches accumulate in order; rootCause and explanation come from the latest applied attempt.
   */
  appliedFix: Annotation<AIFixSuggestion | null>({
    reducer: (previous, applied) =>
      applied === null
        ? previous
        : {
            rootCause: applied.rootCause,
            explanation: applied.explanation,
            patches: [...(previous?.patches ?? []), ...applied.patches],
          },
    default: () => null,
  }),
  /**
   * Absolute paths of files whose `.opspilot.bak` already holds their original content, across ALL attempts.
   * Later attempts leave those backups alone; otherwise a second edit would overwrite the backup with
   * the first attempt's result and the user's original would be lost.
   */
  backedUpFiles: Annotation<string[]>({
    reducer: (previous, added) => [...new Set([...previous, ...added])],
    default: () => [],
  }),
  /**
   * True when the current attempt's patch could not be applied, so there is nothing new to verify.
   * Every attempt sets it afresh. (This used to be inferred from a warning left in `logs`, which stayed
   * there after the failure and made every later attempt skip verification too.)
   */
  patchFailed: Annotation<boolean>({
    reducer: (_, value) => value,
    default: () => false,
  }),
  /** Number of fix attempts made so far */
  attempts: Annotation<number>({
    reducer: (_, value) => value,
    default: () => 0,
  }),
  /** Maximum allowed attempts before giving up */
  maxAttempts: Annotation<number>({
    reducer: (_, value) => value,
    default: () => 3,
  }),
  /** Whether the last build verification succeeded */
  success: Annotation<boolean>({
    reducer: (_, value) => value,
    default: () => false,
  }),
  /** Model used for the repair */
  modelUsed: Annotation<string>({
    reducer: (_, value) => value,
    default: () => "",
  }),
  /** Total prompt tokens used */
  promptTokens: Annotation<number>({
    reducer: (old, value) => old + value,
    default: () => 0,
  }),
  /** Total completion tokens used */
  completionTokens: Annotation<number>({
    reducer: (old, value) => old + value,
    default: () => 0,
  }),
  /** When set, each proposed fix is shown to this handler and only written if it approves */
  approve: Annotation<ApprovalHandler | undefined>({
    reducer: (_, value) => value,
    default: () => undefined,
  }),
  /** How many proposed fixes the person declined */
  declinedFixes: Annotation<number>({
    reducer: (total, added) => total + added,
    default: () => 0,
  }),
  /** How many attempts in a row may make no progress before the run stops early (0 = never stop early) */
  patience: Annotation<number>({
    reducer: (_, value) => value,
    default: () => 0,
  }),
  /** The best result so far and how many attempts in a row did not beat it (null until there is one to compare to) */
  progress: Annotation<ProgressTracker | null>({
    reducer: (_, value) => value,
    default: () => null,
  }),
  /** Whether, while tests are what is failing, verification may re-run only the failing test files first */
  focusTests: Annotation<boolean>({
    reducer: (_, value) => value,
    default: () => true,
  }),
  /** True when the run stopped before max attempts because attempts were not making progress */
  stoppedForNoProgress: Annotation<boolean>({
    reducer: (_, value) => value,
    default: () => false,
  }),
  /** Per-command timeout in milliseconds for validation steps (undefined = no limit) */
  timeoutMs: Annotation<number | undefined>({
    reducer: (_, value) => value,
    default: () => undefined,
  }),
});