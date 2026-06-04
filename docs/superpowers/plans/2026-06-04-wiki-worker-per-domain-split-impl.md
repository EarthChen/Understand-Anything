# Wiki Worker Per-Domain Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert Full mode wiki generation from single-agent (entire KG) to per-domain dispatch, matching the existing Incremental mode pattern.

**Architecture:** 1 new deterministic Python script + 1 doc update. `wiki-worker.md` unchanged.

**Tech Stack:** Python 3.10+ (script), Markdown (doc), unittest (tests)

---

### Task 1: generate_service_overview.py — Service Overview Generator

**Files:**
- Create: `understand-anything-plugin/skills/understand-wiki/generate_service_overview.py`
- Test: `tests/skill/understand-wiki/test_generate_service_overview.py`

- [ ] **Step 1: Write the test file**

```python
# tests/skill/understand-wiki/test_generate_service_overview.py
import json
import os
import sys
import unittest
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent.parent.parent.parent / "understand-anything-plugin" / "skills" / "understand-wiki"
sys.path.insert(0, str(SCRIPT_DIR))


def _make_kg(project=None, nodes=None, layers=None):
    return {
        "version": "1.0.0",
        "project": project or {
            "name": "order-service",
            "languages": ["java"],
            "frameworks": ["spring-boot", "mybatis"],
            "description": "Manages order lifecycle including creation, payment integration, and delivery tracking.",
            "analyzedAt": "2026-01-01T00:00:00Z",
            "gitCommitHash": "abc123",
        },
        "nodes": nodes or [],
        "edges": [],
        "layers": layers or [
            {"id": "layer:api", "name": "API Layer", "nodeIds": []},
            {"id": "layer:service", "name": "Service Layer", "nodeIds": []},
            {"id": "layer:data", "name": "Data Layer", "nodeIds": []},
        ],
        "tour": [],
    }


def _make_dg(domains=None):
    return {
        "version": "1.0.0",
        "project": {"name": "order-service"},
        "nodes": domains or [],
        "edges": [],
        "layers": [],
        "tour": [],
    }


class TestGenerateServiceOverview(unittest.TestCase):
    def test_extracts_project_metadata(self):
        from generate_service_overview import generate_service_overview

        kg = _make_kg()
        dg = _make_dg()
        result = generate_service_overview(kg, dg)

        self.assertEqual(result["name"], "order-service")
        self.assertIn("java", result["techStack"])
        self.assertIn("spring-boot", result["techStack"])
        self.assertEqual(result["description"], kg["project"]["description"])

    def test_extracts_modules_from_layers(self):
        from generate_service_overview import generate_service_overview

        kg = _make_kg()
        dg = _make_dg()
        result = generate_service_overview(kg, dg)

        self.assertEqual(result["modules"], ["API Layer", "Service Layer", "Data Layer"])

    def test_extracts_entry_points(self):
        from generate_service_overview import generate_service_overview

        nodes = [
            {"id": "endpoint:POST /orders", "type": "endpoint", "name": "POST /orders",
             "summary": "Create order", "tags": ["order"], "filePath": ""},
            {"id": "endpoint:GET /orders/:id", "type": "endpoint", "name": "GET /orders/:id",
             "summary": "Get order", "tags": ["order"], "filePath": ""},
            {"id": "file:src/OrderService.java", "type": "file", "name": "OrderService",
             "summary": "Service", "tags": ["order"], "filePath": "src/OrderService.java"},
        ]
        kg = _make_kg(nodes=nodes)
        dg = _make_dg()
        result = generate_service_overview(kg, dg)

        self.assertIn("POST /orders", result["entryPoints"])
        self.assertIn("GET /orders/:id", result["entryPoints"])
        self.assertNotIn("OrderService", result["entryPoints"])

    def test_extracts_tagged_entry_points(self):
        from generate_service_overview import generate_service_overview

        nodes = [
            {"id": "function:handleEvent", "type": "function", "name": "handleEvent",
             "summary": "Event handler", "tags": ["entry-point", "event"], "filePath": ""},
        ]
        kg = _make_kg(nodes=nodes)
        dg = _make_dg()
        result = generate_service_overview(kg, dg)

        self.assertIn("handleEvent", result["entryPoints"])

    def test_handles_empty_kg(self):
        from generate_service_overview import generate_service_overview

        kg = _make_kg(project={"name": "", "languages": [], "frameworks": [],
                                "description": "", "analyzedAt": "", "gitCommitHash": ""},
                       nodes=[], layers=[])
        dg = _make_dg()
        result = generate_service_overview(kg, dg)

        self.assertEqual(result["name"], "")
        self.assertEqual(result["techStack"], [])
        self.assertEqual(result["modules"], [])
        self.assertEqual(result["entryPoints"], [])

    def test_limits_entry_points_to_20(self):
        from generate_service_overview import generate_service_overview

        nodes = [
            {"id": f"endpoint:GET /ep{i}", "type": "endpoint", "name": f"GET /ep{i}",
             "summary": f"Endpoint {i}", "tags": [], "filePath": ""}
            for i in range(30)
        ]
        kg = _make_kg(nodes=nodes)
        dg = _make_dg()
        result = generate_service_overview(kg, dg)

        self.assertEqual(len(result["entryPoints"]), 20)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/earthchen/ai-work/Understand-Anything && python -m pytest tests/skill/understand-wiki/test_generate_service_overview.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'generate_service_overview'`

