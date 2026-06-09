import path from "path"
import fs from "fs"
import type { ApiRequest, ApiContext, ApiResponse } from "../types"
import { graphFileCandidates, readJsonFile } from "../utils"
import type {
  KnowledgeGraph,
  GraphNode,
  GraphEdge,
  TourStep,
  SystemGraph,
} from "@understand-anything/core"

type GraphKind = "kg" | "domain"
type NeighborDirection = "inbound" | "outbound" | "both"

let cachedSystemGraph: SystemGraph | null = null
let systemGraphMtime = 0

function resolveServiceBasePath(serviceName: string): string | null {
  const sgCandidates = graphFileCandidates("system-graph.json")
  for (const candidate of sgCandidates) {
    if (!fs.existsSync(candidate)) continue
    try {
      const mtime = fs.statSync(candidate).mtimeMs
      if (!cachedSystemGraph || mtime !== systemGraphMtime) {
        cachedSystemGraph = JSON.parse(fs.readFileSync(candidate, "utf-8")) as SystemGraph
        systemGraphMtime = mtime
      }
      const entry = cachedSystemGraph.serviceIndex?.[serviceName]
      if (entry?.basePath) return entry.basePath
    } catch {
      // fall through
    }
    break
  }
  return null
}

function graphFileName(kind: GraphKind): string {
  return kind === "kg" ? "knowledge-graph.json" : "domain-graph.json"
}

function resolveServiceGraphPath(serviceName: string, kind: GraphKind): string | null {
  const fileName = graphFileName(kind)
  const graphDir = process.env.GRAPH_DIR
  const candidates: string[] = []

  const resolvedBasePath = resolveServiceBasePath(serviceName)
  if (resolvedBasePath) {
    if (graphDir) candidates.push(path.resolve(graphDir, resolvedBasePath, ".understand-anything", fileName))
    candidates.push(path.resolve(process.cwd(), resolvedBasePath, ".understand-anything", fileName))
  }

  if (!serviceName.includes("/")) {
    if (graphDir) candidates.push(path.resolve(graphDir, serviceName, ".understand-anything", fileName))
    candidates.push(path.resolve(process.cwd(), serviceName, ".understand-anything", fileName))
    candidates.push(path.resolve(process.cwd(), "../../..", serviceName, ".understand-anything", fileName))
  }

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate
  }
  return null
}

function loadServiceGraph(serviceName: string, kind: GraphKind): KnowledgeGraph | ApiResponse {
  const graphPath = resolveServiceGraphPath(serviceName, kind)
  if (!graphPath) {
    return {
      statusCode: 404,
      body: { error: `${graphFileName(kind)} not found for service ${serviceName}` },
    }
  }
  const graph = readJsonFile<KnowledgeGraph>(graphPath)
  if (!graph) {
    return { statusCode: 500, body: { error: "Failed to read graph file" } }
  }
  return graph
}

function validateServiceName(serviceName: string | null): ApiResponse | null {
  if (!serviceName) return { statusCode: 400, body: { error: "service parameter required" } }
  if (serviceName.includes("\\") || serviceName.includes("..")) {
    return { statusCode: 400, body: { error: "invalid service name" } }
  }
  return null
}

function parseGraphKind(graph: string | null): GraphKind | ApiResponse {
  if (!graph) return { statusCode: 400, body: { error: "graph parameter required" } }
  if (graph !== "kg" && graph !== "domain") {
    return { statusCode: 400, body: { error: "invalid graph value" } }
  }
  return graph
}

function isApiResponse(value: unknown): value is ApiResponse {
  return typeof value === "object" && value !== null && "statusCode" in value && "body" in value
}

function findNodeByIdOrName(graph: KnowledgeGraph, nodeRef: string): GraphNode | null {
  const byId = graph.nodes.find((n) => n.id === nodeRef)
  if (byId) return byId
  return graph.nodes.find((n) => n.name === nodeRef) ?? null
}

