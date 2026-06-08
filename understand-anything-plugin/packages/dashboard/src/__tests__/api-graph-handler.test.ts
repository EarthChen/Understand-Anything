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
})
