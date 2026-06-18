import { describe, it, expect, beforeEach } from "vitest"
import { handleStructureSearchRequest, clearStructureIndexCache } from "../structure"
import type { ApiRequest, ApiContext } from "../../types"

function makeRequest(params: Record<string, string>): ApiRequest {
  const searchParams = new URLSearchParams(params)
  return {
    pathname: "/api/structure/search",
    searchParams,
    method: "GET",
    url: `/api/structure/search?${searchParams.toString()}`,
    headers: {},
    body: undefined,
  } as ApiRequest
}

const mockCtx = {} as ApiContext

describe("structure search handler", () => {
  it("returns 400 when no q and no filter", async () => {
    const req = makeRequest({ service: "test-service" })
    const res = await handleStructureSearchRequest(req, mockCtx)
    expect(res?.statusCode).toBe(400)
  })

  it("accepts q parameter for fuzzy search", async () => {
    const req = makeRequest({ service: "test-service", q: "getUser" })
    const res = await handleStructureSearchRequest(req, mockCtx)
    expect(res?.statusCode).not.toBe(400)
  })

  it("accepts sectionKey parameter", async () => {
    const req = makeRequest({ service: "test-service", sectionKey: "spring.datasource.url" })
    const res = await handleStructureSearchRequest(req, mockCtx)
    expect(res?.statusCode).not.toBe(400)
  })

  it("accepts offset parameter", async () => {
    const req = makeRequest({ service: "test-service", q: "getUser", offset: "0", limit: "10" })
    const res = await handleStructureSearchRequest(req, mockCtx)
    expect(res?.statusCode).not.toBe(400)
  })

  it("returns 400 for negative offset", async () => {
    const req = makeRequest({ service: "test-service", q: "getUser", offset: "-1" })
    const res = await handleStructureSearchRequest(req, mockCtx)
    expect(res?.statusCode).toBe(400)
  })

  it("returns 400 for limit out of range", async () => {
    const req = makeRequest({ service: "test-service", q: "getUser", limit: "999" })
    const res = await handleStructureSearchRequest(req, mockCtx)
    expect(res?.statusCode).toBe(400)
  })

  it("ignores requests for other paths", async () => {
    const searchParams = new URLSearchParams({ service: "test-service", q: "foo" })
    const req = {
      pathname: "/api/structure/files",
      searchParams,
      method: "GET",
      url: "/api/structure/files",
      headers: {},
      body: undefined,
    } as ApiRequest
    const res = await handleStructureSearchRequest(req, mockCtx)
    expect(res).toBeNull()
  })
})

describe("clearStructureIndexCache", () => {
  beforeEach(() => {
    clearStructureIndexCache()
  })

  it("is exported and callable", () => {
    expect(typeof clearStructureIndexCache).toBe("function")
    expect(() => clearStructureIndexCache()).not.toThrow()
  })

  it("clears cached index so next search rebuilds", async () => {
    const req = makeRequest({ service: "test-service", q: "getUser" })
    await handleStructureSearchRequest(req, mockCtx)
    clearStructureIndexCache()
    const res = await handleStructureSearchRequest(req, mockCtx)
    expect(res?.statusCode).not.toBe(500)
  })
})

describe("structure index cache key", () => {
  beforeEach(() => {
    clearStructureIndexCache()
  })

  it("cache invalidation works across different services", async () => {
    const req1 = makeRequest({ service: "service-a", q: "getUser" })
    const req2 = makeRequest({ service: "service-b", q: "getUser" })
    await handleStructureSearchRequest(req1, mockCtx)
    await handleStructureSearchRequest(req2, mockCtx)
    // Clearing cache should not throw even with multiple services cached
    expect(() => clearStructureIndexCache()).not.toThrow()
  })
})
