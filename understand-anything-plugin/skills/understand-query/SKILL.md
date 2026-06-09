---
name: understand-query
description: Query the Understand-Anything knowledge base via CLI. Six-layer drill-down from services to source code, backed by the shared API server.
argument-hint: ["<subcommand> [--server URL] [--token TOKEN] [--format json|md] [--verbose] [subcommand-flags...]"]
---

# /understand-query

Query codebase knowledge through a lightweight CLI (`ua_query.py`) backed by the shared Understand-Anything API server. Use six progressive layers — from service discovery and business landscape down to source-level knowledge graphs — to answer questions without loading entire graphs into context.

## Options

`$ARGUMENTS` must contain one subcommand followed by its flags.

**Global flags** (apply to all subcommands; place before subcommand name):

| Flag | Default | Description |
|------|---------|-------------|
| `--server URL` | `$UNDERSTAND_SERVER` or `http://localhost:3001` | API server base URL |
| `--token TOKEN` | `$UNDERSTAND_TOKEN` | Access token (required if env unset) |
| `--format json\|md` | `json` | Output format |
| `--verbose` | off | Include extra detail (e.g., edges in KG node queries) |

**Subcommands:**

| Subcommand | Purpose |
|------------|---------|
| `services` | Discover services and check which data layers (kg, domain, wiki, business) are ready |
| `meta` | Cross-layer freshness check — is generated data current? |
| `business` | Business landscape: domains, interactions, rules, cross-facet links, panorama |
| `wiki` | Service wiki pages, architecture overview, endpoints, flows, cross-domain docs |
| `domain` | Domain graph: flows, steps, neighbors, cross-domain edges |
| `kg` | Source-level knowledge graph: classes, calls, RPC, file annotations |

---

## Prerequisites

1. **API Server must be running.** This CLI queries the shared API server (same backend as the Dashboard):

```bash
cd understand-anything-plugin/packages/dashboard && pnpm run serve
```

The server prints startup info including an access URL with embedded token:

```
🚀 API Server running at http://localhost:3001
   Access URL: http://localhost:3001?token=<generated-token>
```

2. **Copy the token** and either pass it via `--token` or set the environment variable:

```bash
export UNDERSTAND_TOKEN=<copied-token>
export UNDERSTAND_SERVER=http://localhost:3001   # optional, this is the default
```

3. **Data must be generated.** The API serves data from `.understand-anything/` directories. Ensure relevant skills have been run:

| Skill | Generates |
|-------|-----------|
| `/understand` | Knowledge graph (`kg` layer) |
| `/understand-domain` | Domain graph (`domain` layer) |
| `/understand-wiki` | Wiki + system graph (`wiki`, `services` layer) |
| `/understand-business` | Business landscape (`business` layer) |

---

## Six-Layer Drill-Down Model

The recommended exploration pattern starts at Layer 0 (what exists?) and narrows to source code:

| Layer | Subcommand | Answers |
|-------|-----------|---------|
| 0. Service Discovery | `services --list` | What services exist? Which data layers are ready? |
| 1. Business Overview | `business --list` | What business domains exist? |
| 2. Domain Interactions | `business --domain X --type interactions` | How do users interact with domain X? |
| 3. Wiki Detail | `wiki --service S --domain D` | Technical implementation of domain D? |
| 4. Domain Graph | `domain --service S --flow F` | Business flow structure and steps? |
| 5. Source-Level KG | `kg --service S --neighbors N` | Class relationships and code? |
| +. Meta Check | `meta` / `meta --stale` | Is data fresh? |

**Example drill-down session:**

```bash
# Layer 0: Discover services and readiness
python ua_query.py services --list

# Layer 0+: Check freshness before trusting results
python ua_query.py meta --stale

# Layer 1: List business domains
python ua_query.py business --list

# Layer 2: User interactions for "order" domain
python ua_query.py business --domain order --type interactions

# Layer 3: Server-side wiki for order domain
python ua_query.py wiki --service order-service --domain order

# Layer 4: Flow structure in domain graph
python ua_query.py domain --service order-service --flows
python ua_query.py domain --service order-service --flow checkout-flow --steps

# Layer 5: Source-level neighbors of a controller
python ua_query.py kg --service order-service --neighbors OrderController --verbose
```

---

## Agent Decision Tree

