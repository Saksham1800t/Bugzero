import axios from "axios";
import fs from "fs";
import path from "path";
import { getErrorHints } from "./error-hints";
import { AIProvider, InvokeResult } from "./provider";

/** Read the selected model from .bugzerorc in the target project directory */
function resolveModel(cwd?: string): string {
  try {
    const configPath = path.resolve(cwd ?? process.cwd(), ".bugzerorc");
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      if (config.model) return config.model;
    }
  } catch {
    // fall through to default
  }
  return "deepseek/deepseek-chat";
}

export class OpenRouterProvider implements AIProvider {
  async invoke(prompt: string, options?: { cwd?: string }): Promise<InvokeResult> {
    const model = resolveModel(options?.cwd);

    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      console.error(`\n❌ [BugZero] Error: OPENROUTER_API_KEY environment variable is not set.`);
      console.error(`👉 Please configure it using one of the following methods:`);
      console.error(`   - On macOS/Linux: export OPENROUTER_API_KEY="your_openrouter_api_key_here"`);
      console.error(`   - On Windows (PowerShell): $env:OPENROUTER_API_KEY="your_openrouter_api_key_here"`);
      console.error(`   - Or add it to a .env file at the root of the project you are fixing:`);
      console.error(`     OPENROUTER_API_KEY=your_openrouter_api_key_here\n`);
      throw new Error("Missing OPENROUTER_API_KEY environment variable.");
    }

    try {
      const response = await axios.post(
        "https://openrouter.ai/api/v1/chat/completions",
        {
          model: model,
          messages: [
            {
              role: "user",
              content: prompt,
            },
          ],
        },
        {
          headers: {
            Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
            "Content-Type": "application/json",
          },
        }
      );

      if (response.data?.error) {
        throw new Error(response.data.error.message || JSON.stringify(response.data.error));
      }

      return {
        content: response.data.choices[0].message.content,
        model: model,
        usage: response.data.usage,
      };
    } catch (error: any) {
      let msg = error.message;
      if (error.response?.data?.error?.message) {
        msg = error.response.data.error.message;
      } else if (error.response?.data?.message) {
        msg = error.response.data.message;
      }

      console.error(`\n❌ [BugZero] OpenRouter API Error: ${msg}`);
      const hints = getErrorHints({ status: error.response?.status, message: msg, model });
      for (const line of hints) console.error(line);
      if (hints.length > 0) console.error();

      throw new Error(`OpenRouter API failed: ${msg}`);
    }
  }
}