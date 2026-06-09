import { describe, it, expect, beforeEach, afterEach } from "vitest"
import fs from "fs"
import path from "path"
import os from "os"
import { handleGraphQueryRequest } from "../api/handlers/graph-query"
import type { ApiContext } from "../api/types"

const ctx = { getWikiService: () => { throw new Error("unused") } } as unknown as ApiContext

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "api-graph-query-"))
}

function writeJson(filePath: string, data: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, JSON.stringify(data))
}

function makeGraph() {
  return {
    version: "1.0.0",
    project: {
      name: "test",
      languages: ["typescript"],
      frameworks: [],
      description: "test graph",
      analyzedAt: "2026-06-01T00:00:00Z",
      gitCommitHash: "abc123",
    },
    nodes: [
      { id: "a", type: "file", name: "Alpha", summary: "", tags: [], complexity: "simple" },
      { id: "b", type: "file", name: "Beta", summary: "", tags: [], complexity: "simple" },
      { id: "c", type: "file", name: "Gamma", summary: "", tags: [], complexity: "simple" },
    ],
    edges: [
      { source: "a", target: "b", type: "calls", direction: "forward", weight: 1 },
      { source: "b", target: "c", type: "calls", direction: "forward", weight: 1 },
      { source: "c", target: "a", type: "imports", direction: "forward", weight: 0.5 },
    ],
    layers: [
      { id: "l1", name: "Layer One", description: "First layer", nodeIds: ["a", "b"] },
      { id: "l2", name: "Layer Two", description: "Second layer", nodeIds: ["c"] },
    ],
    tour: [
      { order: 1, title: "Start", description: "Begin here", nodeIds: ["a"] },
      { order: 2, title: "Next", description: "Then here", nodeIds: ["b"] },
    ],
  }
}

function seedService(dir: string, serviceName = "order-service"): void {
  writeJson(
    path.join(dir, serviceName, ".understand-anything", "knowledge-graph.json"),
    makeGraph(),
  )
  writeJson(
    path.join(dir, serviceName, ".understand-anything", "domain-graph.json"),
    {
      ...makeGraph(),
      nodes: [{ id: "d1", type: "domain", name: "Domain", summary: "", tags: [], complexity: "simple" }],
      edges: [],
    },
  )
}

