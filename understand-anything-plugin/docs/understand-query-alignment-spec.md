# understand-query Alignment Spec

> **Date:** 2026-06-09  
> **Status:** Draft — awaiting implementation  
> **Scope:** API endpoints + CLI subcommands + SKILL.md documentation

---

## 1. Background

The `/understand-query` skill provides a CLI tool (`ua_query.py`) for AI agents to programmatically query codebase knowledge. It currently covers ~50% of the data produced by the four upstream skills (`/understand`, `/understand-domain`, `/understand-wiki`, `/understand-business`).

**Problem:** Agents cannot access critical data layers (relationship traversal, parent-level wiki, service discovery, cross-facet links, freshness metadata) without direct file reads. This violates the centralized API access principle.

**Goal:** Achieve "Agent Essential" coverage — every data point an agent needs for code analysis/modification decisions is accessible via API, with CLI thin-client commands mapping 1:1 to endpoints.

---

## 2. Architecture Decision

**Approach: Extend existing API server with new dedicated handlers (Approach B)**

- New file: `handlers/services.ts` — service discovery & data readiness
- New file: `handlers/graph-query.ts` — unified relationship traversal for KG + domain graphs
- Extend: `handlers/wiki.ts` — parent wiki + flow-level access
- Extend: `handlers/business.ts` — cross-facet-links + meta + panorama
- New endpoint: `GET /api/meta` — cross-layer freshness aggregation

**Rationale:** Follows existing handler-per-resource pattern. Shared DataService layer prevents duplication. Dashboard and CLI evolve independently without merge conflicts.

---

## 3. New API Endpoints

### 3.1 `GET /api/services` — Service Discovery

**Handler:** `handlers/services.ts`  
**Source data:** `system-graph.json` → `serviceIndex` + per-service `meta.json` files

**Response:**

```typescript
{
  services: Array<{
    name: string;
    basePath: string;
    facet?: "server" | "mobile" | "frontend";
    dataLayers: {
      kg: { available: boolean; commit?: string; analyzedAt?: string };
      domain: { available: boolean; nodeCount?: number };
      wiki: { available: boolean; qualityGrade?: string; generatedAt?: string };
      business: { available: boolean; domainCount?: number };
    };
  }>;
  totalServices: number;
}
```

**Query params:**
- `name` (string, optional) — filter to single service
- `has` (comma-separated, optional) — filter services that have specific data layers (e.g., `has=wiki,kg`)

---

### 3.2 `GET /api/graph-query/neighbors` — Node Neighborhood

**Handler:** `handlers/graph-query.ts`  
**Source data:** `knowledge-graph.json` or `domain-graph.json` (per `graph` param)

**Query params:**

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `service` | string | yes | — | Target service |
| `graph` | `kg` \| `domain` | yes | — | Which graph to query |
| `node` | string | yes | — | Node ID or name (fuzzy match on name if ID not found) |
| `direction` | `inbound` \| `outbound` \| `both` | no | `both` | Edge direction filter |
| `edgeType` | string | no | — | Filter by edge type (e.g., `calls`, `cross_domain`) |
| `depth` | number (1–3) | no | `1` | Traversal depth |

**Response:**

```typescript
{
  center: GraphNode;
  neighbors: Array<{
    node: GraphNode;
    edge: GraphEdge;
    direction: "inbound" | "outbound";
    depth: number;
  }>;
  totalEdges: number;
}
```

**Error cases:**
- `404` — node not found in graph
- `400` — depth > 3 or invalid graph value

---

### 3.3 `GET /api/graph-query/edges` — Edge Filtering

**Handler:** `handlers/graph-query.ts`

**Query params:**

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `service` | string | yes | — | Target service |
| `graph` | `kg` \| `domain` | yes | — | Which graph |
| `type` | string | no | — | Filter by edge type |
| `source` | string | no | — | Filter by source node ID/name |
| `target` | string | no | — | Filter by target node ID/name |
| `limit` | number | no | `50` | Max results |
| `offset` | number | no | `0` | Pagination offset |

**Response:**

```typescript
{
  edges: Array<GraphEdge & {
    sourceNode: { id: string; name: string; type: string };
    targetNode: { id: string; name: string; type: string };
  }>;
  total: number;
  hasMore: boolean;
}
```

---

### 3.4 `GET /api/graph-query/layers` — KG Architecture Layers

**Handler:** `handlers/graph-query.ts`

**Query params:** `service` (required)

**Response:**

```typescript
{
  layers: Array<{
    id: string;
    name: string;
    description: string;
    nodeCount: number;
  }>;
}
```

---

### 3.5 `GET /api/graph-query/tour` — KG Onboarding Tour

**Handler:** `handlers/graph-query.ts`

**Query params:** `service` (required)

**Response:**

```typescript
{
  steps: Array<{
    order: number;
    title: string;
    description: string;
    nodeIds: string[];
    languageLesson?: string;
  }>;
}
```

---

