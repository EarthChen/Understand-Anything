# Wiki Worker Per-Domain Split Design

**Date:** 2026-06-04
**Status:** Proposed
**Scope:** `understand-anything-plugin/skills/understand-wiki/` + `understand-anything-plugin/skills/understand-wiki/docs/wiki-phase1-generation.md`

---

## Problem

In Full mode, `wiki-worker` receives the **entire** KG (potentially 100k+ tokens) plus the full DG as a single prompt, then serially processes all domains (skeleton + source-grounded expansion). For large services (>1000 KG nodes, >5 domains), this causes:

1. **Context overflow / timeout**: The agent may exceed 5-minute limits (observed in Codex environments)
2. **No parallelism**: All domain pages are generated serially within one agent
3. **Blast radius**: A single failure requires regenerating everything

Meanwhile, **Incremental mode already solves this**: it dispatches per-domain `wiki-worker` agents with `wiki_kg_filter.py` (max 200 nodes) and `$TARGET_DOMAIN`. Full mode simply doesn't use this pattern.

## Solution

Unify Full mode with Incremental mode's dispatch strategy: every domain gets its own `wiki-worker` (single-domain mode) with a filtered KG subset.

### Architecture

```
Before (Full mode):
  [orchestrator] → [1 wiki-worker: entire KG + DG → all domains serial]

After (Full mode):
  [orchestrator] → [generate_service_overview.py → service.json (draft)]
                 → [wiki-worker domain-1] ← wiki_kg_filter.py (≤200 nodes)
                 → [wiki-worker domain-2] ← wiki_kg_filter.py (≤200 nodes)
                 → [wiki-worker domain-3] ← wiki_kg_filter.py (≤200 nodes)
                 → ... (batches of ≤3 concurrent)
                 → [orchestrator enriches service.json description via LLM]
```

### Changes Required

#### 1. New: `generate_service_overview.py`

Deterministic Python script that produces `intermediate/wiki/service.json` from KG + DG metadata.

**Input:** `knowledge-graph.json` + `domain-graph.json`

**Output:** `intermediate/wiki/service.json` with:
- `name` ← `project.name`
- `techStack` ← `project.languages` + `project.frameworks`
- `modules` ← `layers[].name`
- `entryPoints` ← nodes with type `endpoint` or tag `entry-point`/`api-handler`
- `description` ← template placeholder from `project.description` (enriched by orchestrator later)

```python
def generate_service_overview(kg: dict, dg: dict) -> dict:
    project = kg.get("project", {})
    layers = kg.get("layers", [])
    nodes = kg.get("nodes", [])
    domains = dg.get("nodes", [])

    entry_points = [
        n["name"] for n in nodes
        if n.get("type") == "endpoint"
        or any(t in n.get("tags", []) for t in ("entry-point", "api-handler"))
    ]

    domain_names = [
        n["name"] for n in domains if n.get("type") == "domain"
    ]

    return {
        "name": project.get("name", ""),
        "description": project.get("description", ""),
        "techStack": (project.get("languages", []) + project.get("frameworks", [])),
        "modules": [layer.get("name", "") for layer in layers],
        "entryPoints": entry_points[:20],
    }
```

#### 2. Modify: `wiki-phase1-generation.md` — Full Generation section

Replace the current "dispatch ONE wiki-worker" flow with:

```
Full Generation:
1. Create output directory:
   mkdir -p "$SERVICE_ROOT/.understand-anything/intermediate/wiki/domains"

2. Generate service overview (deterministic):
   python "$SKILL_DIR/generate_service_overview.py" "$SERVICE_ROOT"
   → writes intermediate/wiki/service.json

3. Read DG, extract all domain IDs

4. For each domain (batches of ≤3 concurrent):
   a. Run wiki_kg_filter.py to produce domain-scoped KG (≤200 nodes)
   b. Dispatch wiki-worker (single-domain mode) with:
      - $TARGET_DOMAIN = domain ID
      - $KNOWLEDGE_GRAPH = filtered KG
      - $DOMAIN_GRAPH = full DG
      - All other standard params

5. After all domain wiki-workers complete:
   - Enrich service.json description:
     a. Read each generated domain page (domains/*.json), extract name + summary
     b. Orchestrator rewrites description field in service.json to a 2-3 sentence
        professional summary incorporating domain names and key capabilities
        (this is an inline LLM generation by the orchestrator agent itself,
        NOT a separate subagent dispatch — ~500 tokens output)
     c. Re-write service.json with the enriched description
   - Verify all expected domain files exist in intermediate/wiki/domains/

6. Proceed to Phase 2 (assembly)
```

#### 3. No change: `wiki-worker.md`

Single-domain mode (`$TARGET_DOMAIN` set) already works correctly:
- Skips service overview generation (Step 1)
- Processes only the target domain
- Writes to `domains/$TARGET_DOMAIN.json`

#### 4. Minor: Incremental mode service overview enrichment

When `serviceOverviewDirty=true`, instead of dispatching a wiki-worker for overview:
- Re-run `generate_service_overview.py`
- Orchestrator enriches description (same as Full mode step 5)

### Impact Assessment

| Metric | Current Full Mode | After |
|--------|------------------|-------|
| Context per agent | 100k+ tokens (entire KG) | ~20k tokens (≤200 nodes) |
| Parallelism | 1 (serial) | ≤3 concurrent |
| Failure blast radius | All domains | Single domain |
| Timeout risk (5-min limit) | High (large services) | Low |
| Code change | N/A | 1 new script + 1 doc update |

### Files Changed

| File | Change |
|------|--------|
| `skills/understand-wiki/generate_service_overview.py` | **New** — deterministic service.json generator |
| `tests/skill/understand-wiki/test_generate_service_overview.py` | **New** — unit tests |
| `skills/understand-wiki/docs/wiki-phase1-generation.md` | **Modify** — Full Generation section rewrite |

### Files NOT Changed

| File | Reason |
|------|--------|
| `agents/wiki-worker.md` | Single-domain mode already works |
| `skills/understand-wiki/SKILL.md` | No structural phase changes |
| `skills/understand-wiki/wiki_kg_filter.py` | Already supports domain-scoped filtering |

### Test Plan

1. `generate_service_overview.py` unit tests:
   - Extracts correct fields from KG project metadata
   - Extracts entry points from endpoint nodes
   - Handles missing/empty fields gracefully
   - Produces valid JSON output

2. Integration verification:
   - Run Full mode on a test project → verify per-domain dispatch
   - Verify service.json + all domain pages generated
   - Compare output quality with previous single-agent Full mode

### Constraints

- `wiki_kg_filter.py` max-nodes=200 is sufficient for single-domain context
- Service overview description enrichment is a single inline LLM call by the orchestrator (~500 tokens output), not a separate agent dispatch
- Batch mode (multi-service) inherits this improvement automatically since it processes each service independently
