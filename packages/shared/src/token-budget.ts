/** Roughly how many characters make one token. Only used where the real count is not (yet) known. */
const CHARS_PER_TOKEN = 4;

/** A reply shorter than this is unlikely to hold a fix or a report, so no request is made for one. */
export const MIN_REPLY_TOKENS = 500;

/** The longest reply asked for under a budget; many models reject a larger limit. */
export const MAX_REPLY_TOKENS = 8192;

/** An estimate of how many tokens a text is. The real number depends on the model. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export type BudgetCheck =
  | { allowed: true; maxReplyTokens: number | undefined }
  | { allowed: false; reason: string };

/**
 * Decides, before a request is sent, whether a token budget leaves room for it. `used` is what the run has spent
 * so far. The prompt's size can only be estimated here, so the reply is capped to what is left after it, which
 * keeps a run close to its budget. With no `limit` every request is allowed and no cap is set.
 */
export function checkBudget(limit: number | undefined, used: number, prompt: string): BudgetCheck {
  if (limit === undefined) return { allowed: true, maxReplyTokens: undefined };

  const promptTokens = estimateTokens(prompt);
  const left = limit - used - promptTokens;
  if (left < MIN_REPLY_TOKENS) {
    return {
      allowed: false,
      reason: `The token budget of ${limit} does not leave enough for the next AI request (${used} already used, the prompt is about ${promptTokens} tokens, and a reply needs at least ${MIN_REPLY_TOKENS}).`,
    };
  }
  return { allowed: true, maxReplyTokens: Math.min(left, MAX_REPLY_TOKENS) };
}

export interface CallTokens {
  promptTokens: number;
  completionTokens: number;
  /** True when at least one of the numbers is an estimate because the model did not report it */
  estimated: boolean;
}

function reported(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/**
 * What one AI request cost. With a budget set, a number the model did not report is estimated from the text,
 * because otherwise the budget could not be enforced. Without a budget, unreported tokens count as zero.
 */
export function countCallTokens(
  limit: number | undefined,
  prompt: string,
  reply: { content: string; usage?: { prompt_tokens?: number; completion_tokens?: number } }
): CallTokens {
  const promptTokens = reply.usage?.prompt_tokens;
  const completionTokens = reply.usage?.completion_tokens;

  if (limit === undefined) {
    return { promptTokens: promptTokens ?? 0, completionTokens: completionTokens ?? 0, estimated: false };
  }
  return {
    promptTokens: reported(promptTokens) ? promptTokens : estimateTokens(prompt),
    completionTokens: reported(completionTokens) ? completionTokens : estimateTokens(reply.content),
    estimated: !reported(promptTokens) || !reported(completionTokens),
  };
}
