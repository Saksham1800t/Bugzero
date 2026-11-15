import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadProjectEnv } from "./env";

// Unique variable names, so a developer's own .env or environment can never collide with a test.
const KEYS = ["BUGZERO_ENV_TEST_A", "BUGZERO_ENV_TEST_B", "BUGZERO_ENV_TEST_C"];

describe("loadProjectEnv", () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "bugzero-env-test-"));
    for (const key of KEYS) delete process.env[key];
  });

  afterEach(() => {
    for (const key of KEYS) delete process.env[key];
    fs.rmSync(root, { recursive: true, force: true });
  });

  function project(name: string, envFile?: string) {
    const dir = path.join(root, name);
    fs.mkdirSync(dir, { recursive: true });
    if (envFile !== undefined) fs.writeFileSync(path.join(dir, ".env"), envFile);
    return dir;
  }

  it("loads the .env of the project it is pointed at, whatever the current directory is", () => {
    const dir = project("app", "BUGZERO_ENV_TEST_A=from-app\n");

    expect(process.cwd()).not.toBe(dir);
    const loaded = loadProjectEnv(dir);

    expect(loaded).toBe(path.join(dir, ".env"));
    expect(process.env.BUGZERO_ENV_TEST_A).toBe("from-app");
  });

  it("finds a .env in a parent folder, such as a monorepo root", () => {
    const parent = project("mono", "BUGZERO_ENV_TEST_A=from-root\n");
    const pkg = project(path.join("mono", "packages", "web"));

    loadProjectEnv(pkg);

    expect(process.env.BUGZERO_ENV_TEST_A).toBe("from-root");
  });

  it("prefers the closest .env over one further up", () => {
    project("mono", "BUGZERO_ENV_TEST_A=from-root\n");
    const pkg = project(path.join("mono", "web"), "BUGZERO_ENV_TEST_A=from-web\n");

    loadProjectEnv(pkg);

    expect(process.env.BUGZERO_ENV_TEST_A).toBe("from-web");
  });

  it("never overrides a variable that is already set in the real environment", () => {
    process.env.BUGZERO_ENV_TEST_A = "from-shell";
    const dir = project("app", "BUGZERO_ENV_TEST_A=from-app\nBUGZERO_ENV_TEST_B=only-in-file\n");

    loadProjectEnv(dir);

    expect(process.env.BUGZERO_ENV_TEST_A).toBe("from-shell");
    expect(process.env.BUGZERO_ENV_TEST_B).toBe("only-in-file");
  });

  it("lets the target project's .env win over values from another .env loaded earlier", () => {
    // e.g. a .env in the folder you ran the command from, loaded before --path was known.
    const first = project("first", "BUGZERO_ENV_TEST_A=from-first\nBUGZERO_ENV_TEST_B=only-first\n");
    const target = project("target", "BUGZERO_ENV_TEST_A=from-target\n");

    loadProjectEnv(first);
    loadProjectEnv(target);

    expect(process.env.BUGZERO_ENV_TEST_A).toBe("from-target");
    // Values the target does not mention are still available.
    expect(process.env.BUGZERO_ENV_TEST_B).toBe("only-first");
  });

  it("does nothing when the project has no .env", () => {
    const dir = project("bare");

    expect(loadProjectEnv(dir)).toBeUndefined();
    expect(process.env.BUGZERO_ENV_TEST_A).toBeUndefined();
  });

  it("does not throw on a .env it cannot read", () => {
    const dir = project("weird");
    fs.mkdirSync(path.join(dir, ".env")); // a directory named .env

    expect(() => loadProjectEnv(dir)).not.toThrow();
  });
});
