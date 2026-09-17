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

/** Structured fix suggestion returned by the AI */
export interface AIFixSuggestion {
  rootCause: string;
  /** Relative path from project root to the file that needs changing */
  filePath: string;
  /** Exact code snippet to search for (must match file content exactly) */
  search: string;
  /** Replacement code that fixes the issue */
  replace: string;
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
}