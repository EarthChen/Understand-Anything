#!/usr/bin/env python3
"""
test_build_system_graph.py — Tests for build-system-graph.py.

Run from the repo root:
    python -m unittest tests.skill.understand-wiki.test_build_system_graph -v

Or with pytest:
    pytest tests/skill/understand-wiki/test_build_system_graph.py -v
"""

from __future__ import annotations

import importlib.util
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from typing import Any

_REPO_ROOT = Path(__file__).resolve().parents[3]
_MODULE_PATH = (
    _REPO_ROOT
    / "understand-anything-plugin"
    / "skills"
    / "understand-wiki"
    / "build-system-graph.py"
)


def _load_module() -> Any:
    spec = importlib.util.spec_from_file_location("build_system_graph", _MODULE_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Could not load module from {_MODULE_PATH}")
    module = importlib.util.module_from_spec(spec)
    sys.modules["build_system_graph"] = module
    spec.loader.exec_module(module)
    return module


mod = _load_module()
discover_services = mod.discover_services
extract_service_info = mod.extract_service_info
build_system_graph = mod.build_system_graph
enrich_from_wiki = mod.enrich_from_wiki


def _make_kg(
    name: str = "test-service",
    desc: str = "A test service",
    languages: list[str] | None = None,
    frameworks: list[str] | None = None,
    nodes: list | None = None,
    edges: list | None = None,
) -> dict:
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
    def setUp(self) -> None:
        self.tmpdir = tempfile.mkdtemp()

    def _create_service(self, name: str) -> None:
        svc_dir = os.path.join(self.tmpdir, name, ".understand-anything")
        os.makedirs(svc_dir, exist_ok=True)
        with open(os.path.join(svc_dir, "knowledge-graph.json"), "w", encoding="utf-8") as f:
            json.dump(_make_kg(name), f)

    def _write_system_json(self, config: dict) -> None:
        config_dir = os.path.join(self.tmpdir, ".understand-anything")
        os.makedirs(config_dir, exist_ok=True)
        with open(os.path.join(config_dir, "system.json"), "w", encoding="utf-8") as f:
            json.dump(config, f)

    def test_discovers_services_with_kg(self) -> None:
        """Services with knowledge-graph.json are discovered."""
        svc_a = os.path.join(self.tmpdir, "order-service", ".understand-anything")
        os.makedirs(svc_a)
        with open(os.path.join(svc_a, "knowledge-graph.json"), "w", encoding="utf-8") as f:
            json.dump(_make_kg("order-service"), f)

        svc_b = os.path.join(self.tmpdir, "payment-service", ".understand-anything")
        os.makedirs(svc_b)
        with open(os.path.join(svc_b, "knowledge-graph.json"), "w", encoding="utf-8") as f:
            json.dump(_make_kg("payment-service"), f)

        os.makedirs(os.path.join(self.tmpdir, "no-kg-service"))

        result = discover_services(self.tmpdir)
        names = sorted(s["name"] for s in result)
        self.assertEqual(names, ["order-service", "payment-service"])

    def test_excludes_services_from_config(self) -> None:
        """Services listed in excludeServices config are skipped."""
        svc = os.path.join(self.tmpdir, "common", ".understand-anything")
        os.makedirs(svc)
        with open(os.path.join(svc, "knowledge-graph.json"), "w", encoding="utf-8") as f:
            json.dump(_make_kg("common"), f)

        config_dir = os.path.join(self.tmpdir, ".understand-anything")
        os.makedirs(config_dir, exist_ok=True)
        with open(os.path.join(config_dir, "config.json"), "w", encoding="utf-8") as f:
            json.dump({"excludeServices": ["common"]}, f)

        result = discover_services(self.tmpdir)
        self.assertEqual(len(result), 0)

    def test_system_json_exclude_glob(self) -> None:
        """system.json exclude patterns filter services via fnmatch globs."""
        self._create_service("order-service")
        self._create_service("payment-service")
        self._create_service("deprecated-auth")
        self._write_system_json({
            "version": "1.0",
            "name": "ultron-platform",
            "discovery": {
                "mode": "auto",
                "exclude": ["deprecated-*"],
                "include": [],
            },
        })

        result = discover_services(self.tmpdir)
        names = sorted(s["name"] for s in result)
        self.assertEqual(names, ["order-service", "payment-service"])

    def test_system_json_include_whitelist(self) -> None:
        """Non-empty include list acts as whitelist; exclude is ignored."""
        self._create_service("order-service")
        self._create_service("payment-service")
        self._create_service("inventory-service")
        self._write_system_json({
            "version": "1.0",
            "name": "ultron-platform",
            "discovery": {
                "mode": "auto",
                "exclude": ["payment-service"],
                "include": ["order-service"],
            },
        })

        result = discover_services(self.tmpdir)
        names = [s["name"] for s in result]
        self.assertEqual(names, ["order-service"])

    def test_no_system_json_backward_compat(self) -> None:
        """Without system.json, all services with KGs are discovered."""
        self._create_service("order-service")
        self._create_service("payment-service")
        self._create_service("inventory-service")

        result = discover_services(self.tmpdir)
        names = sorted(s["name"] for s in result)
        self.assertEqual(names, ["inventory-service", "order-service", "payment-service"])

    def test_exclude_glob_wildcard(self) -> None:
        """Multiple glob patterns exclude matching services."""
        self._create_service("order-service")
        self._create_service("test-runner")
        self._create_service("auth-legacy")
        self._write_system_json({
            "version": "1.0",
            "name": "ultron-platform",
            "discovery": {
                "mode": "auto",
                "exclude": ["test-*", "*-legacy"],
                "include": [],
            },
        })

        result = discover_services(self.tmpdir)
        names = sorted(s["name"] for s in result)
        self.assertEqual(names, ["order-service"])


class TestExtractServiceInfo(unittest.TestCase):
    def test_extracts_metadata_and_stats(self) -> None:
        """Extracts project metadata and node/edge counts."""
        kg = _make_kg(
            "order-service",
            "Order management",
            languages=["Java", "SQL"],
            frameworks=["Spring Boot", "MyBatis"],
            nodes=[
                {
                    "id": "file:src/Order.java",
                    "type": "file",
                    "name": "Order.java",
                    "summary": "Order entity",
                },
                {
                    "id": "endpoint:src/OrderController.java:POST /orders",
                    "type": "endpoint",
                    "name": "Create Order",
                    "summary": "Creates an order",
                    "filePath": "src/OrderController.java",
                },
                {
                    "id": "function:src/OrderService.java:createOrder",
                    "type": "function",
                    "name": "createOrder",
                    "summary": "Creates order logic",
                },
            ],
            edges=[
                {
                    "source": "file:src/Order.java",
                    "target": "function:src/OrderService.java:createOrder",
                    "type": "contains",
                },
            ],
        )

        info = extract_service_info("order-service", kg)
        self.assertEqual(info["name"], "order-service")
        self.assertEqual(info["project_name"], "Order management")
        self.assertEqual(info["languages"], ["Java", "SQL"])
        self.assertEqual(info["frameworks"], ["Spring Boot", "MyBatis"])
        self.assertEqual(info["stats"]["nodes"], 3)
        self.assertEqual(info["stats"]["edges"], 1)
        self.assertEqual(len(info["endpoints"]), 1)
        self.assertEqual(
            info["endpoints"][0]["id"],
            "endpoint:src/OrderController.java:POST /orders",
        )
        self.assertEqual(info["kg_commit"], "abc1234")

    def test_extracts_rpc_edges(self) -> None:
        """Extracts provides_rpc and consumes_rpc edges."""
        kg = _make_kg(
            nodes=[{"id": "file:src/PaymentFacade.java", "type": "file", "name": "PaymentFacade"}],
            edges=[
                {
                    "source": "file:src/OrderService.java",
                    "target": "file:src/PaymentFacade.java",
                    "type": "consumes_rpc",
                    "detail": "PaymentFacade.createPayment()",
                },
                {
                    "source": "file:src/PaymentFacadeImpl.java",
                    "target": "file:src/PaymentFacade.java",
                    "type": "provides_rpc",
                    "detail": "PaymentFacade",
                },
            ],
        )

        info = extract_service_info("payment-service", kg)
        self.assertEqual(len(info["rpc_provides"]), 1)
        self.assertEqual(len(info["rpc_consumes"]), 1)


class TestBuildSystemGraph(unittest.TestCase):
    def setUp(self) -> None:
        self.tmpdir = tempfile.mkdtemp()
        self.project_root = Path(self.tmpdir)

    def _create_service_kg(
        self,
        name: str,
        nodes: list[dict[str, Any]],
        edges: list[dict[str, Any]],
    ) -> None:
        svc_dir = self.project_root / name / ".understand-anything"
        svc_dir.mkdir(parents=True)
        kg = _make_kg(name, nodes=nodes, edges=edges)
        (svc_dir / "knowledge-graph.json").write_text(
            json.dumps(kg),
            encoding="utf-8",
        )

    def test_builds_graph_with_two_services(self) -> None:
        """Builds system graph with service nodes and contains edges."""
        for svc_name in ["order-service", "payment-service"]:
            svc_dir = os.path.join(self.tmpdir, svc_name, ".understand-anything")
            os.makedirs(svc_dir)
            kg = _make_kg(
                svc_name,
                f"{svc_name} description",
                nodes=[
                    {
                        "id": f"endpoint:{svc_name}:GET /health",
                        "type": "endpoint",
                        "name": "Health Check",
                        "summary": "Health endpoint",
                    },
                ],
            )
            with open(os.path.join(svc_dir, "knowledge-graph.json"), "w", encoding="utf-8") as f:
                json.dump(kg, f)

        graph = build_system_graph(self.tmpdir)

        self.assertEqual(graph["version"], "1.0.0")
        self.assertIn("generatedAt", graph)
        self.assertEqual(graph["project"]["serviceCount"], 2)

        svc_nodes = [n for n in graph["nodes"] if n["type"] == "microservice"]
        self.assertEqual(len(svc_nodes), 2)

        ep_nodes = [n for n in graph["nodes"] if n["type"] == "endpoint"]
        self.assertEqual(len(ep_nodes), 2)

        contains_edges = [e for e in graph["edges"] if e["type"] == "contains"]
        self.assertEqual(len(contains_edges), 2)

        self.assertIn("order-service", graph["serviceIndex"])
        self.assertTrue(graph["serviceIndex"]["order-service"]["hasKg"])

    def test_matches_rpc_across_services(self) -> None:
        """Matches consumes_rpc → provides_rpc across services."""
        order_kg = _make_kg(
            "order-service",
            nodes=[{"id": "file:src/OrderService.java", "type": "file", "name": "OrderService"}],
            edges=[
                {
                    "source": "file:src/OrderService.java",
                    "target": "file:src/PaymentFacade.java",
                    "type": "consumes_rpc",
                    "detail": "PaymentFacade.createPayment()",
                },
            ],
        )

        payment_kg = _make_kg(
            "payment-service",
            nodes=[
                {"id": "file:src/PaymentFacadeImpl.java", "type": "file", "name": "PaymentFacadeImpl"},
            ],
            edges=[
                {
                    "source": "file:src/PaymentFacadeImpl.java",
                    "target": "file:src/PaymentFacade.java",
                    "type": "provides_rpc",
                    "detail": "PaymentFacade",
                },
            ],
        )

        for name, kg in [("order-service", order_kg), ("payment-service", payment_kg)]:
            d = os.path.join(self.tmpdir, name, ".understand-anything")
            os.makedirs(d)
            with open(os.path.join(d, "knowledge-graph.json"), "w", encoding="utf-8") as f:
                json.dump(kg, f)

        graph = build_system_graph(self.tmpdir)

        rpc_edges = [e for e in graph["edges"] if e["type"] == "rpc_call"]
        self.assertEqual(len(rpc_edges), 1)
        self.assertEqual(rpc_edges[0]["source"], "microservice:order-service")
        self.assertEqual(rpc_edges[0]["target"], "microservice:payment-service")
        self.assertEqual(rpc_edges[0]["detail"]["interface"], "PaymentFacade")

    def test_extracts_rpc_edges_between_services(self) -> None:
        """System graph should have rpc_call edges when services share endpoint:__synthetic__ nodes."""
        self._create_service_kg("svc-a", [
            {"id": "class:Impl.java:Impl", "type": "class"},
            {"id": "endpoint:__synthetic__:RemoteApi", "type": "endpoint", "tags": ["rpc-interface"]},
        ], [
            {"source": "class:Impl.java:Impl", "target": "endpoint:__synthetic__:RemoteApi", "type": "consumes_rpc"},
        ])
        self._create_service_kg("svc-b", [
            {"id": "class:RemoteApiImpl.java:RemoteApiImpl", "type": "class"},
            {"id": "endpoint:__synthetic__:RemoteApi", "type": "endpoint", "tags": ["rpc-interface"]},
        ], [
            {"source": "class:RemoteApiImpl.java:RemoteApiImpl", "target": "endpoint:__synthetic__:RemoteApi", "type": "provides_rpc"},
        ])

        sg = build_system_graph(self.project_root)
        rpc_edges = [e for e in sg["edges"] if e["type"] == "rpc_call"]
        self.assertEqual(len(rpc_edges), 1)
        self.assertIn("RemoteApi", rpc_edges[0].get("detail", {}).get("interface", ""))

    def test_empty_project_returns_valid_graph(self) -> None:
        sg = build_system_graph(self.project_root)
        self.assertEqual(sg["nodes"], [])
        self.assertEqual(sg["edges"], [])
        self.assertEqual(sg["project"]["serviceCount"], 0)

    def test_system_name_in_graph(self) -> None:
        """system.json name and description appear in the output graph."""
        self._create_service_kg("order-service", [], [])
        config_dir = self.project_root / ".understand-anything"
        config_dir.mkdir(parents=True, exist_ok=True)
        system_config = {
            "version": "1.0",
            "name": "test-platform",
            "description": "Test platform description",
            "discovery": {"mode": "auto", "exclude": [], "include": []},
        }
        (config_dir / "system.json").write_text(
            json.dumps(system_config),
            encoding="utf-8",
        )

        graph = build_system_graph(self.tmpdir)

        self.assertEqual(graph["project"]["name"], "test-platform")
        self.assertEqual(graph["project"]["description"], "Test platform description")


class TestWikiEnrichment(unittest.TestCase):
    def setUp(self) -> None:
        self.tmpdir = tempfile.mkdtemp()

    def test_enriches_edges_from_architecture_json(self) -> None:
        """Merges crossServiceCalls from wiki architecture.json."""
        for svc_name in ["order-service", "payment-service"]:
            d = os.path.join(self.tmpdir, svc_name, ".understand-anything")
            os.makedirs(d)
            with open(os.path.join(d, "knowledge-graph.json"), "w", encoding="utf-8") as f:
                json.dump(_make_kg(svc_name), f)

        wiki_dir = os.path.join(self.tmpdir, ".understand-anything", "wiki")
        os.makedirs(wiki_dir)
        arch = {
            "crossServiceCalls": [
                {
                    "caller": {
                        "service": "order-service",
                        "method": "OrderService.createOrder()",
                    },
                    "callee": {
                        "service": "payment-service",
                        "interface": "PaymentFacade",
                        "method": "createPayment()",
                    },
                    "type": "moa_rpc",
                    "evidence": "script-matched",
                },
            ],
        }
        with open(os.path.join(wiki_dir, "architecture.json"), "w", encoding="utf-8") as f:
            json.dump(arch, f)

        graph = build_system_graph(self.tmpdir)
        enriched = enrich_from_wiki(graph, self.tmpdir)

        wiki_edges = [
            e for e in enriched["edges"]
            if e.get("detail", {}).get("evidence") == "wiki-enriched"
        ]
        self.assertGreaterEqual(len(wiki_edges), 1)
        self.assertEqual(wiki_edges[0]["source"], "microservice:order-service")
        self.assertEqual(wiki_edges[0]["target"], "microservice:payment-service")

    def test_no_wiki_returns_graph_unchanged(self) -> None:
        """When no wiki exists, graph is returned as-is."""
        graph = {
            "nodes": [],
            "edges": [],
            "version": "1.0.0",
            "project": {},
            "serviceIndex": {},
        }
        result = enrich_from_wiki(graph, self.tmpdir)
        self.assertEqual(result, graph)

    def test_skips_duplicate_edges(self) -> None:
        """If an rpc_call edge already exists from KG matching, wiki doesn't duplicate it."""
        order_kg = _make_kg(
            "order-service",
            nodes=[{"id": "file:src/OrderService.java", "type": "file", "name": "OrderService"}],
            edges=[
                {
                    "source": "file:src/OrderService.java",
                    "target": "file:src/PaymentFacade.java",
                    "type": "consumes_rpc",
                    "detail": "PaymentFacade.createPayment()",
                },
            ],
        )
        payment_kg = _make_kg(
            "payment-service",
            nodes=[
                {
                    "id": "file:src/PaymentFacadeImpl.java",
                    "type": "file",
                    "name": "PaymentFacadeImpl",
                },
            ],
            edges=[
                {
                    "source": "file:src/PaymentFacadeImpl.java",
                    "target": "file:src/PaymentFacade.java",
                    "type": "provides_rpc",
                    "detail": "PaymentFacade",
                },
            ],
        )
        for name, kg in [("order-service", order_kg), ("payment-service", payment_kg)]:
            d = os.path.join(self.tmpdir, name, ".understand-anything")
            os.makedirs(d)
            with open(os.path.join(d, "knowledge-graph.json"), "w", encoding="utf-8") as f:
                json.dump(kg, f)

        wiki_dir = os.path.join(self.tmpdir, ".understand-anything", "wiki")
        os.makedirs(wiki_dir)
        arch = {
            "crossServiceCalls": [
                {
                    "caller": {"service": "order-service", "method": "OrderService.createOrder()"},
                    "callee": {
                        "service": "payment-service",
                        "interface": "PaymentFacade",
                        "method": "createPayment()",
                    },
                    "type": "moa_rpc",
                },
            ],
        }
        with open(os.path.join(wiki_dir, "architecture.json"), "w", encoding="utf-8") as f:
            json.dump(arch, f)

        graph = build_system_graph(self.tmpdir)
        rpc_before = [e for e in graph["edges"] if e["type"] == "rpc_call"]
        self.assertEqual(len(rpc_before), 1)

        enriched = enrich_from_wiki(graph, self.tmpdir)
        rpc_after = [e for e in enriched["edges"] if e["type"] == "rpc_call"]
        self.assertEqual(len(rpc_after), 1)
        self.assertEqual(rpc_after[0]["detail"]["evidence"], "kg-matched")

    def test_enriches_project_from_overview(self) -> None:
        """overview.json enriches project name and description."""
        for svc_name in ["order-service"]:
            d = os.path.join(self.tmpdir, svc_name, ".understand-anything")
            os.makedirs(d)
            with open(os.path.join(d, "knowledge-graph.json"), "w", encoding="utf-8") as f:
                json.dump(_make_kg(svc_name), f)

        wiki_dir = os.path.join(self.tmpdir, ".understand-anything", "wiki")
        os.makedirs(wiki_dir)
        overview = {
            "name": "Order Platform",
            "description": "Multi-service order management platform",
        }
        with open(os.path.join(wiki_dir, "overview.json"), "w", encoding="utf-8") as f:
            json.dump(overview, f)

        graph = build_system_graph(self.tmpdir)
        enriched = enrich_from_wiki(graph, self.tmpdir)

        self.assertEqual(enriched["project"]["name"], "Order Platform")
        self.assertEqual(
            enriched["project"]["description"],
            "Multi-service order management platform",
        )


if __name__ == "__main__":
    unittest.main()
