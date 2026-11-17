# Changelog

All notable changes to BugZero are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/) (pre-1.0: patch releases may add features).

Entries for releases before 0.0.45 are not written up yet; see the
[GitHub tags](https://github.com/Saksham1800t/Bugzero/tags) for those. A backfill is planned.

## [Unreleased]

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
