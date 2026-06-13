# Unified Search Architecture Design

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace LumoSearch + Fuse.js with MiniSearch as the unified search engine, enhance both `/api/search` and `/api/structure/search` with fuzzy + precise capabilities.

**Architecture:** MiniSearch-based search with per-source indices, custom code tokenizer, faceted stats.

---

## Problem

Current search has these issues:

1. **Fragmented search libraries**: LumoSearch (dashboard) + Fuse.js (core) — two libraries doing the same thing
2. **Split capabilities**: `/api/search` only fuzzy, `/api/structure/search` only precise
3. **No search statistics**: Agent can't see result distribution, must iterate to understand search space
4. **No pagination**: `hasMore: true` but no way to fetch next page
5. **Missing result IDs**: KG/Wiki results lack `id` field, agent can't call detail endpoints
6. **No error handling spec**: Invalid parameter behavior undefined
7. **sectionKey/sectionValue data source unclear**: structural-analysis.json doesn't contain section data

## Solution

Replace both LumoSearch and Fuse.js with **MiniSearch** — a single, mature search library (6k+ stars, TypeScript native, BM25-like scoring, built-in fuzzy/prefix/filter).

Keep two independent APIs, each enhanced with both fuzzy and precise capabilities.

```
/api/search          — KG/Wiki/Domain/Business (fuzzy + precise)
/api/structure/search — Structure functions/classes/config (fuzzy + precise)
```

## Why MiniSearch

| | LumoSearch | Fuse.js | MiniSearch |
|--|---|---|---|
| Multi-field weights | ✅ | ✅ | ✅ |
| Precise filter | predicate (limited) | ❌ | built-in filter |
| Fuzzy (edit distance) | ❌ | ✅ | ✅ |
| Prefix match | unclear | ❌ | ✅ |
| CJK | via jieba | ❌ | via custom tokenize |
| TypeScript | has | has | native |
| Maintenance | niche | active | active |
| Scoring | token match | edit distance | TF-IDF (BM25-like) |

MiniSearch = LumoSearch + Fuse.js capabilities, one library.

## Tokenizer

### Why not an off-the-shelf library

Code search requires a specific combination that no single open-source tokenizer handles:

1. **CamelCase splitting**: `getUser` → `["get", "user"]`
2. **snake_case splitting**: `get_user` → `["get", "user"]`
3. **Dot/slash splitting**: `spring.datasource` → `["spring", "datasource"]`
4. **Number extraction**: `v2` → `["v2", "2"]`
5. **CJK segmentation**: `中文注释` → `["中", "文", "注释"]`

Libraries like `natural` and `wink-tokenizer` are designed for natural language, not code. They don't handle CamelCase/snake_case. `Intl.Segmenter` handles CJK but with lower precision than jieba.

### Implementation

Keep the existing `tokenize()` function (already well-tested, ~40 lines) and integrate it with MiniSearch via the `tokenize` option:

```typescript
import jieba from "@node-rs/jieba"

function codeTokenize(text: string): string[] {
  const tokens: string[] = []
  // CamelCase + snake_case + separator splitting
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

  // Number extraction
  const numbers = text.match(/\d+/g)
  if (numbers) {
    for (const num of numbers) {
      if (num.length >= 2) tokens.push(num)
    }
  }

  // CJK segmentation (jieba)
  const cjk = text.match(/[一-鿿]+/g)
  if (cjk) {
    for (const segment of cjk) {
      try {
        const words = jieba.cut(segment, true)
        for (const word of words) {
          if (word.length > 0) tokens.push(word)
        }
      } catch {
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

This function is used as MiniSearch's `tokenize` option — both at index time and search time.

## Data Sources

### Index configuration

Three independent MiniSearch instances:

```typescript
// KG + Domain + Business
const kgIndex = new MiniSearch({
  fields: ["name", "summary", "tags", "type"],
  storeFields: ["name", "type", "service", "filePath", "lineRange", "summary", "tags", "layer"],
  tokenize: codeTokenize,
})