Use this section to pick a query path based on the agent's goal. Always consult the **Strategy Summary** first.

### Strategy Summary

```
┌─────────────────────────────────────────────────────────────────────────┐
│ 1. ALWAYS start with `meta` to check freshness                          │
│ 2. Use `services --list` to discover available targets                  │
│ 3. Start broad (business/wiki) → narrow (kg/neighbors)                  │
│ 4. For code changes: wiki sourceRef > kg --file > read file             │
│ 5. For impact analysis: kg --neighbors inbound first                      │
│ 6. For cross-service: business panorama → links → wiki                    │
│ 7. Prefer --search over full graph download                               │
│ 8. Use --verbose only when edge detail is needed                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### Path 1: Feature Location

**When:** "I need to find code for feature X" or "where is X implemented?"

```bash
python ua_query.py business --search "keyword"
python ua_query.py services --list
python ua_query.py wiki --service S --domain D
python ua_query.py kg --service S --search "keyword" --verbose
```

**Flow:** Search business landscape for domain context → confirm service has kg/wiki → read wiki domain page for implementation summary → search KG for concrete classes/files.

### Path 2: Bug Investigation

**When:** "An API is broken" or "this endpoint returns wrong data"

```bash
python ua_query.py wiki --service S --type endpoint
python ua_query.py kg --service S --neighbors InterfaceName --edge-type consumes_rpc --direction inbound
python ua_query.py kg --service S --neighbors ControllerName --edge-type calls --direction outbound
python ua_query.py kg --service S --file src/path/File.java
```

**Flow:** Read endpoint wiki → trace RPC consumers (who calls this interface?) → trace outbound calls from controller → read annotated source file.

### Path 3: Dependency / Impact Analysis

**When:** "What will changing X break?" or "who depends on this class?"

```bash
python ua_query.py kg --service S --neighbors TargetClass --direction inbound
python ua_query.py kg --service S --neighbors TargetClass --direction outbound
python ua_query.py domain --service S --neighbors target-domain --edge-type cross_domain
```

**Flow:** Inbound KG neighbors show direct dependents; outbound shows what TargetClass calls. Domain cross-domain edges reveal business-level coupling across services.

### Path 4: Cross-Platform Debugging

**When:** "Client and server don't sync" or "cross-service flow is wrong"

```bash
python ua_query.py business --panorama
python ua_query.py business --domain X --type interactions
python ua_query.py business --links --domain X
python ua_query.py wiki --service server-svc --domain X
python ua_query.py wiki --service client-svc --domain X
```

**Flow:** Panorama shows all facets → interactions list cross-service steps → links show facet wiring → compare server and client wiki for the same domain.

### Path 5: Architecture Understanding

**When:** "How is the system structured?" or onboarding to a new repo

```bash
python ua_query.py wiki --architecture
python ua_query.py services --list
python ua_query.py kg --service S --layers
python ua_query.py kg --service S --tour
```

**Flow:** Architecture wiki for high-level map → services list for per-service readiness → KG layers for package/module structure → tour for guided walkthrough.

### Path 6: Data Quality Check

**When:** "Is the knowledge base data reliable?" before making decisions

```bash
python ua_query.py meta
python ua_query.py meta --stale
```

**Flow:** Full meta shows all layer availability and commit info; `--stale` returns only layers out of sync with current git HEAD. Re-run generation skills for stale layers before deep queries.

### Token Budget Guide

Keep agent context small by choosing the right operation:

| Operation | ~Tokens | Recommendation |
|-----------|---------|----------------|
| `services --list` | 200 | Always safe |
| `meta` / `meta --stale` | 150 | Always safe |
| `business --search Q` | 300 | Prefer over `--list` |
| `wiki --service S --domain D` | 1000–3000 | On demand |
| `kg --neighbors X` (depth=1) | 500–1500 | Primary traversal |
| `kg --node X --verbose` | 800–2000 | When edges needed |
| `kg` full graph (no filter) | 5000–50000 | **AVOID** |
| `domain` full graph | 3000–20000 | **AVOID** — use `--flows` |

**Tips:**

- Use `--search` and `--neighbors` instead of unfiltered graph dumps.
- Set `--depth 1` (default) for KG neighbors; only increase to 2–3 when necessary (max 3).
- Filter edges with `--edge-type` to reduce noise (`calls`, `consumes_rpc`, `implements`, etc.).
- Use `services --has wiki,kg` to find services ready for deep queries.

---

## Subcommand Reference

### `services` — Service Discovery

List services from `system-graph.json` with per-layer readiness (kg, domain, wiki, business).

| Flag | Type | Description |
|------|------|-------------|
| `--list` | boolean | List all services (default behavior when no other flags) |
| `--name NAME` | string | Filter to a single service by exact name |
| `--has LAYERS` | string | Comma-separated required layers: `kg`, `domain`, `wiki`, `business` |

**Examples:**

```bash
# List all services with data layer status
python ua_query.py services --list

