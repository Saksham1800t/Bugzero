import fs from "fs";
import path from "path";
import { findMatch, MatchStrategy } from "./fuzzy-match";

export interface PatchResult {
  success: boolean;
  backupPath?: string;
  error?: string;
  /**
   * How the search text was located: "exact" unless the AI's snippet didn't
   * match verbatim and a fuzzy fallback (whitespace-normalized or
   * similarity-based) found the intended location instead.
   */
  matchStrategy?: MatchStrategy;
}

/**
 * Applies a search-and-replace patch to a file.
 * Creates a `.opspilot.bak` backup before writing.
 *
 * The search text is located with a tiered fallback: an exact substring
 * match first, then a whitespace-normalized line match, then a
 * similarity-scored line window — so minor formatting drift in the AI's
 * suggestion (indentation, line endings, a slightly reworded line) doesn't
 * sink an otherwise-correct patch.
 *
 * @param absoluteFilePath - Resolved absolute path to the target file
 * @param search           - Code snippet to find in the file
 * @param replace          - String to substitute in place of the match
 */
export function applyPatch(
  absoluteFilePath: string,
  search: string,
  replace: string
): PatchResult {
  try {
    if (!fs.existsSync(absoluteFilePath)) {
      return {
        success: false,
        error: `File not found: ${absoluteFilePath}`,
      };
    }

    const original = fs.readFileSync(absoluteFilePath, "utf-8");

    const match = findMatch(original, search);
    if (!match) {
      return {
        success: false,
        error: `Search string not found in ${path.basename(absoluteFilePath)} (tried exact, whitespace-normalized, and fuzzy matching). The AI's "search" field did not match file content.`,
      };
    }

    // Write backup first
    const backupPath = absoluteFilePath + ".opspilot.bak";
    fs.writeFileSync(backupPath, original, "utf-8");

    // Apply fix (replace only the matched region to stay minimal)
    const fixed = original.slice(0, match.start) + replace + original.slice(match.end);
    fs.writeFileSync(absoluteFilePath, fixed, "utf-8");

    return { success: true, backupPath, matchStrategy: match.strategy };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}
