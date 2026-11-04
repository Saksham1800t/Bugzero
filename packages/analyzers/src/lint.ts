import type { RunCommandOptions } from "./run-command";
import { runScript } from "./scripts";

export const runLint = (cwd?: string, options?: RunCommandOptions) => runScript("lint", cwd, options);
