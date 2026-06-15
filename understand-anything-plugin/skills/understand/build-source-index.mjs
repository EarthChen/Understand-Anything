#!/usr/bin/env node
/**
 * build-source-index.mjs
 *
 * Builds a serialized MiniSearch index for full source code search.
 * Reads structural-analysis.json (AST boundaries), chunks source files
 * by function/class boundaries, and serializes the inverted index to
 * source-index.json for fast loading at query time.
 *
 * Usage:
 *   node build-source-index.mjs <projectRoot>
 *
 * Input:
 *   <projectRoot>/.understand-anything/intermediate/extraction/structural-analysis.json
 *
 * Output:
 *   <projectRoot>/.understand-anything/intermediate/extraction/source-index.json
 *
 * Exit code: 0 on success; non-zero on error.
 */

import { createRequire } from 'node:module';
import { dirname, resolve, join, extname, basename } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { existsSync, readFileSync, writeFileSync, statSync, realpathSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pluginRoot = resolve(__dirname, '../..');
const require = createRequire(resolve(pluginRoot, 'package.json'));

// Resolve MiniSearch
let MiniSearch;
try {
  const mod = await import(pathToFileURL(require.resolve('minisearch')).href);
  MiniSearch = mod.default ?? mod;
} catch {
  const fallback = resolve(pluginRoot, 'packages/dashboard/node_modules/minisearch/dist/es/index.js');
  const mod = await import(pathToFileURL(fallback).href);
  MiniSearch = mod.default ?? mod;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const MAX_CHUNKS_TOTAL = 50000;
const MAX_SOURCE_LINES = 500;
const MAX_FILE_BYTES = 1024 * 1024; // 1MB

// Keep in sync with packages/dashboard/src/api/handlers/source-index.ts
const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.pdf', '.zip', '.jar',
  '.class', '.woff', '.woff2', '.ttf', '.eot', '.sqlite', '.db', '.exe',
  '.dll', '.so', '.dylib', '.bin', '.dat', '.pyc', '.aar',
]);

