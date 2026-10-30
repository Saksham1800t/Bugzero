interface ReportUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

/**
 * Prompt for the AI-written dry-run report. A dry run found failures but
 * deliberately attempted no fix, so — unlike the rescue-failure prompt — it
 * must not suggest any repair was tried and failed.
 */
export function buildDryRunPrompt(cwd: string, rawOutput: string): string {
  return `You are an expert software engineer assistant. BugZero ran in dry-run mode on the project located at "${cwd}": it ran the project's build/lint/test checks and found failures, but it intentionally attempted NO fixes and modified NO files.
Below is the error output.
Please analyze these logs and generate a professional, beautifully formatted Markdown report summarizing:
1. **Diagnosis:** Clear explanation of what failed and why.
2. **Root Cause:** The underlying issue in the code or config.
3. **Suggested Fix:** Step-by-step instructions on what files need to be modified and what exact changes to make.

Error Logs:
${rawOutput}

Generate the Markdown report directly. Do not wrap it in markdown block fences (\`\`\`markdown ... \`\`\`). Just write the markdown text directly.`;
}

/** Metadata footer appended to an AI-written dry-run report. */
export function buildDryRunMetadata(response: { model?: string; usage?: ReportUsage }): string {
  const usage = response.usage
    ? `Prompt: **${response.usage.prompt_tokens}** | Completion: **${response.usage.completion_tokens}** | Total: **${response.usage.total_tokens}**`
    : "*N/A*";

  return `\n\n---\n### 🔍 BugZero Dry Run Metadata\n- **Mode:** Dry run (no fixes attempted, no files modified)\n- **AI Brain (Model) used for Diagnosis:** \`${response.model || "unknown"}\`\n- **Token Usage for Diagnosis:** ${usage}`;
}

/** Report used when the AI diagnosis is unavailable (no API key, network error, etc.). */
export function buildDryRunFallbackReport(params: {
  cwd: string;
  framework: string;
  rawOutput: string;
  aiError?: string;
}): string {
  const aiNote = params.aiError ? `\n*AI diagnosis was unavailable for this report: ${params.aiError}*\n` : "";

  return `# 🔍 BugZero Dry Run Report

**Date:** ${new Date().toLocaleString()}
**Project Path:** \`${params.cwd}\`
**Framework:** \`${params.framework}\`

## 📊 Summary
- **Mode:** Dry run — no fixes were attempted and no files were modified
- **Result:** ❌ Failures detected
${aiNote}
## ❌ Detected Errors & Logs
\`\`\`text
${params.rawOutput}
\`\`\`

Re-run without \`--dry-run\` to let BugZero attempt a fix.
`;
}
