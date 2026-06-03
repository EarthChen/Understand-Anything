"""Tests for wiki_structure_validator.py — wiki directory structural validation."""

import json
import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(
    0,
    os.path.join(
        os.path.dirname(__file__),
        "..",
        "..",
        "..",
        "understand-anything-plugin",
        "skills",
        "understand-wiki",
    ),
)

from wiki_structure_validator import validate_wiki_structure


_REPO_ROOT = Path(__file__).resolve().parents[3]
FIXTURE_ROOT = _REPO_ROOT / "tests" / "fixtures" / "sample-service"
FIXTURE_WIKI = FIXTURE_ROOT / ".understand-anything" / "wiki"
FIXTURE_DG = FIXTURE_ROOT / ".understand-anything" / "domain-graph.json"


class TestWikiStructureValidator(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.wiki_dir = os.path.join(self.tmp, "wiki")
        self.domains_dir = os.path.join(self.wiki_dir, "domains")
        os.makedirs(self.domains_dir)

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def _write_json(self, path, data):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w") as f:
            json.dump(data, f)

    def _write_minimal_valid_wiki(self, domains=None):
        if domains is None:
            domains = ["order-mgmt", "payment"]
        self._write_json(
            os.path.join(self.wiki_dir, "meta.json"),
            {
                "gitCommitHash": "fixture001",
                "generatedAt": "2026-06-03T12:00:00Z",
                "version": "1.0.0",
                "outputLanguage": "en",
            },
        )
        self._write_json(
            os.path.join(self.wiki_dir, "index.json"),
            {
                "entries": [
                    {
                        "id": f"wiki:svc:{d}",
                        "name": d.replace("-", " ").title(),
                        "type": "domain",
                        "summary": f"Summary for {d}",
                    }
                    for d in domains
                ]
            },
        )
        self._write_json(
            os.path.join(self.wiki_dir, "service.json"),
            {
                "name": "sample-service",
                "description": "Sample microservice for integration testing of wiki output",
            },
        )
        for slug in domains:
            self._write_json(
                os.path.join(self.domains_dir, f"{slug}.json"),
                {
                    "id": f"domain:{slug}",
                    "name": slug.replace("-", " ").title(),
                    "summary": f"Domain summary for {slug} with enough detail",
                    "flows": [
                        {
                            "id": f"flow:{slug}:main",
                            "name": "Main Flow",
                            "summary": "Primary business flow",
                            "steps": [
                                {
                                    "order": 1,
                                    "name": "Start",
                                    "description": "Begin processing the request",
                                },
                                {
                                    "order": 2,
                                    "name": "Complete",
                                    "description": "Finish processing successfully",
                                },
                            ],
                        }
                    ],
                },
            )

    def _write_domain_graph(self, domains=None):
        if domains is None:
            domains = ["order-mgmt", "payment"]
        dg_path = os.path.join(self.tmp, "domain-graph.json")
        nodes = [
            {"id": f"domain:{d}", "type": "domain", "name": d} for d in domains
        ]
        self._write_json(dg_path, {"nodes": nodes, "edges": []})
        return dg_path

    def test_valid_fixture_passes_validation(self):
        if not FIXTURE_WIKI.is_dir():
            self.skipTest("fixture wiki not yet created")
        result = validate_wiki_structure(str(FIXTURE_WIKI), str(FIXTURE_DG))
        self.assertTrue(result["valid"])
        self.assertEqual(result["missing_files"], [])
        self.assertEqual(result["malformed_files"], [])

    def test_valid_minimal_wiki_passes(self):
        self._write_minimal_valid_wiki()
        dg_path = self._write_domain_graph()
        result = validate_wiki_structure(self.wiki_dir, dg_path)
        self.assertTrue(result["valid"])
        self.assertEqual(len(result["issues"]), 0)

    def test_missing_meta_json_detected(self):
        self._write_minimal_valid_wiki()
        os.remove(os.path.join(self.wiki_dir, "meta.json"))
        dg_path = self._write_domain_graph()
        result = validate_wiki_structure(self.wiki_dir, dg_path)
        self.assertFalse(result["valid"])
        self.assertIn("meta.json", result["missing_files"])

    def test_missing_domain_file_detected(self):
        self._write_minimal_valid_wiki(["order-mgmt"])
        dg_path = self._write_domain_graph(["order-mgmt", "payment"])
        result = validate_wiki_structure(self.wiki_dir, dg_path)
        self.assertFalse(result["valid"])
        self.assertTrue(
            any("payment" in issue for issue in result["issues"])
            or any("payment" in m for m in result["missing_files"])
        )

    def test_malformed_domain_file_detected(self):
        self._write_minimal_valid_wiki()
        self._write_json(
            os.path.join(self.domains_dir, "order-mgmt.json"),
            {
                "id": "domain:order-mgmt",
                "name": "Order Management",
                "summary": "Short",
                "flows": [],
            },
        )
        dg_path = self._write_domain_graph()
        result = validate_wiki_structure(self.wiki_dir, dg_path)
        self.assertFalse(result["valid"])
        self.assertTrue(
            any("order-mgmt" in m.get("file", "") for m in result["malformed_files"])
        )

    def test_empty_domains_directory(self):
        self._write_json(
            os.path.join(self.wiki_dir, "meta.json"),
            {
                "gitCommitHash": "abc",
                "generatedAt": "2026-06-03T00:00:00Z",
                "version": "1.0.0",
                "outputLanguage": "en",
            },
        )
        self._write_json(
            os.path.join(self.wiki_dir, "index.json"),
            {"entries": [{"id": "x", "name": "X", "type": "domain", "summary": "s"}]},
        )
        self._write_json(
            os.path.join(self.wiki_dir, "service.json"),
            {
                "name": "svc",
                "description": "A sufficiently long service description",
            },
        )
        for f in os.listdir(self.domains_dir):
            os.remove(os.path.join(self.domains_dir, f))
        dg_path = self._write_domain_graph()
        result = validate_wiki_structure(self.wiki_dir, dg_path)
        self.assertFalse(result["valid"])
        self.assertTrue(
            any("domains" in issue.lower() for issue in result["issues"])
            or "domains/" in result["missing_files"]
        )

    def test_validates_against_fixture_data(self):
        if not FIXTURE_WIKI.is_dir():
            self.skipTest("fixture wiki not yet created")
        with open(FIXTURE_DG) as f:
            dg = json.load(f)
        domain_slugs = [
            n["id"].replace("domain:", "")
            for n in dg.get("nodes", [])
            if n.get("type") == "domain"
        ]
        result = validate_wiki_structure(str(FIXTURE_WIKI), str(FIXTURE_DG))
        self.assertTrue(result["valid"])
        for slug in domain_slugs:
            domain_path = FIXTURE_WIKI / "domains" / f"{slug}.json"
            self.assertTrue(domain_path.is_file(), f"missing fixture domain {slug}")


if __name__ == "__main__":
    unittest.main()
