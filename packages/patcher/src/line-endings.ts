export type LineEnding = "\r\n" | "\n";

const CRLF = "\r\n";
const LF = "\n";

function countEndings(text: string): { crlf: number; lf: number } {
  const crlf = text.split(CRLF).length - 1;
  const lf = text.split(LF).length - 1 - crlf;
  return { crlf, lf };
}

/**
 * Works out which line ending a replacement should use, given the region of `text` it replaces.
 * Look closest first, so a file with mixed endings keeps whatever its own lines already use:
 *   1. the line breaks inside the replaced region,
 *   2. the line break that ends the replaced line,
 *   3. the line break before it,
 *   4. whichever ending the whole file uses most (LF when it has no line breaks at all).
 */
export function detectLineEnding(text: string, start: number, end: number): LineEnding {
  const inside = countEndings(text.slice(start, end));
  if (inside.crlf !== inside.lf) return inside.crlf > inside.lf ? CRLF : LF;

  const nextBreak = text.indexOf(LF, end);
  if (nextBreak !== -1) return text[nextBreak - 1] === "\r" ? CRLF : LF;

  const previousBreak = start > 0 ? text.lastIndexOf(LF, start - 1) : -1;
  if (previousBreak !== -1) return text[previousBreak - 1] === "\r" ? CRLF : LF;

  const whole = countEndings(text);
  return whole.crlf > whole.lf ? CRLF : LF;
}

/** Rewrites every line break in `text` to `ending`. A lone carriage return is left alone. */
export function withLineEnding(text: string, ending: LineEnding): string {
  return text.replace(/\r\n|\n/g, ending);
}
