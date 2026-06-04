# Domain Analysis Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split Phase 4 of `/understand-domain` into per-domain parallel extraction with KG condensation, eliminating timeout issues on large codebases.

**Architecture:** Add 3 deterministic Python scripts (condense, split, merge) and 2 agent prompts (domain-discoverer, domain-flow-extractor). Path 2 (KG-based) gets the split pipeline; Path 1 (no KG) stays unchanged.

**Tech Stack:** Python 3.10+ (scripts), Markdown (agent prompts), unittest (Python tests)

---

### Task 1: condense-kg-for-domain.py — KG Condensation Script

**Files:**
- Create: `understand-anything-plugin/skills/understand-domain/condense-kg-for-domain.py`
- Test: `tests/skill/understand-domain/test_condense_kg.py`

- [ ] **Step 1: Write the test file with fixture and first test**

```python
# tests/skill/understand-domain/test_condense_kg.py
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent.parent.parent.parent / "understand-anything-plugin" / "skills" / "understand-domain"
sys.path.insert(0, str(SCRIPT_DIR))


def _make_kg(nodes, edges, project=None):
    """Build a minimal KG fixture."""
    return {
        "version": "1.0.0",
        "project": project or {
            "name": "test-project",
            "languages": ["java"],
            "frameworks": ["spring-boot"],
            "description": "Test project",
            "analyzedAt": "2026-01-01T00:00:00Z",
            "gitCommitHash": "abc123",
        },
        "nodes": nodes,
        "edges": edges,
        "layers": [{"id": "layer:api", "name": "API Layer", "nodeIds": []}],
        "tour": [],
    }


def _make_node(node_id, node_type, name, summary, tags, file_path=None):
    return {
        "id": node_id,
        "type": node_type,
        "name": name,
        "summary": summary,
        "tags": tags,
        "complexity": "moderate",
        "filePath": file_path or "",
        "lineRange": [0, 0],
    }


class TestCondenseKg(unittest.TestCase):
    def test_module_grouping(self):
        from condense_kg_for_domain import condense_kg

        nodes = [
            _make_node("file:src/order/OrderService.java", "file", "OrderService", "Manages orders", ["order"], "src/order/OrderService.java"),
            _make_node("file:src/order/OrderController.java", "file", "OrderController", "REST API for orders", ["order", "api"], "src/order/OrderController.java"),
            _make_node("file:src/payment/PaymentService.java", "file", "PaymentService", "Handles payments", ["payment"], "src/payment/PaymentService.java"),
        ]
        kg = _make_kg(nodes, [])

        result = condense_kg(kg)

        self.assertIn("modules", result)
        module_paths = [m["path"] for m in result["modules"]]
        self.assertIn("src/order", module_paths)
        self.assertIn("src/payment", module_paths)

        order_mod = next(m for m in result["modules"] if m["path"] == "src/order")
        self.assertEqual(order_mod["nodeCount"], 2)

    def test_endpoint_extraction(self):
        from condense_kg_for_domain import condense_kg

        nodes = [
            _make_node("endpoint:POST /orders", "endpoint", "POST /orders", "Create order", ["order"], "src/order/OrderController.java"),
            _make_node("file:src/order/OrderService.java", "file", "OrderService", "Service logic", ["order"], "src/order/OrderService.java"),
        ]
        kg = _make_kg(nodes, [])

        result = condense_kg(kg)

        self.assertIn("keyNodes", result)
        endpoint_ids = [n["id"] for n in result["keyNodes"]]
        self.assertIn("endpoint:POST /orders", endpoint_ids)

    def test_cross_module_edges(self):
        from condense_kg_for_domain import condense_kg

        nodes = [
            _make_node("file:src/order/OrderService.java", "file", "OrderService", "Orders", ["order"], "src/order/OrderService.java"),
            _make_node("file:src/payment/PaymentService.java", "file", "PaymentService", "Payments", ["payment"], "src/payment/PaymentService.java"),
        ]
        edges = [
            {"source": "file:src/order/OrderService.java", "target": "file:src/payment/PaymentService.java", "type": "calls", "direction": "forward", "weight": 0.8, "description": "OrderService calls PaymentService.charge()"},
        ]
        kg = _make_kg(nodes, edges)

        result = condense_kg(kg)

        self.assertIn("crossModuleEdges", result)
        self.assertEqual(len(result["crossModuleEdges"]), 1)
        self.assertEqual(result["crossModuleEdges"][0]["sourceModule"], "src/order")
        self.assertEqual(result["crossModuleEdges"][0]["targetModule"], "src/payment")

    def test_output_has_project_and_stats(self):
        from condense_kg_for_domain import condense_kg

        kg = _make_kg(
            [_make_node("file:src/a.java", "file", "A", "File A", ["a"], "src/a.java")],
            [],
        )
        result = condense_kg(kg)

        self.assertIn("project", result)
        self.assertEqual(result["project"]["name"], "test-project")
        self.assertIn("stats", result)
        self.assertEqual(result["stats"]["totalNodes"], 1)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/earthchen/ai-work/Understand-Anything && python -m pytest tests/skill/understand-domain/test_condense_kg.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'condense_kg_for_domain'`

