import {
  createProtectedPathRules,
  projectRelativePaths,
  resolveInsideProject,
  type ProtectedPathRules,
} from "@opspilot/shared";

export type PatchTargets = { ok: true; absolutePaths: string[] } | { ok: false; error: string };

/**
 * Checks every file a set of patches wants to change, before anything is read or written: each path must stay
 * inside the project and must not be a protected file. One bad path rejects the whole set. Shared by applying
 * and previewing patches, so both refuse exactly the same things, with the same message.
 */
export function resolvePatchTargets(
  cwd: string,
  patches: { filePath: string }[],
  protection: ProtectedPathRules = createProtectedPathRules()
): PatchTargets {
  const absolutePaths: string[] = [];
  for (const patch of patches) {
    const resolved = resolveInsideProject(cwd, patch.filePath);
    if (!resolved.ok) {
      return { ok: false, error: `Failed to patch "${patch.filePath}": ${resolved.error}` };
    }
    // Check where the file appears to be and where it really is, so a link cannot hide a protected file.
    for (const relPath of projectRelativePaths(cwd, resolved.absolutePath)) {
      const pattern = protection.editBlockedBy(relPath);
      if (pattern !== undefined) {
        return {
          ok: false,
          error: `Failed to patch "${patch.filePath}": this file is protected (it matches "${pattern}"), so BugZero never edits it. Fix the problem in a different file.`,
        };
      }
    }
    absolutePaths.push(resolved.absolutePath);
  }
  return { ok: true, absolutePaths };
}
