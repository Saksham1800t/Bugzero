import { truncateLogs } from "@opspilot/prompts";
import { uniqueFilePaths, type AIFixSuggestion } from "@opspilot/shared";

/**
 * The most log text one report prompt may carry. A huge failing run (thousands of test failures, a giant
 * stack trace) would otherwise be sent to the model whole, costing tokens and risking the context window.
 */
export const MAX_REPORT_LOG_CHARS = 20_000;

/** Shortens logs to `maxChars`, keeping the start and the end. Logs within the limit are returned unchanged. */
export function capReportLogs(logs: string, maxChars: number = MAX_REPORT_LOG_CHARS): string {
  return truncateLogs(logs, maxChars);
}

interface CheckOutput {
  success: boolean;
  output?: string;
}

/** Prompt for the AI-written `hunt` report. The log budget is shared between the failing checks. */
export function buildHuntDiagnosisPrompt(checks: { build: CheckOutput; lint: CheckOutput; test: CheckOutput }): string {
  const sections = [
    { label: "BUILD FAILURE", check: checks.build },
    { label: "LINT FAILURE", check: checks.lint },
    { label: "TEST FAILURE", check: checks.test },
  ].filter((section) => !section.check.success);

  // Give each failing check an equal share, so one noisy check can't push the others out of the prompt.
  const share = Math.floor(MAX_REPORT_LOG_CHARS / Math.max(sections.length, 1));
  const logs = sections
    .map((section) => `[${section.label}]\n${capReportLogs(section.check.output ?? "", share)}\n\n`)
    .join("");

  return `You are an expert software engineer assistant. Below is the error output from a project's build, lint, and test checks.
Please analyze the errors and generate a professional, beautifully formatted Markdown report summarizing:
1. **Diagnosis:** Clear explanation of what failed and why.
2. **Root Cause:** The underlying issue in the code/config.
3. **Action Plan:** Step-by-step instructions on what files need to be modified and what exact changes to make.

Failed Checks Logs:
${logs}

Generate the Markdown report directly. Do not wrap it in markdown block fences (\`\`\`markdown ... \`\`\`). Just write the markdown text directly.`;
}

function formatPatchesForPrompt(appliedFix: Pick<AIFixSuggestion, "patches">): string {
  return appliedFix.patches
    .map(
      (p, i) =>
        `File ${i + 1}: ${p.filePath}\n- Search code:\n${p.search}\n- Replace code:\n${p.replace}`
    )
    .join("\n\n");
}

/** Prompt for the AI-written report after `rescue` fixed the project. */
export function buildRescueSuccessPrompt(params: {
  cwd: string;
  attempts: number | undefined;
  appliedFix: AIFixSuggestion;
}): string {
  const { cwd, attempts, appliedFix } = params;
  const patchedFiles = uniqueFilePaths(appliedFix.patches).join(", ");
  return `You are an expert software engineer assistant. An automated AI agent successfully resolved a build/lint/test failure in a project located at "${cwd}" after ${attempts} attempts by applying a patch to: ${patchedFiles}.
Here is the patch details:
- Root Cause: ${appliedFix.rootCause}
- Explanation: ${appliedFix.explanation}
${formatPatchesForPrompt(appliedFix)}

Please generate a professional, beautifully formatted Markdown report summarizing:
1. **Repair Summary:** Celebrate the success and explain the fix.
2. **Details of the Solution:** Walk the developer through what was changed and why.
3. **Verification:** Explain how it was verified (build, lint, tests passed).

Generate the Markdown report directly. Do not wrap it in markdown block fences (\`\`\`markdown ... \`\`\`). Just write the markdown text directly.`;
}

/** Prompt for the AI-written report after `rescue` could not fix the project. */
export function buildRescueFailurePrompt(params: {
  cwd: string;
  attempts: number | undefined;
  rawOutput: string | undefined;
}): string {
  const { cwd, attempts, rawOutput } = params;
  return `You are an expert software engineer assistant. An automated AI agent tried to repair build/lint/test errors in a project located at "${cwd}", but could not resolve them after ${attempts} attempts.
Below is the unresolved error logs.
Please analyze these logs and generate a professional, beautifully formatted Markdown report summarizing:
1. **Analysis of Unresolved Errors:** Explain why the AI fixes might have failed or what is still unresolved.
2. **Manual Action Plan:** Provide detailed, step-by-step instructions for the developer on how to fix this manually.

Unresolved Error Logs:
${capReportLogs(rawOutput ?? "")}

Generate the Markdown report directly. Do not wrap it in markdown block fences (\`\`\`markdown ... \`\`\`). Just write the markdown text directly.`;
}