- [ ] **Step 3: Write the condense script**

```python
# understand-anything-plugin/skills/understand-domain/condense_kg_for_domain.py
#!/usr/bin/env python3
"""
condense-kg-for-domain.py — Condense a full KG into module-level summary for domain discovery.

Input: knowledge-graph.json (2000+ nodes)
Output: intermediate/kg-summary.json (~15k tokens)
"""
from __future__ import annotations

import json
import sys
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

KEY_NODE_TYPES = frozenset({"endpoint", "service", "pipeline", "table", "schema"})
MAX_SUMMARIES_PER_MODULE = 3
MAX_EDGE_SAMPLES = 3


def _get_module(path_or_id: str) -> str:
    """Extract top-level module from a file path or node ID."""
    clean = path_or_id
    for prefix in ("file:", "class:", "function:", "endpoint:", "service:", "config:", "document:"):
        if clean.startswith(prefix):
            clean = clean[len(prefix):]
            break
    parts = clean.replace("\\", "/").split("/")
    # Return first two significant directory segments (e.g., "src/order")
    significant = [p for p in parts if p and p != "."]
    if len(significant) >= 3:
        return "/".join(significant[:2])
    elif len(significant) >= 2:
        return significant[0]
    return "(root)"


def condense_kg(kg: dict[str, Any]) -> dict[str, Any]:
    """Condense a full KG into a module-level summary."""
    nodes = kg.get("nodes", [])
    edges = kg.get("edges", [])
    project = kg.get("project", {})
    layers = kg.get("layers", [])

    # Group nodes by module
    module_data: dict[str, dict] = defaultdict(lambda: {
        "nodeCount": 0,
        "typeBreakdown": Counter(),
        "tags": set(),
        "summaries": [],
        "files": [],
    })

    key_nodes: list[dict] = []

    for node in nodes:
        fp = node.get("filePath") or node.get("id", "")
        mod = _get_module(fp)
        md = module_data[mod]
        md["nodeCount"] += 1
        md["typeBreakdown"][node.get("type", "unknown")] += 1
        for tag in node.get("tags", []):
            md["tags"].add(tag)
        summary = node.get("summary", "")
        if summary and len(md["summaries"]) < MAX_SUMMARIES_PER_MODULE:
            md["summaries"].append(summary)
        name = node.get("name", "")
        if name:
            md["files"].append(name)

        if node.get("type") in KEY_NODE_TYPES:
            key_nodes.append({
                "id": node["id"],
                "name": node.get("name", ""),
                "summary": node.get("summary", ""),
                "tags": node.get("tags", []),
                "module": mod,
            })

    # Build module list
    modules = []
    for path, md in sorted(module_data.items()):
        modules.append({
            "path": path,
            "nodeCount": md["nodeCount"],
            "typeBreakdown": dict(md["typeBreakdown"]),
            "tags": sorted(md["tags"]),
            "summaries": md["summaries"],
            "files": md["files"][:20],  # limit file list
        })

    # Cross-module edges
    edge_groups: dict[tuple, dict] = defaultdict(lambda: {"count": 0, "samples": []})
    for edge in edges:
        src_mod = _get_module(edge.get("source", ""))
        tgt_mod = _get_module(edge.get("target", ""))
        if src_mod != tgt_mod:
            key = (src_mod, tgt_mod, edge.get("type", "unknown"))
            eg = edge_groups[key]
            eg["count"] += 1
            desc = edge.get("description", "")
            if desc and len(eg["samples"]) < MAX_EDGE_SAMPLES:
                eg["samples"].append(desc)

    cross_module_edges = []
    for (src, tgt, etype), data in sorted(edge_groups.items()):
        cross_module_edges.append({
            "sourceModule": src,
            "targetModule": tgt,
            "type": etype,
            "count": data["count"],
            "samples": data["samples"],
        })

    return {
        "project": project,
        "stats": {"totalNodes": len(nodes), "totalEdges": len(edges)},
        "modules": modules,
        "keyNodes": key_nodes,
        "crossModuleEdges": cross_module_edges,
        "layers": layers,
    }


def main() -> int:
    if len(sys.argv) < 2:
        print("Usage: python condense-kg-for-domain.py <project-root>", file=sys.stderr)
        return 1

    project_root = Path(sys.argv[1])
    kg_path = project_root / ".understand-anything" / "knowledge-graph.json"

    if not kg_path.exists():
        print(f"[condense-kg] KG not found: {kg_path}", file=sys.stderr)
        return 1

    kg = json.loads(kg_path.read_text(encoding="utf-8"))
    summary = condense_kg(kg)

    out_dir = project_root / ".understand-anything" / "intermediate"
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / "kg-summary.json"
    out_path.write_text(json.dumps(summary, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    print(f"[condense-kg] Condensed {summary['stats']['totalNodes']} nodes → {len(summary['modules'])} modules, {len(summary['keyNodes'])} key nodes")
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/earthchen/ai-work/Understand-Anything && python -m pytest tests/skill/understand-domain/test_condense_kg.py -v`
Expected: 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add understand-anything-plugin/skills/understand-domain/condense_kg_for_domain.py tests/skill/understand-domain/test_condense_kg.py
git commit -m "feat(domain): add KG condensation script for domain discovery"
```

---

### Task 2: split-kg-by-domain.py — Per-Domain KG Splitting

**Files:**
- Create: `understand-anything-plugin/skills/understand-domain/split_kg_by_domain.py`
- Test: `tests/skill/understand-domain/test_split_kg.py`

- [ ] **Step 1: Write the test file**

```python
# tests/skill/understand-domain/test_split_kg.py
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent.parent.parent.parent / "understand-anything-plugin" / "skills" / "understand-domain"
sys.path.insert(0, str(SCRIPT_DIR))


