import { describe, it, expect, beforeEach, afterEach } from "vitest"
import fs from "fs"
import path from "path"
import os from "os"
import { SourceIndex, clearSourceIndexCache, getOrBuildSourceIndex } from "../source-index"
import { handleSourceRequest } from "../source"
import type { ApiRequest, ApiContext } from "../../types"

const mockCtx = { getWikiService: () => { throw new Error("unused") } } as unknown as ApiContext

function makeReq(params: Record<string, string> = {}): ApiRequest {
  return { pathname: "/api/source/search", searchParams: new URLSearchParams(params) }
}

const STRUCTURAL_ANALYSIS = {
  "src/TimeoutService.java": {
    language: "java",
    totalLines: 30,
    functions: [
      {
        name: "connect",
        startLine: 10,
        endLine: 20,
        params: [],
        returnType: "void",
      },
    ],
    classes: [
      {
        name: "TimeoutService",
        startLine: 5,
        endLine: 28,
        kind: "class",
      },
    ],
    imports: [],
    exports: [],
  },
  "config/application.yml": {
    language: "yaml",
    fileCategory: "config",
    totalLines: 8,
    functions: [],
    classes: [],
    imports: [],
    exports: [],
  },
}

const JAVA_SOURCE = `package com.example;

import java.net.Socket;

public class TimeoutService {
    private int timeout = 5000;

    public void connect() {
        // connection timeout handling
        Socket socket = new Socket();
        socket.setSoTimeout(timeout);
    }
}
`

const YAML_SOURCE = `server:
  port: 8080

spring:
  datasource:
    connection-timeout: 30000
    pool:
      max-size: 10
`

function seedFixture(dir: string) {
  const ua = path.join(dir, ".understand-anything")
  fs.mkdirSync(ua, { recursive: true })
  fs.writeFileSync(
    path.join(ua, "system-graph.json"),
    JSON.stringify({
      version: "1.0.0",
      generatedAt: "2026-06-15T12:00:00Z",
      project: { name: "Test", serviceCount: 1, totalNodes: 2, totalEdges: 0 },
      nodes: [],
      edges: [],
      serviceIndex: {
        "my-service": { hasKg: true, basePath: "my-service" },
      },
    }),
  )

  const svcRoot = path.join(dir, "my-service")
  fs.mkdirSync(path.join(svcRoot, "src"), { recursive: true })
  fs.mkdirSync(path.join(svcRoot, "config"), { recursive: true })
  fs.writeFileSync(path.join(svcRoot, "src", "TimeoutService.java"), JAVA_SOURCE)
  fs.writeFileSync(path.join(svcRoot, "config", "application.yml"), YAML_SOURCE)

  const extraction = path.join(svcRoot, ".understand-anything", "intermediate", "extraction")
  fs.mkdirSync(extraction, { recursive: true })
  fs.writeFileSync(
    path.join(extraction, "structural-analysis.json"),
    JSON.stringify(STRUCTURAL_ANALYSIS),
  )
}

describe("SourceIndex", () => {
  let dir: string
  let projectRoot: string

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "source-index-"))
    seedFixture(dir)
    projectRoot = path.join(dir, "my-service")
    clearSourceIndexCache()
  })

  afterEach(() => {
    clearSourceIndexCache()
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it("finds keyword in function body", () => {
    const index = new SourceIndex("my-service")
    index.build(projectRoot, STRUCTURAL_ANALYSIS)
    const results = index.search("timeout")
    expect(results.length).toBeGreaterThan(0)
    expect(results.some((r) => r.file.includes("TimeoutService.java"))).toBe(true)
    expect(results.some((r) => r.snippet.toLowerCase().includes("timeout"))).toBe(true)
  })

  it("finds keyword in config file (YAML)", () => {
    const index = new SourceIndex("my-service")
    index.build(projectRoot, STRUCTURAL_ANALYSIS)
    const results = index.search("connection-timeout")
    expect(results.length).toBeGreaterThan(0)
    expect(results.some((r) => r.file.includes("application.yml"))).toBe(true)
  })

  it("path filter limits results", () => {
    const index = new SourceIndex("my-service")
    index.build(projectRoot, STRUCTURAL_ANALYSIS)
    const results = index.search("timeout", { path: "*.yml" })
    expect(results.length).toBeGreaterThan(0)
    expect(results.every((r) => r.file.endsWith(".yml"))).toBe(true)
    expect(results.every((r) => !r.file.includes("TimeoutService.java"))).toBe(true)
  })

  it("returns empty results when structural data is empty", () => {
    const index = new SourceIndex("my-service")
    index.build(projectRoot, {})
    const results = index.search("timeout")
    expect(results).toEqual([])
  })
})