function resolveNodeId(graph: KnowledgeGraph, nodeRef: string): string | null {
  return findNodeByIdOrName(graph, nodeRef)?.id ?? null
}

function parseDirection(value: string | null): NeighborDirection | ApiResponse {
  const direction = value ?? "both"
  if (direction !== "inbound" && direction !== "outbound" && direction !== "both") {
    return { statusCode: 400, body: { error: "invalid direction value" } }
  }
  return direction
}

function parseDepth(value: string | null): number | ApiResponse {
  const depth = value === null ? 1 : Number.parseInt(value, 10)
  if (!Number.isFinite(depth) || depth < 1 || depth > 3) {
    return { statusCode: 400, body: { error: "depth must be between 1 and 3" } }
  }
  return depth
}

function parseLimit(value: string | null): number | ApiResponse {
  const limit = value === null ? 50 : Number.parseInt(value, 10)
  if (!Number.isFinite(limit) || limit < 1 || limit > 200) {
    return { statusCode: 400, body: { error: "limit must be between 1 and 200" } }
  }
  return limit
}

function parseOffset(value: string | null): number | ApiResponse {
  const offset = value === null ? 0 : Number.parseInt(value, 10)
  if (!Number.isFinite(offset) || offset < 0) {
    return { statusCode: 400, body: { error: "offset must be a non-negative integer" } }
  }
  return offset
}

function traverseNeighbors(
  graph: KnowledgeGraph,
  centerId: string,
  direction: NeighborDirection,
  edgeType: string | undefined,
  maxDepth: number,
): Array<{ node: GraphNode; edge: GraphEdge; direction: "inbound" | "outbound"; depth: number }> {
  const nodesById = new Map(graph.nodes.map((n) => [n.id, n]))
  const results: Array<{
    node: GraphNode
    edge: GraphEdge
    direction: "inbound" | "outbound"
    depth: number
  }> = []
  const expanded = new Set<string>()
  let frontier = [centerId]

  for (let depth = 1; depth <= maxDepth; depth++) {
    const nextFrontier: string[] = []
    for (const currentId of frontier) {
      for (const edge of graph.edges) {
        if (edgeType && edge.type !== edgeType) continue

        let neighborId: string | null = null
        let edgeDirection: "inbound" | "outbound" | null = null

        if (edge.source === currentId) {
          if (direction === "inbound") continue
          neighborId = edge.target
          edgeDirection = "outbound"
        } else if (edge.target === currentId) {
          if (direction === "outbound") continue
          neighborId = edge.source
          edgeDirection = "inbound"
        } else {
          continue
        }

        if (!neighborId || neighborId === centerId) continue
        const neighbor = nodesById.get(neighborId)
        if (!neighbor || !edgeDirection) continue

        results.push({ node: neighbor, edge, direction: edgeDirection, depth })

        if (!expanded.has(neighborId)) {
          expanded.add(neighborId)
          nextFrontier.push(neighborId)
        }
      }
    }
    frontier = nextFrontier
  }

  return results
}

function handleNeighbors(searchParams: URLSearchParams): ApiResponse {
  const serviceErr = validateServiceName(searchParams.get("service"))
  if (serviceErr) return serviceErr

  const graphKind = parseGraphKind(searchParams.get("graph"))
  if (isApiResponse(graphKind)) return graphKind

  const nodeRef = searchParams.get("node")
  if (!nodeRef) return { statusCode: 400, body: { error: "node parameter required" } }

  const direction = parseDirection(searchParams.get("direction"))
  if (isApiResponse(direction)) return direction

  const depth = parseDepth(searchParams.get("depth"))
  if (isApiResponse(depth)) return depth

  const serviceName = searchParams.get("service")!
  const loaded = loadServiceGraph(serviceName, graphKind)
  if (isApiResponse(loaded)) return loaded

  const center = findNodeByIdOrName(loaded, nodeRef)
  if (!center) return { statusCode: 404, body: { error: "node not found" } }

  const edgeType = searchParams.get("edgeType") ?? undefined
  const neighbors = traverseNeighbors(loaded, center.id, direction, edgeType, depth)

  return {
    statusCode: 200,
    body: {
      center,
      neighbors,
      totalEdges: neighbors.length,
    },
  }
}

