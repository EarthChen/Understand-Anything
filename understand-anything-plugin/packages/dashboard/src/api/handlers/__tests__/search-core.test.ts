import { describe, it, expect } from "vitest"
import { unifiedSearch, kgGraphExpansion } from "../search"
import type { SearchIndexState } from "../search"
import type { KnowledgeGraph } from "@understand-anything/core"
import { KgIndex } from "../kg-index"
import { WikiIndex } from "../wiki-index"

/** Wrap nodes/edges into a complete, valid KnowledgeGraph for KgIndex fixtures. */
function makeKg(nodes: KnowledgeGraph["nodes"], edges: KnowledgeGraph["edges"]): KnowledgeGraph {
  return {
    version: "0",
    project: { name: "test", languages: [], frameworks: [], description: "", analyzedAt: "", gitCommitHash: "" },
    nodes,
    edges,
    layers: [],
    tour: [],
  }
}

function buildState(overrides: Partial<SearchIndexState> = {}): SearchIndexState {
  const kg: KnowledgeGraph = makeKg(
    [
      { id: "kg::UserService", name: "UserService", type: "class", summary: "User CRUD", tags: ["user", "service"], filePath: "src/UserService.java", lineRange: [1, 50], complexity: "moderate" },
      { id: "kg::AuthController", name: "AuthController", type: "endpoint", summary: "Auth endpoints", tags: ["auth"], filePath: "src/AuthController.java", lineRange: [1, 30], complexity: "simple" },
      { id: "kg::OrderService", name: "OrderService", type: "class", summary: "Order management", tags: ["order"], filePath: "src/OrderService.java", lineRange: [1, 40], complexity: "complex" },
      { id: "biz::users", name: "User Domain", type: "domain", summary: "User business domain", tags: ["business"], complexity: "simple" },
      { id: "domain::auth-flow", name: "Auth Flow", type: "flow", summary: "Authentication flow", tags: ["domain"], complexity: "simple" },
    ],
    [
      { source: "kg::AuthController", target: "kg::UserService", type: "calls", direction: "forward", weight: 1 },
    ],
  )
  const wikiEntries = [
    { id: "wiki::auth", name: "Authentication", summary: "How auth works", content: "JWT tokens", type: "concept", service: "test-svc", domain: "security" },
    { id: "wiki::database", name: "Database", summary: "DB architecture", content: "PostgreSQL", type: "concept", service: "test-svc" },
  ]
  const edges = [
    { source: "kg::AuthController", target: "kg::UserService", type: "uses" },
  ]
  const adjacency = new Map<string, Set<string>>()
  adjacency.set("kg::AuthController", new Set(["kg::UserService"]))
  adjacency.set("kg::UserService", new Set(["kg::AuthController"]))

  return {
    kgIndex: KgIndex.create(kg, "test-svc"),
    wikiIndex: new WikiIndex({ entries: wikiEntries }),
    edges,
    adjacency,
    mtimes: {},
    ...overrides,
  }
}

