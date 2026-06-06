import {
  readSource,
  parseLineRange,
  sliceSourceLines,
  detectLanguage,
  MAX_SOURCE_LINES,
  type SourceReadResult,
} from "./source-reader";

// Re-export under legacy names for backward compatibility.
export const MAX_WIKI_SOURCE_LINES = MAX_SOURCE_LINES;
export const MAX_WIKI_SOURCE_FILE_BYTES = 1024 * 1024;
export const parseWikiSourceLineRange = parseLineRange;
export { sliceSourceLines };
export const detectWikiSourceLanguage = detectLanguage;

export type WikiSourceReadResult = SourceReadResult;

/**
 * Read a source file for the Wiki view.
 *
 * Delegates to the shared `readSource()` from source-reader.ts.
 * Kept for backward compatibility with vite.config.ts wiki handler.
 */
export function readWikiSourceFile(
  projectRoot: string,
  filePath: string,
  startParam: string | null,
  endParam: string | null,
): WikiSourceReadResult {
  return readSource({
    projectRoot,
    filePath,
    startLine: startParam,
    endLine: endParam,
  });
}