// Wiki
const wikiIndex = new MiniSearch({
  fields: ["name", "summary", "content"],
  storeFields: ["name", "type", "service", "summary"],
  tokenize: codeTokenize,
})

// Structure
const structureIndex = new MiniSearch({
  fields: ["name", "annotations", "paramTypes", "returnType", "content"],
  storeFields: ["name", "type", "service", "filePath", "lineRange", "annotations", "paramTypes", "returnType", "sectionKey"],
  tokenize: codeTokenize,
})
```

### Document format

**KG document:**
```typescript
{
  id: node.id,
  name: node.name,
  summary: node.summary,
  tags: (node.tags ?? []).join(" "),
  type: node.type,
  service: serviceName,
  filePath: node.filePath,
  lineRange: node.lineRange,
  layer: "kg",
}
```

**Wiki document:**
```typescript
{
  id: entry.id,
  name: entry.name,
  summary: entry.summary,
  content: entry.content,
  type: entry.type,
  service: entry.service ?? serviceName,
}
```

**Structure document:**
```typescript
{
  id: `${service}::${filePath}::${name}`,
  name: "getUser",
  annotations: ["@Controller", "@RequestMapping"].join(" "),
  paramTypes: ["Long", "String"].join(" "),
  returnType: "User",
  content: "UserService getUser returns User",
  type: "function",
  service: "user-service",
  filePath: "src/main/java/.../UserService.java",
  lineRange: [42, 55],
}
```

## API Design

### `/api/search` — Enhanced

```
GET /api/search?q=<fuzzy>&scope=kg|wiki|domain|business|all&service=<name>&type=<type>&tag=<tag>&limit=<n>
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `q` | string | Fuzzy search query (MiniSearch fuzzy + prefix) |
| `scope` | string | Filter by data source (existing, unchanged) |
| `type` | string | **NEW**: Filter by entity type: class, function, service, endpoint |
| `tag` | string | **NEW**: Filter by tag value |
| `service` | string | Filter by service name (existing, unchanged) |
| `fusion` | string | RRF fusion mode (existing, unchanged) |
| `limit` | number | Max results (default 20, max 200) |
| `offset` | number | **NEW**: Pagination offset (default 0) |

Changes from current:
- Add `type` and `tag` filter parameters
- Add `offset` for pagination
- Replace LumoSearch with MiniSearch
- Add faceted stats to response

### `/api/structure/search` — Enhanced

```
GET /api/structure/search?service=<name>&q=<fuzzy>&annotation=<name>&paramType=<type>&returnType=<type>&interface=<name>&propertyType=<type>&symbol=<name>&pathPattern=<pattern>&sectionKey=<key>&sectionValue=<value>&limit=<n>
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `q` | string | **NEW**: Fuzzy search query (MiniSearch fuzzy + prefix) |
| `service` | string | Filter by service name (existing, required) |
| `annotation` | string | Filter by annotation (existing) |
| `paramType` | string | Filter by param type (existing) |
| `returnType` | string | Filter by return type (existing) |
| `interface` | string | Filter by interface (existing) |
| `propertyType` | string | Filter by property type (existing) |
| `symbol` | string | Filter by symbol name (existing) |
| `pathPattern` | string | Filter by file path pattern (existing) |
| `sectionKey` | string | **NEW**: Filter by config section key |
| `sectionValue` | string | **NEW**: Filter by config section value |
| `resolveTypes` | boolean | Resolve type references (existing, default true) |
| `limit` | number | Max results (default 50, max 500) |
| `offset` | number | **NEW**: Pagination offset (default 0) |

Changes from current:
- Add `q` parameter for fuzzy search
- Add `sectionKey` and `sectionValue` for config search
- Add `offset` for pagination
- Replace hand-written filtering with MiniSearch filter

### Response format (both APIs)

```json
{
  "results": [
    {
      "id": "node::UserService",
      "source": "kg",
      "name": "UserService",
      "type": "class",
      "service": "user-service",
      "summary": "Handles user CRUD operations",
      "tags": "user service",
      "score": 0.87
    }
  ],
  "total": 42,
  "limit": 20,
  "offset": 0,
  "hasMore": true,
  "query": { "q": "auth", "scope": null },
  "facets": {
    "type": { "function": 20, "class": 12, "endpoint": 10 },
    "service": { "user-service": 15, "auth-service": 12, "order-service": 8 }
  }
}
```

Key fields:
- `id`: Always present. Agent uses it to call detail endpoints (`/api/graph/node?id=X`, `/api/wiki/entry?id=X`)
- `offset`/`limit`/`hasMore`: Pagination support. To get next page: `offset += limit`
- `facets`: Optional — only included when there are multiple distinct values

### Pagination

Both APIs support `offset` + `limit` pagination:

```
# First page
GET /api/search?q=auth&limit=20&offset=0

