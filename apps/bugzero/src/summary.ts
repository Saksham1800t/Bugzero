import type { orchestrateAndFix } from "@opspilot/core";

type RescueResult = Awaited<ReturnType<typeof orchestrateAndFix>>;

export interface RescueSummary {
  lines: string[];
  exitCode: 0 | 1;
}

function tokenLines(result: RescueResult): string[] {
  if (result.promptTokens === undefined || result.completionTokens === undefined) return [];
  const total = result.promptTokens + result.completionTokens;
  return [`   Tokens: Prompt: ${result.promptTokens} | Completion: ${result.completionTokens} | Total: ${total}`];
}

/** Builds the closing summary `bugzero rescue` prints, and the exit code to use. */
export function buildRescueSummary(result: RescueResult, options: { dryRun: boolean }): RescueSummary {
  if (result.success && result.attempts === 0) {
    return {
      exitCode: 0,
      lines: ["✅ Nothing to fix — your project already passes its build, lint, and tests."],
    };
  }

  if (result.success) {
    const lines = [
      `✅ Build fixed after ${result.attempts} attempt(s)!`,
      `   Model:  ${result.modelUsed || "unknown"}`,
      ...tokenLines(result),
    ];
    if (result.appliedFix) {
      const { patches, explanation, rootCause } = result.appliedFix;
      lines.push(
        `   File${patches.length === 1 ? "" : "s"}:   ${patches.map((p) => p.filePath).join(", ")}`,
        `   Reason: ${explanation}`,
        `   Root cause: ${rootCause}`
      );
    }
    return { exitCode: 0, lines };
  }

  if (options.dryRun) {
    // A dry run found failures but deliberately attempted no fix — that's the analysis working, not a failed repair.
    return {
      exitCode: 1,
      lines: [
        "🔍 Dry run complete — failures were detected, but no fixes were attempted and no files were modified.",
        "   Re-run without --dry-run to let BugZero attempt a fix.",
        "",
        "👉 Full error logs have been listed in the generated report.",
      ],
    };
  }

  const lines = [
    `❌ Could not fix build after ${result.attempts} attempt(s).`,
    `   Model:  ${result.modelUsed || "unknown"}`,
    ...tokenLines(result),
  ];
  if (result.error) lines.push(`   ${result.error}`);
  lines.push("", "👉 Full unresolved error logs have been listed in the generated report.");
  return { exitCode: 1, lines };
}
