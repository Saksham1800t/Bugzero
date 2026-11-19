import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createProtectedPathRules,
  DEFAULT_PROTECTED_PATTERNS,
  DEFAULT_SECRET_PATTERNS,
  projectRelativePaths,
} from "./protected-paths";

describe("default rules", () => {
  const rules = createProtectedPathRules();

  it.each([
    ".env",
    ".env.local",
    ".env.production",
    "apps/web/.env",
    "apps/web/.env.local",
    "certs/server.pem",
    "keys/deploy.key",
    ".git/config",
    "packages/lib/.git/HEAD",
    ".github/workflows/ci.yml",
    ".gitlab-ci.yml",
    "package-lock.json",
    "pnpm-lock.yaml",
    "yarn.lock",
    "apps/web/pnpm-lock.yaml",
    "node_modules/left-pad/index.js",
    "apps/web/node_modules/x/y.js",
    "src/app.ts.opspilot.bak",
  ])("refuses edits to %s", (file) => {
    expect(rules.editBlockedBy(file)).toBeDefined();
  });

  it.each([
    "src/index.ts",
    "package.json",
    "tsconfig.json",
    "README.md",
    "src/environment.ts",
    "src/env.ts",
    "src/github/workflows.ts",
    ".github/dependabot.yml",
    "docs/keys.md",
    "src/monkey.ts",
  ])("allows edits to %s", (file) => {
    expect(rules.editBlockedBy(file)).toBeUndefined();
  });

  it("keeps secret files out of the prompt, but not lockfiles or CI configs", () => {
    expect(rules.secretBlockedBy(".env")).toBeDefined();
    expect(rules.secretBlockedBy("apps/web/.env.local")).toBeDefined();
    expect(rules.secretBlockedBy("certs/server.pem")).toBeDefined();
    expect(rules.secretBlockedBy("keys/deploy.key")).toBeDefined();
    expect(rules.secretBlockedBy("pnpm-lock.yaml")).toBeUndefined();
    expect(rules.secretBlockedBy(".github/workflows/ci.yml")).toBeUndefined();
    expect(rules.secretBlockedBy("src/index.ts")).toBeUndefined();
  });

  it("reports which pattern matched, so the model and the user can be told", () => {
    expect(rules.editBlockedBy("apps/web/.env.local")).toBe(".env.*");
    expect(rules.editBlockedBy("pnpm-lock.yaml")).toBe("pnpm-lock.yaml");
  });

  it("covers every secret pattern in the protected list", () => {
    for (const secret of DEFAULT_SECRET_PATTERNS) expect(DEFAULT_PROTECTED_PATTERNS).toContain(secret);
  });
});

describe("how paths are compared", () => {
  const rules = createProtectedPathRules();

  it("ignores case, so .ENV and Package-Lock.json are still protected", () => {
    expect(rules.editBlockedBy(".ENV")).toBeDefined();
    expect(rules.editBlockedBy("Package-Lock.json")).toBeDefined();
  });

  it("accepts Windows separators and a leading ./", () => {
    expect(rules.editBlockedBy("apps\\web\\.env.local")).toBeDefined();
    expect(rules.editBlockedBy("./.env")).toBeDefined();
    expect(rules.editBlockedBy(".github\\workflows\\ci.yml")).toBeDefined();
  });

  it("anchors patterns that contain a slash to the project root", () => {
    // .github/workflows/ is only the project's own workflows, not any folder that happens to share the name.
    expect(rules.editBlockedBy("examples/.github/workflows/ci.yml")).toBeUndefined();
  });
});

