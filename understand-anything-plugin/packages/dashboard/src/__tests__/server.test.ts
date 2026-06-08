import { describe, it, expect, beforeEach, afterEach } from "vitest"
import fs from "fs"
import path from "path"
import os from "os"
import request from "supertest"
import { createApp } from "../../server"

function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), "server-")) }
function writeJson(p: string, d: unknown) {
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, JSON.stringify(d))
}

describe("standalone Express server", () => {
  let dir: string

  beforeEach(() => {
    dir = tmpDir()
    process.chdir(dir)
    writeJson(path.join(dir, ".understand-anything/knowledge-graph.json"), {
      project: { name: "Test" },
      nodes: [],
      edges: [],
      layers: [],
    })
  })

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it("serves knowledge-graph.json without token", async () => {
    const app = createApp({ projectRoot: dir })
    const res = await request(app).get("/knowledge-graph.json")
    expect(res.status).toBe(200)
    expect(res.body.project.name).toBe("Test")
  })

  it("enables CORS for CLI access", async () => {
    const app = createApp({ projectRoot: dir })
    const res = await request(app).options("/api/wiki").set("Origin", "http://localhost")
    expect(res.headers["access-control-allow-origin"]).toBeDefined()
  })
})
