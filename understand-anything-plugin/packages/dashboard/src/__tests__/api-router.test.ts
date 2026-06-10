import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import fs from "fs"
import path from "path"
import os from "os"
import { createApiRouter } from "../api/index"
import { WikiDataService } from "../../wiki-api"

const ctx = (dir: string) => ({ getWikiService: () => new WikiDataService(dir) })

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "api-router-"))
}
function writeJson(p: string, d: unknown) {
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, JSON.stringify(d))
}

describe("createApiRouter", () => {
  let dir: string
  let router: ReturnType<typeof createApiRouter>

  beforeEach(() => {
    dir = tmpDir()
    process.chdir(dir)
    writeJson(path.join(dir, ".understand-anything/knowledge-graph.json"), { nodes: [] })
    router = createApiRouter()
  })

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it("returns null for unhandled paths", async () => {
    const res = await router.handle(
      { pathname: "/index.html", searchParams: new URLSearchParams() },
      { getWikiService: () => new WikiDataService(dir) },
    )
    expect(res).toBeNull()
  })

  it("serves protected paths without requiring a token", async () => {
    const res = await router.handle(
      { pathname: "/knowledge-graph.json", searchParams: new URLSearchParams() },
      { getWikiService: () => new WikiDataService(dir) },
    )
    expect(res?.statusCode).toBe(200)
  })

  it("dispatches to graph handler", async () => {
    const res = await router.handle(
      { pathname: "/knowledge-graph.json", searchParams: new URLSearchParams() },
      { getWikiService: () => new WikiDataService(dir) },
    )
    expect(res?.statusCode).toBe(200)
  })

  it("GET /api/search returns JSON when one service has corrupt KG data", async () => {
    const ua = path.join(dir, ".understand-anything")
    writeJson(path.join(ua, "system-graph.json"), {
      version: "1.0.0",
      generatedAt: "2026-06-04T12:00:00Z",
      project: { name: "Test", serviceCount: 2, totalNodes: 2, totalEdges: 0 },
      nodes: [],
      edges: [],
      serviceIndex: {
        "good-service": { hasKg: true, basePath: "good-service" },
        "bad-service": { hasKg: true, basePath: "bad-service" },
      },
    })

    writeJson(path.join(dir, "good-service", ".understand-anything", "knowledge-graph.json"), {
      nodes: [
        {
          id: "class:ClosedFriend",
          name: "ClosedFriend",
          type: "class",
          summary: "Friend with restricted visibility",
        },
      ],
    })
    fs.mkdirSync(path.join(dir, "bad-service", ".understand-anything"), { recursive: true })
    fs.writeFileSync(
      path.join(dir, "bad-service", ".understand-anything", "knowledge-graph.json"),
      "{ invalid json",
    )
    writeJson(path.join(dir, "bad-service", ".understand-anything", "wiki", "index.json"), {
      entries: [{ id: "wiki:1", name: "broken", type: "page", summary: "x" }],
    })

    const res = await router.handle(
      {
        pathname: "/api/search",
        searchParams: new URLSearchParams({ q: "ClosedFriend" }),
      },
      { getWikiService: () => new WikiDataService(dir) },
    )

    expect(res).not.toBeNull()
    expect(res?.statusCode).toBe(200)
    const body = res?.body as { results: Array<{ name: string }>; total: number; query: string }
    expect(body.query).toBe("ClosedFriend")
    expect(body.results.some((r) => r.name === "ClosedFriend")).toBe(true)
  })

  it("GET /api/search skips service when KG shape is invalid", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    const ua = path.join(dir, ".understand-anything")
    writeJson(path.join(ua, "system-graph.json"), {
      version: "1.0.0",
      generatedAt: "2026-06-04T12:00:00Z",
      project: { name: "Test", serviceCount: 2, totalNodes: 1, totalEdges: 0 },
      nodes: [],
      edges: [],
      serviceIndex: {
        "good-service": { hasKg: true, basePath: "good-service" },
        "malformed-service": { hasKg: true, basePath: "malformed-service" },
      },
    })

    writeJson(path.join(dir, "good-service", ".understand-anything", "knowledge-graph.json"), {
      nodes: [{ id: "class:Foo", name: "Foo", type: "class", summary: "Valid node" }],
    })
    writeJson(path.join(dir, "malformed-service", ".understand-anything", "knowledge-graph.json"), {
      edges: [],
    })

    const res = await router.handle(
      {
        pathname: "/api/search",
        searchParams: new URLSearchParams({ q: "Foo" }),
      },
      { getWikiService: () => new WikiDataService(dir) },
    )

    expect(res?.statusCode).toBe(200)
    const body = res?.body as { results: Array<{ name: string }> }
    expect(body.results.some((r) => r.name === "Foo")).toBe(true)
    expect(warnSpy).toHaveBeenCalledWith(
      '[search] KG data missing nodes array for service "malformed-service"',
    )
    warnSpy.mockRestore()
  })

  it("returns wiki-scoped results from /api/search?scope=wiki", async () => {
    writeJson(path.join(dir, ".understand-anything", "wiki", "index.json"), {
      entries: [
        {
          id: "wiki:order-mgmt",
          name: "Order Management",
          type: "domain",
          summary: "Handles order lifecycle",
        },
      ],
    })

    const res = await router.handle(
      {
        pathname: "/api/search",
        searchParams: new URLSearchParams({ q: "order", scope: "wiki" }),
      },
      ctx(dir),
    )

    expect(res?.statusCode).toBe(200)
    const body = res?.body as { results: Array<{ layer: string; name: string }> }
    expect(body.results).toBeDefined()
    expect(body.results.length).toBeGreaterThan(0)
    for (const r of body.results) {
      expect(r.layer).toBe("wiki")
    }
  })

  it("/api/wiki/search returns results (backward compat)", async () => {
    writeJson(path.join(dir, ".understand-anything", "wiki", "index.json"), {
      entries: [
        {
          id: "wiki:order-mgmt",
          name: "Order Management",
          type: "domain",
          summary: "Handles order lifecycle",
        },
      ],
    })

    const res = await router.handle(
      {
        pathname: "/api/wiki/search",
        searchParams: new URLSearchParams({ q: "order" }),
      },
      ctx(dir),
    )

    expect(res?.statusCode).toBe(200)
    expect(Array.isArray(res?.body)).toBe(true)
    const results = res?.body as Array<{ name: string }>
    expect(results.some((r) => r.name === "Order Management")).toBe(true)
  })

  it("rejects service parameter with path traversal in /api/source", async () => {
    const res = await router.handle(
      {
        pathname: "/api/source",
        searchParams: new URLSearchParams({ file: "test.java", service: "../../../etc" }),
      },
      ctx(dir),
    )
    expect(res?.statusCode).toBe(400)
    expect((res?.body as { error: string }).error).toContain("invalid service name")
  })

  it("rejects system-graph basePath that escapes project root in /api/source", async () => {
    const escapedDir = path.join(path.dirname(dir), `escaped-${path.basename(dir)}`)
    fs.mkdirSync(path.join(escapedDir, "src"), { recursive: true })
    fs.writeFileSync(path.join(escapedDir, "src", "secret.ts"), "SECRET_FROM_ESCAPED")
    fs.mkdirSync(path.join(escapedDir, ".understand-anything"), { recursive: true })
    writeJson(path.join(escapedDir, ".understand-anything", "knowledge-graph.json"), { nodes: [] })

    writeJson(path.join(dir, ".understand-anything", "system-graph.json"), {
      serviceIndex: {
        "evil-service": { basePath: "../" + path.basename(escapedDir) },
      },
    })

    const res = await router.handle(
      {
        pathname: "/api/source",
        searchParams: new URLSearchParams({ file: "src/secret.ts", service: "evil-service" }),
      },
      ctx(dir),
    )

    expect(res?.statusCode).not.toBe(200)
    fs.rmSync(escapedDir, { recursive: true, force: true })
  })

  describe("fuzzy search", () => {
    function setupAuthService() {
      writeJson(path.join(dir, ".understand-anything/system-graph.json"), {
        serviceIndex: {
          "auth-svc": { hasKg: true, basePath: "services/auth" },
        },
      })
      writeJson(path.join(dir, "services/auth/.understand-anything/knowledge-graph.json"), {
        nodes: [
          {
            id: "n1",
            name: "AuthenticationService",
            type: "class",
            summary: "Handles user auth",
            tags: [],
          },
          {
            id: "n2",
            name: "UserRepository",
            type: "class",
            summary: "User data access",
            tags: [],
          },
        ],
        edges: [],
      })
    }

    it("finds results with typos via trigram matching", async () => {
      setupAuthService()

      const res = await router.handle(
        { pathname: "/api/search", searchParams: new URLSearchParams("q=Authentcation") },
        ctx(dir),
      )
      expect(res?.statusCode).toBe(200)
      const body = res?.body as { results: Array<{ name: string }> }
      expect(body.results.length).toBeGreaterThan(0)
      expect(body.results[0].name).toBe("AuthenticationService")
    })

    it("finds results with prefix matching", async () => {
      setupAuthService()

      const res = await router.handle(
        { pathname: "/api/search", searchParams: new URLSearchParams("q=Auth") },
        ctx(dir),
      )
      expect(res?.statusCode).toBe(200)
      const body = res?.body as { results: Array<{ name: string }> }
      expect(body.results.length).toBeGreaterThan(0)
      expect(body.results[0].name).toBe("AuthenticationService")
    })
  })

  describe("RRF fusion search", () => {
    it("discovers graph-connected nodes via fusion=rrf", async () => {
      writeJson(path.join(dir, ".understand-anything/system-graph.json"), {
        serviceIndex: {
          "auth-svc": { hasKg: true, basePath: "services/auth" },
        },
      })
      writeJson(path.join(dir, "services/auth/.understand-anything/knowledge-graph.json"), {
        nodes: [
          { id: "auth-svc", name: "AuthService", type: "class", summary: "Authentication logic" },
          { id: "user-repo", name: "UserRepository", type: "class", summary: "Database access layer" },
          { id: "token-gen", name: "TokenGenerator", type: "class", summary: "JWT token creation" },
        ],
        edges: [
          { source: "auth-svc", target: "user-repo", type: "calls" },
          { source: "auth-svc", target: "token-gen", type: "calls" },
        ],
      })

      const noRrf = await router.handle(
        { pathname: "/api/search", searchParams: new URLSearchParams("q=Authentication") },
        ctx(dir),
      )
      expect(noRrf?.statusCode).toBe(200)

      const withRrf = await router.handle(
        { pathname: "/api/search", searchParams: new URLSearchParams("q=Authentication&fusion=rrf") },
        ctx(dir),
      )
      expect(withRrf?.statusCode).toBe(200)
      const rrfBody = withRrf?.body as { results: Array<{ id: string }> }
      expect(rrfBody.results.length).toBeGreaterThanOrEqual(1)

      const rrfIds = rrfBody.results.map((r) => r.id)
      expect(rrfIds).toContain("auth-svc")
    })

    it("returns 400 for invalid fusion value", async () => {
      const res = await router.handle(
        { pathname: "/api/search", searchParams: new URLSearchParams("q=test&fusion=invalid") },
        ctx(dir),
      )
      expect(res?.statusCode).toBe(400)
    })

    it("fusion=none behaves same as default", async () => {
      writeJson(path.join(dir, ".understand-anything/system-graph.json"), {
        serviceIndex: {
          svc: { hasKg: true, basePath: "services/svc" },
        },
      })
      writeJson(path.join(dir, "services/svc/.understand-anything/knowledge-graph.json"), {
        nodes: [{ id: "n1", name: "TestClass", type: "class", summary: "A test" }],
        edges: [],
      })

      const defaultRes = await router.handle(
        { pathname: "/api/search", searchParams: new URLSearchParams("q=TestClass") },
        ctx(dir),
      )
      const noneRes = await router.handle(
        { pathname: "/api/search", searchParams: new URLSearchParams("q=TestClass&fusion=none") },
        ctx(dir),
      )

      expect(defaultRes?.body).toEqual(noneRes?.body)
    })
  })

  it("GET /api/search normalizes absolute filePaths to relative", async () => {
    const prevGraphDir = process.env.GRAPH_DIR
    process.env.GRAPH_DIR = dir
    try {
      const absFilePath = path.join(dir, "src", "MyClass.java")
      fs.mkdirSync(path.dirname(absFilePath), { recursive: true })
      fs.writeFileSync(absFilePath, "class MyClass {}")

      writeJson(path.join(dir, ".understand-anything", "system-graph.json"), {
        serviceIndex: {
          "my-service": { hasKg: true, basePath: "my-service" },
        },
      })
      writeJson(path.join(dir, "my-service", ".understand-anything", "knowledge-graph.json"), {
        nodes: [
          {
            id: "class:MyClass",
            name: "MyClass",
            type: "class",
            summary: "A test class",
            filePath: absFilePath,
          },
        ],
      })

      const res = await router.handle(
        {
          pathname: "/api/search",
          searchParams: new URLSearchParams({ q: "MyClass" }),
        },
        ctx(dir),
      )

      expect(res?.statusCode).toBe(200)
      const body = res?.body as { results: Array<{ name: string; filePath?: string }> }
      const result = body.results.find((r) => r.name === "MyClass")
      expect(result?.filePath).toBeDefined()
      expect(path.isAbsolute(result!.filePath!)).toBe(false)
      expect(result?.filePath).toBe("src/MyClass.java")
    } finally {
      if (prevGraphDir === undefined) delete process.env.GRAPH_DIR
      else process.env.GRAPH_DIR = prevGraphDir
    }
  })
})
