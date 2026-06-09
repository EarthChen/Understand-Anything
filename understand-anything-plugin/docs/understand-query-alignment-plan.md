# understand-query Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the understand-query API + CLI to achieve Agent Essential coverage of all four upstream skill outputs, centralized behind HTTP endpoints.

**Architecture:** Extend the existing Express-like handler chain (`packages/dashboard/src/api/`) with 2 new handlers (`services.ts`, `graph-query.ts`), extend 2 existing handlers (`business.ts`, `wiki.ts`), add a `/api/meta` route. CLI (`skills/understand-query/ua_query.py`) adds 2 new subcommands + extends 4 existing. SKILL.md fully rewritten with Decision Tree.

**Tech Stack:** TypeScript (handlers), Python 3.10+ stdlib (CLI), Vitest (API tests)

---

## File Structure

### New Files
- `packages/dashboard/src/api/handlers/services.ts` — service discovery handler
- `packages/dashboard/src/api/handlers/graph-query.ts` — unified graph traversal handler
- `packages/dashboard/src/__tests__/api-services-handler.test.ts` — services handler tests
- `packages/dashboard/src/__tests__/api-graph-query-handler.test.ts` — graph-query handler tests

### Modified Files
- `packages/dashboard/src/api/index.ts` — register new handlers
- `packages/dashboard/src/api/handlers/business.ts` — add meta/panorama/links-filter
- `packages/dashboard/src/api/handlers/wiki.ts` — add flow direct access
- `packages/dashboard/src/api/handlers/graph.ts` — add `/api/meta` route
- `packages/dashboard/src/__tests__/api-business-handler.test.ts` — extend tests
- `packages/dashboard/src/__tests__/api-wiki-handler.test.ts` — extend tests
- `skills/understand-query/ua_query.py` — add subcommands + flags
- `skills/understand-query/SKILL.md` — full rewrite

---

## Task 1: `handlers/services.ts` — Service Discovery API

**Files:**
- Create: `packages/dashboard/src/api/handlers/services.ts`
- Create: `packages/dashboard/src/__tests__/api-services-handler.test.ts`
- Modify: `packages/dashboard/src/api/index.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/dashboard/src/__tests__/api-services-handler.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest"
import { handleServicesRequest } from "../api/handlers/services"
import type { ApiRequest, ApiContext } from "../api/types"

function makeReq(pathname: string, params: Record<string, string> = {}): ApiRequest {
  return { pathname, searchParams: new URLSearchParams(params) }
}
const mockCtx = { getWikiService: () => ({}) } as unknown as ApiContext

describe("handleServicesRequest", () => {
  it("returns null for non-matching routes", async () => {
    const res = await handleServicesRequest(makeReq("/api/wiki"), mockCtx)
    expect(res).toBeNull()
  })

  it("returns services list from system-graph serviceIndex", async () => {
    const res = await handleServicesRequest(makeReq("/api/services"), mockCtx)
    expect(res).not.toBeNull()
    expect(res!.statusCode).toBe(200)
    expect(res!.body).toHaveProperty("services")
    expect(res!.body).toHaveProperty("totalServices")
  })

  it("filters by name param", async () => {
    const res = await handleServicesRequest(makeReq("/api/services", { name: "order-service" }), mockCtx)
    expect(res!.statusCode).toBe(200)
    const body = res!.body as { services: unknown[] }
    expect(body.services.length).toBeLessThanOrEqual(1)
  })

  it("filters by has param", async () => {
    const res = await handleServicesRequest(makeReq("/api/services", { has: "wiki,kg" }), mockCtx)
    expect(res!.statusCode).toBe(200)
  })

  it("returns 404 when system-graph not found", async () => {
    vi.stubEnv("GRAPH_DIR", "/nonexistent")
    const res = await handleServicesRequest(makeReq("/api/services"), mockCtx)
    expect(res!.statusCode).toBe(404)
    vi.unstubAllEnvs()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/dashboard && pnpm vitest run src/__tests__/api-services-handler.test.ts`
Expected: FAIL — module `../api/handlers/services` not found

- [ ] **Step 3: Implement services handler**

Create `packages/dashboard/src/api/handlers/services.ts`:

