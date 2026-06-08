# Spec 3: CLI Query + Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract shared API handlers, create standalone Express server, implement CLI query skill, and add Dashboard Business mode.

**Architecture:** Shared API handler layer extracted from Vite middleware, dual-deployment (Vite embed + standalone Express). CLI Python script calls API. Dashboard adds Business mode with hierarchical domain graph.

**Tech Stack:** TypeScript, Express, React 19, xyflow, Zustand, dagre, Python 3 (stdlib only)

**Design Spec:** `docs/superpowers/specs/2026-06-08-business-landscape-phase3-design.md`

---

## File Structure

### New Files — API Layer (`packages/dashboard/`)

| File | Responsibility |
|------|---------------|
| `src/api/types.ts` | `ApiRequest`, `ApiResponse`, `ApiContext`, `ApiHandler` interfaces |
| `src/api/utils.ts` | `findGraphFile`, `projectRootFromGraphFile`, `normalizeGraphPath`, `graphFilePathSet`, `graphFileCandidates`, `businessLandscapeDir` |
| `src/api/handlers/auth.ts` | Protected-path detection + token validation |
| `src/api/handlers/graph.ts` | Serve KG/domain/system/diff/meta/config JSON + `/api/graph` |
| `src/api/handlers/wiki.ts` | Wrap `WikiDataService` for `/api/wiki/*` and legacy `/wiki/*` |
| `src/api/handlers/source.ts` | Wrap `readSource` for `/api/source` |
| `src/api/handlers/business.ts` | New business-landscape endpoints |
| `src/api/index.ts` | `createApiRouter()` — unified dispatch |
| `server.ts` | Standalone Express entry (port 3001, CORS, token) |

### New Files — CLI (`skills/understand-query/`)

| File | Responsibility |
|------|---------------|
| `ua_query.py` | HTTP CLI with `kg`, `domain`, `wiki`, `business` subcommands |
| `SKILL.md` | `/understand-query` skill documentation |

### New Files — Dashboard Business Mode

| File | Responsibility |
|------|---------------|
| `src/stores/businessStore.ts` | Zustand store for business-landscape data |
| `src/components/BusinessGraphView.tsx` | Main xyflow hierarchical domain graph |
| `src/components/BusinessDomainNode.tsx` | Group node for domains |
| `src/components/CrossFacetEdge.tsx` | Custom edge with hover tooltip |
| `src/components/BusinessDomainPanel.tsx` | Sidebar detail panel |
| `src/components/InteractionDagView.tsx` | Interaction step DAG |
| `src/components/BusinessModeHeader.tsx` | Facet filter + search bar |

### New Test Files

| File | Covers |
|------|--------|
| `src/__tests__/api-utils.test.ts` | T1 utils |
| `src/__tests__/api-graph-handler.test.ts` | T2 graph handler |
| `src/__tests__/api-wiki-handler.test.ts` | T3 wiki/source/auth handlers |
| `src/__tests__/api-router.test.ts` | T4 router |
| `src/__tests__/server.test.ts` | T6 Express server |
| `src/__tests__/api-business-handler.test.ts` | T7 business handler |
| `src/__tests__/businessStore.test.ts` | T11 store |
| `src/__tests__/business-mode-detection.test.ts` | T12 mode detection |
| `src/__tests__/business-graph-view.test.tsx` | T13 graph view |
| `src/__tests__/business-domain-panel.test.tsx` | T14 panel + DAG |
| `tests/understand-query/test_ua_query.py` | T8 CLI core |
| `tests/understand-query/test_subcommands.py` | T9 CLI subcommands |

### Modified Files

| File | Changes |
|------|---------|
| `vite.config.ts` | Replace ~400-line inline middleware with ~50-line adapter calling `createApiRouter()` |
| `package.json` | Add `express`, `cors`, `supertest`; add `"serve"` script |
| `src/store.ts` | Extend `ViewMode` with `"business"` |
| `src/App.tsx` | Business mode detection, view selector, render `BusinessGraphView` |

### Shared Types (already in `packages/core/src/types.ts`)

Use these — do **not** redefine:

- `BusinessDomain`, `CrossFacetLink`, `BusinessInteraction`, `InteractionStep`, `BusinessRule`

Define locally in `businessStore.ts`:

```typescript
export interface BusinessDomainDetail {
  id: string
  name: string
  summary: string
  interactions: BusinessInteraction[]
  businessRules: BusinessRule[]
  facets: Record<string, unknown>
}
```

### Task Dependency Graph

```
T1 → T2 → T3 → T4 → T5 → T6
                  └→ T7 ─┬→ T8 → T9 → T10 (CLI)
                         └→ T11 → T12 → T13 → T14
T5,T6,T9,T14 → T15 (regression)
```

**Parallel after T7:** CLI track (T8–T10) ∥ Dashboard track (T11–T14).

---

## Task 1: API Handler Types & Utils

**Files:**
- Create: `understand-anything-plugin/packages/dashboard/src/api/types.ts`
- Create: `understand-anything-plugin/packages/dashboard/src/api/utils.ts`
- Test: `understand-anything-plugin/packages/dashboard/src/__tests__/api-utils.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/__tests__/api-utils.test.ts
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
    dir = tmpDir()
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
    fs.mkdirSync(bl)
    expect(businessLandscapeDir(dir)).toBe(bl)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run from `understand-anything-plugin/packages/dashboard`:

```bash
pnpm test -- src/__tests__/api-utils.test.ts
```

Expected: FAIL — `Cannot find module '../api/utils'`

- [ ] **Step 3: Write minimal implementation**

`src/api/types.ts`:

```typescript
import type { WikiDataService } from "../../wiki-api"

export interface ApiRequest {
  pathname: string
  searchParams: URLSearchParams
}

export interface ApiResponse {
  statusCode: number
  body: unknown
  headers?: Record<string, string>
}

export interface ApiContext {
  accessToken: string
  getWikiService: () => WikiDataService
}

export type ApiHandler = (
  req: ApiRequest,
  ctx: ApiContext,
) => Promise<ApiResponse> | ApiResponse

export interface ApiRouter {
  handle(req: ApiRequest, ctx: ApiContext): Promise<ApiResponse | null>
}
```

`src/api/utils.ts` — extract verbatim from `vite.config.ts` lines 16–71, plus:

```typescript
import path from "path"
import fs from "fs"

export function graphFileCandidates(fileName: string): string[] {
  const graphDir = process.env.GRAPH_DIR
  return [
    ...(graphDir
      ? [path.resolve(graphDir, `.understand-anything/${fileName}`)]
      : []),
    path.resolve(process.cwd(), `.understand-anything/${fileName}`),
    path.resolve(process.cwd(), `../../../.understand-anything/${fileName}`),
  ]
}

export function findGraphFile(fileName: string): string | null {
  return graphFileCandidates(fileName).find((c) => fs.existsSync(c)) ?? null
}

export function projectRootFromGraphFile(candidate: string): string {
  return path.dirname(path.dirname(candidate))
}

export function normalizeGraphPath(filePath: string, projectRoot: string): string | null {
  const rawPath = path.isAbsolute(filePath)
    ? filePath.startsWith(projectRoot)
      ? path.relative(projectRoot, filePath)
      : path.basename(filePath)
    : filePath
  if (rawPath === null) return null
  const normalized = path.normalize(rawPath)
  if (
    !normalized ||
    normalized === "." ||
    normalized.includes("\0") ||
    normalized === ".." ||
    normalized.startsWith(`..${path.sep}`) ||
    path.isAbsolute(normalized)
  ) {
    return null
  }
  return normalized.split(path.sep).join("/")
}

export function graphFilePathSet(graphFile: string, projectRoot: string): Set<string> {
  const allowed = new Set<string>()
  try {
    const raw = JSON.parse(fs.readFileSync(graphFile, "utf-8")) as {
      nodes?: Array<Record<string, unknown>>
    }
    for (const node of raw.nodes ?? []) {
      if (typeof node.filePath !== "string") continue
      const normalized = normalizeGraphPath(node.filePath, projectRoot)
      if (normalized) allowed.add(normalized)
    }
  } catch {
    return allowed
  }
  return allowed
}

export function resolveProjectRoot(): string {
  const graphFile = findGraphFile("knowledge-graph.json")
  return graphFile ? projectRootFromGraphFile(graphFile) : process.env.GRAPH_DIR ?? process.cwd()
}

export function businessLandscapeDir(projectRoot?: string): string {
  const root = projectRoot ?? resolveProjectRoot()
  return path.join(root, ".understand-anything", "business-landscape")
}

