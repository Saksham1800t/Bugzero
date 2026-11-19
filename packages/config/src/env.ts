import dotenv from "dotenv";
import fs from "fs";
import path from "path";

/**
 * The value each variable was given by a .env file, as opposed to coming from the real environment.
 * A later .env, such as the one in the project passed with `--path`, may replace these,
 * but nothing may replace a variable the user set in their shell or CI. Remembering the value
 * (not just the name) means a variable that has since been set to something else is left alone.
 */
const loadedFromFiles = new Map<string, string>();

/** Finds the closest .env, looking in `startDir` and then each parent folder. */
function findEnvFile(startDir: string): string | undefined {
  let dir = path.resolve(startDir);
  while (true) {
    const envPath = path.join(dir, ".env");
    try {
      if (fs.statSync(envPath).isFile()) return envPath;
    } catch {
      // no .env here, keep looking
    }
    const parent = path.dirname(dir);
    if (parent === dir) return undefined; // reached the root
    dir = parent;
  }
}

function applyEnvFile(envPath: string): boolean {
  try {
    // dotenv.parse never prints anything (dotenv 17's config() prints a promotional tip on stdout,
    // which would pollute `bugzero --version` and any machine-readable output).
    const parsed = dotenv.parse(fs.readFileSync(envPath));
    for (const [key, value] of Object.entries(parsed)) {
      const current = process.env[key];
      if (current === undefined || current === loadedFromFiles.get(key)) {
        process.env[key] = value;
        loadedFromFiles.set(key, value);
      }
    }
    return true;
  } catch {
    return false; // unreadable .env: carry on without it
  }
}

/**
 * Loads the .env that belongs to the project being worked on (the closest one at or above `projectDir`),
 * so `--path` picks up that project's API key instead of whatever is in the current directory.
 * Real environment variables always win. Values from an earlier .env are replaced by this one.
 *
 * @returns the path of the file that was loaded, or undefined if there was none
 */
export function loadProjectEnv(projectDir: string): string | undefined {
  const envPath = findEnvFile(projectDir);
  if (!envPath) return undefined;
  return applyEnvFile(envPath) ? envPath : undefined;
}

// Nothing is loaded just by importing this package, so a program that only wants the settings (such as the
// GitHub Action) does not start reading .env files. The CLI calls loadProjectEnv() itself.

export const env = {
  // Read on access, so a key loaded later by loadProjectEnv() is seen.
  get openRouterKey() {
    return process.env.OPENROUTER_API_KEY || "";
  },
};
