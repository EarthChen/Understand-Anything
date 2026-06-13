# MiniSearch Unified Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace LumoSearch + Fuse.js with MiniSearch as the unified search engine, enhance both `/api/search` and `/api/structure/search` with fuzzy + precise capabilities.

**Architecture:** Three independent MiniSearch indices (KG, Wiki, Structure), each with its own field weights. Shared `codeTokenize()` function handles CamelCase/snake_case/CJK. Two APIs remain independent, each enhanced with fuzzy + precise + pagination + facets.

**Tech Stack:** MiniSearch, jieba (existing), Vitest, TypeScript

---

## File Structure

### New files

| File | Responsibility |
|------|----------------|
| `dashboard/src/api/handlers/code-tokenizer.ts` | Shared tokenize function (CamelCase/snake_case/CJK) |
| `dashboard/src/api/handlers/structure-index.ts` | Structure MiniSearch index, search, filter, facets |
| `dashboard/src/api/handlers/kg-index.ts` | KG + Domain + Business MiniSearch index, search, filter, facets |
| `dashboard/src/api/handlers/wiki-index.ts` | Wiki MiniSearch index, search, filter, facets |
| `dashboard/src/api/handlers/__tests__/code-tokenizer.test.ts` | Tokenizer unit tests |
| `dashboard/src/api/handlers/__tests__/structure-index.test.ts` | Structure index unit tests |
| `dashboard/src/api/handlers/__tests__/kg-index.test.ts` | KG index unit tests |
| `dashboard/src/api/handlers/__tests__/wiki-index.test.ts` | Wiki index unit tests |

### Modified files

| File | Change |
|------|--------|
| `dashboard/src/api/handlers/search.ts` | Replace LumoSearch with kg-index + wiki-index, add type/tag/offset, add facets |
| `dashboard/src/api/handlers/structure.ts` | Add q/sectionKey/sectionValue/offset, use structure-index for search, add facets |
| `core/src/search.ts` | Replace Fuse.js with MiniSearch |
| `dashboard/package.json` | Add `minisearch`, remove `@lumosearch/search` |
| `core/package.json` | Remove `fuse.js` |

### Unchanged files

| File | Reason |
|------|--------|
| `dashboard/src/api/handlers/rrf-fuse.ts` | RRF is independent of search engine |
| `dashboard/src/api/handlers/search-vector.ts` | Vector search is independent |
| `dashboard/src/api/handlers/__tests__/search.test.ts` | Existing tokenize tests, will be superseded by code-tokenizer tests |
| `dashboard/src/api/handlers/__tests__/search-incremental.test.ts` | Incremental search tests unchanged |

---

## Phase 1: Structure search (new code, zero migration risk)

### Task 1: Install minisearch dependency

**Files:**
- Modify: `dashboard/package.json`

- [ ] **Step 1: Add minisearch to dashboard dependencies**

```bash
cd /Users/earthchen/.understand-anything/repo/understand-anything-plugin
pnpm --filter @understand-anything/dashboard add minisearch
```

- [ ] **Step 2: Verify installation**

```bash
grep minisearch packages/dashboard/package.json
```

Expected: `"minisearch": "^7.x.x"` in dependencies.

---

### Task 2: Create code-tokenizer.ts

**Files:**
- Create: `dashboard/src/api/handlers/code-tokenizer.ts`
- Create: `dashboard/src/api/handlers/__tests__/code-tokenizer.test.ts`

- [ ] **Step 1: Write failing tests for codeTokenize**

Create `dashboard/src/api/handlers/__tests__/code-tokenizer.test.ts`:

```typescript
import { describe, it, expect } from "vitest"
import { codeTokenize } from "../code-tokenizer"

describe("codeTokenize", () => {
  describe("CamelCase splitting", () => {
    it("splits camelCase", () => {
      expect(codeTokenize("getUser")).toEqual(
        expect.arrayContaining(["get", "user"]),
      )
    })

    it("splits PascalCase", () => {
      expect(codeTokenize("GetUser")).toEqual(
        expect.arrayContaining(["get", "user"]),
      )
    })

    it("splits consecutive uppercase (HTTPResponse)", () => {
      expect(codeTokenize("HTTPResponse")).toEqual(
        expect.arrayContaining(["http", "response"]),
      )
    })

    it("splits multi-word camelCase (getUserName)", () => {
      const tokens = codeTokenize("getUserName")
      expect(tokens).toEqual(expect.arrayContaining(["get", "user", "name"]))
    })
  })

  describe("snake_case splitting", () => {
    it("splits snake_case", () => {
      expect(codeTokenize("get_user")).toEqual(
        expect.arrayContaining(["get", "user"]),
      )
    })

    it("splits UPPER_SNAKE_CASE", () => {
      expect(codeTokenize("GET_USER")).toEqual(
        expect.arrayContaining(["get", "user"]),
      )
    })
  })

  describe("separator splitting", () => {
    it("splits kebab-case", () => {
      expect(codeTokenize("get-user")).toEqual(
        expect.arrayContaining(["get", "user"]),
      )
    })

    it("splits dot notation", () => {
      expect(codeTokenize("spring.datasource.url")).toEqual(
        expect.arrayContaining(["spring", "datasource", "url"]),
      )
    })

    it("splits slash notation", () => {
      expect(codeTokenize("src/main/java")).toEqual(
        expect.arrayContaining(["src", "main", "java"]),
      )
    })
  })

  describe("number extraction", () => {
    it("extracts multi-digit numbers", () => {
      expect(codeTokenize("v2")).toEqual(
        expect.arrayContaining(["v2"]),
      )
    })

    it("extracts standalone numbers", () => {
      expect(codeTokenize("123")).toEqual(
        expect.arrayContaining(["123"]),
      )
    })

    it("filters single-digit numbers", () => {
      const tokens = codeTokenize("a1b")
      expect(tokens).not.toContain("1")
    })
  })

  describe("CJK segmentation", () => {
    it("segments Chinese text", () => {
      const tokens = codeTokenize("用户认证")
      expect(tokens.length).toBeGreaterThan(0)
      expect(tokens.some((t) => /[一-鿿]/.test(t))).toBe(true)
    })

    it("handles mixed Chinese and English", () => {
      const tokens = codeTokenize("UserService 用户服务")
      expect(tokens).toEqual(expect.arrayContaining(["user", "service"]))
      expect(tokens.some((t) => /[一-鿿]/.test(t))).toBe(true)
    })
  })

  describe("edge cases", () => {
    it("returns empty array for empty string", () => {
      expect(codeTokenize("")).toEqual([])
    })

    it("filters single-character tokens", () => {
      const tokens = codeTokenize("a b c")
      expect(tokens).toEqual([])
    })

    it("returns empty for whitespace only", () => {
      expect(codeTokenize("   ")).toEqual([])
    })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm --filter @understand-anything/dashboard test -- --run packages/dashboard/src/api/handlers/__tests__/code-tokenizer.test.ts
```

