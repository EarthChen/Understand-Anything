import fs from "fs"
import os from "os"
import path from "path"
import { describe, it, expect, beforeEach, afterEach } from "vitest"
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
const originalCwd = process.cwd()

let tempDir: string

function seedStructuralAnalysis(service: string): void {
  const extractionDir = path.join(
    tempDir,
    service,
    ".understand-anything",
    "intermediate",
    "extraction",
  )
  fs.mkdirSync(extractionDir, { recursive: true })
  fs.writeFileSync(
    path.join(extractionDir, "structural-analysis.json"),
    JSON.stringify({
      "src/UserService.java": {
        language: "java",
        totalLines: 100,
        functions: [],
        classes: [],
        imports: [],
        exports: [],
        callGraph: [
          {
            caller: "processOrder",
            callerOwner: "OrderService",
            callerQualifiedName: "OrderService#processOrder",
            callee: "userRepository.getUser",
            receiver: "userRepository",
            methodName: "getUser",
            argumentCount: 1,
            lineNumber: 42,
            columnNumber: 12,
          },
          {
            caller: "processOrder",
            callee: "userRepository.getUser",
            receiver: "userRepository",
            methodName: "getUser",
            argumentCount: 2,
            lineNumber: 43,
          },
        ],
      },
    }),
  )
}

describe("structure callgraph handler", () => {
  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "structure-callgraph-"))
    process.chdir(tempDir)
    seedStructuralAnalysis("test-service")
    clearStructureIndexCache()
  })

  afterEach(() => {
    process.chdir(originalCwd)
    fs.rmSync(tempDir, { recursive: true, force: true })
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

  it("returns 400 for invalid argc", async () => {
    const req = makeCallgraphRequest({ service: "test-service", callee: "getUser", argc: "-1" })
    const res = await handleStructureRequest(req, mockCtx)
    expect(res?.statusCode).toBe(400)
  })

  it("returns 400 for empty argc", async () => {
    const req = makeCallgraphRequest({ service: "test-service", callee: "getUser", argc: "" })
    const res = await handleStructureRequest(req, mockCtx)
    expect(res?.statusCode).toBe(400)
  })

  it("returns match mode and argc-filtered projected results", async () => {
    const req = makeCallgraphRequest({
      service: "test-service",
      callee: "getUser",
      exact: "true",
      argc: "1",
    })
    const res = await handleStructureRequest(req, mockCtx)

    expect(res?.statusCode).toBe(200)
    const body = res!.body as {
      query: { argc: number | null; matchMode: string }
      total: number
      results: Array<{ methodName?: string; argumentCount?: number; columnNumber?: number }>
    }
    expect(body.query).toMatchObject({ argc: 1, matchMode: "exact-method" })
    expect(body.total).toBe(1)
    expect(body.results[0]).toMatchObject({
      methodName: "getUser",
      argumentCount: 1,
      columnNumber: 12,
    })
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
