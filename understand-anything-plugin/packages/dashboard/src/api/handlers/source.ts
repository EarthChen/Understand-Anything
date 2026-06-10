import fs from "fs"
import path from "path"
import type { ApiRequest, ApiContext, ApiResponse } from "../types"
import { findGraphFile, projectRootFromGraphFile, graphFilePathSet, resolveProjectRoot } from "../utils"
import { readSource } from "../../../source-reader"

function resolveServiceRoot(baseRoot: string, serviceName: string): string | null {
  const direct = path.join(baseRoot, serviceName)
  if (fs.existsSync(path.join(direct, ".understand-anything"))) return direct

  const systemGraphPath = path.join(baseRoot, ".understand-anything", "system-graph.json")
  if (fs.existsSync(systemGraphPath)) {
    try {
      const sg = JSON.parse(fs.readFileSync(systemGraphPath, "utf-8"))
      const serviceIndex: Record<string, { basePath?: string }> = sg.serviceIndex ?? {}
      const entry = serviceIndex[serviceName]
      if (entry?.basePath) {
        const resolved = path.resolve(baseRoot, entry.basePath)
        const rel = path.relative(baseRoot, resolved)
        if (rel.startsWith("..") || path.isAbsolute(rel)) {
          return null
        }
        if (fs.existsSync(path.join(resolved, ".understand-anything"))) return resolved
      }
    } catch { /* ignore parse errors */ }
  }

  return null
}

export async function handleSourceRequest(
  req: ApiRequest,
  _ctx: ApiContext,
): Promise<ApiResponse | null> {
  const { pathname, searchParams } = req

  if (pathname !== "/api/source") return null

  const file = searchParams.get("file") ?? ""
  const service = searchParams.get("service")
  const mode = searchParams.get("mode") ?? "wiki"
  const start = searchParams.get("start")
  const end = searchParams.get("end")

  let graphFile = findGraphFile("knowledge-graph.json")
  let baseRoot: string

  if (graphFile) {
    baseRoot = projectRootFromGraphFile(graphFile)
  } else {
    baseRoot = process.env.GRAPH_DIR ?? process.cwd()
  }

  let projectRoot = baseRoot
  if (service) {
    if (service.includes("\\") || service.includes("..") || service.includes("\0")) {
      return { statusCode: 400, body: { error: "invalid service name", code: "INVALID_SERVICE_NAME" } }
    }
    const serviceRoot = resolveServiceRoot(baseRoot, service)
    if (serviceRoot) {
      projectRoot = serviceRoot
      if (!graphFile) {
        const serviceGraph = path.join(serviceRoot, ".understand-anything", "knowledge-graph.json")
        if (fs.existsSync(serviceGraph)) graphFile = serviceGraph
      }
    }
  }

  if (!graphFile && mode === "graph") {
    return { statusCode: 404, body: { error: "No knowledge graph found" } }
  }

  let kgAllowlist: Set<string> | undefined
  if (mode === "graph") {
    const kgPath = path.join(projectRoot, ".understand-anything", "knowledge-graph.json")
    if (fs.existsSync(kgPath)) {
      kgAllowlist = graphFilePathSet(kgPath, projectRoot)
    }
  }

  const result = readSource({
    projectRoot,
    filePath: file,
    startLine: start,
    endLine: end,
    kgAllowlist,
  })
  return { statusCode: result.statusCode, body: result.payload }
}
