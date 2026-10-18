import fs from "fs";
import path from "path";

/** Fails fast with a clear message when `cwd` isn't a Node.js project, instead of reporting a confusing build failure. */
export function assertNodeProject(cwd: string): void {
  if (!fs.existsSync(path.join(cwd, "package.json"))) {
    throw new Error(`No package.json found in ${cwd}. Point --path at a Node.js project.`);
  }
}
