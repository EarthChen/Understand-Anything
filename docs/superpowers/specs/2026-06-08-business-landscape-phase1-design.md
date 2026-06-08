# Business Landscape — Phase 1: Foundation & Validation

> Date: 2026-06-08
> Status: DRAFT
> PRD: `.claude/prds/cross-facet-domain-map.prd.md` (Milestones M-1, M0, M0.5)
> Spec Series: 1 of 3 (Phase 1: Foundation → Phase 2: Core Capabilities → Phase 3: Consumption Layer)

## Background

The Business Landscape project aims to aggregate information across multiple codebases (server, client, frontend, test) into unified business domains. Before building the core cross-facet capabilities (Spec 2), three foundational pieces must be in place:

1. **M-1: Existing skill engineering alignment** — Current skills have inconsistent checkpoint, validation, and incremental update mechanisms. These must be unified before building new skills on top.
2. **M0: Mobile capability validation** — Confirm that `/understand` can extract API call nodes from Android/iOS code. This is a Go/No-Go gate for M1.
3. **M0.5: Configuration refactoring** — Extend `system.json` to support multi-facet declarations and introduce cascading `config.json` for pipeline behavior.

## Milestone Dependency Graph

```
M-1 ──→ M0.5
M0  ────────→ Go/No-Go (gates Spec 2)
```

- M-1 and M0 can run in parallel (no mutual dependency)
- M0.5 depends on M-1 completion (uses the unified checkpoint infrastructure)
- M0 is a validation-only milestone; its outcome determines whether Spec 2 proceeds with tree-sitter extraction or LLM fallback

## Design

### M-1: Existing Skill Engineering Alignment

#### 1. Universal Infrastructure: resume-utils.mjs Enhancement

**Current state:** `shared/resume-utils.mjs` exists but is not integrated into any skill's main script. Checkpoint logic relies on agent-level instructions rather than script-level enforcement.

**Current API:**
- `getPendingItems(allItems)` — filters items whose `outputPath` doesn't exist or is empty
- `getCompletedIds(allItems)` — returns Set of ids with existing non-empty output files
- `hasBatchOutput(projectRoot, intermediateRel, batchIndex)` — checks batch output existence
- `reportProgress(allItems)` — generates human-readable progress string

**Required changes:**

1. **JSON validity check:** Before marking an item as "complete", parse the output file as JSON. Truncated or malformed JSON → treat as incomplete.

```javascript
function isValidCheckpoint(filePath) {
  try {
    const content = readFileSync(filePath, 'utf-8');
    if (!content.trim()) return { valid: false, status: 'empty' };
    const parsed = JSON.parse(content);
    const checkpoint = parsed._checkpoint;
    if (checkpoint?.status === 'complete') return { valid: true, status: 'complete' };
    if (checkpoint?.status === 'degraded') return { valid: false, status: 'degraded' };
    if (checkpoint?.status === 'failed') return { valid: false, status: 'failed' };
    // Legacy files without _checkpoint: treat as complete (backward compat)
    return { valid: true, status: 'complete' };
  } catch {
    return { valid: false, status: 'corrupted' };
  }
}
```

2. **Three-state checkpoint model:** Replace the binary "exists/not exists" model with `complete | degraded | failed`:

| Status | Meaning | Next run behavior |
|--------|---------|-------------------|
| `complete` | Successfully processed | Skip |
| `degraded` | Partially processed (e.g., LLM validation failed) | Retry |
| `failed` | Completely failed | Retry |
| missing/corrupted | Not yet processed or corrupted | Process |

3. **Updated `getPendingItems`:** Returns items that are NOT `complete` (i.e., missing, corrupted, degraded, or failed).

4. **New `writeCheckpoint(filePath, data, status)` helper:** Writes JSON data with `_checkpoint` metadata field, ensuring atomic write (write to temp → validate → rename).

**Backward compatibility:** Files without `_checkpoint` field are treated as `complete` (preserves existing behavior for skills not yet migrated).

#### 2. `/understand-knowledge` Changes

| Change | Details |
|--------|---------|
| Add `--full` flag | Clears `intermediate/` directory before processing, forces full regeneration |
| Enhanced validation script | Add: zod schema validation (reuse `validate-graph.mjs` patterns), reference integrity check (all edge source/target nodes exist), non-empty content check (summary fields) |
| Preserve intermediate/ | Remove the post-success cleanup of `intermediate/`. Add `--clean` flag for explicit cleanup |
| Integrate resume-utils | Replace agent-level checkpoint instructions with script-level `getPendingItems()` calls |

**Validation script additions:**

```
Current: dangling refs check only
Target:  dangling refs + zod schema + content non-empty + edge type validity
```

#### 3. `/understand-onboard` Changes

**Current state:** Pure LLM generation with no deterministic preprocessing or output validation.

**Target architecture:**

