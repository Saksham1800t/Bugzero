import { Annotation } from "@langchain/langgraph";
import type { AIFixSuggestion } from "@opspilot/shared";

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
  /** Per-command timeout in milliseconds for validation steps (undefined = no limit) */
  timeoutMs: Annotation<number | undefined>({
    reducer: (_, value) => value,
    default: () => undefined,
  }),
});