# Second page
GET /api/search?q=auth&limit=20&offset=20
```

Agent iterates until `hasMore: false`.

### Error handling

| Scenario | Response |
|----------|----------|
| Invalid `scope` value | `400 { "error": "invalid scope value" }` |
| Invalid `limit` (< 1 or > max) | `400 { "error": "limit must be between 1 and 200" }` |
| Invalid `offset` (< 0) | `400 { "error": "offset must be >= 0" }` |
| Missing `q` + no filters on `/api/structure/search` | `400 { "error": "At least one search filter required" }` (existing) |
| Unknown parameters | Ignored (no error) |

### sectionKey/sectionValue data source

`sectionKey` and `sectionValue` filter by configuration properties (e.g., `spring.datasource.url`).

Data source: `.properties` files parsed by `@MomoConfig` annotation support (see `packages/core/src/parsers/`). The parser extracts key-value pairs from Spring/Java `.properties` files into the structural analysis output. If the parser hasn't been run for a service, section filters return empty results.

### Score behavior within `/api/search`

`/api/search` queries both `kgIndex` and `wikiIndex`. Scores are **not normalized across indices** — MiniSearch's TF-IDF scoring is per-index. Results are merged by score descending, but a KG result with score 0.87 and a Wiki result with score 0.85 are not directly comparable.

This is acceptable because:
- Agent uses `source` field to determine which detail endpoint to call
- Faceted stats show distribution, helping agent decide which source to focus on
- If agent needs only one source, use `scope` parameter to filter

## Internal Architecture

### Search flow

```
Query arrives
  │
  ├── /api/search
  │     ├── q provided? → kgIndex.search(q, { filter, boost })
  │     │                 + wikiIndex.search(q, { filter, boost })
  │     │                 → merge + sort
  │     ├── fusion=rrf? → kgGraphExpansion() + rrfFuse()
  │     └── no q? → filter only (scope/type/tag/service)
  │
  └── /api/structure/search
        ├── q provided? → structureIndex.search(q, { filter, boost })
        ├── filters? → MiniSearch filter
        └── no q + no filter? → 400 error (existing behavior)
```

### Filter construction

MiniSearch's `filter` option replaces the existing predicate mechanism:

```typescript
// /api/search filter
const filter = (doc) => {
  if (scope !== "all" && doc.layer !== scope) return false
  if (type && doc.type !== type) return false
  if (tag && !(doc.tags ?? "").includes(tag)) return false
  if (service && doc.service !== service) return false
  return true
}

// /api/structure/search filter
const filter = (doc) => {
  if (annotation && !(doc.annotations ?? "").includes(annotation)) return false
  if (paramType && !(doc.paramTypes ?? "").includes(paramType)) return false
  if (returnType && doc.returnType !== returnType) return false
  // ... other filters
  return true
}
```

### Search options

```typescript
// /api/search
kgIndex.search(query, {
  filter,
  boost: { name: 3, tags: 2.5, summary: 2, type: 0.5 },
  prefix: true,
  fuzzy: 0.2,
})

