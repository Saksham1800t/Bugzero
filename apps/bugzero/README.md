<div align="center">

# 🐛 BugZero

### Your build breaks. BugZero fixes it. Automatically.

[![npm version](https://img.shields.io/npm/v/bugzero.svg?style=flat-square)](https://www.npmjs.com/package/bugzero)
[![npm downloads](https://img.shields.io/npm/dm/bugzero.svg?style=flat-square)](https://www.npmjs.com/package/bugzero)
[![CI](https://img.shields.io/github/actions/workflow/status/Saksham1800t/Bugzero/ci.yml?branch=main&label=CI&style=flat-square)](https://github.com/Saksham1800t/Bugzero/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-22.12%2B-green?style=flat-square)](https://nodejs.org)
[![pnpm](https://img.shields.io/badge/maintained%20with-pnpm-cc00ff.svg?style=flat-square)](https://pnpm.io/)

**BugZero** is an autonomous, AI-powered CLI that detects and repairs build, lint, and test failures — locally or as a GitHub Action that opens the fix as a pull request.

<img src="https://raw.githubusercontent.com/Saksham1800t/Bugzero/main/apps/bugzero/demo.svg" alt="Animated terminal demo of bugzero rescue detecting and fixing a TypeScript build error" width="700" />

<sub>Illustrative animation of a <code>bugzero rescue</code> run using the tool's real log output format.</sub>

</div>

---

## Quick Start

```bash
npm install -g bugzero
export OPENROUTER_API_KEY="your_openrouter_api_key_here"
bugzero rescue --path /path/to/your/project
```

That's it — BugZero runs your build, diagnoses the failure, generates a patch, applies it, and re-verifies, looping until it's green or it runs out of attempts.

---

## Why BugZero?

Modern applications fail at build and deployment time for reasons that are repetitive, predictable, and ultimately fixable by a knowledgeable agent. BugZero bridges the gap between raw compiler output and working code — automatically.

- **No more debugging the same TypeScript error twice.** The agent reads the error, finds the file, generates the fix, and verifies it.
- **Safe by design.** Every modified file gets a `.opspilot.bak` backup, and a multi-file fix is applied and rolled back as one atomic unit.
- **Forgiving, not brittle.** If the AI's suggested patch doesn't match the file byte-for-byte, BugZero falls back to whitespace-normalized and similarity-scored matching before giving up.
- **Model agnostic.** DeepSeek, Claude, Gemini, GPT-4o, Llama, or any model on OpenRouter.
- **CI-native.** Run it as a GitHub Action instead of a local CLI, and let it open the fix as a PR.

---

## How It Works

```
bugzero rescue
      │
      ▼
 Run Build + Lint + Tests
      │
      ▼
 Any failures? ── No ──▶ Build already passing. Exit cleanly.
      │
     Yes
      │
      ▼
 Capture and parse error logs
      │
      ▼
 Prompt selected LLM via LangGraph Agent
      │
      ▼
 Parse structured fix suggestion (one or more file patches)
      │
      ▼
 Apply patches atomically (exact → whitespace → similarity match, with .bak backups)
      │
      ▼
 Re-run build to verify the fix
      │
      ▼
 Build fixed? ── Yes ──▶ Print fix details. Exit success.
      │
      No
      │
      ▼
 Max attempts reached? ── Yes ──▶ Exit with failure logs.
      │
      No
      │
      └──────────────────▶ Prompt LLM again (next attempt)
```

---

## Features

### Repair engine

- **Autonomous repair loop.** `bugzero rescue` runs your build, lint, and tests. When something fails, it sends the error output — along with the relevant source files and directory listings as context — to an LLM, applies the fix the model proposes, and re-runs validation. It repeats, feeding any patch failures back to the model, until everything passes or the attempt limit is reached (3 by default; change it with `--max-attempts`). The loop is a stateful LangGraph graph: analyze, patch, verify.
- **Multi-file patches.** One fix can edit several files at once — for example, a renamed export plus every file that imports it. All patches in an attempt are applied as a single atomic unit: if any one of them fails to apply, every file touched in that attempt is restored to its original content, so you never end up with a half-applied fix.
- **Fuzzy patch matching.** LLMs rarely reproduce code byte-for-byte, so BugZero locates each patch in three tiers: an exact match first, then a whitespace-normalized line match (tolerates indentation and spacing drift), then a similarity-scored match (average per-line similarity of at least 85%). If two locations look equally plausible, it refuses to guess and reports a failed patch instead of risking an edit in the wrong place.
- **Multi-model support.** Works with any model available on OpenRouter — DeepSeek, Claude, Gemini, GPT-4o, Llama, and more. Choose one interactively with `bugzero vibe`; the choice is saved per project in `.bugzerorc`.

### Safety

- **Backups on every patch.** Each file BugZero modifies gets a `.opspilot.bak` copy of its original content first.
- **Dry-run mode.** `bugzero rescue --dry-run` runs validation and error analysis, but makes no fix attempts and never modifies your source files (a report is still written).

### Project awareness

- **Framework detection.** Identifies Next.js, NestJS, Vite, Remix, Astro, SvelteKit, Nuxt, Angular, Create React App, or a plain TypeScript project from its config files and dependencies, and shows the result in the run banner.
- **Package manager detection.** Runs build, lint, and test with the tool your project actually uses — npm, pnpm, yarn, or bun. It checks the `packageManager` field in `package.json` first, then `pnpm-workspace.yaml` or a lockfile, and falls back to npm.
- **Error parsing.** Recognizes TypeScript compiler errors (file, line, column, message), ESLint errors, and Jest failures to classify what broke and how many errors were found. Output in any other format is still passed to the model as raw logs.

### Integrations and output

- **Markdown reports.** Every `hunt` and `rescue` run writes `bugzero-report.md` to the target project: a pass/fail summary of build, lint, and tests, the full error logs, the model used, token usage, and before/after diffs for every file patched. The terminal prints a clickable link straight to it.
- **GitHub Action mode.** Run the same repair loop in CI. Instead of patching a local checkout, the Action commits every changed file in one atomic commit through the GitHub API and opens a pull request — see [GitHub Action Mode](#github-action-mode) below.

---

## GitHub Action Mode

Instead of running BugZero on your machine, run it in CI: when a check fails, it opens a pull request with the fix instead of patching your local checkout.

```yaml
name: BugZero Auto-Fix

on:
  workflow_run:
    workflows: ["CI"]
    types: [completed]

jobs:
  fix:
    if: github.event.workflow_run.conclusion == 'failure'
    runs-on: ubuntu-latest
    permissions:
      contents: write
      pull-requests: write
    steps:
      - uses: actions/checkout@v4
        with:
          ref: ${{ github.event.workflow_run.head_branch }}

      - uses: pnpm/action-setup@v4 # or npm/yarn — whatever installs your project's deps
      - run: pnpm install

      - uses: Saksham1800t/Bugzero@v1
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          base-branch: ${{ github.event.workflow_run.head_branch }}
        env:
          OPENROUTER_API_KEY: ${{ secrets.OPENROUTER_API_KEY }}
```

It commits every changed file as a single atomic commit via the GitHub API — no local git push needed — then opens the PR. Full input/output reference: [`apps/github-action`](https://github.com/Saksham1800t/Bugzero/tree/main/apps/github-action).

---

## Installation

Install globally from the npm registry:

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

<details>
<summary><strong>Options for <code>rescue</code></strong></summary>

| Flag | Short | Default | Description |
|---|---|---|---|
| `--path <dir>` | `-p` | `.` | Path to the target project |
| `--max-attempts <n>` | `-n` | `3` | Maximum AI fix iterations before giving up |
| `--dry-run` | | `false` | Analyze only — no files will be written |

</details>

### `bugzero vibe`
Interactively select which AI model to use. Fetches the current model list from OpenRouter, lets you pick one, and saves the selection to a local `.bugzerorc` config file.

```bash
bugzero vibe
```

<details>
<summary><strong>Supported models</strong> (curated list, plus custom entry)</summary>

- DeepSeek V3 / DeepSeek R1
- Anthropic Claude 3.5 Sonnet
- Google Gemini 2.5 Pro / Flash
- OpenAI GPT-4o
- Meta Llama 3.3 Instruct

</details>

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

Every time you run `bugzero hunt` or `bugzero rescue`, a detailed Markdown report is generated at `bugzero-report.md` in the target project directory. The tool prints a clickable absolute file URL and path directly to your terminal.

- **Pipeline Summary:** Clear status checklist of your project's Build, Lint, and Test suites.
- **Detailed Error Outputs:** Full error logs from any failing checks.
- **AI Brain Details:** The exact OpenRouter model used.
- **Token Usage:** Accumulated prompt and completion tokens used for the run.
- **Applied Fixes (for rescue):** The root cause, explanation, and before/after diffs for every file patched.

---

## Error Handling

BugZero provides clear, actionable output for common failure modes:

| Error | Message |
|---|---|
| Invalid API key (401) | Prompts you to check your `OPENROUTER_API_KEY` |
| Rate limit exceeded (429) | Prompts you to check your OpenRouter credit balance |
| Model not found | Displays the invalid model ID and suggests running `bugzero vibe` |
| Patch not applied | Reports exact mismatch between AI suggestion and file content, after exhausting exact, whitespace, and fuzzy matching |
| Max attempts reached | Exits cleanly with the last error log for manual review |

---

<details>
<summary><strong>Development Setup</strong> (contributing to BugZero itself)</summary>

Clone the repository and install dependencies. This project uses a pnpm monorepo managed by Turborepo, with a Vitest test suite and GitHub Actions CI.

### Prerequisites
- Node.js 22.12 or later
- pnpm

### Install & build

```bash
pnpm install
pnpm build
pnpm test
```

### Run commands locally without installing globally

```bash
pnpm hunt --path ./demo-project
pnpm rescue --path ./demo-project
pnpm vibe
```

### Monorepo structure

| Package | Role |
|---|---|
| `apps/bugzero` | CLI entrypoint (Commander) — the package published to npm |
| `apps/github-action` | GitHub Action wrapper — runs the repair loop in CI and opens a fix PR |
| `packages/core` | Orchestrates build and fix flow |
| `packages/agents` | LangGraph state machine (analyze, patch, verify) |
| `packages/ai-provider` | OpenRouter HTTP client |
| `packages/analyzers` | Runs build/lint/test and parses output |
| `packages/patcher` | Applies search-and-replace patches — with atomic multi-file support and fuzzy-match fallback |
| `packages/prompts` | LLM prompt templates |
| `packages/config` | Env loading and local `.bugzerorc` config store |
| `packages/shared` | Shared TypeScript types |

</details>

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
