import { runCommand } from "./run-command";

export const runLint = (cwd?: string) =>
  runCommand("npm run lint", cwd);