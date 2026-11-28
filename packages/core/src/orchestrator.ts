import { runBuild, runLint, runTests, parseErrors, runValidationPipeline } from "@opspilot/analyzers";
import { previewAnalysisPrompt, runRepairWorkflow } from "@opspilot/agents";
import {
  checkBudget,
  countCallTokens,
  uniqueFilePaths,
  type ApprovalHandler,
  type FixResult,
  type TokenBudgetUse,
} from "@opspilot/shared";
import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";
import { detectFramework } from "./framework-detector";
import { buildDryRunFallbackReport, buildDryRunMetadata, buildDryRunPrompt } from "./dry-run-report";
import { getLocalConfig } from "@opspilot/config";
import { resolveFocusTests, resolveMaxAttempts, resolveMaxTokens, resolvePatience, resolveTimeoutMs } from "./options";
import { assertNodeProject } from "./project-check";
import { OpenRouterProvider } from "@opspilot/ai-provider";
import { buildHuntDiagnosisPrompt, buildRescueFailurePrompt, buildRescueSuccessPrompt } from "./report-prompts";

/** Name of the Markdown report written into the target project by `hunt` and `rescue`. */
export const REPORT_FILENAME = "bugzero-report.md";

/** Why a repair ended without success. Fixes the person declined are called out, not blamed on the attempt limit. */
function failureMessage(
  maxAttempts: number,
  declined: number,
  appliedAnything: boolean,
  stoppedAfter?: number,
  budgetStop?: string
): string {
  const plural = declined === 1 ? "fix" : "fixes";
  if (budgetStop !== undefined) {
    const base = `Stopped: ${budgetStop} Raise it with --max-tokens.`;
    return declined > 0 ? `${base} You declined ${declined} proposed ${plural}.` : base;
  }
  if (declined > 0 && !appliedAnything) {
    return `You declined ${declined} proposed ${plural}, so nothing was changed.`;
  }
  const base =
    stoppedAfter !== undefined
      ? `Stopped early: ${stoppedAfter} attempt${stoppedAfter === 1 ? "" : "s"} in a row made no progress (the errors did not get fewer and no later step was reached), so the remaining attempts were not used. Try a different model with 'bugzero vibe', or use --patience 0 to keep going regardless.`
      : `Max attempts (${maxAttempts}) reached without a successful build.`;
  return declined > 0 ? `${base} You declined ${declined} proposed ${plural}.` : base;
}

function statusLabel(result: { success: boolean; skipped?: boolean }): string {
  if (result.skipped) return "⏭️ Skipped (no script defined)";
  return result.success ? "✅ Passed" : "❌ Failed";
}

export interface OrchestrateOptions {
  /** Absolute path to the target project (defaults to process.cwd()) */
  cwd?: string;
  /** Maximum AI fix attempts (default: 3) */
  maxAttempts?: number;
  /**
   * Stop early after this many attempts in a row make no progress (default: from .bugzerorc, else 2).
   * 0 turns it off.
   */
  patience?: number;
  /**
   * `rescue` only: while tests are what is failing, re-run just the failing test files between attempts, and run
   * the full pipeline once they pass (default: from .bugzerorc, else true).
   */
  focusTests?: boolean;
  /**
   * `rescue` only: the most AI tokens the run may use, fix attempts and report together (default: from
   * .bugzerorc, else no limit). 0 means no limit.
   */
  maxTokens?: number;
  /** When true, only analyse — never write files */
  dryRun?: boolean;
  /** Stop any build/lint/test command that runs longer than this many seconds (default: no limit) */
  timeoutSeconds?: number;
  /** `hunt` only: set to false to write the report without contacting an AI model (default: true) */
  aiReport?: boolean;
  /**
   * `rescue` only: run the checks, then return the exact prompt that would be sent to the AI model as
   * `promptPreview` without sending it, repairing anything, or writing a report.
   */
  printPrompt?: boolean;
  /** `rescue` only: when given, each proposed fix is shown to it first and is only written if it approves */
  approve?: ApprovalHandler;
}