// /api/structure/search
structureIndex.search(query, {
  filter,
  boost: { name: 3, annotations: 2.5, paramTypes: 2, returnType: 1.5, content: 1 },
  prefix: true,
  fuzzy: 0.2,
})
```

### Graph expansion + RRF (unchanged)

`kgGraphExpansion()` and `rrfFuse()` logic stays as-is. These are independent of the search engine — they operate on search results, not on the index. MiniSearch only replaces the text search part.

### Faceted stats

Simple aggregation on search results:

```typescript
function computeFacets(results) {
  const facets = {}
  for (const r of results) {
    for (const key of ["type", "service", "layer"]) {
      const val = r[key]
      if (!val) continue
      facets[key] ??= {}
      facets[key][val] = (facets[key][val] ?? 0) + 1
    }
  }
  return facets
}
```

### Index caching

Replace `searchIndexCache` (Map<string, SearchIndexState>) with MiniSearch instances. Cache invalidation via mtime check.

**KG/Wiki index**: Uses existing mtime mechanism — `collectIndexMtimes()` tracks `knowledge-graph.json`, `wiki/index.json`, `domain-graph.json` per service.

**Structure index**: Tracks `structural-analysis.json` mtime per service. On change, rebuild the MiniSearch instance for that service.

```typescript
const indexCache = new Map<string, { index: MiniSearch; mtimes: Record<string, number> }>()

function getOrBuildKgIndex(projectRoot, serviceFilter) {
  const mtimes = collectIndexMtimes(projectRoot, serviceFilter)
  const cached = indexCache.get(cacheKey)
  if (cached && mtimesEqual(cached.mtimes, mtimes)) return cached.index

  const docs = collectKgDocuments(projectRoot, serviceFilter)
  const index = new MiniSearch({ ... })
  index.addDocuments(docs)
  indexCache.set(cacheKey, { index, mtimes })
  return index
}

