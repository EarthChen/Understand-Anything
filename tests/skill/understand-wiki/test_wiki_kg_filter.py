"""Tests for wiki_kg_filter.py — domain-scoped knowledge graph filtering."""
from __future__ import annotations

import json
import os
import subprocess
import sys
import unittest
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parents[3]
_SKILL_DIR = _REPO_ROOT / "understand-anything-plugin" / "skills" / "understand-wiki"
_FIXTURE_UA = _REPO_ROOT / "tests" / "fixtures" / "sample-service" / ".understand-anything"
_KG_PATH = _FIXTURE_UA / "knowledge-graph.json"
_DG_PATH = _FIXTURE_UA / "domain-graph.json"
_FILTER_SCRIPT = _SKILL_DIR / "wiki_kg_filter.py"

sys.path.insert(0, str(_SKILL_DIR))
from wiki_kg_filter import filter_kg_for_domain  # noqa: E402


def _load_json(path: Path) -> dict:
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def _node_ids(kg: dict) -> set[str]:
    return {n["id"] for n in kg.get("nodes", [])}


def _edge_keys(kg: dict) -> set[tuple[str, str, str]]:
    return {(e["source"], e["target"], e["type"]) for e in kg.get("edges", [])}


class TestFilterKgForDomain(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not _KG_PATH.is_file() or not _DG_PATH.is_file():
            raise unittest.SkipTest("sample-service fixtures not found")
        cls.kg = _load_json(_KG_PATH)
        cls.dg = _load_json(_DG_PATH)

    def test_order_mgmt_includes_domain_file_nodes(self):
        result = filter_kg_for_domain(self.kg, self.dg, "domain:order-mgmt")
        ids = _node_ids(result)
        self.assertIn("file:src/OrderController.java", ids)
        self.assertIn("file:src/OrderService.java", ids)
        self.assertIn("function:src/OrderController.java:createOrder", ids)
        self.assertIn("function:src/OrderService.java:createOrder", ids)

    def test_order_mgmt_includes_related_edges(self):
        result = filter_kg_for_domain(self.kg, self.dg, "domain:order-mgmt")
        types = {e["type"] for e in result.get("edges", [])}
        self.assertIn("calls", types)
        self.assertIn("handled_by", types)
        self.assertIn("consumes_rpc", types)

    def test_order_mgmt_excludes_unrelated_payment_only_nodes(self):
        result = filter_kg_for_domain(self.kg, self.dg, "domain:order-mgmt")
        ids = _node_ids(result)
        # PaymentFacade file may appear via RPC; Payment-only function should not
        # unless connected — createPayment is only in PaymentFacade file
        payment_only = "function:src/PaymentFacade.java:createPayment"
        if "file:src/PaymentFacade.java" not in ids:
            self.assertNotIn(payment_only, ids)

    def test_payment_domain_excludes_order_controller(self):
        result = filter_kg_for_domain(self.kg, self.dg, "domain:payment")
        ids = _node_ids(result)
        self.assertNotIn("file:src/OrderController.java", ids)
        self.assertNotIn("function:src/OrderController.java:createOrder", ids)
        self.assertIn("file:src/PaymentFacade.java", ids)

    def test_payment_domain_includes_rpc_edges(self):
        result = filter_kg_for_domain(self.kg, self.dg, "domain:payment")
        types = {e["type"] for e in result.get("edges", [])}
        self.assertIn("provides_rpc", types)

    def test_max_nodes_limits_result(self):
        result = filter_kg_for_domain(
            self.kg, self.dg, "domain:order-mgmt", max_nodes=3
        )
        self.assertLessEqual(len(result.get("nodes", [])), 3)

    def test_max_nodes_keeps_most_connected(self):
        result = filter_kg_for_domain(
            self.kg, self.dg, "domain:order-mgmt", max_nodes=2
        )
        ids = _node_ids(result)
        # OrderService participates in consumes_rpc and file children
        self.assertTrue(
            any("OrderService" in nid for nid in ids),
            msg=f"expected highly-connected node, got {ids}",
        )

    def test_domain_not_found_returns_empty_nodes(self):
        result = filter_kg_for_domain(self.kg, self.dg, "domain:nonexistent")
        self.assertEqual(result.get("nodes", []), [])
        self.assertEqual(result.get("edges", []), [])

    def test_preserves_kg_schema_structure(self):
        result = filter_kg_for_domain(self.kg, self.dg, "domain:order-mgmt")
        self.assertIn("nodes", result)
        self.assertIn("edges", result)
        self.assertIn("project", result)
        self.assertEqual(result["project"], self.kg["project"])
        self.assertIn("version", result)

    def test_endpoint_included_for_order_mgmt(self):
        result = filter_kg_for_domain(self.kg, self.dg, "domain:order-mgmt")
        ids = _node_ids(result)
        self.assertIn("endpoint:POST /api/orders", ids)


class TestTestNodeExclusion(unittest.TestCase):
    """Test nodes from test directories should be excluded from wiki KG filtering."""

    def _make_kg(self, nodes, edges):
        return {
            "version": "1.0.0",
            "project": {"name": "test", "languages": ["java"], "frameworks": [],
                        "description": "Test", "analyzedAt": "2026-01-01T00:00:00Z",
                        "gitCommitHash": "abc"},
            "nodes": nodes,
            "edges": edges,
            "layers": [],
            "tour": [],
        }

    def _make_dg(self, domains, flows, steps, edges):
        return {
            "version": "1.0.0",
            "project": {"name": "test"},
            "nodes": domains + flows + steps,
            "edges": edges,
        }

    def test_test_nodes_excluded_from_filtered_kg(self):
        kg = self._make_kg(
            nodes=[
                {"id": "file:src/order/OrderService.java", "type": "file",
                 "name": "OrderService", "filePath": "src/order/OrderService.java",
                 "summary": "Orders", "tags": ["java"], "complexity": "simple"},
                {"id": "file:src/test/java/OrderServiceTest.java", "type": "file",
                 "name": "OrderServiceTest", "filePath": "src/test/java/OrderServiceTest.java",
                 "summary": "Test", "tags": ["java", "test"], "complexity": "simple"},
            ],
            edges=[],
        )
        dg = self._make_dg(
            domains=[{"id": "domain:order", "type": "domain", "name": "Order"}],
            flows=[{"id": "flow:order-create", "type": "flow", "name": "Create Order"}],
            steps=[{"id": "step:order-1", "type": "step", "name": "Step 1",
                    "filePath": "src/order/OrderService.java"},
                   {"id": "step:order-test", "type": "step", "name": "Test Step",
                    "filePath": "src/test/java/OrderServiceTest.java"}],
            edges=[
                {"source": "domain:order", "target": "flow:order-create", "type": "contains_flow"},
                {"source": "flow:order-create", "target": "step:order-1", "type": "flow_step"},
                {"source": "flow:order-create", "target": "step:order-test", "type": "flow_step"},
            ],
        )

        result = filter_kg_for_domain(kg, dg, "domain:order")
        ids = _node_ids(result)

        self.assertIn("file:src/order/OrderService.java", ids)
        self.assertNotIn("file:src/test/java/OrderServiceTest.java", ids)


class TestFilterKgCli(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not _FILTER_SCRIPT.is_file():
            raise unittest.SkipTest("wiki_kg_filter.py not found")

    def test_cli_stdout_json(self):
        proc = subprocess.run(
            [
                sys.executable,
                str(_FILTER_SCRIPT),
                str(_KG_PATH),
                str(_DG_PATH),
                "domain:payment",
            ],
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(proc.returncode, 0, msg=proc.stderr)
        data = json.loads(proc.stdout)
        self.assertIn("nodes", data)
        self.assertIn("edges", data)

    def test_cli_max_nodes_flag(self):
        proc = subprocess.run(
            [
                sys.executable,
                str(_FILTER_SCRIPT),
                str(_KG_PATH),
                str(_DG_PATH),
                "domain:order-mgmt",
                "--max-nodes=2",
            ],
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(proc.returncode, 0, msg=proc.stderr)
        data = json.loads(proc.stdout)
        self.assertLessEqual(len(data.get("nodes", [])), 2)


if __name__ == "__main__":
    unittest.main()
