import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getLocalConfig, getProtectionSettings, getSelectedModel, saveLocalConfig } from "./config-store";

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

describe("protected-path settings in .bugzerorc", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bugzero-config-protect-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const writeConfig = (value: unknown) =>
    fs.writeFileSync(path.join(tmpDir, ".bugzerorc"), typeof value === "string" ? value : JSON.stringify(value), "utf-8");

  it("is empty when the project sets nothing", () => {
    expect(getProtectionSettings(tmpDir)).toEqual({ protect: [], allow: [] });
  });

  it("reads protect and allow", () => {
    writeConfig({ model: "m", protect: ["config/prod.json", "migrations/**"], allow: [".env.example"] });

    expect(getProtectionSettings(tmpDir)).toEqual({
      protect: ["config/prod.json", "migrations/**"],
      allow: [".env.example"],
    });
  });

  it("ignores values of the wrong type instead of failing", () => {
    writeConfig({ protect: "config/prod.json", allow: [".env.example", 7, null, "", "  "] });

    expect(getProtectionSettings(tmpDir)).toEqual({ protect: [], allow: [".env.example"] });
  });

  it("is empty for a malformed file", () => {
    writeConfig("{ not valid json");

    expect(getProtectionSettings(tmpDir)).toEqual({ protect: [], allow: [] });
  });

  it("saving the model keeps the other settings (bugzero vibe used to erase them)", () => {
    writeConfig({ model: "old/model", protect: ["config/prod.json"], allow: [".env.example"] });

    saveLocalConfig({ model: "new/model" }, tmpDir);

    expect(getLocalConfig(tmpDir)).toEqual({
      model: "new/model",
      protect: ["config/prod.json"],
      allow: [".env.example"],
    });
  });
});
