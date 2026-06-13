import { describe, it, expect } from "vitest"
import { KgIndex } from "../kg-index"
import type { KnowledgeGraph } from "@understand-anything/core"

const mockKg: KnowledgeGraph = {
  nodes: [
    {
      id: "node::UserService",
      name: "UserService",
      type: "class",
      summary: "Handles user CRUD operations",
      tags: ["user", "service"],
      filePath: "src/UserService.java",
      lineRange: [1, 50],
      complexity: "moderate",
    },
    {
      id: "node::AuthController",
      name: "AuthController",
      type: "endpoint",
      summary: "Authentication endpoints",
      tags: ["auth", "controller"],
      filePath: "src/AuthController.java",
      lineRange: [1, 30],
      complexity: "simple",
    },
    {
      id: "node::DatabasePool",
      name: "DatabasePool",
      type: "class",
      summary: "Connection pooling",
      tags: ["database"],
      filePath: "src/DatabasePool.java",
      lineRange: [1, 40],
      complexity: "complex",
    },
  ],
  edges: [
    { source: "node::AuthController", target: "node::UserService", type: "uses", direction: "forward" },
  ],
} as unknown as KnowledgeGraph

describe("KgIndex", () => {
  describe("fuzzy search", () => {
    it("finds by name", () => {
      const index = new KgIndex(mockKg, "test-service")
      const results = index.search({ q: "UserService" })
      expect(results.results.length).toBeGreaterThan(0)
      expect(results.results[0].name).toBe("UserService")
    })
    it("finds by summary", () => {
      const index = new KgIndex(mockKg, "test-service")
      const results = index.search({ q: "authentication" })
      expect(results.results.some((r) => r.name === "AuthController")).toBe(true)
    })
    it("finds by tag", () => {
      const index = new KgIndex(mockKg, "test-service")
      const results = index.search({ q: "auth" })
      expect(results.results.some((r) => r.name === "AuthController")).toBe(true)
    })
  })

  describe("precise filtering", () => {
    it("filters by type", () => {
      const index = new KgIndex(mockKg, "test-service")
      const results = index.search({ q: "Service", type: "class" })
      expect(results.results.every((r) => r.type === "class")).toBe(true)
    })
    it("filters by tag", () => {
      const index = new KgIndex(mockKg, "test-service")
      const results = index.search({ tag: "auth" })
      expect(results.results.every((r) => r.tags?.includes("auth"))).toBe(true)
    })
    it("filters by service", () => {
      const index = new KgIndex(mockKg, "test-service")
      const results = index.search({ service: "test-service" })
      expect(results.results.every((r) => r.service === "test-service")).toBe(true)
    })
  })

  describe("pagination", () => {
    it("respects limit", () => {
      const index = new KgIndex(mockKg, "test-service")
      const results = index.search({ limit: 1 })
      expect(results.results.length).toBe(1)
    })
    it("respects offset", () => {
      const index = new KgIndex(mockKg, "test-service")
      const page1 = index.search({ limit: 1, offset: 0 })
      const page2 = index.search({ limit: 1, offset: 1 })
      expect(page2.results[0].id).not.toBe(page1.results[0].id)
    })
  })

  describe("facets", () => {
    it("includes type and service distribution", () => {
      const index = new KgIndex(mockKg, "test-service")
      const results = index.search({ q: "Service" })
      expect(results.facets).toBeDefined()
      expect(results.facets!.type).toBeDefined()
      expect(results.facets!.service).toBeDefined()
    })
  })

  describe("result fields", () => {
    it("every result has id", () => {
      const index = new KgIndex(mockKg, "test-service")
      const results = index.search({ q: "User" })
      expect(results.results.every((r) => r.id)).toBe(true)
    })
    it("every result has score", () => {
      const index = new KgIndex(mockKg, "test-service")
      const results = index.search({ q: "User" })
      expect(results.results.every((r) => typeof r.score === "number")).toBe(true)
    })
  })

  describe("empty graph", () => {
    it("returns empty results", () => {
      const index = new KgIndex({ nodes: [], edges: [] } as unknown as KnowledgeGraph, "test-service")
      const results = index.search({ q: "anything" })
      expect(results.results.length).toBe(0)
    })
  })
})