# Get one service detail
python ua_query.py services --name order-service

# Services that have both wiki and kg generated
python ua_query.py services --has wiki,kg

# Markdown output
python ua_query.py --format md services --list
```

**Response shape:** `{ "services": [...], "totalServices": N }` — each service includes `name`, `basePath`, `facet`, and `dataLayers`.

---

### `meta` — Cross-Layer Freshness

Check project-wide layer availability and git freshness across kg, domain, wiki, and business data.

| Flag | Type | Description |
|------|------|-------------|
| `--stale` | boolean | Return only stale layer names (out of sync with current commit) |

**Examples:**

```bash
# Full meta: project info, layer stats, freshness
python ua_query.py meta

# Only stale layers (compact)
python ua_query.py meta --stale
```

**Response includes:** `project`, `layers` (availability, counts, timestamps), `freshness.currentCommit`, `freshness.stale`.

---

### `business` — Business Landscape Queries

Query cross-facet business-landscape data generated by `/understand-business`.

| Flag | Type | Description |
|------|------|-------------|
| `--list` | boolean | List all business domains with summaries and facet coverage |
| `--domain SLUG` | string | Full domain detail (interactions, rules, facets) |
| `--type TYPE` | string | Filter domain detail: `interactions` or `rules` |
| `--facet NAME` | string | Specific facet data for a domain (requires `--domain`) |
| `--search QUERY` | string | Full-text search across domain names and summaries |
| `--links` | boolean | Cross-facet links; optional `--domain` filter |
| `--panorama` | boolean | Full business panorama (all facets and services) |
| `--meta` | boolean | Business-landscape generation metadata |

**Examples:**

```bash
# List all domains
python ua_query.py business --list

# Search for checkout-related domains
python ua_query.py business --search checkout

# Domain interactions
python ua_query.py business --domain order --type interactions

# Business rules only
python ua_query.py business --domain payment --type rules

# Cross-facet links for a domain
python ua_query.py business --links --domain order

# System-wide panorama
python ua_query.py business --panorama

# Business layer metadata
python ua_query.py business --meta
```

---

### `wiki` — Wiki Data Queries

Query wiki pages generated by `/understand-wiki`. Some flags are global (no `--service`); others require `--service`.

| Flag | Type | Description |
|------|------|-------------|
| `--service NAME` | string | Target service (required for service-scoped queries) |
| `--type TYPE` | string | Section type: `endpoint` (others via `--domain`, `--flow`) |
| `--domain NAME` | string | Domain page within a service; also used with `--related` |
| `--search QUERY` | string | Full-text search across wiki content |
| `--overview` | boolean | Wiki overview (no `--service` needed) |
| `--architecture` | boolean | System architecture wiki (no `--service` needed) |
| `--cross-domain SLUG` | string | Cross-domain wiki page by slug (no `--service` needed) |
| `--endpoint-index` | boolean | Global endpoint index (no `--service` needed) |
| `--protocol NAME` | string | Filter endpoint index by protocol (with `--endpoint-index`) |
| `--flow ID` | string | Flow detail page for a service |
| `--related` | boolean | Related domains for `--domain` (cross-service) |

**Examples:**

```bash
# Service wiki index
python ua_query.py wiki --service order-service

# Domain implementation page
python ua_query.py wiki --service order-service --domain order

# Endpoint documentation
python ua_query.py wiki --service order-service --type endpoint

# Search wiki
python ua_query.py wiki --service order-service --search "payment callback"

# Global architecture overview
python ua_query.py wiki --architecture

# Wiki overview and quality stats
python ua_query.py wiki --overview

# Cross-domain page
python ua_query.py wiki --cross-domain order-checkout

