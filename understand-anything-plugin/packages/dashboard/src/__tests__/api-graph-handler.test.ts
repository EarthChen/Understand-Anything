import { describe, it, expect, beforeEach, afterEach } from "vitest"
import fs from "fs"
import path from "path"
import os from "os"
import { handleGraphRequest } from "../api/handlers/graph"

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "api-graph-"))
}

function writeJson(filePath: string, data: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, JSON.stringify(data))
}

const ctx = { accessToken: "tok", getWikiService: () => { throw new Error("unused") } }

describe("handleGraphRequest", () => {
  let dir: string
  let origCwd: string

  beforeEach(() => {
    dir = fs.realpathSync.native(tmpDir())
    origCwd = process.cwd()
    process.chdir(dir)
  })

  afterEach(() => {
    process.chdir(origCwd)
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it("serves knowledge-graph.json with relativised filePaths", async () => {
    const abs = path.join(dir, "src", "Order.java")
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    fs.writeFileSync(abs, "// stub")
    writeJson(path.join(dir, ".understand-anything", "knowledge-graph.json"), {
      nodes: [{ id: "n1", filePath: abs }],
    })
    const res = await handleGraphRequest(
      { pathname: "/knowledge-graph.json", searchParams: new URLSearchParams() },
      ctx,
    )
    expect(res?.statusCode).toBe(200)
    const body = res?.body as { nodes: Array<{ filePath: string }> }
    expect(body.nodes[0].filePath).toBe("src/Order.java")
  })

  it("returns 404 when knowledge-graph.json missing", async () => {
    const res = await handleGraphRequest(
      { pathname: "/knowledge-graph.json", searchParams: new URLSearchParams() },
      ctx,
    )
    expect(res?.statusCode).toBe(404)
    expect((res?.body as { error: string }).error).toMatch(/No knowledge graph/)
  })

  it("serves /api/graph for a named service", async () => {
    writeJson(
      path.join(dir, "order-service", ".understand-anything", "knowledge-graph.json"),
      { nodes: [{ id: "svc-node" }] },
    )
    const res = await handleGraphRequest(
      {
        pathname: "/api/graph",
        searchParams: new URLSearchParams({ service: "order-service", file: "knowledge-graph.json" }),
      },
      ctx,
    )
    expect(res?.statusCode).toBe(200)
    expect((res?.body as { nodes: unknown[] }).nodes).toHaveLength(1)
  })

  it("returns default config when config.json missing", async () => {
    const res = await handleGraphRequest(
      { pathname: "/config.json", searchParams: new URLSearchParams() },
      ctx,
    )
    expect(res?.statusCode).toBe(200)
    expect(res?.body).toEqual({ autoUpdate: false, outputLanguage: "en" })
  })

  it("/api/meta returns 200 with proper shape", async () => {
    writeJson(path.join(dir, ".understand-anything", "meta.json"), {
      lastAnalyzedAt: "2026-01-01T00:00:00Z",
      gitCommitHash: "abc123",
      analyzedFiles: 42,
    })
    writeJson(path.join(dir, ".understand-anything", "knowledge-graph.json"), {
      nodes: [{ id: "n1" }, { id: "n2" }],
      edges: [{ id: "e1" }],
    })
    writeJson(path.join(dir, ".understand-anything", "domain-graph.json"), {
      nodes: [{ id: "d1" }],
      edges: [],
    })
    writeJson(path.join(dir, ".understand-anything", "wiki", "meta.json"), {
      generatedAt: "2026-01-02T00:00:00Z",
      serviceCount: 3,
      qualityScore: { overallGrade: "A" },
    })
    writeJson(path.join(dir, ".understand-anything", "business-landscape", "meta.json"), {
      generatedAt: "2026-01-03T00:00:00Z",
      status: "complete",
    })
    writeJson(path.join(dir, ".understand-anything", "business-landscape", "domains.json"), {
      domains: [{ id: "dom1" }, { id: "dom2" }],
    })
    writeJson(path.join(dir, ".understand-anything", "system-graph.json"), {
      project: { name: "test-project", description: "A test project" },
    })

    const res = await handleGraphRequest(
      { pathname: "/api/meta", searchParams: new URLSearchParams() },
      ctx,
    )
    expect(res?.statusCode).toBe(200)
    const body = res?.body as {
      project: { name: string; description?: string }
      layers: {
        kg: { available: boolean; commit?: string; nodeCount?: number; edgeCount?: number }
        domain: { available: boolean; nodeCount?: number; edgeCount?: number }
        wiki: { available: boolean; qualityGrade?: string; serviceCount?: number }
        business: { available: boolean; status?: string; domainCount?: number }
      }
      freshness: { currentCommit: string; stale: string[] }
    }
    expect(body.project.name).toBe("test-project")
    expect(body.project.description).toBe("A test project")
    expect(body.layers.kg.available).toBe(true)
    expect(body.layers.kg.commit).toBe("abc123")
    expect(body.layers.kg.nodeCount).toBe(2)
    expect(body.layers.kg.edgeCount).toBe(1)
    expect(body.layers.domain.available).toBe(true)
    expect(body.layers.domain.nodeCount).toBe(1)
    expect(body.layers.wiki.available).toBe(true)
    expect(body.layers.wiki.qualityGrade).toBe("A")
    expect(body.layers.wiki.serviceCount).toBe(3)
    expect(body.layers.business.available).toBe(true)
    expect(body.layers.business.status).toBe("complete")
    expect(body.layers.business.domainCount).toBe(2)
    expect(body.freshness).toBeDefined()
    expect(typeof body.freshness.currentCommit).toBe("string")
    expect(Array.isArray(body.freshness.stale)).toBe(true)
  })

  it("/api/meta does not crash in non-git environment", async () => {
    const res = await handleGraphRequest(
      { pathname: "/api/meta", searchParams: new URLSearchParams() },
      ctx,
    )
    expect(res?.statusCode).toBe(200)
    const body = res?.body as { freshness: { currentCommit: string; stale: string[] } }
    expect(body.freshness.currentCommit).toBe("")
    expect(body.freshness.stale).toEqual([])
  })
})
