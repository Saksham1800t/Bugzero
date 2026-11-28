export interface InvokeResult {
  content: string;
  model: string;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  /** True when the reply stopped because it reached its length limit */
  truncated?: boolean;
}

export interface InvokeOptions {
  /** The project whose `.bugzerorc` picks the model */
  cwd?: string;
  /** The longest reply to ask for, in tokens (default: whatever the model allows) */
  maxTokens?: number;
}

export interface AIProvider {
  invoke(prompt: string, options?: InvokeOptions): Promise<InvokeResult>;
}