```typescript
import fs from "fs"
import path from "path"
import type { ApiRequest, ApiContext, ApiResponse } from "../types"
import { findGraphFile, readJsonFile, resolveProjectRoot } from "../utils"
import type { SystemGraph } from "@understand-anything/core"

interface ServiceEntry {
  name: string
  basePath: string
  facet?: string
  dataLayers: {
    kg: { available: boolean; commit?: string; analyzedAt?: string }
    domain: { available: boolean; nodeCount?: number }
    wiki: { available: boolean; qualityGrade?: string; generatedAt?: string }
    business: { available: boolean; domainCount?: number }
  }
}

function buildServiceList(projectRoot: string): ServiceEntry[] {
  const sgPath = findGraphFile("system-graph.json")
  if (!sgPath) return []
  const sg = readJsonFile<SystemGraph>(sgPath)
  if (!sg?.serviceIndex) return []

  return Object.entries(sg.serviceIndex).map(([name, info]) => {
    const basePath = (info as Record<string, unknown>).basePath as string ?? name
    const svcRoot = path.resolve(projectRoot, basePath, ".understand-anything")

    const kgMeta = readJsonFile<{ analyzedAt?: string; gitCommitHash?: string }>(path.join(svcRoot, "meta.json"))
    const wikiMeta = readJsonFile<{ generatedAt?: string; qualityScore?: { overallGrade?: string } }>(
      path.join(svcRoot, "wiki", "meta.json"),
    )
    const domainGraph = readJsonFile<{ nodes?: unknown[] }>(path.join(svcRoot, "domain-graph.json"))
    const blDir = path.join(projectRoot, ".understand-anything", "business-landscape")
    const blDomains = readJsonFile<{ domains?: unknown[] }>(path.join(blDir, "domains.json"))

    return {
      name,
      basePath,
      facet: (info as Record<string, unknown>).facet as string | undefined,
      dataLayers: {
        kg: {
          available: (info as Record<string, unknown>).hasKg as boolean ?? false,
          commit: kgMeta?.gitCommitHash,
          analyzedAt: kgMeta?.analyzedAt,
        },
        domain: {
          available: (info as Record<string, unknown>).hasDomain as boolean ?? false,
          nodeCount: domainGraph?.nodes?.length,
        },
        wiki: {
          available: (info as Record<string, unknown>).hasWiki as boolean ?? false,
          qualityGrade: wikiMeta?.qualityScore?.overallGrade,
          generatedAt: wikiMeta?.generatedAt,
        },
        business: {
          available: blDomains != null,
          domainCount: blDomains?.domains?.length,
        },
      },
    }
  })
}

export async function handleServicesRequest(req: ApiRequest, _ctx: ApiContext): Promise<ApiResponse | null> {
  if (!req.pathname.startsWith("/api/services")) return null

  const projectRoot = resolveProjectRoot()
  let services = buildServiceList(projectRoot)

  if (services.length === 0) {
    return { statusCode: 404, body: { error: "system-graph.json not found. Run /understand-wiki Phase 3+ first." } }
  }

  const nameFilter = req.searchParams.get("name")
  if (nameFilter) {
    services = services.filter((s) => s.name === nameFilter)
  }

  const hasFilter = req.searchParams.get("has")
  if (hasFilter) {
    const required = hasFilter.split(",").map((s) => s.trim())
    services = services.filter((s) =>
      required.every((layer) => {
        const dl = s.dataLayers[layer as keyof typeof s.dataLayers]
        return dl?.available === true
      }),
    )
  }

  return { statusCode: 200, body: { services, totalServices: services.length } }
}
```

- [ ] **Step 4: Register handler in API router**

Modify `packages/dashboard/src/api/index.ts`:

```typescript
import { handleServicesRequest } from "./handlers/services"

const HANDLERS = [
  handleServicesRequest,
  handleBusinessRequest,
  handleWikiRequest,
  handleSourceRequest,
  handleGraphRequest,
]
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd packages/dashboard && pnpm vitest run src/__tests__/api-services-handler.test.ts`
Expected: PASS (tests may need mock filesystem — adjust with `vi.mock("fs")` if running without real data)

- [ ] **Step 6: Commit**

```bash
git add packages/dashboard/src/api/handlers/services.ts packages/dashboard/src/__tests__/api-services-handler.test.ts packages/dashboard/src/api/index.ts
git commit -m "feat(api): add /api/services endpoint for service discovery"
```

---

## Task 2: `handlers/graph-query.ts` — Relationship Traversal API

**Files:**
- Create: `packages/dashboard/src/api/handlers/graph-query.ts`
- Create: `packages/dashboard/src/__tests__/api-graph-query-handler.test.ts`
- Modify: `packages/dashboard/src/api/index.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/dashboard/src/__tests__/api-graph-query-handler.test.ts`:

```typescript
import { describe, it, expect } from "vitest"
import { handleGraphQueryRequest } from "../api/handlers/graph-query"
import type { ApiRequest, ApiContext } from "../api/types"

function makeReq(pathname: string, params: Record<string, string> = {}): ApiRequest {
  return { pathname, searchParams: new URLSearchParams(params) }
}
const mockCtx = { getWikiService: () => ({}) } as unknown as ApiContext

describe("handleGraphQueryRequest", () => {
  it("returns null for non-matching routes", async () => {
    const res = await handleGraphQueryRequest(makeReq("/api/wiki"), mockCtx)
    expect(res).toBeNull()
  })

  it("returns 400 if service missing for /api/graph-query/neighbors", async () => {
    const res = await handleGraphQueryRequest(
      makeReq("/api/graph-query/neighbors", { graph: "kg", node: "Foo" }),
      mockCtx,
    )
    expect(res!.statusCode).toBe(400)
  })

  it("returns 400 if graph param invalid", async () => {
    const res = await handleGraphQueryRequest(
      makeReq("/api/graph-query/neighbors", { service: "x", graph: "invalid", node: "Foo" }),
      mockCtx,
    )
    expect(res!.statusCode).toBe(400)
  })

  it("returns 400 if depth > 3", async () => {
    const res = await handleGraphQueryRequest(
      makeReq("/api/graph-query/neighbors", { service: "x", graph: "kg", node: "Foo", depth: "5" }),
      mockCtx,
    )
    expect(res!.statusCode).toBe(400)
  })

  it("returns 400 for /api/graph-query/edges without service", async () => {
    const res = await handleGraphQueryRequest(
      makeReq("/api/graph-query/edges", { graph: "kg" }),
      mockCtx,
    )
    expect(res!.statusCode).toBe(400)
  })

  it("returns layers for /api/graph-query/layers", async () => {
    const res = await handleGraphQueryRequest(
      makeReq("/api/graph-query/layers", { service: "test-service" }),
      mockCtx,
    )
    expect(res).not.toBeNull()
  })

  it("returns tour for /api/graph-query/tour", async () => {
    const res = await handleGraphQueryRequest(
      makeReq("/api/graph-query/tour", { service: "test-service" }),
      mockCtx,
    )
    expect(res).not.toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/dashboard && pnpm vitest run src/__tests__/api-graph-query-handler.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement graph-query handler**

Create `packages/dashboard/src/api/handlers/graph-query.ts`:

```typescript
import fs from "fs"
import path from "path"
import type { ApiRequest, ApiContext, ApiResponse } from "../types"
import { resolveProjectRoot, readJsonFile } from "../utils"

