import fs from "fs";
import path from "path";
import { runBuild } from "./build";
import { runLint } from "./lint";
import { runTests } from "./test";

export interface PipelineResult {
  success: boolean;
  step: "build" | "lint" | "test" | "none";
  output: string;
}

export async function runValidationPipeline(cwd?: string): Promise<PipelineResult> {
  const targetCwd = cwd ?? process.cwd();

  // 1. Read package.json to see which scripts exist
  let scripts: string[] = [];
  try {
    const pkgPath = path.resolve(targetCwd, "package.json");
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
      scripts = Object.keys(pkg.scripts || {});
    }
  } catch {
    // Ignore error
  }

  // 2. Run Build
  console.log(`[BugZero] Running build...`);
  const buildRes = await runBuild(targetCwd);
  if (!buildRes.success) {
    return { success: false, step: "build", output: buildRes.output };
  }

  // 3. Run Lint (if "lint" script exists)
  if (scripts.includes("lint")) {
    console.log(`[BugZero] Running lint...`);
    const lintRes = await runLint(targetCwd);
    if (!lintRes.success) {
      return { success: false, step: "lint", output: lintRes.output };
    }
  }

  // 4. Run Test (if "test" script exists)
  if (scripts.includes("test")) {
    console.log(`[BugZero] Running tests...`);
    const testRes = await runTests(targetCwd);
    if (!testRes.success) {
      return { success: false, step: "test", output: testRes.output };
    }
  }

  return { success: true, step: "none", output: "" };
}
