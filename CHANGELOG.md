# Changelog

All notable changes to BugZero are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/) (pre-1.0: patch releases may add features).

Entries for releases before 0.0.45 are not written up yet; see the
[GitHub tags](https://github.com/Saksham1800t/Bugzero/tags) for those. A backfill is planned.

## [Unreleased]

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
