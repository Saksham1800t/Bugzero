import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getLocalConfig, getSelectedModel, saveLocalConfig } from "./config-store";

describe("config-store", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bugzero-config-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns an empty config when .bugzerorc does not exist", () => {
    expect(getLocalConfig(tmpDir)).toEqual({});
  });

  it("round-trips a saved config through getLocalConfig", () => {
    saveLocalConfig({ model: "deepseek/deepseek-r1" }, tmpDir);

    expect(fs.existsSync(path.join(tmpDir, ".bugzerorc"))).toBe(true);
    expect(getLocalConfig(tmpDir)).toEqual({ model: "deepseek/deepseek-r1" });
  });

  it("does not throw and returns {} on malformed .bugzerorc content", () => {
    fs.writeFileSync(path.join(tmpDir, ".bugzerorc"), "{ not valid json", "utf-8");

    expect(() => getLocalConfig(tmpDir)).not.toThrow();
    expect(getLocalConfig(tmpDir)).toEqual({});
  });

  it("getSelectedModel defaults to deepseek/deepseek-chat when unconfigured", () => {
    expect(getSelectedModel(tmpDir)).toBe("deepseek/deepseek-chat");
  });

  it("getSelectedModel returns the configured model", () => {
    saveLocalConfig({ model: "openai/gpt-4o" }, tmpDir);
    expect(getSelectedModel(tmpDir)).toBe("openai/gpt-4o");
  });
});
