import { resolveInsideProject } from "@opspilot/shared";
import fs from "fs";
import path from "path";

/** One file's content before and after a change. */
export interface FileChange {
  /** Path shown in the diff header, relative to the project. */
  filePath: string;
  before: string;
  after: string;
}

export interface DiffOptions {
  /** Unchanged lines to show around each change (default 3). */
  context?: number;
  /** Lines longer than this are cut short, with a note of how much was left out (default 200). */
  maxLineLength?: number;
}

const DEFAULT_CONTEXT = 3;
const DEFAULT_MAX_LINE_LENGTH = 200;
/**
 * The most edits the line comparison will search for. Two files this different are shown as "everything
 * removed, everything added" instead, which keeps memory and time bounded on pathological input.
 */
const MAX_EDIT_DISTANCE = 1500;

/** Attached to the last line of text that does not end with a newline, so that difference is visible. */
const NO_NEWLINE = "\u0000no-newline";

type Op = { kind: "equal" | "delete" | "insert" };

function toLines(text: string): string[] {
  if (text === "") return [];
  const parts = text.split("\n");
  if (parts[parts.length - 1] === "") parts.pop();
  else parts[parts.length - 1] += NO_NEWLINE;
  return parts;
}

/** The shortest list of line edits turning `a` into `b` (Myers), or null if they differ too much. */
function diffLines(a: string[], b: string[]): Op[] | null {
  const n = a.length;
  const m = b.length;
  if (n === 0) return b.map(() => ({ kind: "insert" }));
  if (m === 0) return a.map(() => ({ kind: "delete" }));

  const limit = Math.min(n + m, MAX_EDIT_DISTANCE);
  const offset = limit + 1;
  const v = new Int32Array(2 * limit + 3);
  const trace: Int32Array[] = [];

  for (let d = 0; d <= limit; d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x: number;
      if (k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1])) x = v[offset + k + 1];
      else x = v[offset + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[offset + k] = x;

      if (x >= n && y >= m) {
        // Walk back through the trace to recover the edits.
        const ops: Op[] = [];
        let px = n;
        let py = m;
        for (let step = d; step >= 0; step--) {
          const snapshot = trace[step];
          const diagonal = px - py;
          const prevDiagonal =
            diagonal === -step || (diagonal !== step && snapshot[offset + diagonal - 1] < snapshot[offset + diagonal + 1])
              ? diagonal + 1
              : diagonal - 1;
          const prevX = snapshot[offset + prevDiagonal];
          const prevY = prevX - prevDiagonal;
          while (px > prevX && py > prevY) {
            ops.push({ kind: "equal" });
            px--;
            py--;
          }
          if (step > 0) {
            ops.push({ kind: px === prevX ? "insert" : "delete" });
            if (px === prevX) py--;
            else px--;
          }
        }
        return ops.reverse();
      }
    }
  }
  return null;
}

/** Every line edit between two files, trimming what they share at the start and end first so big files stay cheap. */
function computeOps(oldLines: string[], newLines: string[]): Op[] {
  let prefix = 0;
  while (prefix < oldLines.length && prefix < newLines.length && oldLines[prefix] === newLines[prefix]) prefix++;

  let suffix = 0;
  while (
    suffix < oldLines.length - prefix &&
    suffix < newLines.length - prefix &&
    oldLines[oldLines.length - 1 - suffix] === newLines[newLines.length - 1 - suffix]
  ) {
    suffix++;
  }

  const oldMiddle = oldLines.slice(prefix, oldLines.length - suffix);
  const newMiddle = newLines.slice(prefix, newLines.length - suffix);
  const middle: Op[] =
    diffLines(oldMiddle, newMiddle) ??
    [...oldMiddle.map((): Op => ({ kind: "delete" })), ...newMiddle.map((): Op => ({ kind: "insert" }))];

  return [
    ...Array.from({ length: prefix }, (): Op => ({ kind: "equal" })),
    ...middle,
    ...Array.from({ length: suffix }, (): Op => ({ kind: "equal" })),
  ];
}

function formatRange(start: number, count: number): string {
  return count === 1 ? String(start) : `${start},${count}`;
}