interface GraphNode { id: string; name: string; type: string; summary?: string; [k: string]: unknown }
interface GraphEdge { source: string; target: string; type: string; direction?: string; weight?: number; description?: string }
interface KnowledgeGraph { nodes: GraphNode[]; edges: GraphEdge[]; layers?: unknown[]; tour?: unknown[] }

const ALLOWED_GRAPHS = new Set(["kg", "domain"])

function resolveGraphPath(service: string, graph: string): string | null {
  const fileName = graph === "kg" ? "knowledge-graph.json" : "domain-graph.json"
  const projectRoot = resolveProjectRoot()
  const candidates = [
    path.resolve(projectRoot, service, ".understand-anything", fileName),
    path.resolve(process.cwd(), service, ".understand-anything", fileName),
  ]
  if (process.env.GRAPH_DIR) {
    candidates.unshift(path.resolve(process.env.GRAPH_DIR, service, ".understand-anything", fileName))
  }
  return candidates.find((c) => fs.existsSync(c)) ?? null
}

function findNode(nodes: GraphNode[], query: string): GraphNode | undefined {
  return nodes.find((n) => n.id === query) ?? nodes.find((n) => n.name === query)
}

function getNeighbors(
  graph: KnowledgeGraph,
  nodeId: string,
  direction: string,
  edgeType: string | null,
  maxDepth: number,
): Array<{ node: GraphNode; edge: GraphEdge; direction: "inbound" | "outbound"; depth: number }> {
  const nodeMap = new Map(graph.nodes.map((n) => [n.id, n]))
  const results: Array<{ node: GraphNode; edge: GraphEdge; direction: "inbound" | "outbound"; depth: number }> = []
  const visited = new Set<string>([nodeId])
  let frontier = [nodeId]

  for (let depth = 1; depth <= maxDepth; depth++) {
    const nextFrontier: string[] = []
    for (const currentId of frontier) {
      for (const edge of graph.edges) {
        if (edgeType && edge.type !== edgeType) continue
        let neighborId: string | null = null
        let dir: "inbound" | "outbound" | null = null
        if (edge.source === currentId && (direction === "both" || direction === "outbound")) {
          neighborId = edge.target
          dir = "outbound"
        } else if (edge.target === currentId && (direction === "both" || direction === "inbound")) {
          neighborId = edge.source
          dir = "inbound"
        }
        if (neighborId && !visited.has(neighborId) && dir) {
          visited.add(neighborId)
          const node = nodeMap.get(neighborId)
          if (node) {
            results.push({ node, edge, direction: dir, depth })
            nextFrontier.push(neighborId)
          }
        }
      }
    }
    frontier = nextFrontier
  }
  return results
}

export async function handleGraphQueryRequest(req: ApiRequest, _ctx: ApiContext): Promise<ApiResponse | null> {
  const { pathname, searchParams } = req
  if (!pathname.startsWith("/api/graph-query")) return null

  const service = searchParams.get("service")
  const graphType = searchParams.get("graph") ?? "kg"

  if (pathname === "/api/graph-query/neighbors") {
    if (!service) return { statusCode: 400, body: { error: "service parameter required" } }
    if (!ALLOWED_GRAPHS.has(graphType)) return { statusCode: 400, body: { error: "graph must be 'kg' or 'domain'" } }
    const nodeQuery = searchParams.get("node")
    if (!nodeQuery) return { statusCode: 400, body: { error: "node parameter required" } }
    const depth = parseInt(searchParams.get("depth") ?? "1", 10)
    if (depth < 1 || depth > 3) return { statusCode: 400, body: { error: "depth must be 1-3" } }
    const direction = searchParams.get("direction") ?? "both"
    const edgeType = searchParams.get("edgeType") ?? null

    const graphPath = resolveGraphPath(service, graphType)
    if (!graphPath) return { statusCode: 404, body: { error: `${graphType} graph not found for ${service}` } }
    const graph = readJsonFile<KnowledgeGraph>(graphPath)
    if (!graph) return { statusCode: 500, body: { error: "Failed to parse graph" } }

    const center = findNode(graph.nodes, nodeQuery)
    if (!center) return { statusCode: 404, body: { error: `Node '${nodeQuery}' not found` } }

    const neighbors = getNeighbors(graph, center.id, direction, edgeType, depth)
    return {
      statusCode: 200,
      body: { center, neighbors, totalEdges: neighbors.length },
    }
  }

  if (pathname === "/api/graph-query/edges") {
    if (!service) return { statusCode: 400, body: { error: "service parameter required" } }
    if (!ALLOWED_GRAPHS.has(graphType)) return { statusCode: 400, body: { error: "graph must be 'kg' or 'domain'" } }
    const limit = Math.min(parseInt(searchParams.get("limit") ?? "50", 10), 200)
    const offset = parseInt(searchParams.get("offset") ?? "0", 10)
    const typeFilter = searchParams.get("type")
    const sourceFilter = searchParams.get("source")
    const targetFilter = searchParams.get("target")

    const graphPath = resolveGraphPath(service, graphType)
    if (!graphPath) return { statusCode: 404, body: { error: `${graphType} graph not found for ${service}` } }
    const graph = readJsonFile<KnowledgeGraph>(graphPath)
    if (!graph) return { statusCode: 500, body: { error: "Failed to parse graph" } }

    const nodeMap = new Map(graph.nodes.map((n) => [n.id, n]))
    let edges = graph.edges
    if (typeFilter) edges = edges.filter((e) => e.type === typeFilter)
    if (sourceFilter) {
      const srcNode = findNode(graph.nodes, sourceFilter)
      if (srcNode) edges = edges.filter((e) => e.source === srcNode.id)
    }
    if (targetFilter) {
      const tgtNode = findNode(graph.nodes, targetFilter)
      if (tgtNode) edges = edges.filter((e) => e.target === tgtNode.id)
    }

    const total = edges.length
    const sliced = edges.slice(offset, offset + limit)
    const enriched = sliced.map((e) => ({
      ...e,
      sourceNode: { id: e.source, name: nodeMap.get(e.source)?.name ?? "?", type: nodeMap.get(e.source)?.type ?? "?" },
      targetNode: { id: e.target, name: nodeMap.get(e.target)?.name ?? "?", type: nodeMap.get(e.target)?.type ?? "?" },
    }))

    return { statusCode: 200, body: { edges: enriched, total, hasMore: offset + limit < total } }
  }

  if (pathname === "/api/graph-query/layers") {
    if (!service) return { statusCode: 400, body: { error: "service parameter required" } }
    const graphPath = resolveGraphPath(service, "kg")
    if (!graphPath) return { statusCode: 404, body: { error: `KG not found for ${service}` } }
    const graph = readJsonFile<KnowledgeGraph>(graphPath)
    if (!graph) return { statusCode: 500, body: { error: "Failed to parse graph" } }
    const layers = (graph.layers ?? []).map((l: unknown) => {
      const layer = l as { id?: string; name?: string; description?: string; nodeIds?: string[] }
      return { id: layer.id, name: layer.name, description: layer.description, nodeCount: layer.nodeIds?.length ?? 0 }
    })
    return { statusCode: 200, body: { layers } }
  }

  if (pathname === "/api/graph-query/tour") {
    if (!service) return { statusCode: 400, body: { error: "service parameter required" } }
    const graphPath = resolveGraphPath(service, "kg")
    if (!graphPath) return { statusCode: 404, body: { error: `KG not found for ${service}` } }
    const graph = readJsonFile<KnowledgeGraph>(graphPath)
    if (!graph) return { statusCode: 500, body: { error: "Failed to parse graph" } }
    return { statusCode: 200, body: { steps: graph.tour ?? [] } }
  }

  return null
}
```

- [ ] **Step 4: Register in router**

Add to `packages/dashboard/src/api/index.ts`:

```typescript
import { handleGraphQueryRequest } from "./handlers/graph-query"

