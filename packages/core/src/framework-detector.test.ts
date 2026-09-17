import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { detectFramework } from "./framework-detector";

function writeFile(dir: string, name: string, content = "") {
  fs.writeFileSync(path.join(dir, name), content, "utf-8");
}

describe("detectFramework", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bugzero-framework-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it.each([
    ["next.config.js", "nextjs"],
    ["nest-cli.json", "nestjs"],
    ["vite.config.ts", "vite"],
    ["remix.config.js", "remix"],
    ["astro.config.mjs", "astro"],
    ["svelte.config.js", "sveltekit"],
    ["nuxt.config.ts", "nuxt"],
  ] as const)("detects %s as %s", (file, expected) => {
    writeFile(tmpDir, file);
    expect(detectFramework(tmpDir)).toBe(expected);
  });

  it("detects create-react-app from package.json dependencies", () => {
    writeFile(tmpDir, "package.json", JSON.stringify({ dependencies: { "react-scripts": "5.0.0" } }));
    expect(detectFramework(tmpDir)).toBe("create-react-app");
  });

  it("detects angular from package.json dependencies", () => {
    writeFile(tmpDir, "package.json", JSON.stringify({ dependencies: { "@angular/core": "17.0.0" } }));
    expect(detectFramework(tmpDir)).toBe("angular");
  });

  it("falls back to typescript when only tsconfig.json is present", () => {
    writeFile(tmpDir, "tsconfig.json", "{}");
    expect(detectFramework(tmpDir)).toBe("typescript");
  });

  it("returns unknown for an empty project directory", () => {
    expect(detectFramework(tmpDir)).toBe("unknown");
  });

  it("does not throw on malformed package.json and falls through instead", () => {
    writeFile(tmpDir, "package.json", "{ not valid json");
    writeFile(tmpDir, "tsconfig.json", "{}");

    expect(() => detectFramework(tmpDir)).not.toThrow();
    expect(detectFramework(tmpDir)).toBe("typescript");
  });

  it("prefers config-file detection over package.json dependency detection", () => {
    writeFile(tmpDir, "vite.config.ts");
    writeFile(tmpDir, "package.json", JSON.stringify({ dependencies: { "react-scripts": "5.0.0" } }));

    expect(detectFramework(tmpDir)).toBe("vite");
  });
});
