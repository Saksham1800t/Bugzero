import { runBuild, runLint, runTests, parseErrors, runValidationPipeline } from "@opspilot/analyzers";
import { workflow } from "@opspilot/agents";
import type { FixResult } from "@opspilot/shared";
import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";
import { detectFramework } from "./framework-detector";
import { OpenRouterProvider } from "@opspilot/ai-provider";

export interface OrchestrateOptions {
  /** Absolute path to the target project (defaults to process.cwd()) */
  cwd?: string;
  /** Maximum AI fix attempts (default: 3) */
  maxAttempts?: number;
  /** When true, only analyse — never write files */
  dryRun?: boolean;
}

/** Run build, lint and tests — return raw results without touching files. */
export async function orchestrate(options: OrchestrateOptions = {}) {
  const cwd = options.cwd ?? process.cwd();
  const [build, lint, test] = await Promise.all([
    runBuild(cwd),
    runLint(cwd),
    runTests(cwd),
  ]);

  await writeReport(cwd, "hunt", {
    success: build.success && lint.success && test.success,
    build,
    lint,
    test
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
  const maxAttempts = options.maxAttempts ?? 3;

  // ── Step 1: Initial validation run ──────────────────────────────────────
  console.log(`[BugZero] Running validation pipeline in: ${cwd}`);
  const pipelineResult = await runValidationPipeline(cwd);

  if (pipelineResult.success) {
    console.log("[BugZero] Validation already passing — nothing to fix.");
    await writeReport(cwd, "rescue", {
      success: true,
      attempts: 0,
      maxAttempts,
      rawOutput: ""
    });
    return { success: true, attempts: 0, finalOutput: "" };
  }

  // ── Step 2: Parse errors for context ────────────────────────────────────
  const errors = parseErrors(pipelineResult.output);
  console.log(`[BugZero] Detected ${errors.length} error(s) (type: ${errors[0]?.type ?? "unknown"})`);

  if (options.dryRun) {
    console.log("[BugZero] Dry-run mode — skipping AI fix.");
    await writeReport(cwd, "rescue", {
      success: false,
      attempts: 0,
      maxAttempts,
      error: "Dry-run: analysis complete, no files modified.",
      rawOutput: pipelineResult.output
    });
    return {
      success: false,
      attempts: 0,
      finalOutput: pipelineResult.output,
      error: "Dry-run: analysis complete, no files modified.",
    };
  }

  // ── Step 3: AI fix loop via LangGraph ───────────────────────────────────
  const finalState = await workflow.invoke({
    cwd,
    logs: pipelineResult.output,
    maxAttempts,
    attempts: 0,
    success: false,
  });

  const result = {
    success: finalState.success,
    attempts: finalState.attempts,
    finalOutput: finalState.logs || pipelineResult.output,
    appliedFix: finalState.fixSuggestion ?? undefined,
    error: finalState.success
      ? undefined
      : `Max attempts (${maxAttempts}) reached without a successful build.`,
    modelUsed: finalState.modelUsed,
    promptTokens: finalState.promptTokens,
    completionTokens: finalState.completionTokens,
  };

  await writeReport(cwd, "rescue", {
    success: result.success,
    attempts: result.attempts,
    maxAttempts,
    appliedFix: result.appliedFix,
    error: result.error,
    rawOutput: result.finalOutput,
    modelUsed: result.modelUsed,
    promptTokens: result.promptTokens,
    completionTokens: result.completionTokens,
  });

  return result;
}

function formatPatchesForPrompt(appliedFix: { patches: { filePath: string; search: string; replace: string }[] }): string {
  return appliedFix.patches
    .map(
      (p, i) =>
        `File ${i + 1}: ${p.filePath}\n- Search code:\n${p.search}\n- Replace code:\n${p.replace}`
    )
    .join("\n\n");
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
    build?: any;
    lint?: any;
    test?: any;
    rawOutput?: string;
    modelUsed?: string;
    promptTokens?: number;
    completionTokens?: number;
  }
) {
  let content = "";

  const provider = new OpenRouterProvider();

  if (type === "hunt") {
    const { build, lint, test } = data;
    
    // Check if there are failures
    if (!build.success || !lint.success || !test.success) {
      let logs = "";
      if (!build.success) logs += `[BUILD FAILURE]\n${build.output}\n\n`;
      if (!lint.success) logs += `[LINT FAILURE]\n${lint.output}\n\n`;
      if (!test.success) logs += `[TEST FAILURE]\n${test.output}\n\n`;

      console.log("[BugZero] Calling AI to diagnose errors and write report...");
      const prompt = `You are an expert software engineer assistant. Below is the error output from a project's build, lint, and test checks.
Please analyze the errors and generate a professional, beautifully formatted Markdown report summarizing:
1. **Diagnosis:** Clear explanation of what failed and why.
2. **Root Cause:** The underlying issue in the code/config.
3. **Action Plan:** Step-by-step instructions on what files need to be modified and what exact changes to make.

Failed Checks Logs:
${logs}

Generate the Markdown report directly. Do not wrap it in markdown block fences (\`\`\`markdown ... \`\`\`). Just write the markdown text directly.`;
      
      try {
        const result = await provider.invoke(prompt, { cwd });
        content = result.content;
        content += `\n\n---\n### 🔍 BugZero Hunt Metadata\n- **AI Brain (Model) used for Diagnosis:** \`${result.model || "unknown"}\`\n- **Token Usage for Diagnosis:** ${result.usage ? `Prompt: **${result.usage.prompt_tokens}** | Completion: **${result.usage.completion_tokens}** | Total: **${result.usage.total_tokens}**` : "*N/A*"}`;
      } catch (e: any) {
        content = `# 🔍 BugZero Hunt Report

**Date:** ${new Date().toLocaleString()}
**Project Path:** \`${cwd}\`
**Framework:** \`${detectFramework(cwd)}\`

## 📊 Status Summary
- **Build:** ${build.success ? "✅ Passed" : "❌ Failed"}
- **Lint:** ${lint.success ? "✅ Passed" : "❌ Failed"}
- **Test:** ${test.success ? "✅ Passed" : "❌ Failed"}

## ❌ Failed Checks & Error Output
${logs}

---
### 🔍 BugZero Hunt Metadata
- **AI Brain (Model) used for Diagnosis:** *None (AI call failed)*
- **Token Usage for Diagnosis:** *N/A (AI call failed: ${e.message})*
`;
      }
    } else {
      content = `# 🔍 BugZero Hunt Report

**Date:** ${new Date().toLocaleString()}
**Project Path:** \`${cwd}\`
**Framework:** \`${detectFramework(cwd)}\`

## 📊 Status Summary
- **Build:** ✅ Passed
- **Lint:** ✅ Passed
- **Test:** ✅ Passed

🎉 **All checks passed! Your project is in perfect shape.**`;
    }
  } else {
    const { success, attempts, maxAttempts, appliedFix, error, rawOutput, modelUsed, promptTokens, completionTokens } = data;
    
    if (success && appliedFix) {
      console.log("[BugZero] Calling AI to write solution summary report...");
      const patchedFiles = appliedFix.patches.map((p: { filePath: string }) => p.filePath).join(", ");
      const prompt = `You are an expert software engineer assistant. An automated AI agent successfully resolved a build/lint/test failure in a project located at "${cwd}" after ${attempts} attempts by applying a patch to: ${patchedFiles}.
Here is the patch details:
- Root Cause: ${appliedFix.rootCause}
- Explanation: ${appliedFix.explanation}
${formatPatchesForPrompt(appliedFix)}

Please generate a professional, beautifully formatted Markdown report summarizing:
1. **Repair Summary:** Celebrate the success and explain the fix.
2. **Details of the Solution:** Walk the developer through what was changed and why.
3. **Verification:** Explain how it was verified (build, lint, tests passed).

Generate the Markdown report directly. Do not wrap it in markdown block fences (\`\`\`markdown ... \`\`\`). Just write the markdown text directly.`;

      try {
        const result = await provider.invoke(prompt, { cwd });
        content = result.content;
        content += `\n\n---\n### 🤖 BugZero Rescue Metadata\n- **AI Brain (Model) used for Fix:** \`${modelUsed || "unknown"}\`\n- **Token Usage for Fix:** ${promptTokens !== undefined && completionTokens !== undefined ? `Prompt: **${promptTokens}** | Completion: **${completionTokens}** | Total: **${promptTokens + completionTokens}**` : "*N/A*"}\n- **AI Brain (Model) used for Report:** \`${result.model || "unknown"}\`\n- **Token Usage for Report:** ${result.usage ? `Prompt: **${result.usage.prompt_tokens}** | Completion: **${result.usage.completion_tokens}** | Total: **${result.usage.total_tokens}**` : "*N/A*"}`;
      } catch (e: any) {
        content = `# 🤖 BugZero Rescue Report

**Date:** ${new Date().toLocaleString()}
**Project Path:** \`${cwd}\`
**Framework:** \`${detectFramework(cwd)}\`

## 📊 Repair Summary
- **Status:** ✅ Fixed successfully!
- **Attempts:** ${attempts} / ${maxAttempts}
- **AI Brain (Model):** \`${modelUsed || "unknown"}\`
- **Token Usage:** ${promptTokens !== undefined && completionTokens !== undefined ? `Prompt: **${promptTokens}** | Completion: **${completionTokens}** | Total: **${promptTokens + completionTokens}**` : "*N/A*"}

## 🛠️ Applied Solution
- **Target File(s):** ${appliedFix.patches.map((p: { filePath: string }) => `\`${p.filePath}\``).join(", ")}
- **Root Cause:** ${appliedFix.rootCause}
- **Explanation:** ${appliedFix.explanation}

### 📝 Code Changes
${formatPatchesMarkdown(appliedFix)}
`;
      }
    } else {
      console.log("[BugZero] Calling AI to analyze unresolved errors and write report...");
      const prompt = `You are an expert software engineer assistant. An automated AI agent tried to repair build/lint/test errors in a project located at "${cwd}", but could not resolve them after ${attempts} attempts.
Below is the unresolved error logs.
Please analyze these logs and generate a professional, beautifully formatted Markdown report summarizing:
1. **Analysis of Unresolved Errors:** Explain why the AI fixes might have failed or what is still unresolved.
2. **Manual Action Plan:** Provide detailed, step-by-step instructions for the developer on how to fix this manually.

Unresolved Error Logs:
${rawOutput}

Generate the Markdown report directly. Do not wrap it in markdown block fences (\`\`\`markdown ... \`\`\`). Just write the markdown text directly.`;

      try {
        const result = await provider.invoke(prompt, { cwd });
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

### 🟥 Unresolved Errors & Logs
\`\`\`text
${rawOutput}
\`\`\`
`;
      }
    }
  }

  // Add metadata footer to report
  content += `\n\n---\n*Report generated by **BugZero** on ${new Date().toLocaleString()}*`;

  const reportPath = path.resolve(cwd, "bugzero-report.md");
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
}