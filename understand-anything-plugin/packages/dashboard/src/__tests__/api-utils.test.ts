import { describe, it, expect, beforeEach, afterEach } from "vitest"
import fs from "fs"
import path from "path"
import os from "os"
import {
  findGraphFile,
  projectRootFromGraphFile,
  normalizeGraphPath,
  graphFilePathSet,
  graphFileCandidates,
  businessLandscapeDir,
} from "../api/utils"

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "api-utils-"))
}

function writeJson(filePath: string, data: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, JSON.stringify(data))
}

describe("api/utils", () => {
  let dir: string
  let origCwd: string
  let origGraphDir: string | undefined

  beforeEach(() => {
    dir = fs.realpathSync.native(tmpDir())
    origCwd = process.cwd()
    origGraphDir = process.env.GRAPH_DIR
    process.chdir(dir)
    delete process.env.GRAPH_DIR
  })

  afterEach(() => {
    process.chdir(origCwd)
    if (origGraphDir === undefined) delete process.env.GRAPH_DIR
    else process.env.GRAPH_DIR = origGraphDir
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it("findGraphFile locates knowledge-graph.json under .understand-anything", () => {
    const kg = path.join(dir, ".understand-anything", "knowledge-graph.json")
    writeJson(kg, { nodes: [] })
    expect(findGraphFile("knowledge-graph.json")).toBe(kg)
  })

  it("projectRootFromGraphFile returns parent of .understand-anything", () => {
    const kg = path.join(dir, ".understand-anything", "knowledge-graph.json")
    writeJson(kg, { nodes: [] })
    expect(projectRootFromGraphFile(kg)).toBe(dir)
  })

  it("normalizeGraphPath rejects traversal", () => {
    expect(normalizeGraphPath("../etc/passwd", dir)).toBeNull()
    expect(normalizeGraphPath("src/auth.ts", dir)).toBe("src/auth.ts")
  })

  it("graphFilePathSet builds allowlist from node filePaths", () => {
    const kg = path.join(dir, ".understand-anything", "knowledge-graph.json")
    writeJson(kg, {
      nodes: [
        { filePath: path.join(dir, "src", "A.java") },
        { filePath: "src/B.java" },
      ],
    })
    const allowed = graphFilePathSet(kg, dir)
    expect(allowed.has("src/A.java")).toBe(true)
    expect(allowed.has("src/B.java")).toBe(true)
  })

  it("graphFileCandidates honors GRAPH_DIR env", () => {
    const graphDir = path.join(dir, "graph-root")
    fs.mkdirSync(graphDir, { recursive: true })
    process.env.GRAPH_DIR = graphDir
    const expected = path.join(graphDir, ".understand-anything", "meta.json")
    writeJson(expected, { theme: {} })
    expect(graphFileCandidates("meta.json")).toContain(expected)
  })

  it("businessLandscapeDir resolves under project root", () => {
    const bl = path.join(dir, ".understand-anything", "business-landscape")
    fs.mkdirSync(bl, { recursive: true })
    expect(businessLandscapeDir(dir)).toBe(bl)
  })
})
