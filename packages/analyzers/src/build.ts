import { runCommand } from "./run-command";

export const runBuild = (cwd?: string) =>
  runCommand("npm run build", cwd);