function handleEdges(searchParams: URLSearchParams): ApiResponse {
  const serviceErr = validateServiceName(searchParams.get("service"))
  if (serviceErr) return serviceErr

  const graphKind = parseGraphKind(searchParams.get("graph"))
  if (isApiResponse(graphKind)) return graphKind

  const limit = parseLimit(searchParams.get("limit"))
  if (isApiResponse(limit)) return limit

  const offset = parseOffset(searchParams.get("offset"))
  if (isApiResponse(offset)) return offset

  const serviceName = searchParams.get("service")!
  const loaded = loadServiceGraph(serviceName, graphKind)
  if (isApiResponse(loaded)) return loaded

  const nodesById = new Map(loaded.nodes.map((n) => [n.id, n]))
  const typeFilter = searchParams.get("type") ?? undefined
  const sourceRef = searchParams.get("source")
  const targetRef = searchParams.get("target")

  let sourceId: string | null = null
  if (sourceRef) {
    sourceId = resolveNodeId(loaded, sourceRef)
    if (!sourceId) return { statusCode: 404, body: { error: "source node not found" } }
  }

  let targetId: string | null = null
  if (targetRef) {
    targetId = resolveNodeId(loaded, targetRef)
    if (!targetId) return { statusCode: 404, body: { error: "target node not found" } }
  }

  const filtered = loaded.edges.filter((edge) => {
    if (typeFilter && edge.type !== typeFilter) return false
    if (sourceId && edge.source !== sourceId) return false
    if (targetId && edge.target !== targetId) return false
    return true
  })

  const total = filtered.length
  const page = filtered.slice(offset, offset + limit)

  const edges = page.flatMap((edge) => {
    const sourceNode = nodesById.get(edge.source)
    const targetNode = nodesById.get(edge.target)
    if (!sourceNode || !targetNode) return []
    return [
      {
        ...edge,
        sourceNode: { id: sourceNode.id, name: sourceNode.name, type: sourceNode.type },
        targetNode: { id: targetNode.id, name: targetNode.name, type: targetNode.type },
      },
    ]
  })

  return {
    statusCode: 200,
    body: {
      edges,
      total,
      hasMore: offset + limit < total,
    },
  }
}

function handleLayers(searchParams: URLSearchParams): ApiResponse {
  const serviceErr = validateServiceName(searchParams.get("service"))
  if (serviceErr) return serviceErr

  const serviceName = searchParams.get("service")!
  const loaded = loadServiceGraph(serviceName, "kg")
  if (isApiResponse(loaded)) return loaded

  const layers = (loaded.layers ?? []).map((layer) => ({
    id: layer.id,
    name: layer.name,
    description: layer.description,
    nodeCount: layer.nodeIds.length,
  }))

  return { statusCode: 200, body: { layers } }
}

function handleTour(searchParams: URLSearchParams): ApiResponse {
  const serviceErr = validateServiceName(searchParams.get("service"))
  if (serviceErr) return serviceErr

  const serviceName = searchParams.get("service")!
  const loaded = loadServiceGraph(serviceName, "kg")
  if (isApiResponse(loaded)) return loaded

  const steps: TourStep[] = loaded.tour ?? []
  return { statusCode: 200, body: { steps } }
}

export async function handleGraphQueryRequest(
  req: ApiRequest,
  _ctx: ApiContext,
): Promise<ApiResponse | null> {
  const { pathname, searchParams } = req

  switch (pathname) {
    case "/api/graph-query/neighbors":
      return handleNeighbors(searchParams)
    case "/api/graph-query/edges":
      return handleEdges(searchParams)
    case "/api/graph-query/layers":
      return handleLayers(searchParams)
    case "/api/graph-query/tour":
      return handleTour(searchParams)
    default:
      return null
  }
}