describe("handleGraphQueryRequest", () => {
  let dir: string
  let origCwd: string

  beforeEach(() => {
    dir = fs.realpathSync.native(tmpDir())
    origCwd = process.cwd()
    process.chdir(dir)
    seedService(dir)
  })

  afterEach(() => {
    process.chdir(origCwd)
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it("returns null for non-matching route", async () => {
    const res = await handleGraphQueryRequest(
      { pathname: "/api/graph-query/unknown", searchParams: new URLSearchParams() },
      ctx,
    )
    expect(res).toBeNull()
  })

  it("returns 400 when required params are missing", async () => {
    const res = await handleGraphQueryRequest(
      { pathname: "/api/graph-query/neighbors", searchParams: new URLSearchParams() },
      ctx,
    )
    expect(res?.statusCode).toBe(400)
    expect((res?.body as { error: string }).error).toMatch(/service parameter required/)
  })

  it("returns 400 for invalid graph value", async () => {
    const res = await handleGraphQueryRequest(
      {
        pathname: "/api/graph-query/neighbors",
        searchParams: new URLSearchParams({
          service: "order-service",
          graph: "invalid",
          node: "a",
        }),
      },
      ctx,
    )
    expect(res?.statusCode).toBe(400)
    expect((res?.body as { error: string }).error).toMatch(/invalid graph value/)
  })

  it("returns 400 when depth exceeds max", async () => {
    const res = await handleGraphQueryRequest(
      {
        pathname: "/api/graph-query/neighbors",
        searchParams: new URLSearchParams({
          service: "order-service",
          graph: "kg",
          node: "a",
          depth: "4",
        }),
      },
      ctx,
    )
    expect(res?.statusCode).toBe(400)
    expect((res?.body as { error: string }).error).toMatch(/depth must be between 1 and 3/)
  })

  it("matches all four graph-query routes", async () => {
    const neighbors = await handleGraphQueryRequest(
      {
        pathname: "/api/graph-query/neighbors",
        searchParams: new URLSearchParams({
          service: "order-service",
          graph: "kg",
          node: "a",
        }),
      },
      ctx,
    )
    expect(neighbors?.statusCode).toBe(200)

    const edges = await handleGraphQueryRequest(
      {
        pathname: "/api/graph-query/edges",
        searchParams: new URLSearchParams({ service: "order-service", graph: "kg" }),
      },
      ctx,
    )
    expect(edges?.statusCode).toBe(200)

    const layers = await handleGraphQueryRequest(
      {
        pathname: "/api/graph-query/layers",
        searchParams: new URLSearchParams({ service: "order-service" }),
      },
      ctx,
    )
    expect(layers?.statusCode).toBe(200)

    const tour = await handleGraphQueryRequest(
      {
        pathname: "/api/graph-query/tour",
        searchParams: new URLSearchParams({ service: "order-service" }),
      },
      ctx,
    )
    expect(tour?.statusCode).toBe(200)
  })

  it("traverses neighbors by id and name with direction and depth", async () => {
    const byId = await handleGraphQueryRequest(
      {
        pathname: "/api/graph-query/neighbors",
        searchParams: new URLSearchParams({
          service: "order-service",
          graph: "kg",
          node: "a",
          direction: "outbound",
          depth: "1",
        }),
      },
      ctx,
    )
    expect(byId?.statusCode).toBe(200)
    const idBody = byId?.body as {
      center: { id: string }
      neighbors: Array<{ node: { id: string }; direction: string; depth: number }>
      totalEdges: number
    }
    expect(idBody.center.id).toBe("a")
    expect(idBody.neighbors).toHaveLength(1)
    expect(idBody.neighbors[0].node.id).toBe("b")
    expect(idBody.neighbors[0].direction).toBe("outbound")
    expect(idBody.neighbors[0].depth).toBe(1)
    expect(idBody.totalEdges).toBe(1)

    const byName = await handleGraphQueryRequest(
      {
        pathname: "/api/graph-query/neighbors",
        searchParams: new URLSearchParams({
          service: "order-service",
          graph: "kg",
          node: "Alpha",
          direction: "inbound",
        }),
      },
      ctx,
    )
    expect(byName?.statusCode).toBe(200)
    const nameBody = byName?.body as {
      neighbors: Array<{ node: { id: string }; direction: string }>
    }
    expect(nameBody.neighbors).toHaveLength(1)
    expect(nameBody.neighbors[0].node.id).toBe("c")
    expect(nameBody.neighbors[0].direction).toBe("inbound")

    const depth2 = await handleGraphQueryRequest(
      {
        pathname: "/api/graph-query/neighbors",
        searchParams: new URLSearchParams({
          service: "order-service",
          graph: "kg",
          node: "a",
          direction: "outbound",
          depth: "2",
        }),
      },
      ctx,
    )
    const depthBody = depth2?.body as { neighbors: Array<{ node: { id: string }; depth: number }> }
    expect(depthBody.neighbors.some((n) => n.node.id === "b" && n.depth === 1)).toBe(true)
    expect(depthBody.neighbors.some((n) => n.node.id === "c" && n.depth === 2)).toBe(true)
  })

  it("returns layers and tour from knowledge graph", async () => {
    const layersRes = await handleGraphQueryRequest(
      {
        pathname: "/api/graph-query/layers",
        searchParams: new URLSearchParams({ service: "order-service" }),
      },
      ctx,
    )
    expect(layersRes?.statusCode).toBe(200)
    expect((layersRes?.body as { layers: Array<{ id: string; nodeCount: number }> }).layers).toEqual([
      { id: "l1", name: "Layer One", description: "First layer", nodeCount: 2 },
      { id: "l2", name: "Layer Two", description: "Second layer", nodeCount: 1 },
    ])

    const tourRes = await handleGraphQueryRequest(
      {
        pathname: "/api/graph-query/tour",
        searchParams: new URLSearchParams({ service: "order-service" }),
      },
      ctx,
    )
    expect(tourRes?.statusCode).toBe(200)
    expect((tourRes?.body as { steps: Array<{ order: number; title: string }> }).steps).toHaveLength(2)
  })

  it("filters edges with pagination metadata", async () => {
    const res = await handleGraphQueryRequest(
      {
        pathname: "/api/graph-query/edges",
        searchParams: new URLSearchParams({
          service: "order-service",
          graph: "kg",
          type: "calls",
          limit: "1",
          offset: "0",
        }),
      },
      ctx,
    )
    expect(res?.statusCode).toBe(200)
    const body = res?.body as {
      edges: Array<{ type: string; sourceNode: { id: string }; targetNode: { id: string } }>
      total: number
      hasMore: boolean
    }
    expect(body.total).toBe(2)
    expect(body.edges).toHaveLength(1)
    expect(body.hasMore).toBe(true)
    expect(body.edges[0].type).toBe("calls")
    expect(body.edges[0].sourceNode.id).toBe("a")
    expect(body.edges[0].targetNode.id).toBe("b")
  })
})
