---
name: understand-query
description: Use when answering questions about an already-analyzed codebase — business logic, where a feature is implemented, call/impact graphs, or source — via the `ua_query.py` CLI backed by the Understand-Anything API server. Answers are source-verified: code is the only ground truth.
argument-hint: ["<subcommand> [--server URL] [--format json|md] [--verbose] [subcommand-flags...]"]
---

# /understand-query

Query codebase knowledge through a lightweight CLI (`ua_query.py`) backed by the shared Understand-Anything API server. Use progressively deeper layers — from business landscape and service discovery down to source-verified code — to answer questions without loading entire graphs into context.

## Operating Principles (precedence)

Apply in this order — **#1 is a hard constraint; #2–#3 optimize within it (never around it):**

1. **Code is the only source of truth — never traded away.** `wiki`/`domain`/`business` are LLM summaries: use them to *locate*, never to *conclude*. Every claim you present must be backed by source you actually read (see [Source Verification Rule](#source-verification-rule-mandatory)).
2. **Fewest tool calls.** Take the cheapest path that *fully* answers — for most how/where/what questions that is one `ask --depth full`. Don't open with throwaway exploratory calls you'll have to re-verify anyway.
3. **Fewest tokens.** Read *narrowly* (targeted methods, not whole files) and *in bulk* (batch located reads into one call) — see [Agent Efficiency Rules](#agent-efficiency-rules).

**Stopping rule:** stop the moment source corroborates the answer. Locating the concept in a higher layer is *not* "done" — descend to source, confirm, cite, then stop.

## Source Verification Rule (MANDATORY)

**No answer may rest on `wiki` or `domain` data alone — every factual claim presented to the user MUST be corroborated by source code.** Wiki, domain, and business layers are LLM-generated summaries: they may be stale, incomplete, or simply wrong. Source code is the only ground truth. If you cannot point to the source (file + symbol or line range) that backs a claim, you have **not** verified it — read the code before you answer. A polished summary built only from `wiki`/`domain`/`business` output is an unverified guess, no matter how confident it reads.

**Violating the letter of this rule is violating its spirit:** "the wiki was detailed enough" and "the domain flow already explained it" are not exceptions — they are exactly the failure this rule exists to prevent.

### Verification Protocol

1. **Always use `--source`** (or `--depth full` with `ask`) for questions about:
   - Business rules and their enforcement
   - Flow steps and their implementation
   - Integration points (RPC, Kafka, Redis)
   - Error handling and edge cases
2. **Cross-check wiki claims**: If wiki says "Method X does Y", read the actual source to confirm.
3. **Flag discrepancies**: If source code contradicts wiki/domain data, report the discrepancy explicitly.
4. **Never trust wiki alone** for: parameter validation logic, error codes, conditional branches, or concurrency controls.
5. **Cite the proof**: Ground every claim in the source you actually read — name the file and the symbol/line range it came from. An answer with no source citation is unverified and must not be presented as fact.

### Red Flags — STOP, you are about to answer without code

- You are about to summarize a flow, rule, or behavior using only `wiki` / `domain` / `business` output.
- "The wiki already explains this clearly." / "The domain flow is detailed enough."
- You are presenting `ask --depth standard` or `--depth quick` output to the user as fact.
- There is no `--source` (or `ask --depth full`) call in this turn, yet you are stating how the code behaves.

**All of these mean: run `--source` / `ask --depth full`, read the code, and cite it before answering.**

### CRITICAL: Agents Must Pass `--depth full` for User-Facing Answers

**The CLI default is `standard`, but agents MUST explicitly pass `--depth full` when answering user-facing questions (not `standard` or `quick`).** The `standard` depth skips source verification and may return unverified wiki/domain claims. Only use `standard`/`quick` for internal exploratory searches where the output is not directly presented to the user as factual.

**Decision table:**
| Scenario | Required Depth |
|----------|---------------|
| Answering a user question | `full` (mandatory) |
| Agent internal exploration | `standard` (acceptable) |
| Quick service/domain check | `quick` (acceptable) |

---

## Execution Mode: Orchestrator vs Worker

This skill is read by two roles. **Decide which you are from an observable signal — *who handed you this task* — and act accordingly. Getting this wrong causes infinite sub-agent nesting.**

| You received the task from… | You are the… | Do this |
|---|---|---|
| The **human user**, directly | **Orchestrator** | Dispatch **one** worker sub-agent (queries are read-only; the user only wants the final result). |
| **Another agent** (you were dispatched) | **Worker** | Run `ua_query.py` **directly**. Do **NOT** invoke the understand-query skill again, and do **NOT** dispatch another sub-agent. |

**The rule that stops the recursion (orchestrator MUST follow):** the worker's dispatch prompt must be self-contained — give it the question (or the exact `ua_query.py` command to run) **plus this explicit instruction:**

> "You are the understand-query **worker**. Run `ua_query.py` directly and return the result. Do NOT call the understand-query skill. Do NOT dispatch any sub-agent."

Without that instruction the worker re-reads this skill, sees "dispatch a worker," and spawns another worker — forever. The stop-condition is keyed on *what your dispatch prompt tells you*, **not** on the unobservable "am I already a sub-agent?" — a freshly dispatched agent cannot tell that on its own.

### Dispatch Instructions (Orchestrator only, cross-platform)

| Platform | Mechanism | Type |
|----------|-----------|------|
| **Cursor** | `Task` tool | `subagent_type: "generalPurpose"` (needs shell for CLI) |
| **Claude Code** | `Agent` tool (sub-agent dispatch) | General-purpose agent with shell access |
| **Codex** | Platform-native sub-agent / task dispatch | Agent with shell access |

### Run inline (no dispatch) when:
- You are the **worker** (see table above) — always run inline.
- The query is a **single trivial command** (e.g., `services --list`) whose result is needed inline.

---

## Golden Rule for Agents (Read FIRST)

For ANY "How does X work?" or "Where is X implemented?" question:

**Option 1 — Single command (recommended):**
```bash
python ua_query.py ask --query "中文关键词,EnglishName,Synonym" --depth full
```

**Option 2 — Manual trace with verification:**
```bash
python ua_query.py trace --service SERVICE --query "中文关键词,EnglishName,Synonym" --source --business --wiki --domain-flows
```

Both approaches search KG, retrieve neighbors, read source code, include business/wiki/domain context, and verify against source. **Option 1 also auto-discovers the service.**

**Multi-service questions?** Run trace once per relevant service:

```bash
python ua_query.py trace --service svc-a --query "keyword" --source --business && \
python ua_query.py trace --service svc-b --query "keyword" --source
```

**Reading many matches at once?** Add `--grouped` to `trace --source` to return source code grouped by file (plus a relationship map between matched nodes) instead of per-node — fewer, denser reads:

```bash
python ua_query.py trace --service SERVICE --query "keyword" --source --grouped
```

### After `ask`/`trace` returns matched nodes — NEVER read those files one at a time

This is the single most common efficiency mistake. The moment a result hands you several files/symbols:

1. **Reuse what you already have.** `ask --depth full` and `trace --source` already include the matched nodes' source (`sourceReads`). Read that first — do **not** re-fetch it with a `source --file`.
2. **Still need more files/symbols than the result included? Fetch them ALL in ONE call** — never a loop of single-file reads:

```bash
# all matches' source, grouped by file, in one call
python ua_query.py trace --service S --query "A,B,C" --source --grouped
# many files / line ranges in one call
python ua_query.py source --service S --file "A.java:20-80,B.java,C.java:1-40"
# many symbols in one call
python ua_query.py structure --service S --symbol "A,B,C" --source
```

> One `source --file` with 5 comma-separated paths is **one** tool call; five separate `source --file` calls are **five** — same result, 5× the cost. If you are about to issue a second single-file read in a row, stop and batch instead.

---

## Agent Efficiency Rules

**Goal: answer in the fewest tool calls AND the fewest tokens.** Efficiency comes first — read *narrowly* (target the methods you need, not whole files) and read *in bulk* (batch the located reads into one call). Then pick the right command and flags.

**Minimize tool calls**

1. **Prefer `ask` for business questions** — one command replaces 5+ individual calls (auto-discover → trace → wiki → domain → source-verify).
2. **Read targeted methods in segments — never dump a whole file.** A `--file` read with no line range pulls the *entire* file into context; that is the expensive default to avoid. Instead, read in segments scoped to the method(s) you actually need: (a) get the cheap method index first — `kg --file F --toc` (no source) or `structure --symbol "name"` (signatures only) — to find the spans, (b) read only those spans by line range, e.g. `source --file "F.java:120-180"` or `structure --symbol "method" --source`. Reach for a full-file read only when the file is small or you genuinely need all of it.
3. **Batch the targeted reads into ONE call — the moment a search/`ask`/`trace` hands you ≥2 files or symbols, your next call reads ALL of them at once.** Once you've located the specific files/symbols/ranges, read them together, not one call each: `source --file "A.java:120-180,B.java:20-80,C.java"` (per-file line ranges; a bad path is isolated as a per-file `error`, the rest still return → `{files:[…]}`) and `structure --symbol "A,B,C" --source` (→ `{symbols:[…]}`). N targeted reads → 1 call. A second single-file read in a row is the signal you should have batched.
4. **Chain mixed commands with `&&`** — when you genuinely need *different* commands, combine them into ONE shell call. Prefer a native batch flag (rule 3) when the calls differ only by file/symbol; `&&` is the fallback for heterogeneous commands.
5. **Expand keywords before trace** — pass 2-4 comma-separated variants in a single `--query "中文,English,CamelCase"`; multi-keyword parallel search eliminates retry loops.

> Requests are sent as POST, so long keyword/file lists and large batches have **no URL-length limit** — batch freely.

**Pick the right command + flags**

6. **Use `--q` for structure fuzzy search** — `structure --q "getUser"` beats iterating `--annotation`/`--param-type` separately.
7. **Use server-side filters** — pass `--type`/`--tag` to `kg --search` and `--type` to `trace` instead of post-filtering client-side; smaller payload, better accuracy.
8. **Paginate large result sets** — `--offset N` with `--limit` instead of fetching everything.

**Output quality**

9. **Use `--format md`** when an agent will read the output (not parse JSON).
10. **Use `--source`** (or `ask --depth full`) for anything presented to the user as factual.
11. **RRF is trace's default fusion** — `trace` applies `fusion=rrf` automatically, no flag needed.

---

## Subcommands

| Subcommand | Purpose | Detail Doc |
|------------|---------|------------|
| `ask` | **Start here for business questions.** Auto-discover → trace → wiki → domain → source-verify | This file |
| `trace` | Search→neighbors→source in one call (with optional wiki/domain/verify/grouped) | [kg-trace.md](docs/kg-trace.md#trace--aggregated-searchneighborssource-recommended-for-agents) |
| `kg` | Source-level KG: classes, calls, RPC, file annotations, file summary | [kg-trace.md](docs/kg-trace.md#kg--knowledge-graph-queries) |
| `structure` | Code structure: signatures, annotations, types, cross-file symbol search + source (`--symbol`, **comma-separate for many symbols in one call**) | [structure-commands.md](docs/structure-commands.md) |
| `source` | Source content: full-text search (`--search`), file read by path/line range (`--file`, **comma-separate to read many files in one call**); `--limit N` caps search results (default 20, max 50) | [source-code.md](docs/source-code.md) |
| `impact` | Server-side BFS impact analysis from a symbol (depth 1–10) | [graph-analysis.md](docs/graph-analysis.md#impact--transitive-impact-analysis) |
| `callers` | Who calls this symbol? (inbound `calls` edges) | [graph-analysis.md](docs/graph-analysis.md#callers--callees--call-graph-navigation) |
| `callees` | What does this symbol call? (outbound `calls` edges) | [graph-analysis.md](docs/graph-analysis.md#callers--callees--call-graph-navigation) |
| `hotspots` | Server-side fan-in/fan-out scoring for critical nodes | [graph-analysis.md](docs/graph-analysis.md#hotspots--code-hotspot-scoring) |
| `affected` | Find test files affected by changes to given source files | [graph-analysis.md](docs/graph-analysis.md#affected--affected-test-discovery) |
| `business` | Business landscape: features, domains, interactions, rules | [business-domain.md](docs/business-domain.md) |
| `wiki` | Wiki pages, architecture, endpoints, flows | [business-domain.md](docs/business-domain.md) |
| `domain` | Domain graph: flows, steps, neighbors | [business-domain.md](docs/business-domain.md) |
| `services` | Service discovery and data layer readiness | [reference.md](docs/reference.md) |
| `meta` | Cross-layer freshness check | [reference.md](docs/reference.md) |

**Global flags** (place before subcommand name):

| Flag | Default | Description |
|------|---------|-------------|
| `--server URL` | `$UNDERSTAND_SERVER` or auto-detect (localhost → fallback IP) | API server base URL |
| `--format json\|md` | `json` | Output format |
| `--verbose` | off | Include extra detail |

---

## Prerequisites

1. **Python 3.10+** required (stdlib only, no external packages).
2. **API Server must be running** (auto-detected at localhost:3001 or configured IP).
3. **Data must be generated** by running relevant skills:

| Skill | Generates |
|-------|-----------|
| `/understand` | Knowledge graph (`kg` layer) + structural analysis |
| `/understand-domain` | Domain graph (`domain` layer) |
| `/understand-wiki` | Wiki + system graph (`wiki`, `services` layer) |
| `/understand-business` | Business landscape (`business` layer) |

---

## `ask` — Business Question Answering (NEW)

**One command to answer business questions end-to-end.** Replaces the manual 5-step workflow.

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--query Q` | string | required | Natural language question (Chinese or English, comma-separated keywords) |
| `--depth LEVEL` | string | `standard` | `quick`=business only, `standard`=+trace+wiki, `full`=+domain+source-verify |
| `--service S` | string | auto | Override auto-discovery |
| `--platform P` | string | none | Platform filter for auto-discovery and business search: `android`, `ios`, `flutter` |
| `--limit N` | int | 5 | Max matched nodes |
| `--fusion MODE` | string | `rrf` | Search fusion strategy |

**Depth levels:**

| Depth | Steps | Use When |
|-------|-------|----------|
| `quick` | Business search only | Quick domain overview |
| `standard` | + KG trace + wiki domain | Internal exploration only — narrow down before a `full` verify; **never a user-facing answer** |
| `full` | + domain flows + source verification + **cross-service RPC follow** | **Answering factual questions (RECOMMENDED)** |

> **Verification scope (read this):** `ask --depth full` reads source only for the nodes it returns (`--limit`, default 5) — it verifies *those*, not every claim you might make. Anything beyond the returned `sourceReads` still needs its own `source --file` / `trace --source` read before you present it as fact.

**Cross-service RPC follow (depth=full):** When the traced service has outbound `consumes_rpc` edges, `ask` automatically identifies the provider service and runs a follow-up trace there. The output includes a `crossServiceTrace` section with the target service's implementation details. This solves the "found the reporter, not the implementer" problem.

**Fallback chain (depth=full):** When KG trace returns no `matchedNodes`, `ask` escalates automatically:
1. `structureFallback` — AST symbol search via `structure --q` keywords extracted from the query
2. `sourceFallback` — when KG and structure are both empty, grep results from source content via `source --search`
3. `traceHint` — troubleshooting hint from trace layer (when KG empty or wrong service)

> **Deprecated:** `structure --grep` still works but prefer `source --search`. With `--format md`, `structureFallback` and `sourceFallback` are rendered as markdown.

**Universal Cross-Service Symbol Resolution:** ALL commands (`trace`, `callers`, `callees`, `impact`) now automatically search other indexed services when a symbol is not found in the specified service. When cross-service resolution occurs, the output includes a `crossServiceOrigin` field indicating the original service, the actual service where the symbol was found, and a user-friendly hint. The commands transparently query the correct service — no manual `--service` switching needed.

**Examples:**

```bash
# Full business question (recommended)
python ua_query.py --format md ask --query "火箭,rocket,RocketReward" --depth full

# Quick domain check
python ua_query.py ask --query "亲密度,intimacy" --depth quick

# Override service
python ua_query.py ask --query "家族,Family" --service ultron-relation --depth standard

# Cross-platform (Android client)
python ua_query.py ask --query "PK对战,PKBattle" --platform android --depth full
```

---

## Layered Drill-Down Model

Each layer is progressively more complete but less semantically rich. Use the upper layers (L1–L4) to **locate** a concept; you have not **answered** until you descend to L5/L6 source and confirm there. Escalate top→bottom until you locate it, then drill to source to verify. This is the single canonical layer reference (the Query Escalation Protocol below reuses it).

| Layer | Command | Answers / Searches | Reliability |
|-------|---------|--------------------|-------------|
| L1. Business | `business --search "keyword" [--platform P]` | Features/domains/flows that match; which services own them | LLM-generated, highest abstraction |
| L2. Wiki | `wiki --search "keyword"` | Technical domain docs, service associations | LLM-generated, detailed text |
| L3. Domain Graph | `domain --service S --search "keyword"` / `--flows` | Flow structure, relationships, step detail | LLM-generated, structured |
| L4. Source-Level KG | `ask --query "keyword" --depth full` / `trace --source` | Class relationships, summaries, neighbors | LLM-analyzed code symbols |
| L5a. Structure (symbols) | `structure --service S --q "keyword"` | AST class/method/file names | **Always complete (deterministic)** |
| L5b. Source Search | `source --service S --search "keyword"` | Full source content (config, comments, literals) | **Always complete, includes config/YAML** |
| L6. File | `source --service S --file PATH` / `structure --service S --file PATH --source` | Ground-truth source lines | **Ground truth** |

---

## Agent Decision Tree

### Query Paths by Goal

| Path | When | Start With |
|------|------|------------|
| Business Understanding | "What is X?" "Complete flow of X?" | `ask --depth full` |
| Feature Location | "Where is X implemented?" | `trace --auto-discover --query "X" --source` |
| Symbol + Source | "Show me the code for createOrder" | `structure --symbol createOrder --source` |
| Bug Investigation | "API returns wrong data" | `wiki --type endpoint` → `kg --neighbors` → `trace --source` |
| Impact Analysis | "What will changing X break?" | `impact --symbol X --direction inbound --depth 3` → `callers` / `structure --property-type X` |
| Call Graph | "Who calls X?" / "What does X call?" | `callers --symbol X` or `callees --symbol X` |
| Code Hotspots | "What are the most critical classes?" | `hotspots --type class --limit 20` |
| Test Impact | "Which tests break if I change these files?" | `affected --files path1,path2` |
| Cross-Platform | "Client/server don't sync" | `business --features` → `business --domain X --type interactions` → `trace` per service |
| Architecture | "How is system structured?" | `wiki --architecture` → `services --list` |
| Data Quality | "Is KB data reliable?" | `meta --stale` |
| Code-Level Detail | "Find all @X annotations" | `structure --annotation X` |

---

## Troubleshooting: Empty Results & Errors

When a command returns empty or unexpected results, follow the fallback chain:

| Symptom | Likely Cause | Fallback |
|---------|-------------|----------|
| `trace` returns empty `matchedNodes` | Keywords don't match KG node names | 1. Add more keyword variants (Chinese + English + abbreviation) 2. Try `--fusion none` for pure text search 3. `domain --service S --search "keyword"` or `--flows` then extract English keywords and retry 4. `source --service S --search "keyword"` for full-text source search |
| `ask` returns "No service discovered" | Keywords too vague or service has no data layers | 1. Run `services --list` to see available services 2. Try `business --search "keyword"` to find the domain first 3. Specify `--service` manually |
| `structure --symbol X` returns empty | Symbol name doesn't match exactly | 1. Try `structure --q "X"` for fuzzy search 2. Try `structure --annotation X` if it might be an annotation 3. Try `kg --service S --search "X"` to find the node first |
| `kg --neighbors X` returns "node not found" | Node name is wrong or not in KG | 1. Run `kg --service S --search "X"` to find exact name 2. Check "Did you mean" suggestions in error output 3. Try partial name match |
| `impact` / `callers` / `callees` returns empty | Symbol exists but has no edges in specified direction | 1. Try `--direction both` 2. Try without `--edge-type` filter 3. Check if symbol is in the KG: `kg --service S --search "X"` |
| `business --domain X` returns 404 | Domain not indexed or merged into broader domain | 1. `business --search "keyword"` for global search 2. Follow **Query Escalation Protocol** below 3. Try `business --features` to see exact names |
| `wiki --service S --domain D` returns 404 | Domain not indexed for this service | 1. Run `wiki --service S` to see available domains 2. Try `wiki --search "D"` across all services |
| `trace --auto-discover` picks wrong service | Ambiguous keywords match multiple services | 1. Use `ask --service S --query "..."` to override 2. Add more specific keywords (e.g., include class name) |
| API server unreachable (exit 2) | Server not running | Report to user: "Start the API server with `pnpm run serve`". Do NOT attempt auto-start. |
| `meta --stale` shows stale layers | Data out of sync with code | Recommend user run the corresponding `/understand-*` skill to regenerate stale layers. |

**General recovery pattern:**
1. **Broaden search**: Add keyword variants, remove filters, increase `--limit`
2. **Narrow scope**: Specify `--service`, use `--path` to filter by file path
3. **Change approach**: If `trace` fails, try `kg --search` → `kg --neighbors` manually
4. **Verify data exists**: `services --list` + `meta --stale` before blaming the query

---

## Query Escalation Protocol (Concept Not Found)

When a user asks about a concept that has **no direct domain/feature match** (e.g., wiki didn't generate a separate domain for it, or it's merged into a broader domain), agents MUST escalate through the layers of the [Layered Drill-Down Model](#layered-drill-down-model) above — L1 (Business) → L6 (File) — stopping at the first layer that **locates** the concept. **Locating is not answering:** once located, drill down to L5b/L6 source and verify before presenting any factual claim (see [Source Verification Rule](#source-verification-rule-mandatory)). The lower layers (L5a/L5b/L6) are deterministic and always complete, so a concept that genuinely exists in source will always surface there.

### Agent Decision Logic

```
Concept X — example "PK对战在Android上怎么实现的". Stop at the first layer that LOCATES it, then verify against source before answering:

L1  business --search "PK" --platform android                    → follow wikiRef
L2  wiki --search "PK"                                            → read wiki domain detail
L3  domain --service android-app --flows                         → matching flow? → --flow "PK对战" --steps
L3b domain --service android-app --search "PK"                    → flow/node match? → --flow / --steps
L4  ask --query "PK对战,PK,PKBattle" --depth full                 → matchedNodes / structureFallback / sourceFallback
L5a structure --service android-app --q "PK"                      → pick file → structure --file PATH --source
L5b source --service android-app --search "PK" [--path "*.yml"]   → read matched chunk (bodies/config/comments)
L6  structure --service android-app --files                      → grep path "pk" → explore file-by-file

None matched → report "Concept not found in any indexed layer of this service" (suggest another service / broader keywords).
```

### Keyword Extraction Rules

| Query Type | Example | Extracted Keywords |
|-----------|---------|-------------------|
| Chinese + ASCII | "PK对战" | `PK`, `pk`, `PKBattle` |
| Pure Chinese | "房间管理" | `room`, `Room`, `RoomManager` |
| English | "gift animation" | `gift`, `GiftAnimation`, `gift_anim` |
| Class-style | "OrderService" | `OrderService`, `order` |

**Rule:** Always provide 2-4 comma-separated keyword variants covering: original, English translation, CamelCase, and abbreviation.

### Why Structure is the Ultimate Fallback

- **Business/Wiki/Domain** are high-level summaries — intentionally omit details, may miss concepts
- **KG** is generated by LLM analysis — may have gaps if analysis was incomplete
- **Structure `--q`** searches AST-parsed symbol names (class, function, annotation names) — deterministic and complete for code symbols
- **`source --search`** searches actual source content via MiniSearch (AST-boundary chunked) — finds anything in source including config values, comments, and function bodies
- If `source --search "PK"` returns nothing, the concept genuinely does not exist in that service's codebase

### `--q` vs `source --search` Decision

| Use `--q` when | Use `source --search` when |
|----------------|---------------------------|
| Searching for a class/function/annotation NAME | Searching for content INSIDE functions |
| Know the symbol name or part of it | Looking for a string literal, config value, or comment |
| Fast metadata-only search | Need full source content search |
| Example: `--q "PKBattleManager"` | Example: `source --search "timeout" --path "*.yml"` |

### Cross-Service Infrastructure Search

For system-wide queries like "所有用到Redis的地方" or "哪些服务有Kafka消费者":

1. Discover all services: `services --has kg`
2. Search each in ONE shell call, chained with `&&`: `source --service svc-a --search "Redis" --limit 20 && source --service svc-b --search "Redis" --limit 20` (batch the services into one call, not one call each).
3. Aggregate results across services.

**Note:** `ask --depth full` only targets ONE service. For infrastructure concerns that span all services, you MUST manually iterate.

---

## Server Configuration

The CLI uses `http://172.18.228.71:3001` as the default API server.

- Override with `UNDERSTAND_SERVER` environment variable or `--server` flag.
- If the server is unreachable, the CLI exits with code 2 and prints startup instructions.
- The agent should NOT attempt to auto-start the server — report the error to the user.
- The CLI sends **all** requests via HTTP POST (JSON body); the server accepts both GET and POST on every route. This removes URL-length limits and query-string encoding edge cases.

---

## Token Budget Guide

| Operation | ~Tokens | Recommendation |
|-----------|---------|----------------|
| `ask --depth quick` | 200–500 | Always safe |
| `ask --depth standard` | 1000–3000 | Internal exploration only |
| `ask --depth full` | 3000–8000 | **Required for user-facing answers** |
| `trace --source --business` | 1500–4000 | Primary exploration |
| `services --list` | 200 | Always safe |
| `business --search Q` | 300 | Prefer over `--list` |
| `business --features` | 300–800 | Feature-centric overview (client-server projects) |
| `kg --neighbors X` (depth=1) | 500–1500 | Primary traversal |
| `impact --depth 3` | 800–3000 | Transitive impact (prefer over manual BFS) |
| `callers` / `callees` (depth=1) | 300–800 | Direct call graph |
| `hotspots --limit 20` | 500–2000 | Service-wide critical nodes |
| `structure --symbol X` | 200–1000 | Symbol metadata only |
| `structure --symbol X --source` | 500–5000 | Symbol + source code (varies by match count) |
| `source --search "keyword"` | 300–2000 | Source content search (snippet results) |
| `kg` full graph (no filter) | 5000–50000 | **AVOID** |

---

## Quick-Reference: Common Agent Questions

Agents receiving natural-language questions (Chinese or English) can map directly to commands:

| User Question Pattern | Recommended Command | Notes |
|----------------------|---------------------|-------|
| **Business & Discovery** |||
| "What is X?" / "X是什么功能？" | `ask --query "X,EnglishName" --depth full` | Auto-discovers service + full trace; check `structureFallback` / `sourceFallback` if no KG hits |
| "Complete flow of X?" / "X的完整流程？" | `ask --query "X,FlowEnglish" --depth full` | Includes domain flow steps |
| "Business rules for X?" / "X的业务规则？" | `business --domain X --type rules` → then `trace --source` | Business rule query — **wiki-level; verify each rule against source before presenting** |
| "How do users interact with X?" / "X的用户交互？" | `business --domain X --type interactions` → then `trace --source` | User interaction steps — **wiki-level; confirm against source before presenting** |
| "Business landscape overview" / "业务全景？" | `business --panorama` | All facets and services |
| "What features exist?" / "有哪些业务功能？" | `business --features` | Feature-centric view with server associations (client-server projects) |
| "What services exist?" / "有哪些服务？" | `services --list` | Service discovery + data layer readiness |
| **Code Location & Source** |||
| "Where is X implemented?" / "X在哪里实现？" | `trace --auto-discover --query "X,English" --source` | Auto-locates service + source; empty? try `source --search` |
| "Concept not in KG?" / "KG搜不到X？" | `ask --query "X" --depth full` | Returns `structureFallback`, `sourceFallback`, or `traceHint` automatically |
| "Show me code for X" / "X方法的源码" | `structure --service S --symbol X --source` | Precise symbol + source |
| "Show me code for X, Y, Z" / "X、Y、Z的源码" | `structure --service S --symbol "X,Y,Z" --source` | **Batch — many symbols in ONE call** → `{symbols:[…]}` (prefer over one call each) |
| "Read file F" / "读取文件F" | `kg --service S --file F` | Full file content — **for large files prefer `--toc` then a line range** (see Efficiency rule 2) |
| "Read lines 100-200 of F" / "读F的100-200行" | `kg --service S --file F --start 100 --end 200` | Line range read (preferred over full-file reads) |
| "Methods in file F" / "文件F有哪些方法？" | `kg --service S --file F --toc` | Method index (cheap, no source) — **run this first, then read targeted ranges** |
| "File overview for F" / "文件F概览？" | `kg --service S --file F --summary` | Symbols, imports, callers, blast radius |
| "Methods with validate in name?" / "带validate的方法？" | `structure --service S --q "validate"` | Fuzzy name search |
| "Search source for timeout" / "源码中搜索timeout" | `source --service S --search "timeout"` | Full-text content search (replaces `structure --grep`) |
| "Config timeout value?" / "配置中的超时设置？" | `source --service S --search "timeout" --path "*.yml"` | Config file content search |
| "Read source file by path" / "按路径读源码" | `source --service S --file PATH [--start N --end M]` | Read source code by path and line range |
| "Read several files at once" / "一次读多个文件" | `source --service S --file "A.java:1-60,B.java,C.java"` | **Batch — many files in ONE call**, optional per-file line ranges, failed paths isolated → `{files:[…]}` (prefer over one call each) |
| **Structure & Type Analysis** |||
| "Who implements interface IX?" / "哪些类实现了IX？" | `structure --service S --implementors IX` | Interface implementation search |
| "All classes with @X annotation" / "所有@X注解的类" | `structure --service S --annotation X` | Annotation batch search |
| "Who injects X class?" / "谁注入了X类？" | `structure --service S --property-type X` | Dependency injection analysis |
| "Inheritance chain of X" / "X的继承链" | `structure --service S --chain X --direction up` | Trace superclass hierarchy |
| "All subclasses of X" / "X的子类" | `structure --service S --chain X --direction down` | Descendant enumeration |
| "RPC contract for X?" / "RPC接口的参数和返回值？" | `structure --service S --annotation MoaProvider --path X` | RPC contract inspection |
| "Which classes use OrderDTO?" / "谁用了OrderDTO？" | `structure --service S --param-type OrderDTO` + `--return-type OrderDTO` | Type usage across codebase |
| **Dependency & Impact** |||
| "What breaks if I change X?" / "改X会影响什么？" | `impact --service S --symbol X --depth 3 --direction inbound` | Transitive impact analysis |
| "Who calls X?" / "谁调用了X？" | `callers --service S --symbol X --depth 2` | Inbound call graph |
| "What does X call?" / "X调用了谁？" | `callees --service S --symbol X --depth 2` | Outbound call graph |
| "Which tests for changed files?" / "改了要跑哪些测试？" | `affected --service S --files src/X.java,src/Y.java --depth 2` | Affected test discovery — **batch all changed files in one call** |
| "Most critical classes?" / "最关键的类？" | `hotspots --service S --type class --limit 20` | Fan-in/fan-out hotspot scoring |
| "Blast radius of X?" / "X的影响半径？" | `trace --service S --query X` → check `blastRadius` → `impact --service S --symbol X --depth 3` | Quick triage + transitive |
| **Cross-Service & Wiki** |||
| "How do X and Y interact?" / "X和Y怎么交互？" | `trace` in svc-a + `trace` in svc-b | Dual-service comparison |
| "Architecture overview" / "系统架构？" | `wiki --architecture` | System architecture wiki |
| "Endpoints for service S" / "S有哪些接口？" | `wiki --service S --type endpoint` | API endpoint documentation |
| "Domain flow steps" / "X流程的步骤？" | `domain --service S --flow F --steps` → then `trace --source` | Ordered flow steps — **domain-level; confirm against source before presenting** |
| "Related domains for X" / "X的相关领域？" | `wiki --service S --domain X --related` | Cross-service related domains |
| **Data & Freshness** |||
| "Is data stale?" / "数据是否过期？" | `meta --stale` | Stale layer detection |
| "KG layers for service S" / "S有哪些数据层？" | `services --name S` | Per-layer readiness |
| "Guided tour of service S" / "S的引导式探索？" | `kg --service S --tour` | Guided exploration steps |
| "Package/module structure" / "S的模块结构？" | `kg --service S --layers` | Layer summary |

**Keyword expansion:** Always expand non-English queries to comma-separated variants (original + English + CamelCase) — see [Keyword Extraction Rules](#keyword-extraction-rules) above for the full pattern. Multi-keyword parallel search eliminates retry loops. Example: "亲密度" → `--query "亲密度,intimacy,IntimacyService"`.

---

### Unsupported Query Types

The following queries CANNOT be answered by this skill system — report the limitation and suggest the alternative:

| Query Type | Example | Why | Alternative |
|------------|---------|-----|-------------|
| Temporal/历史 | "PK功能最近改了什么" | Git history not indexed | Use `git log --all --grep="PK"` directly |
| Blame/归属 | "这段代码谁写的" | No blame data | Use `git blame path/to/file` |
| PR/Review | "这个改动的review意见" | No PR data | Use GitHub/GitLab CLI |
| Runtime/运行时 | "这个接口的QPS" | No monitoring data | Use Hubble/Prometheus |
| Diff/变更 | "上次发布改了哪些" | No release tracking | Use `git diff tag1..tag2` |

---

## Detail Documentation

- **[Source-Level Queries](docs/source-code.md)** — strategy overview, query paths, and combination recipes
- **[KG & Trace](docs/kg-trace.md)** — `kg`, `trace`, file reading patterns
- **[Graph Analysis](docs/graph-analysis.md)** — `impact`, `callers`, `callees`, `hotspots`, `affected`
- **[Structure](docs/structure-commands.md)** — `structure` (annotations, types, symbol search + source)
- **[Business & Domain Queries](docs/business-domain.md)** — `business`, `wiki`, `domain`, cross-platform recipe
- **[Technical Reference](docs/reference.md)** — `services`, `meta`, search algorithm, error handling

---

## Integration with Agent Workflow

**Typical agent patterns:**

1. **Business question:** `ask --depth full` → synthesize → present to user
2. **Code change:** `trace --source` → confirm implementation → edit files
3. **Impact check:** `impact --symbol X --direction inbound` + `affected --files` → assess risk and test scope
4. **Freshness gate:** `meta --stale` → decide if data is trustworthy
5. **Cross-reference:** Check `sourceReads` output before modifying domain logic

**Related skills:**

| Skill | When to run instead of query |
|-------|------------------------------|
| `/understand` | Regenerate stale kg layer |
| `/understand-domain` | Regenerate domain graph |
| `/understand-wiki` | Regenerate wiki and system graph |
| `/understand-business` | Regenerate business landscape |
| `/understand-dashboard` | Visual exploration when CLI output is insufficient |
