import { detectPackageManager, getRunScriptCommand } from "./package-manager";
import { runCommand } from "./run-command";

export const runBuild = (cwd?: string) =>
  runCommand(getRunScriptCommand(detectPackageManager(cwd), "build"), cwd);
