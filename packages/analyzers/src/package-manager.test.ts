import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { detectPackageManager, getRunScriptCommand } from "./package-manager";

function write(dir: string, name: string, content = "") {
  fs.writeFileSync(path.join(dir, name), content, "utf-8");
}

describe("detectPackageManager", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bugzero-pm-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it.each([
    ["pnpm@9.1.0", "pnpm"],
    ["yarn@4.1.0", "yarn"],
    ["npm@10.5.0", "npm"],
    ["bun@1.1.0", "bun"],
  ] as const)("detects %s from the packageManager field", (field, expected) => {
    write(tmpDir, "package.json", JSON.stringify({ packageManager: field }));
    expect(detectPackageManager(tmpDir)).toBe(expected);
  });

  it("ignores an invalid packageManager field and falls through to lockfile detection", () => {
    write(tmpDir, "package.json", JSON.stringify({ packageManager: "not-a-real-manager@1.0.0" }));
    write(tmpDir, "yarn.lock");
    expect(detectPackageManager(tmpDir)).toBe("yarn");
  });

  it("does not throw on malformed package.json and falls through to lockfile detection", () => {
    write(tmpDir, "package.json", "{ not valid json");
    write(tmpDir, "pnpm-lock.yaml");
    expect(() => detectPackageManager(tmpDir)).not.toThrow();
    expect(detectPackageManager(tmpDir)).toBe("pnpm");
  });

  it("the packageManager field takes priority over a conflicting lockfile", () => {
    write(tmpDir, "package.json", JSON.stringify({ packageManager: "yarn@4.1.0" }));
    write(tmpDir, "package-lock.json");
    expect(detectPackageManager(tmpDir)).toBe("yarn");
  });

  it.each([
    ["pnpm-workspace.yaml", "pnpm"],
    ["pnpm-lock.yaml", "pnpm"],
    ["yarn.lock", "yarn"],
    ["bun.lockb", "bun"],
    ["bun.lock", "bun"],
    ["package-lock.json", "npm"],
  ] as const)("detects %s as %s", (file, expected) => {
    write(tmpDir, file);
    expect(detectPackageManager(tmpDir)).toBe(expected);
  });

  it("defaults to npm when nothing is present", () => {
    expect(detectPackageManager(tmpDir)).toBe("npm");
  });
});

describe("getRunScriptCommand", () => {
  it.each([
    ["npm", "npm run build"],
    ["pnpm", "pnpm run build"],
    ["yarn", "yarn run build"],
    ["bun", "bun run build"],
  ] as const)("builds the right command for %s", (manager, expected) => {
    expect(getRunScriptCommand(manager, "build")).toBe(expected);
  });
});
