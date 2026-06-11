---
name: understand-query
description: Query the Understand-Anything knowledge base via CLI. Seven-layer drill-down from services to source code, backed by the shared API server.
argument-hint: ["<subcommand> [--server URL] [--format json|md] [--verbose] [subcommand-flags...]"]
---

# /understand-query

Query codebase knowledge through a lightweight CLI (`ua_query.py`) backed by the shared Understand-Anything API server. Use seven progressive layers — from service discovery and business landscape down to code structure — to answer questions without loading entire graphs into context.

## Execution Mode: Sub-Agent (Default)

**This skill MUST be delegated to a sub-agent by default.** All understand-query operations are read-only exploration and lookup tasks — the caller only cares about the final result, not the intermediate process.

### Why Sub-Agent?

- Query operations involve multiple CLI calls, output parsing, and drill-down — noisy intermediate steps that pollute the parent context.
- The caller only needs a structured answer, not raw CLI output.
- Sub-agent isolation keeps the parent context clean for the actual task at hand.

### Dispatch Instructions (Cross-Platform)

When this skill is triggered, the parent agent MUST delegate to a sub-agent using **whichever mechanism the current platform provides**:

| Platform | Mechanism | Type |
|----------|-----------|------|
| **Cursor** | `Task` tool | `subagent_type: "generalPurpose"` (needs shell for CLI) |
| **Claude Code** | `dispatch_agent` / `Task` tool | General-purpose agent with shell access |
| **Codex** | Platform-native sub-agent / task dispatch | Agent with shell access |

### Required Context for the Sub-Agent Prompt

Regardless of platform, pass these to the sub-agent:

