import { describe, it, expect } from "vitest"
import { StructureIndex } from "../structure-index"
import type { StructuralAnalysis } from "../structure-index"

const mockData: StructuralAnalysis = {
  "src/UserService.java": {
    language: "java",
    totalLines: 100,
    functions: [
      {
        name: "getUser",
        startLine: 10,
        endLine: 20,
        params: [{ name: "id", type: "Long" }],
        returnType: "User",
        annotations: [{ name: "@GetMapping" }],
      },
      {
        name: "createUser",
        startLine: 25,
        endLine: 35,
        params: [{ name: "dto", type: "CreateUserDto" }],
        returnType: "User",
        annotations: [{ name: "@PostMapping" }],
      },
    ],
    classes: [
      {
        name: "UserService",
        startLine: 1,
        endLine: 50,
        kind: "class",
        annotations: [{ name: "@Service" }],
        interfaces: ["CrudRepository"],
        typedProperties: [{ name: "repository", type: "UserRepository" }],
      },
    ],
    imports: [],
    exports: [],
  },
  "src/OrderService.java": {
    language: "java",
    totalLines: 80,
    functions: [
      {
        name: "getOrder",
        startLine: 10,
        endLine: 20,
        params: [{ name: "id", type: "Long" }],
        returnType: "Order",
      },
    ],
    classes: [
      {
        name: "OrderService",
        startLine: 1,
        endLine: 40,
        kind: "class",
        annotations: [{ name: "@Service" }],
      },
    ],
    imports: [],
    exports: [],
  },
}

describe("StructureIndex", () => {
  describe("fuzzy search", () => {
    it("finds by function name", () => {
      const index = new StructureIndex("test-service", mockData)
      const results = index.search({ q: "getUser" })
      expect(results.results.length).toBeGreaterThan(0)
      expect(results.results[0].name).toBe("getUser")
    })
    it("finds by class name", () => {
      const index = new StructureIndex("test-service", mockData)
      const results = index.search({ q: "UserService" })
      expect(results.results.length).toBeGreaterThan(0)
      expect(results.results.some((r) => r.name === "UserService")).toBe(true)
    })
    it("finds by annotation", () => {
      const index = new StructureIndex("test-service", mockData)
      const results = index.search({ q: "Service" })
      expect(results.results.some((r) => r.annotations?.includes("@Service"))).toBe(true)
    })
    it("cross-style match: get_user matches getUser", () => {
      const index = new StructureIndex("test-service", mockData)
      const results = index.search({ q: "get_user" })
      expect(results.results.some((r) => r.name === "getUser")).toBe(true)
    })
  })

  describe("precise filtering", () => {
    it("filters by annotation", () => {
      const index = new StructureIndex("test-service", mockData)
      const results = index.search({ annotation: "@Service" })
      expect(results.results.every((r) => r.annotations?.includes("@Service"))).toBe(true)
    })
    it("filters by paramType", () => {
      const index = new StructureIndex("test-service", mockData)
      const results = index.search({ paramType: "Long" })
      expect(results.results.length).toBeGreaterThan(0)
    })
    it("filters by returnType", () => {
      const index = new StructureIndex("test-service", mockData)
      const results = index.search({ returnType: "User" })
      expect(results.results.every((r) => r.returnType === "User")).toBe(true)
    })
    it("filters by interface", () => {
      const index = new StructureIndex("test-service", mockData)
      const results = index.search({ iface: "CrudRepository" })
      expect(results.results.some((r) => r.name === "UserService")).toBe(true)
    })
    it("filters by propertyType", () => {
      const index = new StructureIndex("test-service", mockData)
      const results = index.search({ propertyType: "UserRepository" })
      expect(results.results.some((r) => r.name === "UserService")).toBe(true)
    })
    it("filters by sectionKey", () => {
      const index = new StructureIndex("test-service", mockData)
      const results = index.search({ sectionKey: "getUser" })
      expect(results.results.some((r) => r.name === "getUser")).toBe(true)
      expect(results.results.some((r) => r.name === "OrderService")).toBe(false)
    })
    it("filters by sectionValue", () => {
      const index = new StructureIndex("test-service", mockData)
      const results = index.search({ sectionValue: "UserService" })
      expect(results.results.some((r) => r.name === "UserService")).toBe(true)
    })
  })

  describe("combined fuzzy + precise", () => {
    it("applies fuzzy search on filtered subset", () => {
      const index = new StructureIndex("test-service", mockData)
      const results = index.search({ q: "get", annotation: "@Service" })
      expect(results.results.every((r) => r.annotations?.includes("@Service"))).toBe(true)
    })
  })

  describe("pagination", () => {
    it("returns first page", () => {
      const index = new StructureIndex("test-service", mockData)
      const results = index.search({ q: "Service", limit: 1, offset: 0 })
      expect(results.results.length).toBe(1)
      expect(results.hasMore).toBe(true)
    })
    it("returns second page", () => {
      const index = new StructureIndex("test-service", mockData)
      const page1 = index.search({ q: "Service", limit: 1, offset: 0 })
      const page2 = index.search({ q: "Service", limit: 1, offset: 1 })
      expect(page2.results[0].id).not.toBe(page1.results[0].id)
    })
    it("returns empty past end", () => {
      const index = new StructureIndex("test-service", mockData)
      const results = index.search({ q: "Service", limit: 10, offset: 100 })
      expect(results.results.length).toBe(0)
      expect(results.hasMore).toBe(false)
    })
  })

  describe("facets", () => {
    it("includes type distribution", () => {
      const index = new StructureIndex("test-service", mockData)
      const results = index.search({ q: "Service" })
      expect(results.facets).toBeDefined()
      expect(results.facets!.type).toBeDefined()
    })
  })

  describe("result fields", () => {
    it("every result has id", () => {
      const index = new StructureIndex("test-service", mockData)
      const results = index.search({ q: "getUser" })
      expect(results.results.every((r) => r.id)).toBe(true)
    })
    it("every result has service", () => {
      const index = new StructureIndex("test-service", mockData)
      const results = index.search({ q: "getUser" })
      expect(results.results.every((r) => r.service === "test-service")).toBe(true)
    })
    it("every result has filePath and lineRange", () => {
      const index = new StructureIndex("test-service", mockData)
      const results = index.search({ q: "getUser" })
      expect(results.results.every((r) => r.filePath && r.lineRange)).toBe(true)
    })
  })

  describe("empty data", () => {
    it("returns empty results for empty data", () => {
      const index = new StructureIndex("test-service", {})
      const results = index.search({ q: "anything" })
      expect(results.results.length).toBe(0)
      expect(results.total).toBe(0)
    })
  })
})