function renderLine(prefix: string, raw: string, maxLineLength: number): string[] {
  const missingNewline = raw.endsWith(NO_NEWLINE);
  let text = (missingNewline ? raw.slice(0, -NO_NEWLINE.length) : raw).replace(/\r$/, "");
  if (text.length > maxLineLength) {
    text = `${text.slice(0, maxLineLength)}… [${text.length - maxLineLength} more characters]`;
  }
  const rendered = [`${prefix}${text}`];
  if (missingNewline) rendered.push("\\ No newline at end of file");
  return rendered;
}

function renderOne(change: FileChange, context: number, maxLineLength: number): string[] {
  if (change.before === change.after) return [];

  const oldLines = toLines(change.before);
  const newLines = toLines(change.after);
  const ops = computeOps(oldLines, newLines);

  // How many old and new lines come before each operation.
  const oldBefore: number[] = [];
  const newBefore: number[] = [];
  let oldCount = 0;
  let newCount = 0;
  for (const op of ops) {
    oldBefore.push(oldCount);
    newBefore.push(newCount);
    if (op.kind !== "insert") oldCount++;
    if (op.kind !== "delete") newCount++;
  }

  const changed: number[] = [];
  ops.forEach((op, index) => {
    if (op.kind !== "equal") changed.push(index);
  });
  if (changed.length === 0) return []; // only possible if the texts are the same line by line

  // Changes whose context would touch or overlap share one hunk.
  const groups: { first: number; last: number }[] = [];
  for (const index of changed) {
    const current = groups[groups.length - 1];
    if (current && index - current.last - 1 <= 2 * context) current.last = index;
    else groups.push({ first: index, last: index });
  }

  const output = [`--- a/${change.filePath}`, `+++ b/${change.filePath}`];
  for (const group of groups) {
    const from = Math.max(0, group.first - context);
    const to = Math.min(ops.length - 1, group.last + context);

    let oldInHunk = 0;
    let newInHunk = 0;
    for (let i = from; i <= to; i++) {
      if (ops[i].kind !== "insert") oldInHunk++;
      if (ops[i].kind !== "delete") newInHunk++;
    }
    const oldStart = oldInHunk === 0 ? oldBefore[from] : oldBefore[from] + 1;
    const newStart = newInHunk === 0 ? newBefore[from] : newBefore[from] + 1;
    output.push(`@@ -${formatRange(oldStart, oldInHunk)} +${formatRange(newStart, newInHunk)} @@`);

    for (let i = from; i <= to; i++) {
      const op = ops[i];
      if (op.kind === "equal") output.push(...renderLine(" ", oldLines[oldBefore[i]], maxLineLength));
      else if (op.kind === "delete") output.push(...renderLine("-", oldLines[oldBefore[i]], maxLineLength));
      else output.push(...renderLine("+", newLines[newBefore[i]], maxLineLength));
    }
  }
  return output;
}

/**
 * Renders the changes to one or more files as a unified diff, the format `git diff` prints.
 * Files that did not change are left out; if nothing changed the result is an empty string.
 * Pure: it only formats the text it is given.
 */
export function renderUnifiedDiff(changes: FileChange | FileChange[], options: DiffOptions = {}): string {
  const context = Math.max(0, options.context ?? DEFAULT_CONTEXT);
  const maxLineLength = Math.max(1, options.maxLineLength ?? DEFAULT_MAX_LINE_LENGTH);
  const list = Array.isArray(changes) ? changes : [changes];

  return list
    .flatMap((change) =>
      renderOne({ ...change, filePath: change.filePath.replace(/\\/g, "/") }, context, maxLineLength)
    )
    .join("\n");
}

/**
 * The diff of what a repair changed: each file compared with the original that was saved next to it
 * as `<file>.opspilot.bak` before it was first edited. Files with no backup, files that did not change,
 * and paths outside the project are skipped.
 */
export function renderChangesFromBackups(cwd: string, filePaths: string[], options: DiffOptions = {}): string {
  const changes: FileChange[] = [];
  for (const filePath of filePaths) {
    const resolved = resolveInsideProject(cwd, filePath);
    if (!resolved.ok) continue;
    try {
      changes.push({
        filePath: path.relative(path.resolve(cwd), resolved.absolutePath),
        before: fs.readFileSync(`${resolved.absolutePath}.opspilot.bak`, "utf-8"),
        after: fs.readFileSync(resolved.absolutePath, "utf-8"),
      });
    } catch {
      // no backup, or the file is gone: nothing to compare
    }
  }
  return renderUnifiedDiff(changes, options);
}
