import fs from "fs";
import path from "path";

export interface PatchResult {
  success: boolean;
  backupPath?: string;
  error?: string;
}

/**
 * Applies a search-and-replace patch to a file.
 * Creates a `.opspilot.bak` backup before writing.
 *
 * @param absoluteFilePath - Resolved absolute path to the target file
 * @param search           - Exact substring to find in the file
 * @param replace          - String to substitute in place of `search`
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

    if (!original.includes(search)) {
      return {
        success: false,
        error: `Search string not found in ${path.basename(absoluteFilePath)}. The AI's "search" field did not match file content.`,
      };
    }

    // Write backup first
    const backupPath = absoluteFilePath + ".opspilot.bak";
    fs.writeFileSync(backupPath, original, "utf-8");

    // Apply fix (replace only first occurrence to stay minimal)
    const fixed = original.replace(search, replace);
    fs.writeFileSync(absoluteFilePath, fixed, "utf-8");

    return { success: true, backupPath };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}