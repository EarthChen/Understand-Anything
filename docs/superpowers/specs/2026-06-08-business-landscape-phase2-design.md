# Business Landscape — Phase 2: Core Capabilities

> Date: 2026-06-08
> Status: DRAFT
> PRD: `.claude/prds/cross-facet-domain-map.prd.md` (Milestones M1, M2)
> Spec Series: 2 of 3 (Phase 1: Foundation → **Phase 2: Core Capabilities** → Phase 3: Consumption Layer)
> Depends On: Phase 1 spec (`2026-06-08-business-landscape-phase1-design.md`)

## Background

Phase 1 (Spec 1) established the foundational infrastructure: three-state checkpoint model, cascading config reader, system.json extension, and skill engineering alignment. With those foundations in place, Phase 2 builds the core capabilities:

1. **M1: wiki mobile adaptation** — Extend `/understand-wiki` to handle mobile repositories (Android/iOS), producing wiki documentation and `client-graph.json`.
2. **M2: business-landscape skill** — New `/understand-business` skill that reads server + client wiki, performs cross-facet domain matching, and produces a unified business-landscape.

## Milestone Dependency Graph

```
Phase 1 (M-1, M0, M0.5) ──→ M1 ──→ M2
```

- M1 depends on Phase 1 completion (uses checkpoint infrastructure, config reader, system.json facets)
- M2 depends on M1 completion (needs client wiki + client-graph.json as input)
- M1 and M2 are strictly sequential — M1 must fully complete before M2 begins

## Confirmed Design Decisions

| # | Decision | Outcome | Rationale |
|---|----------|---------|-----------|
| 1 | Execution order | M1 fully complete, then M2 | M2's cross-facet matching needs M1's client wiki output |
| 2 | KG API call extraction | New `consumes_api` edge type (modify /understand) | Most accurate approach vs LLM inference at wiki layer |
| 3 | API edge metadata | `{ method: string, path: string }` | Balances precision (HTTP method+path) vs complexity (no framework/params) |
| 4 | Cross-platform framework detection | Deferred — basic mobile wiki first | Flutter/KMM integration patterns can iterate later |
| 5 | business-landscape output | All 4 file types (meta + domains + cross-facet-links + domain-detail) | All are necessary for incremental updates, CLI, and Dashboard |
| 6 | Interaction document complexity | Full DAG structure (branches/parallel/terminal) | User explicitly requested no simplification |

---

## Design

### M1: Wiki Mobile Adaptation

#### Task Block 1: KG Schema Extension — `consumes_api` Edge Type

**Problem:** The current KG has no way to distinguish a local function call from an HTTP API call to a remote server. Mobile repositories make extensive API calls (Retrofit, URLSession, etc.) that need to be explicitly tagged for cross-facet domain matching in M2.

**Solution:** Add a new edge type `consumes_api` to the KG schema.

**Edge semantics:** `source → target` where:
- `source`: the function/class node that makes the API call (e.g., `function:OrderRepository.kt:createOrder`)
- `target`: the endpoint node representing the API URL (e.g., `endpoint:OrderRepository.kt:POST /api/orders`)

**Metadata:** Each `consumes_api` edge carries metadata:
```typescript
interface ApiCallMeta {
  method: string;  // "GET" | "POST" | "PUT" | "DELETE" | "PATCH"
  path: string;    // "/api/orders" or "/api/orders/{id}"
}
```

**Files to modify:**

| File | Change |
|------|--------|
| `packages/core/src/types.ts` | Add `"consumes_api"` to `EdgeType` union; add `ApiCallMeta` interface |
| `packages/core/src/schema.ts` | Add `consumes_api` to edge type validation allowlist |
| `packages/core/src/types.test.ts` | Add `consumes_api` type test |
| `packages/core/src/__tests__/schema.test.ts` | Add `consumes_api` edge validation test |
| `skills/understand/SKILL.md` | Add `consumes_api` to Edge Types table (weight: 0.7); add to Behavioral category |
| `skills/understand/merge-batch-graphs.py` | Edge dedup logic supports `consumes_api` with metadata merge |

**Edge weight:** 0.7 (same as `imports` — significant cross-boundary relationship)

**Backward compatibility:** Existing KGs without `consumes_api` edges remain valid. The edge type is additive.

#### Task Block 2: Mobile Language Snippet Enhancement

**Problem:** Current language snippets for Kotlin/Swift/ObjC mention mobile frameworks (Jetpack Compose, SwiftUI, UIKit) but don't instruct the LLM to identify and tag API calls as `consumes_api` edges with method/path metadata.

