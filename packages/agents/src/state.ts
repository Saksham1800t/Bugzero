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
});