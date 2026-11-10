#!/usr/bin/env node

import "@opspilot/config"; // loads .env before anything else
import { Command } from "commander";
import fs from "fs";
import path from "path";
import {
  orchestrate,
  orchestrateAndFix,
  detectFramework,
  detectPackageManager,
  resolveMaxAttempts,
  resolveTimeoutMs,
  REPORT_FILENAME,
} from "@opspilot/core";
import { buildErrorJson, buildHuntJson, buildRescueJson } from "./json-output";
import { buildRescueSummary } from "./summary";

// dist/index.js sits one level below the package root, where package.json is always published
const { version } = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf-8"));

const TIMEOUT_DESCRIPTION = "Stop any build/lint/test command that runs longer than this many seconds";

/** Parses --timeout up front so a bad value fails before any command runs. */
function parseTimeout(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const seconds = Number(raw);
  resolveTimeoutMs(seconds); // throws on anything that isn't a positive number
  return seconds;
}

const JSON_DESCRIPTION = "Print the result as one JSON document on stdout (human-readable logs go to stderr)";

/** In --json mode stdout must hold exactly one JSON document, so every other log line goes to stderr. */
function routeLogsToStderr(): void {
  const toStderr = (...args: unknown[]) => console.error(...args);
  console.log = toStderr;
  console.info = toStderr;
  console.debug = toStderr;
}

/** Exits with `exitCode`, first writing `json` (when given) to stdout and waiting for it to flush so piped output isn't cut off. */
function finish(exitCode: number, json?: unknown): void {
  if (json === undefined) process.exit(exitCode);
  process.stdout.write(`${JSON.stringify(json, null, 2)}\n`, () => process.exit(exitCode));
}

const program = new Command();

program
  .name("bugzero")
  .description("AI-powered build issue fixer — detects and repairs build errors automatically")
  .version(version);

// ── bugzero hunt ─────────────────────────────────────────────────────────────
program
  .command("hunt")
  .description("Run build, lint, and tests — report issues without modifying files")
  .option("-p, --path <dir>", "Path to the target project", ".")
  .option("-t, --timeout <seconds>", TIMEOUT_DESCRIPTION)
  .option("--json", JSON_DESCRIPTION)
  .action(async (opts) => {
    const json: boolean = opts.json === true;
    if (json) routeLogsToStderr();
    try {
      const cwd = path.resolve(opts.path);
      const timeoutSeconds = parseTimeout(opts.timeout);
      const framework = detectFramework(cwd);
      const packageManager = detectPackageManager(cwd);

      console.log(`\n🔍 BugZero — Analyzing project`);
      console.log(`   Path:      ${cwd}`);
      console.log(`   Framework: ${framework}`);
      console.log(`   Package manager: ${packageManager}`);
      if (timeoutSeconds !== undefined) console.log(`   Timeout:   ${timeoutSeconds}s per command`);
      console.log();

      const { build, lint, test } = await orchestrate({ cwd, timeoutSeconds });

      console.log("── Pipeline Summary ───────────────────────────");
      const label = (r: { success: boolean; skipped?: boolean }) =>
        r.skipped ? "⏭️  Skipped (no script)" : r.success ? "✅ Passed" : "❌ Failed (see report)";
      console.log(`   Build: ${label(build)}`);
      console.log(`   Lint:  ${label(lint)}`);
      console.log(`   Tests: ${label(test)}`);
      console.log("───────────────────────────────────────────────");

      const allPassed = build.success && lint.success && test.success;
      console.log(`\n${allPassed ? "✅ All checks passed" : "❌ Issues found — run 'bugzero rescue' to repair"}\n`);
      finish(
        allPassed ? 0 : 1,
        json
          ? buildHuntJson(
              { path: cwd, framework, packageManager, reportPath: path.resolve(cwd, REPORT_FILENAME) },
              { build, lint, test }
            )
          : undefined
      );
    } catch (error: any) {
      console.error(`\n❌ [BugZero] Execution failed: ${error.message || error}`);
      finish(1, json ? buildErrorJson(String(error.message || error)) : undefined);
    }
  });

