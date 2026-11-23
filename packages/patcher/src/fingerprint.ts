import crypto from "crypto";
import fs from "fs";

/** The suffix of the note saved next to a backup: `<file>.opspilot.bak.sha` holds the fingerprint of the fixed file. */
export const FINGERPRINT_SUFFIX = ".sha";

/** A short, stable fingerprint of some file content (SHA-256, hex). */
export function fingerprintOf(content: Buffer | string): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}

/**
 * Saves the fingerprint of a file just after BugZero wrote it, next to its backup, so `undo` can tell later
 * whether anyone has edited the file since. Best effort: if the note cannot be written, any older (now wrong)
 * note is removed, so `undo` never compares against a stale fingerprint.
 */
export function saveFingerprint(absoluteFilePath: string, backupPath: string): void {
  const notePath = backupPath + FINGERPRINT_SUFFIX;
  try {
    fs.writeFileSync(notePath, fingerprintOf(fs.readFileSync(absoluteFilePath)) + "\n", "utf-8");
  } catch {
    try {
      fs.unlinkSync(notePath);
    } catch {
      // nothing more to do
    }
  }
}
