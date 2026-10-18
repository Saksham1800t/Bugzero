import { runScript } from "./scripts";

export const runLint = (cwd?: string) => runScript("lint", cwd);