// ── bugzero rescue ───────────────────────────────────────────────────────────
program
  .command("rescue")
  .description("Detect build failures and automatically apply AI-generated fixes")
  .option("-p, --path <dir>", "Path to the target project", ".")
  .option("-n, --max-attempts <number>", "Maximum AI fix attempts", "3")
  .option("-t, --timeout <seconds>", TIMEOUT_DESCRIPTION)
  .option("--dry-run", "Analyse only — print what would be fixed without writing files", false)
  .option("--json", JSON_DESCRIPTION)
  .action(async (opts) => {
    const json: boolean = opts.json === true;
    if (json) routeLogsToStderr();
    try {
      const cwd = path.resolve(opts.path);
      const maxAttempts = resolveMaxAttempts(Number(opts.maxAttempts));
      const timeoutSeconds = parseTimeout(opts.timeout);
      const dryRun: boolean = opts.dryRun;
      const framework = detectFramework(cwd);
      const packageManager = detectPackageManager(cwd);

      console.log(`\n🤖 BugZero Fix`);
      console.log(`   Path:        ${cwd}`);
      console.log(`   Framework:   ${framework}`);
      console.log(`   Package manager: ${packageManager}`);
      console.log(`   Max attempts: ${maxAttempts}`);
      if (timeoutSeconds !== undefined) console.log(`   Timeout:     ${timeoutSeconds}s per command`);
      if (dryRun) console.log(`   Mode:        DRY RUN (no files will be modified)`);
      console.log();

      const result = await orchestrateAndFix({ cwd, maxAttempts, dryRun, timeoutSeconds });

      console.log("\n──────────────────────────────────────────────");
      const summary = buildRescueSummary(result, { dryRun });
      for (const line of summary.lines) console.log(line);
      console.log();

      finish(
        summary.exitCode,
        json
          ? buildRescueJson(result, {
              path: cwd,
              framework,
              packageManager,
              dryRun,
              reportPath: path.resolve(cwd, REPORT_FILENAME),
            })
          : undefined
      );
    } catch (error: any) {
      console.error(`\n❌ [BugZero] Execution failed: ${error.message || error}`);
      finish(1, json ? buildErrorJson(String(error.message || error)) : undefined);
    }
  });

// ── bugzero protect (legacy) ────────────────────────────────────────────────
program
  .command("protect")
  .description("[Deprecated] Use 'hunt' instead")
  .action(async () => {
    console.warn("⚠️  'protect' is deprecated — use 'bugzero hunt' instead.\n");
    const result = await orchestrate();
    console.log(result);
  });

// ── bugzero vibe ─────────────────────────────────────────────────────────────
program
  .command("vibe")
  .description("Select which AI model (brain) to use for resolving bugs")
  .action(async () => {
    const { getLocalConfig, saveLocalConfig } = await import("@opspilot/config");
    const readline = await import("readline");
    const axios = (await import("axios")).default;

    console.log(`\n🧠 BugZero Brain Selector`);
    console.log(`──────────────────────────────────────────────`);

    let popularModels: any[] = [];
    try {
      console.log("🌀 Fetching active models list from OpenRouter...");
      const response = await axios.get("https://openrouter.ai/api/v1/models", { timeout: 8000 });
      const allModels = response.data?.data || [];
      const popularModelIds = [
        "deepseek/deepseek-chat",
        "deepseek/deepseek-r1",
        "anthropic/claude-3.5-sonnet",
        "google/gemini-2.5-pro",
        "google/gemini-2.5-flash",
        "openai/gpt-4o",
        "meta-llama/llama-3.3-70b-instruct"
      ];
      popularModels = allModels.filter((m: any) => popularModelIds.includes(m.id));
    } catch (e: any) {
      console.warn("⚠️ Failed to fetch models list from OpenRouter. Using cached default list.");
    }

    if (popularModels.length === 0) {
      popularModels = [
        { id: "deepseek/deepseek-chat", name: "DeepSeek V3 (Chat)" },
        { id: "deepseek/deepseek-r1", name: "DeepSeek R1" },
        { id: "anthropic/claude-3.5-sonnet", name: "Claude 3.5 Sonnet" },
        { id: "google/gemini-2.5-pro", name: "Gemini 2.5 Pro" },
        { id: "google/gemini-2.5-flash", name: "Gemini 2.5 Flash" },
        { id: "openai/gpt-4o", name: "GPT-4o" },
        { id: "meta-llama/llama-3.3-70b-instruct", name: "Llama 3.3 Instruct" }
      ];
    }

    const currentModel = getLocalConfig().model || "deepseek/deepseek-chat";
    console.log(`\nCurrent active model: \x1b[36m${currentModel}\x1b[0m\n`);

    popularModels.forEach((m, idx) => {
      console.log(`   [${idx + 1}] ${m.name} (${m.id})`);
    });
    console.log(`   [${popularModels.length + 1}] 🖋️  Custom Model (Type manually)`);
    console.log();

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    rl.question(`Select a number (1-${popularModels.length + 1}): `, (answer) => {
      const choice = parseInt(answer.trim(), 10);
      if (isNaN(choice) || choice < 1 || choice > popularModels.length + 1) {
        console.log("❌ Invalid selection. Keeping current model.");
        rl.close();
        process.exit(1);
      }

      if (choice === popularModels.length + 1) {
        rl.question("Enter custom OpenRouter Model ID (e.g. microsoft/phi-3-medium-128k-instruct): ", (customModel) => {
          const selected = customModel.trim();
          if (!selected) {
            console.log("❌ No model entered. Keeping current model.");
          } else {
            saveLocalConfig({ model: selected });
            console.log(`\n✅ Saved! Model set to: \x1b[32m${selected}\x1b[0m`);
            console.log(`   Saved config to: .bugzerorc`);
          }
          rl.close();
        });
      } else {
        const selected = popularModels[choice - 1].id;
        saveLocalConfig({ model: selected });
        console.log(`\n✅ Saved! Model set to: \x1b[32m${selected}\x1b[0m`);
        console.log(`   Saved config to: .bugzerorc`);
        rl.close();
      }
    });
  });

program.parse();