const HANDLERS = [
  handleServicesRequest,
  handleGraphQueryRequest,
  handleBusinessRequest,
  handleWikiRequest,
  handleSourceRequest,
  handleGraphRequest,
]
```

- [ ] **Step 5: Run tests**

Run: `cd packages/dashboard && pnpm vitest run src/__tests__/api-graph-query-handler.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/dashboard/src/api/handlers/graph-query.ts packages/dashboard/src/__tests__/api-graph-query-handler.test.ts packages/dashboard/src/api/index.ts
git commit -m "feat(api): add /api/graph-query endpoints for neighbors, edges, layers, tour"
```

---

## Task 3: Extend `handlers/business.ts` — Meta, Panorama, Links Filter

**Files:**
- Modify: `packages/dashboard/src/api/handlers/business.ts`
- Modify: `packages/dashboard/src/__tests__/api-business-handler.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `packages/dashboard/src/__tests__/api-business-handler.test.ts`:

```typescript
describe("business handler extensions", () => {
  it("returns meta from /api/business/meta", async () => {
    const res = await handleBusinessRequest(makeReq("/api/business/meta"), mockCtx)
    expect(res).not.toBeNull()
    // Will be 404 if no business-landscape/meta.json exists in test env
    expect([200, 404]).toContain(res!.statusCode)
  })

  it("returns panorama from /api/business/panorama", async () => {
    const res = await handleBusinessRequest(makeReq("/api/business/panorama"), mockCtx)
    expect(res).not.toBeNull()
  })

  it("filters cross-facet-links by domain param", async () => {
    const res = await handleBusinessRequest(
      makeReq("/api/business/cross-facet-links", { domain: "order" }),
      mockCtx,
    )
    expect(res).not.toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify fail**

Run: `cd packages/dashboard && pnpm vitest run src/__tests__/api-business-handler.test.ts`
Expected: New tests FAIL — routes not handled

- [ ] **Step 3: Implement extensions**

Add to `packages/dashboard/src/api/handlers/business.ts` (before the closing return null):

```typescript
  if (pathname === "/api/business/meta") {
    const data = readJsonFile(path.join(blDir, "meta.json"))
    if (!data) return { statusCode: 404, body: { error: "business-landscape/meta.json not found" } }
    return { statusCode: 200, body: data }
  }

  if (pathname === "/api/business/panorama") {
    const projectRoot = resolveProjectRoot()
    const wikiPath = path.join(projectRoot, ".understand-anything", "wiki", "domains", "business.json")
    const data = readJsonFile(wikiPath)
    if (!data) return { statusCode: 404, body: { error: "wiki/domains/business.json not found" } }
    return { statusCode: 200, body: data }
  }
```

Also modify the existing `/api/business/cross-facet-links` block to accept `domain` filter:

```typescript
  if (pathname === "/api/business/cross-facet-links") {
    const data = readJsonFile<{ links: Array<{ domain: string }> }>(path.join(blDir, "cross-facet-links.json"))
    if (!data) return { statusCode: 404, body: { error: "cross-facet-links.json not found" } }
    const domainFilter = searchParams.get("domain")
    if (domainFilter) {
      const filtered = data.links.filter((l) => l.domain.includes(domainFilter))
      return { statusCode: 200, body: { ...data, links: filtered } }
    }
    return { statusCode: 200, body: data }
  }
