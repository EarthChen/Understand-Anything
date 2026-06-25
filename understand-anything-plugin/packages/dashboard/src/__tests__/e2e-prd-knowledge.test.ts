import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { existsSync } from "fs"
import request from "supertest"
import type { Express } from "express"
import { createApp } from "../../server"

const KB_TEST_ROOT = "/Users/earthchen/ai-work/kb-test"
const HAS_TEST_DATA = existsSync(KB_TEST_ROOT)

let app: Express
let originalCwd: string

beforeAll(() => {
  if (!HAS_TEST_DATA) return
  originalCwd = process.cwd()
  process.chdir(KB_TEST_ROOT)
  app = createApp({ projectRoot: KB_TEST_ROOT })
})

afterAll(() => {
  if (originalCwd) process.chdir(originalCwd)
})

describe.skipIf(!HAS_TEST_DATA)("E2E: system graph", () => {
  it("serves system-graph.json with facets and services", async () => {
    const res = await request(app).get("/system-graph.json")
    expect(res.status).toBe(200)
    expect(res.body.version).toBe("1.0.0")
    expect(res.body.project.serviceCount).toBeGreaterThan(0)

    const facetIds = res.body.nodes
      .filter((n: { type: string }) => n.type === "facet")
      .map((n: { id: string }) => n.id)
    expect(facetIds).toContain("facet:knowledge")
    expect(facetIds).toContain("facet:server")

    const serviceIds = res.body.nodes
      .filter((n: { type: string }) => n.type === "microservice")
      .map((n: { id: string }) => n.id)
    expect(serviceIds).toContain("microservice:amar-prd")
  })

  it("system-graph serviceIndex includes amar-prd with knowledge facet", async () => {
    const res = await request(app).get("/system-graph.json")
    const entry = res.body.serviceIndex?.["amar-prd"]
    expect(entry).toBeDefined()
    expect(entry.facet).toBe("knowledge")
    expect(entry.profile).toBe("prd-wiki")
    expect(entry.hasKg).toBe(true)
  })
})

describe.skipIf(!HAS_TEST_DATA)("E2E: services API", () => {
  it("lists all services including amar-prd", async () => {
    const res = await request(app).get("/api/services")
    expect(res.status).toBe(200)
    expect(res.body.totalServices).toBeGreaterThan(0)

    const names = res.body.services.map((s: { name: string }) => s.name)
    expect(names).toContain("amar-prd")
  })

  it("amar-prd service has KG data layer available", async () => {
    const res = await request(app).get("/api/services").query({ name: "amar-prd" })
    expect(res.status).toBe(200)

    const svc = res.body.services.find((s: { name: string }) => s.name === "amar-prd")
    expect(svc).toBeDefined()
    expect(svc.facet).toBe("knowledge")
    expect(svc.dataLayers.kg.available).toBe(true)
  })
})

describe.skipIf(!HAS_TEST_DATA)("E2E: PRD knowledge graph via graph API", () => {
  it("loads amar-prd knowledge-graph.json", async () => {
    const res = await request(app)
      .get("/api/graph")
      .query({ service: "amar-prd", file: "knowledge-graph.json" })
    expect(res.status).toBe(200)
    expect(res.body.kind).toBe("knowledge")
    expect(res.body.nodes.length).toBeGreaterThan(0)

    const types = new Set(res.body.nodes.map((n: { type: string }) => n.type))
    expect(types.has("source")).toBe(true)
    expect(types.has("requirement")).toBe(true)
  })

  it("PRD nodes carry knowledgeMeta with prd-wiki profile", async () => {
    const res = await request(app)
      .get("/api/graph")
      .query({ service: "amar-prd", file: "knowledge-graph.json" })

    const sourceNodes = res.body.nodes.filter(
      (n: { type: string; subtype?: string }) => n.type === "source" && n.subtype === "prd",
    )
    expect(sourceNodes.length).toBeGreaterThan(0)

    const withProfile = sourceNodes.filter(
      (n: { knowledgeMeta?: { profile?: string } }) => n.knowledgeMeta?.profile === "prd-wiki",
    )
    expect(withProfile.length).toBeGreaterThan(0)
  })
})

describe.skipIf(!HAS_TEST_DATA)("E2E: unified search with PRD knowledge", () => {
  it("returns results for a PRD-related query", async () => {
    const res = await request(app).get("/api/search").query({ q: "VIP", limit: "10" })
    expect(res.status).toBe(200)
    expect(res.body.results.length).toBeGreaterThan(0)
    expect(res.body.query).toBe("VIP")
  }, 30_000)

  it("search results include amar-prd service entries", async () => {
    const res = await request(app)
      .get("/api/search")
      .query({ q: "VIP", service: "amar-prd", limit: "20" })
    expect(res.status).toBe(200)

    const services = new Set(
      res.body.results.map((r: { service?: string }) => r.service),
    )
    expect(services.has("amar-prd")).toBe(true)
  })

  it("search facets include service and type breakdowns", async () => {
    const res = await request(app).get("/api/search").query({ q: "VIP", limit: "50" })
    expect(res.status).toBe(200)
    expect(res.body.facets).toBeDefined()
    expect(res.body.facets.type).toBeDefined()
    expect(res.body.facets.service).toBeDefined()
  })

  it("KG-scoped search includes PRD knowledge nodes", async () => {
    const res = await request(app)
      .get("/api/search")
      .query({ q: "VIP", scope: "kg", service: "amar-prd", limit: "20" })
    expect(res.status).toBe(200)

    for (const r of res.body.results) {
      expect(r.layer).toBe("kg")
    }
    if (res.body.results.length > 0) {
      const types = new Set(res.body.results.map((r: { type: string }) => r.type))
      expect(types.size).toBeGreaterThan(0)
    }
  })
})

describe.skipIf(!HAS_TEST_DATA)("E2E: graph-query endpoints", () => {
  it("lists layers for amar-prd service", async () => {
    const res = await request(app)
      .get("/api/graph-query/layers")
      .query({ service: "amar-prd" })
    expect(res.status).toBe(200)
    expect(res.body.layers).toBeDefined()
    expect(Array.isArray(res.body.layers)).toBe(true)
  })

  it("queries neighbors for a PRD source node", async () => {
    const graphRes = await request(app)
      .get("/api/graph")
      .query({ service: "amar-prd", file: "knowledge-graph.json" })
    const firstNode = graphRes.body.nodes[0]

    const res = await request(app)
      .get("/api/graph-query/neighbors")
      .query({ service: "amar-prd", graph: "kg", node: firstNode.id })
    expect(res.status).toBe(200)
    expect(res.body.center).toBeDefined()
    expect(res.body.center.id).toBe(firstNode.id)
  })

  it("finds hotspots in amar-prd knowledge graph", async () => {
    const res = await request(app)
      .get("/api/graph-query/hotspots")
      .query({ service: "amar-prd", graph: "kg", limit: "10" })
    expect(res.status).toBe(200)
    expect(res.body.hotspots).toBeDefined()
    expect(Array.isArray(res.body.hotspots)).toBe(true)
  })
})

describe.skipIf(!HAS_TEST_DATA)("E2E: config and metadata", () => {
  it("serves config.json", async () => {
    const res = await request(app).get("/config.json")
    expect(res.status).toBe(200)
    expect(res.body.outputLanguage).toBe("zh")
  })

  it("returns project metadata via /api/meta", async () => {
    const res = await request(app).get("/api/meta")
    expect(res.status).toBe(200)
    expect(res.body.project).toBeDefined()
    expect(res.body.layers).toBeDefined()
  })
})
