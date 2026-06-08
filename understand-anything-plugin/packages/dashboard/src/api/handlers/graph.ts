import path from "path"
import fs from "fs"
import type { ApiRequest, ApiContext, ApiResponse } from "../types"
import { graphFileCandidates, projectRootFromGraphFile } from "../utils"

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
    if (!serviceName) return { statusCode: 400, body: { error: "service parameter required" } }
    if (serviceName.includes("/") || serviceName.includes("\\") || serviceName.includes("..")) {
      return { statusCode: 400, body: { error: "invalid service name" } }
    }
    const allowedFiles = ["knowledge-graph.json", "domain-graph.json", "meta.json", "config.json"]
    if (!allowedFiles.includes(fileName)) {
      return { statusCode: 400, body: { error: "file not allowed" } }
    }
    const graphDir = process.env.GRAPH_DIR
    const candidates = [
      ...(graphDir ? [path.resolve(graphDir, serviceName, ".understand-anything", fileName)] : []),
      path.resolve(process.cwd(), serviceName, ".understand-anything", fileName),
      path.resolve(process.cwd(), "../../..", serviceName, ".understand-anything", fileName),
    ]
    for (const candidate of candidates) {
      if (!fs.existsSync(candidate)) continue
      try {
        return { statusCode: 200, body: JSON.parse(fs.readFileSync(candidate, "utf-8")) }
      } catch {
        return { statusCode: 500, body: { error: "Failed to read graph file" } }
      }
    }
    return { statusCode: 404, body: { error: `${fileName} not found for service ${serviceName}` } }
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
