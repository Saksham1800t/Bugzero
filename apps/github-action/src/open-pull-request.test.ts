import { beforeEach, describe, expect, it, vi } from "vitest";
import { MinimalOctokit, openFixPullRequest } from "./open-pull-request";

function createMockOctokit(): MinimalOctokit {
  return {
    rest: {
      git: {
        getRef: vi.fn().mockResolvedValue({ data: { object: { sha: "base-sha" } } }),
        createRef: vi.fn().mockResolvedValue({}),
        createBlob: vi
          .fn()
          .mockImplementation(async ({ content }: { content: string }) => ({
            data: { sha: `blob-sha-for:${content}` },
          })),
        createTree: vi.fn().mockResolvedValue({ data: { sha: "tree-sha" } }),
        createCommit: vi.fn().mockResolvedValue({ data: { sha: "commit-sha" } }),
        updateRef: vi.fn().mockResolvedValue({}),
      },
      pulls: {
        create: vi.fn().mockResolvedValue({ data: { html_url: "https://github.com/o/r/pull/1", number: 1 } }),
      },
    },
  };
}

describe("openFixPullRequest", () => {
  let octokit: MinimalOctokit;

  beforeEach(() => {
    octokit = createMockOctokit();
  });

  it("creates a branch off the base, commits all files in one tree, and opens a PR", async () => {
    const result = await openFixPullRequest({
      octokit,
      repo: { owner: "acme", repo: "widgets" },
      baseBranch: "main",
      branchName: "bugzero-fix-123",
      commitMessage: "fix: resolve type error",
      prTitle: "🤖 BugZero: resolve type error",
      prBody: "details",
      files: [
        { path: "src/a.ts", content: "export const a = 1;" },
        { path: "src/b.ts", content: "export const b = 2;" },
      ],
    });

    expect(result).toEqual({ prUrl: "https://github.com/o/r/pull/1", prNumber: 1 });

    expect(octokit.rest.git.getRef).toHaveBeenCalledWith({
      owner: "acme",
      repo: "widgets",
      ref: "heads/main",
    });

    expect(octokit.rest.git.createRef).toHaveBeenCalledWith({
      owner: "acme",
      repo: "widgets",
      ref: "refs/heads/bugzero-fix-123",
      sha: "base-sha",
    });

    expect(octokit.rest.git.createBlob).toHaveBeenCalledTimes(2);

    expect(octokit.rest.git.createTree).toHaveBeenCalledWith({
      owner: "acme",
      repo: "widgets",
      base_tree: "base-sha",
      tree: [
        { path: "src/a.ts", mode: "100644", type: "blob", sha: "blob-sha-for:export const a = 1;" },
        { path: "src/b.ts", mode: "100644", type: "blob", sha: "blob-sha-for:export const b = 2;" },
      ],
    });

    expect(octokit.rest.git.createCommit).toHaveBeenCalledWith({
      owner: "acme",
      repo: "widgets",
      message: "fix: resolve type error",
      tree: "tree-sha",
      parents: ["base-sha"],
    });

    expect(octokit.rest.git.updateRef).toHaveBeenCalledWith({
      owner: "acme",
      repo: "widgets",
      ref: "heads/bugzero-fix-123",
      sha: "commit-sha",
    });

    expect(octokit.rest.pulls.create).toHaveBeenCalledWith({
      owner: "acme",
      repo: "widgets",
      title: "🤖 BugZero: resolve type error",
      head: "bugzero-fix-123",
      base: "main",
      body: "details",
    });
  });

  it("throws without calling the API when there are no files to commit", async () => {
    await expect(
      openFixPullRequest({
        octokit,
        repo: { owner: "acme", repo: "widgets" },
        baseBranch: "main",
        branchName: "bugzero-fix-123",
        commitMessage: "fix",
        prTitle: "fix",
        prBody: "fix",
        files: [],
      })
    ).rejects.toThrow("No file changes to commit.");

    expect(octokit.rest.git.getRef).not.toHaveBeenCalled();
  });
});
