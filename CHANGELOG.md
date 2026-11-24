# Changelog

All notable changes to BugZero are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/) (pre-1.0: patch releases may add features).

Entries for releases before 0.0.45 are not written up yet; see the
[GitHub tags](https://github.com/Saksham1800t/Bugzero/tags) for those. A backfill is planned.

## [Unreleased]

### Added

- **`rescue` stops early when attempts are not making progress.** After each attempt it compares what is
  still failing with the best result so far: fewer errors, or a later step failing (build, then lint,
  then tests), counts as progress. After 2 attempts in a row without it, the run stops and says why,
  instead of paying for the remaining attempts. Output it cannot count only stops a run when it is
  exactly the same as before. Attempts whose patch did not apply, or that you declined, are not counted.
  Set it with `--patience <n>` or `patience` in `.bugzerorc`; `0` turns it off.

### Fixed

- Error counting and the report now recognise TypeScript and ESLint errors in output with Windows (CRLF)
  line endings; before, none were found there and the output was treated as one unknown error.

## [0.0.58] - 2026-11-23

### Added

- **`bugzero undo` puts back the files BugZero changed.** It restores each file from the `<file>.opspilot.bak`
  saved next to it and removes the backups it used. A file you edited after the fix is left alone and
  reported (use `--force` to restore it anyway), `--dry-run` shows what would happen, backups in
  `node_modules` and `.git` are ignored, and protected files are never written. It exits 1 if any
  file was not restored.
- `rescue` now ends with how to undo, after a fix that worked and after a run that changed files and
  still failed. Previously a failed run left changed files with no hint.
- Each backup now has a small `<file>.opspilot.bak.sha` note next to it (a fingerprint of the fixed file),
  which is how `undo` knows whether you edited the file since. It is protected like the backup itself.

## [0.0.57] - 2026-11-23

### Added

- **`bugzero rescue --approve` shows each proposed fix and asks before writing it.** The AI's whole fix
  is shown as a diff, then you answer `y` (apply it), `n` or Enter (decline), or `m` (decline and type a
  note for the AI). The fix is shown whole, not file by file, because a fix that spans several files is
  applied together or not at all. Declining changes nothing: the AI is told you declined (and your note,
  if any) and asked for a different fix, which uses up one attempt, so the run still stops at
  `--max-attempts`. If every fix was declined, the result says "You declined N proposed fixes, so nothing
  was changed" instead of blaming the attempt limit.
- **Without a terminal, `--approve` stops immediately** with a clear message, before running your build or
  contacting the AI. It never writes without being asked, and never skips the question silently. With
  `--json`, that is reported as a JSON error. It has no effect with `--dry-run` or `--print-prompt`, which
  never write.
- The diff shown is exactly what would be written: it is built by the same code that applies the patch
  (`previewPatches` in `@opspilot/patcher`), and it refuses the same things (paths outside the project,
  protected files, a search text that is not found). A fix that cannot be applied is reported to the AI as
  before and you are not asked about it.

### Docs

- `docs/PRIVACY.md` notes that a declined fix, and any note you type with it, is sent to the AI.

## [0.0.56] - 2026-11-22

### Added

- **`rescue` now prints a diff of what it changed.** After a successful fix, the output ends with a
  unified diff, in the format `git diff` uses, of every file that was edited, compared with the original
  saved next to it as `<file>.opspilot.bak`. A file edited more than once is shown once, as a single
  before-and-after. Very long lines are shortened with a note of how much was left out. The diff is
  plain text and only in the human-readable output; `--json` is unchanged.

### Internal

- New diff renderer in `@opspilot/patcher` (`renderUnifiedDiff`, `renderChangesFromBackups`), a pure
  function that the planned `--approve` option will reuse. Besides unit tests, several thousand randomly
  generated diffs were applied with `git apply` and each result checked against the intended file. Very large
  or completely different files fall back to "everything removed, everything added" so time and memory
  stay bounded.
- CI now repeats the end of a failed build or test run as an annotation on the job, so a failure can be
  read without signing in to GitHub.

## [0.0.55] - 2026-11-21

### Added

- **`bugzero rescue --print-prompt` shows exactly what would be sent to the AI model, then stops.** It
  runs your build, lint and tests locally to get the error output, prints the exact first repair prompt
  on stdout, and exits with code 0. Nothing is sent, nothing is edited, and no report is written, so you
  can check what leaves your machine, or save it with `> prompt.txt`. Progress messages go to stderr.
  The preview is built by the same function the repair loop uses, so it cannot drift from what is sent.
  If the project already passes, nothing would be sent and it says so. It takes precedence over
  `--dry-run`, which asks the model to write a report.
- **`--json` with `--print-prompt`** reports `"outcome": "prompt-preview"`, `"success": true` and the
  text in a new `"prompt"` field.

### Changed

- The `--json` result of `rescue` has a new `prompt` field (`null` unless `--print-prompt` was used) and
  a new possible `outcome` value, `"prompt-preview"`. Existing fields and values are unchanged.

### Docs

- New [docs/PRIVACY.md](docs/PRIVACY.md) and a short Privacy section in the README: exactly what is sent
  to the AI provider and when, what is never sent, the size limits, how to check it first, and the
  limits of the protection (a secret that your build prints, or that sits inside a source file an error
  mentions, is not recognised and will be sent).

## [0.0.54] - 2026-11-19

### Security

- **BugZero no longer edits secrets, git internals, CI configs, lockfiles or dependencies.** A model
  reply could previously overwrite `.env`, a deploy key, `.github/workflows/*.yml` or a lockfile, and a
  fix in a bad guess or a hostile project could be hidden in a change nobody reviews. Patches to these
  are now refused before any file changes, and the model is told the file is protected so it fixes
  something else. The default list: `.env` and `.env.*`, `*.pem`, `*.key`, `.git/`, `.github/workflows/`,
  `.gitlab-ci.yml`, `.circleci/`, `azure-pipelines.yml`, `bitbucket-pipelines.yml`, `Jenkinsfile`,
  `package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`, `bun.lockb`, `node_modules/`, and `*.opspilot.bak`.
  A protected file reached through a symlink or junction is caught too.
- **Secret files are no longer sent to the AI model.** An error log that named `.env`, a nested
  `.env.local`, or a key file (by relative or absolute path, or as part of a listed folder) used to get
  that file's contents added to the prompt. `.env`, `.env.*`, `*.pem` and `*.key` are now left out.
  Lockfiles and CI configs can still be shown as context.

### Added

- **`protect` and `allow` in `.bugzerorc`** to adjust the list per project. `protect` adds patterns
  that must never be edited (for example `"config/prod.json"` or `"migrations/**"`); `allow` lifts a
  default for a file you do want BugZero to be able to change and read (for example `".env.example"`).
  Both are optional, a `protect` pattern wins over `allow`, and values of the wrong type are ignored.

### Changed

- **Behaviour change:** edits to lockfiles and CI workflow files, which were possible before, are now
  refused by default. If a project depends on that, list the file under `allow` in `.bugzerorc`.
- `bugzero vibe` now keeps the other settings in `.bugzerorc` when it saves the model. It used to
  replace the whole file, which would have erased `protect` and `allow`.

### Internal

- `@opspilot/config` no longer loads a `.env` just by being imported; the CLI does it explicitly at
  startup, so the GitHub Action does not begin reading a repository's `.env`.

No existing CLI flag or `.bugzerorc` key was renamed or removed.

## [0.0.53] - 2026-11-19

### Added

- **`bugzero hunt --no-ai-report` runs without contacting an AI model.** When a check fails, `hunt`
  normally sends the error logs to your AI provider to write the diagnosis in `bugzero-report.md`. With
  this flag it makes no network call: the report still lists the status of each check and the raw logs,
  and says the AI report was turned off. Without the flag nothing changes.

### Deprecation notice

- **Planned for 1.0:** `hunt` will stop calling an AI model by default, and the AI diagnosis will
  become opt-in. The default does not change in this release. If you rely on the AI diagnosis, nothing
  is needed now; if you want `hunt` to be offline already, use `--no-ai-report`.

## [0.0.52] - 2026-11-17

### Fixed

- **The AI-written reports no longer send unlimited log text to the model.** `hunt`, a `rescue` that
  could not fix the project, and `rescue --dry-run` put the raw error output into the report prompt
  with no size limit, so a huge failing run (thousands of test failures, a giant stack trace) was sent
  whole, costing tokens and risking the model's context window. Logs are now capped at about 20,000
  characters per prompt, keeping the start and the end and saying how much was left out. `hunt` shares
  that budget between the failing checks, so one noisy check cannot push the others out. The full
  output is still in the fallback report written when no AI call is possible. Logs under the limit are
  sent exactly as before.

### Internal

- The three report prompts moved out of `orchestrator.ts` into `report-prompts.ts` as plain functions
  with tests. Their wording is unchanged and is pinned by snapshot tests.

## [0.0.51] - 2026-11-17

### Fixed

- **Patches no longer leave Windows files with mixed line endings.** The AI always writes `\n`, so a
  patch that added lines to a CRLF file inserted bare `\n` breaks in the middle of it (for example a
  file with 1 CRLF and 3 bare LF after patching). This broke `git diff` noise, linters that enforce one
  line ending, and sometimes the build itself. The replacement text now takes on the line ending of the
  lines it replaces, for every matching tier (exact, whitespace and similarity). LF files stay LF, and
  the rest of a file with mixed endings is left as it was.

## [0.0.50] - 2026-11-17

### Fixed

- **`--path` now loads that project's `.env`.** BugZero only looked for `.env` in the folder you ran
  the command from, so `bugzero rescue --path ../app` ignored `../app/.env` (the docs and the "missing
  key" message both said the project you are targeting). `hunt` and `rescue` now load the closest `.env`
  at or above the `--path` folder. A variable already set in your shell still wins over any file, and the
  target project's `.env` wins over one in the folder you ran the command from. Running without `--path`
  behaves as before. This also means the project's build, lint and test commands see its `.env` values.

### Internal

- **CI now tests Node 20, 22 and 24 on Linux, Windows and macOS** (it used to run only Node 20 on Linux),
  plus Node 22.12.0 on Linux, the oldest version `engines` promises. All 10 combinations pass, so the
  `>=22.12.0` requirement is confirmed and stays as it is. Node 20 also passes, but it is end-of-life and
  is not promised.
- CI installs pnpm with `pnpm/action-setup` instead of `corepack enable`. The Corepack bundled with
  Node 22.12.0 cannot verify current pnpm downloads, which made that combination fail before any
  BugZero code ran.

## [0.0.49] - 2026-11-15

### Fixed

- **`rescue` no longer calls the AI model when your project already passes.** It used to send an
  empty error log to the model to "analyze unresolved errors", which cost tokens for nothing. Without
  an API key that call failed, and `bugzero-report.md` then said "Could not repair automatically" for a
  project that was fine. The report now says nothing needed fixing, and no model is called.

## [0.0.48] - 2026-11-13

### Fixed

- **`.opspilot.bak` now always holds your original file.** The backup was rewritten every time a file
  was patched, so when a fix took more than one edit to the same file (two edits in one reply, or
  edits on separate attempts) the backup ended up holding an intermediate, already-patched version and
  your original was lost. A file is now backed up once per run, the first time it is patched, and later
  edits leave that backup alone. A leftover backup from an earlier run is still replaced. If a later
  attempt fails and is rolled back, the backups from earlier successful attempts are kept.

## [0.0.47] - 2026-11-13

### Security

- **File edits and reads are now confined to the project.** A patch whose path left the project
  (with `../`, an absolute path elsewhere, or a symlink or junction pointing out) could overwrite files
  outside it, which a manipulated model reply or a hostile project could abuse. Such patches are now
  refused before any file is changed, and the model is told why so it can correct itself. Absolute paths
  that point inside the project still work. Separately, a file outside the project that an error log
  happened to mention could be read and sent to the AI provider; that no longer happens.

## [0.0.46] - 2026-11-12

### Fixed

- **A patch that failed to apply no longer stops later attempts from being verified.** After one
  patch failed, a leftover warning in the error log made every following attempt skip validation. A
  correct patch applied on a later attempt was never checked, so the run could not succeed and used up
  every remaining attempt. Each attempt is now checked on its own.

## [0.0.45] - 2026-11-11

### Fixed

- **A fix that took several attempts now reports every file it changed.** `rescue`, the generated
  `bugzero-report.md`, `--json` output (`fix.files`), and the GitHub Action's pull request used to
  include only the *last* attempt's patches. Edits from earlier attempts stayed on disk but were left
  out, so the pull request could be missing files the fix depended on. They now include the patches from
  every attempt that was actually written to disk, in order. A file patched in more than one attempt is
  listed once, and the pull request commits its current content.

### Changed

- `fix` in `--json` output (and the internal `appliedFix`) now describes only patches that were really
  applied. Before, a failed run could report the last patch the model *suggested* even if it was never
  applied. `rootCause` and `explanation` still describe the most recent applied attempt.

### Internal

- New `uniqueFilePaths` helper in `@opspilot/shared`.
- Added an end-to-end workflow test that fakes only the model and runs the real patcher and a real
  `npm run build`, to check what ends up on disk and in the reported fix.
- Raised the per-test timeout for the real-CLI `--json` tests, which could exceed vitest's 5s default
  when the machine was busy.

No changes to CLI flags, commands, or the `.bugzerorc` format.
