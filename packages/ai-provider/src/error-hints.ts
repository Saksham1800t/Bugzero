export interface OpenRouterErrorContext {
  /** HTTP status of the failed request, when there was a response */
  status?: number;
  /** The most specific error message available */
  message: string;
  /** The model the request was made with */
  model: string;
}

const CREDITS_PATTERN =
  /insufficient credits|credit balance|add more credits|requires more credits|token_limit_exceeded/i;
const CONTEXT_PATTERN =
  /context length|context window|maximum context|context_length_exceeded|string_too_long|too many tokens|reduce the length/i;
const MODEL_PATTERN = /not a valid model|no endpoints found|model.{0,40}(not found|does not exist|unavailable)/i;

/**
 * Turns an OpenRouter failure into actionable follow-up lines.
 *
 * Each case is matched on its HTTP status and on specific phrases — never on a
 * bare word like "token", which also appears in context-length and parsing
 * errors and used to be misdiagnosed as "insufficient credits".
 */
export function getErrorHints({ status, message, model }: OpenRouterErrorContext): string[] {
  if (status === 401) {
    return ["👉 Please check if your OPENROUTER_API_KEY is correct and active."];
  }

  if (status === 402 || CREDITS_PATTERN.test(message)) {
    return [
      "👉 Your OpenRouter credit balance is too low for this request.",
      "   Add credits at https://openrouter.ai/settings/credits, or run 'bugzero vibe' to switch to a cheaper model",
      "   (models that cost nothing are listed at https://openrouter.ai/models?max_price=0).",
    ];
  }

  if (status === 429) {
    return [
      "👉 OpenRouter is rate limiting these requests. Wait a moment and try again.",
      "   Free models have stricter limits; run 'bugzero vibe' to switch models, or add credits to raise them.",
    ];
  }

  if (CONTEXT_PATTERN.test(message)) {
    return [
      `👉 The prompt was too large for the context window of "${model}".`,
      "   Run 'bugzero vibe' to pick a model with a larger context window, or try again on a smaller failing scope.",
    ];
  }

  if (status === 404 || MODEL_PATTERN.test(message)) {
    return [
      `👉 The model "${model}" isn't available on OpenRouter (it wasn't found, or no provider currently serves it).`,
      "   Run 'bugzero vibe' to choose a different model.",
    ];
  }

  return [];
}
