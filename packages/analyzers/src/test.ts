import { detectPackageManager, getRunScriptCommand } from "./package-manager";
import { runCommand } from "./run-command";

export const runTests = (cwd?: string) =>
  runCommand(getRunScriptCommand(detectPackageManager(cwd), "test"), cwd);