```

- [ ] **Step 4: Run tests**

Run: `cd packages/dashboard && pnpm vitest run src/__tests__/api-business-handler.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/dashboard/src/api/handlers/business.ts packages/dashboard/src/__tests__/api-business-handler.test.ts
git commit -m "feat(api): add /api/business/meta, /api/business/panorama, domain filter on cross-facet-links"
```

---

## Task 4: Extend `handlers/wiki.ts` — Flow Direct Access

**Files:**
- Modify: `packages/dashboard/src/api/handlers/wiki.ts`
- Modify: `packages/dashboard/src/__tests__/api-wiki-handler.test.ts`

- [ ] **Step 1: Write failing test**

Append to `packages/dashboard/src/__tests__/api-wiki-handler.test.ts`:

```typescript
describe("wiki flow direct access", () => {
  it("returns 400 when flowId missing from /api/wiki/service/:name/flow/", async () => {
    const res = await handleWikiRequest(makeReq("/api/wiki/service/test-svc/flow/"), mockCtx)
    expect(res).not.toBeNull()
    expect(res!.statusCode).toBe(404)
  })

  it("handles /api/wiki/service/:name/flow/:flowId route", async () => {
    const res = await handleWikiRequest(
      makeReq("/api/wiki/service/test-svc/flow/flow:create-order"),
      mockCtx,
    )
    expect(res).not.toBeNull()
    // 404 is acceptable in test env (no wiki data)
    expect([200, 404]).toContain(res!.statusCode)
  })
})
```

- [ ] **Step 2: Run to verify fail**

Run: `cd packages/dashboard && pnpm vitest run src/__tests__/api-wiki-handler.test.ts`
Expected: New tests FAIL

- [ ] **Step 3: Implement flow access**

Add route matching in `packages/dashboard/src/api/handlers/wiki.ts`. Insert before other service routes:

```typescript
  // Flow direct access: /api/wiki/service/:name/flow/:flowId
  const flowMatch = pathname.match(/^\/api\/wiki\/service\/([^/]+)\/flow\/(.+)$/)
  if (flowMatch) {
    const [, serviceName, flowId] = flowMatch
    const wikiService = ctx.getWikiService()
    const serviceWiki = wikiService.getServiceWiki(decodeURIComponent(serviceName))
    if (!serviceWiki) return { statusCode: 404, body: { error: `Wiki not found for service ${serviceName}` } }

    // Search through all domain pages for the flow
    const domains = serviceWiki.getDomains()
    for (const domain of domains) {
      const page = serviceWiki.getDomainPage(domain.id)
      if (!page?.flows) continue
      const flow = page.flows.find((f: { id: string }) => f.id === decodeURIComponent(flowId))
      if (flow) {
        return {
          statusCode: 200,
          body: { flow, domain: { id: domain.id, name: domain.name }, service: serviceName },
        }
      }
    }
    return { statusCode: 404, body: { error: `Flow '${flowId}' not found in ${serviceName}` } }
  }
```

Note: The actual implementation depends on how `WikiDataService` exposes domain pages. Adjust method calls to match existing API (check `wiki-api.ts` for `getServiceDomains()`, `getServiceDomain()` methods).

- [ ] **Step 4: Run tests**

Run: `cd packages/dashboard && pnpm vitest run src/__tests__/api-wiki-handler.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/dashboard/src/api/handlers/wiki.ts packages/dashboard/src/__tests__/api-wiki-handler.test.ts
git commit -m "feat(api): add /api/wiki/service/:name/flow/:flowId for direct flow access"
```

---

## Task 5: `/api/meta` — Cross-Layer Freshness

**Files:**
- Modify: `packages/dashboard/src/api/handlers/graph.ts`
- Modify: `packages/dashboard/src/__tests__/api-graph-handler.test.ts`

- [ ] **Step 1: Write failing test**

Append to `packages/dashboard/src/__tests__/api-graph-handler.test.ts`:

```typescript
describe("/api/meta", () => {
  it("returns cross-layer freshness info", async () => {
    const res = await handleGraphRequest(makeReq("/api/meta"), mockCtx)
    expect(res).not.toBeNull()
    expect(res!.statusCode).toBe(200)
    const body = res!.body as { layers: unknown; freshness: unknown }
    expect(body).toHaveProperty("layers")
    expect(body).toHaveProperty("freshness")
  })
})
```

- [ ] **Step 2: Run to verify fail**

Run: `cd packages/dashboard && pnpm vitest run src/__tests__/api-graph-handler.test.ts`
Expected: FAIL — route not matched

- [ ] **Step 3: Implement /api/meta**

Add to `packages/dashboard/src/api/handlers/graph.ts` (before STATIC_GRAPH_PATHS check):

```typescript
  if (pathname === "/api/meta") {
    const projectRoot = projectRootFromGraphFile(
      graphFileCandidates("knowledge-graph.json").find((c) => fs.existsSync(c)) ?? "",
    ) || process.cwd()

    const uaDir = path.join(projectRoot, ".understand-anything")
    const kgMeta = readJsonFile<{ lastAnalyzedAt?: string; gitCommitHash?: string; analyzedFiles?: number }>(
      path.join(uaDir, "meta.json"),
    )
    const kg = readJsonFile<{ nodes?: unknown[]; edges?: unknown[] }>(path.join(uaDir, "knowledge-graph.json"))
    const domain = readJsonFile<{ nodes?: unknown[]; edges?: unknown[] }>(path.join(uaDir, "domain-graph.json"))
    const wikiMeta = readJsonFile<{ generatedAt?: string; serviceCount?: number; qualityScore?: { overallGrade?: string } }>(
      path.join(uaDir, "wiki", "meta.json"),
    )
    const blMeta = readJsonFile<{ generatedAt?: string; status?: string }>(
      path.join(uaDir, "business-landscape", "meta.json"),
    )
    const blDomains = readJsonFile<{ domains?: unknown[] }>(
      path.join(uaDir, "business-landscape", "domains.json"),
    )

    let currentCommit = ""
    try {
      const { execSync } = await import("child_process")
      currentCommit = execSync("git rev-parse HEAD", { cwd: projectRoot, encoding: "utf-8" }).trim()
    } catch { /* not in git repo */ }

    const stale: string[] = []
    if (kgMeta?.gitCommitHash && kgMeta.gitCommitHash !== currentCommit) stale.push("kg")
    // Domain graph doesn't store commit in the graph file itself; rely on KG freshness
    if (wikiMeta?.generatedAt && kgMeta?.gitCommitHash !== currentCommit) stale.push("wiki")

    const configData = readJsonFile<{ name?: string; description?: string }>(path.join(uaDir, "config.json"))
    const sgData = readJsonFile<{ project?: { name?: string; description?: string } }>(
      path.join(uaDir, "system-graph.json"),
    )

    return {
      statusCode: 200,
      body: {
        project: {
          name: sgData?.project?.name ?? configData?.name ?? path.basename(projectRoot),
          description: sgData?.project?.description ?? configData?.description,
        },
        layers: {
          kg: { available: kg != null, commit: kgMeta?.gitCommitHash, analyzedAt: kgMeta?.lastAnalyzedAt, nodeCount: kg?.nodes?.length, edgeCount: kg?.edges?.length },
          domain: { available: domain != null, nodeCount: domain?.nodes?.length, edgeCount: domain?.edges?.length },
          wiki: { available: wikiMeta != null, qualityGrade: wikiMeta?.qualityScore?.overallGrade, generatedAt: wikiMeta?.generatedAt, serviceCount: wikiMeta?.serviceCount },
          business: { available: blMeta != null, status: blMeta?.status, domainCount: blDomains?.domains?.length, generatedAt: blMeta?.generatedAt },
        },
        freshness: { currentCommit, stale },
      },
    }
  }
