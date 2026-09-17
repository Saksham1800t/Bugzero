import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";

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
    processedFiles.add(filePath);

    try {
      const content = fs.readFileSync(filePath, "utf-8");
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

  const contextSection = getContextFiles(compilerLogs, cwd);

  return `You are an expert software engineer specialising in fixing build, lint, and test failures.

A project located at "${cwd}" failed to build. Here is the complete error output:

\`\`\`
${compilerLogs}
\`\`\`${historySection}${contextSection}

Your task:
1. Root Cause: Identify the root cause of the build failure.
2. Codebase Context: Read the provided file contents and directory listings under "📁 Codebase Context" to locate the correct files, imports, and file paths. Do not guess filenames or contents that are not in the context.
3. Patch: Provide the minimal, precise fix.

Reply with ONLY a valid JSON object in this exact shape — no markdown fences, no extra text:
{
  "rootCause": "One-sentence explanation of the error",
  "filePath": "relative/path/from/project/root/to/file.ts",
  "search": "exact code that currently exists in the file and must be replaced",
  "replace": "the corrected code that replaces the search string",
  "explanation": "short explanation of what you changed and why"
}

Critical rules:
- "filePath" must be a relative path from the project root (no leading /).
- "search" must be an EXACT character-for-character substring of the current file content.
- "replace" must be syntactically valid code.
- Do NOT add backticks, markdown, or any text outside the JSON object.`;
}