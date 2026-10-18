import { runScript } from "./scripts";

export const runBuild = (cwd?: string) => runScript("build", cwd);