```

Add import at top: `import { readJsonFile } from "../utils"`

- [ ] **Step 4: Run tests**

Run: `cd packages/dashboard && pnpm vitest run src/__tests__/api-graph-handler.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/dashboard/src/api/handlers/graph.ts packages/dashboard/src/__tests__/api-graph-handler.test.ts
git commit -m "feat(api): add /api/meta for cross-layer freshness check"
```

---

## Task 6: CLI — New `services` and `meta` Subcommands

**Files:**
- Modify: `skills/understand-query/ua_query.py`

- [ ] **Step 1: Add `services` subparser**

In `parse_args()`, add:

```python
    svc = sub.add_parser("services", help="Service discovery and readiness")
    svc.add_argument("--list", action="store_true")
    svc.add_argument("--name")
    svc.add_argument("--has")
```

- [ ] **Step 2: Add `meta` subparser**

```python
    meta = sub.add_parser("meta", help="Cross-layer freshness check")
    meta.add_argument("--stale", action="store_true")
```

- [ ] **Step 3: Implement `cmd_services`**

```python
def cmd_services(args: argparse.Namespace) -> Any:
    params: dict[str, str] = {}
    if args.name:
        params["name"] = args.name
    if args.has:
        params["has"] = args.has
    return fetch_json(build_url(args.server, "/api/services", params, args.token))
```

- [ ] **Step 4: Implement `cmd_meta`**

```python
def cmd_meta(args: argparse.Namespace) -> Any:
    data = fetch_json(build_url(args.server, "/api/meta", {}, args.token))
    if args.stale:
        return {"stale": data.get("freshness", {}).get("stale", [])}
    return data
```

- [ ] **Step 5: Register handlers in main()**

```python
    handlers = {"kg": cmd_kg, "domain": cmd_domain, "wiki": cmd_wiki, "business": cmd_business, "services": cmd_services, "meta": cmd_meta}
```

- [ ] **Step 6: Test manually**

```bash
python skills/understand-query/ua_query.py --token test services --list
python skills/understand-query/ua_query.py --token test meta --stale
```

Expected: Either valid JSON or connection error (if server not running)

- [ ] **Step 7: Commit**

```bash
git add skills/understand-query/ua_query.py
git commit -m "feat(cli): add services and meta subcommands to ua_query.py"
```

---

## Task 7: CLI — Extend `kg` Subcommand

**Files:**
- Modify: `skills/understand-query/ua_query.py`

- [ ] **Step 1: Add new flags to kg subparser**

```python
    kg.add_argument("--neighbors")
    kg.add_argument("--edge-type")
    kg.add_argument("--direction", choices=["inbound", "outbound", "both"], default="both")
    kg.add_argument("--depth", type=int, default=1)
    kg.add_argument("--edges", action="store_true")
    kg.add_argument("--source")
    kg.add_argument("--target")
    kg.add_argument("--layers", action="store_true")
    kg.add_argument("--tour", action="store_true")
```

- [ ] **Step 2: Implement extended cmd_kg**

Replace existing `cmd_kg` with:

```python
def cmd_kg(args: argparse.Namespace) -> Any:
    if not args.service:
        raise SystemExit("kg requires --service")

    if args.neighbors:
        params: dict[str, str] = {"service": args.service, "graph": "kg", "node": args.neighbors, "direction": args.direction, "depth": str(args.depth)}
        if args.edge_type:
            params["edgeType"] = args.edge_type
        return fetch_json(build_url(args.server, "/api/graph-query/neighbors", params, args.token))

    if args.edges:
        params = {"service": args.service, "graph": "kg"}
        if args.type:
            params["type"] = args.type
        if args.source:
            params["source"] = args.source
        if args.target:
            params["target"] = args.target
        return fetch_json(build_url(args.server, "/api/graph-query/edges", params, args.token))

    if args.layers:
        return fetch_json(build_url(args.server, "/api/graph-query/layers", {"service": args.service}, args.token))

    if args.tour:
        return fetch_json(build_url(args.server, "/api/graph-query/tour", {"service": args.service}, args.token))

    if args.file:
        path = f"/api/source?file={args.file}&service={args.service}&mode=graph"
        return fetch_json(build_url(args.server, path, {}, args.token))

    params = {"service": args.service, "file": "knowledge-graph.json"}
    data = fetch_json(build_url(args.server, "/api/graph", params, args.token))
    nodes = data.get("nodes", [])
    if args.node:
        nodes = [n for n in nodes if n.get("name") == args.node]
    elif args.type and args.type != "node":
        nodes = [n for n in nodes if n.get("type") == args.type]
    elif args.search:
        q = args.search.lower()
        nodes = [n for n in nodes if q in json.dumps(n, ensure_ascii=False).lower()]
    return {"nodes": nodes, "edges": data.get("edges", []) if args.verbose else None}
