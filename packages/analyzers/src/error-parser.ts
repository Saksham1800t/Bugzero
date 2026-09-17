import type { ParsedError } from "@opspilot/shared";

// TypeScript: src/index.ts(10,5): error TS2345: Argument of type ...
const TS_ERROR_RE = /^(.+)\((\d+),(\d+)\):\s+error\s+TS\d+:\s+(.+)$/gm;

// ESLint: "  10:5  error  'foo' is not defined  no-undef"
const ESLINT_ERROR_RE = /^\s+(\d+):(\d+)\s+error\s+(.+)$/gm;

// Jest: "● test name › expect(...)"
const JEST_FAIL_RE = /● (.+)/g;
const JEST_FILE_RE = /FAIL\s+([\w/\\.\-]+)/g;

export function parseErrors(output: string): ParsedError[] {
  const errors: ParsedError[] = [];

  // --- TypeScript ---
  const tsMatches = [...output.matchAll(TS_ERROR_RE)];
  for (const m of tsMatches) {
    errors.push({
      type: "typescript",
      file: m[1].trim(),
      line: parseInt(m[2], 10),
      column: parseInt(m[3], 10),
      message: m[4].trim(),
      raw: m[0],
    });
  }

  if (errors.length > 0) return errors;

  // --- ESLint ---
  const eslintMatches = [...output.matchAll(ESLINT_ERROR_RE)];
  for (const m of eslintMatches) {
    errors.push({
      type: "eslint",
      line: parseInt(m[1], 10),
      column: parseInt(m[2], 10),
      message: m[3].trim(),
      raw: m[0],
    });
  }

  if (errors.length > 0) return errors;

  // --- Jest ---
  const jestFiles = [...output.matchAll(JEST_FILE_RE)].map((m) => m[1]);
  const jestFails = [...output.matchAll(JEST_FAIL_RE)];
  for (const m of jestFails) {
    errors.push({
      type: "jest",
      file: jestFiles[0],
      message: m[1].trim(),
      raw: m[0],
    });
  }

  if (errors.length > 0) return errors;

  // --- Fallback ---
  if (output.trim()) {
    errors.push({
      type: "unknown",
      message: output.slice(0, 500),
      raw: output,
    });
  }

  return errors;
}
