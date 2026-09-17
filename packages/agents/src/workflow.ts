import { StateGraph, START, END } from "@langchain/langgraph";
import path from "path";
import { GraphState } from "./state";
import { OpenRouterProvider } from "@opspilot/ai-provider";
import { buildAnalysisPrompt } from "@opspilot/prompts";
import { applyPatch } from "@opspilot/patcher";
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
      fixSuggestion = JSON.parse(jsonMatch[0]) as AIFixSuggestion;
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

  const { filePath, search, replace, explanation } = state.fixSuggestion;
  const absolutePath = path.resolve(state.cwd, filePath);

  console.log(`[BugZero] Patching: ${filePath}`);
  console.log(`[BugZero] Reason:   ${explanation}`);

  const result = applyPatch(absolutePath, search, replace);
  if (!result.success) {
    console.error(`[BugZero] Patch failed: ${result.error}`);
    const updatedLogs = `${state.logs}\n\n⚠️ [BugZero System Warning] Your previous patch suggestion for "${filePath}" failed with the following error:\n- ${result.error}\n\nPlease check if the file path is correct relative to the project root and make sure you target the correct file that contains the build error.`;
    return {
      logs: updatedLogs,
    };
  } else {
    console.log(`[BugZero] Backup saved to: ${result.backupPath}`);
    if (result.matchStrategy && result.matchStrategy !== "exact") {
      console.log(`[BugZero] Note: exact match failed — patch applied via ${result.matchStrategy} matching.`);
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

