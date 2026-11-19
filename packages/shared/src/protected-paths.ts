import fs from "fs";
import path from "path";

/**
 * Files that hold secrets. They are never edited, and never sent to the AI model, even if an error
 * log mentions their path.
 */
export const DEFAULT_SECRET_PATTERNS: readonly string[] = [".env", ".env.*", "*.pem", "*.key"];

/**
 * Files BugZero never edits by default: secrets, git internals, CI configuration, lockfiles,
 * installed dependencies, and its own backups. A fix that needs one of these should be made by a person.
 */
export const DEFAULT_PROTECTED_PATTERNS: readonly string[] = [
  ...DEFAULT_SECRET_PATTERNS,
  ".git/",
  ".github/workflows/",
  ".gitlab-ci.yml",
  ".circleci/",
  "azure-pipelines.yml",
  "bitbucket-pipelines.yml",
  "Jenkinsfile",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lockb",
  "node_modules/",
  "*.opspilot.bak",
];

/** The `protect` and `allow` settings of a project's `.bugzerorc`. */
export interface ProtectionSettings {
  /** Extra patterns BugZero must never edit. */
  protect?: string[];
  /** Default-protected patterns to permit (a pattern listed in `protect` still wins). */
  allow?: string[];
}

export interface ProtectedPathRules {
  /** The pattern that forbids editing `relPath` (relative to the project), or undefined if editing is allowed. */
  editBlockedBy(relPath: string): string | undefined;
  /** The pattern that keeps `relPath` away from the AI model, or undefined if it may be shown. */
  secretBlockedBy(relPath: string): string | undefined;
}

type Matcher = { pattern: string; test: (normalizedPath: string) => boolean };

function normalizePath(relPath: string): string {
  return relPath
    .replace(/\\/g, "/")
    .replace(/^(\.\/)+/, "")
    .replace(/^\/+/, "")
    .toLowerCase();
}

/** Turns a gitignore-style pattern into a test on a normalized project-relative path. */
function compilePattern(pattern: string): Matcher | undefined {
  if (typeof pattern !== "string") return undefined;
  let p = pattern.trim().replace(/\\/g, "/").toLowerCase();
  if (p === "" || p.startsWith("#")) return undefined;

  // A pattern with a slash anywhere (other than a trailing one) is anchored to the project root;
  // one without matches a file or folder of that name at any depth.
  const anchored = p.startsWith("/") || p.replace(/\/+$/, "").includes("/");
  p = p.replace(/^(\.\/)+/, "").replace(/^\/+/, "").replace(/\/+$/, "");
  if (p === "") return undefined;

  let source = "";
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === "*") {
      if (p[i + 1] === "*") {
        i++;
        if (p[i + 1] === "/") {
          i++;
          source += "(?:.*/)?"; // "**/" matches zero or more folders
        } else {
          source += ".*";
        }
      } else {
        source += "[^/]*";
      }
    } else if (c === "?") {
      source += "[^/]";
    } else {
      source += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }

  // Matching a folder also covers everything beneath it.
  const regex = new RegExp(`^${anchored ? "" : "(?:.*/)?"}${source}(?:/.*)?$`);
  return { pattern: pattern.trim(), test: (normalizedPath) => regex.test(normalizedPath) };
}

function compileAll(patterns: readonly string[] | undefined): Matcher[] {
  return (patterns ?? []).map(compilePattern).filter((m): m is Matcher => m !== undefined);
}

function firstMatch(matchers: Matcher[], normalizedPath: string): Matcher | undefined {
  return matchers.find((m) => m.test(normalizedPath));
}

/**
 * Builds the rules for one project. Without settings you get the defaults.
 * Paths are compared relative to the project, ignoring case and the kind of slash used.
 */
export function createProtectedPathRules(settings: ProtectionSettings = {}): ProtectedPathRules {
  const defaults = compileAll(DEFAULT_PROTECTED_PATTERNS);
  const secrets = compileAll(DEFAULT_SECRET_PATTERNS);
  const extra = compileAll(settings.protect);
  const allowed = compileAll(settings.allow);

  return {
    editBlockedBy(relPath) {
      const normalized = normalizePath(relPath);
      const own = firstMatch(extra, normalized);
      if (own) return own.pattern;
      if (firstMatch(allowed, normalized)) return undefined;
      return firstMatch(defaults, normalized)?.pattern;
    },
    secretBlockedBy(relPath) {
      const normalized = normalizePath(relPath);
      if (firstMatch(allowed, normalized)) return undefined;
      return firstMatch(secrets, normalized)?.pattern;
    },
  };
}

function toRelative(root: string, target: string): string {
  return path.relative(root, target).split(path.sep).join("/");
}

/** Resolves the deepest part of `target` that exists, then re-attaches the rest, so links are followed. */
function realPathAllowingMissing(target: string): string | undefined {
  let current = path.resolve(target);
  const rest: string[] = [];
  while (true) {
    try {
      return path.join(fs.realpathSync.native(current), ...rest.reverse());
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return undefined;
      rest.push(path.basename(current));
      current = parent;
    }
  }
}

/**
 * The project-relative paths to check for `absolutePath`: where it appears to be, and where it really is
 * when a symlink or junction is involved. Checking both stops a harmless-looking link from reaching a
 * protected file.
 */
export function projectRelativePaths(cwd: string, absolutePath: string): string[] {
  const paths = [toRelative(path.resolve(cwd), path.resolve(absolutePath))];

  const realRoot = realPathAllowingMissing(cwd);
  const realTarget = realPathAllowingMissing(absolutePath);
  if (realRoot && realTarget) {
    const real = toRelative(realRoot, realTarget);
    if (real !== paths[0] && !real.startsWith("..")) paths.push(real);
  }
  return paths;
}
