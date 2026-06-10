import { describe, it, expect, beforeEach, afterEach } from "vitest"
import fs from "fs"
import path from "path"
import os from "os"
import { handleStructureRequest } from "../api/handlers/structure"
import type { ApiRequest, ApiContext } from "../api/types"

const mockCtx = { getWikiService: () => { throw new Error("unused") } } as unknown as ApiContext

function makeReq(pathname: string, params: Record<string, string> = {}): ApiRequest {
  return { pathname, searchParams: new URLSearchParams(params) }
}

const SAMPLE_STRUCTURE = {
  "svc/src/main/java/com/example/user/UserService.java": {
    language: "java",
    fileCategory: "code",
    totalLines: 120,
    functions: [
      {
        name: "findById",
        startLine: 30,
        endLine: 45,
        params: [{ name: "id", type: "Long" }],
        returnType: "UserDTO",
      },
      {
        name: "createUser",
        startLine: 50,
        endLine: 80,
        params: [
          { name: "req", type: "CreateUserRequest" },
          { name: "operator", type: "String" },
        ],
        returnType: "UserDTO",
        annotations: [{ name: "Transactional" }],
      },
    ],
    classes: [
      {
        name: "UserService",
        startLine: 10,
        endLine: 120,
        methods: ["findById", "createUser"],
        properties: ["userRepo", "cache"],
        annotations: [
          { name: "Service" },
          { name: "Slf4j" },
        ],
        interfaces: ["IUserService"],
        typedProperties: [
          { name: "userRepo", type: "UserRepository" },
          { name: "cache", type: "RedisTemplate<String, Object>" },
        ],
      },
    ],
    imports: [
      { name: "com.example.user.dto.UserDTO", line: 3 },
    ],
    exports: [{ name: "UserService", line: 10, isDefault: false }],
  },
  "svc/src/main/java/com/example/order/OrderController.java": {
    language: "java",
    fileCategory: "code",
    totalLines: 85,
    functions: [
      {
        name: "placeOrder",
        startLine: 20,
        endLine: 55,
        params: [{ name: "dto", type: "OrderDTO" }],
        returnType: "OrderResponse",
        annotations: [{ name: "MoaProvider" }],
      },
    ],
    classes: [
      {
        name: "OrderController",
        startLine: 8,
        endLine: 85,
        methods: ["placeOrder"],
        properties: [],
        annotations: [
          { name: "RestController" },
          { name: "MoaProvider" },
        ],
        interfaces: [],
        typedProperties: [],
      },
    ],
    imports: [],
    exports: [],
  },
  "svc/src/main/java/com/example/user/UserDTO.java": {
    language: "java",
    fileCategory: "code",
    totalLines: 30,
    functions: [],
    classes: [
      {
        name: "UserDTO",
        startLine: 5,
        endLine: 30,
        methods: [],
        properties: ["id", "name", "age"],
        annotations: [{ name: "Data" }],
        interfaces: ["Serializable"],
        typedProperties: [
          { name: "id", type: "Long" },
          { name: "name", type: "String" },
          { name: "age", type: "Integer" },
        ],
      },
    ],
    imports: [],
    exports: [],
  },
}

function seedStructure(dir: string) {
  const ua = path.join(dir, ".understand-anything")
  fs.mkdirSync(ua, { recursive: true })
  fs.writeFileSync(path.join(ua, "system-graph.json"), JSON.stringify({
    version: "1.0.0",
    generatedAt: "2026-06-10T12:00:00Z",
    project: { name: "Test", serviceCount: 1, totalNodes: 10, totalEdges: 5 },
    nodes: [],
    edges: [],
    serviceIndex: {
      "my-service": { hasKg: true, basePath: "my-service" },
    },
  }))

  const svcUa = path.join(dir, "my-service", ".understand-anything")
  const extraction = path.join(svcUa, "intermediate", "extraction")
  fs.mkdirSync(extraction, { recursive: true })
  fs.writeFileSync(
    path.join(extraction, "structural-analysis.json"),
    JSON.stringify(SAMPLE_STRUCTURE),
  )
}

