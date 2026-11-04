import type { RunCommandOptions } from "./run-command";
import { runScript } from "./scripts";

export const runTests = (cwd?: string, options?: RunCommandOptions) => runScript("test", cwd, options);
