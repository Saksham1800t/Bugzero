import { runScript } from "./scripts";

export const runTests = (cwd?: string) => runScript("test", cwd);
