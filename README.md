# BugZero

[![npm version](https://img.shields.io/npm/v/bugzero.svg?style=flat-square)](https://www.npmjs.com/package/bugzero)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-green?style=flat-square)](https://nodejs.org)
[![pnpm](https://img.shields.io/badge/maintained%20with-pnpm-cc00ff.svg?style=flat-square)](https://pnpm.io/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg?style=flat-square)](https://github.com/Saksham1800t)

**BugZero** is an autonomous, AI-powered CLI tool for automatic build error detection and repair. It runs your build pipeline, parses compiler and linter output, invokes an LLM to generate a surgical code fix, applies it safely with a backup, and re-runs validation — looping until your project builds successfully or the attempt limit is reached.

Built for developers who want zero-downtime repair cycles, automated CI/CD recovery, and production-grade error resolution without manual debugging.

---

## Why BugZero?

Modern applications fail at build and deployment time for reasons that are repetitive, predictable, and ultimately fixable by a knowledgeable agent. BugZero bridges the gap between raw compiler output and working code — automatically.

- **No more debugging the same TypeScript error twice.** The agent reads the stack trace, finds the file, generates the fix, and verifies it.
- **Safe by design.** Every file modified gets a `.opspilot.bak` backup before any change is applied.
- **Model agnostic.** Works with DeepSeek, Claude, Gemini, GPT-4o, Llama, or any model available on OpenRouter.
- **Feedback loop included.** The LangGraph state machine retries intelligently until the build passes or the max attempts threshold is hit.

---

## How it Works

```
bugzero rescue
      |
      v
 Run Build + Lint + Tests
      |
      v
 Any failures? ---- No ---> Build already passing. Exit cleanly.
      |
     Yes
      |
      v
 Capture and parse error logs
      |
      v
 Prompt selected LLM via LangGraph Agent
      |
      v
 Parse structured fix suggestion (JSON)
      |
      v
 Apply search-and-replace patch (with .bak backup)
      |
      v
 Re-run build to verify the fix
      |
      v
 Build fixed? --- Yes ---> Print fix details. Exit success.
      |
      No
      |
      v
 Max attempts reached? -- Yes ---> Exit with failure logs.
      |
      No
      |
      +-------------------> Prompt LLM again (next attempt)
```

---

## Key Features

| Feature | Description |
|---|---|
| Autonomous repair loop | Runs analyze, patch, verify in a stateful LangGraph graph |
| Multi-model support | DeepSeek, Claude, GPT-4o, Gemini, Llama via OpenRouter |
| Framework detection | Automatically identifies your project's tooling setup |
| Safe file patching | Every modified file receives a `.opspilot.bak` backup |
| Error type parsing | Parses TypeScript, ESLint, and Jest error formats |
| Dry-run mode | Analyze and report without writing any files |
| Local model config | Save preferred model to `.bugzerorc` per project |
| Markdown Reports | Automatically generates a detailed `bugzero-report.md` listing error logs, model name, token usage, and search/replace code diffs |

---

## Installation

Install globally from the NPM registry:

```bash
npm install -g bugzero
```

---

## Setup

BugZero requires an [OpenRouter](https://openrouter.ai) API key to call AI models. Set it as an environment variable before running any command.

**Linux / macOS:**
```bash
export OPENROUTER_API_KEY="your_openrouter_api_key_here"
```

**Windows (PowerShell):**
```powershell
$env:OPENROUTER_API_KEY="your_openrouter_api_key_here"
```

**Or** create a `.env` file in the project root you are targeting:
```env
OPENROUTER_API_KEY=your_openrouter_api_key_here
```

---

## Commands

### `bugzero hunt`
Run build, lint, and test checks. Reports all failures without modifying any files.

```bash
bugzero hunt --path /path/to/your/project
```

### `bugzero rescue`
Run the full AI-powered repair loop. Detects build failures, generates precise code patches, applies them, and verifies the result.

```bash
bugzero rescue --path /path/to/your/project
```

Options:

| Flag | Short | Default | Description |
|---|---|---|---|
| `--path <dir>` | `-p` | `.` | Path to the target project |
| `--max-attempts <n>` | `-n` | `3` | Maximum AI fix iterations before giving up |
| `--dry-run` | | `false` | Analyze only — no files will be written |

### `bugzero vibe`
Interactively select which AI model to use. Fetches the current model list from OpenRouter, lets you pick one, and saves the selection to a local `.bugzerorc` config file.

```bash
bugzero vibe
```

Supported models (curated list, plus custom entry):
- DeepSeek V3 / DeepSeek R1
- Anthropic Claude 3.5 Sonnet
- Google Gemini 2.5 Pro / Flash
- OpenAI GPT-4o
- Meta Llama 3.3 Instruct

---

## Configuration

BugZero reads a `.bugzerorc` JSON file in your target project directory to pick up model preferences:

```json
{
  "model": "deepseek/deepseek-chat"
}
```

This file is created automatically when you run `bugzero vibe`.

---

## Reports

Every time you run `bugzero hunt` or `bugzero rescue`, a detailed Markdown report is automatically generated at `bugzero-report.md` in the target project directory. This report includes:
- **Pipeline Summary:** Clear status checklist of your project's Build, Lint, and Test suites.
- **Detailed Error Outputs:** Full error logs from any failing checks.
- **AI Brain Details:** The exact OpenRouter model used.
- **Token Usage:** Accumulated prompt and completion tokens used for the run.
- **Applied Fixes (for rescue):** The root cause, explanation, and before/after search-replace code diffs of any patches applied.

---

## Development Setup

Clone the repository and install dependencies. This project uses a pnpm monorepo managed by Turborepo.

### Prerequisites
- Node.js 18 or later
- pnpm

### Install

```bash
pnpm install
```

### Build all packages

```bash
pnpm build
```

### Run commands locally without installing globally

```bash
pnpm hunt --path ./demo-project
pnpm rescue --path ./demo-project
pnpm vibe
```

### Monorepo package structure

| Package | Role |
|---|---|
| `packages/cli` | CLI entrypoint (Commander) |
| `packages/core` | Orchestrates build and fix flow |
| `packages/agents` | LangGraph state machine (analyze, patch, verify) |
| `packages/ai-provider` | OpenRouter HTTP client |
| `packages/analyzers` | Runs build/lint/test and parses output |
| `packages/patcher` | Applies search-and-replace patches with backup |
| `packages/prompts` | LLM prompt templates |
| `packages/config` | Env loading and local `.bugzerorc` config store |
| `packages/shared` | Shared TypeScript types |

---

## Error Handling

BugZero provides clear, actionable output for common failure modes:

| Error | Message |
|---|---|
| Invalid API key (401) | Prompts you to check your `OPENROUTER_API_KEY` |
| Rate limit exceeded (429) | Prompts you to check your OpenRouter credit balance |
| Model not found | Displays the invalid model ID and suggests running `bugzero vibe` |
| Patch not applied | Reports exact mismatch between AI suggestion and file content |
| Max attempts reached | Exits cleanly with the last error log for manual review |

---

## Author

**Saksham Agarwal**

- GitHub: [@Saksham1800t](https://github.com/Saksham1800t)
- LinkedIn: [Saksham Agarwal](https://www.linkedin.com/in/saksham-agarwal-/)
- Email: [sakshamagarwal0507@gmail.com](mailto:sakshamagarwal0507@gmail.com)

---

## Support

If BugZero saved you debugging hours in production or deployment pipelines, consider buying the author a coffee.

[![Buy Me A Coffee](https://www.buymeacoffee.com/assets/img/custom_images/orange_img.png)](https://www.buymeacoffee.com/saksham_)