- [ ] **Step 3: Write the script**

```python
# understand-anything-plugin/skills/understand-wiki/generate_service_overview.py
#!/usr/bin/env python3
"""
generate_service_overview.py — Deterministic service.json generator from KG + DG metadata.

Input: knowledge-graph.json + domain-graph.json
Output: intermediate/wiki/service.json
"""
from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

ENTRY_POINT_TYPES = frozenset({"endpoint", "service"})
ENTRY_POINT_TAGS = frozenset({"entry-point", "api-handler"})
MAX_ENTRY_POINTS = 20


def generate_service_overview(kg: dict[str, Any], dg: dict[str, Any]) -> dict[str, Any]:
    """Extract service overview from KG and DG metadata."""
    project = kg.get("project", {})
    layers = kg.get("layers", [])
    nodes = kg.get("nodes", [])

    entry_points: list[str] = []
    for node in nodes:
        is_entry = (
            node.get("type") in ENTRY_POINT_TYPES
            or bool(ENTRY_POINT_TAGS & set(node.get("tags", [])))
        )
        if is_entry:
            name = node.get("name", "")
            if name:
                entry_points.append(name)

    return {
        "name": project.get("name", ""),
        "description": project.get("description", ""),
        "techStack": project.get("languages", []) + project.get("frameworks", []),
        "modules": [layer.get("name", "") for layer in layers],
        "entryPoints": entry_points[:MAX_ENTRY_POINTS],
    }


def main() -> int:
    if len(sys.argv) < 2:
        print("Usage: python generate_service_overview.py <service-root>", file=sys.stderr)
        return 1

    service_root = Path(sys.argv[1])
    ua_dir = service_root / ".understand-anything"
    kg_path = ua_dir / "knowledge-graph.json"
    dg_path = ua_dir / "domain-graph.json"

    if not kg_path.exists():
        print(f"[generate-overview] KG not found: {kg_path}", file=sys.stderr)
        return 1

    kg = json.loads(kg_path.read_text(encoding="utf-8"))
    dg = json.loads(dg_path.read_text(encoding="utf-8")) if dg_path.exists() else {"nodes": []}

    overview = generate_service_overview(kg, dg)

    out_dir = ua_dir / "intermediate" / "wiki"
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / "service.json"
    out_path.write_text(json.dumps(overview, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    print(f"[generate-overview] {overview['name']}: {len(overview['entryPoints'])} entry points, {len(overview['modules'])} modules")
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/earthchen/ai-work/Understand-Anything && python -m pytest tests/skill/understand-wiki/test_generate_service_overview.py -v`
Expected: 6 tests PASS

- [ ] **Step 5: Commit**

```bash
git add understand-anything-plugin/skills/understand-wiki/generate_service_overview.py tests/skill/understand-wiki/test_generate_service_overview.py
git commit -m "feat(wiki): add deterministic service overview generator"
```

---

### Task 2: wiki-phase1-generation.md — Full Generation Rewrite

**Files:**
- Modify: `understand-anything-plugin/skills/understand-wiki/docs/wiki-phase1-generation.md`

- [ ] **Step 1: Replace the Full Generation section**

Replace the current "Full Generation — Single-Service Mode" section (lines 87-127) with per-domain dispatch:

**Before (lines 87-127):**
```markdown
### Full Generation — Single-Service Mode

Dispatch ONE `wiki-worker` agent for the target service (full mode).

**Dispatch prompt template:**

> Generate a complete Wiki for this microservice.
> ...
> Write all output files to: `$SERVICE_ROOT/.understand-anything/intermediate/wiki/`

After the agent completes, verify output:
...
```