```

- [ ] **Step 3: Test manually**

```bash
python skills/understand-query/ua_query.py --token test kg --service order-service --neighbors OrderController
python skills/understand-query/ua_query.py --token test kg --service order-service --edges --type calls
python skills/understand-query/ua_query.py --token test kg --service order-service --layers
python skills/understand-query/ua_query.py --token test kg --service order-service --tour
```

- [ ] **Step 4: Commit**

```bash
git add skills/understand-query/ua_query.py
git commit -m "feat(cli): extend kg subcommand with neighbors, edges, layers, tour"
```

---

## Task 8: CLI — Extend `domain` Subcommand

**Files:**
- Modify: `skills/understand-query/ua_query.py`

- [ ] **Step 1: Add new flags to domain subparser**

```python
    domain.add_argument("--neighbors")
    domain.add_argument("--edge-type")
    domain.add_argument("--flows", action="store_true")
    domain.add_argument("--flow")
    domain.add_argument("--steps", action="store_true")
```

- [ ] **Step 2: Implement extended cmd_domain**

Replace existing `cmd_domain`:

```python
def cmd_domain(args: argparse.Namespace) -> Any:
    if not args.service:
        raise SystemExit("domain requires --service")

    if args.neighbors:
        params: dict[str, str] = {"service": args.service, "graph": "domain", "node": args.neighbors, "direction": "both"}
        if args.edge_type:
            params["edgeType"] = args.edge_type
        return fetch_json(build_url(args.server, "/api/graph-query/neighbors", params, args.token))

    params = {"service": args.service, "file": "domain-graph.json"}
    data = fetch_json(build_url(args.server, "/api/graph", params, args.token))

    if args.flows:
        nodes = [n for n in data.get("nodes", []) if n.get("type") == "flow"]
        return {"flows": nodes}

    if args.flow:
        flow_id = args.flow
        nodes = data.get("nodes", [])
        flow_node = next((n for n in nodes if n.get("id") == flow_id or n.get("name") == flow_id), None)
        if not flow_node:
            raise SystemExit(f"Flow '{flow_id}' not found")
        if args.steps:
            edges = data.get("edges", [])
            step_edges = sorted(
                [e for e in edges if e.get("source") == flow_node["id"] and e.get("type") == "flow_step"],
                key=lambda e: e.get("weight", 0),
            )
            step_ids = [e["target"] for e in step_edges]
            steps = [n for n in nodes if n["id"] in step_ids]
            return {"flow": flow_node, "steps": steps}
        return {"flow": flow_node}

    if args.domain:
        nodes = [n for n in data.get("nodes", []) if args.domain in n.get("id", "") or args.domain in n.get("name", "")]
        return {"nodes": nodes}

    if args.search:
        q = args.search.lower()
        nodes = [n for n in data.get("nodes", []) if q in n.get("name", "").lower() or q in n.get("summary", "").lower()]
        return {"nodes": nodes}

    return data
```

- [ ] **Step 3: Test manually**

```bash
python skills/understand-query/ua_query.py --token test domain --service order-service --flows
python skills/understand-query/ua_query.py --token test domain --service order-service --flow "flow:create-order" --steps
python skills/understand-query/ua_query.py --token test domain --service order-service --neighbors order
```

- [ ] **Step 4: Commit**

```bash
git add skills/understand-query/ua_query.py
git commit -m "feat(cli): extend domain subcommand with flows, flow, steps, neighbors"
```

---

## Task 9: CLI — Extend `wiki` Subcommand

**Files:**
- Modify: `skills/understand-query/ua_query.py`

- [ ] **Step 1: Add new flags to wiki subparser**

```python
    wiki.add_argument("--overview", action="store_true")
    wiki.add_argument("--architecture", action="store_true")
    wiki.add_argument("--cross-domain")
    wiki.add_argument("--endpoint-index", action="store_true")
    wiki.add_argument("--protocol")
    wiki.add_argument("--flow")
    wiki.add_argument("--related", action="store_true")
