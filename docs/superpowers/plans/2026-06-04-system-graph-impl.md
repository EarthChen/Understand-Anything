# System Graph Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a lightweight system-level architecture visualization for microservice projects — a `system-graph.json` generator + Dashboard `SystemOverview` view with drill-down navigation.

**Architecture:** A Python script (`build-system-graph.py`) scans child service directories for existing KGs, extracts high-level service metadata + endpoints + RPC edges, and optionally enriches with wiki cross-service data. Dashboard adds a new `"system"` view mode with a force-directed service topology graph (d3-force via the pattern in `KnowledgeGraphView`).

**Tech Stack:** Python (unittest), TypeScript/React (Vitest), Zustand, d3-force, Vite middleware

**Spec:** `docs/superpowers/specs/2026-06-04-system-graph-design.md`

---

## File Structure

### New files

| File | Responsibility |
|---|---|
| `understand-anything-plugin/skills/understand-wiki/build-system-graph.py` | CLI script: discover services, extract KG metadata, build system-graph.json |
| `tests/skill/understand-wiki/test_build_system_graph.py` | Unit tests for build-system-graph.py |
| `understand-anything-plugin/packages/dashboard/src/components/SystemOverview.tsx` | React component: interactive service topology graph |
| `understand-anything-plugin/packages/dashboard/src/__tests__/system-overview.test.tsx` | Integration tests for SystemOverview component |

### Modified files

| File | Change |
|---|---|
| `understand-anything-plugin/packages/dashboard/src/store.ts` | Add `"system"` to ViewMode; add systemGraph state slice |
| `understand-anything-plugin/packages/dashboard/src/App.tsx` | Add System tab button; render SystemOverview when active |
| `understand-anything-plugin/packages/dashboard/vite.config.ts` | Add `/system-graph.json` endpoint in Vite middleware |
| `understand-anything-plugin/packages/dashboard/src/locales/en.ts` | Add i18n keys for system view |
| `understand-anything-plugin/packages/dashboard/src/locales/zh.ts` | Add i18n keys for system view (Chinese) |
| `understand-anything-plugin/skills/understand-wiki/SKILL.md` | Add build-system-graph.py invocation after Phase 3 |

---

## Task 1: `build-system-graph.py` — Service Discovery + Metadata Extraction

**Files:**
- Create: `understand-anything-plugin/skills/understand-wiki/build-system-graph.py`
- Test: `tests/skill/understand-wiki/test_build_system_graph.py`

- [ ] **Step 1: Write the failing test — service discovery**

```python
"""Tests for build-system-graph.py — system-level graph generator."""
import importlib.util
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parents[3]
_MODULE_PATH = (
    _REPO_ROOT
    / "understand-anything-plugin"
    / "skills"
    / "understand-wiki"
    / "build-system-graph.py"
)

spec = importlib.util.spec_from_file_location("build_system_graph", _MODULE_PATH)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

discover_services = mod.discover_services


def _make_kg(name="test-service", desc="A test service", languages=None,
             frameworks=None, nodes=None, edges=None):
    """Build a minimal knowledge graph dict."""
    return {
        "version": "1.0.0",
        "project": {
            "name": name,
            "description": desc,
            "languages": languages or ["Java"],
            "frameworks": frameworks or ["Spring Boot"],
            "analyzedAt": "2026-06-04T00:00:00Z",
            "gitCommitHash": "abc1234",
        },
        "nodes": nodes or [],
        "edges": edges or [],
        "layers": [],
        "tour": [],
    }


class TestDiscoverServices(unittest.TestCase):
    def setUp(self):
        self.tmpdir = tempfile.mkdtemp()

    def test_discovers_services_with_kg(self):
        """Services with knowledge-graph.json are discovered."""
        svc_a = os.path.join(self.tmpdir, "order-service", ".understand-anything")
        os.makedirs(svc_a)
        with open(os.path.join(svc_a, "knowledge-graph.json"), "w") as f:
            json.dump(_make_kg("order-service"), f)

        svc_b = os.path.join(self.tmpdir, "payment-service", ".understand-anything")
        os.makedirs(svc_b)
        with open(os.path.join(svc_b, "knowledge-graph.json"), "w") as f:
            json.dump(_make_kg("payment-service"), f)

        # Directory without KG — should NOT be discovered
        os.makedirs(os.path.join(self.tmpdir, "no-kg-service"))

        result = discover_services(self.tmpdir)
        names = sorted([s["name"] for s in result])
        self.assertEqual(names, ["order-service", "payment-service"])

    def test_excludes_services_from_config(self):
        """Services listed in excludeServices config are skipped."""
        svc = os.path.join(self.tmpdir, "common", ".understand-anything")
        os.makedirs(svc)
        with open(os.path.join(svc, "knowledge-graph.json"), "w") as f:
            json.dump(_make_kg("common"), f)

        config_dir = os.path.join(self.tmpdir, ".understand-anything")
        os.makedirs(config_dir, exist_ok=True)
        with open(os.path.join(config_dir, "config.json"), "w") as f:
            json.dump({"excludeServices": ["common"]}, f)

        result = discover_services(self.tmpdir)
        self.assertEqual(len(result), 0)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/skill/understand-wiki/test_build_system_graph.py::TestDiscoverServices -v`
