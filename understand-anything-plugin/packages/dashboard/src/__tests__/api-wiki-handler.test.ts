import { describe, it, expect, beforeEach, afterEach } from "vitest"
import fs from "fs"
import path from "path"
import os from "os"
import { WikiDataService } from "../../wiki-api"
import { handleWikiRequest } from "../api/handlers/wiki"
import { handleSourceRequest } from "../api/handlers/source"
import { isProtectedPath, validateToken } from "../api/handlers/auth"

function tmpDir(): string {
  return fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "api-wiki-")))
}

function writeJson(p: string, d: unknown): void {
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, JSON.stringify(d))
}

describe("auth handler", () => {
  it("marks /api/wiki and /knowledge-graph.json as protected", () => {
    expect(isProtectedPath("/api/wiki/search")).toBe(true)
    expect(isProtectedPath("/knowledge-graph.json")).toBe(true)
    expect(isProtectedPath("/assets/logo.svg")).toBe(false)
  })

  it("validateToken returns 403 on mismatch", () => {
    const res = validateToken(new URLSearchParams("token=bad"), "good")
    expect(res?.statusCode).toBe(403)
  })

  it("validateToken returns null on match", () => {
    expect(validateToken(new URLSearchParams("token=good"), "good")).toBeNull()
  })
})

describe("wiki handler", () => {
  let dir: string
  let origCwd: string
  let svc: WikiDataService
  const ctx = {
    accessToken: "t",
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
})

describe("source handler", () => {
  let dir: string
  let origCwd: string
  const ctx = { accessToken: "t", getWikiService: () => new WikiDataService(dir) }

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
