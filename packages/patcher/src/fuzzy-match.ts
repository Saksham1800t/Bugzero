export type MatchStrategy = "exact" | "whitespace" | "similarity";

export interface MatchResult {
  /** Start offset of the matched region in the original content */
  start: number;
  /** End offset (exclusive) of the matched region in the original content */
  end: number;
  strategy: MatchStrategy;
  /** 1 for exact/whitespace matches; the average per-line similarity for a "similarity" match */
  score: number;
}

interface LineSpan {
  text: string;
  start: number;
  end: number;
}

const SIMILARITY_THRESHOLD = 0.85;
// A best match must beat the runner-up by this much to be accepted, otherwise
// the location is ambiguous and we'd rather fail than patch the wrong spot.
const AMBIGUITY_MARGIN = 0.05;
// Skip the O(lines^2) similarity pass on very large files to avoid pathological slowdowns.
const MAX_LINES_FOR_SIMILARITY_PASS = 20000;

/** Split text into lines, tracking each line's byte offsets (line terminators excluded). */
function splitLinesWithOffsets(text: string): LineSpan[] {
  const lines: LineSpan[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\n") {
      let end = i;
      if (end > start && text[end - 1] === "\r") end -= 1;
      lines.push({ text: text.slice(start, end), start, end });
      start = i + 1;
    }
  }
  lines.push({ text: text.slice(start), start, end: text.length });
  return lines;
}

function normalizeLine(line: string): string {
  return line.trim().replace(/\s+/g, " ");
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  const dp = new Array(n + 1);
  for (let j = 0; j <= n; j++) dp[j] = j;

  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const temp = dp[j];
      dp[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j], dp[j - 1]);
      prev = temp;
    }
  }
  return dp[n];
}

/** Similarity in [0, 1]; 1 means identical, 0 means completely different. */
export function lineSimilarity(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(a, b) / maxLen;
}

function findWhitespaceNormalizedMatch(content: string, search: string): MatchResult | null {
  const searchLines = search.split(/\r\n|\n/).map(normalizeLine);
  const contentLines = splitLinesWithOffsets(content);
  if (searchLines.length === 0 || searchLines.length > contentLines.length) return null;

  const normalizedContentLines = contentLines.map((l) => normalizeLine(l.text));

  for (let i = 0; i + searchLines.length <= contentLines.length; i++) {
    let matches = true;
    for (let j = 0; j < searchLines.length; j++) {
      if (normalizedContentLines[i + j] !== searchLines[j]) {
        matches = false;
        break;
      }
    }
    if (matches) {
      const firstLine = contentLines[i];
      const lastLine = contentLines[i + searchLines.length - 1];
      return { start: firstLine.start, end: lastLine.end, strategy: "whitespace", score: 1 };
    }
  }
  return null;
}

function findSimilarityMatch(content: string, search: string): MatchResult | null {
  const searchLines = search.split(/\r\n|\n/);
  const contentLines = splitLinesWithOffsets(content);
  if (searchLines.length === 0 || searchLines.length > contentLines.length) return null;
  if (contentLines.length > MAX_LINES_FOR_SIMILARITY_PASS) return null;

  let bestIndex = -1;
  let bestScore = -1;
  let secondBestScore = -1;

  for (let i = 0; i + searchLines.length <= contentLines.length; i++) {
    let total = 0;
    for (let j = 0; j < searchLines.length; j++) {
      total += lineSimilarity(searchLines[j], contentLines[i + j].text);
    }
    const avgScore = total / searchLines.length;

    if (avgScore > bestScore) {
      secondBestScore = bestScore;
      bestScore = avgScore;
      bestIndex = i;
    } else if (avgScore > secondBestScore) {
      secondBestScore = avgScore;
    }
  }

  if (bestIndex === -1 || bestScore < SIMILARITY_THRESHOLD) return null;
  if (secondBestScore >= 0 && bestScore - secondBestScore < AMBIGUITY_MARGIN) return null;

  const firstLine = contentLines[bestIndex];
  const lastLine = contentLines[bestIndex + searchLines.length - 1];
  return { start: firstLine.start, end: lastLine.end, strategy: "similarity", score: bestScore };
}

/**
 * Locates `search` inside `content`, falling back through increasingly
 * lenient strategies: exact substring, whitespace-normalized line match,
 * then a similarity-scored line window. Returns null if nothing clears the
 * similarity threshold or if the best match is ambiguous.
 */
export function findMatch(content: string, search: string): MatchResult | null {
  const exactIndex = content.indexOf(search);
  if (exactIndex !== -1) {
    return { start: exactIndex, end: exactIndex + search.length, strategy: "exact", score: 1 };
  }

  return findWhitespaceNormalizedMatch(content, search) ?? findSimilarityMatch(content, search);
}
