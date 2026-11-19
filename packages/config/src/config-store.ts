import fs from "fs";
import path from "path";

export interface BugZeroConfig {
  model?: string;
  /** Extra file patterns BugZero must never edit (added to the built-in protected list). */
  protect?: string[];
  /** Built-in protected patterns that this project permits BugZero to edit. */
  allow?: string[];
}

const CONFIG_FILENAME = ".bugzerorc";

export function getLocalConfig(cwd = process.cwd()): BugZeroConfig {
  try {
    const configPath = path.resolve(cwd, CONFIG_FILENAME);
    if (fs.existsSync(configPath)) {
      const content = fs.readFileSync(configPath, "utf-8");
      return JSON.parse(content);
    }
  } catch (e) {
    // Ignore error
  }
  return {};
}

/** Saves `config`, keeping any other settings already in the file (such as `protect` and `allow`). */
export function saveLocalConfig(config: BugZeroConfig, cwd = process.cwd()): void {
  const configPath = path.resolve(cwd, CONFIG_FILENAME);
  const merged = { ...getLocalConfig(cwd), ...config };
  fs.writeFileSync(configPath, JSON.stringify(merged, null, 2), "utf-8");
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string" && entry.trim() !== "");
}

/** The project's `protect` and `allow` lists. Anything that is not a list of strings is ignored. */
export function getProtectionSettings(cwd = process.cwd()): { protect: string[]; allow: string[] } {
  const config = getLocalConfig(cwd);
  return { protect: stringList(config.protect), allow: stringList(config.allow) };
}

export function getSelectedModel(cwd = process.cwd()): string {
  const config = getLocalConfig(cwd);
  return config.model || "deepseek/deepseek-chat";
}
