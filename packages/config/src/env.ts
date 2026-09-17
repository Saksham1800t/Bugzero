import dotenv from "dotenv";
import fs from "fs";
import path from "path";

function loadEnv() {
  let dir = process.cwd();
  while (true) {
    const envPath = path.join(dir, ".env");
    if (fs.existsSync(envPath)) {
      dotenv.config({ path: envPath });
      return;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      break; // reached root
    }
    dir = parent;
  }
  // Fallback to default behavior if no .env is found in parent directories
  dotenv.config();
}

loadEnv();

export const env = {
  openRouterKey: process.env.OPENROUTER_API_KEY || "",
};