import { runCommand } from "./run-command";

export const runTests = (cwd?: string) =>
  runCommand("npm run test", cwd);