```
Phase 1 (deterministic, script):
  - Read knowledge-graph.json
  - Extract: node count by type, layer hierarchy, key entry points, dependency graph stats
  - Output: structured-data.json (input for LLM)

Phase 2 (LLM):
  - Input: structured-data.json
  - Generate: onboarding document in markdown
  - Output: onboarding.md

Phase 3 (deterministic, script):
  - Validate output structure: required sections present, markdown well-formed
  - Check: ## Overview, ## Architecture, ## Key Components, ## Getting Started sections exist
```

#### 4. `/understand-diff` Changes

Add output schema validation for `diff-overlay.json`:

```
Validation checks:
  - Top-level structure: { changes: [], summary: string, risk: string }
  - Each change: { file: string, type: "added"|"modified"|"deleted", impact: string }
  - Summary and risk fields are non-empty strings
  - All referenced file paths exist in the diff input
```

#### 5. `/understand` Phase 3-6 Checkpoint

**Current state:** Phase 2 (batch processing) has batch-level checkpoint via `hasBatchOutput()`. Phases 3-6 (assemble-review, layers, tour, review) have no checkpoint — interruption after Phase 2 requires re-running Phases 3-6 including LLM calls.

**Target:** Each Phase writes its output to `intermediate/` with checkpoint metadata. On restart, completed phases are skipped.

```
intermediate/
  phase-2-batch-*.json     ← existing
  phase-3-assembled.json   ← new checkpoint
  phase-4-layers.json      ← new checkpoint
  phase-5-tour.json        ← new checkpoint
  phase-6-reviewed.json    ← new checkpoint
```

### M0: Mobile Capability Validation

#### Objective

Confirm `/understand`'s tree-sitter extractors can identify API call nodes from Android (Java/Kotlin) and iOS (Swift/ObjC) source code.

#### Method

1. Select internal benchmark Android + iOS repositories
2. Run `/understand --full` on each
3. Inspect `knowledge-graph.json` output

#### Go/No-Go Criteria

| Criterion | Threshold | Decision |
|-----------|-----------|----------|
| API call type nodes in KG | ≥ 10 (Android + iOS combined) | Go |
| API call nodes contain valid info | URL path or method name is non-empty | Go |
| tree-sitter parse coverage | ≥ 80% of source files successfully parsed | Go |
| All criteria met | — | **Go → proceed to Spec 2 with tree-sitter** |
| Any criterion failed | — | **No-Go → evaluate Plan B** |

#### Plan B: LLM Extraction Fallback

If tree-sitter cannot effectively extract API call patterns from mobile code:

**Implementation:** Add LLM fallback in `/understand`'s file-analyzer agent. Files where tree-sitter fails to extract API calls are sent to LLM for pattern recognition.

**LLM prompt strategy:**
```
Given this source file, identify all HTTP API calls.
For each call, extract:
- HTTP method (GET/POST/PUT/DELETE)
- URL path (full or partial)
- Request/response types if visible
Output as JSON array.
```

**Trade-offs:**

| Aspect | tree-sitter (Go) | LLM fallback (No-Go) |
|--------|-------------------|----------------------|
| Accuracy | ~95% | ~70-80% |
| Cost per file | $0 (deterministic) | ~$0.01 (2K tokens) |
| Full project cost delta | — | +$1-2 for 10 services |
| Dynamic URL detection | Limited (static analysis) | Better (understands intent) |
| Speed | Fast (local) | Slow (API call per file) |

**Impact on downstream milestones:** None. API call nodes have the same schema regardless of extraction method. Domain matching in Spec 2 consumes node data, not extraction metadata.

**Key limitation:** LLM may miss API calls configured in interceptors, base URL classes, or build-time-injected URLs. These edge cases exist with tree-sitter too but are more pronounced with LLM.

#### Deliverable

A validation report containing:
1. Benchmark repository statistics (files, languages, frameworks detected)
2. API call node extraction results (count, sample nodes, quality assessment)
3. tree-sitter parse coverage percentage
4. Go/No-Go decision with rationale
5. If No-Go: Plan B implementation details and timeline estimate

### M0.5: Configuration Refactoring

#### Current State

`system.json` was introduced in the [Cross-Repo Graph Linking design](2026-06-05-cross-repo-graph-linking-design.md) with `name`, `description`, and `discovery` fields. It is consumed by `build-system-graph.py` for service filtering.

#### Changes

**system.json extension** (Level 1 only, no cascading):

Add `facets` field to the existing schema. All existing fields remain unchanged.

```jsonc
{
  // Existing fields — no changes
  "name": "my-project",
  "description": "Project description",
  "discovery": { "mode": "auto", "exclude": ["deprecated-*"] },

  // New field
  "facets": [
    {
      "id": "server",           // Unique identifier across project
      "path": "server/",        // Relative to project root
      "type": "backend",        // backend | mobile | frontend | test
      "description": "Backend microservices"  // Optional
    },
    {
      "id": "client",
      "path": "client/",
      "type": "mobile",
      "subPaths": ["android/", "ios/", "flutter/"]  // Optional, declares sub-platform directories
    }
  ]
}
```

**Backward compatibility:** When `facets` is absent, skills that require facet info (M1+ only) report a clear error. Existing skills (`/understand`, `/understand-wiki` in backend mode) are unaffected.

