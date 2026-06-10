import path from "path"
import fs from "fs"
import { graphFileCandidates } from "./utils"
import type { SystemGraph } from "@understand-anything/core"
import type { ApiResponse } from "./types"

let cachedSystemGraph: SystemGraph | null = null
let systemGraphMtime = 0

export function loadSystemGraph(): SystemGraph | null {
  const sgCandidates = graphFileCandidates("system-graph.json")
  for (const candidate of sgCandidates) {
    if (!fs.existsSync(candidate)) continue
    try {
      const mtime = fs.statSync(candidate).mtimeMs
      if (!cachedSystemGraph || mtime !== systemGraphMtime) {
        cachedSystemGraph = JSON.parse(fs.readFileSync(candidate, "utf-8")) as SystemGraph
        systemGraphMtime = mtime
      }
      return cachedSystemGraph
    } catch {
      return null
    }
  }
  return null
}

export function resolveServiceBasePath(serviceName: string): string | null {
  const sg = loadSystemGraph()
  return sg?.serviceIndex?.[serviceName]?.basePath ?? null
}

export function resolveServiceDataPath(serviceName: string, relativePath: string): string | null {
  const candidates: string[] = []
  const graphDir = process.env.GRAPH_DIR
  const basePath = resolveServiceBasePath(serviceName)

  if (basePath) {
    if (graphDir) candidates.push(path.resolve(graphDir, basePath, ".understand-anything", relativePath))
    candidates.push(path.resolve(process.cwd(), basePath, ".understand-anything", relativePath))
  }
  if (!serviceName.includes("/")) {
    if (graphDir) candidates.push(path.resolve(graphDir, serviceName, ".understand-anything", relativePath))
    candidates.push(path.resolve(process.cwd(), serviceName, ".understand-anything", relativePath))
    candidates.push(path.resolve(process.cwd(), "../../..", serviceName, ".understand-anything", relativePath))
  }

  for (const c of candidates) {
    if (fs.existsSync(c)) return c
  }
  return null
}

export function listServiceNames(serviceFilter: string | null): string[] {
  if (serviceFilter) return [serviceFilter]
  const sg = loadSystemGraph()
  if (!sg?.serviceIndex) return []
  return Object.keys(sg.serviceIndex)
}

export function validateServiceName(serviceName: string | null): ApiResponse | null {
  if (!serviceName) return null
  if (serviceName.includes("\\") || serviceName.includes("..") || serviceName.includes("\0")) {
    return { statusCode: 400, body: { error: "invalid service name", code: "INVALID_SERVICE_NAME" } }
  }
  return null
}

export function validateServiceNameRequired(serviceName: string | null): ApiResponse | null {
  if (!serviceName) return { statusCode: 400, body: { error: "service parameter required", code: "SERVICE_REQUIRED" } }
  return validateServiceName(serviceName)
}

export function isApiResponse(value: unknown): value is ApiResponse {
  return typeof value === "object" && value !== null && "statusCode" in value && "body" in value
}