def _make_node(node_id, file_path):
    return {
        "id": node_id, "type": "file", "name": node_id,
        "summary": f"Summary of {node_id}", "tags": ["test"],
        "complexity": "simple", "filePath": file_path, "lineRange": [0, 0],
    }


def _make_edge(source, target, edge_type="calls"):
    return {"source": source, "target": target, "type": edge_type, "direction": "forward", "weight": 0.8}


class TestSplitKgByDomain(unittest.TestCase):
    def test_split_assigns_nodes_to_domains(self):
        from split_kg_by_domain import split_kg_by_domain

        kg = {
            "nodes": [
                _make_node("file:src/order/Order.java", "src/order/Order.java"),
                _make_node("file:src/payment/Pay.java", "src/payment/Pay.java"),
            ],
            "edges": [],
        }
        discovery = {
            "domains": [
                {"id": "domain:order", "name": "Order", "modules": ["src/order"]},
                {"id": "domain:payment", "name": "Payment", "modules": ["src/payment"]},
            ]
        }

        result = split_kg_by_domain(kg, discovery)

        self.assertIn("domain:order", result)
        self.assertIn("domain:payment", result)
        self.assertEqual(len(result["domain:order"]["nodes"]), 1)
        self.assertEqual(result["domain:order"]["nodes"][0]["id"], "file:src/order/Order.java")

    def test_intra_domain_edges_included(self):
        from split_kg_by_domain import split_kg_by_domain

        kg = {
            "nodes": [
                _make_node("file:src/order/A.java", "src/order/A.java"),
                _make_node("file:src/order/B.java", "src/order/B.java"),
            ],
            "edges": [_make_edge("file:src/order/A.java", "file:src/order/B.java")],
        }
        discovery = {"domains": [{"id": "domain:order", "modules": ["src/order"], "name": "Order"}]}

        result = split_kg_by_domain(kg, discovery)
        self.assertEqual(len(result["domain:order"]["edges"]), 1)

    def test_cross_domain_edges_included_in_both(self):
        from split_kg_by_domain import split_kg_by_domain

        kg = {
            "nodes": [
                _make_node("file:src/order/A.java", "src/order/A.java"),
                _make_node("file:src/payment/B.java", "src/payment/B.java"),
            ],
            "edges": [_make_edge("file:src/order/A.java", "file:src/payment/B.java")],
        }
        discovery = {
            "domains": [
                {"id": "domain:order", "modules": ["src/order"], "name": "Order"},
                {"id": "domain:payment", "modules": ["src/payment"], "name": "Payment"},
            ]
        }

        result = split_kg_by_domain(kg, discovery)
        order_edges = result["domain:order"]["edges"]
        self.assertTrue(any(e["target"] == "file:src/payment/B.java" for e in order_edges))

    def test_unassigned_nodes_skipped(self):
        from split_kg_by_domain import split_kg_by_domain

        kg = {
            "nodes": [
                _make_node("file:src/order/A.java", "src/order/A.java"),
                _make_node("file:src/util/Helper.java", "src/util/Helper.java"),
            ],
            "edges": [],
        }
        discovery = {"domains": [{"id": "domain:order", "modules": ["src/order"], "name": "Order"}]}

        result = split_kg_by_domain(kg, discovery)
        self.assertEqual(len(result["domain:order"]["nodes"]), 1)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/earthchen/ai-work/Understand-Anything && python -m pytest tests/skill/understand-domain/test_split_kg.py -v`
Expected: FAIL with `ModuleNotFoundError`

- [ ] **Step 3: Write the split script**

```python
# understand-anything-plugin/skills/understand-domain/split_kg_by_domain.py
#!/usr/bin/env python3
"""
split-kg-by-domain.py — Split a full KG into per-domain subsets using domain discovery results.

Input: knowledge-graph.json + intermediate/domain-discovery.json
Output: intermediate/domain-<id>.json for each domain
"""
from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any