**config.json introduction** (Level 1/2/3, cascading override):

```jsonc
{
  "outputLanguage": "zh-CN",                // Default "zh-CN"
  "autoUpdate": false,                       // Default false
  "excludeServices": ["legacy-*"],           // Default []
  "rpcAnnotations": ["@RpcClient", "@FeignClient"],  // Default []
  "apiBaseUrl": "",                          // Default ""
  "protocolType": "rest"                     // Default "rest"
}
```

**Cascading rule:**
```
Effective config for Level 3 service:
  service config.json → facet config.json → project config.json
  For each field: use the nearest defined value (field present in JSON object)
  A field explicitly set to "" or [] counts as defined and overrides parent
  A missing field (not present in JSON object) is transparent — falls through to parent
```

**Config reader implementation:**

```javascript
function readConfig(servicePath) {
  const levels = [
    join(servicePath, '.understand-anything/config.json'),       // Level 3
    join(facetPath, '.understand-anything/config.json'),         // Level 2
    join(projectRoot, '.understand-anything/config.json'),       // Level 1
  ];
  const defaults = {
    outputLanguage: 'zh-CN', autoUpdate: false,
    excludeServices: [], rpcAnnotations: [],
    apiBaseUrl: '', protocolType: 'rest'
  };
  let merged = { ...defaults };
  // Read from Level 1 → Level 3 (later values override)
  for (const path of levels.reverse()) {
    if (existsSync(path)) {
      const config = JSON.parse(readFileSync(path, 'utf-8'));
      merged = { ...merged, ...config };
    }
  }
  return merged;
}
```

**init_config.py script:**

```
Location: understand-anything-plugin/skills/understand-business/init_config.py
Usage: python3 init_config.py [project-root]
Output: Creates system.json + config.json with sensible defaults
        Scans directory structure to pre-populate facets[] if recognizable patterns found
```

## Verification Plan

### M-1 Tests

| Test | Scope | Method |
|------|-------|--------|
| resume-utils JSON validation | Unit | Create truncated JSON → verify getPendingItems returns it as pending |
| resume-utils checkpoint status | Unit | Create files with _checkpoint.status = complete/degraded/failed → verify correct filtering |
| resume-utils backward compat | Unit | Create files without _checkpoint → verify treated as complete |
| /understand-knowledge --full | Integration | Run with existing intermediate/ → verify all files regenerated |
| /understand-knowledge validation | Integration | Run on benchmark repo → verify enhanced validation catches known bad nodes |
| /understand-onboard deterministic split | Integration | Run → verify structured-data.json contains expected stats |
| /understand-diff schema validation | Integration | Run with known diff → verify output passes schema check |
| /understand Phase 3-6 checkpoint | Integration | Interrupt after Phase 4 → re-run → verify Phases 3-4 skipped, Phase 5-6 executed |
| Regression: existing backend output | Regression | Run modified skills on existing backend repo → diff output with previous version → no degradation |

### M0 Tests

| Test | Scope | Method |
|------|-------|--------|
| Android API call extraction | Validation | Run /understand on benchmark Android repo → count API call nodes |
| iOS API call extraction | Validation | Run /understand on benchmark iOS repo → count API call nodes |
| Go/No-Go assessment | Decision | Compare results against thresholds → document decision |

### M0.5 Tests

| Test | Scope | Method |
|------|-------|--------|
| No config backward compat | Integration | Run existing skills without system.json/config.json → behavior unchanged |
| system.json facets parsing | Unit | Parse example system.json → verify facets[] correctly loaded |
| config.json cascading | Unit | Create Level 1 + Level 3 configs → verify Level 3 overrides Level 1 |
| config.json defaults | Unit | Missing fields use defaults, no errors |
| init_config.py generation | Integration | Run on test project → verify valid output, skill can read |

## Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| resume-utils changes break existing checkpoint behavior | Medium | High | Backward compat: files without _checkpoint treated as complete; regression tests |
| /understand-onboard refactoring scope larger than expected | Medium | Medium | Keep LLM prompt changes minimal; focus on adding deterministic pre-processing, not rewriting LLM logic |
| M0 tree-sitter fails for mobile languages | Medium | Critical | Plan B ready (LLM fallback); Kotlin/Java already have extractors, risk mainly in Swift/ObjC |
| config.json cascading edge cases (empty object vs missing) | Low | Low | Explicit rule: missing file = skip, empty file = override with empty (no fields) |

## Out of Scope

- New skill creation (`/understand-business`) — Spec 2
- Wiki mobile adaptation — Spec 2
- CLI query script (`ua_query.py`) — Spec 3
- Dashboard changes — Spec 3
- GraphQL/gRPC/WebSocket protocol support — post-MVP

---
*This is Spec 1 of the Business Landscape series. Spec 2 (Core Capabilities: M1 + M2) will be designed after M0 Go/No-Go is resolved. Spec 3 (Consumption Layer: M3 + M4) follows Spec 2.*