const MINI_SEARCH_OPTIONS = {
  fields: ['content', 'name', 'filePath'],
  storeFields: ['filePath', 'startLine', 'endLine', 'chunkType', 'name'],
  tokenize: (text) => text.toLowerCase().split(/[\s\W]+/).filter((t) => t.length >= 2),
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function shouldSkipFile(filePath) {
  const normalized = filePath.replace(/\\/g, '/').toLowerCase();
  if (
    normalized.includes('node_modules/') ||
    normalized.includes('/.git/') ||
    normalized.startsWith('.git/') ||
    normalized.includes('/build/') ||
    normalized.includes('/dist/')
  ) return true;
  if (normalized.endsWith('.min.js')) return true;
  return BINARY_EXTENSIONS.has(extname(normalized).toLowerCase());
}

const fileLineCache = new Map();

function getFileLines(projectRoot, filePath) {
  if (fileLineCache.has(filePath)) return fileLineCache.get(filePath);

  const absPath = resolve(projectRoot, filePath);
  if (!absPath.startsWith(projectRoot + '/') && absPath !== projectRoot) {
    fileLineCache.set(filePath, null);
    return null;
  }
  if (!existsSync(absPath)) { fileLineCache.set(filePath, null); return null; }
  try {
    const realPath = realpathSync(absPath);
    if (!realPath.startsWith(projectRoot + '/') && realPath !== projectRoot) {
      fileLineCache.set(filePath, null);
      return null;
    }
    const stat = statSync(absPath);
    if (stat.size > MAX_FILE_BYTES || !stat.isFile()) { fileLineCache.set(filePath, null); return null; }
    const content = readFileSync(absPath, 'utf-8');
    if (content.includes('\0')) { fileLineCache.set(filePath, null); return null; }
    const lines = content.split('\n');
    fileLineCache.set(filePath, lines);
    return lines;
  } catch {
    fileLineCache.set(filePath, null);
    return null;
  }
}

function readFileRange(projectRoot, filePath, startLine, endLine) {
  const lines = getFileLines(projectRoot, filePath);
  if (!lines) return null;
  const start = Math.max(0, startLine - 1);
  const end = Math.min(lines.length, endLine);
  return lines.slice(start, end).join('\n');
}

function splitLargeRange(startLine, endLine) {
  const ranges = [];
  let start = startLine;
  while (start <= endLine) {
    const end = Math.min(start + MAX_SOURCE_LINES - 1, endLine);
    ranges.push([start, end]);
    start = end + 1;
  }
  return ranges;
}

function buildChunksForFile(service, projectRoot, filePath, fileData) {
  const functions = Array.isArray(fileData.functions) ? fileData.functions : [];
  const classes = Array.isArray(fileData.classes) ? fileData.classes : [];

  const boundaries = [
    ...functions.map((fn) => ({
      startLine: fn.startLine,
      endLine: fn.endLine,
      chunkType: 'function',
      name: fn.name,
    })),
    ...classes.map((cls) => ({
      startLine: cls.startLine,
      endLine: cls.endLine,
      chunkType: 'class',
      name: cls.name,
    })),
  ].sort((a, b) => a.startLine - b.startLine || a.endLine - b.endLine);

  const segments = [];

  if (boundaries.length === 0) {
    const totalLines = fileData.totalLines > 0 ? fileData.totalLines : MAX_SOURCE_LINES;
    segments.push({ startLine: 1, endLine: totalLines, chunkType: 'file', name: basename(filePath) });
  } else {
    if (boundaries[0].startLine > 1) {
      segments.push({ startLine: 1, endLine: boundaries[0].startLine - 1, chunkType: 'header', name: 'header' });
    }
    for (let i = 0; i < boundaries.length; i++) {
      const b = boundaries[i];
      segments.push({ startLine: b.startLine, endLine: b.endLine, chunkType: b.chunkType, name: b.name });
      if (i < boundaries.length - 1) {
        const next = boundaries[i + 1];
        const gapStart = b.endLine + 1;
        const gapEnd = next.startLine - 1;
        if (gapStart <= gapEnd) {
          segments.push({ startLine: gapStart, endLine: gapEnd, chunkType: 'gap', name: 'gap' });
        }
      }
    }
    const lastEnd = boundaries[boundaries.length - 1].endLine;
    const totalLines = fileData.totalLines > lastEnd ? fileData.totalLines : lastEnd;
    if (lastEnd < totalLines) {
      segments.push({ startLine: lastEnd + 1, endLine: totalLines, chunkType: 'gap', name: 'gap' });
    }
  }

  const chunks = [];
  for (const seg of segments) {
    for (const [start, end] of splitLargeRange(seg.startLine, seg.endLine)) {
      const content = readFileRange(projectRoot, filePath, start, end);
      if (content === null || content.trim().length === 0) continue;
      const id = `${service}::${filePath}::${seg.chunkType}::${seg.name}::${start}`;
      chunks.push({ id, filePath, startLine: start, endLine: end, content, chunkType: seg.chunkType, name: seg.name, service });
    }
  }
  return chunks;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function main() {
  const [,, projectRoot] = process.argv;
  if (!projectRoot) {
    process.stderr.write('Usage: node build-source-index.mjs <projectRoot>\n');
    process.exit(1);
  }

  const resolvedRoot = resolve(projectRoot);
  const analysisPath = join(resolvedRoot, '.understand-anything', 'intermediate', 'extraction', 'structural-analysis.json');
  const outputPath = join(resolvedRoot, '.understand-anything', 'intermediate', 'extraction', 'source-index.json');

  if (!existsSync(analysisPath)) {
    process.stderr.write(`Error: structural-analysis.json not found at ${analysisPath}\n`);
    process.stderr.write('Run /understand first to generate structural analysis.\n');
    process.exit(1);
  }

  process.stderr.write(`[source-index] Loading structural analysis from ${analysisPath}\n`);
  const analysis = JSON.parse(readFileSync(analysisPath, 'utf-8'));
  const filePaths = Object.keys(analysis).filter((fp) => !shouldSkipFile(fp));
  process.stderr.write(`[source-index] ${filePaths.length} files to index (after filtering)\n`);

  const service = basename(resolvedRoot);
  const miniSearch = new MiniSearch(MINI_SEARCH_OPTIONS);
  let totalChunks = 0;
  let filesProcessed = 0;

  for (const filePath of filePaths) {
    if (totalChunks >= MAX_CHUNKS_TOTAL) {
      process.stderr.write(`[source-index] Reached chunk limit (${MAX_CHUNKS_TOTAL}), stopping.\n`);
      break;
    }
    const chunks = buildChunksForFile(service, resolvedRoot, filePath, analysis[filePath]);
    for (const chunk of chunks) {
      if (totalChunks >= MAX_CHUNKS_TOTAL) break;
      miniSearch.add(chunk);
      totalChunks++;
    }
    fileLineCache.delete(filePath);
    filesProcessed++;
  }

  process.stderr.write(`[source-index] Built index: ${filesProcessed} files, ${totalChunks} chunks\n`);

  const serialized = JSON.stringify(miniSearch.toJSON());
  writeFileSync(outputPath, serialized);
  const sizeMB = (Buffer.byteLength(serialized) / 1024 / 1024).toFixed(2);
  process.stderr.write(`[source-index] Serialized to ${outputPath} (${sizeMB} MB)\n`);
  process.stdout.write(`Source index built: ${filesProcessed} files, ${totalChunks} chunks, ${sizeMB} MB\n`);
}

main();