def _file_matches_modules(file_path: str, modules: list[str]) -> bool:
    """Check if a file path starts with any of the domain's modules."""
    normalized = file_path.replace("\\", "/")
    return any(normalized.startswith(m.rstrip("/") + "/") or normalized == m for m in modules)


def _node_module(node: dict) -> str:
    fp = node.get("filePath") or ""
    if not fp:
        node_id = node.get("id", "")
        for prefix in ("file:", "class:", "function:", "endpoint:", "service:", "config:"):
            if node_id.startswith(prefix):
                fp = node_id[len(prefix):]
                break
    return fp.replace("\\", "/")


def split_kg_by_domain(kg: dict[str, Any], discovery: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """Split KG nodes and edges by domain. Returns {domain_id: {domain, nodes, edges, stats}}."""
    domains = discovery.get("domains", [])
    nodes = kg.get("nodes", [])
    edges = kg.get("edges", [])

    node_to_domain: dict[str, str] = {}
    for domain in domains:
        domain_id = domain["id"]
        modules = domain.get("modules", [])
        for node in nodes:
            fp = _node_module(node)
            if _file_matches_modules(fp, modules):
                node_to_domain[node["id"]] = domain_id

    result: dict[str, dict[str, Any]] = {}
    for domain in domains:
        domain_id = domain["id"]
        domain_nodes = [n for n in nodes if node_to_domain.get(n["id"]) == domain_id]
        domain_node_ids = {n["id"] for n in domain_nodes}

        domain_edges = [
            e for e in edges
            if e.get("source") in domain_node_ids or e.get("target") in domain_node_ids
        ]

        result[domain_id] = {
            "domain": {"id": domain_id, "name": domain.get("name", ""), "summary": domain.get("summary", "")},
            "nodes": domain_nodes,
            "edges": domain_edges,
            "stats": {"nodes": len(domain_nodes), "edges": len(domain_edges)},
        }

    return result


def main() -> int:
    if len(sys.argv) < 2:
        print("Usage: python split-kg-by-domain.py <project-root>", file=sys.stderr)
        return 1

    project_root = Path(sys.argv[1])
    kg_path = project_root / ".understand-anything" / "knowledge-graph.json"
    discovery_path = project_root / ".understand-anything" / "intermediate" / "domain-discovery.json"
    out_dir = project_root / ".understand-anything" / "intermediate"

    if not kg_path.exists():
        print(f"[split-kg] KG not found: {kg_path}", file=sys.stderr)
        return 1
    if not discovery_path.exists():
        print(f"[split-kg] Domain discovery not found: {discovery_path}", file=sys.stderr)
        return 1

    kg = json.loads(kg_path.read_text(encoding="utf-8"))
    discovery = json.loads(discovery_path.read_text(encoding="utf-8"))

    splits = split_kg_by_domain(kg, discovery)

    for domain_id, data in splits.items():
        safe_name = domain_id.replace("domain:", "")
        out_path = out_dir / f"domain-{safe_name}.json"
        out_path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        print(f"[split-kg] {domain_id}: {data['stats']['nodes']} nodes, {data['stats']['edges']} edges")

    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/earthchen/ai-work/Understand-Anything && python -m pytest tests/skill/understand-domain/test_split_kg.py -v`
Expected: 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add understand-anything-plugin/skills/understand-domain/split_kg_by_domain.py tests/skill/understand-domain/test_split_kg.py
git commit -m "feat(domain): add per-domain KG splitting script"
```

---

### Task 3: merge-domain-results.py — Merge Per-Domain Results

**Files:**
- Create: `understand-anything-plugin/skills/understand-domain/merge_domain_results.py`
- Test: `tests/skill/understand-domain/test_merge_domain.py`

- [ ] **Step 1: Write the test file**

```python
# tests/skill/understand-domain/test_merge_domain.py
import json
import sys
import unittest
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent.parent.parent.parent / "understand-anything-plugin" / "skills" / "understand-domain"
sys.path.insert(0, str(SCRIPT_DIR))


class TestMergeDomainResults(unittest.TestCase):
    def test_merge_creates_domain_nodes(self):
        from merge_domain_results import merge_domain_results

        discovery = {
            "domains": [
                {"id": "domain:order", "name": "Order Management", "summary": "Orders", "tags": ["order"],
                 "entities": ["Order"], "businessRules": [], "crossDomainInteractions": [], "modules": ["src/order"]},
            ]
        }
        flows = {
            "domain:order": {
                "domainId": "domain:order",
                "flows": [{
                    "id": "flow:create-order", "name": "Create Order", "summary": "Creates an order",
                    "tags": ["order"], "complexity": "moderate",
                    "domainMeta": {"entryPoint": "POST /orders", "entryType": "http"},
                    "steps": [{
                        "id": "step:create-order:validate", "name": "Validate", "summary": "Validates input",
                        "tags": ["validation"], "complexity": "simple", "filePath": "src/order/OrderService.java",
                        "lineRange": [0, 0],
                    }],
                }],
                "crossDomainEdges": [],
            }
        }

        result = merge_domain_results(discovery, flows, project={
            "name": "test", "languages": ["java"], "frameworks": ["spring"],
            "description": "Test", "analyzedAt": "2026-01-01T00:00:00Z", "gitCommitHash": "abc",
        })

        domain_nodes = [n for n in result["nodes"] if n["type"] == "domain"]
        flow_nodes = [n for n in result["nodes"] if n["type"] == "flow"]
        step_nodes = [n for n in result["nodes"] if n["type"] == "step"]
        self.assertEqual(len(domain_nodes), 1)
        self.assertEqual(len(flow_nodes), 1)
        self.assertEqual(len(step_nodes), 1)

    def test_merge_creates_edges(self):
        from merge_domain_results import merge_domain_results

        discovery = {
            "domains": [
                {"id": "domain:order", "name": "Order", "summary": "Orders", "tags": [],
                 "entities": [], "businessRules": [], "crossDomainInteractions": [], "modules": []},
            ]
        }
        flows = {
            "domain:order": {
                "domainId": "domain:order",
                "flows": [{
                    "id": "flow:create-order", "name": "Create Order", "summary": "Creates",
                    "tags": [], "complexity": "moderate",
                    "domainMeta": {"entryPoint": "POST /orders", "entryType": "http"},
                    "steps": [{
                        "id": "step:create-order:s1", "name": "S1", "summary": "Step 1",
                        "tags": [], "complexity": "simple", "filePath": "", "lineRange": [0, 0],
                    }],
                }],
                "crossDomainEdges": [],
            }
        }

        result = merge_domain_results(discovery, flows, project={
            "name": "t", "languages": [], "frameworks": [],
            "description": "", "analyzedAt": "", "gitCommitHash": "",
        })

        edge_types = {e["type"] for e in result["edges"]}
        self.assertIn("contains_flow", edge_types)
        self.assertIn("flow_step", edge_types)

    def test_flow_step_weights_are_ordered(self):
        from merge_domain_results import merge_domain_results

        discovery = {"domains": [{"id": "domain:a", "name": "A", "summary": "", "tags": [],
                                   "entities": [], "businessRules": [], "crossDomainInteractions": [], "modules": []}]}
        flows = {
            "domain:a": {
                "domainId": "domain:a",
                "flows": [{
                    "id": "flow:f1", "name": "F1", "summary": "", "tags": [], "complexity": "simple",
                    "domainMeta": {"entryPoint": "", "entryType": "manual"},
                    "steps": [
                        {"id": "step:f1:s1", "name": "S1", "summary": "", "tags": [], "complexity": "simple", "filePath": "", "lineRange": [0, 0]},
                        {"id": "step:f1:s2", "name": "S2", "summary": "", "tags": [], "complexity": "simple", "filePath": "", "lineRange": [0, 0]},
                        {"id": "step:f1:s3", "name": "S3", "summary": "", "tags": [], "complexity": "simple", "filePath": "", "lineRange": [0, 0]},
                    ],
                }],
                "crossDomainEdges": [],
            }
        }

        result = merge_domain_results(discovery, flows, project={
            "name": "t", "languages": [], "frameworks": [],
            "description": "", "analyzedAt": "", "gitCommitHash": "",
        })

        step_edges = [e for e in result["edges"] if e["type"] == "flow_step"]
        weights = [e["weight"] for e in step_edges]
        self.assertEqual(weights, sorted(weights))
        self.assertTrue(all(0 < w <= 1.0 for w in weights))


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/earthchen/ai-work/Understand-Anything && python -m pytest tests/skill/understand-domain/test_merge_domain.py -v`
Expected: FAIL

- [ ] **Step 3: Write the merge script**

```python
# understand-anything-plugin/skills/understand-domain/merge_domain_results.py
#!/usr/bin/env python3
"""
merge-domain-results.py — Combine per-domain flow extraction results into final domain-analysis.json.

Input: intermediate/domain-discovery.json + intermediate/flows-*.json
Output: intermediate/domain-analysis.json
"""
from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any


def merge_domain_results(
    discovery: dict[str, Any],
    flows_by_domain: dict[str, dict[str, Any]],
    project: dict[str, Any],
) -> dict[str, Any]:
    """Merge domain discovery + per-domain flows into final domain graph."""
    nodes: list[dict] = []
    edges: list[dict] = []

    for domain_info in discovery.get("domains", []):
        domain_id = domain_info["id"]
        nodes.append({
            "id": domain_id,
            "type": "domain",
            "name": domain_info.get("name", ""),
            "summary": domain_info.get("summary", ""),
            "tags": domain_info.get("tags", []),
            "complexity": "moderate",
            "domainMeta": {
                "entities": domain_info.get("entities", []),
                "businessRules": domain_info.get("businessRules", []),
                "crossDomainInteractions": domain_info.get("crossDomainInteractions", []),
            },
        })

        domain_flows = flows_by_domain.get(domain_id, {})
        for flow in domain_flows.get("flows", []):
            flow_id = flow["id"]
            nodes.append({
                "id": flow_id,
                "type": "flow",
                "name": flow.get("name", ""),
                "summary": flow.get("summary", ""),
                "tags": flow.get("tags", []),
                "complexity": flow.get("complexity", "moderate"),
                "domainMeta": flow.get("domainMeta", {}),
            })
            edges.append({
                "source": domain_id,
                "target": flow_id,
                "type": "contains_flow",
                "direction": "forward",
                "weight": 1.0,
            })

            steps = flow.get("steps", [])
            n_steps = len(steps)
            for i, step in enumerate(steps):
                nodes.append({
                    "id": step["id"],
                    "type": "step",
                    "name": step.get("name", ""),
                    "summary": step.get("summary", ""),
                    "tags": step.get("tags", []),
                    "complexity": step.get("complexity", "simple"),
                    "filePath": step.get("filePath", ""),
                    "lineRange": step.get("lineRange", [0, 0]),
                })
                weight = round((i + 1) / max(n_steps, 1), 1) if n_steps > 0 else 0.1
                weight = max(0.1, min(weight, 1.0))
                edges.append({
                    "source": flow_id,
                    "target": step["id"],
                    "type": "flow_step",
                    "direction": "forward",
                    "weight": weight,
                })

        for cd_edge in domain_flows.get("crossDomainEdges", []):
            edges.append({
                "source": cd_edge.get("source", domain_id),
                "target": cd_edge.get("target", ""),
                "type": "cross_domain",
                "direction": "forward",
                "description": cd_edge.get("description", ""),
                "weight": 0.6,
            })

    seen_cd: set[tuple] = set()
    deduped_edges: list[dict] = []
    for e in edges:
        if e["type"] == "cross_domain":
            key = (e["source"], e["target"])
            if key in seen_cd:
                continue
            seen_cd.add(key)
        deduped_edges.append(e)

    return {
        "version": "1.0.0",
        "project": project,
        "nodes": nodes,
        "edges": deduped_edges,
        "layers": [],
        "tour": [],
    }


def main() -> int:
    if len(sys.argv) < 2:
        print("Usage: python merge-domain-results.py <project-root>", file=sys.stderr)
        return 1

    project_root = Path(sys.argv[1])
    inter_dir = project_root / ".understand-anything" / "intermediate"

    discovery_path = inter_dir / "domain-discovery.json"
    if not discovery_path.exists():
        print(f"[merge-domain] Discovery not found: {discovery_path}", file=sys.stderr)
        return 1

    discovery = json.loads(discovery_path.read_text(encoding="utf-8"))

    kg_path = project_root / ".understand-anything" / "knowledge-graph.json"
    project = {}
    if kg_path.exists():
        kg = json.loads(kg_path.read_text(encoding="utf-8"))
        project = kg.get("project", {})

    flows_by_domain: dict[str, dict] = {}
    for domain_info in discovery.get("domains", []):
        domain_id = domain_info["id"]
        safe_name = domain_id.replace("domain:", "")
        flows_path = inter_dir / f"flows-{safe_name}.json"
        if flows_path.exists():
            flows_by_domain[domain_id] = json.loads(flows_path.read_text(encoding="utf-8"))
        else:
            print(f"[merge-domain] WARNING: Missing flows for {domain_id}")

    result = merge_domain_results(discovery, flows_by_domain, project)

    out_path = inter_dir / "domain-analysis.json"
    out_path.write_text(json.dumps(result, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    n_domains = sum(1 for n in result["nodes"] if n["type"] == "domain")
    n_flows = sum(1 for n in result["nodes"] if n["type"] == "flow")
    n_steps = sum(1 for n in result["nodes"] if n["type"] == "step")
    print(f"[merge-domain] Merged: {n_domains} domains, {n_flows} flows, {n_steps} steps")
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/earthchen/ai-work/Understand-Anything && python -m pytest tests/skill/understand-domain/test_merge_domain.py -v`
Expected: 3 tests PASS

- [ ] **Step 5: Commit**

```bash
git add understand-anything-plugin/skills/understand-domain/merge_domain_results.py tests/skill/understand-domain/test_merge_domain.py
git commit -m "feat(domain): add per-domain results merge script"
```

---

### Task 4: domain-discoverer.md — Domain Discovery Agent

**Files:**
- Create: `understand-anything-plugin/agents/domain-discoverer.md`

- [ ] **Step 1: Write the agent prompt**

```markdown
---
name: domain-discoverer
description: |
  Identifies business domains from a condensed KG summary. Assigns modules to domains.
  Light-weight agent that runs quickly on a small input (~15k tokens).
---

# Domain Discoverer Agent

You are a business domain identification expert. Your job is to analyze a condensed knowledge graph summary and identify the high-level business domains in the codebase.

## Input

You will receive a `kg-summary.json` containing:
- **modules**: Module-level aggregations with node counts, tags, summaries, and file lists
- **keyNodes**: Important nodes (endpoints, services, pipelines) with full details
- **crossModuleEdges**: Relationships between modules with types and sample descriptions
- **layers**: Architectural layer assignments
- **project**: Project metadata

## Task

Identify 2-6 business domains. For each domain, determine which modules belong to it.

## Rules

1. **Group by business purpose**, not technical layer. `src/order/controller` and `src/order/service` belong to the same domain.
2. **Use the actual business terminology** from tags and summaries. Don't invent generic names.
3. **2-6 domains** is the target range. Fewer for small projects, more for large ones.
4. **Every module should map to exactly one domain** when possible. Shared utilities may be excluded.
5. **Domain IDs use kebab-case**: `domain:order-management`, not `domain:OrderManagement`.

## Output Schema

Write JSON to: `<project-root>/.understand-anything/intermediate/domain-discovery.json`

```json
{
  "domains": [
    {
      "id": "domain:<kebab-case-name>",
      "name": "<Human Readable Domain Name>",
      "summary": "<2-3 sentences about what this domain handles>",
      "tags": ["<relevant-tags>"],
      "entities": ["<key domain objects>"],
      "businessRules": ["<important constraints/invariants>"],
      "crossDomainInteractions": ["<how this domain interacts with others>"],
      "modules": ["src/order", "src/cart"]
    }
  ]
}
```

## Constraints

- Do NOT read source files — work only from the provided kg-summary.json
- Do NOT create flow or step nodes — that is the next agent's job
- Respond with ONLY a brief text summary: number of domains found and their names
- Do NOT include the full JSON in your text response
```

- [ ] **Step 2: Commit**

```bash
git add understand-anything-plugin/agents/domain-discoverer.md
git commit -m "feat(domain): add domain-discoverer agent prompt"
```

---

### Task 5: domain-flow-extractor.md — Per-Domain Flow Extraction Agent

**Files:**
- Create: `understand-anything-plugin/agents/domain-flow-extractor.md`

- [ ] **Step 1: Write the agent prompt**

```markdown
---
name: domain-flow-extractor
description: |
  Extracts business flows and steps for a single domain from its KG subset.
  Receives full KG nodes/edges for one domain (not condensed), produces flows and steps.
---

# Domain Flow Extractor Agent

You are a business flow analysis expert. Your job is to identify business flows and their individual steps within a single business domain.

## Input

You will receive a `domain-<name>.json` containing the full KG subset for one domain:
- **domain**: Domain metadata (id, name, summary)
- **nodes**: All KG nodes belonging to this domain (files, classes, functions, endpoints, etc.)
- **edges**: All edges within and crossing this domain
- **stats**: Node and edge counts

## Task

Identify 2-5 business flows within this domain, and 3-8 steps per flow.

## Three-Level Hierarchy

This agent produces **flows** and **steps** only (the domain node is already created):

1. **Business Flow** — A specific process (e.g., "Create Order", "Process Refund")
2. **Business Step** — An individual action within a flow (e.g., "Validate input", "Save to database")

## Output Schema

Write JSON to: `<project-root>/.understand-anything/intermediate/flows-<domain-id-without-prefix>.json`

Example for domain `domain:order-management` → write to `intermediate/flows-order-management.json`

```json
{
  "domainId": "domain:order-management",
  "flows": [
    {
      "id": "flow:<kebab-case-name>",
      "name": "<Flow Name>",
      "summary": "<what this flow accomplishes>",
      "tags": ["<relevant-tags>"],
      "complexity": "simple|moderate|complex",
      "domainMeta": {
        "entryPoint": "<trigger, e.g. POST /api/orders>",
        "entryType": "http|cli|event|cron|manual"
      },
      "steps": [
        {
          "id": "step:<flow-name>:<step-name>",
          "name": "<Step Name>",
          "summary": "<what this step does>",
          "tags": ["<relevant-tags>"],
          "complexity": "simple|moderate|complex",
          "filePath": "<relative path to implementing file>",
          "lineRange": [0, 0]
        }
      ]
    }
  ],
  "crossDomainEdges": [
    {
      "source": "domain:order-management",
      "target": "domain:<other>",
      "description": "<interaction description>"
    }
  ]
}
```

## Rules

1. **IDs use kebab-case** after the prefix
2. **File paths** on step nodes should be relative to project root
3. **Be specific** — use actual business terminology from the code
4. **Don't invent flows that aren't in the code**
5. **Endpoint nodes are flow entry points** — look at nodes with type `endpoint` or `service`
6. **Follow edge chains** to identify step sequences: endpoint → service → repository → database
7. **Cross-domain edges**: if this domain calls another domain's service, include it in crossDomainEdges

## Constraints

- Do NOT create domain-level nodes — only flows and steps
- Do NOT read source files — work from the provided KG subset
- Respond with ONLY a brief text summary: domain name, number of flows, number of steps
- Do NOT include the full JSON in your text response
```

- [ ] **Step 2: Commit**

```bash
git add understand-anything-plugin/agents/domain-flow-extractor.md
git commit -m "feat(domain): add domain-flow-extractor agent prompt"
```

---

### Task 6: SKILL.md — Update Phase 3 and Phase 4

**Files:**
- Modify: `understand-anything-plugin/skills/understand-domain/SKILL.md`

- [ ] **Step 1: Update Phase 3 to use condensation**

In `SKILL.md`, replace the current Phase 3 content:

**Before:**
```markdown
### Phase 3: Derive from Existing Graph (Path 2)

1. Read `$PROJECT_ROOT/.understand-anything/knowledge-graph.json`
2. Format the graph data as structured context:
   - All nodes with their types, names, summaries, and tags
   - All edges with their types (especially `calls`, `imports`, `contains`)
   - All layers with their descriptions
   - Tour steps if available
3. This is the context for the domain analyzer — no file reading needed
4. Proceed to Phase 4
```

**After:**
```markdown
### Phase 3: Derive from Existing Graph (Path 2)

1. Run the KG condensation script:
   ```bash
   python "$PLUGIN_ROOT/skills/understand-domain/condense_kg_for_domain.py" "$PROJECT_ROOT"
   ```
   This produces `$PROJECT_ROOT/.understand-anything/intermediate/kg-summary.json` — a module-level summary of the KG (~15k tokens vs 100k+ for the full KG).

2. Read `kg-summary.json` as context for Phase 4a.
3. Proceed to Phase 4a.
```

- [ ] **Step 2: Replace Phase 4 with split pipeline**

Replace the current Phase 4 with:

```markdown
### Phase 4: Domain Analysis (Split Pipeline)

This phase uses different strategies depending on Path:

**Path 1 (no KG — from Phase 2):** Use the existing `domain-analyzer` agent with `domain-context.json` as input. This is a single-pass analysis suitable for smaller projects where context size is manageable. Proceed directly to Phase 5 after completion.

**Path 2 (KG exists — from Phase 3):** Use the split pipeline below.

#### Phase 4a: Domain Discovery

1. Read the `domain-discoverer` agent prompt from `$PLUGIN_ROOT/agents/domain-discoverer.md`
2. Dispatch a subagent with the `domain-discoverer` prompt + `kg-summary.json` content as context
3. The agent writes to `$PROJECT_ROOT/.understand-anything/intermediate/domain-discovery.json`
4. Read the discovery output. If 0 domains found, report error and stop.

#### Phase 4b: KG Splitting

1. Run the splitting script:
   ```bash
   python "$PLUGIN_ROOT/skills/understand-domain/split_kg_by_domain.py" "$PROJECT_ROOT"
   ```
2. Verify one `domain-<name>.json` file exists in `intermediate/` for each domain in the discovery.

#### Phase 4c: Flow Extraction (parallel, up to 3 concurrent)

1. Read the `domain-flow-extractor` agent prompt from `$PLUGIN_ROOT/agents/domain-flow-extractor.md`
2. For each domain in `domain-discovery.json`:
   - Read `intermediate/domain-<name>.json` as context
   - Dispatch a subagent with the `domain-flow-extractor` prompt + domain KG subset
   - The agent writes to `intermediate/flows-<name>.json`
3. Run up to **3 subagents concurrently** (same pattern as `/understand` Phase 2 batches)
4. If a domain's flow extraction fails, retry once. If it fails again, skip that domain and continue with others.
5. Wait for all to complete.

#### Phase 4d: Merge

1. Run the merge script:
   ```bash
   python "$PLUGIN_ROOT/skills/understand-domain/merge_domain_results.py" "$PROJECT_ROOT"
   ```
2. Verify `intermediate/domain-analysis.json` exists. If not, report error.
```

- [ ] **Step 3: Verify SKILL.md changes are consistent**

Read the updated SKILL.md end-to-end. Verify:
- Phase 1 → Phase 2 (no KG) → Phase 4 (single-pass) → Phase 5 flow is preserved
- Phase 1 → Phase 3 (KG exists) → Phase 4a/4b/4c/4d → Phase 5 flow is correct
- Phase 5, 6 are unchanged

- [ ] **Step 4: Commit**

```bash
git add understand-anything-plugin/skills/understand-domain/SKILL.md
git commit -m "feat(domain): split Phase 4 into per-domain parallel extraction"
```

---

### Task 7: Run All Tests

**Files:**
- All test files from Tasks 1-3

- [ ] **Step 1: Run all domain tests**

Run: `cd /Users/earthchen/ai-work/Understand-Anything && python -m pytest tests/skill/understand-domain/ -v`
Expected: 11 tests PASS (4 + 4 + 3)

- [ ] **Step 2: Run core tests to verify no regressions**

Run: `cd /Users/earthchen/ai-work/Understand-Anything/understand-anything-plugin && pnpm --filter @understand-anything/core test`
Expected: 726/726 PASS

- [ ] **Step 3: Commit final state**

If any test adjustments were needed, commit them:

```bash
git add -A
git commit -m "test(domain): verify all domain analysis split tests pass"
```