```

- [ ] **Step 2: Implement extended cmd_wiki**

Replace existing `cmd_wiki`:

```python
def cmd_wiki(args: argparse.Namespace) -> Any:
    if args.overview:
        return fetch_json(build_url(args.server, "/api/wiki/overview", {}, args.token))

    if args.architecture:
        return fetch_json(build_url(args.server, "/api/wiki/architecture", {}, args.token))

    if args.cross_domain:
        slug = quote(args.cross_domain, safe="")
        return fetch_json(build_url(args.server, f"/api/wiki/domain/{slug}", {}, args.token))

    if args.endpoint_index:
        data = fetch_json(build_url(args.server, "/api/wiki/endpoints/index", {}, args.token))
        if args.protocol:
            by_proto = data.get("byProtocol", {})
            return {"protocol": args.protocol, "entries": by_proto.get(args.protocol, [])}
        return data

    if not args.service:
        raise SystemExit("wiki requires --service (or use --overview/--architecture/--cross-domain/--endpoint-index)")

    svc = quote(args.service, safe="")

    if args.flow:
        flow_id = quote(args.flow, safe="")
        return fetch_json(build_url(args.server, f"/api/wiki/service/{svc}/flow/{flow_id}", {}, args.token))

    if args.related:
        if not args.domain:
            raise SystemExit("--related requires --domain")
        domain_id = quote(args.domain, safe="")
        return fetch_json(build_url(args.server, f"/api/wiki/{domain_id}/related", {}, args.token))

    if args.search:
        return fetch_json(build_url(args.server, "/api/wiki/search", {"q": args.search, "limit": "20"}, args.token))

    if args.domain:
        path = f"/api/wiki/service/{svc}/domain/{quote(args.domain, safe='')}"
        return fetch_json(build_url(args.server, path, {}, args.token))

    if args.type == "endpoint":
        return fetch_json(build_url(args.server, f"/api/wiki/endpoints/{svc}", {}, args.token))

    return fetch_json(build_url(args.server, f"/api/wiki/service/{svc}", {}, args.token))
```

- [ ] **Step 3: Test manually**

```bash
python skills/understand-query/ua_query.py --token test wiki --overview
python skills/understand-query/ua_query.py --token test wiki --architecture
python skills/understand-query/ua_query.py --token test wiki --endpoint-index
python skills/understand-query/ua_query.py --token test wiki --service order-service --flow "flow:create-order"
```

- [ ] **Step 4: Commit**

```bash
git add skills/understand-query/ua_query.py
git commit -m "feat(cli): extend wiki subcommand with overview, architecture, cross-domain, endpoint-index, flow, related"
```

---

## Task 10: CLI — Extend `business` Subcommand

**Files:**
- Modify: `skills/understand-query/ua_query.py`

- [ ] **Step 1: Add new flags to business subparser**

```python
    biz.add_argument("--links", action="store_true")
    biz.add_argument("--panorama", action="store_true")
    biz.add_argument("--meta", action="store_true")
```

- [ ] **Step 2: Implement extended cmd_business**

Replace existing `cmd_business`:

```python
def cmd_business(args: argparse.Namespace) -> Any:
    if args.meta:
        return fetch_json(build_url(args.server, "/api/business/meta", {}, args.token))

    if args.panorama:
        return fetch_json(build_url(args.server, "/api/business/panorama", {}, args.token))

    if args.links:
        params: dict[str, str] = {}
        if args.domain:
            params["domain"] = args.domain
        return fetch_json(build_url(args.server, "/api/business/cross-facet-links", params, args.token))

    if args.list:
        return fetch_json(build_url(args.server, "/api/business/domains", {}, args.token))

    if args.search:
        return fetch_json(build_url(args.server, "/api/business/search", {"q": args.search}, args.token))

    if args.domain:
        slug = args.domain.replace("domain:", "").replace(" ", "-").lower()
        data = fetch_json(build_url(args.server, f"/api/business/domains/{slug}", {}, args.token))
        if args.type == "interactions":
            return {"interactions": data.get("interactions", [])}
        if args.type == "rules":
            return {"businessRules": data.get("businessRules", [])}
        if args.facet:
            return {"facets": data.get("facets", {}).get(args.facet, {})}
        return data

    return fetch_json(build_url(args.server, "/api/business/overview", {}, args.token))
```

- [ ] **Step 3: Test manually**

```bash
python skills/understand-query/ua_query.py --token test business --meta
python skills/understand-query/ua_query.py --token test business --panorama
python skills/understand-query/ua_query.py --token test business --links
python skills/understand-query/ua_query.py --token test business --links --domain order
```

- [ ] **Step 4: Commit**

```bash
git add skills/understand-query/ua_query.py
git commit -m "feat(cli): extend business subcommand with meta, panorama, links"
```

---

## Task 11: SKILL.md Full Rewrite

**Files:**
- Modify: `skills/understand-query/SKILL.md`

- [ ] **Step 1: Rewrite SKILL.md with Six-Layer Model + Decision Tree + Extended Reference**

The full content should follow the structure defined in the spec (Section 5):
- Updated frontmatter
- Six-Layer Drill-Down Model (Services → Business → Wiki → Domain → KG → Meta)
- Agent Decision Tree (6 paths + strategy summary + token guide)
- Extended Subcommand Reference (all new flags documented)
- Updated Error Handling
- Updated Integration with Agent Workflow

Key content blocks:
- Strategy Summary (8 rules box)
- 6 scenario paths with exact commands
- Token efficiency table
- All subcommand flag tables (from spec section 4)

- [ ] **Step 2: Verify SKILL.md renders correctly**

Read through the file, check markdown formatting, ensure all examples use correct flag names matching the Python implementation.

- [ ] **Step 3: Commit**

```bash
git add skills/understand-query/SKILL.md
git commit -m "docs: rewrite understand-query SKILL.md with Six-Layer Model and Agent Decision Tree"
```

---

## Dependency Graph

```
Task 1 (services handler) ─────────┐
Task 2 (graph-query handler) ───────┤
Task 3 (business handler extend) ───┼──→ Task 6 (CLI: services + meta)
Task 4 (wiki handler extend) ───────┤    Task 7 (CLI: kg extend)
Task 5 (/api/meta) ─────────────────┘    Task 8 (CLI: domain extend)
                                         Task 9 (CLI: wiki extend)
                                         Task 10 (CLI: business extend)
                                              │
                                              └──→ Task 11 (SKILL.md)
```

Tasks 1–5 can be parallelized (independent handlers). Tasks 6–10 depend on their respective API endpoints. Task 11 depends on all CLI work being complete.
