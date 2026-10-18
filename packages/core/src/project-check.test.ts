import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { assertNodeProject } from "./project-check";

describe("assertNodeProject", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bugzero-project-check-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("throws a clear error when there is no package.json", () => {
    expect(() => assertNodeProject(tmpDir)).toThrow("No package.json found");
    expect(() => assertNodeProject(tmpDir)).toThrow(tmpDir);
  });

  it("does not throw when package.json exists", () => {
    fs.writeFileSync(path.join(tmpDir, "package.json"), "{}", "utf-8");
    expect(() => assertNodeProject(tmpDir)).not.toThrow();
  });
});