Expected: FAIL — `code-tokenizer` module not found.

- [ ] **Step 3: Implement codeTokenize**

Create `dashboard/src/api/handlers/code-tokenizer.ts`:

```typescript
import jieba from "@node-rs/jieba"

/**
 * Tokenizer for code search. Handles CamelCase, snake_case, kebab-case,
 * dot/slash separators, number extraction, and CJK segmentation (jieba).
 * Used as MiniSearch's `tokenize` option.
 */
export function codeTokenize(text: string): string[] {
  if (!text.trim()) return []

  const tokens: string[] = []

  // CamelCase + consecutive uppercase splitting
  const parts = text
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[\s_\-./\\:,;()[\]{}'"]+/)

  for (const part of parts) {
    if (!part) continue
    const lower = part.toLowerCase()
    if (lower.length >= 2 && /^[\x00-\x7F]+$/.test(lower)) {
      tokens.push(lower)
    }
  }

  // Number extraction (2+ digits)
  const numbers = text.match(/\d{2,}/g)
  if (numbers) {
    for (const num of numbers) {
      tokens.push(num)
    }
  }

  // CJK segmentation via jieba
  const cjk = text.match(/[一-鿿]+/g)
  if (cjk) {
    for (const segment of cjk) {
      try {
        const words = jieba.cut(segment, true)
        for (const word of words) {
          if (word.length > 0) tokens.push(word)
        }
      } catch {
        // Fallback to bigram
        for (let i = 0; i < segment.length - 1; i++) {
          tokens.push(segment.slice(i, i + 2))
        }
        if (segment.length === 1) tokens.push(segment)
      }
    }
  }

  return tokens
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm --filter @understand-anything/dashboard test -- --run packages/dashboard/src/api/handlers/__tests__/code-tokenizer.test.ts
```

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/dashboard/src/api/handlers/code-tokenizer.ts packages/dashboard/src/api/handlers/__tests__/code-tokenizer.test.ts
git commit -m "feat: add codeTokenize for MiniSearch integration"
```

---

### Task 3: Create structure-index.ts

**Files:**
- Create: `dashboard/src/api/handlers/structure-index.ts`
- Create: `dashboard/src/api/handlers/__tests__/structure-index.test.ts`

- [ ] **Step 1: Write failing tests for StructureIndex**

Create `dashboard/src/api/handlers/__tests__/structure-index.test.ts`:

```typescript
import { describe, it, expect } from "vitest"
import { StructureIndex } from "../structure-index"
import type { StructuralAnalysis } from "../structure-index"

const mockData: StructuralAnalysis = {
  "src/UserService.java": {
    language: "java",
    totalLines: 100,
    functions: [
      {
        name: "getUser",
        startLine: 10,
        endLine: 20,
        params: [{ name: "id", type: "Long" }],
        returnType: "User",
        annotations: [{ name: "@GetMapping" }],
      },
      {
        name: "createUser",
        startLine: 25,
        endLine: 35,
        params: [{ name: "dto", type: "CreateUserDto" }],
        returnType: "User",
        annotations: [{ name: "@PostMapping" }],
      },
    ],
    classes: [
      {
        name: "UserService",
        startLine: 1,
        endLine: 50,
        kind: "class",
        annotations: [{ name: "@Service" }],
        interfaces: ["CrudRepository"],
        typedProperties: [{ name: "repository", type: "UserRepository" }],
      },
    ],
    imports: [],
    exports: [],
  },
  "src/OrderService.java": {
    language: "java",
    totalLines: 80,
    functions: [
      {
        name: "getOrder",
        startLine: 10,
        endLine: 20,
        params: [{ name: "id", type: "Long" }],
        returnType: "Order",
      },
    ],
    classes: [
      {
        name: "OrderService",
        startLine: 1,
        endLine: 40,
        kind: "class",
        annotations: [{ name: "@Service" }],
      },
    ],
    imports: [],
    exports: [],
  },
}

