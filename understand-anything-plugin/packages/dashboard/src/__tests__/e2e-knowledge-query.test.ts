import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { execFile, spawn } from "child_process"
import type { ChildProcess } from "child_process"
import path from "path"
import http from "http"

const KB_TEST_ROOT = "/Users/earthchen/ai-work/kb-test"
const SKILL_DIR = path.resolve(
  import.meta.dirname,
  "../../../../skills/understand-query",
)
const UA_QUERY = path.join(SKILL_DIR, "ua_query.py")
const SERVER_SCRIPT = path.resolve(import.meta.dirname, "../../server.ts")

let serverProcess: ChildProcess
let serverUrl: string

function waitForServer(url: string, retries = 40, interval = 500): Promise<void> {
  return new Promise((resolve, reject) => {
    let attempts = 0
    const check = () => {
      attempts++
      http.get(`${url}/config.json`, (res) => {
        if (res.statusCode === 200) {
          res.resume()
          resolve()
        } else if (attempts < retries) {
          setTimeout(check, interval)
        } else {
          reject(new Error(`Server not ready after ${retries} attempts`))
        }
      }).on("error", () => {
        if (attempts < retries) {
          setTimeout(check, interval)
        } else {
          reject(new Error(`Server not ready after ${retries} attempts`))
        }
      })
    }
    check()
  })
}

function runQuery(...args: string[]): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    execFile("python3", [UA_QUERY, "--server", serverUrl, "--format", "json", ...args], {
      cwd: SKILL_DIR,
      timeout: 30_000,
      encoding: "utf-8",
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
    }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`${error.message}\nstderr: ${stderr}`))
        return
      }
      try {
        resolve(JSON.parse(stdout) as Record<string, unknown>)
      } catch {
        reject(new Error(`Failed to parse JSON: ${stdout}\nstderr: ${stderr}`))
      }
    })
  })
}

beforeAll(async () => {
  const port = 30000 + Math.floor(Math.random() * 10000)
  serverUrl = `http://127.0.0.1:${port}`

  serverProcess = spawn("npx", ["tsx", SERVER_SCRIPT], {
    cwd: KB_TEST_ROOT,
    env: { ...process.env, PORT: String(port), HOST: "127.0.0.1" },
    stdio: ["ignore", "pipe", "pipe"],
  })

  serverProcess.stderr?.on("data", (data: Buffer) => {
    process.stderr.write(data)
  })

  await waitForServer(serverUrl)
  await runQuery("services", "--list")
}, 60_000)

afterAll(() => {
  if (serverProcess) {
    serverProcess.kill("SIGTERM")
  }
})

describe("E2E: knowledge search", () => {
  it("searches PRD knowledge by keyword", async () => {
    const result = await runQuery("knowledge", "search", "VIP", "--service", "amar-prd")
    expect(result.kind).toBe("knowledge-search")
    expect(result.service).toBe("amar-prd")
    expect(result.query).toBe("VIP")
    expect(Array.isArray(result.results)).toBe(true)
    expect((result.results as unknown[]).length).toBeGreaterThan(0)
  }, 15_000)

  it("filters by requirement type", async () => {
    const result = await runQuery(
      "knowledge", "search", "VIP", "--service", "amar-prd", "--type", "requirement",
    )
    expect(result.kind).toBe("knowledge-search")
    const results = result.results as Array<{ type?: string }>
    for (const r of results) {
      expect(r.type).toBe("requirement")
    }
  }, 15_000)

  it("auto-resolves knowledge service without --service", async () => {
    const result = await runQuery("knowledge", "search", "VIP")
    expect(result.kind).toBe("knowledge-search")
    expect(result.service).toBe("amar-prd")
  }, 15_000)
})

describe("E2E: knowledge node lookup", () => {
  it("finds a node by exact ID", async () => {
    const searchResult = await runQuery("knowledge", "search", "VIP", "--service", "amar-prd", "--limit", "1")
    const results = searchResult.results as Array<{ id: string }>
    expect(results.length).toBeGreaterThan(0)
    const nodeId = results[0].id

    const nodeResult = await runQuery("knowledge", "node", nodeId, "--service", "amar-prd")
    expect(nodeResult.service).toBe("amar-prd")
    const nodes = nodeResult.nodes as Array<{ id: string }>
    expect(nodes.length).toBeGreaterThan(0)
    expect(nodes[0].id).toBe(nodeId)
  }, 15_000)

  it("finds nodes by partial name match", async () => {
    const result = await runQuery("knowledge", "node", "VIP", "--service", "amar-prd")
    const nodes = result.nodes as unknown[]
    expect(nodes.length).toBeGreaterThan(0)
  }, 15_000)
})

describe("E2E: knowledge neighbors", () => {
  it("fetches neighbors for a knowledge node", async () => {
    const searchResult = await runQuery("knowledge", "search", "VIP", "--service", "amar-prd", "--limit", "1")
    const results = searchResult.results as Array<{ id: string }>
    expect(results.length).toBeGreaterThan(0)
    const nodeId = results[0].id

    const nbResult = await runQuery("knowledge", "neighbors", nodeId, "--service", "amar-prd")
    expect(nbResult.center).toBeDefined()
    expect(Array.isArray(nbResult.neighbors)).toBe(true)
  }, 15_000)
})

describe("E2E: knowledge coverage", () => {
  it("finds testcase coverage for a requirement node", async () => {
    const searchResult = await runQuery(
      "knowledge", "search", "VIP", "--service", "amar-prd", "--type", "requirement", "--limit", "5",
    )
    const requirements = searchResult.results as Array<{ id: string; type: string }>
    expect(requirements.length).toBeGreaterThan(0)

    const reqId = requirements[0].id
    const coverageResult = await runQuery("knowledge", "coverage", reqId, "--service", "amar-prd")
    expect(coverageResult.kind).toBe("knowledge-coverage")
    expect(coverageResult.service).toBe("amar-prd")
    expect(coverageResult.requirement).toBeDefined()
    expect(Array.isArray(coverageResult.coverage)).toBe(true)
    expect(typeof coverageResult.total).toBe("number")
  }, 15_000)
})

describe("E2E: services listing includes knowledge facet", () => {
  it("lists services and finds amar-prd with knowledge facet", async () => {
    const result = await runQuery("services", "--name", "amar-prd")
    const services = result.services as Array<{ name: string; facet?: string }>
    const amarPrd = services.find((s) => s.name === "amar-prd")
    expect(amarPrd).toBeDefined()
    expect(amarPrd!.facet).toBe("knowledge")
  }, 15_000)
})

describe("E2E: KG queries against knowledge service", () => {
  it("loads knowledge graph nodes for amar-prd", async () => {
    const result = await runQuery("kg", "--service", "amar-prd", "--type", "requirement")
    const nodes = result.nodes as Array<{ type: string }>
    expect(nodes.length).toBeGreaterThan(0)
    for (const n of nodes) {
      expect(n.type).toBe("requirement")
    }
  }, 15_000)

  it("searches KG with knowledge-specific terms", async () => {
    const result = await runQuery("kg", "--service", "amar-prd", "--search", "VIP")
    const nodes = result.nodes as unknown[]
    expect(nodes.length).toBeGreaterThan(0)
  }, 15_000)
})
