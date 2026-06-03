"""Tests for wiki_diff_domains.py — domain-level incremental change detection."""
from __future__ import annotations

import sys
import os
import unittest

sys.path.insert(
    0,
    os.path.join(
        os.path.dirname(__file__),
        "../../../understand-anything-plugin/skills/understand-wiki",
    ),
)
from wiki_diff_domains import diff_domain_graphs, extract_domains


class TestExtractDomains(unittest.TestCase):
    """Verify domain extraction from DG structure."""

    def test_extracts_domain_nodes(self):
        dg = {
            "nodes": [
                {"id": "d1", "name": "Auth", "type": "domain", "tags": [], "summary": "", "complexity": "simple"},
                {"id": "f1", "name": "Login", "type": "flow", "tags": [], "summary": "", "complexity": "simple"},
            ],
            "edges": [{"source": "d1", "target": "f1", "type": "contains_flow", "weight": 0.8, "direction": "forward"}],
        }
        domains = extract_domains(dg)
        self.assertIn("d1", domains)
        self.assertNotIn("f1", domains)
        self.assertEqual(domains["d1"]["flow_ids"], {"f1"})

    def test_extracts_steps(self):
        dg = {
            "nodes": [
                {"id": "d1", "name": "Auth", "type": "domain", "tags": [], "summary": "", "complexity": "simple"},
                {"id": "f1", "name": "Login", "type": "flow", "tags": [], "summary": "", "complexity": "simple"},
                {"id": "s1", "name": "Validate", "type": "step", "tags": [], "summary": "", "complexity": "simple"},
            ],
            "edges": [
                {"source": "d1", "target": "f1", "type": "contains_flow", "weight": 0.8, "direction": "forward"},
                {"source": "f1", "target": "s1", "type": "flow_step", "weight": 0.7, "direction": "forward"},
            ],
        }
        domains = extract_domains(dg)
        self.assertEqual(domains["d1"]["step_ids"], {"s1"})

    def test_empty_dg(self):
        dg = {"nodes": [], "edges": []}
        domains = extract_domains(dg)
        self.assertEqual(domains, {})


def _make_dg(domains: list[dict]) -> dict:
    """Helper to build a minimal DG structure from domain definitions."""
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
        "project": {
            "name": "test",
            "languages": [],
            "frameworks": [],
            "description": "",
            "analyzedAt": "",
            "gitCommitHash": "abc",
        },
        "nodes": nodes,
        "edges": edges,
        "layers": [],
        "tour": [],
    }


