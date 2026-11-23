import type { orchestrateAndFix } from "@opspilot/core";
import { renderChangesFromBackups, type UndoEntry } from "@opspilot/patcher";
import path from "path";
import { uniqueFilePaths } from "@opspilot/shared";

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
      const files = uniqueFilePaths(patches);
      lines.push(
        `   File${files.length === 1 ? "" : "s"}:   ${files.join(", ")}`,
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

/**
 * The lines showing what a successful repair changed: a unified diff of each edited file against the original
 * saved next to it. Empty when nothing was repaired or the originals are not there.
 */
export function buildChangeDiffLines(cwd: string, result: RescueResult): string[] {
  if (!result.success || !result.appliedFix) return [];
  const diff = renderChangesFromBackups(cwd, uniqueFilePaths(result.appliedFix.patches));
  if (diff === "") return [];
  return ["", "Changes (the original of each file is kept next to it as <file>.opspilot.bak):", "", ...diff.split("\n")];
}

/**
 * The closing hint telling a person how to put things back, shown after a run that changed files (a fix
 * that worked, or one that changed files and still failed). Empty when nothing was changed.
 */
export function buildUndoHintLines(cwd: string, result: RescueResult, options: { dryRun: boolean }): string[] {
  if (options.dryRun || !result.appliedFix) return [];
  const command = path.resolve(cwd) === path.resolve(process.cwd()) ? "bugzero undo" : `bugzero undo --path "${path.resolve(cwd)}"`;
  const lead = result.success
    ? "To put the files back as they were:"
    : "BugZero changed files before giving up. To put them back as they were:";
  return ["", `${lead} ${command}`];
}

export interface UndoSummary {
  lines: string[];
  exitCode: 0 | 1;
}

/** Builds what `bugzero undo` prints. Exit code 1 means some file was not restored. */
export function buildUndoSummary(entries: UndoEntry[], options: { dryRun: boolean }): UndoSummary {
  if (entries.length === 0) {
    return { exitCode: 0, lines: ["Nothing to undo — no BugZero backups (*.opspilot.bak) were found."] };
  }

  const lines: string[] = [];
  for (const entry of entries) {
    if (entry.status === "restored") lines.push(`↩️  Restored ${entry.filePath}`);
    else if (entry.status === "would-restore") lines.push(`↩️  Would restore ${entry.filePath}`);
    else lines.push(`⏭️  Skipped ${entry.filePath}: ${entry.detail ?? entry.status}`);
  }

  const done = entries.filter((entry) => entry.status === "restored" || entry.status === "would-restore").length;
  const left = entries.length - done;
  lines.push("");
  lines.push(
    options.dryRun
      ? `Dry run: ${done} file(s) would be restored. Nothing was changed.`
      : `Restored ${done} file(s).`
  );
  if (left > 0) lines.push(`${left} file(s) were left as they are, with their backups kept.`);
  return { exitCode: left > 0 ? 1 : 0, lines };
}
