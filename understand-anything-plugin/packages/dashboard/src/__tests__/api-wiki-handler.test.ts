import { describe, it, expect, beforeEach, afterEach } from "vitest"
import fs from "fs"
import path from "path"
import os from "os"
import { WikiDataService } from "../../wiki-api"
import { handleWikiRequest } from "../api/handlers/wiki"
import { handleSourceRequest } from "../api/handlers/source"
function tmpDir(): string {
  return fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "api-wiki-")))
}

function writeJson(p: string, d: unknown): void {
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, JSON.stringify(d))
}

describe("wiki handler", () => {
  let dir: string
  let origCwd: string
  let svc: WikiDataService
  const ctx = {
    getWikiService: () => svc,
  }

  beforeEach(() => {
    dir = tmpDir()
    origCwd = process.cwd()
    process.chdir(dir)
    writeJson(path.join(dir, ".understand-anything/wiki/meta.json"), {
      gitCommitHash: "a", generatedAt: "t", version: "1", outputLanguage: "en", serviceCount: 0,
    })
    writeJson(path.join(dir, ".understand-anything/wiki/overview.json"), { name: "Parent" })
    svc = new WikiDataService(dir)
    ctx.getWikiService = () => svc
  })

  afterEach(() => {
    process.chdir(origCwd)
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it("GET /api/wiki/ returns global index", async () => {
    const res = await handleWikiRequest({ pathname: "/api/wiki", searchParams: new URLSearchParams() }, ctx)
    expect(res?.statusCode).toBe(200)
    expect((res?.body as { entries: unknown[] }).entries).toBeDefined()
  })

  it("GET /api/wiki/overview returns overview", async () => {
    const res = await handleWikiRequest({ pathname: "/api/wiki/overview", searchParams: new URLSearchParams() }, ctx)
    expect(res?.statusCode).toBe(200)
    expect((res?.body as { name: string }).name).toBe("Parent")
  })

  it("blocks null byte injection in /wiki/ path", async () => {
    const res = await handleWikiRequest(
      { pathname: "/wiki/foo\0../../etc/passwd", searchParams: new URLSearchParams() },
      ctx,
    )
    expect(res?.statusCode).toBe(400)
  })

  it("blocks tilde expansion in /wiki/ path", async () => {
    const res = await handleWikiRequest(
      { pathname: "/wiki/~/etc/passwd", searchParams: new URLSearchParams() },
      ctx,
    )
    expect(res?.statusCode).toBe(400)
  })

  it("blocks path traversal escaping wiki directory", async () => {
    const res = await handleWikiRequest(
      { pathname: "/wiki/../../etc/passwd", searchParams: new URLSearchParams() },
      ctx,
    )
    expect(res?.statusCode).toBe(400)
  })
})

describe("source handler", () => {
  let dir: string
  let origCwd: string
  const ctx = { getWikiService: () => new WikiDataService(dir) }

  beforeEach(() => {
    dir = tmpDir()
    origCwd = process.cwd()
    process.chdir(dir)
    writeJson(path.join(dir, ".understand-anything/knowledge-graph.json"), { nodes: [] })
    fs.mkdirSync(path.join(dir, "src"), { recursive: true })
    fs.writeFileSync(path.join(dir, "src", "App.ts"), "line1\nline2\n")
  })

  afterEach(() => {
    process.chdir(origCwd)
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it("reads source file via /api/source", async () => {
    const res = await handleSourceRequest(
      { pathname: "/api/source", searchParams: new URLSearchParams({ file: "src/App.ts" }) },
      ctx,
    )
    expect(res?.statusCode).toBe(200)
    expect((res?.body as { content: string }).content).toContain("line1")
  })
})
