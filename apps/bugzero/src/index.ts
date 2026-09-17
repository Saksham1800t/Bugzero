#!/usr/bin/env node

import "@opspilot/config"; // loads .env before anything else
import { Command } from "commander";
import path from "path";
import { orchestrate, orchestrateAndFix, detectFramework } from "@opspilot/core";


const program = new Command();

program
  .name("bugzero")
  .description("AI-powered build issue fixer — detects and repairs build errors automatically")
  .version("0.0.1");

// ── bugzero hunt ─────────────────────────────────────────────────────────────
program
  .command("hunt")
  .description("Run build, lint, and tests — report issues without modifying files")
  .option("-p, --path <dir>", "Path to the target project", ".")
  .action(async (opts) => {
    try {
      const cwd = path.resolve(opts.path);
      const framework = detectFramework(cwd);

      console.log(`\n🔍 BugZero — Analyzing project`);
      console.log(`   Path:      ${cwd}`);
      console.log(`   Framework: ${framework}\n`);

      const { build, lint, test } = await orchestrate({ cwd });

      console.log("── Pipeline Summary ───────────────────────────");
      console.log(`   Build: ${build.success ? "✅ Passed" : "❌ Failed (see report)"}`);
      console.log(`   Lint:  ${lint.success ? "✅ Passed" : "❌ Failed (see report)"}`);
      console.log(`   Tests: ${test.success ? "✅ Passed" : "❌ Failed (see report)"}`);
      console.log("───────────────────────────────────────────────");

      const allPassed = build.success && lint.success && test.success;
      console.log(`\n${allPassed ? "✅ All checks passed" : "❌ Issues found — run 'bugzero rescue' to repair"}\n`);
      process.exit(allPassed ? 0 : 1);
    } catch (error: any) {
      console.error(`\n❌ [BugZero] Execution failed: ${error.message || error}`);
      process.exit(1);
    }
  });

// ── bugzero rescue ───────────────────────────────────────────────────────────
program
  .command("rescue")
  .description("Detect build failures and automatically apply AI-generated fixes")
  .option("-p, --path <dir>", "Path to the target project", ".")
  .option("-n, --max-attempts <number>", "Maximum AI fix attempts", "3")
  .option("--dry-run", "Analyse only — print what would be fixed without writing files", false)
  .action(async (opts) => {
    try {
      const cwd = path.resolve(opts.path);
      const maxAttempts = parseInt(opts.maxAttempts, 10);
      const dryRun: boolean = opts.dryRun;
      const framework = detectFramework(cwd);

      console.log(`\n🤖 BugZero Fix`);
      console.log(`   Path:        ${cwd}`);
      console.log(`   Framework:   ${framework}`);
      console.log(`   Max attempts: ${maxAttempts}`);
      if (dryRun) console.log(`   Mode:        DRY RUN (no files will be modified)`);
      console.log();

      const result = await orchestrateAndFix({ cwd, maxAttempts, dryRun });

      console.log("\n──────────────────────────────────────────────");
      if (result.success) {
        console.log(`✅ Build fixed after ${result.attempts} attempt(s)!`);
        console.log(`   Model:  ${result.modelUsed || "unknown"}`);
        if (result.promptTokens !== undefined && result.completionTokens !== undefined) {
          console.log(`   Tokens: Prompt: ${result.promptTokens} | Completion: ${result.completionTokens} | Total: ${result.promptTokens + result.completionTokens}`);
        }
        if (result.appliedFix) {
          const files = result.appliedFix.patches.map((p) => p.filePath).join(", ");
          console.log(`   File${result.appliedFix.patches.length === 1 ? "" : "s"}:   ${files}`);
          console.log(`   Reason: ${result.appliedFix.explanation}`);
          console.log(`   Root cause: ${result.appliedFix.rootCause}`);
        }
      } else {
        console.log(`❌ Could not fix build after ${result.attempts} attempt(s).`);
        console.log(`   Model:  ${result.modelUsed || "unknown"}`);
        if (result.promptTokens !== undefined && result.completionTokens !== undefined) {
          console.log(`   Tokens: Prompt: ${result.promptTokens} | Completion: ${result.completionTokens} | Total: ${result.promptTokens + result.completionTokens}`);
        }
        if (result.error) console.log(`   ${result.error}`);
        console.log(`\n👉 Full unresolved error logs have been listed in the generated report.`);
      }
      console.log();

      process.exit(result.success ? 0 : 1);
    } catch (error: any) {
      console.error(`\n❌ [BugZero] Execution failed: ${error.message || error}`);
      process.exit(1);
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