function getOrBuildStructureIndex(projectRoot, serviceFilter) {
  const mtimes = collectStructureMtimes(projectRoot, serviceFilter)
  const cached = structureIndexCache.get(cacheKey)
  if (cached && mtimesEqual(cached.mtimes, mtimes)) return cached.index

  const docs = collectStructureDocuments(projectRoot, serviceFilter)
  const index = new MiniSearch({ ... })
  index.addDocuments(docs)
  structureIndexCache.set(cacheKey, { index, mtimes })
  return index
}
```

**Concurrency**: MiniSearch runs in-process, so no concurrent build issues. If two requests arrive while the index is stale, the first builds it and the second reads from cache (synchronous Node.js event loop).

## What changes

### Modified files

| File | Change |
|------|--------|
| `dashboard/src/api/handlers/search.ts` | Replace LumoSearch with MiniSearch, add type/tag/offset params, add id field, add facets |
| `dashboard/src/api/handlers/structure.ts` | Add q/sectionKey/sectionValue/offset params, add id field, add facets, use MiniSearch for search |
| `core/src/search.ts` | Replace Fuse.js with MiniSearch |
| `dashboard/package.json` | Add `minisearch` dep, remove `@lumosearch/search` |
| `dashboard/package.json` | Remove `fuse.js` dep (if not used elsewhere) |

### Unchanged files

| File | Reason |
|------|--------|
| `dashboard/src/api/handlers/rrf-fuse.ts` | RRF is independent of search engine |
| `dashboard/src/api/handlers/search-vector.ts` | Vector search is independent |
| `dashboard/src/api/handlers/structure.ts` (chain/implementors/symbol-source) | Non-search endpoints unchanged |

## Implementation steps

### Phase 1: Structure search (new code, zero migration risk)

1. Install `minisearch` dependency
2. Create `structure-index.ts` — MiniSearch index for Structure data
3. Add `q` parameter to `/api/structure/search` handler
4. Add `sectionKey`/`sectionValue` filters
5. Add `offset` pagination parameter
6. Add `id` field to all results
7. Add faceted stats to response
8. Add tests for fuzzy + precise combinations
9. **Benchmark**: 10K docs < 10ms, verify CJK query accuracy

### Phase 2: KG/Wiki search (migrate LumoSearch)

10. Create `kg-index.ts` — MiniSearch index for KG + Domain + Business
11. Create `wiki-index.ts` — MiniSearch index for Wiki
12. Modify `search.ts` — replace LumoSearch with MiniSearch indices
13. Add `type`/`tag` filter parameters
14. Add `offset` pagination parameter
15. Add `id` field to all results
16. Add faceted stats to response
17. Preserve graph expansion + RRF logic
18. Preserve CJK handling (jieba integration)
19. Run existing tests, verify search quality
20. **Benchmark**: Compare top-10 results with LumoSearch baseline, tune boost weights

### Phase 3: Core search (migrate Fuse.js)

21. Modify `core/src/search.ts` — replace Fuse.js with MiniSearch
22. Preserve SearchEngine API (search method signature unchanged)
23. Run core tests

### Phase 4: Cleanup

24. Remove `@lumosearch/search` dependency
25. Remove `fuse.js` dependency (if not used elsewhere)
26. Remove dead code (LumoSearch index building, Fuse.js initialization)

## Testing

**Target: 100% coverage** for all new and modified search code.

### Unit tests — `codeTokenize()`

| Input | Expected tokens | Covers |
|-------|----------------|--------|
| `getUser` | `["get", "user"]` | CamelCase splitting |
| `get_user` | `["get", "user"]` | snake_case splitting |
| `GetUser` | `["get", "user"]` | PascalCase splitting |
| `GET_USER` | `["get", "user"]` | UPPER_SNAKE splitting |
| `get-user` | `["get", "user"]` | kebab-case splitting |
| `spring.datasource.url` | `["spring", "datasource", "url"]` | dot splitting |
| `src/main/java` | `["src", "main", "java"]` | slash splitting |
| `v2` | `["v2"]` | number extraction |
| `HTTPResponse` | `["http", "response"]` | consecutive uppercase |
| `用户认证` | `["用户", "认证"]` | CJK jieba segmentation |
| `UserService 用户服务` | `["user", "service", "用户", "服务"]` | mixed Chinese + English |
| `a` | `[]` | short token filtering (< 2 chars) |
| `""` | `[]` | empty input |
| `123` | `["123"]` | pure numbers |

### Unit tests — Structure index

| Test case | Query | Filters | Expected behavior |
|-----------|-------|---------|-------------------|
| Fuzzy by name | `q=getUser` | — | returns `getUser`, `getUserName` |
| Fuzzy by annotation | `q=Controller` | — | returns classes/functions with `@Controller` |
| Precise by annotation | — | `annotation=@Service` | returns only `@Service` entities |
| Precise by paramType | — | `paramType=UserRepository` | returns functions with that param type |
| Precise by returnType | — | `returnType=User` | returns functions returning `User` |
| Precise by interface | — | `interface=CrudRepository` | returns implementing classes |
| Precise by propertyType | — | `propertyType=String` | returns classes with typed property |
| Precise by sectionKey | — | `sectionKey=spring.datasource.url` | returns matching config entries |
| Precise by sectionValue | — | `sectionValue=prod-db` | returns config entries containing value |
| Fuzzy + precise | `q=user` | `annotation=@Controller` | fuzzy on filtered subset |
| No q + no filter | — | — | returns 400 error (existing) |
| Pagination page 1 | `q=user` | `limit=2&offset=0` | returns first 2 results |
| Pagination page 2 | `q=user` | `limit=2&offset=2` | returns next 2 results |
| Pagination past end | `q=user` | `limit=2&offset=100` | returns empty results, `hasMore: false` |
| Facets present | `q=user` | — | response includes `facets` with type/service distribution |
| Result has id | `q=getUser` | — | every result has `id` field |
| CJK query | `q=用户` | — | returns entities with Chinese content |
| Cross-style match | `q=get_user` | — | matches `getUser` in results |

### Unit tests — KG/Wiki index

| Test case | Query | Filters | Expected behavior |
|-----------|-------|---------|-------------------|
| Fuzzy by name | `q=UserService` | — | returns matching KG nodes |
| Fuzzy by summary | `q=authentication` | — | returns nodes with matching summary |
| Scope filter | `q=user` | `scope=kg` | returns only KG results |
| Type filter | `q=user` | `type=class` | returns only class entities |
| Tag filter | `q=user` | `tag=auth` | returns entities with matching tag |
| Service filter | `q=user` | `service=user-service` | returns only that service's results |
| Fuzzy + scope + type | `q=user` | `scope=kg&type=class` | combined filtering |
| Pagination | `q=user` | `limit=5&offset=0` | returns 5 results max |
| Facets present | `q=user` | — | response includes facets |
| Result has id | `q=user` | — | every result has `id` field |
| CJK query | `q=用户` | — | returns nodes with Chinese content |
| RRF fusion | `q=UserService` | `fusion=rrf` | returns graph-expanded results |

### Unit tests — Edge cases

| Test case | Expected behavior |
|-----------|-------------------|
| Empty index (no data) | returns `{ results: [], total: 0 }` |
| Very long query (1000+ chars) | handles gracefully, no crash |
| Special characters in query | no crash, returns results if any match |
| Concurrent index build | second request reads from cache |
| Index mtime changed | rebuilds index on next request |
| Invalid scope value | returns 400 error |
| Invalid limit (< 1 or > max) | returns 400 error |
| Invalid offset (< 0) | returns 400 error |

### Integration tests — API handler

| Test case | Endpoint | Verification |
|-----------|----------|-------------|
| Full search flow | `/api/search?q=auth` | returns 200 with results + facets |
| Full structure search flow | `/api/structure/search?service=x&q=getUser` | returns 200 with results + facets |
| Pagination flow | `/api/search?q=user&limit=2&offset=0` then `offset=2` | no duplicate results across pages |
| Filter + fuzzy combo | `/api/structure/search?q=user&annotation=@Controller` | filtered fuzzy results |
| Backward compat: existing params | `/api/search?q=auth&scope=kg&service=x` | existing behavior preserved |
| Backward compat: structure params | `/api/structure/search?service=x&annotation=@Controller` | existing behavior preserved |

### Coverage requirements

| Module | Target |
|--------|--------|
| `structure-index.ts` | 100% line, 100% branch |
| `kg-index.ts` | 100% line, 100% branch |
| `wiki-index.ts` | 100% line, 100% branch |
| `codeTokenize()` | 100% line, 100% branch |
| `computeFacets()` | 100% line, 100% branch |
| `search.ts` handler changes | 100% line, 100% branch |
| `structure.ts` handler changes | 100% line, 100% branch |
| `core/src/search.ts` changes | 100% line, 100% branch |

Run `pnpm test -- --coverage` to verify. Fail CI if any module drops below 100%.

## Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Search quality regression | Different scoring model | Compare top-10 results before/after, tune boost weights |
| CJK search quality | MiniSearch + jieba integration | Test with Chinese queries, compare with LumoSearch results |
| Performance regression | MiniSearch slower than LumoSearch | Benchmark at 10K/50K doc scale, optimize if needed |
| Breaking existing callers | API response format changes | Additive changes only — new fields (id, facets, offset), no removals |
| Index size at scale | MiniSearch memory usage | Benchmark with large graphs |
| Cross-index score incomparability | KG + Wiki scores not normalized | Use `scope` to filter to single source when precision matters |
| sectionKey data availability | .properties parser may not be run | Return empty results gracefully, document prerequisite |

## Benchmarks needed

| Scenario | Metric | Target |
|----------|--------|--------|
| 10K docs, single query | Latency | < 10ms |
| 50K docs, single query | Latency | < 50ms |
| 10K docs, index build | Time | < 500ms |
| CJK query accuracy | Top-5 relevance | >= LumoSearch baseline |
| English query accuracy | Top-5 relevance | >= LumoSearch baseline |