Expected: FAIL with `ModuleNotFoundError` or `AttributeError` (module doesn't exist yet)

- [ ] **Step 3: Write minimal implementation — discover_services()**

Create `understand-anything-plugin/skills/understand-wiki/build-system-graph.py`:

```python
#!/usr/bin/env python3
"""
build-system-graph.py — Generate a system-level graph from per-service KGs.

Scans child directories for knowledge-graph.json files, extracts service
metadata, endpoints, and RPC edges, optionally enriches with wiki
cross-service data. Outputs system-graph.json.

Usage:
    python build-system-graph.py <project-root> [--services="svc1 svc2"] [--output=<path>]
"""

import json
import os
import sys
from pathlib import Path
from typing import Any


HIDDEN_DIRS = {".", "..", ".git", ".understand-anything", "node_modules", "dist", "build", "target"}


def discover_services(project_root: str, exclude: list[str] | None = None) -> list[dict[str, Any]]:
    """Discover child services that have a knowledge graph.

    Returns list of dicts: {name, path, kg_path}
    """
    root = Path(project_root)
    exclude_set = set(exclude or [])

    # Load parent-level excludeServices config
    parent_config = root / ".understand-anything" / "config.json"
    if parent_config.exists():
        try:
            cfg = json.loads(parent_config.read_text(encoding="utf-8"))
            for svc in cfg.get("excludeServices", []):
                exclude_set.add(svc)
        except (json.JSONDecodeError, OSError):
            pass

    services = []
    for entry in sorted(root.iterdir()):
        if not entry.is_dir():
            continue
        if entry.name in HIDDEN_DIRS or entry.name.startswith("."):
            continue
        if entry.name in exclude_set:
            continue

        kg_path = entry / ".understand-anything" / "knowledge-graph.json"
        if kg_path.exists():
            services.append({
                "name": entry.name,
                "path": str(entry),
                "kg_path": str(kg_path),
            })

    return services
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/skill/understand-wiki/test_build_system_graph.py::TestDiscoverServices -v`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add understand-anything-plugin/skills/understand-wiki/build-system-graph.py tests/skill/understand-wiki/test_build_system_graph.py
git commit -m "feat(system-graph): add service discovery with exclude filter"
```

---

## Task 2: `build-system-graph.py` — KG Metadata Extraction + Node/Edge Building

**Files:**
- Modify: `understand-anything-plugin/skills/understand-wiki/build-system-graph.py`
- Modify: `tests/skill/understand-wiki/test_build_system_graph.py`

- [ ] **Step 1: Write the failing test — extract_service_info()**

Add to `test_build_system_graph.py`:

```python
extract_service_info = mod.extract_service_info
build_system_graph = mod.build_system_graph


class TestExtractServiceInfo(unittest.TestCase):
    def test_extracts_metadata_and_stats(self):
        """Extracts project metadata and node/edge counts."""
        kg = _make_kg(
            "order-service", "Order management",
            languages=["Java", "SQL"],
            frameworks=["Spring Boot", "MyBatis"],
            nodes=[
                {"id": "file:src/Order.java", "type": "file", "name": "Order.java", "summary": "Order entity"},
                {"id": "endpoint:src/OrderController.java:POST /orders", "type": "endpoint",
                 "name": "Create Order", "summary": "Creates an order", "filePath": "src/OrderController.java"},
                {"id": "function:src/OrderService.java:createOrder", "type": "function",
                 "name": "createOrder", "summary": "Creates order logic"},
            ],
            edges=[
                {"source": "file:src/Order.java", "target": "function:src/OrderService.java:createOrder",
                 "type": "contains"},
            ],
        )

        info = extract_service_info("order-service", kg)
        self.assertEqual(info["name"], "order-service")
        self.assertEqual(info["project_name"], "Order management")
        self.assertEqual(info["languages"], ["Java", "SQL"])
        self.assertEqual(info["stats"]["nodes"], 3)
        self.assertEqual(info["stats"]["edges"], 1)
        self.assertEqual(len(info["endpoints"]), 1)
        self.assertEqual(info["endpoints"][0]["id"], "endpoint:src/OrderController.java:POST /orders")

    def test_extracts_rpc_edges(self):
        """Extracts provides_rpc and consumes_rpc edges."""
        kg = _make_kg(nodes=[
            {"id": "file:src/PaymentFacade.java", "type": "file", "name": "PaymentFacade"},
        ], edges=[
            {"source": "file:src/OrderService.java", "target": "file:src/PaymentFacade.java",
             "type": "consumes_rpc", "detail": "PaymentFacade.createPayment()"},
            {"source": "file:src/PaymentFacadeImpl.java", "target": "file:src/PaymentFacade.java",
             "type": "provides_rpc", "detail": "PaymentFacade"},
        ])

        info = extract_service_info("payment-service", kg)
        self.assertEqual(len(info["rpc_provides"]), 1)
        self.assertEqual(len(info["rpc_consumes"]), 1)


class TestBuildSystemGraph(unittest.TestCase):
    def setUp(self):
        self.tmpdir = tempfile.mkdtemp()

    def test_builds_graph_with_two_services(self):
        """Builds system graph with service nodes and contains edges."""
        for svc_name in ["order-service", "payment-service"]:
            svc_dir = os.path.join(self.tmpdir, svc_name, ".understand-anything")
            os.makedirs(svc_dir)
            kg = _make_kg(
                svc_name, f"{svc_name} description",
                nodes=[
                    {"id": f"endpoint:{svc_name}:GET /health", "type": "endpoint",
                     "name": "Health Check", "summary": "Health endpoint"},
                ],
            )
            with open(os.path.join(svc_dir, "knowledge-graph.json"), "w") as f:
                json.dump(kg, f)

        graph = build_system_graph(self.tmpdir)

        self.assertEqual(graph["version"], "1.0.0")
        self.assertEqual(graph["project"]["serviceCount"], 2)

        svc_nodes = [n for n in graph["nodes"] if n["type"] == "microservice"]
        self.assertEqual(len(svc_nodes), 2)

        ep_nodes = [n for n in graph["nodes"] if n["type"] == "endpoint"]
        self.assertEqual(len(ep_nodes), 2)

        contains_edges = [e for e in graph["edges"] if e["type"] == "contains"]
        self.assertEqual(len(contains_edges), 2)

    def test_matches_rpc_across_services(self):
        """Matches consumes_rpc → provides_rpc across services."""
        order_kg = _make_kg("order-service", nodes=[
            {"id": "file:src/OrderService.java", "type": "file", "name": "OrderService"},
        ], edges=[
            {"source": "file:src/OrderService.java", "target": "file:src/PaymentFacade.java",
             "type": "consumes_rpc", "detail": "PaymentFacade.createPayment()"},
        ])

        payment_kg = _make_kg("payment-service", nodes=[
            {"id": "file:src/PaymentFacadeImpl.java", "type": "file", "name": "PaymentFacadeImpl"},
        ], edges=[
            {"source": "file:src/PaymentFacadeImpl.java", "target": "file:src/PaymentFacade.java",
             "type": "provides_rpc", "detail": "PaymentFacade"},
        ])

        for name, kg in [("order-service", order_kg), ("payment-service", payment_kg)]:
            d = os.path.join(self.tmpdir, name, ".understand-anything")
            os.makedirs(d)
            with open(os.path.join(d, "knowledge-graph.json"), "w") as f:
                json.dump(kg, f)

        graph = build_system_graph(self.tmpdir)

        rpc_edges = [e for e in graph["edges"] if e["type"] == "rpc_call"]
        self.assertEqual(len(rpc_edges), 1)
        self.assertEqual(rpc_edges[0]["source"], "microservice:order-service")
        self.assertEqual(rpc_edges[0]["target"], "microservice:payment-service")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/skill/understand-wiki/test_build_system_graph.py -v -k "TestExtractServiceInfo or TestBuildSystemGraph"`
Expected: FAIL with `AttributeError: module 'build_system_graph' has no attribute 'extract_service_info'`

- [ ] **Step 3: Write implementation — extract_service_info() + build_system_graph()**

Add to `build-system-graph.py`:

```python
def extract_service_info(service_name: str, kg: dict[str, Any]) -> dict[str, Any]:
    """Extract high-level info from a service's knowledge graph."""
    project = kg.get("project", {})
    nodes = kg.get("nodes", [])
    edges = kg.get("edges", [])

    endpoints = [n for n in nodes if n.get("type") == "endpoint"]
    rpc_provides = [e for e in edges if e.get("type") == "provides_rpc"]
    rpc_consumes = [e for e in edges if e.get("type") == "consumes_rpc"]

    file_types = {"file", "config", "document", "service", "pipeline", "table", "schema", "resource", "endpoint"}
    file_count = sum(1 for n in nodes if n.get("type") in file_types)

    return {
        "name": service_name,
        "project_name": project.get("description", service_name),
        "languages": project.get("languages", []),
        "frameworks": project.get("frameworks", []),
        "stats": {
            "nodes": len(nodes),
            "edges": len(edges),
            "files": file_count,
        },
        "endpoints": endpoints,
        "rpc_provides": rpc_provides,
        "rpc_consumes": rpc_consumes,
        "kg_commit": project.get("gitCommitHash", ""),
    }


def _match_rpc_edges(service_infos: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Match consumes_rpc → provides_rpc across services to build cross-service edges."""
    # Build provider index: interface_name → service_name
    providers: dict[str, str] = {}
    for info in service_infos:
        for edge in info["rpc_provides"]:
            iface = edge.get("detail", "").split(".")[0].strip()
            if iface:
                providers[iface] = info["name"]

    rpc_edges = []
    seen = set()
    for info in service_infos:
        for edge in info["rpc_consumes"]:
            detail = edge.get("detail", "")
            iface = detail.split(".")[0].strip()
            target_svc = providers.get(iface)
            if target_svc and target_svc != info["name"]:
                key = (info["name"], target_svc, iface)
                if key not in seen:
                    seen.add(key)
                    rpc_edges.append({
                        "source": f"microservice:{info['name']}",
                        "target": f"microservice:{target_svc}",
                        "type": "rpc_call",
                        "weight": 0.8,
                        "detail": {
                            "interface": iface,
                            "method": detail,
                            "rpcType": "rpc",
                            "evidence": "kg-matched",
                        },
                    })

    return rpc_edges


def build_system_graph(project_root: str, services: list[dict] | None = None) -> dict[str, Any]:
    """Build the system-level graph from per-service KGs."""
    if services is None:
        services = discover_services(project_root)

    if not services:
        return {"version": "1.0.0", "project": {"serviceCount": 0}, "nodes": [], "edges": [], "serviceIndex": {}}

    service_infos = []
    for svc in services:
        try:
            kg = json.loads(Path(svc["kg_path"]).read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as e:
            print(f"  Warning: skipping {svc['name']}: {e}", file=sys.stderr)
            continue
        service_infos.append(extract_service_info(svc["name"], kg))

    nodes = []
    edges = []
    service_index = {}
    total_nodes = 0
    total_edges = 0

    for info in service_infos:
        svc_id = f"microservice:{info['name']}"
        svc_path = str(Path(project_root) / info["name"])
        ua_path = os.path.join(svc_path, ".understand-anything")

        nodes.append({
            "id": svc_id,
            "type": "microservice",
            "name": info["project_name"],
            "summary": info["project_name"],
            "languages": info["languages"],
            "frameworks": info["frameworks"],
            "stats": info["stats"],
            "kgPath": f"{info['name']}/.understand-anything/knowledge-graph.json",
            "wikiPath": f"{info['name']}/.understand-anything/wiki/",
            "domainPath": f"{info['name']}/.understand-anything/domain-graph.json",
        })

        for ep in info["endpoints"][:5]:
            ep_id = f"endpoint:{info['name']}:{ep.get('name', ep['id'])}"
            nodes.append({
                "id": ep_id,
                "type": "endpoint",
                "name": ep.get("name", ""),
                "summary": ep.get("summary", ""),
                "service": info["name"],
            })
            edges.append({
                "source": svc_id,
                "target": ep_id,
                "type": "contains",
                "weight": 1.0,
            })

        total_nodes += info["stats"]["nodes"]
        total_edges += info["stats"]["edges"]

        service_index[info["name"]] = {
            "hasKg": True,
            "hasWiki": os.path.exists(os.path.join(ua_path, "wiki", "meta.json")),
            "hasDomain": os.path.exists(os.path.join(ua_path, "domain-graph.json")),
            "kgCommit": info["kg_commit"],
        }

    # Cross-service RPC edges
    rpc_edges = _match_rpc_edges(service_infos)
    edges.extend(rpc_edges)

    from datetime import datetime, timezone
    return {
        "version": "1.0.0",
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "project": {
            "name": Path(project_root).name,
            "serviceCount": len(service_infos),
            "totalNodes": total_nodes,
            "totalEdges": total_edges,
        },
        "nodes": nodes,
        "edges": edges,
        "serviceIndex": service_index,
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/skill/understand-wiki/test_build_system_graph.py -v`
Expected: PASS (all tests in TestDiscoverServices, TestExtractServiceInfo, TestBuildSystemGraph)

- [ ] **Step 5: Commit**

```bash
git add understand-anything-plugin/skills/understand-wiki/build-system-graph.py tests/skill/understand-wiki/test_build_system_graph.py
git commit -m "feat(system-graph): add KG extraction + RPC matching + graph builder"
```

---

## Task 3: `build-system-graph.py` — Wiki Enrichment + CLI Entry Point

**Files:**
- Modify: `understand-anything-plugin/skills/understand-wiki/build-system-graph.py`
- Modify: `tests/skill/understand-wiki/test_build_system_graph.py`

- [ ] **Step 1: Write the failing test — wiki enrichment**

Add to `test_build_system_graph.py`:

```python
enrich_from_wiki = mod.enrich_from_wiki


class TestWikiEnrichment(unittest.TestCase):
    def setUp(self):
        self.tmpdir = tempfile.mkdtemp()

    def test_enriches_edges_from_architecture_json(self):
        """Merges crossServiceCalls from wiki architecture.json."""
        # Create minimal service KGs
        for svc_name in ["order-service", "payment-service"]:
            d = os.path.join(self.tmpdir, svc_name, ".understand-anything")
            os.makedirs(d)
            with open(os.path.join(d, "knowledge-graph.json"), "w") as f:
                json.dump(_make_kg(svc_name), f)

        # Create parent wiki with architecture.json
        wiki_dir = os.path.join(self.tmpdir, ".understand-anything", "wiki")
        os.makedirs(wiki_dir)
        arch = {
            "crossServiceCalls": [
                {
                    "caller": {"service": "order-service", "method": "OrderService.createOrder()"},
                    "callee": {"service": "payment-service", "interface": "PaymentFacade",
                               "method": "createPayment()"},
                    "type": "moa_rpc",
                    "evidence": "script-matched",
                },
            ],
        }
        with open(os.path.join(wiki_dir, "architecture.json"), "w") as f:
            json.dump(arch, f)

        graph = build_system_graph(self.tmpdir)
        enriched = enrich_from_wiki(graph, self.tmpdir)

        wiki_edges = [e for e in enriched["edges"]
                      if e.get("detail", {}).get("evidence") == "wiki-enriched"]
        self.assertGreaterEqual(len(wiki_edges), 1)

    def test_no_wiki_returns_graph_unchanged(self):
        """When no wiki exists, graph is returned as-is."""
        graph = {"nodes": [], "edges": [], "version": "1.0.0", "project": {}, "serviceIndex": {}}
        result = enrich_from_wiki(graph, self.tmpdir)
        self.assertEqual(result, graph)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/skill/understand-wiki/test_build_system_graph.py::TestWikiEnrichment -v`
Expected: FAIL with `AttributeError: module has no attribute 'enrich_from_wiki'`

- [ ] **Step 3: Write implementation — enrich_from_wiki() + main()**

Add to `build-system-graph.py`:

```python
def enrich_from_wiki(graph: dict[str, Any], project_root: str) -> dict[str, Any]:
    """Enrich system graph with cross-service data from wiki architecture.json."""
    arch_path = Path(project_root) / ".understand-anything" / "wiki" / "architecture.json"
    if not arch_path.exists():
        return graph

    try:
        arch = json.loads(arch_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return graph

    node_ids = {n["id"] for n in graph["nodes"]}
    existing_edges = {(e["source"], e["target"], e["type"]) for e in graph["edges"]}

    for call in arch.get("crossServiceCalls", []):
        caller_svc = call.get("caller", {}).get("service", "")
        callee_svc = call.get("callee", {}).get("service", "")
        source_id = f"microservice:{caller_svc}"
        target_id = f"microservice:{callee_svc}"

        if source_id not in node_ids or target_id not in node_ids:
            continue

        edge_key = (source_id, target_id, "rpc_call")
        if edge_key in existing_edges:
            continue

        iface = call.get("callee", {}).get("interface", "")
        method = call.get("callee", {}).get("method", "")
        graph["edges"].append({
            "source": source_id,
            "target": target_id,
            "type": "rpc_call",
            "weight": 0.8,
            "detail": {
                "interface": iface,
                "method": f"{iface}.{method}" if iface and method else method,
                "rpcType": call.get("type", "rpc"),
                "evidence": "wiki-enriched",
            },
        })

    # Enrich overview if available
    ovw_path = Path(project_root) / ".understand-anything" / "wiki" / "overview.json"
    if ovw_path.exists():
        try:
            ovw = json.loads(ovw_path.read_text(encoding="utf-8"))
            graph["project"]["name"] = ovw.get("name", graph["project"].get("name", ""))
            graph["project"]["description"] = ovw.get("description", "")
        except (OSError, json.JSONDecodeError):
            pass

    return graph


def main() -> None:
    import argparse

    parser = argparse.ArgumentParser(description="Build system-level graph from per-service KGs")
    parser.add_argument("project_root", help="Parent directory containing service subdirectories")
    parser.add_argument("--services", default="", help="Space-separated service names (default: auto-discover)")
    parser.add_argument("--output", default="", help="Output path (default: <project_root>/.understand-anything/system-graph.json)")
    args = parser.parse_args()

    project_root = os.path.abspath(args.project_root)
    if not os.path.isdir(project_root):
        print(f"Error: {project_root} is not a directory", file=sys.stderr)
        sys.exit(1)

    exclude = None
    services = None
    if args.services:
        svc_names = args.services.split()
        services = []
        for name in svc_names:
            kg_path = os.path.join(project_root, name, ".understand-anything", "knowledge-graph.json")
            if os.path.exists(kg_path):
                services.append({"name": name, "path": os.path.join(project_root, name), "kg_path": kg_path})
            else:
                print(f"  Warning: {name} has no knowledge-graph.json, skipping", file=sys.stderr)

    print(f"[system-graph] Scanning {project_root}...", file=sys.stderr)

    graph = build_system_graph(project_root, services=services)
    graph = enrich_from_wiki(graph, project_root)

    output_path = args.output or os.path.join(project_root, ".understand-anything", "system-graph.json")
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(graph, f, indent=2, ensure_ascii=False)

    svc_count = graph["project"].get("serviceCount", 0)
    node_count = len(graph["nodes"])
    edge_count = len(graph["edges"])
    print(f"[system-graph] Generated: {svc_count} services, {node_count} nodes, {edge_count} edges", file=sys.stderr)
    print(f"[system-graph] Written to {output_path}", file=sys.stderr)


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Run all tests**

Run: `python -m pytest tests/skill/understand-wiki/test_build_system_graph.py -v`
Expected: PASS (all tests)

- [ ] **Step 5: Commit**

```bash
git add understand-anything-plugin/skills/understand-wiki/build-system-graph.py tests/skill/understand-wiki/test_build_system_graph.py
git commit -m "feat(system-graph): add wiki enrichment + CLI entry point"
```

---

## Task 4: Dashboard — Zustand Store + Vite Middleware + i18n

**Files:**
- Modify: `understand-anything-plugin/packages/dashboard/src/store.ts`
- Modify: `understand-anything-plugin/packages/dashboard/vite.config.ts`
- Modify: `understand-anything-plugin/packages/dashboard/src/locales/en.ts`
- Modify: `understand-anything-plugin/packages/dashboard/src/locales/zh.ts`

- [ ] **Step 1: Read current store.ts to understand ViewMode type and state shape**

Read: `understand-anything-plugin/packages/dashboard/src/store.ts` — find the `ViewMode` type definition and the state interface.

- [ ] **Step 2: Add `"system"` to ViewMode and system graph state slice**

In `store.ts`, locate the ViewMode type and add `"system"`:

```typescript
// Before
type ViewMode = "structural" | "domain" | "knowledge" | "wiki";

// After
type ViewMode = "structural" | "domain" | "knowledge" | "wiki" | "system";
```

Add state fields to the store interface:

```typescript
// Add to DashboardState interface:
systemGraph: any | null;
setSystemGraph: (graph: any | null) => void;
```

Add to the store `create()` call:

```typescript
systemGraph: null,
setSystemGraph: (graph) => set({ systemGraph: graph }),
```

- [ ] **Step 3: Add Vite middleware endpoint for system-graph.json**

In `vite.config.ts`, locate the `serve-knowledge-graph` plugin's `configureServer` handler. Add a new route handler for `/system-graph.json` following the same pattern as `knowledge-graph.json`:

```typescript
// Add alongside existing routes in the middleware
if (req.url?.startsWith("/system-graph.json")) {
  if (!checkToken(req, res)) return;
  const candidates = graphFileCandidates("system-graph.json");
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      const content = fs.readFileSync(candidate, "utf-8");
      res.setHeader("Content-Type", "application/json");
      res.end(content);
      return;
    }
  }
  res.statusCode = 404;
  res.end(JSON.stringify({ error: "system-graph.json not found" }));
  return;
}
```

- [ ] **Step 4: Add i18n keys**

In `en.ts`, add to the labels object:

```typescript
systemView: "System",
systemOverview: "System Overview",
systemServiceCount: "Services",
systemTotalNodes: "Total Nodes",
systemDrillDown: "Click a service to explore",
```

In `zh.ts`, add corresponding keys:

```typescript
systemView: "系统视图",
systemOverview: "系统概览",
systemServiceCount: "服务数量",
systemTotalNodes: "总节点数",
systemDrillDown: "点击服务节点深入探索",
```

- [ ] **Step 5: Commit**

```bash
git add understand-anything-plugin/packages/dashboard/src/store.ts \
       understand-anything-plugin/packages/dashboard/vite.config.ts \
       understand-anything-plugin/packages/dashboard/src/locales/en.ts \
       understand-anything-plugin/packages/dashboard/src/locales/zh.ts
git commit -m "feat(dashboard): add system view mode, API endpoint, and i18n keys"
```

---

## Task 5: Dashboard — SystemOverview Component

**Files:**
- Create: `understand-anything-plugin/packages/dashboard/src/components/SystemOverview.tsx`
- Create: `understand-anything-plugin/packages/dashboard/src/__tests__/system-overview.test.tsx`

- [ ] **Step 1: Write the failing test — SystemOverview renders service nodes**

Create `understand-anything-plugin/packages/dashboard/src/__tests__/system-overview.test.tsx`:

```typescript
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SystemOverview from "../components/SystemOverview";
import { useDashboardStore } from "../store";

const mockSystemGraph = {
  version: "1.0.0",
  generatedAt: "2026-06-04T12:00:00Z",
  project: {
    name: "Test System",
    serviceCount: 2,
    totalNodes: 500,
    totalEdges: 800,
  },
  nodes: [
    {
      id: "microservice:order-service",
      type: "microservice",
      name: "Order Service",
      summary: "Handles orders",
      languages: ["Java"],
      frameworks: ["Spring Boot"],
      stats: { nodes: 300, edges: 500, files: 40 },
      kgPath: "order-service/.understand-anything/knowledge-graph.json",
    },
    {
      id: "microservice:payment-service",
      type: "microservice",
      name: "Payment Service",
      summary: "Handles payments",
      languages: ["Java"],
      frameworks: ["Spring Boot"],
      stats: { nodes: 200, edges: 300, files: 25 },
      kgPath: "payment-service/.understand-anything/knowledge-graph.json",
    },
  ],
  edges: [
    {
      source: "microservice:order-service",
      target: "microservice:payment-service",
      type: "rpc_call",
      weight: 0.8,
      detail: { interface: "PaymentFacade", method: "createPayment()", rpcType: "moa" },
    },
  ],
  serviceIndex: {
    "order-service": { hasKg: true, hasWiki: true, hasDomain: false },
    "payment-service": { hasKg: true, hasWiki: false, hasDomain: false },
  },
};

describe("SystemOverview", () => {
  beforeEach(() => {
    useDashboardStore.setState({ systemGraph: mockSystemGraph });
  });

  afterEach(() => {
    useDashboardStore.setState({ systemGraph: null });
  });

  it("renders system name and service count", () => {
    render(<SystemOverview />);
    expect(screen.getByText("Test System")).toBeInTheDocument();
    expect(screen.getByText(/2/)).toBeInTheDocument();
  });

  it("renders service list in sidebar", () => {
    render(<SystemOverview />);
    expect(screen.getByText("Order Service")).toBeInTheDocument();
    expect(screen.getByText("Payment Service")).toBeInTheDocument();
  });

  it("shows empty state when no system graph", () => {
    useDashboardStore.setState({ systemGraph: null });
    render(<SystemOverview />);
    expect(screen.getByText(/no system graph/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd understand-anything-plugin/packages/dashboard && pnpm test -- --run src/__tests__/system-overview.test.tsx`
Expected: FAIL (component doesn't exist)

- [ ] **Step 3: Write SystemOverview component (MVP)**

Create `understand-anything-plugin/packages/dashboard/src/components/SystemOverview.tsx`:

```tsx
import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCenter,
  forceCollide,
  type SimulationNodeDatum,
  type SimulationLinkDatum,
} from "d3-force";
import { useDashboardStore } from "../store";
import { useLocale } from "../locales";

interface SystemNode extends SimulationNodeDatum {
  id: string;
  type: string;
  name: string;
  summary: string;
  languages?: string[];
  frameworks?: string[];
  stats?: { nodes: number; edges: number; files: number };
}

interface SystemEdge extends SimulationLinkDatum<SystemNode> {
  type: string;
  detail?: { interface?: string; method?: string; rpcType?: string };
}

const EDGE_COLORS: Record<string, string> = {
  rpc_call: "#3b82f6",
  event: "#22c55e",
  shared_db: "#f59e0b",
  contains: "#94a3b8",
};

export default function SystemOverview() {
  const systemGraph = useDashboardStore((s) => s.systemGraph);
  const setViewMode = useDashboardStore((s) => s.setViewMode);
  const t = useLocale();
  const svgRef = useRef<SVGSVGElement>(null);
  const simRef = useRef<ReturnType<typeof forceSimulation> | null>(null);

  const { nodes, edges } = useMemo(() => {
    if (!systemGraph) return { nodes: [] as SystemNode[], edges: [] as SystemEdge[] };
    const svcNodes = systemGraph.nodes
      .filter((n: any) => n.type === "microservice")
      .map((n: any) => ({ ...n }));
    const svcIds = new Set(svcNodes.map((n: SystemNode) => n.id));
    const svcEdges = systemGraph.edges
      .filter((e: any) => svcIds.has(e.source) && svcIds.has(e.target))
      .map((e: any) => ({ ...e }));
    return { nodes: svcNodes, edges: svcEdges };
  }, [systemGraph]);

  useEffect(() => {
    if (!svgRef.current || nodes.length === 0) return;

    const svg = svgRef.current;
    const width = svg.clientWidth || 800;
    const height = svg.clientHeight || 600;

    const sim = forceSimulation<SystemNode>(nodes)
      .force(
        "link",
        forceLink<SystemNode, SystemEdge>(edges)
          .id((d) => d.id)
          .distance(200)
      )
      .force("charge", forceManyBody().strength(-500))
      .force("center", forceCenter(width / 2, height / 2))
      .force("collide", forceCollide(60));

    simRef.current = sim;

    sim.on("tick", () => {
      svg.querySelectorAll<SVGLineElement>(".sys-edge").forEach((el, i) => {
        const edge = edges[i];
        if (!edge) return;
        const src = edge.source as SystemNode;
        const tgt = edge.target as SystemNode;
        el.setAttribute("x1", String(src.x ?? 0));
        el.setAttribute("y1", String(src.y ?? 0));
        el.setAttribute("x2", String(tgt.x ?? 0));
        el.setAttribute("y2", String(tgt.y ?? 0));
      });
      svg.querySelectorAll<SVGGElement>(".sys-node").forEach((el, i) => {
        const node = nodes[i];
        if (!node) return;
        el.setAttribute("transform", `translate(${node.x ?? 0},${node.y ?? 0})`);
      });
    });

    return () => {
      sim.stop();
    };
  }, [nodes, edges]);

  const handleNodeClick = useCallback(
    (node: SystemNode) => {
      setViewMode("structural");
    },
    [setViewMode]
  );

  if (!systemGraph) {
    return (
      <div className="flex items-center justify-center h-full text-gray-500">
        <p>No system graph found. Run <code>build-system-graph.py</code> to generate one.</p>
      </div>
    );
  }

  const { project, serviceIndex } = systemGraph;

  return (
    <div className="flex h-full">
      {/* Sidebar */}
      <div className="w-64 border-r border-gray-200 dark:border-gray-700 overflow-y-auto p-4">
        <h2 className="text-lg font-semibold mb-2">{project.name || t.systemOverview}</h2>
        <div className="text-sm text-gray-500 mb-4">
          {project.serviceCount} {t.systemServiceCount}
        </div>
        <ul className="space-y-2">
          {nodes.map((node) => {
            const svcName = node.id.replace("microservice:", "");
            const idx = serviceIndex?.[svcName];
            return (
              <li
                key={node.id}
                className="p-2 rounded hover:bg-gray-100 dark:hover:bg-gray-800 cursor-pointer"
                onClick={() => handleNodeClick(node)}
              >
                <div className="font-medium text-sm">{node.name}</div>
                <div className="text-xs text-gray-400">
                  {node.languages?.join(", ")}
                  {idx?.hasKg && " · KG"}
                  {idx?.hasWiki && " · Wiki"}
                  {idx?.hasDomain && " · Domain"}
                </div>
              </li>
            );
          })}
        </ul>
      </div>
      {/* Graph canvas */}
      <div className="flex-1 relative">
        <svg ref={svgRef} className="w-full h-full">
          <defs>
            <marker id="arrow" viewBox="0 0 10 10" refX="30" refY="5"
              markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="#94a3b8" />
            </marker>
          </defs>
          {edges.map((edge, i) => (
            <line
              key={i}
              className="sys-edge"
              stroke={EDGE_COLORS[edge.type] || EDGE_COLORS.contains}
              strokeWidth={2}
              markerEnd="url(#arrow)"
            />
          ))}
          {nodes.map((node, i) => (
            <g
              key={node.id}
              className="sys-node cursor-pointer"
              onClick={() => handleNodeClick(node)}
            >
              <circle r={30} fill="#3b82f6" opacity={0.8} />
              <text textAnchor="middle" dy={4} fill="white" fontSize={10} fontWeight="bold">
                {node.name.length > 12 ? node.name.slice(0, 12) + "…" : node.name}
              </text>
              <text textAnchor="middle" dy={46} fill="#6b7280" fontSize={9}>
                {node.stats?.nodes ?? 0} nodes
              </text>
            </g>
          ))}
        </svg>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd understand-anything-plugin/packages/dashboard && pnpm test -- --run src/__tests__/system-overview.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add understand-anything-plugin/packages/dashboard/src/components/SystemOverview.tsx \
       understand-anything-plugin/packages/dashboard/src/__tests__/system-overview.test.tsx
git commit -m "feat(dashboard): add SystemOverview component with d3-force service topology"
```

---

## Task 6: Dashboard — App.tsx Integration (Tab + Data Loading)

**Files:**
- Modify: `understand-anything-plugin/packages/dashboard/src/App.tsx`

- [ ] **Step 1: Read current App.tsx to understand tab rendering and data loading**

Read: `understand-anything-plugin/packages/dashboard/src/App.tsx` — find the header tab buttons and main content switch.

- [ ] **Step 2: Add System tab button in header**

Locate the view mode toggle buttons (where `"structural"`, `"domain"`, `"wiki"` are rendered). Add a System tab:

```tsx
{systemGraph && (
  <button
    onClick={() => setViewMode("system")}
    className={`px-3 py-1 rounded text-sm ${viewMode === "system" ? "bg-blue-600 text-white" : "text-gray-600"}`}
  >
    {t.systemView}
  </button>
)}
```

- [ ] **Step 3: Add SystemOverview rendering in main content switch**

Locate the main content conditional rendering (around line 698-706). Add before the other conditions:

```tsx
import SystemOverview from "./components/SystemOverview";

// In the main content area:
{viewMode === "system" && systemGraph ? (
  <SystemOverview />
) : viewMode === "wiki" ? (
  // ... existing wiki rendering
```

- [ ] **Step 4: Add system-graph.json data loading**

In the data loading `useEffect` (where knowledge-graph.json is fetched), add:

```typescript
// Load system graph (optional — may not exist)
fetch(dataUrl("system-graph.json"))
  .then((r) => (r.ok ? r.json() : null))
  .then((data) => {
    if (data && data.nodes) {
      setSystemGraph(data);
    }
  })
  .catch(() => {/* system graph is optional */});
```

- [ ] **Step 5: Commit**

```bash
git add understand-anything-plugin/packages/dashboard/src/App.tsx
git commit -m "feat(dashboard): integrate System tab + data loading in App.tsx"
```

---

## Task 7: Wiki SKILL.md Integration — Auto-trigger after Phase 3

**Files:**
- Modify: `understand-anything-plugin/skills/understand-wiki/SKILL.md`

- [ ] **Step 1: Read current Phase 3 ending in wiki-phase3-crossservice.md**

Read: `understand-anything-plugin/skills/understand-wiki/docs/wiki-phase3-crossservice.md` — find the end of Phase 3 (after Parent Wiki Quality Gate).

- [ ] **Step 2: Add build-system-graph.py invocation after Phase 3 Quality Gate**

After the Parent Wiki Quality Gate section, add:

```markdown
### Step 5 — Update System Graph

After parent wiki generation, update the system-level graph:

```bash
python3 "$SKILL_DIR/build-system-graph.py" "$PROJECT_ROOT"
```

This synchronizes the system graph with the latest cross-service analysis from architecture.json. The system graph enables the Dashboard's SystemOverview tab.

If the script fails, log a warning and continue — the system graph is a convenience feature, not a prerequisite for wiki completion.
```

- [ ] **Step 3: Commit**

```bash
git add understand-anything-plugin/skills/understand-wiki/docs/wiki-phase3-crossservice.md
git commit -m "docs(wiki): add system-graph auto-update after Phase 3"
```

---

## Self-Review Checklist

### 1. Spec coverage

| Spec requirement | Task |
|---|---|
| `build-system-graph.py` script | Tasks 1–3 |
| Service discovery with excludeServices | Task 1 |
| KG metadata extraction + endpoints | Task 2 |
| RPC matching across services | Task 2 |
| Wiki enrichment (architecture.json) | Task 3 |
| CLI entry point with argparse | Task 3 |
| Dashboard SystemOverview component | Task 5 |
| Store + ViewMode extension | Task 4 |
| Vite middleware endpoint | Task 4 |
| i18n keys | Task 4 |
| App.tsx tab + data loading | Task 6 |
| Wiki SKILL.md integration | Task 7 |
| Progressive enhancement (3 levels) | Task 2 (basic+intermediate), Task 3 (full) |

### 2. Placeholder scan

No TBD/TODO found. All code blocks are complete.

### 3. Type consistency

- `discover_services` → returns `list[dict]` with keys `name`, `path`, `kg_path` — consistent across Tasks 1–3
- `extract_service_info` → returns dict with keys used in `build_system_graph` — consistent
- `build_system_graph` → returns system graph dict matching spec schema — consistent
- `ViewMode` type extended in store → consumed in App.tsx — consistent
- `systemGraph` state in store → consumed in SystemOverview — consistent
