import MiniSearch from "minisearch"
import fs from "fs"
import path from "path"
import { readSource, MAX_SOURCE_LINES } from "../../../source-reader"
import type { StructuralAnalysis } from "./structure-index"

export interface SourceChunk {
  id: string
  filePath: string
  startLine: number
  endLine: number
  content: string
  chunkType: "function" | "class" | "header" | "gap" | "file"
  name: string
  service: string
}

export interface SourceSearchResult {
  file: string
  startLine: number
  endLine: number
  snippet: string
  score: number
  chunkType?: string
  name?: string
}

const MAX_CHUNKS_TOTAL = 50000
const SNIPPET_MAX_LEN = 300

const MINI_SEARCH_OPTIONS = {
  fields: ["content", "name", "filePath"],
  storeFields: ["filePath", "startLine", "endLine", "chunkType", "name"],
  tokenize: (text: string) => text.toLowerCase().split(/[\s\W]+/).filter((t: string) => t.length >= 2),
}

// Keep in sync with build-source-index.mjs BINARY_EXTENSIONS
const BINARY_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".pdf", ".zip", ".jar",
  ".class", ".woff", ".woff2", ".ttf", ".eot", ".sqlite", ".db", ".exe",
  ".dll", ".so", ".dylib", ".bin", ".dat", ".pyc", ".aar",
])

interface Boundary {
  startLine: number
  endLine: number
  chunkType: "function" | "class"
  name: string
}

export function shouldSkipFile(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, "/").toLowerCase()
  if (
    normalized.includes("node_modules/") ||
    normalized.includes("/.git/") ||
    normalized.startsWith(".git/") ||
    normalized.includes("/build/") ||
    normalized.includes("/dist/")
  ) {
    return true
  }
  if (normalized.endsWith(".min.js")) return true
  const ext = path.extname(normalized).toLowerCase()
  return BINARY_EXTENSIONS.has(ext)
}

const MAX_PATTERN_LENGTH = 200

function matchPathPattern(filePath: string, pattern: string): boolean {
  if (pattern.length > MAX_PATTERN_LENGTH) return false
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*+/g, ".*")
    .replace(/\?/g, ".")
  const re = new RegExp(escaped, "i")
  return re.test(filePath)
}

function splitLargeRange(startLine: number, endLine: number): Array<[number, number]> {
  const ranges: Array<[number, number]> = []
  let start = startLine
  while (start <= endLine) {
    const end = Math.min(start + MAX_SOURCE_LINES - 1, endLine)
    ranges.push([start, end])
    start = end + 1
  }
  return ranges
}

function readChunkContent(
  projectRoot: string,
  filePath: string,
  startLine: number,
  endLine: number,
): string | null {
  const result = readSource({
    projectRoot,
    filePath,
    startLine: String(startLine),
    endLine: String(endLine),
  })
  if (result.statusCode !== 200 || !("content" in result.payload)) return null
  return result.payload.content
}

function readSnippet(
  projectRoot: string,
  filePath: string,
  startLine: number,
  endLine: number,
): string {
  const lineCount = endLine - startLine + 1
  const snippetEnd = Math.min(startLine + Math.min(lineCount, 15) - 1, endLine)
  const content = readChunkContent(projectRoot, filePath, startLine, snippetEnd)
  if (!content) return ""
  const trimmed = content.trim()
  if (trimmed.length <= SNIPPET_MAX_LEN) return trimmed
  return trimmed.slice(0, SNIPPET_MAX_LEN) + "…"
}

export function buildChunksForFile(
  service: string,
  projectRoot: string,
  filePath: string,
  fileData: StructuralAnalysis[string],
): SourceChunk[] {
  const functions = Array.isArray(fileData.functions) ? fileData.functions : []
  const classes = Array.isArray(fileData.classes) ? fileData.classes : []

  const boundaries: Boundary[] = [
    ...functions.map((fn) => ({
      startLine: fn.startLine,
      endLine: fn.endLine,
      chunkType: "function" as const,
      name: fn.name,
    })),
    ...classes.map((cls) => ({
      startLine: cls.startLine,
      endLine: cls.endLine,
      chunkType: "class" as const,
      name: cls.name,
    })),
  ].sort((a, b) => a.startLine - b.startLine || a.endLine - b.endLine)

  const segments: Array<{
    startLine: number
    endLine: number
    chunkType: SourceChunk["chunkType"]
    name: string
  }> = []

  if (boundaries.length === 0) {
    const totalLines = fileData.totalLines > 0 ? fileData.totalLines : MAX_SOURCE_LINES
    segments.push({ startLine: 1, endLine: totalLines, chunkType: "file", name: path.basename(filePath) })
  } else {
    if (boundaries[0].startLine > 1) {
      segments.push({
        startLine: 1,
        endLine: boundaries[0].startLine - 1,
        chunkType: "header",
        name: "header",
      })
    }

    for (let i = 0; i < boundaries.length; i++) {
      const b = boundaries[i]
      segments.push({
        startLine: b.startLine,
        endLine: b.endLine,
        chunkType: b.chunkType,
        name: b.name,
      })
      if (i < boundaries.length - 1) {
        const next = boundaries[i + 1]
        const gapStart = b.endLine + 1
        const gapEnd = next.startLine - 1
        if (gapStart <= gapEnd) {
          segments.push({
            startLine: gapStart,
            endLine: gapEnd,
            chunkType: "gap",
            name: "gap",
          })
        }
      }
    }

    const lastEnd = boundaries[boundaries.length - 1].endLine
    const totalLines = fileData.totalLines > lastEnd ? fileData.totalLines : lastEnd
    if (lastEnd < totalLines) {
      segments.push({
        startLine: lastEnd + 1,
        endLine: totalLines,
        chunkType: "gap",
        name: "gap",
      })
    }
  }

  const chunks: SourceChunk[] = []
  for (const seg of segments) {
    for (const [start, end] of splitLargeRange(seg.startLine, seg.endLine)) {
      const content = readChunkContent(projectRoot, filePath, start, end)
      if (content === null || content.trim().length === 0) continue
      const id = `${service}::${filePath}::${seg.chunkType}::${seg.name}::${start}`
      chunks.push({
        id,
        filePath,
        startLine: start,
        endLine: end,
        content,
        chunkType: seg.chunkType,
        name: seg.name,
        service,
      })
    }
  }
  return chunks
}