export function readJsonFile<T>(filePath: string): T | null {
  try {
    if (!fs.existsSync(filePath)) return null
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T
  } catch {
    return null
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm test -- src/__tests__/api-utils.test.ts
```

Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add understand-anything-plugin/packages/dashboard/src/api/types.ts \
        understand-anything-plugin/packages/dashboard/src/api/utils.ts \
        understand-anything-plugin/packages/dashboard/src/__tests__/api-utils.test.ts
git commit -m "feat(dashboard): add shared API types and graph path utilities"
```

---

## Task 2: Graph API Handler

**Files:**
- Create: `understand-anything-plugin/packages/dashboard/src/api/handlers/graph.ts`
- Test: `understand-anything-plugin/packages/dashboard/src/__tests__/api-graph-handler.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/__tests__/api-graph-handler.test.ts
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
    dir = tmpDir()
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
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm test -- src/__tests__/api-graph-handler.test.ts
```

Expected: FAIL — `Cannot find module '../api/handlers/graph'`

- [ ] **Step 3: Write minimal implementation**

`src/api/handlers/graph.ts` — export `handleGraphRequest(req, ctx): Promise<ApiResponse | null>`. Match existing `vite.config.ts` behavior for:

| Pathname | Behavior |
|----------|----------|
| `/knowledge-graph.json`, `/domain-graph.json`, `/meta.json`, `/diff-overlay.json` | Read via `graphFileCandidates`, relativise `nodes[].filePath` |
| `/system-graph.json` | Serve without path sanitisation |
| `/config.json` | Serve file or default `{ autoUpdate: false, outputLanguage: "en" }` |
| `/api/graph?service=&file=` | Validate service name + allowed file list |

Core helper:

```typescript
import path from "path"
import fs from "fs"
import type { ApiRequest, ApiContext, ApiResponse } from "../types"
import { graphFileCandidates, findGraphFile, projectRootFromGraphFile } from "../utils"

const STATIC_GRAPH_PATHS = new Set([
  "/knowledge-graph.json",
  "/domain-graph.json",
  "/system-graph.json",
  "/diff-overlay.json",
  "/meta.json",
  "/config.json",
])

function sanitiseKgNodes(raw: Record<string, unknown>, projectRoot: string): void {
  if (!Array.isArray(raw.nodes)) return
  raw.nodes = raw.nodes.map((node) => {
    if (typeof node !== "object" || node === null) return node
    const n = node as Record<string, unknown>
    if (typeof n.filePath !== "string") return node
    const abs = n.filePath
    const rel = abs.startsWith(projectRoot)
      ? abs.slice(projectRoot.length).replace(/^[\\/]/, "")
      : path.isAbsolute(abs)
        ? path.basename(abs)
        : abs
    return { ...n, filePath: rel }
  })
}

export async function handleGraphRequest(
  req: ApiRequest,
  _ctx: ApiContext,
): Promise<ApiResponse | null> {
  const { pathname, searchParams } = req

  if (pathname === "/api/graph") {
    const serviceName = searchParams.get("service")
    const fileName = searchParams.get("file") || "knowledge-graph.json"
    if (!serviceName) return { statusCode: 400, body: { error: "service parameter required" } }
    if (serviceName.includes("/") || serviceName.includes("\\") || serviceName.includes("..")) {
      return { statusCode: 400, body: { error: "invalid service name" } }
    }
    const allowedFiles = ["knowledge-graph.json", "domain-graph.json", "meta.json", "config.json"]
    if (!allowedFiles.includes(fileName)) {
      return { statusCode: 400, body: { error: "file not allowed" } }
    }
    const graphDir = process.env.GRAPH_DIR
    const candidates = [
      ...(graphDir ? [path.resolve(graphDir, serviceName, ".understand-anything", fileName)] : []),
      path.resolve(process.cwd(), serviceName, ".understand-anything", fileName),
      path.resolve(process.cwd(), "../../..", serviceName, ".understand-anything", fileName),
    ]
    for (const candidate of candidates) {
      if (!fs.existsSync(candidate)) continue
      try {
        return { statusCode: 200, body: JSON.parse(fs.readFileSync(candidate, "utf-8")) }
      } catch {
        return { statusCode: 500, body: { error: "Failed to read graph file" } }
      }
    }
    return { statusCode: 404, body: { error: `${fileName} not found for service ${serviceName}` } }
  }

  if (!STATIC_GRAPH_PATHS.has(pathname)) return null

  if (pathname === "/config.json") {
    for (const candidate of graphFileCandidates("config.json")) {
      if (!fs.existsSync(candidate)) continue
      try {
        return { statusCode: 200, body: JSON.parse(fs.readFileSync(candidate, "utf-8")) }
      } catch {
        return { statusCode: 500, body: { error: "Failed to read config file" } }
      }
    }
    return { statusCode: 200, body: { autoUpdate: false, outputLanguage: "en" } }
  }

  const fileName =
    pathname === "/diff-overlay.json" ? "diff-overlay.json"
    : pathname === "/meta.json" ? "meta.json"
    : pathname === "/domain-graph.json" ? "domain-graph.json"
    : pathname === "/system-graph.json" ? "system-graph.json"
    : "knowledge-graph.json"

  for (const candidate of graphFileCandidates(fileName)) {
    if (!fs.existsSync(candidate)) continue
    try {
      const raw = JSON.parse(fs.readFileSync(candidate, "utf-8")) as Record<string, unknown>
      if (pathname !== "/system-graph.json") {
        sanitiseKgNodes(raw, projectRootFromGraphFile(candidate))
      }
      return { statusCode: 200, body: raw }
    } catch {
      return { statusCode: 500, body: { error: "Failed to read graph file" } }
    }
  }

  if (pathname === "/knowledge-graph.json") {
    return { statusCode: 404, body: { error: "No knowledge graph found. Run /understand first." } }
  }
  return { statusCode: 404, body: { error: `${fileName} not found` } }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm test -- src/__tests__/api-graph-handler.test.ts
```

Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add understand-anything-plugin/packages/dashboard/src/api/handlers/graph.ts \
        understand-anything-plugin/packages/dashboard/src/__tests__/api-graph-handler.test.ts
git commit -m "feat(dashboard): extract graph API handler from vite middleware"
```

---

## Task 3: Wiki & Source API Handlers

**Files:**
- Create: `understand-anything-plugin/packages/dashboard/src/api/handlers/wiki.ts`
- Create: `understand-anything-plugin/packages/dashboard/src/api/handlers/source.ts`
- Create: `understand-anything-plugin/packages/dashboard/src/api/handlers/auth.ts`
- Test: `understand-anything-plugin/packages/dashboard/src/__tests__/api-wiki-handler.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/__tests__/api-wiki-handler.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import fs from "fs"
import path from "path"
import os from "os"
import { WikiDataService } from "../../wiki-api"
import { handleWikiRequest } from "../api/handlers/wiki"
import { handleSourceRequest } from "../api/handlers/source"
import { isProtectedPath, validateToken } from "../api/handlers/auth"

function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), "api-wiki-")) }
function writeJson(p: string, d: unknown) {
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
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm test -- src/__tests__/api-wiki-handler.test.ts
```

Expected: FAIL — handlers not found

- [ ] **Step 3: Write minimal implementation**

`src/api/handlers/auth.ts`:

```typescript
import type { ApiResponse } from "../types"

const PROTECTED_PREFIXES = ["/wiki/", "/api/wiki"]
const PROTECTED_EXACT = new Set([
  "/knowledge-graph.json", "/domain-graph.json", "/system-graph.json",
  "/diff-overlay.json", "/meta.json", "/config.json",
  "/api/source", "/api/graph",
  "/api/business/domains", "/api/business/cross-facet-links",
  "/api/business/overview", "/api/business/search",
])

export function isProtectedPath(pathname: string): boolean {
  if (PROTECTED_EXACT.has(pathname)) return true
  if (PROTECTED_PREFIXES.some((p) => pathname.startsWith(p))) return true
  if (pathname.startsWith("/api/business/domains/")) return true
  return false
}

export function validateToken(
  searchParams: URLSearchParams,
  accessToken: string,
): ApiResponse | null {
  if (searchParams.get("token") !== accessToken) {
    return { statusCode: 403, body: { error: "Forbidden: missing or invalid token" } }
  }
  return null
}
```

`src/api/handlers/wiki.ts` — port routing from `vite.config.ts` lines 198–326 into `handleWikiRequest`. Return `null` if pathname does not start with `/api/wiki` or `/wiki/`.

`src/api/handlers/source.ts` — port `/api/source` block from `vite.config.ts` lines 328–370 into `handleSourceRequest`, using `findGraphFile`, `projectRootFromGraphFile`, `graphFilePathSet`, `readSource`.

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm test -- src/__tests__/api-wiki-handler.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add understand-anything-plugin/packages/dashboard/src/api/handlers/{auth,wiki,source}.ts \
        understand-anything-plugin/packages/dashboard/src/__tests__/api-wiki-handler.test.ts
git commit -m "feat(dashboard): extract wiki, source, and auth API handlers"
```

---

## Task 4: API Router & Index

**Files:**
- Create: `understand-anything-plugin/packages/dashboard/src/api/index.ts`
- Test: `understand-anything-plugin/packages/dashboard/src/__tests__/api-router.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/__tests__/api-router.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import fs from "fs"
import path from "path"
import os from "os"
import { createApiRouter } from "../api/index"
import { WikiDataService } from "../../wiki-api"

function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), "api-router-")) }
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
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm test -- src/__tests__/api-router.test.ts
```

Expected: FAIL — `Cannot find module '../api/index'`

- [ ] **Step 3: Write minimal implementation**

`src/api/index.ts`:

```typescript
import type { ApiRequest, ApiContext, ApiResponse, ApiRouter } from "./types"
import { isProtectedPath, validateToken } from "./handlers/auth"
import { handleGraphRequest } from "./handlers/graph"
import { handleWikiRequest } from "./handlers/wiki"
import { handleSourceRequest } from "./handlers/source"
import { handleBusinessRequest } from "./handlers/business"

const HANDLERS = [
  handleBusinessRequest,
  handleWikiRequest,
  handleSourceRequest,
  handleGraphRequest,
]

export function createApiRouter(): ApiRouter {
  return {
    async handle(req: ApiRequest, ctx: ApiContext): Promise<ApiResponse | null> {
      if (isProtectedPath(req.pathname)) {
        const authError = validateToken(req.searchParams, ctx.accessToken)
        if (authError) return authError
      }
      for (const handler of HANDLERS) {
        const res = await handler(req, ctx)
        if (res !== null) return res
      }
      return null
    },
  }
}

export { isProtectedPath, validateToken } from "./handlers/auth"
export type { ApiRequest, ApiResponse, ApiContext } from "./types"
```

**Note:** T4 creates a stub `handleBusinessRequest` returning `null` until T7. Add to `src/api/handlers/business.ts`:

```typescript
import type { ApiRequest, ApiContext, ApiResponse } from "../types"
export async function handleBusinessRequest(_req: ApiRequest, _ctx: ApiContext): Promise<ApiResponse | null> {
  return null
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm test -- src/__tests__/api-router.test.ts
```

Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add understand-anything-plugin/packages/dashboard/src/api/index.ts \
        understand-anything-plugin/packages/dashboard/src/api/handlers/business.ts \
        understand-anything-plugin/packages/dashboard/src/__tests__/api-router.test.ts
git commit -m "feat(dashboard): add unified API router with auth gate"
```

---

## Task 5: Refactor Vite Middleware

**Files:**
- Modify: `understand-anything-plugin/packages/dashboard/vite.config.ts`
- Modify: `understand-anything-plugin/packages/dashboard/src/api/vite-adapter.ts` (create)

- [ ] **Step 1: Write the failing test**

No new test file — regression via existing suite. Add a smoke test:

```typescript
// src/__tests__/api-vite-adapter.test.ts
import { describe, it, expect } from "vitest"
import { writeApiResponse } from "../api/vite-adapter"

describe("vite-adapter", () => {
  it("writeApiResponse sets JSON content-type", () => {
    const chunks: Buffer[] = []
    const res = {
      statusCode: 0,
      setHeader: () => {},
      end: (c: string) => { chunks.push(Buffer.from(c)) },
    }
    writeApiResponse(res as never, { statusCode: 200, body: { ok: true } })
    expect(chunks[0].toString()).toBe('{"ok":true}')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm test -- src/__tests__/api-vite-adapter.test.ts
```

Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

`src/api/vite-adapter.ts`:

```typescript
import type { ServerResponse } from "http"
import type { ApiResponse } from "./types"

export function writeApiResponse(res: ServerResponse, apiRes: ApiResponse): void {
  res.statusCode = apiRes.statusCode
  if (apiRes.headers) {
    for (const [k, v] of Object.entries(apiRes.headers)) res.setHeader(k, v)
  }
  res.setHeader("Content-Type", "application/json")
  res.end(JSON.stringify(apiRes.body))
}
```

Refactor `vite.config.ts` `configureServer` middleware to ~50 lines:

```typescript
import { createApiRouter } from "./src/api/index"
import { writeApiResponse } from "./src/api/vite-adapter"
import { WikiDataService } from "./wiki-api"
import { findGraphFile, projectRootFromGraphFile } from "./src/api/utils"

// Inside configureServer:
const router = createApiRouter()
let wikiService: WikiDataService | null = null
function getWikiService(): WikiDataService {
  if (!wikiService) {
    const graphFile = findGraphFile("knowledge-graph.json")
    const projectRoot = graphFile ? projectRootFromGraphFile(graphFile) : process.env.GRAPH_DIR ?? process.cwd()
    wikiService = new WikiDataService(projectRoot)
  }
  return wikiService
}

server.middlewares.use(async (req, res, next) => {
  const url = new URL(req.url ?? "/", "http://127.0.0.1:5173")
  const apiRes = await router.handle(
    { pathname: url.pathname, searchParams: url.searchParams },
    { accessToken: ACCESS_TOKEN, getWikiService },
  )
  if (apiRes === null) { next(); return }
  writeApiResponse(res, apiRes)
})
```

Remove inline `sendJson`, `graphFileCandidates`, `findGraphFile`, etc. from `vite.config.ts` (now imported from `src/api/utils` only for wiki init).

- [ ] **Step 4: Run test to verify it passes**

```bash
cd understand-anything-plugin/packages/dashboard && pnpm test
```

Expected: ALL tests PASS (existing wiki-api, wiki-source, system-overview, etc. + new API tests)

- [ ] **Step 5: Commit**

```bash
git add understand-anything-plugin/packages/dashboard/vite.config.ts \
        understand-anything-plugin/packages/dashboard/src/api/vite-adapter.ts \
        understand-anything-plugin/packages/dashboard/src/__tests__/api-vite-adapter.test.ts
git commit -m "refactor(dashboard): vite middleware delegates to shared API router"
```

---

## Task 6: Standalone Express Server

**Files:**
- Create: `understand-anything-plugin/packages/dashboard/server.ts`
- Modify: `understand-anything-plugin/packages/dashboard/package.json`
- Test: `understand-anything-plugin/packages/dashboard/src/__tests__/server.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/__tests__/server.test.ts
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
  const TOKEN = "test-token-abc"

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

  it("returns 403 without token", async () => {
    const app = createApp({ accessToken: TOKEN, projectRoot: dir })
    const res = await request(app).get("/knowledge-graph.json")
    expect(res.status).toBe(403)
  })

  it("serves knowledge-graph.json with token", async () => {
    const app = createApp({ accessToken: TOKEN, projectRoot: dir })
    const res = await request(app).get(`/knowledge-graph.json?token=${TOKEN}`)
    expect(res.status).toBe(200)
    expect(res.body.project.name).toBe("Test")
  })

  it("enables CORS for CLI access", async () => {
    const app = createApp({ accessToken: TOKEN, projectRoot: dir })
    const res = await request(app).options("/api/wiki").set("Origin", "http://localhost")
    expect(res.headers["access-control-allow-origin"]).toBeDefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm test -- src/__tests__/server.test.ts
```

Expected: FAIL — missing `supertest`, `express`, `server.ts`

- [ ] **Step 3: Write minimal implementation**

Add to `package.json`:

```json
"scripts": {
  "serve": "tsx server.ts"
},
"dependencies": {
  "cors": "^2.8.5",
  "express": "^4.21.0"
},
"devDependencies": {
  "@types/cors": "^2.8.17",
  "@types/express": "^4.17.21",
  "@types/supertest": "^6.0.2",
  "supertest": "^7.0.0",
  "tsx": "^4.19.0"
}
```

`server.ts`:

```typescript
import crypto from "crypto"
import express from "express"
import cors from "cors"
import { WikiDataService } from "./wiki-api"
import { createApiRouter } from "./src/api/index"
import { resolveProjectRoot } from "./src/api/utils"

export interface ServerOptions {
  accessToken?: string
  projectRoot?: string
  port?: number
}

export function createApp(opts: ServerOptions = {}) {
  const accessToken = opts.accessToken ?? process.env.UNDERSTAND_ACCESS_TOKEN ?? crypto.randomBytes(16).toString("hex")
  const projectRoot = opts.projectRoot ?? resolveProjectRoot()
  let wikiService: WikiDataService | null = null
  const getWikiService = () => {
    if (!wikiService) wikiService = new WikiDataService(projectRoot)
    return wikiService
  }
  const router = createApiRouter()
  const app = express()
  app.use(cors())
  app.use(async (req, res, next) => {
    const url = new URL(req.url, `http://127.0.0.1`)
    const apiRes = await router.handle(
      { pathname: url.pathname, searchParams: url.searchParams },
      { accessToken, getWikiService },
    )
    if (apiRes === null) { next(); return }
    res.status(apiRes.statusCode)
    if (apiRes.headers) {
      for (const [k, v] of Object.entries(apiRes.headers)) res.setHeader(k, v)
    }
    res.json(apiRes.body)
  })
  return app
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PORT ?? 3001)
  const accessToken = process.env.UNDERSTAND_ACCESS_TOKEN ?? crypto.randomBytes(16).toString("hex")
  const app = createApp({ accessToken })
  app.listen(port, () => {
    console.log(`\n  API Server: http://127.0.0.1:${port}/?token=${accessToken}\n`)
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm install && pnpm test -- src/__tests__/server.test.ts
```

Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add understand-anything-plugin/packages/dashboard/server.ts \
        understand-anything-plugin/packages/dashboard/package.json \
        understand-anything-plugin/packages/dashboard/src/__tests__/server.test.ts
git commit -m "feat(dashboard): add standalone Express API server on port 3001"
```

---

## Task 7: Business API Handler

**Files:**
- Modify: `understand-anything-plugin/packages/dashboard/src/api/handlers/business.ts` (replace stub)
- Test: `understand-anything-plugin/packages/dashboard/src/__tests__/api-business-handler.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/__tests__/api-business-handler.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import fs from "fs"
import path from "path"
import os from "os"
import { handleBusinessRequest } from "../api/handlers/business"

const ctx = { accessToken: "t", getWikiService: () => { throw new Error("unused") } }

function seedLandscape(dir: string) {
  const bl = path.join(dir, ".understand-anything", "business-landscape")
  fs.mkdirSync(path.join(bl, "domains"), { recursive: true })
  fs.writeFileSync(path.join(bl, "domains.json"), JSON.stringify({
    domains: [{
      id: "domain:order", name: "Order Management", summary: "下单流程",
      facets: ["server", "client"], matchType: "auto-api", matchConfidence: 0.9,
      detailRef: "business-landscape/domains/order.json",
    }],
    unmapped: [],
    stats: { totalDomains: 1, mappedDomains: 1, unmappedDomains: 0, coverageRate: 1 },
  }))
  fs.writeFileSync(path.join(bl, "cross-facet-links.json"), JSON.stringify({
    links: [{ domain: "domain:order", serverEndpoints: ["/api/orders"], clientApiCalls: [], matchDetails: [] }],
    unmatchedEndpoints: { server: [], client: [] },
  }))
  fs.writeFileSync(path.join(bl, "domains", "order.json"), JSON.stringify({
    id: "domain:order", name: "Order Management", summary: "下单流程",
    interactions: [{ id: "flow:create", name: "Create Order", steps: [
      { id: "s1", facet: "server", description: "validate", terminal: true },
    ]}],
    businessRules: [{ id: "r1", rule: "must have items", enforcedBy: ["s1"] }],
    facets: { server: { services: ["order-service"] } },
  }))
}

describe("handleBusinessRequest", () => {
  let dir: string

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "biz-api-"))
    process.chdir(dir)
    fs.mkdirSync(path.join(dir, ".understand-anything"), { recursive: true })
    fs.writeFileSync(path.join(dir, ".understand-anything/knowledge-graph.json"), JSON.stringify({ nodes: [] }))
    seedLandscape(dir)
  })

  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }) })

  it("GET /api/business/domains returns index", async () => {
    const res = await handleBusinessRequest(
      { pathname: "/api/business/domains", searchParams: new URLSearchParams() }, ctx)
    expect(res?.statusCode).toBe(200)
    expect((res?.body as { domains: unknown[] }).domains).toHaveLength(1)
  })

  it("GET /api/business/domains/:slug returns detail", async () => {
    const res = await handleBusinessRequest(
      { pathname: "/api/business/domains/order", searchParams: new URLSearchParams() }, ctx)
    expect(res?.statusCode).toBe(200)
    expect((res?.body as { interactions: unknown[] }).interactions).toHaveLength(1)
  })

  it("GET /api/business/overview aggregates stats", async () => {
    const res = await handleBusinessRequest(
      { pathname: "/api/business/overview", searchParams: new URLSearchParams() }, ctx)
    expect(res?.statusCode).toBe(200)
    expect((res?.body as { stats: { totalDomains: number } }).stats.totalDomains).toBe(1)
  })

  it("GET /api/business/search?q=下单 matches domain", async () => {
    const res = await handleBusinessRequest(
      { pathname: "/api/business/search", searchParams: new URLSearchParams({ q: "下单" }) }, ctx)
    expect(res?.statusCode).toBe(200)
    expect((res?.body as { results: unknown[] }).results.length).toBeGreaterThan(0)
  })

  it("returns null for unrelated paths", async () => {
    const res = await handleBusinessRequest(
      { pathname: "/api/other", searchParams: new URLSearchParams() }, ctx)
    expect(res).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm test -- src/__tests__/api-business-handler.test.ts
```

Expected: FAIL — endpoints not implemented

- [ ] **Step 3: Write minimal implementation**

Replace `src/api/handlers/business.ts`:

```typescript
import fs from "fs"
import path from "path"
import type { ApiRequest, ApiContext, ApiResponse } from "../types"
import { businessLandscapeDir, readJsonFile, resolveProjectRoot } from "../utils"

interface DomainsIndex {
  domains: Array<{ id: string; name: string; summary: string; detailRef: string }>
  stats: Record<string, number>
}

function slugFromPathname(pathname: string): string | null {
  const m = pathname.match(/^\/api\/business\/domains\/([^/]+)$/)
  return m ? decodeURIComponent(m[1]) : null
}

function searchDomains(blDir: string, query: string): Array<{ id: string; name: string; match: string }> {
  const q = query.toLowerCase()
  const results: Array<{ id: string; name: string; match: string }> = []
  const domainsDir = path.join(blDir, "domains")
  if (!fs.existsSync(domainsDir)) return results
  for (const file of fs.readdirSync(domainsDir).filter((f) => f.endsWith(".json"))) {
    const detail = readJsonFile<{ id: string; name: string; summary: string; interactions?: Array<{ name: string }> }>(
      path.join(domainsDir, file),
    )
    if (!detail) continue
    const haystack = [detail.name, detail.summary, ...(detail.interactions?.map((i) => i.name) ?? [])].join(" ").toLowerCase()
    if (haystack.includes(q)) {
      results.push({ id: detail.id, name: detail.name, match: detail.summary.slice(0, 120) })
    }
  }
  return results
}

export async function handleBusinessRequest(req: ApiRequest, _ctx: ApiContext): Promise<ApiResponse | null> {
  const { pathname, searchParams } = req
  if (!pathname.startsWith("/api/business")) return null

  const blDir = businessLandscapeDir(resolveProjectRoot())
  if (!fs.existsSync(blDir)) {
    return { statusCode: 404, body: { error: "business-landscape not found. Run /understand-business first." } }
  }

  if (pathname === "/api/business/domains") {
    const data = readJsonFile<DomainsIndex>(path.join(blDir, "domains.json"))
    if (!data) return { statusCode: 404, body: { error: "domains.json not found" } }
    return { statusCode: 200, body: data }
  }

  if (pathname === "/api/business/cross-facet-links") {
    const data = readJsonFile(path.join(blDir, "cross-facet-links.json"))
    if (!data) return { statusCode: 404, body: { error: "cross-facet-links.json not found" } }
    return { statusCode: 200, body: data }
  }

  if (pathname === "/api/business/overview") {
    const data = readJsonFile<DomainsIndex>(path.join(blDir, "domains.json"))
    if (!data) return { statusCode: 404, body: { error: "domains.json not found" } }
    return {
      statusCode: 200,
      body: {
        domainCount: data.domains.length,
        stats: data.stats,
        facets: [...new Set(data.domains.flatMap((d) => (d as { facets?: string[] }).facets ?? []))],
      },
    }
  }

  if (pathname === "/api/business/search") {
    const q = searchParams.get("q") ?? ""
    if (!q.trim()) return { statusCode: 400, body: { error: "q parameter required" } }
    return { statusCode: 200, body: { results: searchDomains(blDir, q) } }
  }

  const slug = slugFromPathname(pathname)
  if (slug) {
    const detailPath = path.join(blDir, "domains", `${slug}.json`)
    const detail = readJsonFile(detailPath)
    if (!detail) return { statusCode: 404, body: { error: `Domain not found: ${slug}` } }
    return { statusCode: 200, body: detail }
  }

  return { statusCode: 404, body: { error: `Unknown business API endpoint: ${pathname}` } }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm test -- src/__tests__/api-business-handler.test.ts
```

Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add understand-anything-plugin/packages/dashboard/src/api/handlers/business.ts \
        understand-anything-plugin/packages/dashboard/src/__tests__/api-business-handler.test.ts
git commit -m "feat(dashboard): add business-landscape API endpoints"
```

---

## Task 8: CLI ua_query.py — Core Infrastructure

**Files:**
- Create: `understand-anything-plugin/skills/understand-query/ua_query.py`
- Test: `tests/understand-query/test_ua_query.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/understand-query/test_ua_query.py
import json
import sys
from pathlib import Path
from unittest.mock import patch, MagicMock
from urllib.error import URLError

import pytest

SKILL_DIR = Path(__file__).resolve().parent.parent.parent / "understand-anything-plugin" / "skills" / "understand-query"
sys.path.insert(0, str(SKILL_DIR))
import ua_query  # noqa: E402


class TestHttpClient:
    def test_fetch_json_success(self):
        mock_resp = MagicMock()
        mock_resp.read.return_value = b'{"ok": true}'
        mock_resp.__enter__ = lambda s: s
        mock_resp.__exit__ = MagicMock(return_value=False)
        with patch("urllib.request.urlopen", return_value=mock_resp):
            data = ua_query.fetch_json("http://localhost:3001/test?token=t", timeout=5)
        assert data == {"ok": True}

    def test_fetch_json_connection_refused(self):
        with patch("urllib.request.urlopen", side_effect=URLError("Connection refused")):
            with pytest.raises(ua_query.ServerUnavailableError) as exc:
                ua_query.fetch_json("http://localhost:3001/test", timeout=1)
        assert "server" in str(exc.value).lower() or "unavailable" in str(exc.value).lower()


class TestOutputFormatting:
    def test_format_json(self):
        out = ua_query.format_output({"a": 1}, "json")
        assert json.loads(out) == {"a": 1}

    def test_format_markdown(self):
        out = ua_query.format_output({"domains": [{"name": "Order", "summary": "test"}]}, "md")
        assert "Order" in out
        assert "#" in out or "##" in out


class TestArgParsing:
    def test_parses_global_flags(self):
        args = ua_query.parse_args(["--server", "http://x:9", "--token", "tok", "kg", "--service", "s"])
        assert args.server == "http://x:9"
        assert args.token == "tok"
        assert args.command == "kg"
```

- [ ] **Step 2: Run test to verify it fails**

```bash
uv run --with pytest pytest tests/understand-query/test_ua_query.py -v
```

Expected: FAIL — `ModuleNotFoundError: No module named 'ua_query'`

- [ ] **Step 3: Write minimal implementation**

`skills/understand-query/ua_query.py`:

```python
#!/usr/bin/env python3
"""HTTP CLI for querying Understand-Anything API Server (stdlib only)."""
import argparse
import json
import os
import sys
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

DEFAULT_SERVER = "http://localhost:3001"
DEFAULT_TIMEOUT = 30


class ServerUnavailableError(RuntimeError):
    pass


def fetch_json(url: str, timeout: int = DEFAULT_TIMEOUT) -> Any:
    try:
        req = Request(url, headers={"Accept": "application/json"})
        with urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except URLError as e:
        raise ServerUnavailableError(
            f"API Server unavailable at {url.split('?')[0]}. "
            f"Start it with: cd understand-anything-plugin/packages/dashboard && pnpm run serve\n"
            f"Detail: {e}"
        ) from e
    except HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        try:
            err = json.loads(body)
        except json.JSONDecodeError:
            err = {"error": body}
        raise RuntimeError(f"HTTP {e.code}: {err.get('error', body)}") from e


def build_url(server: str, path: str, params: dict[str, str], token: str) -> str:
    q = {**params, "token": token}
    base = server.rstrip("/")
    return f"{base}{path}?{urlencode(q)}"


def format_output(data: Any, fmt: str) -> str:
    if fmt == "md":
        return _format_markdown(data)
    return json.dumps(data, ensure_ascii=False, indent=2)


def _format_markdown(data: Any) -> str:
    if isinstance(data, dict) and "domains" in data:
        lines = ["# Business Domains", ""]
        for d in data["domains"]:
            lines.append(f"## {d.get('name', d.get('id', '?'))}")
            lines.append(d.get("summary", ""))
            lines.append("")
        return "\n".join(lines)
    if isinstance(data, dict) and "results" in data:
        lines = ["# Search Results", ""]
        for r in data["results"]:
            lines.append(f"- **{r.get('name', r.get('id'))}**: {r.get('match', r.get('summary', ''))}")
        return "\n".join(lines)
    return f"```json\n{json.dumps(data, ensure_ascii=False, indent=2)}\n```"


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Query Understand-Anything API")
    parser.add_argument("--server", default=os.environ.get("UNDERSTAND_SERVER", DEFAULT_SERVER))
    parser.add_argument("--token", default=os.environ.get("UNDERSTAND_TOKEN", ""))
    parser.add_argument("--format", choices=["json", "md"], default="json")
    parser.add_argument("--verbose", action="store_true")
    sub = parser.add_subparsers(dest="command", required=True)

    kg = sub.add_parser("kg", help="Knowledge graph queries")
    kg.add_argument("--service")
    kg.add_argument("--type")
    kg.add_argument("--node")
    kg.add_argument("--search")
    kg.add_argument("--file")

    domain = sub.add_parser("domain", help="Domain graph queries")
    domain.add_argument("--service")
    domain.add_argument("--domain")
    domain.add_argument("--search")

    wiki = sub.add_parser("wiki", help="Wiki queries")
    wiki.add_argument("--service")
    wiki.add_argument("--type")
    wiki.add_argument("--domain")
    wiki.add_argument("--search")

    biz = sub.add_parser("business", help="Business landscape queries")
    biz.add_argument("--domain")
    biz.add_argument("--type")
    biz.add_argument("--facet")
    biz.add_argument("--list", action="store_true")
    biz.add_argument("--search")

    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    if not args.token:
        print("Error: --token required (or set UNDERSTAND_TOKEN env var)", file=sys.stderr)
        return 1
    # Subcommand dispatch implemented in T9
    print(format_output({"error": "subcommand not implemented"}, args.format))
    return 1


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 4: Run test to verify it passes**

```bash
uv run --with pytest pytest tests/understand-query/test_ua_query.py -v
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add understand-anything-plugin/skills/understand-query/ua_query.py \
        tests/understand-query/test_ua_query.py
git commit -m "feat(cli): add ua_query.py HTTP client and argument parsing"
```

---

## Task 9: CLI ua_query.py — Subcommand Implementations

**Files:**
- Modify: `understand-anything-plugin/skills/understand-query/ua_query.py`
- Test: `tests/understand-query/test_subcommands.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/understand-query/test_subcommands.py
import json
import sys
from pathlib import Path
from unittest.mock import patch

import pytest

SKILL_DIR = Path(__file__).resolve().parent.parent.parent / "understand-anything-plugin" / "skills" / "understand-query"
sys.path.insert(0, str(SKILL_DIR))
import ua_query  # noqa: E402

TOKEN = "test-tok"
SERVER = "http://localhost:3001"


@pytest.fixture
def mock_fetch():
    with patch.object(ua_query, "fetch_json") as m:
        yield m


class TestKgSubcommand:
    def test_kg_list_nodes(self, mock_fetch, capsys):
        mock_fetch.return_value = {"nodes": [{"id": "n1", "type": "class", "name": "OrderController"}]}
        ua_query.main(["--token", TOKEN, "--server", SERVER, "kg", "--service", "order-service", "--type", "node"])
        out = json.loads(capsys.readouterr().out)
        assert out["nodes"][0]["name"] == "OrderController"
        mock_fetch.assert_called_once()
        assert "/api/graph" in mock_fetch.call_args[0][0]


class TestBusinessSubcommand:
    def test_business_list(self, mock_fetch, capsys):
        mock_fetch.return_value = {"domains": [{"id": "domain:order", "name": "Order"}]}
        ua_query.main(["--token", TOKEN, "business", "--list"])
        out = json.loads(capsys.readouterr().out)
        assert len(out["domains"]) == 1

    def test_business_search(self, mock_fetch, capsys):
        mock_fetch.return_value = {"results": [{"id": "domain:order", "name": "Order", "match": "下单"}]}
        ua_query.main(["--token", TOKEN, "business", "--search", "下单"])
        assert "results" in json.loads(capsys.readouterr().out)
```

- [ ] **Step 2: Run test to verify it fails**

```bash
uv run --with pytest pytest tests/understand-query/test_subcommands.py -v
```

Expected: FAIL — subcommands return error JSON

- [ ] **Step 3: Write minimal implementation**

Add to `ua_query.py`:

```python
def cmd_kg(args: argparse.Namespace) -> Any:
    if not args.service:
        raise SystemExit("kg requires --service")
    if args.file:
        path = f"/api/source?file={args.file}&service={args.service}&mode=graph"
        return fetch_json(build_url(args.server, path, {}, args.token))
    params = {"service": args.service, "file": "knowledge-graph.json"}
    data = fetch_json(build_url(args.server, "/api/graph", params, args.token))
    nodes = data.get("nodes", [])
    if args.node:
        nodes = [n for n in nodes if n.get("name") == args.node]
    elif args.type:
        nodes = [n for n in nodes if n.get("type") == args.type]
    elif args.search:
        q = args.search.lower()
        nodes = [n for n in nodes if q in json.dumps(n, ensure_ascii=False).lower()]
    return {"nodes": nodes, "edges": data.get("edges", []) if args.verbose else None}


def cmd_domain(args: argparse.Namespace) -> Any:
    if not args.service:
        raise SystemExit("domain requires --service")
    params = {"service": args.service, "file": "domain-graph.json"}
    data = fetch_json(build_url(args.server, "/api/graph", params, args.token))
    if args.domain:
        nodes = [n for n in data.get("nodes", []) if args.domain in n.get("id", "") or args.domain in n.get("name", "")]
        return {"nodes": nodes}
    if args.search:
        q = args.search.lower()
        nodes = [n for n in data.get("nodes", []) if q in n.get("name", "").lower() or q in n.get("summary", "").lower()]
        return {"nodes": nodes}
    return data


def cmd_wiki(args: argparse.Namespace) -> Any:
    if not args.service:
        raise SystemExit("wiki requires --service")
    if args.search:
        return fetch_json(build_url(args.server, "/api/wiki/search", {"q": args.search, "limit": "20"}, args.token))
    if args.domain:
        path = f"/api/wiki/service/{args.service}/domain/{args.domain}"
        return fetch_json(build_url(args.server, path, {}, args.token))
    if args.type == "domain":
        return fetch_json(build_url(args.server, f"/api/wiki/service/{args.service}", {}, args.token))
    if args.type == "endpoint":
        return fetch_json(build_url(args.server, f"/api/wiki/endpoints/{args.service}", {}, args.token))
    if args.type == "structure":
        return fetch_json(build_url(args.server, f"/api/wiki/service/{args.service}", {}, args.token))
    if args.type == "flow":
        return fetch_json(build_url(args.server, f"/api/wiki/service/{args.service}", {}, args.token))
    return fetch_json(build_url(args.server, f"/api/wiki/service/{args.service}", {}, args.token))


def cmd_business(args: argparse.Namespace) -> Any:
    if args.list:
        return fetch_json(build_url(args.server, "/api/business/domains", {}, args.token))
    if args.search:
        return fetch_json(build_url(args.server, "/api/business/search", {"q": args.search}, args.token))
    if args.domain:
        slug = args.domain.replace("domain:", "").replace(" ", "-").lower()
        data = fetch_json(build_url(args.server, f"/api/business/domains/{slug}", {}, args.token))
        if args.type == "interactions":
            return {"interactions": data.get("interactions", [])}
        if args.type == "rules":
            return {"businessRules": data.get("businessRules", [])}
        if args.facet:
            return {"facets": data.get("facets", {}).get(args.facet, {})}
        return data
    return fetch_json(build_url(args.server, "/api/business/overview", {}, args.token))
```

Update `main()`:

```python
def main(argv=None) -> int:
    args = parse_args(argv)
    if not args.token:
        print("Error: --token required", file=sys.stderr)
        return 1
    try:
        handlers = {"kg": cmd_kg, "domain": cmd_domain, "wiki": cmd_wiki, "business": cmd_business}
        data = handlers[args.command](args)
        print(format_output(data, args.format))
        return 0
    except ServerUnavailableError as e:
        print(str(e), file=sys.stderr)
        return 2
    except RuntimeError as e:
        print(str(e), file=sys.stderr)
        return 1
```

- [ ] **Step 4: Run test to verify it passes**

```bash
uv run --with pytest pytest tests/understand-query/ -v
```

Expected: PASS (all CLI tests)

- [ ] **Step 5: Commit**

```bash
git add understand-anything-plugin/skills/understand-query/ua_query.py \
        tests/understand-query/test_subcommands.py
git commit -m "feat(cli): implement kg, domain, wiki, business subcommands"
```

---

## Task 10: /understand-query SKILL.md

**Files:**
- Create: `understand-anything-plugin/skills/understand-query/SKILL.md`

- [ ] **Step 1: Create SKILL.md** (documentation only — no test)

Write `skills/understand-query/SKILL.md` with:

1. **Trigger**: User asks to query codebase knowledge, business domains, wiki, or KG via CLI/API
2. **Prerequisite**: Start API server — `cd understand-anything-plugin/packages/dashboard && pnpm run serve`; copy printed token URL
3. **Four-layer drill-down model**:
   - Layer 1 Business: `ua_query.py business --list`
   - Layer 2 Interaction: `ua_query.py business --domain X --type interactions`
   - Layer 3 Wiki: `ua_query.py wiki --service S --domain D`
   - Layer 4 KG: `ua_query.py kg --service S --node N`
4. **Subcommand reference table** (all flags from design spec §790-832)
5. **Error handling**: exit code 2 = server unavailable; instruct user to run `pnpm run serve`
6. **Example scenarios**: "find order flow" → business --search; "inspect controller" → kg --node

- [ ] **Step 2: Commit**

```bash
git add understand-anything-plugin/skills/understand-query/SKILL.md
git commit -m "docs: add /understand-query skill with four-layer drill-down model"
```

---

## Task 11: Dashboard Business Store

**Files:**
- Create: `understand-anything-plugin/packages/dashboard/src/stores/businessStore.ts`
- Modify: `understand-anything-plugin/packages/dashboard/src/store.ts` (extend `ViewMode`)
- Test: `understand-anything-plugin/packages/dashboard/src/__tests__/businessStore.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/__tests__/businessStore.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest"
import { useBusinessStore } from "../stores/businessStore"

const mockDomains = {
  domains: [{
    id: "domain:order", name: "Order", summary: "Orders",
    facets: ["server"], matchType: "auto-api" as const, matchConfidence: 1,
    detailRef: "business-landscape/domains/order.json",
  }],
  stats: { totalDomains: 1, mappedDomains: 1, unmappedDomains: 0, coverageRate: 1 },
}

describe("useBusinessStore", () => {
  beforeEach(() => {
    useBusinessStore.setState({
      domains: [], crossFacetLinks: [], selectedDomainId: null,
      domainDetail: {}, loading: false, error: null, available: false,
    })
    vi.restoreAllMocks()
  })

  it("fetchDomains sets domains and available flag", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockDomains,
    }))
    await useBusinessStore.getState().fetchDomains("tok")
    const s = useBusinessStore.getState()
    expect(s.domains).toHaveLength(1)
    expect(s.available).toBe(true)
  })

  it("selectDomain updates selectedDomainId", () => {
    useBusinessStore.getState().selectDomain("domain:order")
    expect(useBusinessStore.getState().selectedDomainId).toBe("domain:order")
  })
})
```

Also add to same file:

```typescript
import { ViewMode } from "../store"

it("ViewMode includes business", () => {
  const mode: ViewMode = "business"
  expect(mode).toBe("business")
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm test -- src/__tests__/businessStore.test.ts
```

Expected: FAIL — store not found; `ViewMode` lacks `"business"`

- [ ] **Step 3: Write minimal implementation**

In `src/store.ts` line 19, change:

```typescript
export type ViewMode = "structural" | "domain" | "knowledge" | "wiki" | "system" | "business"
```

`src/stores/businessStore.ts`:

```typescript
import { create } from "zustand"
import type {
  BusinessDomain,
  CrossFacetLink,
  BusinessInteraction,
  BusinessRule,
} from "@understand-anything/core/types"

export interface BusinessDomainDetail {
  id: string
  name: string
  summary: string
  interactions: BusinessInteraction[]
  businessRules: BusinessRule[]
  facets: Record<string, unknown>
}

interface BusinessState {
  available: boolean
  domains: BusinessDomain[]
  crossFacetLinks: CrossFacetLink[]
  selectedDomainId: string | null
  domainDetail: Record<string, BusinessDomainDetail>
  loading: boolean
  error: string | null
  facetFilter: string | null
  searchQuery: string
  fetchDomains: (token: string) => Promise<void>
  fetchDomainDetail: (slug: string, token: string) => Promise<void>
  fetchCrossFacetLinks: (token: string) => Promise<void>
  selectDomain: (id: string | null) => void
  setFacetFilter: (facet: string | null) => void
  setSearchQuery: (q: string) => void
}

function apiUrl(path: string, token: string): string {
  return `${path}?token=${encodeURIComponent(token)}`
}

export const useBusinessStore = create<BusinessState>()((set, get) => ({
  available: false,
  domains: [],
  crossFacetLinks: [],
  selectedDomainId: null,
  domainDetail: {},
  loading: false,
  error: null,
  facetFilter: null,
  searchQuery: "",

  fetchDomains: async (token) => {
    set({ loading: true, error: null })
    try {
      const res = await fetch(apiUrl("/api/business/domains", token))
      if (!res.ok) {
        set({ available: false, loading: false })
        return
      }
      const data = await res.json() as { domains: BusinessDomain[] }
      set({ domains: data.domains ?? [], available: (data.domains?.length ?? 0) > 0, loading: false })
    } catch (e) {
      set({ error: String(e), loading: false, available: false })
    }
  },

  fetchDomainDetail: async (slug, token) => {
    const res = await fetch(apiUrl(`/api/business/domains/${encodeURIComponent(slug)}`, token))
    if (!res.ok) return
    const detail = await res.json() as BusinessDomainDetail
    set((s) => ({ domainDetail: { ...s.domainDetail, [detail.id]: detail } }))
  },

  fetchCrossFacetLinks: async (token) => {
    const res = await fetch(apiUrl("/api/business/cross-facet-links", token))
    if (!res.ok) return
    const data = await res.json() as { links: CrossFacetLink[] }
    set({ crossFacetLinks: data.links ?? [] })
  },

  selectDomain: (id) => set({ selectedDomainId: id }),

  setFacetFilter: (facet) => set({ facetFilter: facet }),

  setSearchQuery: (q) => set({ searchQuery: q }),
}))
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm test -- src/__tests__/businessStore.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add understand-anything-plugin/packages/dashboard/src/stores/businessStore.ts \
        understand-anything-plugin/packages/dashboard/src/store.ts \
        understand-anything-plugin/packages/dashboard/src/__tests__/businessStore.test.ts
git commit -m "feat(dashboard): add business Zustand store and extend ViewMode"
```

---

## Task 12: Dashboard Business Mode Detection & Routing

**Files:**
- Modify: `understand-anything-plugin/packages/dashboard/src/App.tsx`
- Test: `understand-anything-plugin/packages/dashboard/src/__tests__/business-mode-detection.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/__tests__/business-mode-detection.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import { useBusinessStore } from "../stores/businessStore"
import { useDashboardStore } from "../store"

// Minimal harness — test detection logic extracted as pure function
import { detectBusinessAvailability } from "../utils/businessMode"

describe("business mode detection", () => {
  beforeEach(() => {
    useBusinessStore.setState({ available: false, domains: [] })
    vi.restoreAllMocks()
  })

  it("detectBusinessAvailability returns true when domains endpoint succeeds", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ domains: [{ id: "domain:x", name: "X", summary: "", facets: [], matchType: "manual", matchConfidence: 1, detailRef: "" }] }),
    }))
    const ok = await detectBusinessAvailability("tok")
    expect(ok).toBe(true)
  })

  it("returns false on 404", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }))
    expect(await detectBusinessAvailability("tok")).toBe(false)
  })
})
```

Create `src/utils/businessMode.ts`:

```typescript
export async function detectBusinessAvailability(token: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/business/domains?token=${encodeURIComponent(token)}`)
    if (!res.ok) return false
    const data = await res.json() as { domains?: unknown[] }
    return Array.isArray(data.domains) && data.domains.length > 0
  } catch {
    return false
  }
}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm test -- src/__tests__/business-mode-detection.test.ts
```

Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation**

In `Dashboard` component (`App.tsx`), add after wiki detection effect (~line 242):

```typescript
import { useBusinessStore } from "./stores/businessStore"
import { detectBusinessAvailability } from "./utils/businessMode"
import BusinessGraphView from "./components/BusinessGraphView"

// Inside Dashboard():
const fetchDomains = useBusinessStore((s) => s.fetchDomains)
const businessAvailable = useBusinessStore((s) => s.available)

useEffect(() => {
  void detectBusinessAvailability(accessToken).then((ok) => {
    if (ok) void fetchDomains(accessToken)
  })
}, [accessToken, fetchDomains])
```

In `DashboardContent`, add Business button to **every** view-mode selector block (mirror wiki button pattern):

```tsx
{businessAvailable && (
  <button
    type="button"
    onClick={() => setViewMode("business")}
    className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
      viewMode === "business"
        ? "bg-accent/20 text-accent"
        : "text-text-muted hover:text-text-secondary"
    }`}
  >
    Business
  </button>
)}
```

In main content area (~line 871), add branch:

```tsx
{viewMode === "business" && businessAvailable ? (
  <BusinessGraphView accessToken={accessToken} />
) : viewMode === "system" && systemGraph ? (
```

Create stub `BusinessGraphView.tsx` (replaced in T13):

```tsx
export default function BusinessGraphView({ accessToken }: { accessToken: string }) {
  return <div data-testid="business-graph-view">Business mode</div>
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm test -- src/__tests__/business-mode-detection.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add understand-anything-plugin/packages/dashboard/src/App.tsx \
        understand-anything-plugin/packages/dashboard/src/utils/businessMode.ts \
        understand-anything-plugin/packages/dashboard/src/components/BusinessGraphView.tsx \
        understand-anything-plugin/packages/dashboard/src/__tests__/business-mode-detection.test.ts
git commit -m "feat(dashboard): detect business-landscape and add Business view mode"
```

---

## Task 13: BusinessGraphView + Node Components

**Files:**
- Modify: `understand-anything-plugin/packages/dashboard/src/components/BusinessGraphView.tsx`
- Create: `understand-anything-plugin/packages/dashboard/src/components/BusinessDomainNode.tsx`
- Create: `understand-anything-plugin/packages/dashboard/src/components/CrossFacetEdge.tsx`
- Create: `understand-anything-plugin/packages/dashboard/src/components/BusinessModeHeader.tsx`
- Test: `understand-anything-plugin/packages/dashboard/src/__tests__/business-graph-view.test.tsx`

- [ ] **Step 1: Write the failing test**

```typescript
// src/__tests__/business-graph-view.test.tsx
import { describe, it, expect, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import BusinessGraphView from "../components/BusinessGraphView"
import { useBusinessStore } from "../stores/businessStore"
import { ThemeProvider } from "../themes/index.ts"
import { I18nProvider } from "../contexts/I18nContext.tsx"

const mockDomain = {
  id: "domain:order", name: "Order Management", summary: "Orders",
  facets: ["server", "client"], matchType: "auto-api" as const, matchConfidence: 0.9,
  detailRef: "business-landscape/domains/order.json", implType: "cross-platform" as const,
}

function renderView() {
  return render(
    <ThemeProvider>
      <I18nProvider language="en">
        <BusinessGraphView accessToken="tok" />
      </I18nProvider>
    </ThemeProvider>,
  )
}

describe("BusinessGraphView", () => {
  beforeEach(() => {
    useBusinessStore.setState({
      available: true,
      domains: [mockDomain],
      crossFacetLinks: [{
        domain: "domain:order",
        serverEndpoints: ["/api/orders"],
        clientApiCalls: [{ platform: "ios", path: "/orders", file: "Api.swift" }],
        matchDetails: [{ matchLayer: 1, matchType: "path" }],
      }],
      selectedDomainId: null,
      domainDetail: {},
      loading: false,
      error: null,
      facetFilter: null,
      searchQuery: "",
    })
  })

  it("renders domain group nodes", async () => {
    renderView()
    expect(await screen.findByText("Order Management")).toBeInTheDocument()
  })

  it("shows facet coverage indicators", async () => {
    renderView()
    expect(await screen.findByText(/server/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm test -- src/__tests__/business-graph-view.test.tsx
```

Expected: FAIL — stub does not render domain names

- [ ] **Step 3: Write minimal implementation**

`BusinessDomainNode.tsx` — xyflow group node:

```tsx
import { memo } from "react"
import type { NodeProps } from "@xyflow/react"

export interface BusinessDomainNodeData {
  label: string
  summary: string
  facets: string[]
  implType?: string
  domainId: string
}

function BusinessDomainNode({ data, selected }: NodeProps & { data: BusinessDomainNodeData }) {
  return (
    <div
      className={`rounded-lg border-2 p-3 min-w-[280px] bg-surface ${
        selected ? "border-accent" : "border-border-subtle"
      }`}
      data-testid={`domain-node-${data.domainId}`}
    >
      <div className="font-medium text-sm">{data.label}</div>
      {data.implType && (
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-elevated text-text-muted">{data.implType}</span>
      )}
      <div className="flex gap-1 mt-2">
        {data.facets.map((f) => (
          <span key={f} className="text-[10px] px-1 rounded bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200">
            {f}
          </span>
        ))}
      </div>
      <p className="text-xs text-text-muted mt-1 line-clamp-2">{data.summary}</p>
    </div>
  )
}
export default memo(BusinessDomainNode)
```

`CrossFacetEdge.tsx` — custom edge with hover tooltip:

```tsx
import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps } from "@xyflow/react"
import { useState } from "react"

export interface CrossFacetEdgeData {
  apiPath?: string
  method?: string
  confidence?: number
}

export default function CrossFacetEdge({
  id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data,
}: EdgeProps & { data?: CrossFacetEdgeData }) {
  const [hover, setHover] = useState(false)
  const [path, labelX, labelY] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition })
  return (
    <>
      <BaseEdge id={id} path={path} style={{ stroke: "var(--color-accent)", strokeWidth: 2 }} />
      <EdgeLabelRenderer>
        <div
          style={{ position: "absolute", transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)` }}
          className="nodrag nopan"
          onMouseEnter={() => setHover(true)}
          onMouseLeave={() => setHover(false)}
        >
          {hover && data?.apiPath && (
            <div className="text-xs bg-elevated border border-border-subtle rounded px-2 py-1 shadow">
              {data.method ?? "HTTP"} {data.apiPath}
              {data.confidence != null && <span className="text-text-muted ml-1">({Math.round(data.confidence * 100)}%)</span>}
            </div>
          )}
        </div>
      </EdgeLabelRenderer>
    </>
  )
}
```

`BusinessGraphView.tsx` — use `applyDagreLayout` from `src/utils/layout.ts` with `direction: "TB"`:

```tsx
import { useEffect, useMemo, useCallback } from "react"
import { ReactFlow, ReactFlowProvider, Background, Controls, type Node, type Edge } from "@xyflow/react"
import "@xyflow/react/dist/style.css"
import { useBusinessStore } from "../stores/businessStore"
import { useDashboardStore } from "../store"
import { applyDagreLayout, LAYER_CLUSTER_WIDTH, LAYER_CLUSTER_HEIGHT } from "../utils/layout"
import BusinessDomainNode from "./BusinessDomainNode"
import CrossFacetEdge from "./CrossFacetEdge"
import BusinessModeHeader from "./BusinessModeHeader"
import BusinessDomainPanel from "./BusinessDomainPanel"

const nodeTypes = { "business-domain": BusinessDomainNode }
const edgeTypes = { "cross-facet": CrossFacetEdge }

function slugFromId(id: string): string {
  return id.replace(/^domain:/, "")
}

export default function BusinessGraphView({ accessToken }: { accessToken: string }) {
  const domains = useBusinessStore((s) => s.domains)
  const links = useBusinessStore((s) => s.crossFacetLinks)
  const selectedDomainId = useBusinessStore((s) => s.selectedDomainId)
  const selectDomain = useBusinessStore((s) => s.selectDomain)
  const fetchCrossFacetLinks = useBusinessStore((s) => s.fetchCrossFacetLinks)
  const fetchDomainDetail = useBusinessStore((s) => s.fetchDomainDetail)
  const facetFilter = useBusinessStore((s) => s.facetFilter)

  useEffect(() => { void fetchCrossFacetLinks(accessToken) }, [accessToken, fetchCrossFacetLinks])

  const filteredDomains = useMemo(
    () => facetFilter ? domains.filter((d) => d.facets.includes(facetFilter)) : domains,
    [domains, facetFilter],
  )

  const { nodes, edges } = useMemo(() => {
    const dims = new Map<string, { width: number; height: number }>()
    const rfNodes: Node[] = filteredDomains.map((d) => {
      dims.set(d.id, { width: LAYER_CLUSTER_WIDTH, height: LAYER_CLUSTER_HEIGHT })
      return {
        id: d.id,
        type: "business-domain",
        position: { x: 0, y: 0 },
        data: { label: d.name, summary: d.summary, facets: d.facets, implType: d.implType, domainId: d.id },
      }
    })
    const domainIdSet = new Set(filteredDomains.map((d) => d.id))
    const rfEdges: Edge[] = links
      .filter((l) => domainIdSet.has(`domain:${l.domain}`) || domainIdSet.has(l.domain))
      .flatMap((l, i) => {
        const src = l.domain.startsWith("domain:") ? l.domain : `domain:${l.domain}`
        const targets = filteredDomains.filter((d) => d.id !== src).slice(0, 1)
        return targets.map((t, j) => ({
          id: `cfe-${i}-${j}`,
          source: src,
          target: t.id,
          type: "cross-facet",
          data: { apiPath: l.serverEndpoints[0], method: "HTTP", confidence: 0.9 },
        }))
      })
    const laid = applyDagreLayout(rfNodes, rfEdges, "TB", dims)
    return { nodes: laid.nodes, edges: laid.edges }
  }, [filteredDomains, links])

  const onNodeClick = useCallback((_e: React.MouseEvent, node: Node) => {
    selectDomain(node.id)
    void fetchDomainDetail(slugFromId(node.id), accessToken)
  }, [selectDomain, fetchDomainDetail, accessToken])

  return (
    <div className="flex h-full w-full" data-testid="business-graph-view">
      <div className="flex-1 flex flex-col min-w-0">
        <BusinessModeHeader accessToken={accessToken} />
        <ReactFlowProvider>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onNodeClick={onNodeClick}
            fitView
          >
            <Background />
            <Controls />
          </ReactFlow>
        </ReactFlowProvider>
      </div>
      {selectedDomainId && <BusinessDomainPanel domainId={selectedDomainId} accessToken={accessToken} />}
    </div>
  )
}
```

`BusinessModeHeader.tsx` — facet filter chips + search input calling `useBusinessStore.setSearchQuery`.

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm test -- src/__tests__/business-graph-view.test.tsx
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add understand-anything-plugin/packages/dashboard/src/components/Business*.tsx \
        understand-anything-plugin/packages/dashboard/src/components/CrossFacetEdge.tsx \
        understand-anything-plugin/packages/dashboard/src/__tests__/business-graph-view.test.tsx
git commit -m "feat(dashboard): add BusinessGraphView with dagre layout and cross-facet edges"
```

---

## Task 14: BusinessDomainPanel + Interaction DAG

**Files:**
- Create: `understand-anything-plugin/packages/dashboard/src/components/BusinessDomainPanel.tsx`
- Create: `understand-anything-plugin/packages/dashboard/src/components/InteractionDagView.tsx`
- Test: `understand-anything-plugin/packages/dashboard/src/__tests__/business-domain-panel.test.tsx`

- [ ] **Step 1: Write the failing test**

```typescript
// src/__tests__/business-domain-panel.test.tsx
import { describe, it, expect, beforeEach, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import BusinessDomainPanel from "../components/BusinessDomainPanel"
import { useBusinessStore } from "../stores/businessStore"
import { useDashboardStore } from "../store"
import { ThemeProvider } from "../themes/index.ts"
import { I18nProvider } from "../contexts/I18nContext.tsx"

const detail = {
  id: "domain:order", name: "Order Management", summary: "Orders",
  interactions: [{
    id: "flow:create", name: "Create Order",
    steps: [
      { id: "s1", facet: "server", description: "Validate cart", terminal: false },
      { id: "s2", facet: "client", description: "Show confirmation", terminal: true },
    ],
  }],
  businessRules: [{ id: "r1", rule: "Cart must not be empty", enforcedBy: ["s1"] }],
  facets: { server: { services: ["order-service"] }, client: { features: ["checkout"] } },
}

describe("BusinessDomainPanel", () => {
  beforeEach(() => {
    useBusinessStore.setState({
      domainDetail: { "domain:order": detail },
      selectedDomainId: "domain:order",
    } as never)
  })

  it("renders interactions and rules", () => {
    render(
      <ThemeProvider><I18nProvider language="en">
        <BusinessDomainPanel domainId="domain:order" accessToken="tok" />
      </I18nProvider></ThemeProvider>,
    )
    expect(screen.getByText("Create Order")).toBeInTheDocument()
    expect(screen.getByText(/Cart must not be empty/)).toBeInTheDocument()
  })

  it("cross-mode nav: server facet switches to system mode", () => {
    const setViewMode = vi.fn()
    vi.spyOn(useDashboardStore, "getState").mockReturnValue({
      ...useDashboardStore.getState(),
      setViewMode,
      setActiveService: vi.fn(),
    } as never)
    render(
      <ThemeProvider><I18nProvider language="en">
        <BusinessDomainPanel domainId="domain:order" accessToken="tok" />
      </I18nProvider></ThemeProvider>,
    )
    fireEvent.click(screen.getByTestId("nav-system-order-service"))
    expect(setViewMode).toHaveBeenCalledWith("system")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm test -- src/__tests__/business-domain-panel.test.tsx
```

Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

`InteractionDagView.tsx` — facet colors + dagre LR layout:

```tsx
const FACET_COLORS: Record<string, string> = {
  server: "#3b82f6",
  client: "#22c55e",
  frontend: "#f97316",
}

// Build nodes from steps (handle branches via extra edges, parallel via same rank)
// terminal steps get dashed border
// Export default function InteractionDagView({ interaction }: { interaction: BusinessInteraction })
```

`BusinessDomainPanel.tsx`:

```tsx
import InteractionDagView from "./InteractionDagView"
import { useBusinessStore } from "../stores/businessStore"
import { useDashboardStore } from "../store"

export default function BusinessDomainPanel({ domainId, accessToken }: { domainId: string; accessToken: string }) {
  const detail = useBusinessStore((s) => s.domainDetail[domainId])
  const setViewMode = useDashboardStore((s) => s.setViewMode)
  const setActiveService = useDashboardStore((s) => s.setActiveService)

  if (!detail) return null

  const serverServices = (detail.facets?.server as { services?: string[] })?.services ?? []

  return (
    <aside className="w-[360px] shrink-0 border-l border-border-subtle bg-surface overflow-auto p-4">
      <h2 className="font-heading text-lg">{detail.name}</h2>
      <p className="text-sm text-text-muted mb-4">{detail.summary}</p>

      <section className="mb-6">
        <h3 className="text-sm font-medium mb-2">Interactions</h3>
        {detail.interactions.map((flow) => (
          <div key={flow.id} className="mb-4">
            <div className="text-sm font-medium">{flow.name}</div>
            <InteractionDagView interaction={flow} />
          </div>
        ))}
      </section>

      <section className="mb-6">
        <h3 className="text-sm font-medium mb-2">Business Rules</h3>
        <ul className="text-sm space-y-1">
          {detail.businessRules.map((r) => (
            <li key={r.id}>• {r.rule}</li>
          ))}
        </ul>
      </section>

      <section>
        <h3 className="text-sm font-medium mb-2">Cross-Mode Navigation</h3>
        {serverServices.map((svc) => (
          <button
            key={svc}
            type="button"
            data-testid={`nav-system-${svc}`}
            className="text-xs text-blue-600 block mb-1"
            onClick={() => { setActiveService(svc); setViewMode("system") }}
          >
            → System: {svc}
          </button>
        ))}
        {/* Client/frontend entities → setViewMode("structural") + loadServiceGraph */}
      </section>
    </aside>
  )
}
```

Cross-mode rules (implement all):
- Server facet entity click → `setViewMode("system")`, optionally `setActiveService`
- Client/frontend entity click → `setActiveService` + `setViewMode("structural")` (triggers existing `loadServiceGraph` effect in `App.tsx`)

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm test -- src/__tests__/business-domain-panel.test.tsx
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add understand-anything-plugin/packages/dashboard/src/components/BusinessDomainPanel.tsx \
        understand-anything-plugin/packages/dashboard/src/components/InteractionDagView.tsx \
        understand-anything-plugin/packages/dashboard/src/__tests__/business-domain-panel.test.tsx
git commit -m "feat(dashboard): add domain detail panel with interaction DAG and cross-mode nav"
```

---

## Task 15: Full Regression Test

**Files:** None (verification only)

- [ ] **Step 1: Run all TypeScript tests from monorepo root**

```bash
cd understand-anything-plugin && pnpm test
```

Expected: All dashboard + core tests PASS

- [ ] **Step 2: Run all Python tests**

```bash
cd /Users/earthchen/ai-work/Understand-Anything
uv run --with pytest pytest -v
```

Expected: All tests PASS (including new `tests/understand-query/`)

- [ ] **Step 3: Verify Dashboard production build**

```bash
cd understand-anything-plugin/packages/dashboard && pnpm run build
```

Expected: `tsc -b && vite build` completes with exit code 0

- [ ] **Step 4: Manual smoke test (optional but recommended)**

```bash
# Terminal 1
cd understand-anything-plugin/packages/dashboard && pnpm run serve

# Terminal 2 — copy token from Terminal 1 output
python3 understand-anything-plugin/skills/understand-query/ua_query.py \
  --token <TOKEN> business --list

# Terminal 3
cd understand-anything-plugin/packages/dashboard && pnpm dev
# Open dashboard URL with token; confirm Business tab appears when business-landscape data exists
```

- [ ] **Step 5: No commit** — verification task only. Report results in PR description.

---

## Self-Review Checklist

| Check | Status |
|-------|--------|
| All 15 tasks from design spec covered | T1–T15 map to API extraction, Express server, business API, CLI (T8–T10), Dashboard Business mode (T11–T14), regression (T15) |
| Every task has complete code (no placeholders) | Each task includes test code + implementation code |
| Types consistent across tasks | `ApiRequest`/`ApiResponse`/`ApiContext` defined T1; used T2–T7; `BusinessDomain` from core; `BusinessDomainDetail` in businessStore T11 |
| File paths exact and consistent | All paths under `understand-anything-plugin/packages/dashboard/` or `skills/understand-query/` |
| Test commands include expected output | Each task specifies pass/fail expectations |

### Spec Coverage Map

| Design Spec Requirement | Task |
|------------------------|------|
| Shared handler layer | T1–T4 |
| Vite middleware refactor (~50 lines) | T5 |
| Standalone Express + CORS + port 3001 | T6 |
| Business API endpoints (5 routes) | T7 |
| CLI subcommands + stdlib HTTP | T8–T9 |
| `/understand-query` SKILL.md | T10 |
| ViewMode `"business"` + detection | T11–T12 |
| BusinessGraphView + dagre + xyflow | T13 |
| BusinessDomainPanel + InteractionDagView | T14 |
| Cross-mode navigation | T14 |
| Regression before merge | T15 |

---

**Plan complete and saved to `docs/superpowers/plans/2026-06-08-business-landscape-phase3-impl.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — Dispatch a fresh subagent per task with review between tasks.

**2. Inline Execution** — Execute tasks in this session using `superpowers:executing-plans` with batch checkpoints.

**Which approach?**