# All endpoints indexed by protocol
python ua_query.py wiki --endpoint-index
python ua_query.py wiki --endpoint-index --protocol grpc

# Flow page
python ua_query.py wiki --service order-service --flow checkout-flow

# Related domains (cross-service)
python ua_query.py wiki --service order-service --domain order --related
```

---

### `domain` — Domain Graph Queries

Query the domain graph generated by `/understand-domain`. Prefer targeted queries over full graph download.

| Flag | Type | Description |
|------|------|-------------|
| `--service NAME` | string | Target service name (required) |
| `--domain NAME` | string | Filter nodes by domain name or ID substring |
| `--search QUERY` | string | Search domain node names and summaries |
| `--neighbors NODE` | string | Neighbor traversal from a domain node |
| `--edge-type TYPE` | string | Filter neighbor edges (e.g., `cross_domain`, `depends_on`) |
| `--flows` | boolean | List flow nodes only (compact) |
| `--flow ID` | string | Get a single flow node by id or name |
| `--steps` | boolean | With `--flow`: ordered steps in the flow |

**Examples:**

```bash
# List flows only (preferred over full graph)
python ua_query.py domain --service order-service --flows

# Flow with ordered steps
python ua_query.py domain --service order-service --flow checkout-flow --steps

# Find domain nodes
python ua_query.py domain --service order-service --domain order

# Search domains
python ua_query.py domain --service order-service --search "user"

# Cross-domain neighbors
python ua_query.py domain --service order-service --neighbors payment-domain --edge-type cross_domain
```

**Avoid:** `python ua_query.py domain --service S` with no filters — returns the entire domain graph.

---

### `kg` — Knowledge Graph Queries

Query the source-level knowledge graph generated by `/understand`. Use `--neighbors` for traversal; avoid unfiltered full graph loads.

| Flag | Type | Description |
|------|------|-------------|
| `--service NAME` | string | Target service name (required) |
| `--type TYPE` | string | Filter nodes: `class`, `interface`, `function`, `module`, `file`, etc. |
| `--node NAME` | string | Find node by exact name (local filter on graph) |
| `--search QUERY` | string | Full-text search across node data |
| `--file PATH` | string | Read source file with graph annotations |
| `--neighbors NODE` | string | Traverse neighbors from node (API-backed, preferred) |
| `--edge-type TYPE` | string | Filter neighbor edges: `calls`, `consumes_rpc`, `implements`, etc. |
| `--direction DIR` | string | `inbound`, `outbound`, or `both` (default: `both`) |
| `--depth N` | int | Traversal depth 1–3 (default: 1) |
| `--edges` | boolean | Paginated edge listing with optional filters |
| `--source NODE` | string | Filter edges by source node (with `--edges`) |
| `--target NODE` | string | Filter edges by target node (with `--edges`) |
| `--layers` | boolean | Package/module layer summary for the service |
| `--tour` | boolean | Guided tour steps for exploring the service KG |

**Examples:**

```bash
# Neighbor traversal (primary tool)
python ua_query.py kg --service order-service --neighbors OrderController
python ua_query.py kg --service order-service --neighbors OrderController --direction inbound --depth 1

# RPC dependency trace
python ua_query.py kg --service order-service --neighbors PaymentRpcClient --edge-type consumes_rpc --direction outbound

# Filtered edge listing
python ua_query.py kg --service order-service --edges --type calls
python ua_query.py kg --service order-service --edges --source OrderController --target PaymentService

# Node lookup with edges
python ua_query.py --verbose kg --service order-service --node OrderController

# Full-text search
python ua_query.py kg --service order-service --search "validate"

# Annotated source read
python ua_query.py kg --service order-service --file src/controllers/OrderController.java

