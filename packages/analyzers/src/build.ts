import type { RunCommandOptions } from "./run-command";
import { runScript } from "./scripts";

export const runBuild = (cwd?: string, options?: RunCommandOptions) => runScript("build", cwd, options);
