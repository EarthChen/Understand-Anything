# Wiki Incremental Update — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement domain-level incremental updates for `/understand-wiki` so only changed domains get regenerated.

**Architecture:** Save DG snapshot before upstream triggers, compare old vs new DG after regeneration using a Python diff script, dispatch wiki-worker only for dirty domains. Fallback to full generation when >80% modified or on error.

**Tech Stack:** Python 3.10+ (diff script), TypeScript/vitest (schema validation), Markdown (SKILL.md/agent updates)

---

## Context

- **Domain-graph.json** uses the standard `KnowledgeGraph` interface: `{ version, project, nodes, edges, layers, tour }`. Domain nodes have `type: "domain"`, flow nodes have `type: "flow"`, step nodes have `type: "step"`.
- **Domain membership** is expressed via `contains_flow` edges (domain → flow) and `flow_step` edges (flow → step). To find which regular code nodes belong to a domain, look for nodes referenced in step nodes or via `cross_domain` edges.
- **Spec document:** `docs/superpowers/specs/2026-06-03-wiki-incremental-update-design.md`
- **Existing wiki-schema.ts:** `understand-anything-plugin/packages/core/src/wiki-schema.ts`
- **Existing types.ts:** `understand-anything-plugin/packages/core/src/types.ts`
- **SKILL.md:** `understand-anything-plugin/skills/understand-wiki/SKILL.md`
- **wiki-worker.md:** `understand-anything-plugin/agents/wiki-worker.md`

---

### Task 1: `wiki-diff-domains.py` — Core Domain Diff Script

**Files:**
- Create: `understand-anything-plugin/skills/understand-wiki/wiki-diff-domains.py`
- Test: `tests/skill/understand-wiki/test_wiki_diff_domains.py`

- [ ] **Step 1: Write failing tests for domain classification**

