import { describe, it, expect } from "vitest"
import { WikiIndex } from "../wiki-index"

const mockWiki = {
  entries: [
    {
      id: "wiki::auth",
      name: "Authentication",
      summary: "How authentication works",
      content: "JWT tokens are used for auth",
      type: "concept",
      service: "auth-service",
    },
    {
      id: "wiki::database",
      name: "Database",
      summary: "Database architecture",
      content: "PostgreSQL with connection pooling",
      type: "concept",
      service: "db-service",
    },
  ],
}

describe("WikiIndex", () => {
  it("finds by name", () => {
    const index = new WikiIndex(mockWiki)
    const results = index.search({ q: "Authentication" })
    expect(results.results.length).toBeGreaterThan(0)
    expect(results.results[0].name).toBe("Authentication")
  })
  it("finds by content", () => {
    const index = new WikiIndex(mockWiki)
    const results = index.search({ q: "PostgreSQL" })
    expect(results.results.some((r) => r.name === "Database")).toBe(true)
  })
  it("filters by service", () => {
    const index = new WikiIndex(mockWiki)
    const results = index.search({ service: "auth-service" })
    expect(results.results.every((r) => r.service === "auth-service")).toBe(true)
  })
  it("paginates results", () => {
    const index = new WikiIndex(mockWiki)
    const results = index.search({ q: "auth", limit: 1, offset: 0 })
    expect(results.results.length).toBeLessThanOrEqual(1)
  })
  it("includes facets", () => {
    const index = new WikiIndex(mockWiki)
    const results = index.search({ q: "auth" })
    expect(results.facets).toBeDefined()
  })
  it("every result has id", () => {
    const index = new WikiIndex(mockWiki)
    const results = index.search({ q: "auth" })
    expect(results.results.every((r) => r.id)).toBe(true)
  })
  it("returns empty for empty wiki", () => {
    const index = new WikiIndex({ entries: [] })
    const results = index.search({ q: "anything" })
    expect(results.results.length).toBe(0)
  })
})
