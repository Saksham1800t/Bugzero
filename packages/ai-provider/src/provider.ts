export interface InvokeResult {
  content: string;
  model: string;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface AIProvider {
  invoke(prompt: string, options?: { cwd?: string }): Promise<InvokeResult>;
}