describe("SourceIndex serialization", () => {
  let dir: string
  let projectRoot: string

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "source-serial-"))
    seedFixture(dir)
    projectRoot = path.join(dir, "my-service")
    clearSourceIndexCache()
  })

  afterEach(() => {
    clearSourceIndexCache()
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it("toJSON produces valid JSON string", () => {
    const index = new SourceIndex("my-service", projectRoot)
    index.build(projectRoot, STRUCTURAL_ANALYSIS)
    const json = index.toJSON()
    expect(() => JSON.parse(json)).not.toThrow()
  })

  it("loadFromJSON restores search capability", () => {
    const index = new SourceIndex("my-service", projectRoot)
    index.build(projectRoot, STRUCTURAL_ANALYSIS)
    const json = index.toJSON()

    const restored = SourceIndex.loadFromJSON("my-service", projectRoot, json)
    const results = restored.search("timeout")
    expect(results.length).toBeGreaterThan(0)
    expect(results.some((r) => r.file.includes("TimeoutService.java"))).toBe(true)
  })

  it("serialized index does not contain raw source content", () => {
    const index = new SourceIndex("my-service", projectRoot)
    index.build(projectRoot, STRUCTURAL_ANALYSIS)
    const json = index.toJSON()
    const parsed = JSON.parse(json)
    const storedFields = parsed.storedFields ?? {}
    for (const docFields of Object.values(storedFields) as Record<string, unknown>[]) {
      expect(docFields).not.toHaveProperty("content")
    }
  })

  it("getOrBuildSourceIndex loads from pre-built file", () => {
    const index = new SourceIndex("my-service", projectRoot)
    index.build(projectRoot, STRUCTURAL_ANALYSIS)
    const json = index.toJSON()

    const extractionDir = path.join(projectRoot, ".understand-anything", "intermediate", "extraction")
    fs.writeFileSync(path.join(extractionDir, "source-index.json"), json)

    clearSourceIndexCache()
    const loaded = getOrBuildSourceIndex("my-service", projectRoot, null)
    const results = loaded.search("timeout")
    expect(results.length).toBeGreaterThan(0)
  })
})

describe("handleSourceRequest /api/source/search", () => {
  let dir: string

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "source-search-api-"))
    process.chdir(dir)
    seedFixture(dir)
    clearSourceIndexCache()
  })

  afterEach(() => {
    clearSourceIndexCache()
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it("returns 400 for empty query", async () => {
    const res = await handleSourceRequest(makeReq({ service: "my-service" }), mockCtx)
    expect(res?.statusCode).toBe(400)
    expect((res?.body as { error: string }).error).toMatch(/q parameter required/i)
  })

  it("returns 400 for missing service", async () => {
    const res = await handleSourceRequest(makeReq({ q: "timeout" }), mockCtx)
    expect(res?.statusCode).toBe(400)
    expect((res?.body as { error: string }).error).toMatch(/service parameter required/i)
  })

  it("returns search results for valid query", async () => {
    const res = await handleSourceRequest(
      makeReq({ q: "timeout", service: "my-service" }),
      mockCtx,
    )
    expect(res?.statusCode).toBe(200)
    const body = res?.body as { query: string; service: string; results: unknown[]; totalResults: number }
    expect(body.query).toBe("timeout")
    expect(body.service).toBe("my-service")
    expect(body.results.length).toBeGreaterThan(0)
    expect(body.totalResults).toBe(body.results.length)
  })

  it("returns empty results for non-existent service", async () => {
    const res = await handleSourceRequest(
      makeReq({ q: "timeout", service: "missing-service" }),
      mockCtx,
    )
    expect(res?.statusCode).toBe(200)
    const body = res?.body as { results: unknown[]; totalResults: number }
    expect(body.results).toEqual([])
    expect(body.totalResults).toBe(0)
  })
})
