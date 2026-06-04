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


if __name__ == "__main__":
    unittest.main()
