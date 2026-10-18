import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";

// Keep prompts within a sane size so a huge failing test run or a giant source
// file can't blow past the model's context window or burn tokens.
const MAX_LOG_CHARS = 20_000;
const MAX_FILE_CHARS = 20_000;
const MAX_CONTEXT_CHARS = 60_000;

/**
 * Shortens very long log output by keeping its beginning (where the first
 * errors usually are) and its end (where summaries usually are), dropping the
 * middle. Output within the limit is returned unchanged.
 */
export function truncateLogs(logs: string, maxChars: number = MAX_LOG_CHARS): string {
  if (logs.length <= maxChars) return logs;
  const head = logs.slice(0, Math.floor(maxChars * 0.6));
  const tail = logs.slice(logs.length - Math.floor(maxChars * 0.4));
  const omitted = logs.length - head.length - tail.length;
  return `${head}\n\n... [${omitted} characters of log output omitted to fit the model's context] ...\n\n${tail}`;
}

function resolveExistingPathPrefix(candidate: string): string | null {
  // Clean up common trailing characters in logs like line/col numbers, quotes, parentheses, brackets
  let current = candidate
    .replace(/(?::\d+)+$/, "")
    .replace(/['"()\[\]`]+$/, "")
    .trim();

  while (current.length > 0) {
    try {
      if (fs.existsSync(current)) {
        return current;
      }
    } catch {
      // Ignore
    }
    // Remove the last word or segment
    const lastSpace = current.lastIndexOf(" ");
    if (lastSpace === -1) {
      const lastSlash = Math.max(current.lastIndexOf("/"), current.lastIndexOf("\\"));
      if (lastSlash === -1) {
        break;
      }
      current = current.slice(0, lastSlash).trim();
    } else {
      current = current.slice(0, lastSpace).trim();
    }
  }
  return null;
}

function getContextFiles(logs: string, cwd: string): string {
  const candidates = new Set<string>();

  // Heuristic 1: Extract anything inside quotes (single, double, or backticks)
  const quotedRegex = /['"`]([^'"`\n]+)['"`]/g;
  let match;
  while ((match = quotedRegex.exec(logs)) !== null) {
    const p = match[1].trim();
    if (p.includes("/") || p.includes("\\") || p === "." || p.startsWith(".")) {
      candidates.add(p);
    }
  }

  // Heuristic 2: Extract absolute paths starting with drive letters (Windows)
  const winAbsRegex = /([a-zA-Z]:\\[^*?"<>|\n\r]+)/g;
  while ((match = winAbsRegex.exec(logs)) !== null) {
    candidates.add(match[1].trim());
  }

  // Heuristic 3: Extract absolute paths starting with / (Unix)
  const unixAbsRegex = /(\/[^*?"<>|\n\r\t]+)/g;
  while ((match = unixAbsRegex.exec(logs)) !== null) {
    candidates.add(match[1].trim());
  }

  // Heuristic 4: Fallback to matching relative paths with code extensions
  const fallbackRegex = /(?:[a-zA-Z]:)?[a-zA-Z0-9_\-\/\\.]+\.(?:tsx?|jsx?|json|css|html|js|jsx)/g;
  const fallbackMatches = logs.match(fallbackRegex) || [];
  for (const m of fallbackMatches) {
    candidates.add(m.trim());
  }

  // Resolve and filter unique paths
  const resolvedPaths = new Set<string>();
  for (const candidate of candidates) {
    const absPathCandidate = path.isAbsolute(candidate) ? candidate : path.resolve(cwd, candidate);
    const resolved = resolveExistingPathPrefix(absPathCandidate);
    if (resolved) {
      resolvedPaths.add(path.resolve(resolved));
    }
  }

  if (resolvedPaths.size === 0) return "";

  let context = "\n\n### 📁 Codebase Context:\n";
  const processedFiles = new Set<string>();

  // Helper to read file and add to context
  const addFileToContext = (filePath: string) => {
    const relPath = path.relative(cwd, filePath);
    // Exclude node_modules, build, dist directories
    if (
      relPath.includes("node_modules") ||
      relPath.startsWith("build") ||
      relPath.startsWith("dist") ||
      relPath.startsWith(".git")
    ) {
      return;
    }
    if (processedFiles.has(filePath)) return;
    if (context.length >= MAX_CONTEXT_CHARS) return;
    processedFiles.add(filePath);

    try {
      let content = fs.readFileSync(filePath, "utf-8");
      if (content.length > MAX_FILE_CHARS) {
        const omitted = content.length - MAX_FILE_CHARS;
        content = `${content.slice(0, MAX_FILE_CHARS)}\n... [file truncated: ${omitted} more characters not shown]`;
      }
      context += `\n--- File: ${relPath} ---\n\`\`\`\n${content}\n\`\`\`\n`;
    } catch {
      // Ignore
    }
  };

  for (const absPath of resolvedPaths) {
    try {
      const stats = fs.statSync(absPath);
      if (stats.isFile()) {
        addFileToContext(absPath);

        // Include directory listing of the file's parent directory
        const parentDir = path.dirname(absPath);
        const filesInDir = fs.readdirSync(parentDir);
        const relParentDir = path.relative(cwd, parentDir) || ".";
        
        context += `\n--- Directory files in "${relParentDir}": ---\n`;
        for (const file of filesInDir) {
          try {
            const fileStats = fs.statSync(path.join(parentDir, file));
            const marker = fileStats.isDirectory() ? "/" : "";
            context += `- ${file}${marker}\n`;
          } catch {
            context += `- ${file}\n`;
          }
        }
      } else if (stats.isDirectory()) {
        const relParentDir = path.relative(cwd, absPath) || ".";
        // If it is the project root, don't read all files
        if (relParentDir !== ".") {
          // List directory files
          const filesInDir = fs.readdirSync(absPath);
          context += `\n--- Directory files in "${relParentDir}": ---\n`;
          for (const file of filesInDir) {
            try {
              const fileStats = fs.statSync(path.join(absPath, file));
              const marker = fileStats.isDirectory() ? "/" : "";
              context += `- ${file}${marker}\n`;
            } catch {
              context += `- ${file}\n`;
            }
          }

          // If the directory has a reasonable number of files, read the code files
          if (filesInDir.length <= 15) {
            for (const file of filesInDir) {
              const filePathFull = path.join(absPath, file);
              const fileExt = path.extname(file).toLowerCase();
              try {
                if (
                  fs.statSync(filePathFull).isFile() &&
                  [".js", ".jsx", ".ts", ".tsx", ".json", ".css"].includes(fileExt)
                ) {
                  addFileToContext(filePathFull);
                }
              } catch {
                // Ignore
              }
            }
          }
        }
      }
    } catch {
      // Ignore
    }
  }

  return context;
}

export function buildAnalysisPrompt(errorOutput: string, cwd: string): string {
  const warningMarker = "⚠️ [BugZero System Warning]";
  let compilerLogs = errorOutput;
  let historySection = "";

  if (errorOutput.includes(warningMarker)) {
    const parts = errorOutput.split(warningMarker);
    compilerLogs = parts[0].trim();
    const warnings = parts.slice(1).map((w) => w.trim());
    historySection = `\n\n### ⚠️ Previous Failed Attempts:\n${warnings
      .map((w, idx) => `Failed Attempt ${idx + 1}:\n${w}`)
      .join("\n\n")}\n\n**CRITICAL RULE:** Do NOT suggest modifying or creating the files listed under "Previous Failed Attempts" if they failed with a "File not found" or "Search string not found" error. You must inspect the compiler error logs below to find the actual file that exists and contains the error.`;
  }

  compilerLogs = truncateLogs(compilerLogs);

  const contextSection = getContextFiles(compilerLogs, cwd);

  return `You are an expert software engineer specialising in fixing build, lint, and test failures.

A project located at "${cwd}" failed to build. Here is the error output (very long output is shortened in the middle):

\`\`\`
${compilerLogs}
\`\`\`${historySection}${contextSection}

Your task:
1. Root Cause: Identify the root cause of the build failure.
2. Codebase Context: Read the provided file contents and directory listings under "📁 Codebase Context" to locate the correct files, imports, and file paths. Do not guess filenames or contents that are not in the context.
3. Patch: Provide the minimal, precise fix. If the fix genuinely requires changes in more than one file (for example, a renamed export and every place that imports it), include one patch entry per file — all patches in your response are applied together, atomically.

Reply with ONLY a valid JSON object in this exact shape — no markdown fences, no extra text:
{
  "rootCause": "One-sentence explanation of the error",
  "explanation": "short explanation of what you changed and why",
  "patches": [
    {
      "filePath": "relative/path/from/project/root/to/file.ts",
      "search": "exact code that currently exists in the file and must be replaced",
      "replace": "the corrected code that replaces the search string"
    }
  ]
}

Critical rules:
- "patches" must contain at least one entry. Only include more than one when the fix truly requires editing multiple files — most fixes need just one.
- Each "filePath" must be a relative path from the project root (no leading /).
- Each "search" must be an EXACT character-for-character substring of that file's current content.
- Each "replace" must be syntactically valid code.
- If two patches target the same file, list them in the order they should be applied, and make sure each "search" reflects the file's content *after* the previous patch in this list has been applied to it.
- Do NOT add backticks, markdown, or any text outside the JSON object.`;
}