/** Run build, lint and tests — return raw results without touching files. */
export async function orchestrate(options: OrchestrateOptions = {}) {
  const cwd = options.cwd ?? process.cwd();
  assertNodeProject(cwd);
  const timeoutMs = resolveTimeoutMs(options.timeoutSeconds);
  const [build, lint, test] = await Promise.all([
    runBuild(cwd, { timeoutMs }),
    runLint(cwd, { timeoutMs }),
    runTests(cwd, { timeoutMs }),
  ]);

  await writeReport(cwd, "hunt", {
    success: build.success && lint.success && test.success,
    build,
    lint,
    test,
    aiReport: options.aiReport,
  });

  return { build, lint, test };
}

/**
 * Run the build, and if it fails kick off the AI fix loop.
 * Returns a FixResult describing how many attempts were made and whether
 * the build was ultimately repaired.
 */
export async function orchestrateAndFix(
  options: OrchestrateOptions = {}
): Promise<FixResult> {
  const cwd = options.cwd ?? process.cwd();
  assertNodeProject(cwd);
  const maxAttempts = resolveMaxAttempts(options.maxAttempts);
  const timeoutMs = resolveTimeoutMs(options.timeoutSeconds);
  const config = getLocalConfig(cwd);
  const patience = resolvePatience(options.patience, config.patience);
  const focusTests = resolveFocusTests(options.focusTests, config.focusTests);
  const maxTokens = resolveMaxTokens(options.maxTokens, config.maxTokens);

  // ── Step 1: Initial validation run ──────────────────────────────────────
  console.log(`[BugZero] Running validation pipeline in: ${cwd}`);
  const pipelineResult = await runValidationPipeline(cwd, { timeoutMs });

  if (pipelineResult.success) {
    console.log("[BugZero] Validation already passing — nothing to fix.");
    if (options.printPrompt) {
      console.log("[BugZero] Nothing would be sent to an AI model.");
      return { success: true, attempts: 0, finalOutput: "" };
    }
    await writeReport(cwd, "rescue", {
      success: true,
      attempts: 0,
      maxAttempts,
      rawOutput: "",
      alreadyPassing: true,
    });
    return { success: true, attempts: 0, finalOutput: "" };
  }

  // ── Step 2: Parse errors for context ────────────────────────────────────
  const errors = parseErrors(pipelineResult.output);
  console.log(`[BugZero] Detected ${errors.length} error(s) (type: ${errors[0]?.type ?? "unknown"})`);

  if (options.printPrompt) {
    console.log("[BugZero] --print-prompt: showing the first prompt without sending it.");
    return {
      success: false,
      attempts: 0,
      finalOutput: pipelineResult.output,
      promptPreview: previewAnalysisPrompt(cwd, pipelineResult.output),
    };
  }

  if (options.dryRun) {
    console.log("[BugZero] Dry-run mode — skipping AI fix.");
    const spend = await writeReport(cwd, "rescue", {
      success: false,
      attempts: 0,
      maxAttempts,
      error: "Dry-run: analysis complete, no files modified.",
      rawOutput: pipelineResult.output,
      dryRun: true,
      maxTokens,
    });
    return {
      success: false,
      attempts: 0,
      finalOutput: pipelineResult.output,
      error: "Dry-run: analysis complete, no files modified.",
      ...tokenBudgetUse(maxTokens, spend),
    };
  }

  // ── Step 3: AI fix loop via LangGraph ───────────────────────────────────
  const finalState = await runRepairWorkflow({
    cwd,
    logs: pipelineResult.output,
    maxAttempts,
    timeoutMs,
    approve: options.approve,
    patience,
    focusTests,
    maxTokens,
    initialStep: pipelineResult.step,
  });

  const result = {
    success: finalState.success,
    attempts: finalState.attempts,
    finalOutput: finalState.logs || pipelineResult.output,
    appliedFix: finalState.appliedFix ?? undefined,
    error: finalState.success ? undefined : failureMessage(
          maxAttempts,
          finalState.declinedFixes ?? 0,
          Boolean(finalState.appliedFix),
          finalState.stoppedForNoProgress ? patience : undefined,
          finalState.budgetStop ?? undefined
        ),
    stoppedEarly: finalState.budgetStop
      ? ("token-budget" as const)
      : finalState.stoppedForNoProgress
        ? ("no-progress" as const)
        : undefined,
    declinedFixes: finalState.declinedFixes ? finalState.declinedFixes : undefined,
    modelUsed: finalState.modelUsed,
    promptTokens: finalState.promptTokens,
    completionTokens: finalState.completionTokens,
  };

  const spend = await writeReport(cwd, "rescue", {
    success: result.success,
    attempts: result.attempts,
    maxAttempts,
    appliedFix: result.appliedFix,
    error: result.error,
    rawOutput: result.finalOutput,
    modelUsed: result.modelUsed,
    promptTokens: result.promptTokens,
    completionTokens: result.completionTokens,
    maxTokens,
    tokensUsed: (result.promptTokens ?? 0) + (result.completionTokens ?? 0),
    tokensEstimated: finalState.tokensEstimated,
  });

  return { ...result, ...tokenBudgetUse(maxTokens, spend) };
}

