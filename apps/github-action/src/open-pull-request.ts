export interface RepoRef {
  owner: string;
  repo: string;
}

export interface FileChange {
  /** Path relative to the repository root */
  path: string;
  content: string;
}

export interface OpenFixPullRequestOptions {
  octokit: MinimalOctokit;
  repo: RepoRef;
  baseBranch: string;
  branchName: string;
  commitMessage: string;
  prTitle: string;
  prBody: string;
  files: FileChange[];
}

export interface OpenFixPullRequestResult {
  prUrl: string;
  prNumber: number;
}

/**
 * The subset of Octokit's REST client this module actually calls. Kept
 * minimal and structural (rather than importing Octokit's own types) so
 * tests can pass a plain mock object without constructing a real client.
 */
export interface MinimalOctokit {
  rest: {
    git: {
      getRef(params: RepoRef & { ref: string }): Promise<{ data: { object: { sha: string } } }>;
      createRef(params: RepoRef & { ref: string; sha: string }): Promise<unknown>;
      createBlob(params: RepoRef & { content: string; encoding: string }): Promise<{ data: { sha: string } }>;
      createTree(
        params: RepoRef & {
          base_tree: string;
          tree: { path: string; mode: "100644"; type: "blob"; sha: string }[];
        }
      ): Promise<{ data: { sha: string } }>;
      createCommit(
        params: RepoRef & { message: string; tree: string; parents: string[] }
      ): Promise<{ data: { sha: string } }>;
      updateRef(params: RepoRef & { ref: string; sha: string }): Promise<unknown>;
    };
    pulls: {
      create(
        params: RepoRef & { title: string; head: string; base: string; body: string }
      ): Promise<{ data: { html_url: string; number: number } }>;
    };
  };
}

/**
 * Commits a set of file changes to a new branch and opens a pull request —
 * entirely through the GitHub REST API (no local git checkout needed). All
 * files land in a single commit via the Git Data API (blobs → tree →
 * commit → ref update), so the fix lands atomically, the same way
 * `@opspilot/patcher`'s multi-file patches are applied on disk.
 */
export async function openFixPullRequest(
  options: OpenFixPullRequestOptions
): Promise<OpenFixPullRequestResult> {
  const { octokit, repo, baseBranch, branchName, commitMessage, prTitle, prBody, files } = options;

  if (files.length === 0) {
    throw new Error("No file changes to commit.");
  }

  const baseRef = await octokit.rest.git.getRef({ ...repo, ref: `heads/${baseBranch}` });
  const baseSha = baseRef.data.object.sha;

  await octokit.rest.git.createRef({ ...repo, ref: `refs/heads/${branchName}`, sha: baseSha });

  const tree = await Promise.all(
    files.map(async (file) => {
      const blob = await octokit.rest.git.createBlob({ ...repo, content: file.content, encoding: "utf-8" });
      return { path: file.path, mode: "100644" as const, type: "blob" as const, sha: blob.data.sha };
    })
  );

  const newTree = await octokit.rest.git.createTree({ ...repo, base_tree: baseSha, tree });

  const commit = await octokit.rest.git.createCommit({
    ...repo,
    message: commitMessage,
    tree: newTree.data.sha,
    parents: [baseSha],
  });

  await octokit.rest.git.updateRef({ ...repo, ref: `heads/${branchName}`, sha: commit.data.sha });

  const pr = await octokit.rest.pulls.create({
    ...repo,
    title: prTitle,
    head: branchName,
    base: baseBranch,
    body: prBody,
  });

  return { prUrl: pr.data.html_url, prNumber: pr.data.number };
}