describe("unifiedSearch", () => {
  it("returns results from both kg and wiki indices", () => {
    const state = buildState()
    const { results } = unifiedSearch(state, "auth", 20)
    const layers = new Set(results.map((r) => r.layer))
    expect(layers.has("kg")).toBe(true)
    expect(layers.has("wiki")).toBe(true)
  })

  it("merges by highest score for duplicate IDs", () => {
    const state = buildState()
    const { results } = unifiedSearch(state, "auth", 20)
    const ids = results.map((r) => r.id)
    const uniqueIds = new Set(ids)
    expect(ids.length).toBe(uniqueIds.size)
  })

  it("scope=kg excludes wiki results", () => {
    const state = buildState()
    const { results } = unifiedSearch(state, "auth", 20, "kg")
    expect(results.every((r) => r.layer !== "wiki")).toBe(true)
  })

  it("scope=wiki excludes kg results", () => {
    const state = buildState()
    const { results } = unifiedSearch(state, "auth", 20, "wiki")
    expect(results.every((r) => r.layer === "wiki")).toBe(true)
  })

  it("scope=domain returns only domain layer", () => {
    const state = buildState()
    const { results } = unifiedSearch(state, "auth", 20, "domain")
    expect(results.every((r) => r.layer === "domain")).toBe(true)
  })

  it("scope=business returns only business layer", () => {
    const state = buildState()
    const { results } = unifiedSearch(state, "user", 20, "business")
    expect(results.every((r) => r.layer === "business")).toBe(true)
  })

  it("empty query returns empty results", () => {
    const state = buildState()
    const { results, total } = unifiedSearch(state, "", 20)
    expect(results.length).toBe(0)
    expect(total).toBe(0)
  })

  it("respects limit", () => {
    const state = buildState()
    const { results } = unifiedSearch(state, "service", 1)
    expect(results.length).toBeLessThanOrEqual(1)
  })

  it("respects offset", () => {
    const state = buildState()
    const page1 = unifiedSearch(state, "service", 1, "all", "none", null, null, null, 0)
    const page2 = unifiedSearch(state, "service", 1, "all", "none", null, null, null, 1)
    if (page1.results.length > 0 && page2.results.length > 0) {
      expect(page2.results[0].id).not.toBe(page1.results[0].id)
    }
  })

  it("typeFilter filters kg results by type", () => {
    const state = buildState()
    const { results } = unifiedSearch(state, "service", 20, "all", "none", "class")
    expect(results.filter((r) => r.layer === "kg").every((r) => r.type === "class")).toBe(true)
  })

  it("tagFilter filters kg results by tag", () => {
    const state = buildState()
    const { results } = unifiedSearch(state, "auth", 20, "all", "none", null, "auth")
    expect(results.some((r) => r.name === "AuthController")).toBe(true)
    // UserService has "user" tag, not "auth" — should be filtered out from kg results
    expect(results.filter((r) => r.layer === "kg").every((r) => r.tags?.includes("auth"))).toBe(true)
  })

  it("serviceFilter filters by service", () => {
    const state = buildState()
    const { results } = unifiedSearch(state, "auth", 20, "all", "none", null, null, "test-svc")
    expect(results.some((r) => r.service === "test-svc")).toBe(true)
  })

  it("facets are merged from both indices", () => {
    const state = buildState()
    const { facets } = unifiedSearch(state, "auth", 20)
    expect(facets).toBeDefined()
    expect(facets.type).toBeDefined()
  })

  it("fusion=rrf activates graph expansion", () => {
    const state = buildState()
    const { results } = unifiedSearch(state, "auth", 20, "all", "rrf")
    expect(results.length).toBeGreaterThan(0)
    for (const r of results) {
      expect(r.score).toBeLessThan(1)
      expect(r.score).toBeGreaterThan(0)
    }
  })

  it("fusion=rrf with empty edges falls back to simple merge", () => {
    const state = buildState({ edges: [], adjacency: new Map() })
    const { results } = unifiedSearch(state, "auth", 20, "all", "rrf")
    expect(results.length).toBeGreaterThan(0)
  })

  it("results are sorted by score descending", () => {
    const state = buildState()
    const { results } = unifiedSearch(state, "service", 20)
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score)
    }
  })

  it("wiki results have layer=wiki", () => {
    const state = buildState()
    const { results } = unifiedSearch(state, "JWT", 20, "wiki")
    expect(results.every((r) => r.layer === "wiki")).toBe(true)
  })

  it("surfaces the wiki entry's domain on unified results", () => {
    // Guards search.ts reading `r.domain` off a wiki result — the wiki::auth
    // entry carries domain "security", which must flow through to the result.
    const state = buildState()
    const { results } = unifiedSearch(state, "auth", 20, "wiki")
    const authResult = results.find((r) => r.id === "wiki::auth")
    expect(authResult?.domain).toBe("security")
  })

  it("kg results include filePath and lineRange", () => {
    const state = buildState()
    const { results } = unifiedSearch(state, "UserService", 20, "kg")
    const r = results.find((x) => x.name === "UserService")
    expect(r?.filePath).toBe("src/UserService.java")
    expect(r?.lineRange).toEqual([1, 50])
  })

  it("searches PRD knowledge facets through the KG index", () => {
    const state: SearchIndexState = {
      kgIndex: KgIndex.create({
        nodes: [
          {
            id: "requirement:room-pk",
            name: "房间玩法",
            type: "requirement",
            summary: "房间相关需求",
            tags: ["prd"],
            knowledgeMeta: {
              profile: "prd-wiki",
              detail: "跨房间 PK 断线重连",
              business: "房间",
              sourcePath: "raw/prd/房间/pk.md",
              content: "观众重新进入后需要恢复 PK 进度。",
            },
          },
        ],
        edges: [],
      } as unknown as KnowledgeGraph, "amar-prd"),
      wikiIndex: new WikiIndex({ entries: [] }),
      edges: [],
      adjacency: new Map(),
      mtimes: {},
    }

    const result = unifiedSearch(state, "恢复 PK 进度", 10, "kg", "none", "requirement", null, "amar-prd")

    expect(result.results).toHaveLength(1)
    expect(result.results[0].service).toBe("amar-prd")
    expect(result.facets.type.requirement).toBe(1)
  })
})