describe("StructureIndex", () => {
  describe("fuzzy search", () => {
    it("finds by function name", () => {
      const index = new StructureIndex("test-service", mockData)
      const results = index.search({ q: "getUser" })
      expect(results.results.length).toBeGreaterThan(0)
      expect(results.results[0].name).toBe("getUser")
    })

    it("finds by class name", () => {
      const index = new StructureIndex("test-service", mockData)
      const results = index.search({ q: "UserService" })
      expect(results.results.length).toBeGreaterThan(0)
      expect(results.results.some((r) => r.name === "UserService")).toBe(true)
    })

    it("finds by annotation", () => {
      const index = new StructureIndex("test-service", mockData)
      const results = index.search({ q: "Service" })
      expect(results.results.some((r) => r.annotations?.includes("@Service"))).toBe(true)
    })

    it("cross-style match: get_user matches getUser", () => {
      const index = new StructureIndex("test-service", mockData)
      const results = index.search({ q: "get_user" })
      expect(results.results.some((r) => r.name === "getUser")).toBe(true)
    })
  })

  describe("precise filtering", () => {
    it("filters by annotation", () => {
      const index = new StructureIndex("test-service", mockData)
      const results = index.search({ annotation: "@Service" })
      expect(results.results.every((r) => r.annotations?.includes("@Service"))).toBe(true)
    })

    it("filters by paramType", () => {
      const index = new StructureIndex("test-service", mockData)
      const results = index.search({ paramType: "Long" })
      expect(results.results.length).toBeGreaterThan(0)
    })

    it("filters by returnType", () => {
      const index = new StructureIndex("test-service", mockData)
      const results = index.search({ returnType: "User" })
      expect(results.results.every((r) => r.returnType === "User")).toBe(true)
    })

    it("filters by interface", () => {
      const index = new StructureIndex("test-service", mockData)
      const results = index.search({ iface: "CrudRepository" })
      expect(results.results.some((r) => r.name === "UserService")).toBe(true)
    })

    it("filters by propertyType", () => {
      const index = new StructureIndex("test-service", mockData)
      const results = index.search({ propertyType: "UserRepository" })
      expect(results.results.some((r) => r.name === "UserService")).toBe(true)
    })
  })

  describe("combined fuzzy + precise", () => {
    it("applies fuzzy search on filtered subset", () => {
      const index = new StructureIndex("test-service", mockData)
      const results = index.search({ q: "get", annotation: "@Service" })
      expect(results.results.every((r) => r.annotations?.includes("@Service"))).toBe(true)
    })
  })

  describe("pagination", () => {
    it("returns first page", () => {
      const index = new StructureIndex("test-service", mockData)
      const results = index.search({ q: "Service", limit: 1, offset: 0 })
      expect(results.results.length).toBe(1)
      expect(results.hasMore).toBe(true)
    })

    it("returns second page", () => {
      const index = new StructureIndex("test-service", mockData)
      const page1 = index.search({ q: "Service", limit: 1, offset: 0 })
      const page2 = index.search({ q: "Service", limit: 1, offset: 1 })
      expect(page2.results[0].id).not.toBe(page1.results[0].id)
    })

    it("returns empty past end", () => {
      const index = new StructureIndex("test-service", mockData)
      const results = index.search({ q: "Service", limit: 10, offset: 100 })
      expect(results.results.length).toBe(0)
      expect(results.hasMore).toBe(false)
    })
  })

  describe("facets", () => {
    it("includes type distribution", () => {
      const index = new StructureIndex("test-service", mockData)
      const results = index.search({ q: "Service" })
      expect(results.facets).toBeDefined()
      expect(results.facets!.type).toBeDefined()
    })
  })

  describe("result fields", () => {
    it("every result has id", () => {
      const index = new StructureIndex("test-service", mockData)
      const results = index.search({ q: "getUser" })
      expect(results.results.every((r) => r.id)).toBe(true)
    })

    it("every result has service", () => {
      const index = new StructureIndex("test-service", mockData)
      const results = index.search({ q: "getUser" })
      expect(results.results.every((r) => r.service === "test-service")).toBe(true)
    })

    it("every result has filePath and lineRange", () => {
      const index = new StructureIndex("test-service", mockData)
      const results = index.search({ q: "getUser" })
      expect(results.results.every((r) => r.filePath && r.lineRange)).toBe(true)
    })
  })

  describe("empty data", () => {
    it("returns empty results for empty data", () => {
      const index = new StructureIndex("test-service", {})
      const results = index.search({ q: "anything" })
      expect(results.results.length).toBe(0)
      expect(results.total).toBe(0)
    })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm --filter @understand-anything/dashboard test -- --run packages/dashboard/src/api/handlers/__tests__/structure-index.test.ts
```

Expected: FAIL — `structure-index` module not found.

- [ ] **Step 3: Implement StructureIndex**

Create `dashboard/src/api/handlers/structure-index.ts`:

```typescript
import MiniSearch from "minisearch"
import { codeTokenize } from "./code-tokenizer"

export interface FunctionEntry {
  name: string
  startLine: number
  endLine: number
  params?: Array<{ name: string; type: string }>
  returnType?: string
  annotations?: Array<{ name: string; arguments?: Record<string, string> }>
}

export interface ClassEntry {
  name: string
  startLine: number
  endLine: number
  kind?: string
  methods?: string[]
  properties?: string[]
  annotations?: Array<{ name: string; arguments?: Record<string, string> }>
  interfaces?: string[]
  superclasses?: string[]
  typedProperties?: Array<{ name: string; type: string }>
}

export interface FileStructure {
  language: string
  fileCategory?: string
  totalLines: number
  functions: FunctionEntry[]
  classes: ClassEntry[]
  imports: Array<{ name: string; line?: number }>
  exports: Array<{ name: string; line?: number; isDefault?: boolean }>
}

export type StructuralAnalysis = Record<string, FileStructure>

interface StructureDoc {
  id: string
  name: string
  annotations: string
  paramTypes: string
  returnType: string
  content: string
  type: string
  service: string
  filePath: string
  startLine: number
  endLine: number
}

export interface StructureSearchResult {
  id: string
  name: string
  type: string
  service: string
  filePath: string
  lineRange: [number, number]
  summary: string
  score: number
  annotations?: string
  paramTypes?: string
  returnType?: string
  sectionKey?: string
}

export interface StructureSearchOptions {
  q?: string
  annotation?: string
  paramType?: string
  returnType?: string
  iface?: string
  propertyType?: string
  symbol?: string
  pathPattern?: string
  sectionKey?: string
  sectionValue?: string
  limit?: number
  offset?: number
}

export interface StructureSearchResponse {
  results: StructureSearchResult[]
  total: number
  limit: number
  offset: number
  hasMore: boolean
  facets?: Record<string, Record<string, number>>
}

const MINI_SEARCH_OPTIONS = {
  fields: ["name", "annotations", "paramTypes", "returnType", "content"],
  storeFields: ["name", "type", "service", "filePath", "startLine", "endLine", "annotations", "paramTypes", "returnType"],
  tokenize: codeTokenize,
}

const SEARCH_BOOST = {
  name: 3,
  annotations: 2.5,
  paramTypes: 2,
  returnType: 1.5,
  content: 1,
}

export class StructureIndex {
  private service: string
  private miniSearch: MiniSearch
  private docs: StructureDoc[]

  constructor(service: string, data: StructuralAnalysis) {
    this.service = service
    this.docs = this.buildDocs(service, data)
    this.miniSearch = new MiniSearch(MINI_SEARCH_OPTIONS)
    if (this.docs.length > 0) {
      this.miniSearch.addDocuments(this.docs)
    }
  }

  private buildDocs(service: string, data: StructuralAnalysis): StructureDoc[] {
    const docs: StructureDoc[] = []

    for (const [filePath, fileData] of Object.entries(data)) {
      const functions = Array.isArray(fileData.functions) ? fileData.functions : []
      const classes = Array.isArray(fileData.classes) ? fileData.classes : []

      for (const fn of functions) {
        const annotationNames = (fn.annotations ?? []).map((a) => a.name).join(" ")
        const paramTypes = (fn.params ?? []).map((p) => p.type).join(" ")
        docs.push({
          id: `${service}::${filePath}::${fn.name}`,
          name: fn.name,
          annotations: annotationNames,
          paramTypes,
          returnType: fn.returnType ?? "",
          content: `${service} ${fn.name} ${annotationNames} ${paramTypes} ${fn.returnType ?? ""}`,
          type: "function",
          service,
          filePath,
          startLine: fn.startLine,
          endLine: fn.endLine,
        })
      }

      for (const cls of classes) {
        const annotationNames = (cls.annotations ?? []).map((a) => a.name).join(" ")
        const interfaceNames = (cls.interfaces ?? []).join(" ")
        const propertyTypes = (cls.typedProperties ?? []).map((p) => p.type).join(" ")
        docs.push({
          id: `${service}::${filePath}::${cls.name}`,
          name: cls.name,
          annotations: annotationNames,
          paramTypes: propertyTypes,
          returnType: interfaceNames,
          content: `${service} ${cls.name} ${annotationNames} ${interfaceNames} ${propertyTypes}`,
          type: cls.kind ?? "class",
          service,
          filePath,
          startLine: cls.startLine,
          endLine: cls.endLine,
        })
      }
    }

    return docs
  }

  search(opts: StructureSearchOptions): StructureSearchResponse {
    const limit = opts.limit ?? 50
    const offset = opts.offset ?? 0

    const filter = (doc: Record<string, unknown>): boolean => {
      if (opts.annotation && !(doc.annotations as string ?? "").includes(opts.annotation)) return false
      if (opts.paramType && !(doc.paramTypes as string ?? "").includes(opts.paramType)) return false
      if (opts.returnType && doc.returnType !== opts.returnType) return false
      if (opts.iface && !(doc.returnType as string ?? "").includes(opts.iface)) return false
      if (opts.propertyType && !(doc.paramTypes as string ?? "").includes(opts.propertyType)) return false
      if (opts.pathPattern && !(doc.filePath as string ?? "").toLowerCase().includes(opts.pathPattern.toLowerCase())) return false
      return true
    }

    let miniResults: Array<{ id: string; score: number; [key: string]: unknown }>

    if (opts.q) {
      miniResults = this.miniSearch.search(opts.q, {
        filter,
        boost: SEARCH_BOOST,
        prefix: true,
        fuzzy: 0.2,
      })
    } else {
      miniResults = this.docs
        .filter((doc) => filter(doc as Record<string, unknown>))
        .map((doc) => ({ id: doc.id, score: 0, ...doc }))
    }

    let filtered = miniResults
    if (opts.symbol) {
      const symbolLower = opts.symbol.toLowerCase()
      filtered = filtered.filter((r) => (r.name as string).toLowerCase().includes(symbolLower))
    }

    const total = filtered.length
    const paged = filtered.slice(offset, offset + limit)

    const results: StructureSearchResult[] = paged.map((r) => ({
      id: r.id as string,
      name: r.name as string,
      type: r.type as string,
      service: r.service as string,
      filePath: r.filePath as string,
      lineRange: [r.startLine as number, r.endLine as number],
      summary: `${r.type} ${(r.name as string)} in ${r.filePath as string}`,
      score: r.score,
      annotations: r.annotations as string | undefined,
      paramTypes: r.paramTypes as string | undefined,
      returnType: r.returnType as string | undefined,
    }))

    return {
      results,
      total,
      limit,
      offset,
      hasMore: offset + limit < total,
      facets: this.computeFacets(filtered),
    }
  }

  private computeFacets(results: Array<Record<string, unknown>>): Record<string, Record<string, number>> {
    const facets: Record<string, Record<string, number>> = {}
    for (const r of results) {
      for (const key of ["type", "service"]) {
        const val = r[key] as string
        if (!val) continue
        facets[key] ??= {}
        facets[key][val] = (facets[key][val] ?? 0) + 1
      }
    }
    return facets
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm --filter @understand-anything/dashboard test -- --run packages/dashboard/src/api/handlers/__tests__/structure-index.test.ts
```

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/dashboard/src/api/handlers/structure-index.ts packages/dashboard/src/api/handlers/__tests__/structure-index.test.ts
git commit -m "feat: add StructureIndex with MiniSearch"
```

---

### Task 4: Update structure.ts handler

**Files:**
- Modify: `dashboard/src/api/handlers/structure.ts:185-373` (handleSearch function)
- Modify: `dashboard/src/api/handlers/structure.ts:633-638` (handleStructureRequest)

- [ ] **Step 1: Write failing integration test for q parameter**

Create `dashboard/src/api/handlers/__tests__/structure-search.test.ts`:

```typescript
import { describe, it, expect } from "vitest"
import { handleStructureSearchRequest } from "../structure"
import type { ApiRequest, ApiContext } from "../types"

function makeRequest(params: Record<string, string>): ApiRequest {
  const searchParams = new URLSearchParams(params)
  return {
    pathname: "/api/structure/search",
    searchParams,
    method: "GET",
    url: `/api/structure/search?${searchParams.toString()}`,
    headers: {},
    body: undefined,
  } as ApiRequest
}

const mockCtx = {} as ApiContext

describe("structure search handler", () => {
  it("returns 400 when no q and no filter", async () => {
    const req = makeRequest({ service: "test-service" })
    const res = await handleStructureSearchRequest(req, mockCtx)
    expect(res?.statusCode).toBe(400)
  })

  it("accepts q parameter for fuzzy search", async () => {
    const req = makeRequest({ service: "test-service", q: "getUser" })
    const res = await handleStructureSearchRequest(req, mockCtx)
    expect(res?.statusCode).not.toBe(400)
  })

  it("accepts sectionKey parameter", async () => {
    const req = makeRequest({ service: "test-service", sectionKey: "spring.datasource.url" })
    const res = await handleStructureSearchRequest(req, mockCtx)
    expect(res?.statusCode).not.toBe(400)
  })

  it("accepts offset parameter", async () => {
    const req = makeRequest({ service: "test-service", q: "getUser", offset: "0", limit: "10" })
    const res = await handleStructureSearchRequest(req, mockCtx)
    expect(res?.statusCode).not.toBe(400)
  })

  it("returns 400 for negative offset", async () => {
    const req = makeRequest({ service: "test-service", q: "getUser", offset: "-1" })
    const res = await handleStructureSearchRequest(req, mockCtx)
    expect(res?.statusCode).toBe(400)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm --filter @understand-anything/dashboard test -- --run packages/dashboard/src/api/handlers/__tests__/structure-search.test.ts
```

Expected: FAIL — `handleStructureSearchRequest` not exported or q parameter rejected.

- [ ] **Step 3: Update structure.ts handleSearch to use StructureIndex**

Modify `dashboard/src/api/handlers/structure.ts` — replace the `handleSearch` function (lines 185-373) to use `StructureIndex`. Add import at top:

```typescript
import { StructureIndex } from "./structure-index"
import type { StructureSearchOptions } from "./structure-index"
```

Replace the `handleSearch` function body with:

```typescript
function handleSearch(
  service: string,
  searchParams: URLSearchParams,
): ApiResponse {
  const q = searchParams.get("q")?.trim() || undefined
  const annotation = searchParams.get("annotation") || undefined
  const paramType = searchParams.get("paramType") || undefined
  const returnType = searchParams.get("returnType") || undefined
  const iface = searchParams.get("interface") || undefined
  const propertyType = searchParams.get("propertyType") || undefined
  const symbol = searchParams.get("symbol") || undefined
  const pathPattern = searchParams.get("pathPattern") || undefined
  const sectionKey = searchParams.get("sectionKey") || undefined
  const sectionValue = searchParams.get("sectionValue") || undefined

  const limitStr = searchParams.get("limit")
  const limit = limitStr === null ? 50 : Number.parseInt(limitStr, 10)
  if (!Number.isFinite(limit) || limit < 1 || limit > 500) {
    return { statusCode: 400, body: { error: "limit must be between 1 and 500" } }
  }

  const offsetStr = searchParams.get("offset")
  const offset = offsetStr === null ? 0 : Number.parseInt(offsetStr, 10)
  if (!Number.isFinite(offset) || offset < 0) {
    return { statusCode: 400, body: { error: "offset must be >= 0" } }
  }

  if (!q && !annotation && !paramType && !returnType && !iface && !propertyType && !symbol && !sectionKey && !sectionValue) {
    return {
      statusCode: 400,
      body: {
        error: "At least one search filter required: q, annotation, paramType, returnType, interface, propertyType, symbol, sectionKey, sectionValue",
      },
    }
  }

  const data = loadStructuralAnalysis(service)
  if (!data) {
    return {
      statusCode: 404,
      body: { error: `structural-analysis.json not found for service "${service}"` },
    }
  }

  const index = new StructureIndex(service, data)
  const result = index.search({
    q, annotation, paramType, returnType, iface, propertyType,
    symbol, pathPattern, sectionKey, sectionValue, limit, offset,
  })

  return {
    statusCode: 200,
    body: {
      results: result.results,
      total: result.total,
      limit: result.limit,
      offset: result.offset,
      hasMore: result.hasMore,
      facets: result.facets,
      query: { q, annotation, paramType, returnType },
    },
  }
}
```

- [ ] **Step 4: Export handleStructureSearchRequest for testing**

Add to `dashboard/src/api/handlers/structure.ts`:

```typescript
export async function handleStructureSearchRequest(
  req: ApiRequest,
  _ctx: ApiContext,
): Promise<ApiResponse | null> {
  if (req.pathname !== "/api/structure/search") return null
  const service = req.searchParams.get("service")
  const err = validateServiceNameRequired(service)
  if (err) return err
  return handleSearch(service!, req.searchParams)
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
pnpm --filter @understand-anything/dashboard test -- --run packages/dashboard/src/api/handlers/__tests__/structure-search.test.ts
```

Expected: All tests PASS.

- [ ] **Step 6: Run existing structure tests to verify no regression**

```bash
pnpm --filter @understand-anything/dashboard test -- --run packages/dashboard/src/api/handlers/__tests__/search.test.ts
```

Expected: Existing tests still PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/dashboard/src/api/handlers/structure.ts packages/dashboard/src/api/handlers/__tests__/structure-search.test.ts
git commit -m "feat: update structure search handler with MiniSearch, q, pagination, facets"
```

---

## Phase 2: KG/Wiki search (migrate LumoSearch)

### Task 5: Create kg-index.ts

**Files:**
- Create: `dashboard/src/api/handlers/kg-index.ts`
- Create: `dashboard/src/api/handlers/__tests__/kg-index.test.ts`

- [ ] **Step 1: Write failing tests for KgIndex**

Create `dashboard/src/api/handlers/__tests__/kg-index.test.ts`:

```typescript
import { describe, it, expect } from "vitest"
import { KgIndex } from "../kg-index"
import type { KnowledgeGraph } from "@understand-anything/core"

const mockKg: KnowledgeGraph = {
  nodes: [
    {
      id: "node::UserService",
      name: "UserService",
      type: "class",
      summary: "Handles user CRUD operations",
      tags: ["user", "service"],
      filePath: "src/UserService.java",
      lineRange: [1, 50],
    },
    {
      id: "node::AuthController",
      name: "AuthController",
      type: "endpoint",
      summary: "Authentication endpoints",
      tags: ["auth", "controller"],
      filePath: "src/AuthController.java",
      lineRange: [1, 30],
    },
    {
      id: "node::DatabasePool",
      name: "DatabasePool",
      type: "class",
      summary: "Connection pooling",
      tags: ["database"],
      filePath: "src/DatabasePool.java",
      lineRange: [1, 40],
    },
  ],
  edges: [
    { source: "node::AuthController", target: "node::UserService", type: "uses" },
  ],
}

describe("KgIndex", () => {
  describe("fuzzy search", () => {
    it("finds by name", () => {
      const index = new KgIndex(mockKg, "test-service")
      const results = index.search({ q: "UserService" })
      expect(results.results.length).toBeGreaterThan(0)
      expect(results.results[0].name).toBe("UserService")
    })

    it("finds by summary", () => {
      const index = new KgIndex(mockKg, "test-service")
      const results = index.search({ q: "authentication" })
      expect(results.results.some((r) => r.name === "AuthController")).toBe(true)
    })

    it("finds by tag", () => {
      const index = new KgIndex(mockKg, "test-service")
      const results = index.search({ q: "auth" })
      expect(results.results.some((r) => r.name === "AuthController")).toBe(true)
    })
  })

  describe("precise filtering", () => {
    it("filters by type", () => {
      const index = new KgIndex(mockKg, "test-service")
      const results = index.search({ q: "Service", type: "class" })
      expect(results.results.every((r) => r.type === "class")).toBe(true)
    })

    it("filters by tag", () => {
      const index = new KgIndex(mockKg, "test-service")
      const results = index.search({ tag: "auth" })
      expect(results.results.every((r) => r.tags?.includes("auth"))).toBe(true)
    })

    it("filters by service", () => {
      const index = new KgIndex(mockKg, "test-service")
      const results = index.search({ service: "test-service" })
      expect(results.results.every((r) => r.service === "test-service")).toBe(true)
    })
  })

  describe("pagination", () => {
    it("respects limit", () => {
      const index = new KgIndex(mockKg, "test-service")
      const results = index.search({ q: "Service", limit: 1 })
      expect(results.results.length).toBe(1)
    })

    it("respects offset", () => {
      const index = new KgIndex(mockKg, "test-service")
      const page1 = index.search({ q: "Service", limit: 1, offset: 0 })
      const page2 = index.search({ q: "Service", limit: 1, offset: 1 })
      expect(page2.results[0].id).not.toBe(page1.results[0].id)
    })
  })

  describe("facets", () => {
    it("includes type and service distribution", () => {
      const index = new KgIndex(mockKg, "test-service")
      const results = index.search({ q: "Service" })
      expect(results.facets).toBeDefined()
      expect(results.facets!.type).toBeDefined()
      expect(results.facets!.service).toBeDefined()
    })
  })

  describe("result fields", () => {
    it("every result has id", () => {
      const index = new KgIndex(mockKg, "test-service")
      const results = index.search({ q: "User" })
      expect(results.results.every((r) => r.id)).toBe(true)
    })

    it("every result has score", () => {
      const index = new KgIndex(mockKg, "test-service")
      const results = index.search({ q: "User" })
      expect(results.results.every((r) => typeof r.score === "number")).toBe(true)
    })
  })

  describe("empty graph", () => {
    it("returns empty results", () => {
      const index = new KgIndex({ nodes: [], edges: [] }, "test-service")
      const results = index.search({ q: "anything" })
      expect(results.results.length).toBe(0)
    })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm --filter @understand-anything/dashboard test -- --run packages/dashboard/src/api/handlers/__tests__/kg-index.test.ts
```

Expected: FAIL — `kg-index` module not found.

- [ ] **Step 3: Implement KgIndex**

Create `dashboard/src/api/handlers/kg-index.ts`:

```typescript
import MiniSearch from "minisearch"
import { codeTokenize } from "./code-tokenizer"
import type { KnowledgeGraph } from "@understand-anything/core"

interface KgDoc {
  id: string
  name: string
  summary: string
  tags: string
  type: string
  service: string
  filePath: string
  startLine: number
  endLine: number
  layer: string
}

export interface KgSearchResult {
  id: string
  name: string
  type: string
  layer: string
  summary: string
  score: number
  service?: string
  filePath?: string
  lineRange?: [number, number]
  tags?: string
}

export interface KgSearchOptions {
  q?: string
  scope?: string
  type?: string
  tag?: string
  service?: string
  limit?: number
  offset?: number
}

export interface KgSearchResponse {
  results: KgSearchResult[]
  total: number
  limit: number
  offset: number
  hasMore: boolean
  facets?: Record<string, Record<string, number>>
}

const MINI_SEARCH_OPTIONS = {
  fields: ["name", "summary", "tags", "type"],
  storeFields: ["name", "type", "service", "filePath", "startLine", "endLine", "summary", "tags", "layer"],
  tokenize: codeTokenize,
}

const SEARCH_BOOST = {
  name: 3,
  tags: 2.5,
  summary: 2,
  type: 0.5,
}

export class KgIndex {
  private miniSearch: MiniSearch
  private docs: KgDoc[]

  constructor(graph: KnowledgeGraph, serviceName: string) {
    this.docs = this.buildDocs(graph, serviceName)
    this.miniSearch = new MiniSearch(MINI_SEARCH_OPTIONS)
    if (this.docs.length > 0) {
      this.miniSearch.addDocuments(this.docs)
    }
  }

  private buildDocs(graph: KnowledgeGraph, serviceName: string): KgDoc[] {
    if (!Array.isArray(graph?.nodes)) return []

    return graph.nodes.map((node) => ({
      id: node.id,
      name: node.name,
      summary: node.summary ?? "",
      tags: (node.tags ?? []).join(" "),
      type: node.type,
      service: serviceName,
      filePath: node.filePath ?? "",
      startLine: node.lineRange?.[0] ?? 0,
      endLine: node.lineRange?.[1] ?? 0,
      layer: "kg",
    }))
  }

  search(opts: KgSearchOptions): KgSearchResponse {
    const limit = opts.limit ?? 20
    const offset = opts.offset ?? 0

    const filter = (doc: Record<string, unknown>): boolean => {
      if (opts.scope && opts.scope !== "all" && doc.layer !== opts.scope) return false
      if (opts.type && doc.type !== opts.type) return false
      if (opts.tag && !(doc.tags as string ?? "").includes(opts.tag)) return false
      if (opts.service && doc.service !== opts.service) return false
      return true
    }

    let miniResults: Array<{ id: string; score: number; [key: string]: unknown }>

    if (opts.q) {
      miniResults = this.miniSearch.search(opts.q, {
        filter,
        boost: SEARCH_BOOST,
        prefix: true,
        fuzzy: 0.2,
      })
    } else {
      miniResults = this.docs
        .filter((doc) => filter(doc as Record<string, unknown>))
        .map((doc) => ({ id: doc.id, score: 0, ...doc }))
    }

    const total = miniResults.length
    const paged = miniResults.slice(offset, offset + limit)

    const results: KgSearchResult[] = paged.map((r) => ({
      id: r.id,
      name: r.name as string,
      type: r.type as string,
      layer: r.layer as string,
      summary: r.summary as string,
      score: r.score,
      service: r.service as string | undefined,
      filePath: r.filePath as string | undefined,
      lineRange: r.startLine ? [r.startLine as number, r.endLine as number] : undefined,
      tags: r.tags as string | undefined,
    }))

    return {
      results,
      total,
      limit,
      offset,
      hasMore: offset + limit < total,
      facets: this.computeFacets(miniResults),
    }
  }

  private computeFacets(results: Array<Record<string, unknown>>): Record<string, Record<string, number>> {
    const facets: Record<string, Record<string, number>> = {}
    for (const r of results) {
      for (const key of ["type", "service", "layer"]) {
        const val = r[key] as string
        if (!val) continue
        facets[key] ??= {}
        facets[key][val] = (facets[key][val] ?? 0) + 1
      }
    }
    return facets
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm --filter @understand-anything/dashboard test -- --run packages/dashboard/src/api/handlers/__tests__/kg-index.test.ts
```

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/dashboard/src/api/handlers/kg-index.ts packages/dashboard/src/api/handlers/__tests__/kg-index.test.ts
git commit -m "feat: add KgIndex with MiniSearch for KG/Domain/Business"
```

---

### Task 6: Create wiki-index.ts

**Files:**
- Create: `dashboard/src/api/handlers/wiki-index.ts`
- Create: `dashboard/src/api/handlers/__tests__/wiki-index.test.ts`

- [ ] **Step 1: Write failing tests for WikiIndex**

Create `dashboard/src/api/handlers/__tests__/wiki-index.test.ts`:

```typescript
import { describe, it, expect } from "vitest"
import { WikiIndex } from "../wiki-index"

const mockWiki = {
  entries: [
    {
      id: "wiki::auth",
      name: "Authentication",
      summary: "How authentication works",
      content: "JWT tokens are used for auth",
      type: "concept",
      service: "auth-service",
    },
    {
      id: "wiki::database",
      name: "Database",
      summary: "Database architecture",
      content: "PostgreSQL with connection pooling",
      type: "concept",
      service: "db-service",
    },
  ],
}

describe("WikiIndex", () => {
  it("finds by name", () => {
    const index = new WikiIndex(mockWiki)
    const results = index.search({ q: "Authentication" })
    expect(results.results.length).toBeGreaterThan(0)
    expect(results.results[0].name).toBe("Authentication")
  })

  it("finds by content", () => {
    const index = new WikiIndex(mockWiki)
    const results = index.search({ q: "PostgreSQL" })
    expect(results.results.some((r) => r.name === "Database")).toBe(true)
  })

  it("filters by service", () => {
    const index = new WikiIndex(mockWiki)
    const results = index.search({ service: "auth-service" })
    expect(results.results.every((r) => r.service === "auth-service")).toBe(true)
  })

  it("paginates results", () => {
    const index = new WikiIndex(mockWiki)
    const results = index.search({ q: "auth", limit: 1, offset: 0 })
    expect(results.results.length).toBeLessThanOrEqual(1)
  })

  it("includes facets", () => {
    const index = new WikiIndex(mockWiki)
    const results = index.search({ q: "auth" })
    expect(results.facets).toBeDefined()
  })

  it("every result has id", () => {
    const index = new WikiIndex(mockWiki)
    const results = index.search({ q: "auth" })
    expect(results.results.every((r) => r.id)).toBe(true)
  })

  it("returns empty for empty wiki", () => {
    const index = new WikiIndex({ entries: [] })
    const results = index.search({ q: "anything" })
    expect(results.results.length).toBe(0)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm --filter @understand-anything/dashboard test -- --run packages/dashboard/src/api/handlers/__tests__/wiki-index.test.ts
```

Expected: FAIL — `wiki-index` module not found.

- [ ] **Step 3: Implement WikiIndex**

Create `dashboard/src/api/handlers/wiki-index.ts`:

```typescript
import MiniSearch from "minisearch"
import { codeTokenize } from "./code-tokenizer"

interface WikiEntry {
  id: string
  name: string
  summary: string
  content?: string
  type: string
  service?: string
}

interface WikiData {
  entries?: WikiEntry[]
}

interface WikiDoc {
  id: string
  name: string
  summary: string
  content: string
  type: string
  service: string
}

export interface WikiSearchResult {
  id: string
  name: string
  type: string
  summary: string
  score: number
  service?: string
}

export interface WikiSearchOptions {
  q?: string
  service?: string
  limit?: number
  offset?: number
}

export interface WikiSearchResponse {
  results: WikiSearchResult[]
  total: number
  limit: number
  offset: number
  hasMore: boolean
  facets?: Record<string, Record<string, number>>
}

const MINI_SEARCH_OPTIONS = {
  fields: ["name", "summary", "content"],
  storeFields: ["name", "type", "service", "summary"],
  tokenize: codeTokenize,
}

const SEARCH_BOOST = {
  name: 3,
  summary: 2,
  content: 1,
}

export class WikiIndex {
  private miniSearch: MiniSearch
  private docs: WikiDoc[]

  constructor(data: WikiData, serviceName?: string) {
    this.docs = this.buildDocs(data, serviceName)
    this.miniSearch = new MiniSearch(MINI_SEARCH_OPTIONS)
    if (this.docs.length > 0) {
      this.miniSearch.addDocuments(this.docs)
    }
  }

  private buildDocs(data: WikiData, serviceName?: string): WikiDoc[] {
    return (data.entries ?? []).map((entry) => ({
      id: entry.id,
      name: entry.name,
      summary: entry.summary ?? "",
      content: entry.content ?? "",
      type: entry.type,
      service: entry.service ?? serviceName ?? "",
    }))
  }

  search(opts: WikiSearchOptions): WikiSearchResponse {
    const limit = opts.limit ?? 20
    const offset = opts.offset ?? 0

    const filter = (doc: Record<string, unknown>): boolean => {
      if (opts.service && doc.service !== opts.service) return false
      return true
    }

    let miniResults: Array<{ id: string; score: number; [key: string]: unknown }>

    if (opts.q) {
      miniResults = this.miniSearch.search(opts.q, {
        filter,
        boost: SEARCH_BOOST,
        prefix: true,
        fuzzy: 0.2,
      })
    } else {
      miniResults = this.docs
        .filter((doc) => filter(doc as Record<string, unknown>))
        .map((doc) => ({ id: doc.id, score: 0, ...doc }))
    }

    const total = miniResults.length
    const paged = miniResults.slice(offset, offset + limit)

    const results: WikiSearchResult[] = paged.map((r) => ({
      id: r.id,
      name: r.name as string,
      type: r.type as string,
      summary: r.summary as string,
      score: r.score,
      service: r.service as string | undefined,
    }))

    return {
      results,
      total,
      limit,
      offset,
      hasMore: offset + limit < total,
      facets: this.computeFacets(miniResults),
    }
  }

  private computeFacets(results: Array<Record<string, unknown>>): Record<string, Record<string, number>> {
    const facets: Record<string, Record<string, number>> = {}
    for (const r of results) {
      const val = r.service as string
      if (!val) continue
      facets.service ??= {}
      facets.service[val] = (facets.service[val] ?? 0) + 1
    }
    return facets
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm --filter @understand-anything/dashboard test -- --run packages/dashboard/src/api/handlers/__tests__/wiki-index.test.ts
```

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/dashboard/src/api/handlers/wiki-index.ts packages/dashboard/src/api/handlers/__tests__/wiki-index.test.ts
git commit -m "feat: add WikiIndex with MiniSearch"
```

---

### Task 7: Update search.ts handler (migrate LumoSearch)

**Files:**
- Modify: `dashboard/src/api/handlers/search.ts`

- [ ] **Step 1: Write failing tests for new search parameters**

Add to `dashboard/src/api/handlers/__tests__/search.test.ts`:

```typescript
import { describe, it, expect } from "vitest"
import { handleSearchRequest } from "../search"
import type { ApiRequest, ApiContext } from "../types"

function makeSearchParams(params: Record<string, string>): ApiRequest {
  const searchParams = new URLSearchParams(params)
  return {
    pathname: "/api/search",
    searchParams,
    method: "GET",
    url: `/api/search?${searchParams.toString()}`,
    headers: {},
    body: undefined,
  } as ApiRequest
}

const mockCtx = {} as ApiContext

describe("search handler - new features", () => {
  it("accepts type filter", async () => {
    const req = makeSearchParams({ q: "user", type: "class" })
    const res = await handleSearchRequest(req, mockCtx)
    expect(res?.statusCode).not.toBe(400)
  })

  it("accepts tag filter", async () => {
    const req = makeSearchParams({ q: "user", tag: "auth" })
    const res = await handleSearchRequest(req, mockCtx)
    expect(res?.statusCode).not.toBe(400)
  })

  it("accepts offset parameter", async () => {
    const req = makeSearchParams({ q: "user", offset: "0" })
    const res = await handleSearchRequest(req, mockCtx)
    expect(res?.statusCode).not.toBe(400)
  })

  it("returns 400 for negative offset", async () => {
    const req = makeSearchParams({ q: "user", offset: "-1" })
    const res = await handleSearchRequest(req, mockCtx)
    expect(res?.statusCode).toBe(400)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm --filter @understand-anything/dashboard test -- --run packages/dashboard/src/api/handlers/__tests__/search.test.ts
```

Expected: FAIL — `type`, `tag`, `offset` parameters not accepted.

- [ ] **Step 3: Update search.ts — replace LumoSearch with KgIndex + WikiIndex**

Replace imports at top of `dashboard/src/api/handlers/search.ts`:

```typescript
// Remove: import { LumoSearch } from "@lumosearch/search"
// Remove: import jieba from "@node-rs/jieba" (if no longer used)
// Add:
import { KgIndex } from "./kg-index"
import type { KgSearchOptions } from "./kg-index"
import { WikiIndex } from "./wiki-index"
import type { WikiSearchOptions } from "./wiki-index"
```

Replace `handleSearch` function to use KgIndex + WikiIndex, add type/tag/offset params, add facets.

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm --filter @understand-anything/dashboard test -- --run packages/dashboard/src/api/handlers/__tests__/search.test.ts
```

Expected: All tests PASS.

- [ ] **Step 5: Run all dashboard tests to verify no regression**

```bash
pnpm --filter @understand-anything/dashboard test
```

Expected: All tests PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/dashboard/src/api/handlers/search.ts packages/dashboard/src/api/handlers/__tests__/search.test.ts
git commit -m "feat: migrate search.ts from LumoSearch to MiniSearch (KgIndex + WikiIndex)"
```

---

## Phase 3: Core search (migrate Fuse.js)

### Task 8: Update core/src/search.ts

**Files:**
- Modify: `core/src/search.ts`
- Modify: `core/src/__tests__/search.test.ts`

- [ ] **Step 1: Run existing core search tests to capture baseline**

```bash
pnpm --filter @understand-anything/core test -- --run src/__tests__/search.test.ts
```

Expected: All tests PASS (capture current behavior).

- [ ] **Step 2: Replace Fuse.js with MiniSearch in core/src/search.ts**

Replace the entire file content:

```typescript
import MiniSearch from "minisearch"
import type { GraphNode } from "./types.js"

export interface SearchResult {
  nodeId: string
  score: number
}

export interface SearchOptions {
  types?: GraphNode["type"][]
  limit?: number
}

function coreTokenize(text: string): string[] {
  if (!text.trim()) return []

  const tokens: string[] = []

  const parts = text
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[\s_\-./\\:,;()[\]{}'"]+/)

  for (const part of parts) {
    if (!part) continue
    const lower = part.toLowerCase()
    if (lower.length >= 2 && /^[\x00-\x7F]+$/.test(lower)) {
      tokens.push(lower)
    }
  }

  const numbers = text.match(/\d{2,}/g)
  if (numbers) {
    for (const num of numbers) {
      tokens.push(num)
    }
  }

  return tokens
}

const MINI_SEARCH_OPTIONS = {
  fields: ["name", "tags", "summary", "knowledgeMeta.content", "languageNotes"],
  storeFields: ["name", "type", "id"],
  tokenize: coreTokenize,
}

const SEARCH_BOOST = {
  name: 0.3,
  tags: 0.2,
  summary: 0.2,
  "knowledgeMeta.content": 0.2,
  languageNotes: 0.1,
}

export class SearchEngine {
  private miniSearch: MiniSearch
  private nodes: GraphNode[]

  constructor(nodes: GraphNode[]) {
    this.nodes = nodes
    this.miniSearch = new MiniSearch(MINI_SEARCH_OPTIONS)
    this.miniSearch.addDocuments(nodes.map((n) => ({
      ...n,
      tags: (n.tags ?? []).join(" "),
      "knowledgeMeta.content": n.knowledgeMeta?.content ?? "",
      languageNotes: n.languageNotes ?? "",
    })))
  }

  search(query: string, options?: SearchOptions): SearchResult[] {
    const trimmed = query.trim()
    if (!trimmed) return []

    const limit = options?.limit ?? 50

    const filter = options?.types && options.types.length > 0
      ? (doc: Record<string, unknown>) => options.types!.includes(doc.type as GraphNode["type"])
      : undefined

    const results = this.miniSearch.search(trimmed, {
      filter,
      boost: SEARCH_BOOST,
      prefix: true,
      fuzzy: 0.2,
    })

    return results.slice(0, limit).map((r) => ({
      nodeId: r.id,
      score: r.score,
    }))
  }

  updateNodes(nodes: GraphNode[]): void {
    this.nodes = nodes
    this.miniSearch = new MiniSearch(MINI_SEARCH_OPTIONS)
    this.miniSearch.addDocuments(nodes.map((n) => ({
      ...n,
      tags: (n.tags ?? []).join(" "),
      "knowledgeMeta.content": n.knowledgeMeta?.content ?? "",
      languageNotes: n.languageNotes ?? "",
    })))
  }
}
```

- [ ] **Step 3: Run existing core search tests**

```bash
pnpm --filter @understand-anything/core test -- --run src/__tests__/search.test.ts
```

Expected: All tests PASS. If any fail due to scoring differences, tune the boost weights.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/search.ts
git commit -m "feat: migrate core SearchEngine from Fuse.js to MiniSearch"
```

---

## Phase 4: Cleanup

### Task 9: Remove old dependencies and dead code

**Files:**
- Modify: `dashboard/package.json`
- Modify: `core/package.json`
- Modify: `dashboard/src/api/handlers/search.ts` (remove dead code)

- [ ] **Step 1: Remove @lumosearch/search from dashboard**

```bash
pnpm --filter @understand-anything/dashboard remove @lumosearch/search
```

- [ ] **Step 2: Check if fuse.js is used elsewhere in dashboard**

```bash
grep -r "fuse" packages/dashboard/src/ --include="*.ts" | grep -v "rrf-fuse" | grep -v "__tests__" | grep -v "node_modules"
```

If no results, remove fuse.js from dashboard:

```bash
pnpm --filter @understand-anything/dashboard remove fuse.js
```

- [ ] **Step 3: Remove fuse.js from core**

```bash
pnpm --filter @understand-anything/core remove fuse.js
```

- [ ] **Step 4: Remove dead code from search.ts**

Remove from `dashboard/src/api/handlers/search.ts`:
- `import { LumoSearch } from "@lumosearch/search"` (if still present)
- `import jieba from "@node-rs/jieba"` (if no longer used)
- `buildLumoIndex()` function
- `LumoDocument` interface
- `SearchIndexItem` interface (if no longer used)
- `cjkTokenScores()` function (if no longer used)
- `buildTokenizedDocs()` function (if no longer used)
- `lumoSearch()` function
- `SearchIndexState` interface (if no longer used)
- `searchIndexCache` map (if no longer used)
- `warmupSearchIndex()` function (if no longer used or update to use MiniSearch)

Keep:
- `UnifiedSearchResult` interface
- `tokenize()` function (may still be used by warmup or other callers)
- `kgGraphExpansion()` function
- `rrfFuse` import and usage
- `pushKgItems()`, `pushWikiItems()`, `pushDomainItems()`, `pushBusinessItems()`
- `collectIndexMtimes()`, `mtimesEqual()`
- `handleUnifiedSearch()` export

- [ ] **Step 5: Run all tests**

```bash
pnpm test
```

Expected: All tests PASS across all packages.

- [ ] **Step 6: Build all packages**

```bash
pnpm --filter @understand-anything/core build
pnpm --filter @understand-anything/dashboard build
```

Expected: Build succeeds with no errors.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore: remove LumoSearch and Fuse.js dependencies, clean up dead code"
```

---

## Verification

After all phases, verify:

1. **All tests pass**: `pnpm test`
2. **All builds succeed**: `pnpm --filter @understand-anything/core build && pnpm --filter @understand-anything/dashboard build`
3. **No old dependencies**: `grep -r "lumosearch\|fuse.js" packages/*/package.json` should return nothing
4. **Coverage**: `pnpm test -- --coverage` — all search modules at 100% line + branch
5. **Dashboard dev server starts**: `pnpm dev:dashboard` — no errors
6. **Manual test**: Search via dashboard UI, verify results appear