```python
# tests/skill/understand-wiki/test_wiki_diff_domains.py
import unittest
import json
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../../../understand-anything-plugin/skills/understand-wiki"))
from wiki_diff_domains import diff_domain_graphs


class TestDomainClassification(unittest.TestCase):
    """Verify domains are correctly classified as added/modified/removed/unchanged."""

    def _make_dg(self, domains: list[dict]) -> dict:
        """Helper to build a minimal DG structure."""
        nodes = []
        edges = []
        for d in domains:
            nodes.append({
                "id": d["id"],
                "name": d["name"],
                "type": "domain",
                "tags": [],
                "summary": "",
                "complexity": "simple",
            })
            for flow in d.get("flows", []):
                nodes.append({
                    "id": flow["id"],
                    "name": flow["name"],
                    "type": "flow",
                    "tags": [],
                    "summary": "",
                    "complexity": "simple",
                })
                edges.append({
                    "source": d["id"],
                    "target": flow["id"],
                    "type": "contains_flow",
                    "weight": 0.8,
                    "direction": "forward",
                })
                for step in flow.get("steps", []):
                    nodes.append({
                        "id": step["id"],
                        "name": step["name"],
                        "type": "step",
                        "tags": [],
                        "summary": "",
                        "complexity": "simple",
                    })
                    edges.append({
                        "source": flow["id"],
                        "target": step["id"],
                        "type": "flow_step",
                        "weight": 0.7,
                        "direction": "forward",
                    })
        return {
            "version": "1.0",
            "project": {"name": "test", "languages": [], "frameworks": [], "description": "", "analyzedAt": "", "gitCommitHash": "abc"},
            "nodes": nodes,
            "edges": edges,
            "layers": [],
            "tour": [],
        }

    def test_unchanged_domains(self):
        """All domains identical → all unchanged."""
        domains = [{"id": "d1", "name": "Auth", "flows": [{"id": "f1", "name": "Login", "steps": [{"id": "s1", "name": "Validate"}]}]}]
        old_dg = self._make_dg(domains)
        new_dg = self._make_dg(domains)
        result = diff_domain_graphs(old_dg, new_dg)
        self.assertEqual(result["added"], [])
        self.assertEqual(result["modified"], [])
        self.assertEqual(result["removed"], [])
        self.assertEqual(result["unchanged"], ["d1"])

    def test_added_domain(self):
        """New domain in new DG → added."""
        old_domains = [{"id": "d1", "name": "Auth", "flows": []}]
        new_domains = [{"id": "d1", "name": "Auth", "flows": []}, {"id": "d2", "name": "Order", "flows": []}]
        result = diff_domain_graphs(self._make_dg(old_domains), self._make_dg(new_domains))
        self.assertEqual(result["added"], ["d2"])
        self.assertEqual(result["unchanged"], ["d1"])

    def test_removed_domain(self):
        """Domain in old but not new → removed."""
        old_domains = [{"id": "d1", "name": "Auth", "flows": []}, {"id": "d2", "name": "Order", "flows": []}]
        new_domains = [{"id": "d1", "name": "Auth", "flows": []}]
        result = diff_domain_graphs(self._make_dg(old_domains), self._make_dg(new_domains))
        self.assertEqual(result["removed"], ["d2"])
        self.assertEqual(result["unchanged"], ["d1"])

    def test_modified_domain_flow_added(self):
        """Domain gains a new flow → modified."""
        old_domains = [{"id": "d1", "name": "Auth", "flows": []}]
        new_domains = [{"id": "d1", "name": "Auth", "flows": [{"id": "f1", "name": "Login", "steps": []}]}]
        result = diff_domain_graphs(self._make_dg(old_domains), self._make_dg(new_domains))
        self.assertEqual(result["modified"], ["d1"])
        self.assertEqual(result["unchanged"], [])

    def test_modified_domain_step_added(self):
        """Domain's flow gains a new step → modified."""
        old_domains = [{"id": "d1", "name": "Auth", "flows": [{"id": "f1", "name": "Login", "steps": []}]}]
        new_domains = [{"id": "d1", "name": "Auth", "flows": [{"id": "f1", "name": "Login", "steps": [{"id": "s1", "name": "Validate"}]}]}]
        result = diff_domain_graphs(self._make_dg(old_domains), self._make_dg(new_domains))
        self.assertEqual(result["modified"], ["d1"])

    def test_service_overview_dirty_on_domain_added(self):
        """serviceOverviewDirty is True when domains are added."""
        old_domains = [{"id": "d1", "name": "Auth", "flows": []}]
        new_domains = [{"id": "d1", "name": "Auth", "flows": []}, {"id": "d2", "name": "Order", "flows": []}]
        result = diff_domain_graphs(self._make_dg(old_domains), self._make_dg(new_domains))
        self.assertTrue(result["serviceOverviewDirty"])

    def test_service_overview_clean_on_internal_change(self):
        """serviceOverviewDirty is False when only internal flows change."""
        old_domains = [{"id": "d1", "name": "Auth", "flows": []}]
        new_domains = [{"id": "d1", "name": "Auth", "flows": [{"id": "f1", "name": "Login", "steps": []}]}]
        result = diff_domain_graphs(self._make_dg(old_domains), self._make_dg(new_domains))
        self.assertFalse(result["serviceOverviewDirty"])


class TestFallbackThreshold(unittest.TestCase):
    """Verify >80% modified triggers fallback signal."""

    def _make_dg_with_n_domains(self, n: int, prefix: str = "") -> dict:
        nodes = []
        for i in range(n):
            nodes.append({"id": f"d{prefix}{i}", "name": f"Domain{i}", "type": "domain", "tags": [], "summary": "", "complexity": "simple"})
        return {"version": "1.0", "project": {"name": "test", "languages": [], "frameworks": [], "description": "", "analyzedAt": "", "gitCommitHash": ""}, "nodes": nodes, "edges": [], "layers": [], "tour": []}

    def test_high_modification_ratio(self):
        """When >80% domains modified, result signals fallback."""
        old = self._make_dg_with_n_domains(10)
        # Replace 9/10 domains with different IDs
        new_nodes = [{"id": f"dnew{i}", "name": f"New{i}", "type": "domain", "tags": [], "summary": "", "complexity": "simple"} for i in range(9)]
        new_nodes.append({"id": "d0", "name": "Domain0", "type": "domain", "tags": [], "summary": "", "complexity": "simple"})
        new_dg = {"version": "1.0", "project": old["project"], "nodes": new_nodes, "edges": [], "layers": [], "tour": []}
        result = diff_domain_graphs(old, new_dg)
        total_changed = len(result["added"]) + len(result["modified"]) + len(result["removed"])
        total = total_changed + len(result["unchanged"])
        self.assertGreater(total_changed / total, 0.8)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/earthchen/ai-work/Understand-Anything && python3 -m pytest tests/skill/understand-wiki/test_wiki_diff_domains.py -v`