class TestDomainClassification(unittest.TestCase):
    """Verify domains are correctly classified as added/modified/removed/unchanged."""

    def test_unchanged_domains(self):
        domains = [{"id": "d1", "name": "Auth", "flows": [{"id": "f1", "name": "Login", "steps": [{"id": "s1", "name": "Validate"}]}]}]
        old_dg = _make_dg(domains)
        new_dg = _make_dg(domains)
        result = diff_domain_graphs(old_dg, new_dg)
        self.assertEqual(result["added"], [])
        self.assertEqual(result["modified"], [])
        self.assertEqual(result["removed"], [])
        self.assertEqual(result["unchanged"], ["d1"])

    def test_added_domain(self):
        old_domains = [{"id": "d1", "name": "Auth", "flows": []}]
        new_domains = [{"id": "d1", "name": "Auth", "flows": []}, {"id": "d2", "name": "Order", "flows": []}]
        result = diff_domain_graphs(_make_dg(old_domains), _make_dg(new_domains))
        self.assertEqual(result["added"], ["d2"])
        self.assertEqual(result["unchanged"], ["d1"])

    def test_removed_domain(self):
        old_domains = [{"id": "d1", "name": "Auth", "flows": []}, {"id": "d2", "name": "Order", "flows": []}]
        new_domains = [{"id": "d1", "name": "Auth", "flows": []}]
        result = diff_domain_graphs(_make_dg(old_domains), _make_dg(new_domains))
        self.assertEqual(result["removed"], ["d2"])
        self.assertEqual(result["unchanged"], ["d1"])

    def test_modified_domain_flow_added(self):
        old_domains = [{"id": "d1", "name": "Auth", "flows": []}]
        new_domains = [{"id": "d1", "name": "Auth", "flows": [{"id": "f1", "name": "Login", "steps": []}]}]
        result = diff_domain_graphs(_make_dg(old_domains), _make_dg(new_domains))
        self.assertEqual(result["modified"], ["d1"])
        self.assertEqual(result["unchanged"], [])

    def test_modified_domain_flow_removed(self):
        old_domains = [{"id": "d1", "name": "Auth", "flows": [{"id": "f1", "name": "Login", "steps": []}]}]
        new_domains = [{"id": "d1", "name": "Auth", "flows": []}]
        result = diff_domain_graphs(_make_dg(old_domains), _make_dg(new_domains))
        self.assertEqual(result["modified"], ["d1"])

    def test_modified_domain_step_added(self):
        old_domains = [{"id": "d1", "name": "Auth", "flows": [{"id": "f1", "name": "Login", "steps": []}]}]
        new_domains = [{"id": "d1", "name": "Auth", "flows": [{"id": "f1", "name": "Login", "steps": [{"id": "s1", "name": "Validate"}]}]}]
        result = diff_domain_graphs(_make_dg(old_domains), _make_dg(new_domains))
        self.assertEqual(result["modified"], ["d1"])

    def test_modified_domain_step_removed(self):
        old_domains = [{"id": "d1", "name": "Auth", "flows": [{"id": "f1", "name": "Login", "steps": [{"id": "s1", "name": "Validate"}]}]}]
        new_domains = [{"id": "d1", "name": "Auth", "flows": [{"id": "f1", "name": "Login", "steps": []}]}]
        result = diff_domain_graphs(_make_dg(old_domains), _make_dg(new_domains))
        self.assertEqual(result["modified"], ["d1"])

    def test_multiple_domains_mixed(self):
        old_domains = [
            {"id": "d1", "name": "Auth", "flows": [{"id": "f1", "name": "Login", "steps": []}]},
            {"id": "d2", "name": "Order", "flows": []},
            {"id": "d3", "name": "Legacy", "flows": []},
        ]
        new_domains = [
            {"id": "d1", "name": "Auth", "flows": [{"id": "f1", "name": "Login", "steps": []}]},  # unchanged
            {"id": "d2", "name": "Order", "flows": [{"id": "f2", "name": "Place", "steps": []}]},  # modified
            {"id": "d4", "name": "Payment", "flows": []},  # added
            # d3 removed
        ]
        result = diff_domain_graphs(_make_dg(old_domains), _make_dg(new_domains))
        self.assertEqual(result["unchanged"], ["d1"])
        self.assertEqual(result["modified"], ["d2"])
        self.assertEqual(result["added"], ["d4"])
        self.assertEqual(result["removed"], ["d3"])


class TestServiceOverviewDirty(unittest.TestCase):
    """Verify serviceOverviewDirty logic."""

    def test_dirty_on_domain_added(self):
        old_domains = [{"id": "d1", "name": "Auth", "flows": []}]
        new_domains = [{"id": "d1", "name": "Auth", "flows": []}, {"id": "d2", "name": "Order", "flows": []}]
        result = diff_domain_graphs(_make_dg(old_domains), _make_dg(new_domains))
        self.assertTrue(result["serviceOverviewDirty"])

    def test_dirty_on_domain_removed(self):
        old_domains = [{"id": "d1", "name": "Auth", "flows": []}, {"id": "d2", "name": "Order", "flows": []}]
        new_domains = [{"id": "d1", "name": "Auth", "flows": []}]
        result = diff_domain_graphs(_make_dg(old_domains), _make_dg(new_domains))
        self.assertTrue(result["serviceOverviewDirty"])

    def test_clean_on_internal_change_only(self):
        old_domains = [{"id": "d1", "name": "Auth", "flows": []}]
        new_domains = [{"id": "d1", "name": "Auth", "flows": [{"id": "f1", "name": "Login", "steps": []}]}]
        result = diff_domain_graphs(_make_dg(old_domains), _make_dg(new_domains))
        self.assertFalse(result["serviceOverviewDirty"])

    def test_clean_when_nothing_changed(self):
        domains = [{"id": "d1", "name": "Auth", "flows": []}]
        result = diff_domain_graphs(_make_dg(domains), _make_dg(domains))
        self.assertFalse(result["serviceOverviewDirty"])


