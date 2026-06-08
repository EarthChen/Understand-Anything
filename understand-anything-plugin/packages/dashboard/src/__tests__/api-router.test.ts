import { describe, it, expect, beforeEach, afterEach } from "vitest"
import fs from "fs"
import path from "path"
import os from "os"
import { createApiRouter } from "../api/index"
import { WikiDataService } from "../../wiki-api"

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
      { pathname: "/index.html", searchParams: new URLSearchParams("token=t") },
      { accessToken: "t", getWikiService: () => new WikiDataService(dir) },
    )
    expect(res).toBeNull()
  })

  it("returns 403 without token on protected path", async () => {
    const res = await router.handle(
      { pathname: "/knowledge-graph.json", searchParams: new URLSearchParams() },
      { accessToken: "secret", getWikiService: () => new WikiDataService(dir) },
    )
    expect(res?.statusCode).toBe(403)
  })

  it("dispatches to graph handler with valid token", async () => {
    const res = await router.handle(
      { pathname: "/knowledge-graph.json", searchParams: new URLSearchParams("token=secret") },
      { accessToken: "secret", getWikiService: () => new WikiDataService(dir) },
    )
    expect(res?.statusCode).toBe(200)
  })
})
