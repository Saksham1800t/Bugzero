import fs from "fs";
import path from "path";

export interface BugZeroConfig {
  model?: string;
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

export function saveLocalConfig(config: BugZeroConfig, cwd = process.cwd()): void {
  const configPath = path.resolve(cwd, CONFIG_FILENAME);
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
}

export function getSelectedModel(cwd = process.cwd()): string {
  const config = getLocalConfig(cwd);
  return config.model || "deepseek/deepseek-chat";
}