class TestCrossServiceDirty(unittest.TestCase):
    """Verify crossServiceDirty logic with KG."""

    def test_dirty_when_rpc_edges_present(self):
        domains = [{"id": "d1", "name": "Auth", "flows": []}]
        kg = {
            "nodes": [],
            "edges": [{"source": "n1", "target": "n2", "type": "provides_rpc", "weight": 0.9, "direction": "forward"}],
        }
        result = diff_domain_graphs(_make_dg(domains), _make_dg(domains), kg=kg)
        self.assertTrue(result["crossServiceDirty"])

    def test_clean_when_no_rpc_edges(self):
        domains = [{"id": "d1", "name": "Auth", "flows": []}]
        kg = {
            "nodes": [],
            "edges": [{"source": "n1", "target": "n2", "type": "imports", "weight": 0.5, "direction": "forward"}],
        }
        result = diff_domain_graphs(_make_dg(domains), _make_dg(domains), kg=kg)
        self.assertFalse(result["crossServiceDirty"])

    def test_clean_when_no_kg_provided(self):
        domains = [{"id": "d1", "name": "Auth", "flows": []}]
        result = diff_domain_graphs(_make_dg(domains), _make_dg(domains), kg=None)
        self.assertFalse(result["crossServiceDirty"])


class TestSummary(unittest.TestCase):
    """Verify summary string format."""

    def test_summary_format(self):
        old_domains = [{"id": "d1", "name": "Auth", "flows": []}, {"id": "d2", "name": "Order", "flows": []}]
        new_domains = [
            {"id": "d1", "name": "Auth", "flows": [{"id": "f1", "name": "Login", "steps": []}]},
            {"id": "d3", "name": "Payment", "flows": []},
        ]
        result = diff_domain_graphs(_make_dg(old_domains), _make_dg(new_domains))
        self.assertIn("modified", result["summary"])
        self.assertIn("added", result["summary"])
        self.assertIn("removed", result["summary"])
        self.assertIn("unchanged", result["summary"])


class TestFallbackThreshold(unittest.TestCase):
    """Verify >80% modification ratio detection."""

    def test_high_modification_detected(self):
        old_nodes = [{"id": f"d{i}", "name": f"D{i}", "type": "domain", "tags": [], "summary": "", "complexity": "simple"} for i in range(10)]
        old_dg = {"version": "1.0", "project": {"name": "t", "languages": [], "frameworks": [], "description": "", "analyzedAt": "", "gitCommitHash": ""}, "nodes": old_nodes, "edges": [], "layers": [], "tour": []}

        # Replace 9/10 with new IDs
        new_nodes = [{"id": f"dnew{i}", "name": f"New{i}", "type": "domain", "tags": [], "summary": "", "complexity": "simple"} for i in range(9)]
        new_nodes.append({"id": "d0", "name": "D0", "type": "domain", "tags": [], "summary": "", "complexity": "simple"})
        new_dg = {"version": "1.0", "project": old_dg["project"], "nodes": new_nodes, "edges": [], "layers": [], "tour": []}

        result = diff_domain_graphs(old_dg, new_dg)
        total_changed = len(result["added"]) + len(result["modified"]) + len(result["removed"])
        total = total_changed + len(result["unchanged"])
        self.assertGreater(total_changed / total, 0.8)

    def test_low_modification_ratio(self):
        old_nodes = [{"id": f"d{i}", "name": f"D{i}", "type": "domain", "tags": [], "summary": "", "complexity": "simple"} for i in range(10)]
        old_dg = {"version": "1.0", "project": {"name": "t", "languages": [], "frameworks": [], "description": "", "analyzedAt": "", "gitCommitHash": ""}, "nodes": old_nodes, "edges": [], "layers": [], "tour": []}

        # Change only 1 domain
        new_nodes = list(old_nodes)
        new_nodes[0] = {"id": "dnew0", "name": "New0", "type": "domain", "tags": [], "summary": "", "complexity": "simple"}
        new_dg = {"version": "1.0", "project": old_dg["project"], "nodes": new_nodes, "edges": [], "layers": [], "tour": []}

        result = diff_domain_graphs(old_dg, new_dg)
        total_changed = len(result["added"]) + len(result["modified"]) + len(result["removed"])
        total = total_changed + len(result["unchanged"])
        self.assertLessEqual(total_changed / total, 0.8)


if __name__ == "__main__":
    unittest.main()
