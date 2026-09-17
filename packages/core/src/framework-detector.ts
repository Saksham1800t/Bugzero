import fs from "fs";
import path from "path";

export type Framework =
  | "nextjs"
  | "nestjs"
  | "vite"
  | "remix"
  | "astro"
  | "sveltekit"
  | "nuxt"
  | "angular"
  | "create-react-app"
  | "typescript"
  | "unknown";

export function detectFramework(cwd: string = process.cwd()): Framework {
  const has = (...files: string[]) =>
    files.some((f) => fs.existsSync(path.join(cwd, f)));

  if (has("next.config.js", "next.config.ts", "next.config.mjs")) return "nextjs";
  if (has("nest-cli.json")) return "nestjs";
  if (has("vite.config.ts", "vite.config.js", "vite.config.mts")) return "vite";
  if (has("remix.config.js", "remix.config.ts")) return "remix";
  if (has("astro.config.mjs", "astro.config.ts", "astro.config.js")) return "astro";
  if (has("svelte.config.js", "svelte.config.ts")) return "sveltekit";
  if (has("nuxt.config.ts", "nuxt.config.js")) return "nuxt";

  // Inspect package.json for framework deps when no config file is present
  const pkgPath = path.join(cwd, "package.json");
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
      const deps: Record<string, string> = {
        ...(pkg.dependencies ?? {}),
        ...(pkg.devDependencies ?? {}),
      };
      if (deps["react-scripts"]) return "create-react-app";
      if (deps["@angular/core"]) return "angular";
    } catch {
      // ignore malformed package.json
    }
  }

  if (has("tsconfig.json")) return "typescript";
  return "unknown";
}