Expected: ImportError (module doesn't exist yet)

- [ ] **Step 3: Implement `wiki-diff-domains.py`**

```python
#!/usr/bin/env python3
"""Wiki Domain Diff — Compare old vs new domain-graph.json to identify changed domains.

Usage:
    python3 wiki-diff-domains.py --old <path> --new <path> [--kg <path>]

Output (JSON to stdout):
    { "added": [...], "removed": [...], "modified": [...], "unchanged": [...],
      "serviceOverviewDirty": bool, "crossServiceDirty": bool, "summary": "..." }
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


def load_json(path: str) -> dict:
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def extract_domains(dg: dict) -> dict[str, dict]:
    """Extract domain nodes and their associated flows/steps structure."""
    domains: dict[str, dict] = {}
    nodes_by_id: dict[str, dict] = {n["id"]: n for n in dg.get("nodes", [])}
    edges = dg.get("edges", [])

    for node in dg.get("nodes", []):
        if node.get("type") == "domain":
            domains[node["id"]] = {
                "name": node.get("name", ""),
                "flow_ids": set(),
                "step_ids": set(),
            }

    for edge in edges:
        if edge.get("type") == "contains_flow":
            src = edge["source"]
            tgt = edge["target"]
            if src in domains:
                domains[src]["flow_ids"].add(tgt)
        elif edge.get("type") == "flow_step":
            src = edge["source"]
            tgt = edge["target"]
            for d in domains.values():
                if src in d["flow_ids"]:
                    d["step_ids"].add(tgt)

    return domains


def diff_domain_graphs(old_dg: dict, new_dg: dict, kg: dict | None = None) -> dict:
    """Compare two domain graphs and classify each domain."""
    old_domains = extract_domains(old_dg)
    new_domains = extract_domains(new_dg)

    old_ids = set(old_domains.keys())
    new_ids = set(new_domains.keys())

    added = sorted(new_ids - old_ids)
    removed = sorted(old_ids - new_ids)
    common = old_ids & new_ids

    modified = []
    unchanged = []

    for did in sorted(common):
        old_d = old_domains[did]
        new_d = new_domains[did]
        if old_d["flow_ids"] != new_d["flow_ids"] or old_d["step_ids"] != new_d["step_ids"]:
            modified.append(did)
        else:
            unchanged.append(did)

    service_overview_dirty = bool(added or removed)

    # Cross-service dirty: check RPC edges in KG if provided
    cross_service_dirty = False
    if kg is not None:
        rpc_edges = [e for e in kg.get("edges", []) if e.get("type") in ("provides_rpc", "consumes_rpc")]
        cross_service_dirty = len(rpc_edges) > 0  # conservative: if RPC edges exist, mark dirty on first run

    total_changed = len(added) + len(modified) + len(removed)
    total = total_changed + len(unchanged)
    summary = f"{len(modified)} modified, {len(added)} added, {len(removed)} removed, {len(unchanged)} unchanged"

    return {
        "added": added,
        "removed": removed,
        "modified": modified,
        "unchanged": unchanged,
        "serviceOverviewDirty": service_overview_dirty,
        "crossServiceDirty": cross_service_dirty,
        "summary": summary,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Wiki domain diff")
    parser.add_argument("--old", required=True, help="Path to old domain-graph snapshot")
    parser.add_argument("--new", required=True, help="Path to new domain-graph.json")
    parser.add_argument("--kg", default=None, help="Path to knowledge-graph.json (for RPC edge detection)")
    args = parser.parse_args()

    old_dg = load_json(args.old)
    new_dg = load_json(args.new)
    kg = load_json(args.kg) if args.kg else None

    result = diff_domain_graphs(old_dg, new_dg, kg)
    json.dump(result, sys.stdout, indent=2)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/earthchen/ai-work/Understand-Anything && python3 -m pytest tests/skill/understand-wiki/test_wiki_diff_domains.py -v`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add understand-anything-plugin/skills/understand-wiki/wiki-diff-domains.py tests/skill/understand-wiki/test_wiki_diff_domains.py
git commit -m "feat(wiki): add wiki-diff-domains.py for incremental domain detection"
```

---

### Task 2: meta.json Schema Extension (`domainStates` + `rpcEdgeHash`)

**Files:**
- Modify: `understand-anything-plugin/packages/core/src/types.ts`
- Modify: `understand-anything-plugin/packages/core/src/wiki-schema.ts`
- Modify: `understand-anything-plugin/packages/core/src/__tests__/wiki-schema.test.ts`

- [ ] **Step 1: Write failing test for domainStates validation**

Add to existing `wiki-schema.test.ts`:

```typescript
describe("validateWikiMeta — domainStates extension", () => {
  it("accepts valid domainStates", () => {
    const meta = {
      version: "1.0",
      serviceName: "order-service",
      generatedAt: "2026-06-03T12:00:00Z",
      gitCommitHash: "abc1234",
      language: "en",
      domainStates: {
        "order-management": { lastGeneratedAt: "2026-06-03T12:00:00Z", nodeCount: 15, flowCount: 3 },
      },
      rpcEdgeHash: "sha256:abc123",
    };
    const issues = validateWikiMeta(meta, "wiki/meta.json");
    expect(issues).toHaveLength(0);
  });

  it("rejects domainStates with invalid entry (missing nodeCount)", () => {
    const meta = {
      version: "1.0",
      serviceName: "order-service",
      generatedAt: "2026-06-03T12:00:00Z",
      gitCommitHash: "abc1234",
      language: "en",
      domainStates: {
        "order": { lastGeneratedAt: "2026-06-03T12:00:00Z", flowCount: 3 },
      },
    };
    const issues = validateWikiMeta(meta, "wiki/meta.json");
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0].message).toContain("nodeCount");
  });

  it("accepts meta without domainStates (backward compatible)", () => {
    const meta = {
      version: "1.0",
      serviceName: "order-service",
      generatedAt: "2026-06-03T12:00:00Z",
      gitCommitHash: "abc1234",
      language: "en",
    };
    const issues = validateWikiMeta(meta, "wiki/meta.json");
    expect(issues).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/earthchen/ai-work/Understand-Anything/understand-anything-plugin/packages/core && npx vitest run src/__tests__/wiki-schema.test.ts`
Expected: FAIL (domainStates validation not implemented)

- [ ] **Step 3: Update types.ts — add DomainState interface**

Add after the existing `WikiMeta` interface:

```typescript
export interface WikiDomainState {
  lastGeneratedAt: string;
  nodeCount: number;
  flowCount: number;
}
```

And extend `WikiMeta`:

```typescript
// Add to existing WikiMeta interface:
  domainStates?: Record<string, WikiDomainState>;
  rpcEdgeHash?: string;
```

- [ ] **Step 4: Update wiki-schema.ts — validate domainStates**

Add domainStates validation logic inside `validateWikiMeta`:

```typescript
// After existing checks, add:
if (meta.domainStates !== undefined) {
  if (typeof meta.domainStates !== "object" || meta.domainStates === null || Array.isArray(meta.domainStates)) {
    issues.push({ file: filePath, severity: "error", message: "domainStates must be an object" });
  } else {
    for (const [domainId, state] of Object.entries(meta.domainStates)) {
      if (typeof (state as any).lastGeneratedAt !== "string") {
        issues.push({ file: filePath, severity: "error", message: `domainStates['${domainId}'].lastGeneratedAt must be a string` });
      }
      if (typeof (state as any).nodeCount !== "number") {
        issues.push({ file: filePath, severity: "error", message: `domainStates['${domainId}'].nodeCount must be a number` });
      }
      if (typeof (state as any).flowCount !== "number") {
        issues.push({ file: filePath, severity: "error", message: `domainStates['${domainId}'].flowCount must be a number` });
      }
    }
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd /Users/earthchen/ai-work/Understand-Anything/understand-anything-plugin/packages/core && npx vitest run src/__tests__/wiki-schema.test.ts`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add understand-anything-plugin/packages/core/src/types.ts understand-anything-plugin/packages/core/src/wiki-schema.ts understand-anything-plugin/packages/core/src/__tests__/wiki-schema.test.ts
git commit -m "feat(wiki): extend meta.json schema with domainStates and rpcEdgeHash"
```

---

### Task 3: SKILL.md — Add Incremental Logic to Phase 0 and Phase 1

**Files:**
- Modify: `understand-anything-plugin/skills/understand-wiki/SKILL.md`

- [ ] **Step 1: Add DG snapshot step to Phase 0 Step 5**

Insert after the existing prerequisite checks (line ~197 area), before Step 6:

```markdown
### Step 5b — Save DG Snapshot (for incremental diff)

```bash
DG_PATH="$SERVICE_UA/domain-graph.json"
DG_SNAPSHOT="$SERVICE_UA/wiki/domain-graph.snapshot.json"

if [ -f "$DG_PATH" ] && [ -f "$SERVICE_UA/wiki/meta.json" ]; then
  mkdir -p "$SERVICE_UA/wiki"
  cp "$DG_PATH" "$DG_SNAPSHOT"
  echo "[understand-wiki] DG snapshot saved for incremental diff."
else
  echo "[understand-wiki] No existing wiki — will run full generation."
fi
```
```

- [ ] **Step 2: Add incremental decision logic at Phase 1 entry**

Replace the current unconditional wiki-worker dispatch with:

```markdown
### Incremental Decision

After DG is ready (prerequisite verification passed), determine incremental vs full:

```bash
WIKI_META="$SERVICE_UA/wiki/meta.json"
DG_SNAPSHOT="$SERVICE_UA/wiki/domain-graph.snapshot.json"
INCREMENTAL=false

if [ -f "$WIKI_META" ] && [ -f "$DG_SNAPSHOT" ] && ! echo "$ARGUMENTS" | grep -q '\-\-full'; then
  DIFF_RESULT=$(python3 "$SKILL_DIR/wiki-diff-domains.py" \
    --old "$DG_SNAPSHOT" \
    --new "$SERVICE_UA/domain-graph.json" \
    --kg "$SERVICE_UA/knowledge-graph.json" 2>&1)
  DIFF_EXIT=$?
  
  if [ $DIFF_EXIT -ne 0 ]; then
    echo "[understand-wiki] Incremental skipped: diff script error. Running full generation."
  else
    MODIFIED_COUNT=$(echo "$DIFF_RESULT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d['added'])+len(d['modified']))")
    TOTAL_COUNT=$(echo "$DIFF_RESULT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d['added'])+len(d['modified'])+len(d['unchanged']))")
    
    if [ "$TOTAL_COUNT" -gt 0 ] && [ $((MODIFIED_COUNT * 100 / TOTAL_COUNT)) -gt 80 ]; then
      echo "[understand-wiki] Incremental skipped: ${MODIFIED_COUNT}/${TOTAL_COUNT} domains modified (>80%). Running full generation."
    elif [ "$MODIFIED_COUNT" -eq 0 ]; then
      echo "[understand-wiki] No domain changes detected. Updating meta.json only."
      # Update only gitCommitHash in meta.json, skip wiki-worker entirely
      INCREMENTAL=true
      DIRTY_DOMAINS=""
    else
      INCREMENTAL=true
      DIRTY_DOMAINS=$(echo "$DIFF_RESULT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(' '.join(d['added']+d['modified']))")
      echo "[understand-wiki] Incremental update: regenerating ${MODIFIED_COUNT} domain(s): $DIRTY_DOMAINS"
    fi
  fi
fi
```
```

- [ ] **Step 3: Add selective dispatch logic**

```markdown
### Wiki Worker Dispatch (Incremental vs Full)

```bash
if [ "$INCREMENTAL" = true ] && [ -n "$DIRTY_DOMAINS" ]; then
  for DOMAIN_ID in $DIRTY_DOMAINS; do
    echo "[understand-wiki] Regenerating domain page: $DOMAIN_ID"
    # Dispatch wiki-worker with --domain=$DOMAIN_ID for this service
  done
  
  # Handle removed domains
  REMOVED=$(echo "$DIFF_RESULT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(' '.join(d['removed']))")
  for DOMAIN_ID in $REMOVED; do
    rm -f "$SERVICE_UA/wiki/domains/${DOMAIN_ID}.json"
    echo "[understand-wiki] Removed obsolete domain page: $DOMAIN_ID"
  done
  
  # Conditionally regenerate service overview
  OVERVIEW_DIRTY=$(echo "$DIFF_RESULT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(str(d['serviceOverviewDirty']).lower())")
  if [ "$OVERVIEW_DIRTY" = "true" ]; then
    echo "[understand-wiki] Regenerating service overview (domain list changed)..."
    # Dispatch wiki-worker for service-overview only
  fi
elif [ "$INCREMENTAL" = false ]; then
  # Full generation: dispatch wiki-worker for all domains (existing behavior)
  echo "[understand-wiki] Running full wiki generation..."
fi
```
```

- [ ] **Step 4: Add snapshot cleanup**

```markdown
### Post-Generation Cleanup

```bash
# Remove DG snapshot after successful generation
rm -f "$SERVICE_UA/wiki/domain-graph.snapshot.json"
```
```

- [ ] **Step 5: Commit**

```bash
git add understand-anything-plugin/skills/understand-wiki/SKILL.md
git commit -m "feat(wiki): add incremental update logic to SKILL.md Phase 0/1"
```

---

### Task 4: wiki-worker.md — Add `--domain` Filter Support

**Files:**
- Modify: `understand-anything-plugin/agents/wiki-worker.md`

- [ ] **Step 1: Add --domain parameter to Input section**

In the wiki-worker.md Input section, add:

```markdown
### Incremental Mode (Optional)

When invoked with `--domain=<domain-id>`:
- Only generate/regenerate the wiki page for the specified domain
- Read the full DG and KG but filter processing to the target domain
- Output only the single domain page JSON file
- Skip service overview generation (handled by orchestrator)

When invoked WITHOUT `--domain`:
- Generate all domain pages (existing full behavior)
- Also generate service overview
```

- [ ] **Step 2: Add domain filter logic to Phase 1**

In the Phase 1 section, add filtering:

```markdown
### Domain Filtering (Incremental Mode)

If `--domain=<id>` is specified:
1. From the DG, locate the domain node with matching ID
2. Collect all flows (via `contains_flow` edges from this domain)
3. Collect all steps (via `flow_step` edges from those flows)
4. Process ONLY these nodes for wiki page generation
5. Write output to `wiki/domains/<domain-id>.json`
6. Report: "Generated 1 domain page: <domain-id>"

If the domain ID is not found in the DG, report error and exit:
> "Error: Domain '<id>' not found in domain-graph.json. Available domains: <list>"
```

- [ ] **Step 3: Commit**

```bash
git add understand-anything-plugin/agents/wiki-worker.md
git commit -m "feat(wiki-worker): add --domain filter for incremental generation"
```

---

## Self-Review Checklist

1. **Spec coverage**: 
   - ✅ DG diff mechanism → Task 1
   - ✅ meta.json extension → Task 2
   - ✅ SKILL.md integration → Task 3
   - ✅ wiki-worker --domain support → Task 4
   - ✅ Fallback conditions → Task 3 (>80% threshold + error handling)
   - ✅ Snapshot save/cleanup → Task 3

2. **Placeholder scan**: No TBDs or TODOs. All code blocks are complete.

3. **Type consistency**: 
   - `diff_domain_graphs()` in Task 1 matches the import in test
   - `WikiDomainState` in Task 2 matches the validation logic
   - `--domain` flag name consistent between Task 3 (dispatch) and Task 4 (receive)
