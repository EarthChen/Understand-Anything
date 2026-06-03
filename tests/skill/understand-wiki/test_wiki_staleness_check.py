#!/usr/bin/env python3
"""Tests for wiki_staleness_check.py — upstream KG/DG staleness detection."""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest

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

from wiki_staleness_check import check_upstream_staleness  # noqa: E402


def _minimal_graph(commit: str, name: str = "test-service") -> dict:
    return {
        "version": "1.0.0",
        "project": {
            "name": name,
            "languages": ["java"],
            "frameworks": [],
            "description": "test",
            "analyzedAt": "2026-06-03T12:00:00.000Z",
            "gitCommitHash": commit,
        },
        "nodes": [],
        "edges": [],
        "layers": [],
        "tour": [],
    }


class GitRepoHelper:
    """Create a temporary git repo with one or two commits."""

    def __init__(self):
        self.root = tempfile.mkdtemp()
        self._run(["git", "init"])
        self._run(["git", "config", "user.email", "test@example.com"])
        self._run(["git", "config", "user.name", "Test User"])

    def _run(self, args: list[str]) -> str:
        result = subprocess.run(
            args,
            cwd=self.root,
            capture_output=True,
            text=True,
            check=True,
        )
        return result.stdout.strip()

    def write_and_commit(self, rel_path: str, content: str, message: str) -> str:
        full = os.path.join(self.root, rel_path)
        os.makedirs(os.path.dirname(full), exist_ok=True)
        with open(full, "w", encoding="utf-8") as f:
            f.write(content)
        self._run(["git", "add", rel_path])
        self._run(["git", "commit", "-m", message])
        return self._run(["git", "rev-parse", "HEAD"])

    def head(self) -> str:
        return self._run(["git", "rev-parse", "HEAD"])

    def cleanup(self):
        shutil.rmtree(self.root, ignore_errors=True)


class TestWikiStalenessCheck(unittest.TestCase):
    def setUp(self):
        self.repo = GitRepoHelper()
        self.service_root = os.path.join(self.repo.root, "sample-service")
        self.ua_dir = os.path.join(self.service_root, ".understand-anything")
        os.makedirs(self.ua_dir, exist_ok=True)

    def tearDown(self):
        self.repo.cleanup()

    def _write_graph(self, filename: str, commit: str) -> None:
        path = os.path.join(self.ua_dir, filename)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(_minimal_graph(commit), f)

    def test_fresh_data_no_warnings(self):
        head = self.repo.write_and_commit("sample-service/README.md", "svc\n", "init")
        self._write_graph("knowledge-graph.json", head)
        self._write_graph("domain-graph.json", head)

        result = check_upstream_staleness(self.service_root)

        self.assertEqual(result["kg_status"], "fresh")
        self.assertEqual(result["dg_status"], "fresh")
        self.assertEqual(result["kg_commit"], head)
        self.assertEqual(result["dg_commit"], head)
        self.assertEqual(result["current_commit"], head)
        self.assertEqual(result["warnings"], [])
        self.assertFalse(result["should_regenerate"]["kg"])
        self.assertFalse(result["should_regenerate"]["dg"])

    def test_stale_kg_warning_and_should_regenerate(self):
        old = self.repo.write_and_commit("sample-service/README.md", "v1\n", "init")
        self._write_graph("knowledge-graph.json", old)
        self._write_graph("domain-graph.json", old)
        head = self.repo.write_and_commit("sample-service/src/App.java", "class App {}\n", "change")

        result = check_upstream_staleness(self.service_root)

        self.assertEqual(result["kg_status"], "stale")
        self.assertEqual(result["dg_status"], "stale")
        self.assertEqual(result["kg_commit"], old)
        self.assertEqual(result["current_commit"], head)
        self.assertTrue(result["should_regenerate"]["kg"])
        self.assertTrue(result["should_regenerate"]["dg"])
        self.assertTrue(
            any("KG" in w and old[:7] in w or old in w for w in result["warnings"])
        )

    def test_stale_dg_only_when_kg_fresh(self):
        head = self.repo.write_and_commit("sample-service/README.md", "svc\n", "init")
        stale_dg = "deadbeef00000000000000000000000000000000"
        self._write_graph("knowledge-graph.json", head)
        self._write_graph("domain-graph.json", stale_dg)

        result = check_upstream_staleness(self.service_root)

        self.assertEqual(result["kg_status"], "fresh")
        self.assertEqual(result["dg_status"], "stale")
        self.assertFalse(result["should_regenerate"]["kg"])
        self.assertTrue(result["should_regenerate"]["dg"])
        self.assertTrue(any("DG" in w for w in result["warnings"]))

    def test_missing_kg(self):
        head = self.repo.write_and_commit("sample-service/README.md", "svc\n", "init")
        self._write_graph("domain-graph.json", head)

        result = check_upstream_staleness(self.service_root)

        self.assertEqual(result["kg_status"], "missing")
        self.assertEqual(result["dg_status"], "fresh")
        self.assertIsNone(result["kg_commit"])
        self.assertTrue(result["should_regenerate"]["kg"])
        self.assertTrue(any("missing" in w.lower() or "KG" in w for w in result["warnings"]))

    def test_missing_dg(self):
        head = self.repo.write_and_commit("sample-service/README.md", "svc\n", "init")
        self._write_graph("knowledge-graph.json", head)

        result = check_upstream_staleness(self.service_root)

        self.assertEqual(result["kg_status"], "fresh")
        self.assertEqual(result["dg_status"], "missing")
        self.assertIsNone(result["dg_commit"])
        self.assertTrue(result["should_regenerate"]["dg"])

    def test_no_git_repo_graceful_handling(self):
        non_git_root = tempfile.mkdtemp()
        try:
            service = os.path.join(non_git_root, "svc")
            ua = os.path.join(service, ".understand-anything")
            os.makedirs(ua, exist_ok=True)
            commit = "abc123def456"
            for name in ("knowledge-graph.json", "domain-graph.json"):
                with open(os.path.join(ua, name), "w", encoding="utf-8") as f:
                    json.dump(_minimal_graph(commit), f)

            result = check_upstream_staleness(service)

            self.assertIsNone(result["current_commit"])
            self.assertEqual(result["kg_commit"], commit)
            self.assertEqual(result["dg_commit"], commit)
            self.assertEqual(result["kg_status"], "fresh")
            self.assertEqual(result["dg_status"], "fresh")
            self.assertFalse(result["should_regenerate"]["kg"])
            self.assertFalse(result["should_regenerate"]["dg"])
            self.assertTrue(
                any("git" in w.lower() for w in result["warnings"])
            )
        finally:
            shutil.rmtree(non_git_root, ignore_errors=True)

    def test_meta_generated_from_commit_fallback(self):
        head = self.repo.write_and_commit("sample-service/README.md", "svc\n", "init")
        kg_path = os.path.join(self.ua_dir, "knowledge-graph.json")
        with open(kg_path, "w", encoding="utf-8") as f:
            json.dump(
                {
                    "version": "1.0.0",
                    "meta": {"generatedFromCommit": head},
                    "nodes": [],
                    "edges": [],
                },
                f,
            )
        self._write_graph("domain-graph.json", head)

        result = check_upstream_staleness(self.service_root)

        self.assertEqual(result["kg_status"], "fresh")
        self.assertEqual(result["kg_commit"], head)


if __name__ == "__main__":
    unittest.main()
