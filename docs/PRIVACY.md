# What BugZero sends, and where

BugZero runs your build, lint and tests on your own machine. It only contacts a service when it asks an AI
model for help, and that is the one place your code can leave your computer. This page lists exactly what is
sent, what never is, and how to check or avoid it. It was written against BugZero 0.0.55; if you read it in a
newer version, the code is the final word.

## The short version

- BugZero sends your **error logs** and the **contents of source files those logs mention** to an AI model
  through [OpenRouter](https://openrouter.ai), using your own API key.
- It never sends files outside your project, secret files (`.env`, `*.pem`, `*.key`), `node_modules`, build
  output or `.git`.
- Nothing is sent when your project already passes.
- You can see the exact text first with `bugzero rescue --print-prompt`, and keep `hunt` fully offline with
  `bugzero hunt --no-ai-report`.
- There is no telemetry, analytics or update check.

## When something is sent

| Command | What is sent | When |
|---|---|---|
| `bugzero hunt` | The output of the failed checks (build, lint, test), shortened to about 20,000 characters in total | Only if a check fails. Turn it off with `--no-ai-report` |
| `bugzero rescue` | The repair prompt described below, once per attempt, then one more call to write the report | Only if the project fails. Nothing is sent when it already passes |
| `bugzero rescue --dry-run` | The failing logs (about 20,000 characters) to write the report | Only if the project fails |
| `bugzero rescue --print-prompt` | **Nothing.** It prints the first repair prompt and stops | Never sends |
| `bugzero vibe` | A request for the public list of models. It carries none of your project data | When you run it |

## What is in a `rescue` repair prompt

Each attempt sends one prompt containing:

1. **The error output** of the failing command, shortened to about 20,000 characters (the start and the end are
   kept, the middle is dropped). Whatever your build prints is in it, so anything it prints is sent.
2. **The absolute path of your project folder** (for example `C:\Users\you\work\app`).
3. **The contents of files the error output mentions**, when they are inside your project. Each file is
   shortened to about 20,000 characters, and the files together to about 60,000 characters.
4. **The names of the files in the folder** of each mentioned file, and, when a mentioned folder holds 15 files
   or fewer, the contents of its `.js`, `.jsx`, `.ts`, `.tsx`, `.json` and `.css` files.
5. **Notes from earlier failed attempts** in the same run, such as "that patch did not apply".

After the run, one more call writes `bugzero-report.md`. It contains the root cause, the explanation, the
search and replace text of the patches (when the fix worked), or the unresolved error output, shortened to about
20,000 characters (when it did not).

## What is never sent

- Files **outside your project folder**, even if an error log names them. Links (symlinks and junctions) that
  point out of the project are not followed.
- **Secret files**: `.env`, `.env.*`, `*.pem` and `*.key`, wherever they are in the project. You can lift this
  for a file such as `.env.example` with `allow` in `.bugzerorc`.
- `node_modules`, `build`, `dist` and `.git`.
- Your **API key**, except as the login header on the request to OpenRouter itself.
- Anything at all when the project already passes.

## See it before it is sent

```bash
bugzero rescue --print-prompt
```

This runs your build, lint and tests locally to get the error output, then prints the exact first prompt on
standard output and exits. It sends nothing, edits nothing and writes no report. Progress messages go to
standard error, so you can save the prompt with `bugzero rescue --print-prompt > prompt.txt`, or read it from
`--json` output in the `prompt` field.

It shows the first repair prompt, which is the one that carries your code. Later attempts add the notes from
failed attempts, and the report call at the end is a separate, smaller prompt.

## Keep it local

- `bugzero hunt --no-ai-report` makes no network call. The report still lists each check and its raw output.
- Add file patterns to `protect` in `.bugzerorc` to stop BugZero from editing them, and keep secrets out of your
  logs and out of any file an error would mention.
- `rescue` cannot fix anything without a model, so it has no offline mode yet. Use `--print-prompt` to review
  what it would send, or `hunt --no-ai-report` to stay offline.

## Limits you should know about

- **BugZero cannot recognise a secret by its content.** A password printed by your build, or a token written
  inside a source file that an error mentions, is sent like any other text. Only the secret *file names* above
  are held back. Review the output of `--print-prompt` if that matters to you.
- **OpenRouter and the model's provider receive the prompt.** Which provider handles it, and how long it keeps
  it, depends on the model you choose with `bugzero vibe` and on your OpenRouter account settings. Read their
  policies; BugZero does not control them.
- **The GitHub Action** sends the same prompts. It also uses the workflow's `GITHUB_TOKEN` to commit the changed
  files and open a pull request in your repository.

## Other network traffic

- `bugzero vibe` asks OpenRouter for its public model list.
- Installing or updating the package goes through npm, as for any package.
- BugZero does not check for updates, collect analytics, or report errors anywhere.
