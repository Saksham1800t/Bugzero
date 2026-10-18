import fs from "fs";
import path from "path";
import { detectPackageManager, getRunScriptCommand } from "./package-manager";
import { runCommand, type CommandResult } from "./run-command";

/** Names of the scripts defined in the project's package.json (empty if it can't be read). */
export function readScripts(cwd: string = process.cwd()): string[] {
  try {
    const pkgPath = path.join(cwd, "package.json");
    if (!fs.existsSync(pkgPath)) return [];
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
    if (typeof pkg.scripts !== "object" || pkg.scripts === null) return [];
    return Object.keys(pkg.scripts);
  } catch {
    return [];
  }
}

/**
 * Runs a package.json script with the project's package manager. If the
 * project doesn't define the script, the step is reported as skipped
 * rather than failed — a missing "lint" script isn't a lint failure.
 */
export async function runScript(script: string, cwd?: string): Promise<CommandResult> {
  if (!readScripts(cwd).includes(script)) {
    return { success: true, output: "", skipped: true };
  }
  return runCommand(getRunScriptCommand(detectPackageManager(cwd), script), cwd);
}
