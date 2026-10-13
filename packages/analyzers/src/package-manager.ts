import fs from "fs";
import path from "path";

export type PackageManager = "npm" | "pnpm" | "yarn" | "bun";

const VALID_MANAGERS: readonly PackageManager[] = ["npm", "pnpm", "yarn", "bun"];

const LOCKFILE_MANAGERS: { file: string; manager: PackageManager }[] = [
  { file: "pnpm-workspace.yaml", manager: "pnpm" },
  { file: "pnpm-lock.yaml", manager: "pnpm" },
  { file: "yarn.lock", manager: "yarn" },
  { file: "bun.lockb", manager: "bun" },
  { file: "bun.lock", manager: "bun" },
  { file: "package-lock.json", manager: "npm" },
];

/**
 * Detects which package manager a target project uses, so BugZero runs
 * build/lint/test scripts the same way the project's own contributors
 * would — rather than assuming npm.
 *
 * Priority: an explicit `"packageManager"` field in package.json (the
 * Corepack convention, and the most authoritative signal) first, then
 * lockfile/workspace-file presence, then npm as the default.
 */
export function detectPackageManager(cwd: string = process.cwd()): PackageManager {
  try {
    const pkgPath = path.join(cwd, "package.json");
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
      if (typeof pkg.packageManager === "string") {
        const name = pkg.packageManager.split("@")[0].trim();
        if ((VALID_MANAGERS as string[]).includes(name)) {
          return name as PackageManager;
        }
      }
    }
  } catch {
    // Malformed package.json — fall through to lockfile detection
  }

  for (const { file, manager } of LOCKFILE_MANAGERS) {
    if (fs.existsSync(path.join(cwd, file))) return manager;
  }

  return "npm";
}

/** Builds the command to run a package.json script with the given package manager. */
export function getRunScriptCommand(manager: PackageManager, script: string): string {
  return `${manager} run ${script}`;
}
