import { describe, it, expect, beforeEach } from "vitest"
import { handleStructureRequest, clearStructureIndexCache } from "../structure"
import type { ApiRequest, ApiContext } from "../../types"

function makeCallgraphRequest(params: Record<string, string>): ApiRequest {
  const searchParams = new URLSearchParams(params)
  return {
    pathname: "/api/structure/callgraph",
    searchParams,
    method: "GET",
    url: `/api/structure/callgraph?${searchParams.toString()}`,
    headers: {},
    body: undefined,
  } as ApiRequest
}

const mockCtx = {} as ApiContext

describe("structure callgraph handler", () => {
  beforeEach(() => {
    clearStructureIndexCache()
  })

  it("returns 400 when neither callee nor caller is provided", async () => {
    const req = makeCallgraphRequest({ service: "test-service" })
    const res = await handleStructureRequest(req, mockCtx)
    expect(res?.statusCode).toBe(400)
  })

  it("returns 400 when service is missing", async () => {
    const req = makeCallgraphRequest({ callee: "getUser" })
    const res = await handleStructureRequest(req, mockCtx)
    expect(res?.statusCode).toBe(400)
  })

  it("returns 404 when service has no structural analysis", async () => {
    const req = makeCallgraphRequest({ service: "nonexistent-service", callee: "getUser" })
    const res = await handleStructureRequest(req, mockCtx)
    expect(res?.statusCode).toBe(404)
  })

  it("accepts callee parameter", async () => {
    const req = makeCallgraphRequest({ service: "test-service", callee: "getUser" })
    const res = await handleStructureRequest(req, mockCtx)
    // May be 200 or 404 depending on test data, but not 400
    expect(res?.statusCode).not.toBe(400)
  })

  it("accepts caller parameter", async () => {
    const req = makeCallgraphRequest({ service: "test-service", caller: "processOrder" })
    const res = await handleStructureRequest(req, mockCtx)
    expect(res?.statusCode).not.toBe(400)
  })

  it("accepts exact parameter", async () => {
    const req = makeCallgraphRequest({ service: "test-service", callee: "getUser", exact: "true" })
    const res = await handleStructureRequest(req, mockCtx)
    expect(res?.statusCode).not.toBe(400)
  })

  it("accepts limit parameter", async () => {
    const req = makeCallgraphRequest({ service: "test-service", callee: "getUser", limit: "10" })
    const res = await handleStructureRequest(req, mockCtx)
    expect(res?.statusCode).not.toBe(400)
  })

  it("returns 400 for limit out of range", async () => {
    const req = makeCallgraphRequest({ service: "test-service", callee: "getUser", limit: "999" })
    const res = await handleStructureRequest(req, mockCtx)
    expect(res?.statusCode).toBe(400)
  })

  it("returns 400 for negative offset", async () => {
    const req = makeCallgraphRequest({ service: "test-service", callee: "getUser", offset: "-1" })
    const res = await handleStructureRequest(req, mockCtx)
    expect(res?.statusCode).toBe(400)
  })

  it("ignores requests for other paths", async () => {
    const searchParams = new URLSearchParams({ service: "test-service", callee: "foo" })
    const req = {
      pathname: "/api/other/endpoint",
      searchParams,
      method: "GET",
      url: "/api/other/endpoint",
      headers: {},
      body: undefined,
    } as ApiRequest
    const res = await handleStructureRequest(req, mockCtx)
    // handleStructureRequest only handles /api/structure/* paths
    expect(res).toBeNull()
  })
})
