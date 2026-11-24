import { StateGraph, START, END } from "@langchain/langgraph";
import { GraphState } from "./state";
import { OpenRouterProvider } from "@opspilot/ai-provider";
import { buildAnalysisPrompt } from "@opspilot/prompts";
import { getProtectionSettings } from "@opspilot/config";
import { applyPatches, previewPatches, renderUnifiedDiff } from "@opspilot/patcher";
import { runValidationPipeline } from "@opspilot/analyzers";
import { describeSnapshot, recordAttempt, snapshotOf, startTracking, type PipelineStep } from "./progress";
import { createProtectedPathRules, type AIFixSuggestion, type ApprovalHandler } from "@opspilot/shared";

const provider = new OpenRouterProvider();

/** Which files must not be edited, or shown to the model, in this project (built-in list plus .bugzerorc). */
function protectionFor(cwd: string) {
  return createProtectedPathRules(getProtectionSettings(cwd));
}

/**
 * The exact prompt the first attempt sends to the AI model for these error logs. The repair loop builds its
 * prompt with this same function, so what you preview is what is sent. Calls no model and changes nothing.
 */
export function previewAnalysisPrompt(cwd: string, logs: string): string {
  return buildAnalysisPrompt(logs, cwd, { rules: protectionFor(cwd) });
}

// ── Node: call the AI and parse its JSON response ──────────────────────────
async function analyzeNode(state: typeof GraphState.State) {
  console.log(
    `\n[BugZero] Attempt ${state.attempts + 1}/${state.maxAttempts} — asking AI…`
  );

  const prompt = previewAnalysisPrompt(state.cwd, state.logs);
  const result = await provider.invoke(prompt, { cwd: state.cwd });
  const response = result.content;

  let fixSuggestion: AIFixSuggestion | null = null;
  try {
    const cleaned = response
      .replace(/```json\n?/g, "")
      .replace(/```\n?/g, "")
      .trim();
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]) as AIFixSuggestion;
      if (Array.isArray(parsed.patches) && parsed.patches.length > 0) {
        fixSuggestion = parsed;
      } else {
        console.warn("[BugZero] AI response JSON did not contain a non-empty \"patches\" array.");
      }
    } else {
      console.warn("[BugZero] AI response did not contain a valid JSON object.");
    }
  } catch (e) {
    console.error("[BugZero] Failed to parse AI response:", e);
  }

  return {
    analysis: response,
    fixSuggestion,
    attempts: state.attempts + 1,
    modelUsed: result.model,
    promptTokens: result.usage?.prompt_tokens ?? 0,
    completionTokens: result.usage?.completion_tokens ?? 0,
  };
}

/** The state update for a fix that could not be applied: tell the model why, and skip verifying this attempt. */
function patchFailure(state: typeof GraphState.State, error: string | undefined) {
  console.error(`[BugZero] Patch failed: ${error}`);
  const updatedLogs = `${state.logs}\n\n⚠️ [BugZero System Warning] Your previous patch suggestion failed with the following error:\n- ${error}\n\nAny other files from that same suggestion were rolled back to keep the change atomic. Please check if the file path(s) are correct relative to the project root and make sure you target the correct file(s) that contain the build error.`;
  return {
    logs: updatedLogs,
    patchFailed: true,
  };
}

// ── Node: apply the patch suggested by the AI ──────────────────────────────
async function applyFixNode(state: typeof GraphState.State) {
  if (!state.fixSuggestion) {
    console.warn("[BugZero] No fix suggestion available — skipping patch.");
    return { patchFailed: false };
  }

  const { patches, explanation } = state.fixSuggestion;
  const fileList = patches.map((p) => p.filePath).join(", ");

  console.log(`[BugZero] Patching ${patches.length} file${patches.length === 1 ? "" : "s"}: ${fileList}`);
  console.log(`[BugZero] Reason:   ${explanation}`);

  if (state.approve) {
    // Work out exactly what would be written, without writing it, and let the person decide.
    const preview = previewPatches(state.cwd, patches, { protection: protectionFor(state.cwd) });
    if (!preview.success) return patchFailure(state, preview.error);

    const files = preview.changes.map((change) => change.filePath);
    const decision = await state.approve({
      attempt: state.attempts,
      maxAttempts: state.maxAttempts,
      rootCause: state.fixSuggestion.rootCause,
      explanation,
      files,
      diff: renderUnifiedDiff(preview.changes),
    });
    if (!decision.approved) {
      console.log("[BugZero] Fix declined — nothing was changed.");
      const note = decision.note?.trim();
      const userNote = note ? ` The user's note: "${note}".` : "";
      const declinedLogs = `${state.logs}\n\n⚠️ [BugZero System Warning] Your previous patch suggestion was declined by the user, so nothing was changed. The files it would have changed were: ${files.join(", ")}.${userNote} Propose a different fix.`;
      return { logs: declinedLogs, patchFailed: true, declinedFixes: 1 };
    }
  }

  const result = applyPatches(state.cwd, patches, {
    alreadyBackedUp: state.backedUpFiles,
    protection: protectionFor(state.cwd),
  });
  if (!result.success) return patchFailure(state, result.error);

  for (const applied of result.applied) {
    console.log(`[BugZero] Backup saved to: ${applied.backupPath}`);
    if (applied.matchStrategy !== "exact") {
      console.log(`[BugZero] Note: exact match failed for ${applied.filePath} — patch applied via ${applied.matchStrategy} matching.`);
    }
  }

  // Record the patches that really reached disk; a failed (rolled-back) attempt returned above and adds nothing.
  return {
    appliedFix: state.fixSuggestion,
    backedUpFiles: result.applied.map((applied) => applied.absolutePath),
    patchFailed: false,
  };
}