# Architecture layers and guided tour
python ua_query.py kg --service order-service --layers
python ua_query.py kg --service order-service --tour
```

**Avoid:** `python ua_query.py kg --service S` with no filter flags — downloads and filters client-side, wasting tokens.

---

## Error Handling

| Exit Code | Meaning | Recommended Action |
|-----------|---------|-------------------|
| 0 | Success | Output printed to stdout |
| 1 | Client error | Check arguments; API returned 4xx or runtime error |
| 2 | Server unavailable | Start API server: `pnpm run serve` |

**Error messages go to stderr.** Successful JSON/markdown output goes to stdout.

| Scenario | Behavior |
|----------|----------|
| `--token` not provided and `$UNDERSTAND_TOKEN` unset | Exit 1 with usage hint |
| Server not running (connection refused) | Exit 2 with startup instructions |
| Subcommand requires `--service` but not provided | Exit 1 with `SystemExit` message |
| Wiki `--related` without `--domain` | Exit 1: `--related requires --domain` |
| Domain `--flow` not found | Exit 1: `Flow 'X' not found` |
| API returns 404 (data not generated) | Exit 1, HTTP error printed |
| API returns 500 (server error) | Exit 1, error body printed |
| KG neighbor depth out of range | Exit 1: depth must be 1–3 |
| Node not found in graph query | Exit 1: `node not found` |

---

## Output Formats

### JSON (default)

Standard JSON with `indent=2`, suitable for piping to `jq` or programmatic consumption:

```bash
python ua_query.py business --list | jq '.domains[].name'
python ua_query.py meta --stale | jq '.stale[]'
python ua_query.py services --has kg | jq '.services[].name'
```

### Markdown (`--format md`)

Human-readable markdown for embedding in agent responses:

- Domain lists → `## Domain Name` headings with summaries
- Search results → bullet list with bold names
- Other data → fenced JSON code block

```bash
python ua_query.py --format md business --list
python ua_query.py --format md business --search "order"
```

---

## Environment Variables

| Variable | Purpose | Default |
|----------|---------|---------|
| `UNDERSTAND_SERVER` | API server base URL | `http://localhost:3001` |
| `UNDERSTAND_TOKEN` | Access token (avoids `--token` flag) | (none — required) |

---

## Script Location

```
understand-anything-plugin/skills/understand-query/ua_query.py
```

Run via:

```bash
python understand-anything-plugin/skills/understand-query/ua_query.py [global-flags] <subcommand> [subcommand-flags]
```

Or with `uv`:

```bash
uv run understand-anything-plugin/skills/understand-query/ua_query.py [global-flags] <subcommand> [subcommand-flags]
```

**Dependencies:** Python 3.10+ stdlib only. No external packages required.

---

## Integration with Agent Workflow

This skill is the programmatic query layer for AI agents working on codebases with Understand-Anything data. Follow the **Agent Decision Tree** above to pick the right path; use the **Six-Layer Drill-Down Model** when exploring unfamiliar territory.

**Typical agent patterns:**

1. **Freshness gate:** Run `meta --stale` before trusting any layer
2. **Target discovery:** Run `services --list` or `services --has wiki,kg` to pick a service
3. **Contextual lookup:** Business search → wiki domain → kg neighbors before editing code
4. **Cross-reference:** Check business rules (`--type rules`) before modifying domain logic
5. **Impact check:** Inbound `kg --neighbors` before refactoring shared classes
6. **Validation:** Re-run `meta` after generation skills to confirm layers are fresh

**Chaining example (agent script):**

```bash
# 1. Check freshness and server availability
python ua_query.py meta --stale 2>/dev/null
if [ $? -eq 2 ]; then
  echo "Server not running — start with: cd understand-anything-plugin/packages/dashboard && pnpm run serve"
  exit 2
fi

# 2. Find service with wiki + kg ready
SVC=$(python ua_query.py services --has wiki,kg | jq -r '.services[0].name // empty')
if [ -z "$SVC" ]; then
  echo "No service with wiki+kg — run /understand-wiki and /understand first"
  exit 1
fi

# 3. Search business landscape, then drill to wiki and KG
DOMAIN=$(python ua_query.py business --search "payment" | jq -r '.results[0].id // empty')
DOMAIN_SLUG="${DOMAIN#domain:}"
python ua_query.py business --domain "$DOMAIN_SLUG" --type interactions
python ua_query.py wiki --service "$SVC" --domain "$DOMAIN_SLUG"
python ua_query.py kg --service "$SVC" --search "payment" --verbose
```

**Related skills:**

| Skill | When to run instead of query |
|-------|------------------------------|
| `/understand` | Regenerate stale kg layer |
| `/understand-domain` | Regenerate domain graph |
| `/understand-wiki` | Regenerate wiki and system graph |
| `/understand-business` | Regenerate business landscape |
| `/understand-dashboard` | Visual exploration when CLI output is insufficient |
| `/understand-chat` | Natural-language Q&A over the knowledge graph |
