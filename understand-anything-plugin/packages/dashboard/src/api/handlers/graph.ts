import path from "path"
import fs from "fs"
import { execSync } from "child_process"
import type { ApiRequest, ApiContext, ApiResponse } from "../types"
import { graphFileCandidates, projectRootFromGraphFile, readJsonFile, resolveProjectRoot } from "../utils"
import { resolveServiceBasePath } from "../service-resolver"

const STATIC_GRAPH_PATHS = new Set([
  "/knowledge-graph.json",
  "/domain-graph.json",
  "/system-graph.json",
  "/diff-overlay.json",
  "/meta.json",
  "/config.json",
])

function sanitiseKgNodes(raw: Record<string, unknown>, projectRoot: string): void {
  if (!Array.isArray(raw.nodes)) return
  raw.nodes = raw.nodes.map((node) => {
    if (typeof node !== "object" || node === null) return node
    const n = node as Record<string, unknown>
    if (typeof n.filePath !== "string") return node
    const abs = n.filePath
    const rel = abs.startsWith(projectRoot)
      ? abs.slice(projectRoot.length).replace(/^[\\/]/, "")
      : path.isAbsolute(abs)
        ? path.basename(abs)
        : abs
    return { ...n, filePath: rel }
  })
}

export async function handleGraphRequest(
  req: ApiRequest,
  _ctx: ApiContext,
): Promise<ApiResponse | null> {
  const { pathname, searchParams } = req

  if (pathname === "/api/graph") {
    const serviceName = searchParams.get("service")
    const fileName = searchParams.get("file") || "knowledge-graph.json"
    if (!serviceName) return { statusCode: 400, body: { error: "service parameter required", code: "SERVICE_REQUIRED" } }
    if (serviceName.includes("\\") || serviceName.includes("..")) {
      return { statusCode: 400, body: { error: "invalid service name", code: "INVALID_SERVICE_NAME" } }
    }
    const allowedFiles = ["knowledge-graph.json", "domain-graph.json", "meta.json", "config.json"]
    if (!allowedFiles.includes(fileName)) {
      return { statusCode: 400, body: { error: "file not allowed" } }
    }
    const graphDir = process.env.GRAPH_DIR
    const candidates: string[] = []

    // Try basePath from system-graph serviceIndex first (supports nested facet layout)
    const resolvedBasePath = resolveServiceBasePath(serviceName)
    if (resolvedBasePath) {
      if (graphDir) candidates.push(path.resolve(graphDir, resolvedBasePath, ".understand-anything", fileName))
      candidates.push(path.resolve(process.cwd(), resolvedBasePath, ".understand-anything", fileName))
    }

    // Flat layout fallback (service is direct child of project root)
    if (!serviceName.includes("/")) {
      if (graphDir) candidates.push(path.resolve(graphDir, serviceName, ".understand-anything", fileName))
      candidates.push(path.resolve(process.cwd(), serviceName, ".understand-anything", fileName))
      candidates.push(path.resolve(process.cwd(), "../../..", serviceName, ".understand-anything", fileName))
    }

    for (const candidate of candidates) {
      if (!fs.existsSync(candidate)) continue
      try {
        const raw = JSON.parse(fs.readFileSync(candidate, "utf-8")) as Record<string, unknown>
        const nodesParam = searchParams.get("nodes")
        if (nodesParam && Array.isArray(raw.nodes)) {
          const requestedIds = new Set(nodesParam.split(",").map(id => id.trim()).filter(Boolean))
          raw.nodes = (raw.nodes as Array<Record<string, unknown>>).filter(
            (n) => requestedIds.has(n.id as string)
          )
          raw.edges = []
        }
        return { statusCode: 200, body: raw }
      } catch {
        return { statusCode: 500, body: { error: "Failed to read graph file" } }
      }
    }
    return { statusCode: 404, body: { error: `${fileName} not found for service ${serviceName}` } }
  }

  if (pathname === "/api/layers/freshness" || pathname === "/api/meta") {
    return buildMetaResponse()
  }

  if (!STATIC_GRAPH_PATHS.has(pathname)) return null

  if (pathname === "/config.json") {
    for (const candidate of graphFileCandidates("config.json")) {
      if (!fs.existsSync(candidate)) continue
      try {
        return { statusCode: 200, body: JSON.parse(fs.readFileSync(candidate, "utf-8")) }
      } catch {
        return { statusCode: 500, body: { error: "Failed to read config file" } }
      }
    }
    return { statusCode: 200, body: { autoUpdate: false, outputLanguage: "en" } }
  }

  const fileName =
    pathname === "/diff-overlay.json" ? "diff-overlay.json"
    : pathname === "/meta.json" ? "meta.json"
    : pathname === "/domain-graph.json" ? "domain-graph.json"
    : pathname === "/system-graph.json" ? "system-graph.json"
    : "knowledge-graph.json"

  for (const candidate of graphFileCandidates(fileName)) {
    if (!fs.existsSync(candidate)) continue
    try {
      const raw = JSON.parse(fs.readFileSync(candidate, "utf-8")) as Record<string, unknown>
      if (pathname !== "/system-graph.json") {
        sanitiseKgNodes(raw, projectRootFromGraphFile(candidate))
      }
      return { statusCode: 200, body: raw }
    } catch {
      return { statusCode: 500, body: { error: "Failed to read graph file" } }
    }
  }

  if (pathname === "/knowledge-graph.json") {
    return { statusCode: 404, body: { error: "No knowledge graph found. Run /understand first." } }
  }
  return { statusCode: 404, body: { error: `${fileName} not found` } }
}