describe("project settings", () => {
  it("protect adds patterns", () => {
    const rules = createProtectedPathRules({ protect: ["config/prod.json", "migrations/**"] });

    expect(rules.editBlockedBy("config/prod.json")).toBe("config/prod.json");
    expect(rules.editBlockedBy("migrations/2020/001.sql")).toBe("migrations/**");
    expect(rules.editBlockedBy("config/dev.json")).toBeUndefined();
    // A user pattern is about edits only; it does not turn a file into a secret.
    expect(rules.secretBlockedBy("config/prod.json")).toBeUndefined();
  });

  it("allow lifts a default, for edits and for the prompt", () => {
    const rules = createProtectedPathRules({ allow: [".env.example", "yarn.lock"] });

    expect(rules.editBlockedBy(".env.example")).toBeUndefined();
    expect(rules.secretBlockedBy(".env.example")).toBeUndefined();
    expect(rules.editBlockedBy("yarn.lock")).toBeUndefined();
    // The rest of the defaults still apply.
    expect(rules.editBlockedBy(".env.local")).toBeDefined();
    expect(rules.editBlockedBy("pnpm-lock.yaml")).toBeDefined();
  });

  it("a protect pattern still wins over an allow pattern", () => {
    const rules = createProtectedPathRules({ protect: ["yarn.lock"], allow: ["yarn.lock"] });

    expect(rules.editBlockedBy("yarn.lock")).toBe("yarn.lock");
  });

  it("supports * ** and ? in patterns", () => {
    const rules = createProtectedPathRules({ protect: ["src/*.gen.ts", "gen/**/out.js", "v?.json"] });

    expect(rules.editBlockedBy("src/a.gen.ts")).toBeDefined();
    expect(rules.editBlockedBy("src/deep/a.gen.ts")).toBeUndefined();
    expect(rules.editBlockedBy("gen/a/b/out.js")).toBeDefined();
    expect(rules.editBlockedBy("gen/out.js")).toBeDefined();
    expect(rules.editBlockedBy("v1.json")).toBeDefined();
    expect(rules.editBlockedBy("v10.json")).toBeUndefined();
  });

  it("ignores blank, comment and non-string entries instead of crashing", () => {
    const rules = createProtectedPathRules({ protect: ["", "   ", "# note", 42 as unknown as string, "real.txt"] });

    expect(rules.editBlockedBy("real.txt")).toBe("real.txt");
    expect(rules.editBlockedBy("anything-else.txt")).toBeUndefined();
  });

  it("treats regex characters in a pattern literally", () => {
    const rules = createProtectedPathRules({ protect: ["a+b(1).txt"] });

    expect(rules.editBlockedBy("a+b(1).txt")).toBeDefined();
    expect(rules.editBlockedBy("aab1.txt")).toBeUndefined();
  });
});

describe("projectRelativePaths", () => {
  let root: string;
  let outside: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "bugzero-protected-test-"));
    outside = fs.mkdtempSync(path.join(os.tmpdir(), "bugzero-protected-outside-"));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  });

  it("gives the project-relative path with forward slashes", () => {
    fs.mkdirSync(path.join(root, "src"));
    fs.writeFileSync(path.join(root, "src", "a.ts"), "x");

    expect(projectRelativePaths(root, path.join(root, "src", "a.ts"))).toEqual(["src/a.ts"]);
  });

  it("also gives the real location when the path goes through a link, so a link cannot hide a protected file", (ctx) => {
    fs.writeFileSync(path.join(root, ".env"), "SECRET=1");
    try {
      fs.symlinkSync(path.join(root, ".env"), path.join(root, "harmless.txt"), "file");
    } catch {
      ctx.skip(); // creating links needs a privilege some Windows setups lack
      return;
    }

    const paths = projectRelativePaths(root, path.join(root, "harmless.txt"));

    expect(paths).toContain("harmless.txt");
    expect(paths).toContain(".env");
    expect(createProtectedPathRules().editBlockedBy(paths[1])).toBeDefined();
  });

  it("sees through a folder link to a protected folder", (ctx) => {
    fs.mkdirSync(path.join(root, ".git"));
    fs.writeFileSync(path.join(root, ".git", "config"), "[core]");
    try {
      fs.symlinkSync(path.join(root, ".git"), path.join(root, "tools"), "junction");
    } catch {
      ctx.skip();
      return;
    }

    const paths = projectRelativePaths(root, path.join(root, "tools", "config"));

    expect(paths).toEqual(["tools/config", ".git/config"]);
    expect(createProtectedPathRules().editBlockedBy("tools/config")).toBeUndefined();
    expect(createProtectedPathRules().editBlockedBy(paths[1])).toBeDefined();
  });

  it("works for a file that does not exist yet", () => {
    expect(projectRelativePaths(root, path.join(root, "new", "file.ts"))).toEqual(["new/file.ts"]);
  });
});
