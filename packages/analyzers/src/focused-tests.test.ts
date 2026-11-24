import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockRunCommand } = vi.hoisted(() => ({ mockRunCommand: vi.fn() }));

vi.mock("./run-command", () => ({ runCommand: mockRunCommand }));

import {
  detectTestRunner,
  findFailingTestFiles,
  planFocusedTests,
  runFocusedTests,
  usableFocusedResult,
} from "./focused-tests";

describe("detectTestRunner", () => {
  it.each([
    ["vitest", "vitest"],
    ["vitest run", "vitest"],
    ["vitest run --coverage", "vitest"],
    ["jest", "jest"],
    ["jest --ci --runInBand", "jest"],
    ["npx jest", "jest"],
    ["pnpm exec vitest run", "vitest"],
    ["cross-env NODE_ENV=test jest", "jest"],
    ["node_modules/.bin/jest", "jest"],
    ["./node_modules/.bin/vitest run", "vitest"],
  ])("recognises %s", (script, runner) => {
    expect(detectTestRunner(script)).toBe(runner);
  });

  it.each([
    ["no script", undefined],
    ["an empty script", ""],
    ["a runner it does not know", "mocha"],
    ["react-scripts test", "react-scripts test"],
    ["two commands chained", "npm run build && jest"],
    ["alternatives", "jest || vitest"],
    ["a pipe", "jest | tee out.txt"],
    ["a sequence", "jest; echo done"],
    ["a redirect", "jest > out.txt"],
    ["a substitution", "jest $(echo src)"],
    ["both runners named", "vitest run && jest"],
    ["a word that only contains the name", "my-jest-wrapper"],
  ])("does not guess for %s", (_name, script) => {
    expect(detectTestRunner(script as string | undefined)).toBeNull();
  });
});

describe("findFailingTestFiles", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "bugzero-focus-test-"));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function touch(...files: string[]) {
    for (const file of files) {
      fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
      fs.writeFileSync(path.join(dir, file), "// test");
    }
  }

  it("reads the files from Jest's FAIL lines", () => {
    touch("src/sum.test.ts", "src/other.spec.js");
    const output = ["FAIL src/sum.test.ts", "  ● sum › adds", "FAIL  src/other.spec.js (5.2 s)", "Tests: 2 failed"].join("\n");

    expect(findFailingTestFiles(dir, output)).toEqual(["src/sum.test.ts", "src/other.spec.js"]);
  });

  it("reads the files from Vitest's FAIL lines, with or without a project name", () => {
    touch("src/a.test.ts", "src/b.test.ts");
    const output = [" FAIL  src/a.test.ts > math > adds", " FAIL  |unit| src/b.test.ts > other > works"].join("\n");

    expect(findFailingTestFiles(dir, output)).toEqual(["src/a.test.ts", "src/b.test.ts"]);
  });

  it("lists a file once however many of its tests failed", () => {
    touch("src/a.test.ts");
    const output = [" FAIL  src/a.test.ts > one", " FAIL  src/a.test.ts > two", "FAIL src/a.test.ts"].join("\n");

    expect(findFailingTestFiles(dir, output)).toEqual(["src/a.test.ts"]);
  });

  it("copes with colours and Windows line endings", () => {
    touch("src/a.test.ts");
    const esc = String.fromCharCode(27);
    const output = ` ${esc}[41m${esc}[1m FAIL ${esc}[22m${esc}[49m src/a.test.ts > one\r\n FAIL  src\\a.test.ts > two\r\n`;

    expect(findFailingTestFiles(dir, output)).toEqual(["src/a.test.ts"]);
  });

  it("ignores files that do not exist", () => {
    touch("src/real.test.ts");
    const output = ["FAIL src/real.test.ts", "FAIL src/ghost.test.ts"].join("\n");

    expect(findFailingTestFiles(dir, output)).toEqual(["src/real.test.ts"]);
  });

  it("ignores files that are not test files", () => {
    touch("src/helper.ts", "src/a.test.ts", "src/__tests__/b.ts");
    const output = ["FAIL src/helper.ts", "FAIL src/a.test.ts", "FAIL src/__tests__/b.ts"].join("\n");

    expect(findFailingTestFiles(dir, output)).toEqual(["src/a.test.ts", "src/__tests__/b.ts"]);
  });

  it("never returns a path outside the project, however the output spells it", () => {
    touch("src/a.test.ts");
    fs.writeFileSync(path.join(path.dirname(dir), "outside.test.ts"), "// outside");
    try {
      const output = ["FAIL ../outside.test.ts", `FAIL ${path.join(path.dirname(dir), "outside.test.ts")}`].join("\n");

      expect(findFailingTestFiles(dir, output)).toEqual([]);
    } finally {
      fs.rmSync(path.join(path.dirname(dir), "outside.test.ts"), { force: true });
    }
  });

  it("never returns a name that could be read as a flag or run as a command", () => {
    touch("-rf.test.ts", "a;b.test.ts", "a$(x).test.ts", "a&b.test.ts", "my file.test.ts", "src/ok.test.ts");
    const output = [
      "FAIL -rf.test.ts",
      "FAIL a;b.test.ts",
      "FAIL a$(x).test.ts",
      "FAIL a&b.test.ts",
      "FAIL my file.test.ts",
      "FAIL src/ok.test.ts",
    ].join("\n");

    expect(findFailingTestFiles(dir, output)).toEqual(["src/ok.test.ts"]);
  });

  it("gives up when too many files failed, because running only some would hide the rest", () => {
    const names = Array.from({ length: 11 }, (_, i) => `src/t${i}.test.ts`);
    touch(...names);
    const output = names.map((name) => `FAIL ${name}`).join("\n");

    expect(findFailingTestFiles(dir, output)).toEqual([]);
  });

  it("finds nothing in output without FAIL lines", () => {
    touch("src/a.test.ts");

    expect(findFailingTestFiles(dir, "src/a.test.ts(1,1): error TS2304: Cannot find name 'x'.")).toEqual([]);
    expect(findFailingTestFiles(dir, "")).toEqual([]);
  });
});