function buildMetaResponse(): ApiResponse {
  const projectRoot = resolveProjectRoot()
  const uaDir = path.join(projectRoot, ".understand-anything")

  const systemGraph = readJsonFile<{ project?: { name?: string; description?: string } }>(
    path.join(uaDir, "system-graph.json"),
  )
  const config = readJsonFile<{ name?: string }>(path.join(uaDir, "config.json"))
  const project: { name: string; description?: string } = {
    name: systemGraph?.project?.name ?? config?.name ?? path.basename(projectRoot),
  }
  if (systemGraph?.project?.description) {
    project.description = systemGraph.project.description
  }

  const kgMeta = readJsonFile<{ lastAnalyzedAt?: string; gitCommitHash?: string }>(
    path.join(uaDir, "meta.json"),
  )
  const kgGraph = readJsonFile<{ nodes?: unknown[]; edges?: unknown[] }>(
    path.join(uaDir, "knowledge-graph.json"),
  )
  const domainGraph = readJsonFile<{ nodes?: unknown[]; edges?: unknown[] }>(
    path.join(uaDir, "domain-graph.json"),
  )
  const wikiMeta = readJsonFile<{
    generatedAt?: string
    serviceCount?: number
    qualityScore?: { overallGrade?: string }
  }>(path.join(uaDir, "wiki", "meta.json"))
  const blMeta = readJsonFile<{ generatedAt?: string; status?: string }>(
    path.join(uaDir, "business-landscape", "meta.json"),
  )
  const blDomains = readJsonFile<{ domains?: unknown[] }>(
    path.join(uaDir, "business-landscape", "domains.json"),
  )

  let currentCommit = ""
  const stale: string[] = []
  try {
    currentCommit = execSync("git rev-parse HEAD", { cwd: projectRoot, encoding: "utf-8" }).trim()
    if (kgMeta?.gitCommitHash && kgMeta.gitCommitHash !== currentCommit) {
      stale.push("kg", "domain")
    }
  } catch {
    // not in a git repo
  }

  return {
    statusCode: 200,
    body: {
      project,
      layers: {
        kg: {
          available: kgGraph != null || kgMeta != null,
          commit: kgMeta?.gitCommitHash,
          analyzedAt: kgMeta?.lastAnalyzedAt,
          nodeCount: kgGraph?.nodes?.length,
          edgeCount: kgGraph?.edges?.length,
        },
        domain: {
          available: domainGraph != null,
          nodeCount: domainGraph?.nodes?.length,
          edgeCount: domainGraph?.edges?.length,
        },
        wiki: {
          available: wikiMeta != null,
          qualityGrade: wikiMeta?.qualityScore?.overallGrade,
          generatedAt: wikiMeta?.generatedAt,
          serviceCount: wikiMeta?.serviceCount,
        },
        business: {
          available: blMeta != null || blDomains != null,
          status: blMeta?.status,
          domainCount: blDomains?.domains?.length,
          generatedAt: blMeta?.generatedAt,
        },
      },
      freshness: { currentCommit, stale },
    },
  }
}
