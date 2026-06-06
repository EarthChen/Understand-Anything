import fs from "fs";
import path from "path";
import {
  sanitizeFilePath,
  resolvePathWithinRoot,
} from "./src/utils/sanitize";

export const MAX_SOURCE_LINES = 200;
export const MAX_SOURCE_FILE_BYTES = 1024 * 1024;

export interface SourcePayload {
  /** Sanitized relative path resolved against projectRoot. */
  file: string;
  /** Original requested path (for frontend display). */
  displayPath: string;
  language: string;
  content: string;
  startLine: number;
  endLine: number;
  lineCount: number;
  sizeBytes: number;
}

export type SourceReadResult = {
  statusCode: number;
  payload: SourcePayload | { error: string };
};

/** Extension-to-language mapping (shared across graph + wiki source). */
export function detectLanguage(filePath: string): string {
  const ext = path.extname(filePath).slice(1).toLowerCase();
  const byExt: Record<string, string> = {
    bash: "bash",
    c: "c",
    cc: "cpp",
    cpp: "cpp",
    cs: "csharp",
    css: "css",
    go: "go",
    h: "c",
    hpp: "cpp",
    html: "markup",
    java: "java",
    js: "javascript",
    jsx: "jsx",
    json: "json",
    md: "markdown",
    mjs: "javascript",
    py: "python",
    rb: "ruby",
    rs: "rust",
    sh: "bash",
    ts: "typescript",
    tsx: "tsx",
    txt: "text",
    yaml: "yaml",
    yml: "yaml",
  };
  return byExt[ext] ?? "text";
}

/** Parse and validate start/end line range query params. */
export function parseLineRange(
  startParam: string | null | undefined,
  endParam: string | null | undefined,
): { startLine: number; endLine: number } | { error: string } {
  const hasStart = startParam !== null && startParam !== undefined && startParam !== "";
  const hasEnd = endParam !== null && endParam !== undefined && endParam !== "";
  const startLine = hasStart ? parseInt(startParam!, 10) : 1;
  const endLine = hasEnd
    ? parseInt(endParam!, 10)
    : hasStart
      ? startLine
      : MAX_SOURCE_LINES;

  if (
    Number.isNaN(startLine) ||
    Number.isNaN(endLine) ||
    startLine < 1 ||
    endLine < 1 ||
    endLine < startLine
  ) {
    return { error: "Invalid line range" };
  }

  if (endLine - startLine + 1 > MAX_SOURCE_LINES) {
    return {
      error: `Line range exceeds maximum of ${MAX_SOURCE_LINES} lines`,
    };
  }

  return { startLine, endLine };
}

/** Slice full file content to the requested inclusive line range. */
export function sliceSourceLines(
  fullContent: string,
  startLine: number,
  endLine: number,
): { content: string; startLine: number; endLine: number } {
  const lines =
    fullContent.length === 0 ? [] : fullContent.split(/\r\n|\n|\r/);
  if (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }
  const clampedEnd = Math.min(endLine, Math.max(lines.length, 1));
  const clampedStart = Math.min(startLine, clampedEnd);
  const slice = lines.slice(clampedStart - 1, clampedEnd);
  return {
    content: slice.join("\n"),
    startLine: clampedStart,
    endLine: clampedEnd,
  };
}

export interface ReadSourceOptions {
  /** Absolute path to the project root directory. */
  projectRoot: string;
  /** Requested file path (may be absolute or relative). */
  filePath: string;
  /** Optional start line (string from query param). */
  startLine?: string | null;
  /** Optional end line (string from query param). */
  endLine?: string | null;
  /**
   * Optional set of allowed relative paths (from the knowledge graph).
   * When provided, files not in this set are rejected with 404.
   */
  kgAllowlist?: Set<string>;
}

/**
 * Unified source file reader for both Graph and Wiki views.
 *
 * Sanitises the path, resolves it within the project root, optionally
 * enforces a KG allowlist, and returns a normalised SourcePayload.
 */
export function readSource(opts: ReadSourceOptions): SourceReadResult {
  const { projectRoot, filePath, startLine, endLine, kgAllowlist } = opts;

  // 1. Parse line range (default: full file up to MAX_SOURCE_LINES).
  const range = parseLineRange(startLine, endLine);
  if ("error" in range) {
    return { statusCode: 400, payload: { error: range.error } };
  }

  // 2. Sanitise the requested path.
  const safeRelative = sanitizeFilePath(filePath);
  if (!safeRelative) {
    return { statusCode: 400, payload: { error: "Invalid file path" } };
  }

  // 3. Resolve within project root (blocks traversal).
  const absoluteFile = resolvePathWithinRoot(projectRoot, filePath);
  if (!absoluteFile) {
    return { statusCode: 400, payload: { error: "Path must stay inside the project" } };
  }

  // 4. If an allowlist is provided, check membership.
  if (kgAllowlist && kgAllowlist.size > 0) {
    if (!kgAllowlist.has(safeRelative)) {
      return { statusCode: 404, payload: { error: "File is not in the knowledge graph" } };
    }
  }

  // 5. Stat the file.
  let stat: fs.Stats;
  try {
    stat = fs.statSync(absoluteFile);
  } catch {
    return { statusCode: 404, payload: { error: "File not found" } };
  }
  if (!stat.isFile()) {
    return { statusCode: 400, payload: { error: "Path is not a file" } };
  }
  if (stat.size > MAX_SOURCE_FILE_BYTES) {
    return { statusCode: 413, payload: { error: "File is too large to preview" } };
  }

  // 6. Read and check for binary content.
  const buffer = fs.readFileSync(absoluteFile);
  if (buffer.includes(0)) {
    return { statusCode: 415, payload: { error: "Binary files cannot be previewed" } };
  }

  // 7. Slice to the requested line range.
  const fullContent = buffer.toString("utf8");
  const sliced = sliceSourceLines(fullContent, range.startLine, range.endLine);

  return {
    statusCode: 200,
    payload: {
      file: safeRelative,
      displayPath: filePath,
      language: detectLanguage(safeRelative),
      content: sliced.content,
      startLine: sliced.startLine,
      endLine: sliced.endLine,
      lineCount:
        fullContent.length === 0
          ? 0
          : fullContent.split(/\r\n|\n|\r/).length,
      sizeBytes: buffer.byteLength,
    },
  };
}
