---
name: understand-query
description: Query the Understand-Anything knowledge base via CLI. Seven-layer drill-down from services to source code, backed by the shared API server.
argument-hint: ["<subcommand> [--server URL] [--format json|md] [--verbose] [subcommand-flags...]"]
---

# /understand-query

Query codebase knowledge through a lightweight CLI (`ua_query.py`) backed by the shared Understand-Anything API server. Use eight progressive layers — from service discovery and business landscape down to source-verified code — to answer questions without loading entire graphs into context.

## Source Verification Rule (MANDATORY)

**For any question about business logic, flows, or implementation details, the agent MUST verify answers against actual source code.** Wiki and domain graph data may be stale — source code is the ground truth.

### Verification Protocol

1. **Always use `--verify-source`** (or `--depth full` with `ask`) for questions about:
   - Business rules and their enforcement
   - Flow steps and their implementation
   - Integration points (RPC, Kafka, Redis)
   - Error handling and edge cases
2. **Cross-check wiki claims**: If wiki says "Method X does Y", read the actual source to confirm.
3. **Flag discrepancies**: If source code contradicts wiki/domain data, report the discrepancy explicitly.
4. **Never trust wiki alone** for: parameter validation logic, error codes, conditional branches, or concurrency controls.

---

## Execution Mode: Sub-Agent (Default)

**This skill MUST be delegated to a sub-agent by default.** All understand-query operations are read-only exploration and lookup tasks — the caller only cares about the final result, not the intermediate process.

### Dispatch Instructions (Cross-Platform)

| Platform | Mechanism | Type |
|----------|-----------|------|
| **Cursor** | `Task` tool | `subagent_type: "generalPurpose"` (needs shell for CLI) |
| **Claude Code** | `dispatch_agent` / `Task` tool | General-purpose agent with shell access |
| **Codex** | Platform-native sub-agent / task dispatch | Agent with shell access |

### Intent Classification + Sub-Agent Templates

Before dispatching, classify the user's question into one of these intents and use the corresponding template:

#### Intent A: Business Function Understanding
**Trigger:** "X是什么功能？", "X的完整流程是什么？", "How does X work?"

```
You are executing an understand-query skill task.

**User Question:** <the actual question>
**Project Directory:** <path>
**CLI Path:** <path to ua_query.py>
**API Server:** http://172.18.228.71:3001 (default). If unreachable, report to user and stop.

Execute this single command:
python ua_query.py --format md ask --query "<expanded keywords>" --depth full

The `ask` command auto-discovers the service, traces KG, fetches wiki, domain flows,
and verifies source code — all in one call.

IMPORTANT: Review the sourceVerification section in the output. If source code contradicts
wiki/domain descriptions, explicitly note the discrepancy in your answer.

Return a structured Chinese summary with: 业务概述、完整流程、关键实体、业务规则、源码校验结果。
```

#### Intent B: Code Location / Implementation
**Trigger:** "X在哪里实现？", "Where is X implemented?", "Find the code for X"

```
You are executing an understand-query skill task.

**User Question:** <the actual question>
**CLI Path:** <path to ua_query.py>

Execute:
python ua_query.py --format md trace --service <SERVICE> --query "<keywords>" --source --business --verify-source

If service is unknown, add --auto-discover and omit --service.

Return: file paths, class names, method signatures, and key source excerpts.
```

#### Intent C: Impact Analysis
**Trigger:** "修改X会影响什么？", "What breaks if I change X?"

```
Execute in sequence:
1. python ua_query.py trace --service S --query "X" --source --business
2. python ua_query.py kg --service S --neighbors <top_match_id> --direction inbound
3. python ua_query.py structure --service S --property-type <ClassName>

Return: dependency graph, affected callers, and risk assessment.
```

#### Intent D: Cross-Service Investigation
**Trigger:** "X和Y服务之间怎么交互？", "Cross-service flow for X"

```
Execute:
1. python ua_query.py business --panorama
2. python ua_query.py trace --service svc-a --query "X" --source --business
3. python ua_query.py trace --service svc-b --query "X" --source

Return: interaction points, RPC contracts, event flows between services.
```

### When NOT to Use Sub-Agent

Skip sub-agent dispatch only when:
- The parent agent is **already inside a sub-agent** (avoid nesting).
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
python ua_query.py trace --service SERVICE --query "中文关键词,EnglishName,Synonym" --source --business --wiki --domain-flows --verify-source
```

Both approaches search KG, retrieve neighbors, read source code, include business/wiki/domain context, and verify against source. **Option 1 also auto-discovers the service.**

**Multi-service questions?** Run trace once per relevant service:

```bash
python ua_query.py trace --service svc-a --query "keyword" --source --business --verify-source && \
python ua_query.py trace --service svc-b --query "keyword" --source --verify-source
```

---

## Agent Efficiency Rules

1. **Prefer `ask` for business questions**: One command replaces 5+ individual calls.
2. **Batch CLI calls**: Combine multiple CLI commands into ONE Shell call using `&&`.
3. **Expand keywords before trace**: Always provide 2-4 comma-separated variants (original + English + synonym).
4. **Use `--format md`** when the output will be read by an agent (not parsed as JSON).
5. **Use `--verify-source`** for any answer that will be presented as factual to the user.
6. **RRF is default for trace** — `trace` uses `fusion=rrf` automatically.

---

## Subcommands

| Subcommand | Purpose | Detail Doc |
|------------|---------|------------|
| `ask` | **NEW: Start here for business questions.** Auto-discover → trace → wiki → domain → source-verify | This file |
| `trace` | Search→neighbors→source in one call (with optional wiki/domain/verify) | [source-code.md](docs/source-code.md) |
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
| `--limit N` | int | 5 | Max matched nodes |
| `--fusion MODE` | string | `rrf` | Search fusion strategy |

**Depth levels:**

| Depth | Steps | Use When |
|-------|-------|----------|
| `quick` | Business search only | Quick domain overview |
| `standard` | + KG trace + wiki domain | Understanding a feature |
| `full` | + domain flows + source verification | **Answering factual questions (RECOMMENDED)** |

**Examples:**

```bash
# Full business question (recommended)
python ua_query.py --format md ask --query "火箭,rocket,RocketReward" --depth full

