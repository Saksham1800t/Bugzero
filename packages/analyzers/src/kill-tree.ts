import { spawnSync } from "child_process";
import path from "path";
import treeKill from "tree-kill";

/** Forcefully stops a process and everything it spawned. */
export function killProcessTree(pid: number): void {
  if (process.platform === "win32") {
    // tree-kill launches "taskkill" by bare name, which silently fails when System32
    // isn't on PATH. Use the absolute path so the kill can't depend on the environment.
    const systemRoot = process.env.SystemRoot ?? process.env.windir ?? "C:\\Windows";
    const taskkill = path.join(systemRoot, "System32", "taskkill.exe");
    spawnSync(taskkill, ["/pid", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    return;
  }
  treeKill(pid, "SIGKILL");
}
