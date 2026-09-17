import axios from "axios";
import fs from "fs";
import path from "path";
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
      if (error.response?.status === 401) {
        console.error(`👉 Please check if your OPENROUTER_API_KEY is correct and active.`);
      } else if (error.response?.status === 429 || error.response?.status === 402 || /credit/i.test(msg) || /token/i.test(msg)) {
        console.error(`\n👉 You have insufficient OpenRouter credits (or too low balance) for the selected model.`);
        console.error(`👉 We suggest using the 'bugzero vibe' command to change to a FREE model:`);
        console.error(`   1. Run the command: npx bugzero@latest vibe (or bugzero vibe)`);
        console.error(`   2. Select "Custom Model" and enter one of these free model IDs:`);
        console.error(`      - google/gemma-2-9b-it:free`);
        console.error(`      - meta-llama/llama-3-8b-instruct:free`);
        console.error(`      - mistralai/mistral-7b-instruct:free`);
        console.error(`      - microsoft/phi-3-medium-128k-instruct:free`);
        console.error(`      - nvidia/llama-3.1-nemotron-70b-instruct:free\n`);
      }

      throw new Error(`OpenRouter API failed: ${msg}`);
    }
  }
}