**Solution:** Add API call identification guidance to mobile language snippets.

**Files to modify:**

| File | Added Content |
|------|---------------|
| `skills/understand/languages/kotlin.md` | Retrofit `@GET`/`@POST`/`@PUT`/`@DELETE` annotations; OkHttp `Request.Builder().url().method()` patterns; instruction to emit `consumes_api` edges with `{ method, path }` metadata |
| `skills/understand/languages/swift.md` | `URLSession.shared.dataTask(with: URL)` patterns; Alamofire `AF.request()` patterns; instruction to emit `consumes_api` edges |
| `skills/understand/languages/objc.md` | `NSURLSession` / AFNetworking patterns; instruction to emit `consumes_api` edges |

**Pattern recognition guidance (example for Kotlin):**

```markdown
## API Call Detection

When analyzing mobile code, identify HTTP API calls and create `consumes_api` edges:

- **Retrofit interfaces**: `@GET("/api/orders")`, `@POST("/api/orders")` → edge from calling function to endpoint, metadata: `{ method: "GET", path: "/api/orders" }`
- **OkHttp direct calls**: `Request.Builder().url("...").get()` → extract URL and method
- **Dynamic URL construction**: If URL is built from variables, extract the static path template where possible; use `{param}` placeholders for path parameters

Create an `endpoint` node for each unique API path, and a `consumes_api` edge from the calling function/class to the endpoint.
```

#### Task Block 3: /understand SKILL.md Update

**Changes:**
- Add `consumes_api` to the Edge Types table under "Behavioral" category
- Add edge weight convention: `consumes_api` → 0.7
- Update the total edge count (26 → 27 in SKILL.md; types.ts already has 38 total)
- Note: The edge type count in SKILL.md (26) differs from types.ts (38) because SKILL.md only documents the core `/understand` edge types, not domain/knowledge edge types

#### Task Block 4: /understand-wiki M1 Extension

This is the core M1 work. Changes span multiple wiki phase documents.

##### 4a. Phase 0 — `--repo-type` Parameter

**New parameter:** `--repo-type=backend|mobile|frontend` (default: `backend`)

**Detection logic addition to Phase 0:**
```
1. Parse --repo-type from $ARGUMENTS (default: backend)
2. If repo-type=mobile:
   a. Read system.json to find server facet path
   b. Check if server wiki exists: test -f "$SERVER_PATH/.understand-anything/wiki/meta.json"
   c. If exists → set SERVER_WIKI_AVAILABLE=true, load server domain→endpoint mapping
   d. If not → set SERVER_WIKI_AVAILABLE=false, log warning about degraded domain classification
3. Store REPO_TYPE and SERVER_WIKI_AVAILABLE in phase context
```

**Files:** `skills/understand-wiki/SKILL.md` (Options section), `docs/wiki-phase0-prerequisites.md`

##### 4b. Phase 1 — wiki-worker Mobile Prompt

**wiki-worker prompt branching by repo-type:**

| Aspect | backend (existing) | mobile (new) |
|--------|-------------------|--------------|
| Primary content focus | endpoint, RPC, DB, concurrency | screen, navigation, API call, state management, offline strategy |
| Domain classification source | endpoint/service structure | API call → server endpoint → server domain (with server wiki); code structure naming (without) |
| Entity examples | OrderService, PaymentGateway | OrderScreen, OrderViewModel, OrderRepository |
| Flow examples | POST /api/orders → validate → persist → publish event | User taps "Place Order" → ViewModel calls API → handle response → navigate |

**Domain classification logic (new for mobile):**

```
IF SERVER_WIKI_AVAILABLE:
  1. Read server wiki domains/*.json, build endpoint→domain mapping
  2. For each client wiki domain candidate:
     - Extract consumes_api edges from KG
     - Match API paths to server endpoints
     - Classify client domain = server domain that owns the matched endpoints
  3. Unmatched → classify from code structure/naming (degraded)
ELSE:
  1. Classify all domains from code structure/naming (degraded mode)
  2. Mark meta.json.sourceHashes["server/system-graph"] = null
  3. Next run with server wiki available → detect sourceHash change → re-classify only (cheap)
```

**Files:** `agents/wiki-worker.md`, `docs/wiki-phase1-generation.md`

##### 4c. Phase 3 — Mobile Mode: client-graph.json

**New script:** `skills/understand-wiki/build-client-graph.py`

Symmetric to `build-system-graph.py` but for mobile facets:

