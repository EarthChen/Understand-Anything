import path from "path"
import fs from "fs"

export function graphFileCandidates(fileName: string): string[] {
  const graphDir = process.env.GRAPH_DIR
  return [
    ...(graphDir
      ? [path.resolve(graphDir, `.understand-anything/${fileName}`)]
      : []),
    path.resolve(process.cwd(), `.understand-anything/${fileName}`),
    path.resolve(process.cwd(), `../../../.understand-anything/${fileName}`),
  ]
}

export function findGraphFile(fileName: string): string | null {
  return graphFileCandidates(fileName).find((c) => fs.existsSync(c)) ?? null
}

export function projectRootFromGraphFile(candidate: string): string {
  return path.dirname(path.dirname(candidate))
}

export function normalizeGraphPath(filePath: string, projectRoot: string): string | null {
  const rawPath = path.isAbsolute(filePath)
    ? filePath.startsWith(projectRoot)
      ? path.relative(projectRoot, filePath)
      : path.basename(filePath)
    : filePath
  if (rawPath === null) return null
  const normalized = path.normalize(rawPath)
  if (
    !normalized ||
    normalized === "." ||
    normalized.includes("\0") ||
    normalized === ".." ||
    normalized.startsWith(`..${path.sep}`) ||
    path.isAbsolute(normalized)
  ) {
    return null
  }
  return normalized.split(path.sep).join("/")
}

export function graphFilePathSet(graphFile: string, projectRoot: string): Set<string> {
  const allowed = new Set<string>()
  try {
    const raw = JSON.parse(fs.readFileSync(graphFile, "utf-8")) as {
      nodes?: Array<Record<string, unknown>>
    }
    for (const node of raw.nodes ?? []) {
      if (typeof node.filePath !== "string") continue
      const normalized = normalizeGraphPath(node.filePath, projectRoot)
      if (normalized) allowed.add(normalized)
    }
  } catch {
    return allowed
  }
  return allowed
}

export function resolveProjectRoot(): string {
  const graphFile = findGraphFile("knowledge-graph.json")
  return graphFile ? projectRootFromGraphFile(graphFile) : process.env.GRAPH_DIR ?? process.cwd()
}

export function businessLandscapeDir(projectRoot?: string): string {
  const root = projectRoot ?? resolveProjectRoot()
  return path.join(root, ".understand-anything", "business-landscape")
}

export function readJsonFile<T>(filePath: string): T | null {
  try {
    if (!fs.existsSync(filePath)) return null
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T
  } catch {
    return null
  }
}

/**
 * Merge a parsed JSON POST body into a URLSearchParams so handlers (which read
 * from searchParams) transparently support POST. Body values override query
 * params on key conflict; null/undefined are skipped; non-object bodies no-op.
 */
export function mergePostBody(searchParams: URLSearchParams, body: unknown): void {
  if (!body || typeof body !== "object") return
  for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
    if (value !== null && value !== undefined) {
      searchParams.set(key, String(value))
    }
  }
}
