"""Integration tests for sample-service wiki fixtures and validators."""

from __future__ import annotations

import importlib.util
import json
import sys
import unittest
from pathlib import Path


_REPO_ROOT = Path(__file__).resolve().parents[3]
_SKILL_DIR = _REPO_ROOT / "understand-anything-plugin" / "skills" / "understand-wiki"
_FIXTURE_ROOT = _REPO_ROOT / "tests" / "fixtures" / "sample-service"
_UA_DIR = _FIXTURE_ROOT / ".understand-anything"
_WIKI_DIR = _UA_DIR / "wiki"
_KG_PATH = _UA_DIR / "knowledge-graph.json"
_DG_PATH = _UA_DIR / "domain-graph.json"


def _add_skill_dir_to_path() -> None:
    skill = str(_SKILL_DIR)
    if skill not in sys.path:
        sys.path.insert(0, skill)


def _load_cross_service_matcher():
    module_path = _SKILL_DIR / "cross-service-matcher.py"
    spec = importlib.util.spec_from_file_location("cross_service_matcher", module_path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Could not load module from {module_path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class TestWikiIntegration(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not _FIXTURE_ROOT.is_dir():
            raise unittest.SkipTest("sample-service fixture not found")
        cls.fixture_root = _FIXTURE_ROOT
        cls.wiki_dir = _WIKI_DIR
        cls.kg_path = _KG_PATH
        cls.dg_path = _DG_PATH
        _add_skill_dir_to_path()
        from wiki_quality_gate import run_quality_gate
        from wiki_structure_validator import validate_wiki_structure

        cls._run_quality_gate = staticmethod(run_quality_gate)
        cls._validate_wiki_structure = staticmethod(validate_wiki_structure)
        cls.matcher = _load_cross_service_matcher()

        with open(cls.kg_path) as f:
            cls.kg = json.load(f)
        with open(cls.dg_path) as f:
            cls.dg = json.load(f)

    def test_fixture_kg_has_expected_node_counts(self):
        nodes = self.kg.get("nodes", [])
        by_type: dict[str, int] = {}
        for node in nodes:
            by_type[node["type"]] = by_type.get(node["type"], 0) + 1
        self.assertEqual(by_type.get("file", 0), 3)
        self.assertEqual(by_type.get("class", 0), 2)
        self.assertEqual(by_type.get("function", 0), 4)
        self.assertEqual(by_type.get("endpoint", 0), 1)
        self.assertEqual(by_type.get("service", 0), 1)

    def test_fixture_kg_has_rpc_edges(self):
        edge_types = {e["type"] for e in self.kg.get("edges", [])}
        self.assertIn("provides_rpc", edge_types)
        self.assertIn("consumes_rpc", edge_types)

    def test_fixture_dg_has_two_domains_with_flows_and_steps(self):
        nodes = self.dg.get("nodes", [])
        domains = [n for n in nodes if n.get("type") == "domain"]
        flows = [n for n in nodes if n.get("type") == "flow"]
        steps = [n for n in nodes if n.get("type") == "step"]
        self.assertEqual(len(domains), 2)
        self.assertGreaterEqual(len(flows), 2)
        self.assertGreaterEqual(len(steps), 4)
        for domain in domains:
            domain_flows = [
                e["target"]
                for e in self.dg.get("edges", [])
                if e.get("source") == domain["id"] and e.get("type") == "contains_flow"
            ]
            self.assertGreaterEqual(len(domain_flows), 1)

    def test_wiki_quality_gate_passes_on_fixture(self):
        result = self._run_quality_gate(
            str(self.wiki_dir),
            str(self.dg_path),
            str(self.fixture_root),
        )
        self.assertTrue(result["passed"], msg=str(result["issues"]))
        self.assertEqual(result["stats"]["coveragePercent"], 100)

    def test_wiki_structure_validator_passes_on_fixture(self):
        result = self._validate_wiki_structure(str(self.wiki_dir), str(self.dg_path))
        self.assertTrue(result["valid"], msg=str(result["issues"]))

    def test_cross_service_matcher_identifies_rpc_edges_from_fixture_kg(self):
        providers = self.matcher.extract_rpc_providers(self.kg, "sample-service")
        consumers = self.matcher.extract_rpc_consumers(self.kg, "sample-service")
        self.assertEqual(len(providers), 1)
        self.assertEqual(len(consumers), 1)
        self.assertEqual(providers[0]["interface"], "PaymentFacade")
        self.assertEqual(consumers[0]["interface"], "PaymentFacade")
        self.assertEqual(providers[0]["implementor"], "PaymentFacadeImpl")
        self.assertEqual(consumers[0]["consumer_class"], "OrderService")


if __name__ == "__main__":
    unittest.main()