export class SourceIndex {
  private miniSearch: MiniSearch
  private service: string
  private projectRoot: string
  private built = false

  constructor(service: string, projectRoot = "") {
    this.service = service
    this.projectRoot = projectRoot
    this.miniSearch = new MiniSearch(MINI_SEARCH_OPTIONS)
  }

  build(projectRoot: string, data?: StructuralAnalysis): void {
    this.projectRoot = projectRoot
    const analysis = data ?? {}
    const filePaths = Object.keys(analysis).filter((fp) => !shouldSkipFile(fp))

    const allChunks: SourceChunk[] = []
    for (const filePath of filePaths) {
      if (allChunks.length >= MAX_CHUNKS_TOTAL) break
      const fileChunks = buildChunksForFile(this.service, projectRoot, filePath, analysis[filePath])
      for (const chunk of fileChunks) {
        if (allChunks.length >= MAX_CHUNKS_TOTAL) break
        allChunks.push(chunk)
      }
    }

    if (allChunks.length > 0) {
      this.miniSearch.addAll(allChunks)
    }
    this.built = true
  }

  toJSON(): string {
    return JSON.stringify(this.miniSearch.toJSON())
  }

  static loadFromJSON(service: string, projectRoot: string, jsonStr: string): SourceIndex {
    const idx = new SourceIndex(service, projectRoot)
    idx.miniSearch = MiniSearch.loadJSON(jsonStr, MINI_SEARCH_OPTIONS)
    idx.built = true
    return idx
  }

  search(query: string, opts?: { path?: string; limit?: number }): SourceSearchResult[] {
    if (!this.built) return []
    const limit = opts?.limit ?? 20
    const pathPattern = opts?.path

    const results = this.miniSearch.search(query, {
      prefix: true,
      fuzzy: 0.15,
      filter: pathPattern
        ? (doc) => matchPathPattern(doc.filePath as string, pathPattern)
        : undefined,
    })

    return results.slice(0, limit).map((r) => ({
      file: r.filePath as string,
      startLine: r.startLine as number,
      endLine: r.endLine as number,
      snippet: readSnippet(this.projectRoot, r.filePath as string, r.startLine as number, r.endLine as number),
      score: r.score,
      chunkType: r.chunkType as string | undefined,
      name: r.name as string | undefined,
    }))
  }
}

const MAX_CACHE_ENTRIES = 3
const indexCache = new Map<string, SourceIndex>()

function evictOldestCacheEntry(): void {
  if (indexCache.size >= MAX_CACHE_ENTRIES) {
    const oldest = indexCache.keys().next().value
    if (oldest) indexCache.delete(oldest)
  }
}

export function clearSourceIndexCache(): void {
  indexCache.clear()
}

const MAX_INDEX_FILE_BYTES = 64 * 1024 * 1024 // 64MB

export function getOrBuildSourceIndex(
  service: string,
  projectRoot: string,
  data: StructuralAnalysis | null,
): SourceIndex {
  const cacheKey = `${service}::${projectRoot}`
  let index = indexCache.get(cacheKey)
  if (index) return index

  const extractionDir = path.join(projectRoot, ".understand-anything", "intermediate", "extraction")
  const serializedPath = path.join(extractionDir, "source-index.json")
  const analysisPath = path.join(extractionDir, "structural-analysis.json")

  if (fs.existsSync(serializedPath)) {
    try {
      const stat = fs.statSync(serializedPath)
      if (stat.size > MAX_INDEX_FILE_BYTES) {
        console.warn(`[source-index] ${service}: index file exceeds ${MAX_INDEX_FILE_BYTES / 1024 / 1024}MB, skipping load`)
      } else {
        const analysisStat = fs.existsSync(analysisPath) ? fs.statSync(analysisPath) : null
        const isStale = analysisStat && analysisStat.mtimeMs > stat.mtimeMs
        if (!isStale) {
          evictOldestCacheEntry()
          const jsonStr = fs.readFileSync(serializedPath, "utf-8")
          index = SourceIndex.loadFromJSON(service, projectRoot, jsonStr)
          indexCache.set(cacheKey, index)
          return index
        }
        console.warn(`[source-index] ${service}: pre-built index is stale, rebuilding`)
      }
    } catch (e) {
      console.warn(`[source-index] ${service}: failed to load pre-built index, rebuilding`, e)
    }
  }

  evictOldestCacheEntry()
  index = new SourceIndex(service, projectRoot)
  index.build(projectRoot, data ?? {})
  indexCache.set(cacheKey, index)
  return index
}
