import fs from "fs";
import path from "path";

/** True when `target` is `root` itself or lies inside it. Pure path arithmetic: it does not touch the filesystem. */
export function isLexicallyInside(root: string, target: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  const escapes = relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
  return !escapes;
}

/**
 * True when `target` is `root` or lies inside it, after following symlinks and
 * junctions. For a path that does not exist yet, the deepest ancestor that does
 * exist is checked, so a symlinked directory pointing outside the project can't
 * be used to reach outside it.
 */
export function isInsideDirectory(root: string, target: string): boolean {
  const absoluteTarget = path.resolve(target);
  if (!isLexicallyInside(root, absoluteTarget)) return false;

  try {
    let probe = absoluteTarget;
    while (!fs.existsSync(probe)) {
      const parent = path.dirname(probe);
      if (parent === probe) return false;
      probe = parent;
    }
    // `.native` also expands Windows 8.3 short names, so both sides compare in the same form.
    return isLexicallyInside(fs.realpathSync.native(root), fs.realpathSync.native(probe));
  } catch {
    return false; // when in doubt, treat it as outside
  }
}

export type ResolvedPath = { ok: true; absolutePath: string } | { ok: false; error: string };

/**
 * Resolves a file path suggested by the model (normally relative to the project
 * root) and confirms it stays inside the project. The error text is written to be
 * shown back to the model so it can correct itself.
 */
export function resolveInsideProject(cwd: string, filePath: string): ResolvedPath {
  if (typeof filePath !== "string" || filePath.trim() === "") {
    return { ok: false, error: "The file path is empty. Use a path relative to the project root." };
  }
  if (filePath.includes("\0")) {
    return { ok: false, error: "The file path contains a null character." };
  }

  const absolutePath = path.resolve(cwd, filePath);

  if (path.resolve(cwd) === absolutePath) {
    return { ok: false, error: `"${filePath}" is the project directory itself, not a file.` };
  }
  if (!isInsideDirectory(cwd, absolutePath)) {
    return {
      ok: false,
      error: `"${filePath}" is outside the project directory. Use a path relative to the project root.`,
    };
  }

  return { ok: true, absolutePath };
}