describe("handleStructureRequest", () => {
  let dir: string

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "struct-api-"))
    process.chdir(dir)
    seedStructure(dir)
  })

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it("returns null for non-matching routes", async () => {
    const res = await handleStructureRequest(makeReq("/api/search"), mockCtx)
    expect(res).toBeNull()
  })

  // --- /api/structure/files ---

  it("requires service param for /api/structure/files", async () => {
    const res = await handleStructureRequest(makeReq("/api/structure/files"), mockCtx)
    expect(res).not.toBeNull()
    expect(res!.statusCode).toBe(400)
    expect((res!.body as { code: string }).code).toBe("SERVICE_REQUIRED")
  })

  it("returns file list", async () => {
    const res = await handleStructureRequest(
      makeReq("/api/structure/files", { service: "my-service" }),
      mockCtx,
    )
    expect(res).not.toBeNull()
    expect(res!.statusCode).toBe(200)
    const body = res!.body as { files: string[]; total: number }
    expect(body.total).toBe(3)
    expect(body.files).toContain("svc/src/main/java/com/example/user/UserService.java")
    expect(body.files).toContain("svc/src/main/java/com/example/order/OrderController.java")
  })

  it("returns 404 when structural-analysis.json not found", async () => {
    const res = await handleStructureRequest(
      makeReq("/api/structure/files", { service: "nonexistent" }),
      mockCtx,
    )
    expect(res).not.toBeNull()
    expect(res!.statusCode).toBe(404)
  })

  // --- /api/structure/file ---

  it("requires service and path for /api/structure/file", async () => {
    const res = await handleStructureRequest(makeReq("/api/structure/file"), mockCtx)
    expect(res!.statusCode).toBe(400)
  })

  it("returns file structure by exact path", async () => {
    const res = await handleStructureRequest(
      makeReq("/api/structure/file", {
        service: "my-service",
        path: "svc/src/main/java/com/example/user/UserService.java",
      }),
      mockCtx,
    )
    expect(res!.statusCode).toBe(200)
    const body = res!.body as {
      filePath: string
      language: string
      functions: Array<{ name: string; params: Array<{ name: string; type: string }> }>
      classes: Array<{ name: string; annotations: Array<{ name: string }> }>
    }
    expect(body.filePath).toBe("svc/src/main/java/com/example/user/UserService.java")
    expect(body.language).toBe("java")
    expect(body.functions).toHaveLength(2)
    expect(body.functions[0].name).toBe("findById")
    expect(body.functions[0].params[0].type).toBe("Long")
    expect(body.classes[0].annotations).toHaveLength(2)
  })

  it("supports suffix match for unique file name", async () => {
    const res = await handleStructureRequest(
      makeReq("/api/structure/file", {
        service: "my-service",
        path: "OrderController.java",
      }),
      mockCtx,
    )
    expect(res!.statusCode).toBe(200)
    const body = res!.body as { filePath: string }
    expect(body.filePath).toContain("OrderController.java")
  })

  it("returns 300 for ambiguous suffix match with multiple candidates", async () => {
    const res = await handleStructureRequest(
      makeReq("/api/structure/file", {
        service: "my-service",
        path: ".java",
      }),
      mockCtx,
    )
    expect(res!.statusCode).toBe(300)
    const body = res!.body as { error: string; candidates: string[] }
    expect(body.candidates.length).toBeGreaterThan(1)
  })

  it("returns 404 for non-existent file path", async () => {
    const res = await handleStructureRequest(
      makeReq("/api/structure/file", {
        service: "my-service",
        path: "NonExistent.java",
      }),
      mockCtx,
    )
    expect(res!.statusCode).toBe(404)
    const body = res!.body as { error: string; suggestions?: Array<{ path: string }> }
    expect(body.error).toContain("not found")
  })

  // --- /api/structure/search ---

  it("requires service and at least one filter for search", async () => {
    const res = await handleStructureRequest(
      makeReq("/api/structure/search", { service: "my-service" }),
      mockCtx,
    )
    expect(res!.statusCode).toBe(400)
  })

  it("searches by annotation", async () => {
    const res = await handleStructureRequest(
      makeReq("/api/structure/search", { service: "my-service", annotation: "MoaProvider" }),
      mockCtx,
    )
    expect(res!.statusCode).toBe(200)
    const body = res!.body as {
      results: Array<{ filePath: string; name: string; kind: string }>
      total: number
    }
    expect(body.total).toBeGreaterThanOrEqual(1)
    const names = body.results.map((r) => r.name)
    expect(names).toContain("OrderController")
  })

  it("searches by annotation — matches function-level annotations", async () => {
    const res = await handleStructureRequest(
      makeReq("/api/structure/search", { service: "my-service", annotation: "Transactional" }),
      mockCtx,
    )
    expect(res!.statusCode).toBe(200)
    const body = res!.body as { results: Array<{ name: string; kind: string }> }
    const fn = body.results.find((r) => r.name === "createUser")
    expect(fn).toBeDefined()
    expect(fn!.kind).toBe("function")
  })

  it("searches by paramType", async () => {
    const res = await handleStructureRequest(
      makeReq("/api/structure/search", { service: "my-service", paramType: "OrderDTO" }),
      mockCtx,
    )
    expect(res!.statusCode).toBe(200)
    const body = res!.body as { results: Array<{ name: string; filePath: string }> }
    expect(body.results).toHaveLength(1)
    expect(body.results[0].name).toBe("placeOrder")
    expect(body.results[0].filePath).toContain("OrderController.java")
  })

  it("searches by returnType", async () => {
    const res = await handleStructureRequest(
      makeReq("/api/structure/search", { service: "my-service", returnType: "UserDTO" }),
      mockCtx,
    )
    expect(res!.statusCode).toBe(200)
    const body = res!.body as { results: Array<{ name: string }> }
    const names = body.results.map((r) => r.name)
    expect(names).toContain("findById")
    expect(names).toContain("createUser")
  })

  it("searches by interface", async () => {
    const res = await handleStructureRequest(
      makeReq("/api/structure/search", { service: "my-service", interface: "Serializable" }),
      mockCtx,
    )
    expect(res!.statusCode).toBe(200)
    const body = res!.body as { results: Array<{ name: string; kind: string }> }
    expect(body.results).toHaveLength(1)
    expect(body.results[0].name).toBe("UserDTO")
    expect(body.results[0].kind).toBe("class")
  })

  it("searches by property type", async () => {
    const res = await handleStructureRequest(
      makeReq("/api/structure/search", { service: "my-service", propertyType: "UserRepository" }),
      mockCtx,
    )
    expect(res!.statusCode).toBe(200)
    const body = res!.body as { results: Array<{ name: string }> }
    expect(body.results).toHaveLength(1)
    expect(body.results[0].name).toBe("UserService")
  })

  it("supports pathPattern filter to narrow results", async () => {
    const res = await handleStructureRequest(
      makeReq("/api/structure/search", {
        service: "my-service",
        annotation: "MoaProvider",
        pathPattern: "order",
      }),
      mockCtx,
    )
    expect(res!.statusCode).toBe(200)
    const body = res!.body as { results: Array<{ filePath: string }> }
    expect(body.results.length).toBeGreaterThanOrEqual(1)
    for (const r of body.results) {
      expect(r.filePath.toLowerCase()).toContain("order")
    }
  })

  it("supports limit param", async () => {
    const res = await handleStructureRequest(
      makeReq("/api/structure/search", {
        service: "my-service",
        annotation: "Data",
        limit: "1",
      }),
      mockCtx,
    )
    expect(res!.statusCode).toBe(200)
    const body = res!.body as { results: unknown[]; total: number; hasMore: boolean }
    expect(body.results).toHaveLength(1)
  })

  // --- path traversal safety ---

  it("rejects path traversal in service name", async () => {
    const res = await handleStructureRequest(
      makeReq("/api/structure/files", { service: "../etc" }),
      mockCtx,
    )
    expect(res!.statusCode).toBe(400)
    expect((res!.body as { code: string }).code).toBe("INVALID_SERVICE_NAME")
  })
})
