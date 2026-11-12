import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildAnalysisPrompt, truncateLogs } from "./analyze-build";

describe("truncateLogs", () => {
  it("returns short logs unchanged", () => {
    expect(truncateLogs("small log")).toBe("small log");
  });

  it("keeps the start and end of long logs and drops the middle", () => {
    const logs = "a".repeat(100) + "b".repeat(100);
    const result = truncateLogs(logs, 50);

    expect(result.startsWith("a".repeat(30))).toBe(true);
    expect(result.endsWith("b".repeat(20))).toBe(true);
    expect(result).toContain("150 characters of log output omitted");
  });

  it("keeps the result close to the limit regardless of input size", () => {
    const result = truncateLogs("x".repeat(500_000));
    expect(result.length).toBeLessThan(21_000);
  });
});

describe("buildAnalysisPrompt", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bugzero-prompt-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("includes the error output and the expected JSON shape", () => {
    const prompt = buildAnalysisPrompt("error TS2304: Cannot find name 'foo'.", tmpDir);

    expect(prompt).toContain("Cannot find name 'foo'");
    expect(prompt).toContain('"patches"');
  });

  it("truncates enormous error output so the prompt stays bounded", () => {
    const prompt = buildAnalysisPrompt("x".repeat(200_000), tmpDir);

    expect(prompt).toContain("characters of log output omitted");
    expect(prompt.length).toBeLessThan(30_000);
  });

  it("truncates very large source files included as context", () => {
    fs.mkdirSync(path.join(tmpDir, "src"));
    fs.writeFileSync(path.join(tmpDir, "src", "big.ts"), "a".repeat(50_000) + "TAIL_MARKER", "utf-8");

    const prompt = buildAnalysisPrompt("src/big.ts(1,1): error TS2304: Cannot find name 'foo'.", tmpDir);

    expect(prompt).toMatch(/--- File: src[\\/]big\.ts ---/);
    expect(prompt).toContain("file truncated");
    expect(prompt).not.toContain("TAIL_MARKER");
  });

  describe("staying inside the project", () => {
    let outsideDir: string;

    beforeEach(() => {
      outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "bugzero-prompt-outside-test-"));
      fs.writeFileSync(path.join(outsideDir, "secret.txt"), "SUPER-SECRET-TOKEN-12345");
    });

    afterEach(() => {
      fs.rmSync(outsideDir, { recursive: true, force: true });
    });

    it("does not send a file from outside the project, even if the logs mention it", () => {
      const logs = `error in index.ts\nsee also "${path.join(outsideDir, "secret.txt")}" for details`;

      const prompt = buildAnalysisPrompt(logs, tmpDir);

      expect(prompt).not.toContain("SUPER-SECRET-TOKEN-12345");
    });

    it("does not list or read a directory outside the project that the logs mention", () => {
      const prompt = buildAnalysisPrompt(`failed while reading "${outsideDir}"`, tmpDir);

      expect(prompt).not.toContain("SUPER-SECRET-TOKEN-12345");
      expect(prompt).not.toContain("secret.txt");
    });

    it("does not follow a symlinked directory out of the project", (ctx) => {
      try {
        fs.symlinkSync(outsideDir, path.join(tmpDir, "link"), process.platform === "win32" ? "junction" : "dir");
      } catch {
        ctx.skip();
      }

      // A source-file extension, so the path finder actually picks this up from the log.
      fs.writeFileSync(path.join(outsideDir, "secret.ts"), "export const TOKEN = 'SUPER-SECRET-TOKEN-12345';");

      const prompt = buildAnalysisPrompt(`error in link/secret.ts`, tmpDir);

      expect(prompt).not.toContain("SUPER-SECRET-TOKEN-12345");
    });

    it("still includes a project file that the logs reference by absolute path", () => {
      fs.writeFileSync(path.join(tmpDir, "inside.ts"), "export const INSIDE_MARKER = 1;");

      const prompt = buildAnalysisPrompt(`error in ${path.join(tmpDir, "inside.ts")}`, tmpDir);

      expect(prompt).toContain("INSIDE_MARKER");
    });
  });

  it("keeps earlier failed patch attempts in a separate history section", () => {
    const logs =
      "error TS2304: Cannot find name 'foo'.\n\n⚠️ [BugZero System Warning] Your previous patch suggestion failed:\n- File not found";

    const prompt = buildAnalysisPrompt(logs, tmpDir);

    expect(prompt).toContain("Previous Failed Attempts");
    expect(prompt).toContain("File not found");
  });
});
