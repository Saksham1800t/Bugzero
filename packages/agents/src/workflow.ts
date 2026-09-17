import { StateGraph, START, END } from "@langchain/langgraph";
import { GraphState } from "./state";
import { OpenRouterProvider } from "@opspilot/ai-provider";
import { buildAnalysisPrompt } from "@opspilot/prompts";
import { applyPatches } from "@opspilot/patcher";
import { runValidationPipeline } from "@opspilot/analyzers";
import type { AIFixSuggestion } from "@opspilot/shared";

const provider = new OpenRouterProvider();

// ── Node: call the AI and parse its JSON response ──────────────────────────
async function analyzeNode(state: typeof GraphState.State) {
  console.log(
    `\n[BugZero] Attempt ${state.attempts + 1}/${state.maxAttempts} — asking AI…`
  );

  const prompt = buildAnalysisPrompt(state.logs, state.cwd);
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

// ── Node: apply the patch suggested by the AI ──────────────────────────────
async function applyFixNode(state: typeof GraphState.State) {
  if (!state.fixSuggestion) {
    console.warn("[BugZero] No fix suggestion available — skipping patch.");
    return {};
  }

  const { patches, explanation } = state.fixSuggestion;
  const fileList = patches.map((p) => p.filePath).join(", ");

  console.log(`[BugZero] Patching ${patches.length} file${patches.length === 1 ? "" : "s"}: ${fileList}`);
  console.log(`[BugZero] Reason:   ${explanation}`);

  const result = applyPatches(state.cwd, patches);
  if (!result.success) {
    console.error(`[BugZero] Patch failed: ${result.error}`);
    const updatedLogs = `${state.logs}\n\n⚠️ [BugZero System Warning] Your previous patch suggestion failed with the following error:\n- ${result.error}\n\nAny other files from that same suggestion were rolled back to keep the change atomic. Please check if the file path(s) are correct relative to the project root and make sure you target the correct file(s) that contain the build error.`;
    return {
      logs: updatedLogs,
    };
  }

  for (const applied of result.applied) {
    console.log(`[BugZero] Backup saved to: ${applied.backupPath}`);
    if (applied.matchStrategy !== "exact") {
      console.log(`[BugZero] Note: exact match failed for ${applied.filePath} — patch applied via ${applied.matchStrategy} matching.`);
    }
  }

  return {};
}

// ── Node: re-run the pipeline to verify the fix worked ───────────────────
async function verifyNode(state: typeof GraphState.State) {
  // If the patch failed, do not run the validation pipeline (saves time) and preserve the warning in logs
  if (state.logs.includes("[BugZero System Warning]")) {
    console.log("[BugZero] Skipping validation pipeline because the patch failed to apply.");
    return {
      success: false,
      logs: state.logs,
    };
  }

  console.log("[BugZero] Re-running validation pipeline to verify fix…");
  const result = await runValidationPipeline(state.cwd);

  if (result.success) {
    console.log("[BugZero] ✅ Validation succeeded!");
  } else {
    console.log(`[BugZero] ❌ Validation failed at step "${result.step}". New error output captured.`);
  }

  return {
    success: result.success,
    logs: result.success ? "" : result.output,
  };
}

// ── Router: loop or exit ───────────────────────────────────────────────────
function shouldRetry(state: typeof GraphState.State) {
  if (state.success) return END;
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