### 3.6 `GET /api/wiki/service/:name/flow/:flowId` — Flow Direct Access

**Handler:** `handlers/wiki.ts` (extend)

**Response:**

```typescript
{
  flow: {
    id: string;
    name: string;
    summary: string;
    steps: Array<{
      order: number;
      name: string;
      description: string;
      sourceRef?: { file: string; lineRange?: [number, number] };
    }>;
  };
  domain: { id: string; name: string };
  service: string;
}
```

**Error:** `404` if flow ID not found in any domain of the service.

---

### 3.7 `GET /api/business/meta` — Business Landscape Meta

**Handler:** `handlers/business.ts` (extend)

**Response:** Direct passthrough of `business-landscape/meta.json`:

```typescript
{
  contentHash: string;
  sourceHashes: Record<string, string>;
  generatedAt: string;
  version: string;
  status: "complete" | "degraded";
}
```

---

### 3.8 `GET /api/business/cross-facet-links` — Cross-Facet Links

**Handler:** `handlers/business.ts` (extend)

**Query params:** `domain` (optional, filter by domain slug)

**Response:** `business-landscape/cross-facet-links.json` (optionally filtered)

---

### 3.9 `GET /api/business/panorama` — Cross-Platform Panorama

**Handler:** `handlers/business.ts` (extend)

**Response:** `wiki/domains/business.json` content (WikiCrossDomain schema)

---

### 3.10 `GET /api/meta` — Cross-Layer Freshness

**Handler:** New route in main server (no dedicated handler file needed; 30 lines in server setup)

**Response:**

```typescript
{
  project: { name: string; description?: string };
  layers: {
    kg: { available: boolean; commit?: string; analyzedAt?: string; nodeCount?: number; edgeCount?: number };
    domain: { available: boolean; nodeCount?: number; edgeCount?: number };
    wiki: { available: boolean; qualityGrade?: string; generatedAt?: string; serviceCount?: number };
    business: { available: boolean; status?: string; domainCount?: number; generatedAt?: string };
  };
  freshness: {
    currentCommit: string;
    stale: string[];
  };
}
```

**Logic:** Compares each layer's `gitCommitHash` / `commit` field against `git rev-parse HEAD`. Layers whose commit differs from HEAD are listed in `stale[]`.

---

## 4. CLI Subcommand Extensions

### 4.1 New Subcommand: `services`

```
python ua_query.py services [--list] [--name NAME] [--has LAYERS]
```

| Flag | Type | Description |
|------|------|-------------|
| `--list` | boolean | List all services (default action) |
| `--name` | string | Filter to single service |
| `--has` | string | Comma-separated layer filter: `kg,wiki,domain,business` |

---

### 4.2 New Subcommand: `meta`

```
python ua_query.py meta [--stale]
```

| Flag | Type | Description |
|------|------|-------------|
| `--stale` | boolean | Only output the stale layers list |

---

### 4.3 Extended: `kg`

New flags (added to existing subparser):

| Flag | Type | Mutual exclusion | Description |
|------|------|-----------------|-------------|
| `--neighbors NODE` | string | with `--node`, `--search`, `--file` | Neighborhood traversal |
| `--edge-type TYPE` | string | requires `--neighbors` or `--edges` | Filter edge type |
| `--direction DIR` | string | requires `--neighbors` | `inbound` / `outbound` / `both` |
| `--depth N` | int (1-3) | requires `--neighbors` | Traversal depth |
| `--edges` | boolean | with `--node`, `--neighbors`, `--search`, `--file` | Switch to edge query mode |
| `--source NODE` | string | requires `--edges` | Edge source filter |
| `--target NODE` | string | requires `--edges` | Edge target filter |
| `--layers` | boolean | with all others except `--service` | Return layers |
| `--tour` | boolean | with all others except `--service` | Return tour |

---

### 4.4 Extended: `domain`

New flags:

| Flag | Type | Description |
|------|------|-------------|
| `--neighbors DOMAIN` | string | Domain neighborhood (cross_domain edges) |
| `--edge-type TYPE` | string | With `--neighbors` |
| `--flows` | boolean | List all flow nodes |
| `--flow ID` | string | Get specific flow + steps |
| `--steps` | boolean | With `--flow`, include step details |

---

### 4.5 Extended: `wiki`

New flags:

| Flag | Type | Requires `--service`? | Description |
|------|------|----------------------|-------------|
| `--overview` | boolean | no | Parent wiki overview |
| `--architecture` | boolean | no | Parent wiki architecture |
| `--cross-domain ID` | string | no | Parent cross-domain page |
| `--endpoint-index` | boolean | no | Cross-service endpoint index |
| `--protocol PROTO` | string | `--endpoint-index` | Filter endpoint index by protocol |
| `--flow ID` | string | yes | Direct flow access within service |
| `--related` | boolean | yes + `--domain` | Related pages |

---

### 4.6 Extended: `business`

New flags:

