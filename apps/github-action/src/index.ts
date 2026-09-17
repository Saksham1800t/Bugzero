import * as core from "@actions/core";
import * as github from "@actions/github";
import { run } from "./run";

async function main() {
  try {
    const cwd = core.getInput("path") || process.cwd();
    const maxAttempts = parseInt(core.getInput("max-attempts") || "3", 10);
    const token = core.getInput("github-token", { required: true });
    const baseBranch =
      core.getInput("base-branch") || github.context.ref.replace("refs/heads/", "") || "main";

    const octokit = github.getOctokit(token);
    const { owner, repo } = github.context.repo;

    const result = await run({
      cwd,
      maxAttempts,
      octokit,
      repo: { owner, repo },
      baseBranch,
    });

    core.setOutput("fixed", String(result.fixed));
    core.setOutput("pull-request-url", result.prUrl ?? "");

    if (result.fixed) {
      core.info(`✅ BugZero fixed the build and opened a pull request: ${result.prUrl}`);
    } else {
      core.setFailed(`BugZero could not fix the build: ${result.reason}`);
    }
  } catch (error: any) {
    core.setFailed(error?.message ?? String(error));
  }
}

main();
