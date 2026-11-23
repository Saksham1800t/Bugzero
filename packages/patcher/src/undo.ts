import { createProtectedPathRules, isInsideDirectory, projectRelativePaths, type ProtectedPathRules } from "@opspilot/shared";
import fs from "fs";
import path from "path";
import { fingerprintOf, FINGERPRINT_SUFFIX } from "./fingerprint";

const BACKUP_SUFFIX = ".opspilot.bak";
/** Folders never searched for backups: BugZero does not edit files in them, and they can be huge. */
const SKIPPED_FOLDERS = new Set(["node_modules", ".git"]);

export type UndoStatus =
  /** The file was put back as it was, and its backup removed */
  | "restored"
  /** A dry run: the file would be put back */
  | "would-restore"
  /** Left alone: the file has been changed since BugZero fixed it (use `force` to restore it anyway) */
  | "edited-since"
  /** Left alone: the file is protected, so BugZero does not write to it */
  | "protected"
  | "failed";

export interface UndoEntry {
  /** The file, relative to the project, with forward slashes */
  filePath: string;
  status: UndoStatus;
  /** Why it was skipped or failed */
  detail?: string;
}

export interface UndoOptions {
  /** Only report what would be restored; change nothing */
  dryRun?: boolean;
  /** Restore files even when they were edited after BugZero fixed them */
  force?: boolean;
  protection?: ProtectedPathRules;
}

/** Finds every `<file>.opspilot.bak` under the project, skipping `node_modules`, `.git`, and linked folders. */
export function findBackups(cwd: string): string[] {
  const found: string[] = [];
  const walk = (dir: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIPPED_FOLDERS.has(entry.name)) walk(full);
      } else if (entry.isFile() && entry.name.endsWith(BACKUP_SUFFIX)) {
        found.push(full);
      }
    }
  };
  walk(path.resolve(cwd));
  return found.sort();
}

function readFingerprint(backupPath: string): string | undefined {
  try {
    const text = fs.readFileSync(backupPath + FINGERPRINT_SUFFIX, "utf-8").trim();
    return text === "" ? undefined : text;
  } catch {
    return undefined;
  }
}

function remove(filePath: string) {
  try {
    fs.unlinkSync(filePath);
  } catch {
    // already gone
  }
}

/**
 * Puts every file BugZero changed back as it was, using the backup saved next to it, and removes the backups it
 * used. A file edited after BugZero fixed it is left alone (with its backup) unless `force` is set, so your own
 * later work is not lost. A protected file, or one outside the project, is never written.
 */
export function undoChanges(cwd: string, options: UndoOptions = {}): UndoEntry[] {
  const root = path.resolve(cwd);
  const protection = options.protection ?? createProtectedPathRules();
  const entries: UndoEntry[] = [];

  for (const backupPath of findBackups(root)) {
    const target = backupPath.slice(0, -BACKUP_SUFFIX.length);
    const filePath = path.relative(root, target).split(path.sep).join("/");
    const entry = (status: UndoStatus, detail?: string): UndoEntry => ({ filePath, status, ...(detail ? { detail } : {}) });

    if (!isInsideDirectory(root, target)) {
      entries.push(entry("failed", "The file is outside the project."));
      continue;
    }
    const blockedBy = projectRelativePaths(root, target)
      .map((relPath) => protection.editBlockedBy(relPath))
      .find((pattern) => pattern !== undefined);
    if (blockedBy !== undefined) {
      entries.push(entry("protected", `It is protected (it matches "${blockedBy}"), so BugZero does not write to it.`));
      continue;
    }

    try {
      const original = fs.readFileSync(backupPath);
      const exists = fs.existsSync(target);
      if (exists && !fs.statSync(target).isFile()) {
        entries.push(entry("failed", "It is not a regular file."));
        continue;
      }
      const current = exists ? fs.readFileSync(target) : undefined;
      const alreadyOriginal = current !== undefined && current.equals(original);

      if (current !== undefined && !alreadyOriginal && !options.force) {
        const fixed = readFingerprint(backupPath);
        if (fixed !== undefined && fingerprintOf(current) !== fixed) {
          entries.push(
            entry("edited-since", "It was changed after BugZero fixed it. Use --force to restore it anyway (your changes would be lost).")
          );
          continue;
        }
      }

      if (options.dryRun) {
        entries.push(entry("would-restore"));
        continue;
      }
      if (!alreadyOriginal) fs.writeFileSync(target, original);
      remove(backupPath);
      remove(backupPath + FINGERPRINT_SUFFIX);
      entries.push(entry("restored"));
    } catch (error: any) {
      entries.push(entry("failed", error?.message ?? String(error)));
    }
  }

  return entries;
}