| Flag | Type | Description |
|------|------|-------------|
| `--links` | boolean | Cross-facet links data |
| `--panorama` | boolean | Wiki cross-platform panorama |
| `--meta` | boolean | Business landscape meta/quality |

---

## 5. SKILL.md Documentation Structure

### Updated Section Outline

```
# /understand-query

## Options
  (Updated: add services, meta to subcommand list)

## Prerequisites
  (Unchanged)

## Six-Layer Drill-Down Model (was Four-Layer)
  Services → Business → Wiki → Domain → KG → Meta
  + Quick-start decision: "which subcommand do I use?"

## Agent Decision Tree (NEW)
  ### Strategy Summary (8 rules)
  ### Path 1: Feature Location
  ### Path 2: Bug Investigation
  ### Path 3: Dependency / Impact Analysis
  ### Path 4: Cross-Platform Debugging
  ### Path 5: Architecture Understanding
  ### Path 6: Data Quality Check
  ### Token Budget Guide

## Subcommand Reference
  ### services (NEW)
  ### meta (NEW)
  ### business (extended)
  ### wiki (extended)
  ### domain (extended)
  ### kg (extended)

## Error Handling (updated)
## Output Formats (unchanged)
## Environment Variables (unchanged)
## Script Location (unchanged)
## Integration with Agent Workflow (updated → references Decision Tree)
```

### Agent Decision Tree — Strategy Summary

```
┌──────────────────────────────────────────────────────────┐
│  Agent Query Strategy (embed in SKILL.md)                  │
├──────────────────────────────────────────────────────────┤
│  1. ALWAYS start with `meta` to check freshness            │
│  2. Use `services --list` to discover available targets    │
│  3. Start broad (business/wiki) → narrow (kg/neighbors)   │
│  4. For code changes: wiki sourceRef > kg --file > read    │
│  5. For impact analysis: kg --neighbors inbound first      │
│  6. For cross-service: business panorama → links → wiki    │
│  7. Prefer --search over full graph download               │
│  8. Use --verbose only when edge detail is needed          │
└──────────────────────────────────────────────────────────┘
```

### Token Efficiency Guide

| Operation | ~Tokens | Recommendation |
|-----------|---------|----------------|
| `services --list` | 200 | Always safe |
| `meta` / `meta --stale` | 150 | Always safe |
| `business --search Q` | 300 | Prefer over `--list` |
| `wiki --service S --domain D` | 1000–3000 | On demand |
| `kg --neighbors X` (depth=1) | 500–1500 | Primary traversal |
| `kg --node X --verbose` | 800–2000 | When edges needed |
| `kg` full graph | 5000–50000 | **AVOID** — use search/neighbors |
| `domain` full graph | 3000–20000 | **AVOID** — use --flows/--flow |

---

## 6. Implementation Order

| Phase | Scope | Deliverable |
|-------|-------|-------------|
| **Phase 1** | API: `handlers/services.ts` + `/api/meta` | Service discovery + freshness |
| **Phase 2** | API: `handlers/graph-query.ts` (neighbors + edges + layers + tour) | Relationship traversal |
| **Phase 3** | API: Extend `handlers/wiki.ts` (flow access) + `handlers/business.ts` (meta, links, panorama) | Complete coverage |
| **Phase 4** | CLI: New subcommands (`services`, `meta`) + extend existing 4 subcommands | CLI tool update |
| **Phase 5** | SKILL.md: Full rewrite with Decision Tree, Six-Layer Model, extended reference | Documentation |

### Dependencies

```
Phase 1 ─────────────────┐
Phase 2 ─────────────────┤──→ Phase 4 (CLI needs all API endpoints ready)
Phase 3 ─────────────────┘         │
                                    └──→ Phase 5 (SKILL.md documents final CLI)
```

Phases 1-3 are API-layer and can be parallelized. Phase 4 depends on all three. Phase 5 depends on Phase 4.

---

## 7. Verification Plan

| Check | Method |
|-------|--------|
| All new endpoints return valid JSON | Integration test: hit each endpoint, validate schema |
| CLI --help matches SKILL.md | Diff argparse help output vs doc |
| Each Decision Tree path produces useful output | End-to-end test with real project data |
| No regressions on existing endpoints/flags | Run existing tests before/after |
| Token estimates are accurate | Measure actual response sizes for representative queries |
| `meta --stale` correctly detects drift | Test with modified git HEAD |
| `--neighbors` depth=2 doesn't explode | Performance test on large graph (~5000 nodes) |
| Dashboard still works | Run Dashboard, verify all views load |

---

## 8. Out of Scope

- Intermediate/staging file access (debug-only, not agent-essential)
- Write/mutation endpoints (the query tool is read-only)
- Authentication changes (uses existing token mechanism)
- New output formats beyond json/md
- GraphQL interface (considered, rejected for complexity)
- Websocket/streaming (not needed for CLI queries)
- `client-graph.json` dedicated endpoint (too rarely queried; use raw file serve if needed)