describe("planFocusedTests", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "bugzero-focus-plan-"));
    fs.mkdirSync(path.join(dir, "src"));
    fs.writeFileSync(path.join(dir, "src", "a.test.ts"), "// test");
    fs.writeFileSync(path.join(dir, "src", "b.test.ts"), "// test");
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function project(testScript: string | undefined, extra: Record<string, unknown> = {}) {
    const scripts = testScript === undefined ? {} : { test: testScript };
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ scripts, ...extra }));
  }

  it("builds an npm command that passes the failing files after --", () => {
    project("vitest run");

    expect(planFocusedTests(dir, "FAIL src/a.test.ts")).toEqual({
      runner: "vitest",
      files: ["src/a.test.ts"],
      command: 'npm run test -- "src/a.test.ts"',
    });
  });

  it("passes every failing file", () => {
    project("jest");

    expect(planFocusedTests(dir, "FAIL src/a.test.ts\nFAIL src/b.test.ts")?.command).toBe(
      'npm run test -- "src/a.test.ts" "src/b.test.ts"'
    );
  });

  it("uses the project's package manager", () => {
    project("jest", { packageManager: "pnpm@9.0.0" });

    expect(planFocusedTests(dir, "FAIL src/a.test.ts")?.command).toBe('pnpm run test "src/a.test.ts"');
  });

  it("does nothing for a test script it cannot read", () => {
    project("npm run build && jest");

    expect(planFocusedTests(dir, "FAIL src/a.test.ts")).toBeNull();
  });

  it("does nothing without a test script", () => {
    project(undefined);

    expect(planFocusedTests(dir, "FAIL src/a.test.ts")).toBeNull();
  });

  it("does nothing when the output names no failing test file", () => {
    project("jest");

    expect(planFocusedTests(dir, "Error: boom")).toBeNull();
  });
});

describe("runFocusedTests", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("runs the planned command in the project, with the timeout", async () => {
    mockRunCommand.mockResolvedValue({ success: true, output: "ok" });

    const result = await runFocusedTests({ runner: "jest", files: ["a.test.ts"], command: 'npm run test -- "a.test.ts"' }, "/p", {
      timeoutMs: 5000,
    });

    expect(result).toEqual({ success: true, output: "ok" });
    expect(mockRunCommand).toHaveBeenCalledWith('npm run test -- "a.test.ts"', "/p", { timeoutMs: 5000 });
  });
});

describe("usableFocusedResult", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "bugzero-focus-usable-"));
    fs.writeFileSync(path.join(dir, "a.test.ts"), "// test");
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("trusts a failure that names the failing test files", () => {
    expect(usableFocusedResult(dir, { success: false, output: "FAIL a.test.ts\n● x" })).toBe(true);
  });

  it("trusts a timeout, which names nothing but is a real result", () => {
    expect(usableFocusedResult(dir, { success: false, timedOut: true, output: "stuck" })).toBe(true);
  });

  it("does not trust a failure that names no test file, such as the runner finding no tests or rejecting an argument", () => {
    expect(usableFocusedResult(dir, { success: false, output: "No test files found, exiting with code 1" })).toBe(false);
    expect(usableFocusedResult(dir, { success: false, output: "Unknown option: --foo" })).toBe(false);
  });

  it("does not use a pass, because a pass is followed by the full pipeline", () => {
    expect(usableFocusedResult(dir, { success: true, output: "ok" })).toBe(false);
  });
});