```
Input:
  - system.json facets[type=mobile].subPaths → platform list (e.g., android/, ios/, flutter/)
  - Each platform's wiki/domains/*.json

Output: client-graph.json
  {
    "platforms": ["android", "ios"],
    "crossPlatformFrameworks": ["flutter"],
    "featureMap": [
      {
        "domain": "订单管理",
        "implType": "cross-platform" | "platform-specific" | "mixed",
        "implementations": { ... }
      }
    ]
  }

Classification logic (deterministic only — no LLM in MVP):
  1. Domain name identical across platforms + one references cross-platform framework module → "cross-platform"
  2. Domain name identical across platforms + all native → "platform-specific"
  3. Same domain has both cross-platform refs and native code → "mixed"
  4. Domain name differs across platforms → skip (defer to future LLM matching)
```

**Phase 3 trigger in SKILL.md:**
```
IF REPO_TYPE == "mobile" AND integrated_platforms >= 2:
  python3 "$SKILL_DIR/build-client-graph.py" "$PROJECT_ROOT"
ELIF REPO_TYPE == "backend":
  python3 "$SKILL_DIR/build-system-graph.py" "$PROJECT_ROOT"  (existing)
```

**Files:** New `build-client-graph.py`, modified `docs/wiki-phase3-crossservice.md`

#### Task Block 5: Regression Testing

| Test | Scope | Method |
|------|-------|--------|
| Backend non-regression | Existing backend repos still produce identical wiki output | Run modified /understand-wiki on backend repo, diff output with baseline |
| Schema validation | `consumes_api` edges pass validate-graph.mjs | Unit test in schema.test.ts |
| Mobile wiki verification | Benchmark Android/iOS repo produces valid wiki | Run on benchmark repo, verify assemble-wiki.py passes |
| client-graph.json validation | Output matches expected schema | Unit test for build-client-graph.py |

---

### M2: /understand-business Skill

#### Task Block 1: SKILL.md