describe("kgGraphExpansion", () => {
  it("returns 1-hop neighbors of seed IDs", () => {
    const state = buildState()
    const ranks = kgGraphExpansion(state, ["kg::AuthController"])
    expect(ranks.has("kg::UserService")).toBe(true)
    expect(ranks.get("kg::UserService")).toBe(1)
  })

  it("returns 2-hop neighbors with lower rank", () => {
    const kg: KnowledgeGraph = makeKg(
      [
        { id: "a", name: "A", type: "class", summary: "", tags: [], complexity: "simple" },
        { id: "b", name: "B", type: "class", summary: "", tags: [], complexity: "simple" },
        { id: "c", name: "C", type: "class", summary: "", tags: [], complexity: "simple" },
      ],
      [
        { source: "a", target: "b", type: "calls", direction: "forward", weight: 1 },
        { source: "b", target: "c", type: "calls", direction: "forward", weight: 1 },
      ],
    )
    const adj = new Map<string, Set<string>>()
    adj.set("a", new Set(["b"]))
    adj.set("b", new Set(["a", "c"]))
    adj.set("c", new Set(["b"]))

    const state: SearchIndexState = {
      kgIndex: KgIndex.create(kg, "svc"),
      wikiIndex: new WikiIndex({ entries: [] }),
      edges: [
        { source: "a", target: "b", type: "uses" },
        { source: "b", target: "c", type: "uses" },
      ],
      adjacency: adj,
      mtimes: {},
    }

    const ranks = kgGraphExpansion(state, ["a"])
    expect(ranks.get("b")).toBe(1)
    expect(ranks.get("c")).toBe(2)
  })

  it("does not include seed IDs in results", () => {
    const state = buildState()
    const ranks = kgGraphExpansion(state, ["kg::AuthController"])
    expect(ranks.has("kg::AuthController")).toBe(false)
  })

  it("respects maxNeighbors limit", () => {
    const kg: KnowledgeGraph = makeKg(
      [
        { id: "center", name: "Center", type: "class", summary: "", tags: [], complexity: "simple" as const },
        ...Array.from({ length: 100 }, (_, i) => ({
          id: `n${i}`, name: `N${i}`, type: "class" as const, summary: "", tags: [], complexity: "simple" as const,
        })),
      ],
      Array.from({ length: 100 }, (_, i) => ({
        source: "center", target: `n${i}`, type: "calls" as const, direction: "forward" as const, weight: 1,
      })),
    )
    const adj = new Map<string, Set<string>>()
    const neighbors = new Set(Array.from({ length: 100 }, (_, i) => `n${i}`))
    adj.set("center", neighbors)
    for (let i = 0; i < 100; i++) adj.set(`n${i}`, new Set(["center"]))

    const state: SearchIndexState = {
      kgIndex: KgIndex.create(kg, "svc"),
      wikiIndex: new WikiIndex({ entries: [] }),
      edges: Array.from({ length: 100 }, (_, i) => ({ source: "center", target: `n${i}`, type: "uses" })),
      adjacency: adj,
      mtimes: {},
    }

    const ranks = kgGraphExpansion(state, ["center"], 5)
    expect(ranks.size).toBe(5)
  })

  it("handles empty seed list", () => {
    const state = buildState()
    const ranks = kgGraphExpansion(state, [])
    expect(ranks.size).toBe(0)
  })

  it("handles nonexistent seed ID", () => {
    const state = buildState()
    const ranks = kgGraphExpansion(state, ["nonexistent"])
    expect(ranks.size).toBe(0)
  })
})