// ── Node: re-run the pipeline to verify the fix worked ───────────────────
async function verifyNode(state: typeof GraphState.State) {
  // If this attempt's patch failed, do not run the validation pipeline (saves time) and preserve the warning in logs
  if (state.patchFailed) {
    console.log("[BugZero] Skipping validation pipeline because the patch failed to apply.");
    return {
      success: false,
      logs: state.logs,
    };
  }

  console.log("[BugZero] Re-running validation pipeline to verify fix…");
  const result = await runValidationPipeline(state.cwd, { timeoutMs: state.timeoutMs });

  if (result.success) {
    console.log("[BugZero] ✅ Validation succeeded!");
  } else {
    console.log(`[BugZero] ❌ Validation failed at step "${result.step}". New error output captured.`);
  }

  if (result.success) return { success: true, logs: "" };

  // Did this attempt get anywhere? Compare with the best result so far, and stop early after `patience`
  // attempts in a row that did not (but never before the last attempt, which ends the run anyway).
  const progress = recordAttempt(state.progress, snapshotOf(result.step, result.output));
  const stuck = state.patience > 0 && progress.stagnantAttempts >= state.patience && state.attempts < state.maxAttempts;
  if (stuck) {
    console.log(
      `[BugZero] No progress in ${progress.stagnantAttempts} attempt(s) in a row (best so far: ${describeSnapshot(progress.best)}; now: ${describeSnapshot(progress.last)}) — stopping early instead of using the remaining attempt(s).`
    );
  }
  return { success: false, logs: result.output, progress, stoppedForNoProgress: stuck };
}

// ── Router: loop or exit ───────────────────────────────────────────────────
function shouldRetry(state: typeof GraphState.State) {
  if (state.success) return END;
  if (state.stoppedForNoProgress) return END;
  if (state.attempts >= state.maxAttempts) {
    console.log(
      `[BugZero] Max attempts (${state.maxAttempts}) reached — giving up.`
    );
    return END;
  }
  return "analyze" as const;
}

// ── Graph assembly — chain calls so TS generics track node names ───────────
export const workflow = new StateGraph(GraphState)
  .addNode("analyze", analyzeNode)
  .addNode("apply_fix", applyFixNode)
  .addNode("verify", verifyNode)
  .addEdge(START, "analyze")
  .addEdge("analyze", "apply_fix")
  .addEdge("apply_fix", "verify")
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  .addConditionalEdges("verify", shouldRetry as any)
  .compile();

export interface RepairInput {
  cwd: string;
  logs: string;
  maxAttempts: number;
  /** Per-command timeout in milliseconds for each validation step (default: no limit) */
  timeoutMs?: number;
  /** When given, each proposed fix is shown to it first and is only written if it approves */
  approve?: ApprovalHandler;
  /**
   * Stop early after this many attempts in a row that make no progress: not fewer errors, and not a later step
   * (build, then lint, then tests) failing. 0 or not given means never stop early.
   */
  patience?: number;
  /** Which step the starting failure came from; lets the very first attempt be compared with it */
  initialStep?: PipelineStep;
}

/**
 * Runs the repair graph. Each attempt takes three graph steps (analyze →
 * apply_fix → verify), so LangGraph's default recursion limit of 25 would
 * abort any run asking for more than ~8 attempts; scale it to the request.
 */
export function runRepairWorkflow(input: RepairInput) {
  const { initialStep, ...rest } = input;
  return workflow.invoke(
    {
      ...rest,
      attempts: 0,
      success: false,
      progress: initialStep ? startTracking(snapshotOf(initialStep, input.logs)) : null,
    },
    { recursionLimit: input.maxAttempts * 3 + 5 }
  );
}

