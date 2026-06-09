import { describe, it, expect, beforeEach, afterEach } from "vitest"
import fs from "fs"
import path from "path"
import os from "os"
import { handleServicesRequest } from "../api/handlers/services"
import type { ApiRequest, ApiContext } from "../api/types"

const mockCtx = { getWikiService: () => { throw new Error("unused") } } as unknown as ApiContext

function makeReq(pathname: string, params: Record<string, string> = {}): ApiRequest {
  return { pathname, searchParams: new URLSearchParams(params) }
}

function seedServices(dir: string) {
  const ua = path.join(dir, ".understand-anything")
  fs.mkdirSync(ua, { recursive: true })
  fs.writeFileSync(path.join(ua, "knowledge-graph.json"), JSON.stringify({ nodes: [] }))
  fs.writeFileSync(path.join(ua, "system-graph.json"), JSON.stringify({
    version: "1.0.0",
    generatedAt: "2026-06-04T12:00:00Z",
    project: { name: "Test", serviceCount: 2, totalNodes: 100, totalEdges: 50 },
    nodes: [],
    edges: [],
    serviceIndex: {
      "order-service": {
        hasKg: true,
        hasWiki: true,
        hasDomain: true,
        basePath: "order-service",
        facet: "server",
      },
      "payment-service": {
        hasKg: true,
        hasWiki: false,
        hasDomain: false,
        basePath: "payment-service",
      },
    },
  }))

  const orderUa = path.join(dir, "order-service", ".understand-anything")
  fs.mkdirSync(path.join(orderUa, "wiki"), { recursive: true })
  fs.writeFileSync(path.join(orderUa, "meta.json"), JSON.stringify({
    lastAnalyzedAt: "2026-06-01T10:00:00Z",
    gitCommitHash: "abc123",
  }))
  fs.writeFileSync(path.join(orderUa, "wiki", "meta.json"), JSON.stringify({
    generatedAt: "2026-06-02T10:00:00Z",
    qualityScore: { overallGrade: "A" },
  }))
  fs.writeFileSync(path.join(orderUa, "domain-graph.json"), JSON.stringify({
    nodes: [{ id: "n1" }, { id: "n2" }],
  }))

  const paymentUa = path.join(dir, "payment-service", ".understand-anything")
  fs.mkdirSync(paymentUa, { recursive: true })
  fs.writeFileSync(path.join(paymentUa, "meta.json"), JSON.stringify({
    lastAnalyzedAt: "2026-06-01T11:00:00Z",
    gitCommitHash: "def456",
  }))

  const bl = path.join(ua, "business-landscape")
  fs.mkdirSync(bl, { recursive: true })
  fs.writeFileSync(path.join(bl, "domains.json"), JSON.stringify({
    domains: [{ id: "d1" }, { id: "d2" }],
  }))
}

describe("handleServicesRequest", () => {
  let dir: string

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "svc-api-"))
    process.chdir(dir)
    seedServices(dir)
  })

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it("returns null for non-matching routes", async () => {
    const res = await handleServicesRequest(makeReq("/api/wiki"), mockCtx)
    expect(res).toBeNull()
  })

  it("returns services list from system-graph serviceIndex", async () => {
    const res = await handleServicesRequest(makeReq("/api/services"), mockCtx)
    expect(res).not.toBeNull()
    expect(res!.statusCode).toBe(200)
    const body = res!.body as { services: Array<{ name: string; dataLayers: Record<string, unknown> }>; totalServices: number }
    expect(body).toHaveProperty("services")
    expect(body).toHaveProperty("totalServices")
    expect(body.totalServices).toBe(2)
    expect(body.services).toHaveLength(2)

    const order = body.services.find((s) => s.name === "order-service")
    expect(order).toBeDefined()
    expect(order!.dataLayers.kg).toMatchObject({ available: true, commit: "abc123", analyzedAt: "2026-06-01T10:00:00Z" })
    expect(order!.dataLayers.wiki).toMatchObject({ available: true, qualityGrade: "A", generatedAt: "2026-06-02T10:00:00Z" })
    expect(order!.dataLayers.domain).toMatchObject({ available: true, nodeCount: 2 })
    expect(order!.dataLayers.business).toMatchObject({ available: true, domainCount: 2 })
  })

  it("filters by name param", async () => {
    const res = await handleServicesRequest(makeReq("/api/services", { name: "order-service" }), mockCtx)
    expect(res!.statusCode).toBe(200)
    const body = res!.body as { services: Array<{ name: string }>; totalServices: number }
    expect(body.services).toHaveLength(1)
    expect(body.services[0].name).toBe("order-service")
    expect(body.totalServices).toBe(1)
  })

  it("filters by has param", async () => {
    const res = await handleServicesRequest(makeReq("/api/services", { has: "wiki,kg" }), mockCtx)
    expect(res!.statusCode).toBe(200)
    const body = res!.body as { services: Array<{ name: string }>; totalServices: number }
    expect(body.services).toHaveLength(1)
    expect(body.services[0].name).toBe("order-service")
    expect(body.totalServices).toBe(1)
  })

  it("returns 404 when system-graph not found", async () => {
    fs.unlinkSync(path.join(dir, ".understand-anything", "system-graph.json"))
    const res = await handleServicesRequest(makeReq("/api/services"), mockCtx)
    expect(res!.statusCode).toBe(404)
    expect((res!.body as { error: string }).error).toContain("system-graph.json not found")
  })
})
