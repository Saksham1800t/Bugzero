import { resolveInsideProject } from "@opspilot/shared";
import fs from "fs";
import { applyPatch } from "./apply-patch";
import { MatchStrategy } from "./fuzzy-match";

export interface FilePatch {
  /** Relative path from `cwd` to the file that needs changing */
  filePath: string;
  search: string;
  replace: string;
}

export interface AppliedFilePatch {
  filePath: string;
  absolutePath: string;
  backupPath: string;
  matchStrategy: MatchStrategy;
}

export interface MultiPatchResult {
  success: boolean;
  error?: string;
  applied: AppliedFilePatch[];
}

/** Restores every touched file to its pre-batch content and cleans up the backups left behind. */
function rollback(originalContent: Map<string, string>, backupPaths: Set<string>) {
  for (const [absolutePath, content] of originalContent) {
    try {
      fs.writeFileSync(absolutePath, content, "utf-8");
    } catch {
      // best-effort rollback — leave the file as-is if it can't be restored
    }
  }
  for (const backupPath of backupPaths) {
    try {
      fs.unlinkSync(backupPath);
    } catch {
      // best-effort cleanup
    }
  }
}

export interface ApplyPatchesOptions {
  /**
   * Absolute paths of files whose `.opspilot.bak` already holds their original content because an
   * earlier batch in the same run patched them. Their backups are left alone, so the backup always
   * restores what the user had, not the result of an earlier attempt. Any other file gets a fresh
   * backup (replacing a stale one) the first time it is patched.
   */
  alreadyBackedUp?: Iterable<string>;
}

/**
 * Applies a batch of search-and-replace patches — possibly across multiple
 * files, possibly multiple edits to the same file — as a single atomic
 * operation. If any patch fails to find its match, every file touched by
 * this batch (including earlier successful patches within it) is rolled
 * back to its state before the batch started, so a partially-correct
 * multi-file fix is never left half-applied.
 */
export function applyPatches(
  cwd: string,
  patches: FilePatch[],
  options: ApplyPatchesOptions = {}
): MultiPatchResult {
  if (patches.length === 0) {
    return { success: false, error: "No patches to apply.", applied: [] };
  }

  // Check every path before touching anything: a model-supplied path must stay inside the
  // project, and one bad path means no file at all is changed.
  const absolutePaths: string[] = [];
  for (const patch of patches) {
    const resolved = resolveInsideProject(cwd, patch.filePath);
    if (!resolved.ok) {
      return {
        success: false,
        error: `Failed to patch "${patch.filePath}": ${resolved.error}`,
        applied: [],
      };
    }
    absolutePaths.push(resolved.absolutePath);
  }

  const originalContent = new Map<string, string>();
  const backupPaths = new Set<string>();
  const applied: AppliedFilePatch[] = [];
  // Files whose backup holds their original content: from an earlier batch, or written earlier in this one.
  const backedUp = new Set(options.alreadyBackedUp ?? []);

  for (const [index, patch] of patches.entries()) {
    const absolutePath = absolutePaths[index];

    if (!originalContent.has(absolutePath)) {
      try {
        originalContent.set(absolutePath, fs.readFileSync(absolutePath, "utf-8"));
      } catch {
        rollback(originalContent, backupPaths);
        return {
          success: false,
          error: `Failed to patch "${patch.filePath}": File not found: ${absolutePath}`,
          applied: [],
        };
      }
    }

    const needsBackup = !backedUp.has(absolutePath);
    const result = applyPatch(absolutePath, patch.search, patch.replace, { backup: needsBackup });
    if (result.success && needsBackup) {
      backedUp.add(absolutePath);
      // Only backups created by this batch are cleaned up on rollback; earlier ones must survive.
      backupPaths.add(result.backupPath!);
    }

    if (!result.success) {
      rollback(originalContent, backupPaths);
      return {
        success: false,
        error: `Failed to patch "${patch.filePath}": ${result.error}`,
        applied: [],
      };
    }

    applied.push({
      filePath: patch.filePath,
      absolutePath,
      backupPath: result.backupPath!,
      matchStrategy: result.matchStrategy!,
    });
  }

  return { success: true, applied };
}
