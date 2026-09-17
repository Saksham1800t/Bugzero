# BugZero AI Build Fixer (GitHub Action)

Runs BugZero's AI-powered repair loop against your repository and opens a pull request with the fix when your build, lint, or tests are failing — no local checkout patching, no manual triage.

Unlike the `bugzero` CLI (which patches files in your working copy), this Action never touches your checkout. It runs the same repair loop, then commits the result directly through the GitHub REST API — one atomic commit covering every file the fix touched — and opens a PR from a new branch.

## Usage

Add a workflow that runs this Action when your existing CI fails, for example on a `workflow_run` trigger:

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

Your dependencies must already be installed before this step runs — the Action analyzes and fixes the checked-out project, it doesn't install anything for you.

## Inputs

| Input | Required | Default | Description |
|---|---|---|---|
| `path` | No | `.` | Path to the project to analyze and fix |
| `max-attempts` | No | `3` | Maximum AI fix attempts before giving up |
| `base-branch` | No | current branch | Branch to open the fix PR against |
| `github-token` | No | `${{ github.token }}` | Token used to create the branch and PR — needs `contents: write` and `pull-requests: write` |

Also requires an `OPENROUTER_API_KEY` environment variable (see the root [README](../../README.md#setup)).

## Outputs

| Output | Description |
|---|---|
| `fixed` | `"true"` if BugZero fixed the build, `"false"` otherwise |
| `pull-request-url` | URL of the opened pull request, if any |

## Development

```bash
pnpm --filter @opspilot/github-action build
```

`dist/index.js` is committed to this repository (unlike every other package here) because GitHub Actions loads `action.yml` and the bundled entrypoint directly from the repo at a given ref — there's no install step. **Rebuild and commit `dist/` whenever `src/` changes.** CI checks that the committed bundle matches a fresh build and fails if it's out of date.
