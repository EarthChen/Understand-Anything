# /understand-wiki Implementation Plan

Based on: `docs/superpowers/specs/2026-06-03-understand-wiki-design.md`

## Dependency Graph

```
Step 1 (Wiki Schema) ─────────┬──→ Step 3 (wiki-worker) ──┐
                               │                            ├──→ Step 5 (Skill Phase 0+1+QG)
Step 2 (RPC Annotations) ─────┤──→ Step 4 (wiki-reviewer) ─┘           │
                               │                                        │
                               └──→ Step 6 (Cross-service Script) ──→ Step 7 (Skill Phase 2+3)
                                                                        │
                                                                        └──→ Step 8 (Search)
```

---

## Step 1 — Wiki Data Schema Definition

**Goal:** Define the JSON schema for wiki output files (meta.json, index.json, service.json, domains/*.json)

**Files to create/modify:**
- `packages/core/src/types.ts` — Add `WikiArticle`, `WikiIndex`, `WikiMeta` types
- `packages/core/src/wiki-schema.ts` — JSON Schema for validation (used by Quality Gate Layer 1)

**Deliverable:** TypeScript types + JSON Schema that wiki-worker and Quality Gate can reference

**Verify:** Types compile, schema validates sample data

---

## Step 2 — file-analyzer RPC Annotation Enhancement

**Goal:** Let file-analyzer recognize RPC annotations (MOA/Dubbo) and generate structured `provides_rpc` / `consumes_rpc` edges

**Files to modify:**
- `packages/core/src/types.ts` — Add `provides_rpc`, `consumes_rpc` to valid edge types
- `agents/file-analyzer.md` — Add RPC annotation detection instructions
- `skills/understand/frameworks/spring.md` — Add MOA/Dubbo annotation patterns
- `agents/graph-reviewer.md` — Add `provides_rpc`, `consumes_rpc` to valid edge type list
- Config schema — Document `rpcAnnotations` field

**Deliverable:** Updated file-analyzer that generates RPC edges when `rpcAnnotations` is configured

**Verify:** 
- Run `/understand` on a service with MOA annotations → KG contains `provides_rpc`/`consumes_rpc` edges
- Without config → behavior unchanged (backward compat)

---

## Step 3 — wiki-worker Agent Definition

**Goal:** Create agent that generates complete Wiki for a single service

**Files to create:**
- `agents/wiki-worker.md` — Agent prompt defining role, input, two-round expansion strategy, output format

**Key design points:**
- Input: service's KG + DG + source code access + outputLanguage
- Round 1: Generate skeleton from domain-graph + KG structure
- Round 2: Locate key source via KG edges → expand with detail
- Large service handling: batch 2-3 domains when > 5
- Output: files to `{service}/.understand-anything/wiki/`

**Verify:** Manual dispatch of wiki-worker on a test service produces valid Wiki files matching schema from Step 1

---

## Step 4 — wiki-reviewer Agent Definition

**Goal:** Create agent that reviews Wiki quality independently

**Files to create:**
- `agents/wiki-reviewer.md` — Agent prompt defining review dimensions, input format, output format

**Key design points:**
- Input: wiki pages + corresponding source code snippets
- Review: accuracy, completeness, readability
- Output: pass/warn/fail per page + issues + suggestions
- Feedback format compatible with wiki-worker retry

**Verify:** Manual dispatch on sample Wiki pages produces structured review report

---

## Step 5 — /understand-wiki Skill: Phase 0 + Phase 1 + Quality Gate

**Goal:** Create the main skill with single-service and batch modes, covering generation pipeline

**Files to create:**
- `skills/understand-wiki/SKILL.md` — Full skill definition (Phase 0, Phase 1, Quality Gate)

**Key design points:**
- Argument parsing: `--service`, `--review`, `--full`
- Phase 0: Service detection, prerequisite checking, wiki state checking
- Phase 1: Dispatch wiki-worker (1 for single, N parallel for batch)
- Quality Gate Layer 1: Schema validation, coverage check, reference check, non-empty check
- Quality Gate Layer 2: Optional wiki-reviewer dispatch (when `--review`)
- Progress reporting: Phase transitions, batch progress
- Error handling: Per-service failure isolation

**Verify:**
- Single service mode: `cd service-a && /understand-wiki` generates Wiki
- Quality Gate catches invalid output
- `--review` triggers wiki-reviewer

---

## Step 6 — Cross-service Relationship Identification Script

**Goal:** Create the deterministic matching script for Phase 2's Layer 1

**Files to create:**
- `skills/understand-wiki/cross-service-matcher.py` — Script that reads multiple KG files and matches RPC relationships

**Key design points:**
- Read all "已接入" services' KG files
- Match `consumes_rpc` edges from service A → find matching `provides_rpc` in service B
- Also match: Kafka topic publishes/subscribes, shared table access
- Output: JSON list of candidate cross-service relationships with evidence

**Verify:** Run on test multi-service setup → outputs correct RPC call matches

---

## Step 7 — /understand-wiki Skill: Phase 2 + Phase 3

**Goal:** Complete the skill with parent-level orchestration page generation and index building

**Files to modify:**
- `skills/understand-wiki/SKILL.md` — Add Phase 2 and Phase 3 instructions

**Key design points:**
- Phase 2 Layer 1: Run cross-service-matcher.py
- Phase 2 Layer 2: LLM verify + discover + organize (always execute)
- Phase 2 output: overview.json, architecture.json, domains/*.json
- Phase 3: Build parent index.json + update service index files
- Parent directory detection and setup

**Verify:**
- After 2+ services are "接入", run `/understand-wiki` → parent Wiki generated with cross-service flows
- Adding a new service → parent Wiki updated with new relationships

---

## Step 8 — Wiki Search Extension

**Goal:** Extend SearchEngine to cover Wiki content

**Files to modify:**
- `packages/core/src/search.ts` — Add wiki content field to Fuse.js config
- Wiki data loading logic — Include article nodes in search index

**Key design points:**
- Add `knowledgeMeta.content` to Fuse.js search keys
- Results include service and category metadata
- Compatible with existing SearchBar component

**Verify:** Search for business terms → returns relevant Wiki pages

---

## Implementation Order (Recommended)

| Phase | Steps | Parallelizable | Estimated Effort |
|---|---|---|---|
| Foundation | Step 1 + Step 2 | Yes (parallel) | Medium |
| Agents | Step 3 + Step 4 | Yes (parallel) | Medium |
| Core Skill | Step 5 | Sequential (depends on 1,3,4) | Large |
| Cross-service | Step 6 + Step 7 | Sequential | Medium-Large |
| Search | Step 8 | Independent after Step 1 | Small |

## First Deliverable (Vertical Slice)

For fastest feedback: Step 1 → Step 3 → Step 5 (without Quality Gate Layer 2 and without batch mode).

This produces a working `/understand-wiki` that can generate Wiki for a single service. Team can validate quality before investing in cross-service features.

---

*Status: PLAN — ready for execution.*