1. **User's question** — the original query intent verbatim.
2. **Project directory** — path to the project containing `.understand-anything/` data.
3. **CLI location** — path to `ua_query.py` (this skill's directory).
4. **API server** — `http://172.18.228.71:3001` (default). Instruct sub-agent to verify server is running; if not, start it via `cd <plugin-path>/packages/dashboard && pnpm run serve`.
5. **This SKILL.md content** (or the relevant sections for the query type).
6. **Output expectation** — return a **concise, structured summary** answering the question, not raw CLI dumps.

### Sub-Agent Prompt Template

```
You are executing an understand-query skill task.

**User Question:** <the actual question>
**Project Directory:** <path to the project with .understand-anything/ data>
**CLI Path:** <path to ua_query.py>
**API Server:** Ensure the API server is running at http://172.18.228.71:3001.
                If not, start it: cd <plugin-path>/packages/dashboard && pnpm run serve

Follow the SKILL.md instructions below to execute the appropriate ua_query.py
commands. Use --format md for readable output. Combine multiple calls with &&.

<paste relevant SKILL.md sections here>

Return a clear, structured summary addressing the user's question.
Do NOT return raw CLI output — synthesize findings into an answer.
```

### When NOT to Use Sub-Agent

Skip sub-agent dispatch only when:
- The parent agent is **already inside a sub-agent** (avoid nesting).
- The query is a **single trivial command** (e.g., `services --list`) whose result is needed inline for an ongoing implementation task.

---

## Golden Rule for Agents (Read FIRST)

For ANY "How does X work?" or "Where is X implemented?" question, use `trace` as your **first and often only** call:

```bash
trace --service SERVICE --query "中文关键词,EnglishName,Synonym" --source --business
```

This single command searches KG, retrieves neighbors, reads source code, and includes business context — replacing 5-7 individual calls. **Always include `--source --business`.**

**Multi-service questions?** Run trace once per relevant service in a **single Shell call**:

```bash
python ua_query.py trace --service svc-a --query "keyword" --source --business && \
python ua_query.py trace --service svc-b --query "keyword" --source
```

**Token efficiency**: Use `--format md` to reduce output size by 30-50%.

---

## Agent Efficiency Rules

1. **Batch CLI calls**: Combine multiple CLI commands into ONE Shell call using `&&`.
2. **Expand keywords before trace**: Always provide 2-4 comma-separated variants (original + English + synonym). This searches all in parallel — no retry needed.
3. **Use `--format md`** when the output will be read by an agent (not parsed as JSON).
4. **Use `--business` with trace** to include business landscape context (saves a separate `business --search` call).
5. **Use `kg --file --toc` before `kg --file`** to see method index first, then batch-read consecutive methods.
6. **RRF is default for trace** — `trace` uses `fusion=rrf` automatically. Use `--fusion none` only for strict text-only results.

---

## Subcommands

| Subcommand | Purpose | Detail Doc |
|------------|---------|------------|
| `trace` | **Start here.** Search→neighbors→source in one call | [source-code.md](docs/source-code.md) |
| `kg` | Source-level KG: classes, calls, RPC, file annotations | [source-code.md](docs/source-code.md) |
| `structure` | Code structure: signatures, annotations, param types | [source-code.md](docs/source-code.md) |
| `business` | Business landscape: domains, interactions, rules | [business-domain.md](docs/business-domain.md) |
| `wiki` | Wiki pages, architecture, endpoints, flows | [business-domain.md](docs/business-domain.md) |
| `domain` | Domain graph: flows, steps, neighbors | [business-domain.md](docs/business-domain.md) |
| `services` | Service discovery and data layer readiness | [reference.md](docs/reference.md) |
| `meta` | Cross-layer freshness check | [reference.md](docs/reference.md) |

**Global flags** (place before subcommand name):

| Flag | Default | Description |
|------|---------|-------------|
| `--server URL` | `$UNDERSTAND_SERVER` or `http://172.18.228.71:3001` | API server base URL |
| `--format json\|md` | `json` | Output format |
| `--verbose` | off | Include extra detail (e.g., edges in KG queries) |

---

## Prerequisites

1. **Python 3.10+** required (stdlib only, no external packages).
2. **API Server must be running:**
   ```bash
   cd understand-anything-plugin/packages/dashboard && pnpm run serve
   ```
3. **Data must be generated** by running relevant skills:

| Skill | Generates |
|-------|-----------|
| `/understand` | Knowledge graph (`kg` layer) + structural analysis |
| `/understand-domain` | Domain graph (`domain` layer) |
| `/understand-wiki` | Wiki + system graph (`wiki`, `services` layer) |
| `/understand-business` | Business landscape (`business` layer) |

---

## Seven-Layer Drill-Down Model

| Layer | Subcommand | Answers |
|-------|-----------|---------|
| 0. Service Discovery | `services --list` | What services exist? Which data layers are ready? |
| 1. Business Overview | `business --list` | What business domains exist? |
| 2. Domain Interactions | `business --domain X --type interactions` | How do users interact with domain X? |
| 3. Wiki Detail | `wiki --service S --domain D` | Technical implementation of domain D? |
| 4. Domain Graph | `domain --service S --flow F` | Business flow structure and steps? |
| 5. Source-Level KG | `kg --service S --neighbors N` | Class relationships and code? |
| 6. Source Code | `kg --service S --file PATH` | Read actual implementation source code |
| 7. Code Structure | `structure --service S --annotation X` | Function signatures, annotations, param/return types |

---

## Agent Decision Tree

### Strategy Summary

```
┌─────────────────────────────────────────────────────────────────────────┐
│ 0. EXPAND keywords: Chinese + English + synonym (comma-separated)       │
│ 1. ALWAYS start with `meta` to check freshness                          │
│ 2. Use `services --list` to discover available targets                  │
│ 3. Start broad (business/wiki) → narrow (kg/neighbors)                  │
│ 4. For code changes: wiki sourceRef > kg --file > read file             │
│ 5. For impact analysis: kg --neighbors inbound first                    │
│ 6. For cross-service: business panorama → links → wiki                  │
│ 7. For type/annotation queries: use structure                           │
│ 8. For inheritance/interface: structure --chain / --implementors        │
│ 9. Prefer --search over full graph download                            │
└─────────────────────────────────────────────────────────────────────────┘
```

### Query Paths by Goal

| Path | When | Start With | Detail |
|------|------|------------|--------|
| Feature Location | "Where is X implemented?" | `trace --query "X,EnglishX" --source --business` | [source-code.md](docs/source-code.md#path-1-feature-location) |
| Bug Investigation | "API returns wrong data" | `wiki --type endpoint` → `kg --neighbors` | [source-code.md](docs/source-code.md#path-2-bug-investigation) |
| Impact Analysis | "What will changing X break?" | `kg --neighbors X --direction inbound` | [source-code.md](docs/source-code.md#path-3-dependency--impact-analysis) |
| Cross-Platform | "Client/server don't sync" | `business --panorama` → `business --links` | [business-domain.md](docs/business-domain.md#path-4-cross-platform-debugging) |
| Architecture | "How is system structured?" | `wiki --architecture` → `services --list` | [business-domain.md](docs/business-domain.md#path-5-architecture-understanding) |
| Data Quality | "Is KB data reliable?" | `meta --stale` | [reference.md](docs/reference.md) |
| Code-Level Detail | "Find all @X annotations" | `structure --annotation X` | [source-code.md](docs/source-code.md#path-7-code-level-detail-signatures--annotations) |
| Inheritance/Impl | "Subclasses of X?" | `structure --chain X` / `--implementors I` | [source-code.md](docs/source-code.md#path-8-inheritance--implementation) |

### Drill-Down Across Layers

When a business/domain query reveals code you need to inspect, follow the natural progression. See detailed patterns in:
- [Business → Source drill-down](docs/business-domain.md#drill-down-from-business-to-source-code)
- [Source-level drill-down](docs/source-code.md#drill-down-from-business-context-to-source-code)

---

## Token Budget Guide

| Operation | ~Tokens | Recommendation |
|-----------|---------|----------------|
| `services --list` | 200 | Always safe |
| `meta --stale` | 150 | Always safe |
| `business --search Q` | 300 | Prefer over `--list` |
| `kg --search Q` (fuzzy) | 500–1500 | Typo-tolerant, try first |
| `wiki --service S --domain D` | 1000–3000 | On demand |
| `kg --neighbors X` (depth=1) | 500–1500 | Primary traversal |
| `structure --file PATH` | 200–800 | Get signatures for one file |
| `structure --annotation X` | 300–1500 | Search by annotation (includes typeRef) |
| `structure --chain X` | 200–600 | Inheritance chain traversal |
| `structure --implementors I` | 200–800 | Find all interface implementors |
| `kg` full graph (no filter) | 5000–50000 | **AVOID** |
| `domain` full graph | 3000–20000 | **AVOID** — use `--flows` |

**Tips:**
- Use `--search` and `--neighbors` instead of unfiltered graph dumps.
- Set `--depth 1` (default) for KG neighbors; only increase when necessary (max 3).
- Filter edges with `--edge-type` to reduce noise.
- Use `services --has wiki,kg` to find services ready for deep queries.

---

## Combination Recipes (Reduce Tool Calls)

Common scenarios optimized to minimize calls. Full details in [source-code.md](docs/source-code.md#combination-recipes-reducing-tool-calls).

| Scenario | Calls | Recipe |
|----------|-------|--------|
| "How does X work?" | 1 | `trace --query "X,英文,Synonym" --source --business` |
| "Find RPC endpoints + types" | 2 | `structure --annotation` → `kg --edges --type consumes_rpc` |
| "Impact of changing X" | 2 | `kg --neighbors X --direction both` → `structure --property-type X` |
| "Class hierarchy" | 2 | `structure --chain X --direction up` → `structure --implementors I` |
| "Read large file" | 2 | `kg --file F --toc` → `kg --file F --start N --end M` |
| "Business → source code" | 3 | `business --search` → `trace --source --business` → `structure --file` |
| "Cross-service dep" | 3 | `business --panorama` → `trace` in source svc → `trace` in target svc |

**Key insight:** `typeRef` auto-resolution means type-based searches (`--param-type`, `--return-type`, `--property-type`, `--interface`) automatically include where the referenced type is defined — saving one extra lookup per result.

---

## Detail Documentation

- **[Source-Level Queries](docs/source-code.md)** — `kg`, `trace`, `structure`, `kg --file` TOC pattern, combination recipes
- **[Business & Domain Queries](docs/business-domain.md)** — `business`, `wiki`, `domain`, cross-platform recipe
- **[Technical Reference](docs/reference.md)** — `services`, `meta`, search algorithm, error handling, output formats

---

## Integration with Agent Workflow

**Typical agent patterns:**

1. **Freshness gate:** Run `meta --stale` before trusting any layer
2. **Target discovery:** Run `services --has wiki,kg` to pick a service
3. **Contextual lookup:** Business search → wiki domain → kg neighbors before editing code
4. **Cross-reference:** Check business rules (`--type rules`) before modifying domain logic
5. **Impact check:** Inbound `kg --neighbors` + `structure --property-type X` before refactoring shared classes
6. **Type inspection:** Use `structure --annotation` or `--param-type` for signature-level queries (results include `typeRef` auto-resolution)
7. **Hierarchy exploration:** `structure --chain X --direction up/down` + `structure --implementors I` for type relationships

**Related skills:**

| Skill | When to run instead of query |
|-------|------------------------------|
| `/understand` | Regenerate stale kg layer |
| `/understand-domain` | Regenerate domain graph |
| `/understand-wiki` | Regenerate wiki and system graph |
| `/understand-business` | Regenerate business landscape |
| `/understand-dashboard` | Visual exploration when CLI output is insufficient |