New skill file at `skills/understand-business/SKILL.md` with:
- Name, description, argument-hint
- Options: `--full`, `--cascade`, `--cascade=deep`, `--dry-run`, `--budget <tokens>`, `--language <lang>`
- 5-phase execution flow with progress reporting format
- Error handling strategy (degrade, don't block)
- Dependency on Spec 1 infrastructure (checkpoint-writer, resume-utils, config-reader)

#### Task Block 2: Phase 0 — Configuration & Input Detection

**Script:** `check_facets.py`

```
Input: project root path
Process:
  1. Read system.json → parse facets[]
  2. For each facet:
     - Check aggregation graph exists:
       - backend → system-graph.json
       - mobile → client-graph.json
     - Check wiki exists: wiki/meta.json
  3. If --cascade and missing → dispatch corresponding skill
  4. If not --cascade and missing → log warning, mark as degraded
Output: facet-status.json
  {
    "facets": [
      { "id": "server", "type": "backend", "status": "available|missing|degraded", "graphPath": "..." },
      { "id": "client", "type": "mobile", "status": "available|missing|degraded", "graphPath": "..." }
    ]
  }
```

#### Task Block 3: Phase 1 — Deterministic Domain Matching

**Script:** `domain_matcher.py`

Three-layer matching (all deterministic, no LLM):

```
Layer 1 — API endpoint exact match:
  - Read server wiki domains → build endpoint→domain mapping
  - Read client wiki domains → extract consumes_api edges (API paths)
  - Match: client API call path == server endpoint path → auto-accept
  - Supports 1:N matching (one client domain calling multiple server APIs)

Layer 1 — Domain name exact match:
  - Normalize: lowercase, replace hyphens/underscores with single canonical form
  - Match: server domain name == client domain name → auto-accept

Layer 1 — Manual mapping:
  - Read domain-mapping.json (if exists)
  - Entries in mappings[] → auto-accept

Unmatched pairs → candidates[] for Phase 2 LLM verification
```

**Output:** `intermediate/phase1-matches.json`
```json
{
  "matched": [
    { "canonical": "order-management", "server": ["order-management"], "client": ["下单流程"], "matchType": "auto-api", "confidence": 1.0 }
  ],
  "candidates": [
    { "server": "user-management", "client": "个人中心", "reason": "name mismatch, no shared API endpoints" }
  ]
}
```

#### Task Block 4: Phase 2 — LLM Domain Match Verification

**Execution by agent (SKILL.md prompt):**

For each candidate pair:
1. Provide LLM with: domain name, summary, endpoint lists, code keywords from both sides
2. LLM outputs: `{ "match": true/false, "confidence": 0.0-1.0, "reason": "..." }`
3. Schema validation on LLM output
4. Write checkpoint: `intermediate/match-{server}-{client}.json`
5. confidence ≥ 0.7 → auto-matched[]; < 0.7 → unmapped[]

**Checkpoint:** Each candidate pair has independent checkpoint via `checkpoint-writer.mjs`.
**Resume:** On re-run, `resume-utils.mjs` skips completed pairs.

#### Task Block 5: Phase 3 — Output Assembly & Index Generation

**Script:** `assemble_landscape.py`

```
Input:
  - intermediate/phase1-matches.json (deterministic matches)
  - intermediate/match-*.json (LLM verified matches)
  - facet-status.json

Process:
  1. Merge matched[] + auto-matched[] → BusinessDomain list
  2. Generate domains.json (index + stats: totalDomains, mappedDomains, unmappedDomains, coverageRate)
  3. Generate cross-facet-links.json (server endpoints ↔ client API calls, with matchDetails)
  4. Update domain-mapping.json (new matches → mappings[], unmatched → unmapped[])

Output:
  - intermediate/domains.json
  - intermediate/cross-facet-links.json
  - domain-mapping.json (at project root .understand-anything/)
```

#### Task Block 6: Phase 4 — Cross-Facet Interaction Document Generation

**Per-domain, each with independent checkpoint.**

For each BusinessDomain:

1. **Deterministic extraction:** Read each facet's wiki flows for this domain → extract step skeleton
2. **LLM generation:** Given the step skeletons from all facets, generate:
   - `interactions[]` — Full DAG structure with:
     - `steps[].id` — unique step identifier
     - `steps[].facet` — which facet (server/client/frontend/test)
     - `steps[].description` — what happens at this step
     - `steps[].after[]` — DAG dependencies (not linear order)
     - `steps[].branches[]` — conditional branches `{ condition, next[], relatedRules[] }`
     - `steps[].parallel[]` — concurrent steps
     - `steps[].terminal` — flow termination point
     - `steps[].relatedRules[]` — related business rule IDs
   - `businessRules[]` — Cross-facet constraints with `enforcedBy`, `observedBy`, `relatedFlows`
   - `facets` — Links to original facet wiki/domain-graph data
3. **Schema validation:** `validate_domain.py` checks structure completeness
4. **Retry on failure:** Re-prompt LLM with validation errors (max 2 retries)
5. **Degrade on persistent failure:** Mark `_checkpoint.status = "degraded"`

**Output:** `intermediate/domain-{id}.json` → after Phase 5 validation → `business-landscape/domains/{id}.json`

**Validation script (`validate_domain.py`) checks:**
- `id` field exists and matches `domain:*` pattern
- `name` and `summary` are non-empty strings
- `interactions[]` array exists, each interaction has `id`, `name`, `steps[]`
- Each step has `id`, `facet`, `description`; `after[]` references valid step IDs
- `branches[].next[]` references valid step IDs within same interaction
- `parallel[]` references valid step IDs within same interaction
- At least one step has `terminal: true` per interaction
- `businessRules[]` entries have `id`, `rule`, `enforcedBy[]`
- `facets` object has at least one facet entry with valid `domainRef` path

#### Task Block 7: Phase 5 — Validation & Final Output

**Script:** `validate_landscape.py`

```
Full schema validation:
  1. domains.json — required fields, stats consistency, detailRef paths exist
  2. cross-facet-links.json — links[].domain references valid domain, endpoint arrays non-empty
  3. domains/*.json — each file passes validate_domain.py
  4. Reference integrity: all facetRef paths exist on disk, all domainId values match domains.json

Write meta.json:
  {
    "contentHash": "sha256:<hash of all output files>",
    "sourceHashes": {
      "server/system-graph": "sha256:<hash>",
      "client/client-graph": "sha256:<hash>"
    },
    "generatedAt": "<ISO 8601>",
    "version": "1.0",
    "status": "complete" | "degraded",
    "_checkpoint": { "status": "complete" }
  }

Atomic finalization:
  - Move validated intermediate files → business-landscape/ directory
  - Atomic rename for consistency
```

---

## File Change Summary

### M1 Files (~15 files)

| Action | File | Change |
|--------|------|--------|
| Modify | `packages/core/src/types.ts` | Add `"consumes_api"` to EdgeType; add `ApiCallMeta` interface |
| Modify | `packages/core/src/schema.ts` | Add `consumes_api` to validation allowlist |
| Modify | `packages/core/src/types.test.ts` | Add `consumes_api` type test |
| Modify | `packages/core/src/__tests__/schema.test.ts` | Add `consumes_api` edge validation test |
| Modify | `skills/understand/SKILL.md` | Edge Types table update (27th edge type) |
| Modify | `skills/understand/languages/kotlin.md` | Retrofit/OkHttp API call detection guidance |
| Modify | `skills/understand/languages/swift.md` | URLSession/Alamofire API call detection guidance |
| Modify | `skills/understand/languages/objc.md` | NSURLSession/AFNetworking API call detection guidance |
| Modify | `skills/understand/merge-batch-graphs.py` | Edge dedup supports `consumes_api` with metadata |
| Modify | `skills/understand-wiki/SKILL.md` | Add `--repo-type` parameter documentation |
| Modify | `skills/understand-wiki/docs/wiki-phase0-prerequisites.md` | repo-type detection + server wiki check |
| Modify | `skills/understand-wiki/docs/wiki-phase1-generation.md` | wiki-worker prompt branching by repo-type |
| Modify | `skills/understand-wiki/docs/wiki-phase3-crossservice.md` | Mobile mode: client-graph.json flow |
| Modify | `agents/wiki-worker.md` | Mobile mode prompt (screen/navigation/API call/state management) |
| Create | `skills/understand-wiki/build-client-graph.py` | Client graph builder (symmetric to build-system-graph.py) |

### M2 Files (~8 new files)

| Action | File | Change |
|--------|------|--------|
| Create | `skills/understand-business/SKILL.md` | 5-phase execution flow, options, error handling |
| Create | `skills/understand-business/check_facets.py` | Phase 0: facet availability check |
| Create | `skills/understand-business/domain_matcher.py` | Phase 1: deterministic domain matching |
| Create | `skills/understand-business/assemble_landscape.py` | Phase 3: output assembly + index generation |
| Create | `skills/understand-business/validate_domain.py` | Phase 4: per-domain interaction doc validation |
| Create | `skills/understand-business/validate_landscape.py` | Phase 5: full schema + reference integrity validation |
| Modify | `packages/core/src/types.ts` | Add BusinessDomain, CrossFacetLink, Interaction interfaces |

### Test Files (~4 new files)

| File | Coverage |
|------|----------|
| `tests/understand-business/domain_matcher.test.py` | Domain matching logic: API exact match, name match, manual mapping, candidate generation |
| `tests/understand-business/validate_domain.test.py` | Interaction document validation: DAG structure, step references, business rules |
| `tests/understand-business/validate_landscape.test.py` | Full validation: domains.json, cross-facet-links.json, reference integrity |
| Existing `packages/core/src/__tests__/schema.test.ts` | `consumes_api` edge type validation |

---

## Technical Risks & Mitigations

| Risk | Severity | Mitigation |
|------|----------|------------|
| `consumes_api` edge extraction accuracy depends on LLM | High | Language snippets provide explicit framework patterns (Retrofit @GET/@POST, URLSession); regression tests verify extraction rate |
| wiki-worker mobile prompt output quality | High | Reuse existing wiki quality gates (assemble-wiki.py + wiki_quality_gate.py); degrade rather than block on failure |
| Domain classification without server wiki has low accuracy | Medium | Progressive refinement by design — re-classifies when server wiki becomes available (cheap: re-classify only, no content regeneration) |
| M2 interaction document DAG structure is complex, LLM output unstable | High | validate_domain.py strict schema validation; retry 2 times; degrade on persistent failure, don't block other domains |
| Cross-facet matching: dynamic URL construction prevents API path extraction | Medium | config.json `apiBaseUrl` declaration; regex matching support; fallback to LLM verification layer |
| ~20 file changes, regression risk | Medium | M1 isolates code paths via repo-type flag, backend behavior unchanged; full regression test covers existing output |

## Dependencies on Phase 1 Infrastructure

Spec 2 directly reuses Phase 1 (Spec 1) implementations:

| Phase 1 Component | Used By |
|--------------------|---------|
| `resume-utils.mjs` three-state checkpoint model | M2 Phase 2 (LLM match verification), Phase 4 (interaction doc generation) |
| `checkpoint-writer.mjs` atomic writes | M2 Phase 2, Phase 4 |
| `config-reader.mjs` cascading config | M1 Phase 0 (read repo-type config), M2 Phase 0 (read facets) |
| `readSystemConfig()` system.json reader | M1 Phase 3 (read subPaths), M2 Phase 0 (read facets) |
| `init_config.py` config initialization | M2 Phase 0 (ensure config exists) |

---

*Status: DRAFT — design confirmed, implementation plan pending via writing-plans.*