# Quick domain check
python ua_query.py ask --query "亲密度,intimacy" --depth quick

# Override service
python ua_query.py ask --query "家族,Family" --service ultron-relation --depth standard
```

---

## Updated `trace` Flags

New flags added to `trace` for richer context:

| Flag | Description |
|------|-------------|
| `--wiki` | Include wiki domain detail for matched feature |
| `--domain-flows` | Include domain flow steps |
| `--verify-source` | Force source code read for top 3 matches to cross-check wiki/domain |
| `--auto-discover` | Auto-detect service via business+wiki+KG search (omit `--service`) |

**Full trace example:**

```bash
python ua_query.py trace --auto-discover --query "火箭,rocket" --source --business --wiki --domain-flows --verify-source --format md
```

---

## Eight-Layer Drill-Down Model

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
| **NEW** 8. Source Verify | `trace --verify-source` / `ask --depth full` | Cross-check wiki/domain against live source code |

---

## Agent Decision Tree

### Query Paths by Goal

| Path | When | Start With |
|------|------|------------|
| Business Understanding | "What is X?" "Complete flow of X?" | `ask --depth full` |
| Feature Location | "Where is X implemented?" | `trace --auto-discover --query "X" --source --verify-source` |
| Bug Investigation | "API returns wrong data" | `wiki --type endpoint` → `kg --neighbors` → `trace --verify-source` |
| Impact Analysis | "What will changing X break?" | `kg --neighbors X --direction inbound` + `structure --property-type X` |
| Cross-Platform | "Client/server don't sync" | `business --panorama` → `trace` per service |
| Architecture | "How is system structured?" | `wiki --architecture` → `services --list` |
| Data Quality | "Is KB data reliable?" | `meta --stale` |
| Code-Level Detail | "Find all @X annotations" | `structure --annotation X` |

---

## Server Configuration

The CLI uses `http://172.18.228.71:3001` as the default API server.

- Override with `UNDERSTAND_SERVER` environment variable or `--server` flag.
- If the server is unreachable, the CLI exits with code 2 and prints startup instructions.
- The agent should NOT attempt to auto-start the server — report the error to the user.

---

## Token Budget Guide

| Operation | ~Tokens | Recommendation |
|-----------|---------|----------------|
| `ask --depth quick` | 200–500 | Always safe |
| `ask --depth standard` | 1000–3000 | Default for business questions |
| `ask --depth full` | 3000–8000 | Use for verified answers |
| `trace --source --business` | 1500–4000 | Primary exploration |
| `services --list` | 200 | Always safe |
| `business --search Q` | 300 | Prefer over `--list` |
| `kg --neighbors X` (depth=1) | 500–1500 | Primary traversal |
| `kg` full graph (no filter) | 5000–50000 | **AVOID** |

---

## Combination Recipes (Reduce Tool Calls)

| Scenario | Calls | Recipe |
|----------|-------|--------|
| "What is X business function?" | **1** | `ask --query "X,英文" --depth full` |
| "How does X work?" | **1** | `trace --auto-discover --query "X" --source --business --wiki --verify-source` |
| "Find RPC endpoints + types" | 2 | `structure --annotation` → `kg --edges --type consumes_rpc` |
| "Impact of changing X" | 2 | `kg --neighbors X --direction both` → `structure --property-type X` |
| "Cross-service dep" | 3 | `business --panorama` → `trace` in source svc → `trace` in target svc |

---

## Detail Documentation

- **[Source-Level Queries](docs/source-code.md)** — `kg`, `trace`, `structure`, `kg --file` TOC pattern
- **[Business & Domain Queries](docs/business-domain.md)** — `business`, `wiki`, `domain`, cross-platform recipe
- **[Technical Reference](docs/reference.md)** — `services`, `meta`, search algorithm, error handling

---

## Integration with Agent Workflow

**Typical agent patterns:**

1. **Business question:** `ask --depth full` → synthesize → present to user
2. **Code change:** `trace --verify-source` → confirm implementation → edit files
3. **Impact check:** `kg --neighbors` + `structure --property-type` → assess risk
4. **Freshness gate:** `meta --stale` → decide if data is trustworthy
5. **Cross-reference:** Check `sourceVerification` output before modifying domain logic

**Related skills:**

| Skill | When to run instead of query |
|-------|------------------------------|
| `/understand` | Regenerate stale kg layer |
| `/understand-domain` | Regenerate domain graph |
| `/understand-wiki` | Regenerate wiki and system graph |
| `/understand-business` | Regenerate business landscape |
| `/understand-dashboard` | Visual exploration when CLI output is insufficient |
