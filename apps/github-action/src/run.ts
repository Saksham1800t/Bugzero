import fs from "fs";
import path from "path";
import { orchestrateAndFix } from "@opspilot/core";
import { MinimalOctokit, openFixPullRequest, RepoRef } from "./open-pull-request";

export interface RunOptions {
  cwd: string;
  maxAttempts: number;
  octokit: MinimalOctokit;
  repo: RepoRef;
  baseBranch: string;
  branchPrefix?: string;
}

export interface RunResult {
  fixed: boolean;
  prUrl?: string;
  prNumber?: number;
  reason?: string;
}

/** Runs BugZero's repair loop, then opens a fix PR if it succeeded. */
export async function run(options: RunOptions): Promise<RunResult> {
  const { cwd, maxAttempts, octokit, repo, baseBranch, branchPrefix = "bugzero-fix" } = options;

  const result = await orchestrateAndFix({ cwd, maxAttempts });

  if (!result.success || !result.appliedFix) {
    return { fixed: false, reason: result.error ?? "No fix was found." };
  }

  const files = result.appliedFix.patches.map((patch) => ({
    path: patch.filePath,
    content: fs.readFileSync(path.resolve(cwd, patch.filePath), "utf-8"),
  }));

  const fileList = files.map((f) => `- \`${f.path}\``).join("\n");
  const branchName = `${branchPrefix}-${Date.now()}`;

  const { prUrl, prNumber } = await openFixPullRequest({
    octokit,
    repo,
    baseBranch,
    branchName,
    commitMessage: `fix: ${result.appliedFix.explanation}`,
    prTitle: `🤖 BugZero: ${result.appliedFix.explanation}`,
    prBody: [
      `BugZero automatically fixed a build failure after ${result.attempts} attempt(s).`,
      "",
      `**Root cause:** ${result.appliedFix.rootCause}`,
      "",
      "**Files changed:**",
      fileList,
      "",
      "---",
      "*Opened automatically by [BugZero](https://www.npmjs.com/package/bugzero).*",
    ].join("\n"),
    files,
  });

  return { fixed: true, prUrl, prNumber };
}
