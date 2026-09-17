import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockOrchestrateAndFix } = vi.hoisted(() => ({
  mockOrchestrateAndFix: vi.fn(),
}));

vi.mock("@opspilot/core", () => ({
  orchestrateAndFix: mockOrchestrateAndFix,
}));

import { run } from "./run";
import { MinimalOctokit } from "./open-pull-request";

function createMockOctokit(): MinimalOctokit {
  return {
    rest: {
      git: {
        getRef: vi.fn().mockResolvedValue({ data: { object: { sha: "base-sha" } } }),
        createRef: vi.fn().mockResolvedValue({}),
        createBlob: vi.fn().mockResolvedValue({ data: { sha: "blob-sha" } }),
        createTree: vi.fn().mockResolvedValue({ data: { sha: "tree-sha" } }),
        createCommit: vi.fn().mockResolvedValue({ data: { sha: "commit-sha" } }),
        updateRef: vi.fn().mockResolvedValue({}),
      },
      pulls: {
        create: vi.fn().mockResolvedValue({ data: { html_url: "https://github.com/acme/widgets/pull/7", number: 7 } }),
      },
    },
  };
}

describe("run", () => {
  let tmpDir: string;
  let octokit: MinimalOctokit;

  beforeEach(() => {
    vi.resetAllMocks();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bugzero-action-test-"));
    octokit = createMockOctokit();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("opens a pull request with the fixed file contents when the repair succeeds", async () => {
    fs.mkdirSync(path.join(tmpDir, "src"));
    fs.writeFileSync(path.join(tmpDir, "src", "index.ts"), "const x: number = 1;", "utf-8");

    mockOrchestrateAndFix.mockResolvedValueOnce({
      success: true,
      attempts: 1,
      finalOutput: "",
      appliedFix: {
        rootCause: "Missing semicolon",
        explanation: "Added missing semicolon",
        patches: [{ filePath: "src/index.ts", search: "const x: number = 1", replace: "const x: number = 1;" }],
      },
      modelUsed: "deepseek/deepseek-chat",
      promptTokens: 10,
      completionTokens: 5,
    });

    const result = await run({
      cwd: tmpDir,
      maxAttempts: 3,
      octokit,
      repo: { owner: "acme", repo: "widgets" },
      baseBranch: "main",
    });

    expect(result.fixed).toBe(true);
    expect(result.prUrl).toBe("https://github.com/acme/widgets/pull/7");
    expect(result.prNumber).toBe(7);

    expect(octokit.rest.git.createBlob).toHaveBeenCalledWith(
      expect.objectContaining({ content: "const x: number = 1;" })
    );
    expect(octokit.rest.pulls.create).toHaveBeenCalledWith(
      expect.objectContaining({ owner: "acme", repo: "widgets", base: "main" })
    );
  });

  it("does not open a pull request when the repair fails", async () => {
    mockOrchestrateAndFix.mockResolvedValueOnce({
      success: false,
      attempts: 3,
      finalOutput: "still broken",
      error: "Max attempts (3) reached without a successful build.",
    });

    const result = await run({
      cwd: tmpDir,
      maxAttempts: 3,
      octokit,
      repo: { owner: "acme", repo: "widgets" },
      baseBranch: "main",
    });

    expect(result.fixed).toBe(false);
    expect(result.reason).toBe("Max attempts (3) reached without a successful build.");
    expect(octokit.rest.pulls.create).not.toHaveBeenCalled();
    expect(octokit.rest.git.getRef).not.toHaveBeenCalled();
  });

  it("does not open a pull request when the repair succeeds without an appliedFix", async () => {
    mockOrchestrateAndFix.mockResolvedValueOnce({
      success: true,
      attempts: 0,
      finalOutput: "",
    });

    const result = await run({
      cwd: tmpDir,
      maxAttempts: 3,
      octokit,
      repo: { owner: "acme", repo: "widgets" },
      baseBranch: "main",
    });

    expect(result.fixed).toBe(false);
    expect(octokit.rest.pulls.create).not.toHaveBeenCalled();
  });
});