/** What the whole run spent of its token budget; the report request is included. */
interface ReportSpend {
  tokensUsed: number;
  tokensEstimated: boolean;
}

function tokenBudgetUse(maxTokens: number | undefined, spend: ReportSpend): { tokenBudget?: TokenBudgetUse } {
  if (maxTokens === undefined) return {};
  return { tokenBudget: { limit: maxTokens, used: spend.tokensUsed, estimated: spend.tokensEstimated } };
}

function formatPatchesMarkdown(appliedFix: { patches: { filePath: string; search: string; replace: string }[] }): string {
  return appliedFix.patches
    .map(
      (p) =>
        `**File:** \`${p.filePath}\`\n\n**Search (Before):**\n\`\`\`typescript\n${p.search}\n\`\`\`\n\n**Replace (After):**\n\`\`\`typescript\n${p.replace}\n\`\`\``
    )
    .join("\n\n---\n\n");
}

async function writeReport(
  cwd: string,
  type: "hunt" | "rescue",
  data: {
    success: boolean;
    attempts?: number;
    maxAttempts?: number;
    appliedFix?: any;
    error?: string;
    /** True when the run was a dry run, so the report describes analysis rather than a failed repair. */
    dryRun?: boolean;
    /** True when everything already passed, so there was nothing to repair and no AI call is needed. */
    alreadyPassing?: boolean;
    /** `hunt` only: false means do not contact an AI model for the report. */
    aiReport?: boolean;
    build?: any;
    lint?: any;
    test?: any;
    rawOutput?: string;
    modelUsed?: string;
    promptTokens?: number;
    completionTokens?: number;
    /** `rescue` only: the run's token budget, and what the fix attempts already spent of it */
    maxTokens?: number;
    tokensUsed?: number;
    tokensEstimated?: boolean;
  }
): Promise<ReportSpend> {
  let content = "";

  const provider = new OpenRouterProvider();
  const spend: ReportSpend = { tokensUsed: data.tokensUsed ?? 0, tokensEstimated: data.tokensEstimated ?? false };

  /**
   * The AI request for a `rescue` report, kept within the token budget. When the budget has no room for it, or the
   * capped reply comes back empty, it throws like any failed request, so the report is written without the AI.
   */
  const askForReport = async (prompt: string, announcement: string) => {
    const budget = checkBudget(data.maxTokens, spend.tokensUsed, prompt);
    if (!budget.allowed) {
      console.log(`[BugZero] ${budget.reason} Writing the report without the AI.`);
      throw new Error(budget.reason);
    }
    console.log(announcement);
    const result = await provider.invoke(prompt, { cwd, maxTokens: budget.maxReplyTokens });
    if (data.maxTokens === undefined) return result;

    const cost = countCallTokens(data.maxTokens, prompt, result);
    spend.tokensUsed += cost.promptTokens + cost.completionTokens;
    spend.tokensEstimated ||= cost.estimated;
    if (result.content.trim() === "") {
      throw new Error("The AI returned an empty reply within the token budget.");
    }
    if (!result.truncated) return result;
    return { ...result, content: `${result.content}\n\n> ⚠️ This AI-written text was cut off by its length limit (see --max-tokens).` };
  };

  /** Says in a report written without the AI why that was, when a token budget is the context for it. */
  const aiNote = (reason: string) => (data.maxTokens === undefined ? "" : `\n*The AI did not write this report: ${reason}*\n`);

  if (type === "hunt") {
    const { build, lint, test } = data;
    
    // Check if there are failures
    if (!build.success || !lint.success || !test.success) {
      let logs = "";
      if (!build.success) logs += `[BUILD FAILURE]\n${build.output}\n\n`;
      if (!lint.success) logs += `[LINT FAILURE]\n${lint.output}\n\n`;
      if (!test.success) logs += `[TEST FAILURE]\n${test.output}\n\n`;

      // The same report without an AI diagnosis, used when the AI is turned off or the call fails.
      const reportWithoutAi = (modelLine: string, tokenLine: string) => `# 🔍 BugZero Hunt Report

**Date:** ${new Date().toLocaleString()}
**Project Path:** \`${cwd}\`
**Framework:** \`${detectFramework(cwd)}\`

## 📊 Status Summary
- **Build:** ${statusLabel(build)}
- **Lint:** ${statusLabel(lint)}
- **Test:** ${statusLabel(test)}

## ❌ Failed Checks & Error Output
${logs}

---
### 🔍 BugZero Hunt Metadata
- **AI Brain (Model) used for Diagnosis:** ${modelLine}
- **Token Usage for Diagnosis:** ${tokenLine}
`;

      if (data.aiReport === false) {
        console.log("[BugZero] AI report turned off (--no-ai-report) — writing the report without contacting an AI model.");
        content = reportWithoutAi("*None (AI report turned off)*", "*N/A*");
      } else {
        console.log("[BugZero] Calling AI to diagnose errors and write report...");
        const prompt = buildHuntDiagnosisPrompt({ build, lint, test });

        try {
          const result = await provider.invoke(prompt, { cwd });
          content = result.content;
          content += `\n\n---\n### 🔍 BugZero Hunt Metadata\n- **AI Brain (Model) used for Diagnosis:** \`${result.model || "unknown"}\`\n- **Token Usage for Diagnosis:** ${result.usage ? `Prompt: **${result.usage.prompt_tokens}** | Completion: **${result.usage.completion_tokens}** | Total: **${result.usage.total_tokens}**` : "*N/A*"}`;
        } catch (e: any) {
          content = reportWithoutAi("*None (AI call failed)*", `*N/A (AI call failed: ${e.message})*`);
        }
      }
    } else {
      content = `# 🔍 BugZero Hunt Report

**Date:** ${new Date().toLocaleString()}
**Project Path:** \`${cwd}\`
**Framework:** \`${detectFramework(cwd)}\`

## 📊 Status Summary
- **Build:** ${statusLabel(build)}
- **Lint:** ${statusLabel(lint)}
- **Test:** ${statusLabel(test)}

🎉 **All checks passed! Your project is in perfect shape.**`;
    }
  } else {
    const { success, attempts, maxAttempts, appliedFix, error, rawOutput, modelUsed, promptTokens, completionTokens } = data;
    
    if (data.alreadyPassing) {
      content = `# 🤖 BugZero Rescue Report

**Date:** ${new Date().toLocaleString()}
**Project Path:** \`${cwd}\`
**Framework:** \`${detectFramework(cwd)}\`

## 📊 Repair Summary
- **Status:** ✅ Nothing to fix
- **Attempts:** 0 / ${maxAttempts}

Your project already passes its build, lint, and tests, so BugZero made no changes and did not call an AI model.`;
    } else if (data.dryRun) {
      try {
        const result = await askForReport(
          buildDryRunPrompt(cwd, rawOutput ?? ""),
          "[BugZero] Calling AI to diagnose the detected errors and write report..."
        );
        content = result.content + buildDryRunMetadata(result);
      } catch (e: any) {
        content = buildDryRunFallbackReport({
          cwd,
          framework: detectFramework(cwd),
          rawOutput: rawOutput ?? "",
          aiError: e.message,
        });
      }
    } else if (success && appliedFix) {
      const prompt = buildRescueSuccessPrompt({ cwd, attempts, appliedFix });

      try {
        const result = await askForReport(prompt, "[BugZero] Calling AI to write solution summary report...");
        content = result.content;
        content += `\n\n---\n### 🤖 BugZero Rescue Metadata\n- **AI Brain (Model) used for Fix:** \`${modelUsed || "unknown"}\`\n- **Token Usage for Fix:** ${promptTokens !== undefined && completionTokens !== undefined ? `Prompt: **${promptTokens}** | Completion: **${completionTokens}** | Total: **${promptTokens + completionTokens}**` : "*N/A*"}\n- **AI Brain (Model) used for Report:** \`${result.model || "unknown"}\`\n- **Token Usage for Report:** ${result.usage ? `Prompt: **${result.usage.prompt_tokens}** | Completion: **${result.usage.completion_tokens}** | Total: **${result.usage.total_tokens}**` : "*N/A*"}`;
      } catch (e: any) {
        content = `# 🤖 BugZero Rescue Report

**Date:** ${new Date().toLocaleString()}
**Project Path:** \`${cwd}\`
**Framework:** \`${detectFramework(cwd)}\`

## 📊 Repair Summary
- **Status:** ✅ Fixed successfully!
${aiNote(e.message)}- **Attempts:** ${attempts} / ${maxAttempts}
- **AI Brain (Model):** \`${modelUsed || "unknown"}\`
- **Token Usage:** ${promptTokens !== undefined && completionTokens !== undefined ? `Prompt: **${promptTokens}** | Completion: **${completionTokens}** | Total: **${promptTokens + completionTokens}**` : "*N/A*"}

## 🛠️ Applied Solution
- **Target File(s):** ${uniqueFilePaths(appliedFix.patches).map((file) => `\`${file}\``).join(", ")}
- **Root Cause:** ${appliedFix.rootCause}
- **Explanation:** ${appliedFix.explanation}

### 📝 Code Changes
${formatPatchesMarkdown(appliedFix)}
`;
      }
    } else {
      const prompt = buildRescueFailurePrompt({ cwd, attempts, rawOutput });

      try {
        const result = await askForReport(prompt, "[BugZero] Calling AI to analyze unresolved errors and write report...");
        content = result.content;
        content += `\n\n---\n### 🤖 BugZero Rescue Metadata\n- **AI Brain (Model) used for Fix Attempts:** \`${modelUsed || "unknown"}\`\n- **Token Usage for Fix Attempts:** ${promptTokens !== undefined && completionTokens !== undefined ? `Prompt: **${promptTokens}** | Completion: **${completionTokens}** | Total: **${promptTokens + completionTokens}**` : "*N/A*"}\n- **AI Brain (Model) used for Report:** \`${result.model || "unknown"}\`\n- **Token Usage for Report:** ${result.usage ? `Prompt: **${result.usage.prompt_tokens}** | Completion: **${result.usage.completion_tokens}** | Total: **${result.usage.total_tokens}**` : "*N/A*"}`;
      } catch (e: any) {
        content = `# 🤖 BugZero Rescue Report

**Date:** ${new Date().toLocaleString()}
**Project Path:** \`${cwd}\`
**Framework:** \`${detectFramework(cwd)}\`

## 📊 Repair Summary
- **Status:** ❌ Could not repair automatically
- **Attempts:** ${attempts} / ${maxAttempts}
- **AI Brain (Model):** \`${modelUsed || "unknown"}\`
- **Token Usage:** ${promptTokens !== undefined && completionTokens !== undefined ? `Prompt: **${promptTokens}** | Completion: **${completionTokens}** | Total: **${promptTokens + completionTokens}**` : "*N/A*"}

## ❌ Failed to Repair
**Reason:** ${error || "Max attempts reached without finding a solution."}
${aiNote(e.message)}
### 🟥 Unresolved Errors & Logs
\`\`\`text
${rawOutput}
\`\`\`
`;
      }
    }
  }

  if (data.maxTokens !== undefined) {
    const estimates = spend.tokensEstimated ? " (includes estimates)" : "";
    content += `\n\n---\n**Token budget:** ${spend.tokensUsed} of ${data.maxTokens} tokens used${estimates}`;
  }

  // Add metadata footer to report
  content += `\n\n---\n*Report generated by **BugZero** on ${new Date().toLocaleString()}*`;

  const reportPath = path.resolve(cwd, REPORT_FILENAME);
  try {
    fs.writeFileSync(reportPath, content, "utf-8");
    const clickableUrl = pathToFileURL(reportPath).toString();
    console.log(`\n📝 Generated report successfully!\n`);
    console.log(`👉 Click to open: ${clickableUrl}\n`);
    console.log(`👉 Absolute path: ${reportPath}\n`);
  } catch (e: any) {
    console.error(`⚠️ Failed to write report file: ${e.message}`);
    console.log("Here is the generated report:\n");
    console.log(content);
    console.log("\n──────────────────────────────────────────────");
  }
  return spend;
}