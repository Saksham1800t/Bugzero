/**
 * The distinct files touched by a list of patches, in the order each file first
 * appears. A fix can patch the same file in more than one attempt, so anything
 * that lists "the files that changed" must not repeat it.
 */
export function uniqueFilePaths(patches: { filePath: string }[]): string[] {
  return [...new Set(patches.map((patch) => patch.filePath))];
}