**After:**
```markdown
### Full Generation — Single-Service Mode (Per-Domain Dispatch)

Full mode uses the same per-domain dispatch pattern as Incremental mode, ensuring consistent context sizes and enabling parallelism.

#### Step 1 — Generate Service Overview

```bash
mkdir -p "$SERVICE_ROOT/.understand-anything/intermediate/wiki/domains"
python3 "$SKILL_DIR/generate_service_overview.py" "$SERVICE_ROOT"
```

This produces `intermediate/wiki/service.json` with deterministic fields (name, techStack, modules, entryPoints). The `description` field uses `project.description` from the KG as a baseline.

#### Step 2 — Extract Domain List

Read the domain graph and extract all domain IDs:

```bash
DOMAIN_IDS=$(python3 -c "
import json, sys
dg = json.load(open('$SERVICE_UA/domain-graph.json'))
ids = [n['id'] for n in dg.get('nodes', []) if n.get('type') == 'domain']
print(' '.join(ids))
")
```

If no domains found, report error and stop.

#### Step 3 — Dispatch Per-Domain wiki-workers

For each domain, use the same dispatch pattern as Incremental mode:

```bash
for DOMAIN_ID in $DOMAIN_IDS; do
  FILTERED_KG=$(python3 "$SKILL_DIR/wiki_kg_filter.py" \
    "$SERVICE_UA/knowledge-graph.json" \
    "$SERVICE_UA/domain-graph.json" \
    "$DOMAIN_ID" --max-nodes=200)
  # Dispatch wiki-worker with the same prompt as Incremental Dispatch (see above)
done
```

Run up to **3 wiki-worker subagents concurrently** (same concurrency limit as batch mode).

If a domain's wiki-worker fails, retry once. On second failure, skip that domain and continue.

**Dispatch prompt:** Use the same template as "Incremental Dispatch — Per-Domain wiki-worker Prompt" above.

#### Step 4 — Enrich Service Description

After all domain wiki-workers complete:

1. Read each generated domain page (`domains/*.json`), extract `name` and `summary`
2. Rewrite `service.json` description to a professional 2-3 sentence summary incorporating domain names and key capabilities (inline orchestrator LLM generation, NOT a separate subagent)
3. Re-write `service.json` with the enriched description

#### Step 5 — Verify Output

```bash
test -f "$SERVICE_ROOT/.understand-anything/intermediate/wiki/service.json" && \
test -d "$SERVICE_ROOT/.understand-anything/intermediate/wiki/domains" && \
DOMAIN_COUNT=$(ls "$SERVICE_ROOT/.understand-anything/intermediate/wiki/domains/"*.json 2>/dev/null | wc -l) && \
[ "$DOMAIN_COUNT" -gt 0 ]
```

If any file is missing, report the failure and stop (do not proceed to Phase 2).

Report:
> `[understand-wiki] Full generation: $DOMAIN_COUNT domain pages generated.`

Proceed to **Phase 2** (deterministic assembly). See [Phase 2 — Assembly Pipeline](wiki-phase2-assembly.md).
```

- [ ] **Step 2: Update Incremental mode service overview handling**

In the "Dispatch Strategy" code block, update the `serviceOverviewDirty` handler (around line 29-33):

**Before:**
```bash
  if [ "$OVERVIEW_DIRTY" = "true" ]; then
    echo "[understand-wiki] Regenerating service overview (domain list changed)..."
    # Dispatch wiki-worker for service-overview only
  fi
```

**After:**
```bash
  if [ "$OVERVIEW_DIRTY" = "true" ]; then
    echo "[understand-wiki] Regenerating service overview (domain list changed)..."
    python3 "$SKILL_DIR/generate_service_overview.py" "$SERVICE_ROOT"
    # Orchestrator enriches description inline (same as Full mode Step 4)
  fi
```

- [ ] **Step 3: Verify consistency**

Read the updated file end-to-end and verify:
- Incremental path uses `generate_service_overview.py` for overview regeneration
- Full path uses `generate_service_overview.py` + per-domain dispatch + description enrichment
- Batch mode references the same dispatch pattern
- Partial Failure Policy still applies

- [ ] **Step 4: Commit**

```bash
git add understand-anything-plugin/skills/understand-wiki/docs/wiki-phase1-generation.md
git commit -m "refactor(wiki): Full mode uses per-domain dispatch matching Incremental"
```

---

### Task 3: Run All Tests

- [ ] **Step 1: Run wiki tests**

Run: `cd /Users/earthchen/ai-work/Understand-Anything && python -m pytest tests/skill/understand-wiki/ -v`
Expected: 6 tests PASS (from Task 1)

- [ ] **Step 2: Run domain tests (regression check)**

Run: `cd /Users/earthchen/ai-work/Understand-Anything && python -m pytest tests/skill/understand-domain/ -v`
Expected: 11 tests PASS (from earlier implementation)

- [ ] **Step 3: If adjustments needed, commit**

```bash
git add -A
git commit -m "test(wiki): verify wiki-worker per-domain split tests pass"
```
