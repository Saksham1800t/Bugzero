import { detectPackageManager, getRunScriptCommand } from "./package-manager";
import { runCommand } from "./run-command";

export const runLint = (cwd?: string) =>
  runCommand(getRunScriptCommand(detectPackageManager(cwd), "lint"), cwd);
