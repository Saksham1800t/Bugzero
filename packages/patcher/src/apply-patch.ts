import fs from "fs";
import path from "path";
import { findMatch, MatchStrategy } from "./fuzzy-match";
import { detectLineEnding, withLineEnding } from "./line-endings";

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

export type PatchedContent =
  | { ok: true; content: string; matchStrategy: MatchStrategy }
  | { ok: false; error: string };

/**
 * Applies one search-and-replace patch to text, in memory. This is the single place that decides where a patch
 * lands and what the result is, so previewing a patch and applying it can never disagree.
 *
 * @param fileName - Only used in the error message
 */
export function patchContent(original: string, search: string, replace: string, fileName: string): PatchedContent {
  const match = findMatch(original, search);
  if (!match) {
    return {
      ok: false,
      error: `Search string not found in ${fileName} (tried exact, whitespace-normalized, and fuzzy matching). The AI's "search" field did not match file content.`,
    };
  }

  // Replace only the matched region to stay minimal. The AI writes "\n" line breaks whatever the file uses,
  // so give the new text the line ending of the lines it replaces.
  const replacement = withLineEnding(replace, detectLineEnding(original, match.start, match.end));
  const content = original.slice(0, match.start) + replacement + original.slice(match.end);
  return { ok: true, content, matchStrategy: match.strategy };
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
 * @param options.backup   - Set to false to leave the existing backup untouched (default true).
 *                           Used when the backup already holds the file's original content.
 */
export function applyPatch(
  absoluteFilePath: string,
  search: string,
  replace: string,
  options: { backup?: boolean } = {}
): PatchResult {
  try {
    if (!fs.existsSync(absoluteFilePath)) {
      return {
        success: false,
        error: `File not found: ${absoluteFilePath}`,
      };
    }

    const original = fs.readFileSync(absoluteFilePath, "utf-8");

    const patched = patchContent(original, search, replace, path.basename(absoluteFilePath));
    if (!patched.ok) return { success: false, error: patched.error };

    // Write backup first (replacing any older one)
    const backupPath = absoluteFilePath + ".opspilot.bak";
    if (options.backup !== false) {
      fs.writeFileSync(backupPath, original, "utf-8");
    }

    fs.writeFileSync(absoluteFilePath, patched.content, "utf-8");

    return { success: true, backupPath, matchStrategy: patched.matchStrategy };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}
