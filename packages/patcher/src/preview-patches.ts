import type { ProtectedPathRules } from "@opspilot/shared";
import fs from "fs";
import path from "path";
import { patchContent } from "./apply-patch";
import type { FileChange } from "./diff";
import type { FilePatch } from "./apply-multi-patch";
import { resolvePatchTargets } from "./patch-targets";

export type PatchPreview = { success: true; changes: FileChange[] } | { success: false; error: string };

/**
 * Works out what `applyPatches` would do, without writing anything: the content of each file before and after,
 * with several patches to one file combined. It fails exactly where applying would fail (a path outside the
 * project, a protected file, a missing file, a search text that is not found), with the same message. It uses the
 * same code to locate and apply each patch, so the preview is what would be written.
 */
export function previewPatches(
  cwd: string,
  patches: FilePatch[],
  options: { protection?: ProtectedPathRules } = {}
): PatchPreview {
  if (patches.length === 0) {
    return { success: false, error: "No patches to apply." };
  }

  const targets = resolvePatchTargets(cwd, patches, options.protection);
  if (!targets.ok) return { success: false, error: targets.error };

  const originals = new Map<string, string>();
  const current = new Map<string, string>();

  for (const [index, patch] of patches.entries()) {
    const absolutePath = targets.absolutePaths[index];

    if (!current.has(absolutePath)) {
      try {
        const content = fs.readFileSync(absolutePath, "utf-8");
        originals.set(absolutePath, content);
        current.set(absolutePath, content);
      } catch {
        return { success: false, error: `Failed to patch "${patch.filePath}": File not found: ${absolutePath}` };
      }
    }

    const patched = patchContent(current.get(absolutePath)!, patch.search, patch.replace, path.basename(absolutePath));
    if (!patched.ok) {
      return { success: false, error: `Failed to patch "${patch.filePath}": ${patched.error}` };
    }
    current.set(absolutePath, patched.content);
  }

  const root = path.resolve(cwd);
  const changes: FileChange[] = [...originals.keys()].map((absolutePath) => ({
    filePath: path.relative(root, absolutePath).split(path.sep).join("/"),
    before: originals.get(absolutePath)!,
    after: current.get(absolutePath)!,
  }));
  return { success: true, changes };
}
