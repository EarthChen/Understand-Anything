#!/usr/bin/env python3
"""Tests for cross-batch edge recovery functions in merge-batch-graphs.py."""
from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

import pytest

MODULE_PATH = Path(__file__).parent / "merge-batch-graphs.py"
spec = importlib.util.spec_from_file_location("merge_batch_graphs", MODULE_PATH)
mbg = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(mbg)


def make_assembled(nodes, edges):
    return {"nodes": nodes, "edges": edges, "metadata": {}}


def make_node(id, type="file", name="", file_path=""):
    return {
        "id": id,
        "type": type,
        "name": name,
        "filePath": file_path,
        "summary": "",
        "tags": [],
    }


def make_edge(source, target, type, weight=0.5):
    return {
        "source": source,
        "target": target,
        "type": type,
        "weight": weight,
        "direction": "forward",
    }


def write_batches(tmp_path: Path, batches: list[dict]) -> Path:
    batches_path = tmp_path / "batches.json"
    batches_path.write_text(
        json.dumps({"batches": batches}, indent=2),
        encoding="utf-8",
    )
    return batches_path


# ── [C] compute_cross_batch_metrics ───────────────────────────────────────


class TestComputeCrossBatchMetrics:
    def test_reports_cross_batch_ratio(self, tmp_path):
        batches_path = write_batches(
            tmp_path,
            [
                {"batchIndex": 1, "files": [{"path": "src/a.m"}]},
                {"batchIndex": 2, "files": [{"path": "src/b.m"}]},
            ],
        )
        assembled = make_assembled(
            [
                make_node("file:src/a.m", file_path="src/a.m"),
                make_node("file:src/b.m", file_path="src/b.m"),
            ],
            [
                make_edge("file:src/a.m", "file:src/b.m", "imports"),
                make_edge("file:src/a.m", "file:src/a.m", "contains"),
            ],
        )

        count, lines = mbg.compute_cross_batch_metrics(assembled, batches_path)
        report = "\n".join(lines)

        assert count == 1
        assert "50" in report or "50.0" in report
        assert "cross-batch" in report.lower()

    def test_warns_when_ratio_below_15_percent(self, tmp_path):
        batches_path = write_batches(
            tmp_path,
            [
                {"batchIndex": 1, "files": [{"path": "src/a.m"}, {"path": "src/b.m"}]},
                {"batchIndex": 2, "files": [{"path": "src/c.m"}]},
            ],
        )
        assembled = make_assembled(
            [
                make_node("file:src/a.m", file_path="src/a.m"),
                make_node("file:src/b.m", file_path="src/b.m"),
                make_node("file:src/c.m", file_path="src/c.m"),
            ],
            [
                make_edge("file:src/a.m", "file:src/b.m", "imports"),
                make_edge("file:src/a.m", "file:src/a.m", "contains"),
                make_edge("file:src/b.m", "file:src/b.m", "contains"),
            ],
        )

        _, lines = mbg.compute_cross_batch_metrics(assembled, batches_path)
        report = "\n".join(lines)

        assert any("warning" in line.lower() for line in lines)
        assert "15" in report

    def test_extracts_filepath_from_class_node_ids(self, tmp_path):
        batches_path = write_batches(
            tmp_path,
            [
                {"batchIndex": 1, "files": [{"path": "src/a.m"}]},
                {"batchIndex": 2, "files": [{"path": "src/b.m"}]},
            ],
        )
        assembled = make_assembled(
            [
                make_node("class:src/a.m:Foo", type="class", name="Foo"),
                make_node("file:src/b.m", file_path="src/b.m"),
            ],
            [make_edge("class:src/a.m:Foo", "file:src/b.m", "depends_on")],
        )

        count, _ = mbg.compute_cross_batch_metrics(assembled, batches_path)
        assert count == 1


# ── [B] recover_header_impl_pairs ─────────────────────────────────────────


class TestRecoverHeaderImplPairs:
    def test_pairs_m_and_h(self):
        assembled = make_assembled(
            [
                make_node("file:src/Foo.m", file_path="src/Foo.m"),
                make_node("file:src/Foo.h", file_path="src/Foo.h"),
            ],
            [],
        )

        count, lines = mbg.recover_header_impl_pairs(assembled)

        assert count == 1
        assert len(assembled["edges"]) == 1
        edge = assembled["edges"][0]
        assert edge["source"] == "file:src/Foo.m"
        assert edge["target"] == "file:src/Foo.h"
        assert edge["type"] == "depends_on"
        assert edge["weight"] == 0.6
        assert edge["recoveredBy"] == "header-impl-pairing"
        assert edge["confidence"] == 0.90
        assert edge["origin"] == "header-impl-pairing"
        assert "Recovered 1" in lines[0]

    def test_pairs_c_and_h(self):
        assembled = make_assembled(
            [
                make_node("file:lib/util.c", file_path="lib/util.c"),
                make_node("file:lib/util.h", file_path="lib/util.h"),
            ],
            [],
        )

        count, _ = mbg.recover_header_impl_pairs(assembled)
        assert count == 1
        assert assembled["edges"][0]["target"] == "file:lib/util.h"

    def test_pairs_cpp_with_h_or_hpp(self):
        assembled = make_assembled(
            [
                make_node("file:src/app.cpp", file_path="src/app.cpp"),
                make_node("file:src/app.hpp", file_path="src/app.hpp"),
            ],
            [],
        )

        count, _ = mbg.recover_header_impl_pairs(assembled)
        assert count == 1
        assert assembled["edges"][0]["target"] == "file:src/app.hpp"

    def test_skips_existing_edge(self):
        assembled = make_assembled(
            [
                make_node("file:src/Foo.m", file_path="src/Foo.m"),
                make_node("file:src/Foo.h", file_path="src/Foo.h"),
            ],
            [make_edge("file:src/Foo.m", "file:src/Foo.h", "depends_on")],
        )

        count, _ = mbg.recover_header_impl_pairs(assembled)
        assert count == 0
        assert len(assembled["edges"]) == 1


# ── [E] recover_heuristic_imports ─────────────────────────────────────────


class TestRecoverHeuristicImports:
    def test_resolves_quoted_imports(self, tmp_path):
        src_dir = tmp_path / "src"
        src_dir.mkdir()
        (src_dir / "Main.m").write_text('#import "Helper.h"\n', encoding="utf-8")
        (src_dir / "Helper.h").write_text("// header\n", encoding="utf-8")

        assembled = make_assembled(
            [
                make_node("file:src/Main.m", file_path="src/Main.m"),
                make_node("file:src/Helper.h", file_path="src/Helper.h"),
            ],
            [],
        )

        count, lines = mbg.recover_heuristic_imports(assembled, tmp_path)

        assert count == 1
        edge = assembled["edges"][0]
        assert edge["source"] == "file:src/Main.m"
        assert edge["target"] == "file:src/Helper.h"
        assert edge["type"] == "imports"
        assert edge["weight"] == 0.7
        assert edge["recoveredBy"] == "heuristic-import"
        assert edge["confidence"] == 0.75
        assert edge["origin"] == "heuristic-import"
        assert "Recovered 1" in lines[0]

    def test_resolves_include_directive(self, tmp_path):
        src_dir = tmp_path / "src"
        src_dir.mkdir()
        (src_dir / "main.c").write_text('#include "utils.h"\n', encoding="utf-8")
        (src_dir / "utils.h").write_text("// utils\n", encoding="utf-8")

        assembled = make_assembled(
            [
                make_node("file:src/main.c", file_path="src/main.c"),
                make_node("file:src/utils.h", file_path="src/utils.h"),
            ],
            [],
        )

        count, _ = mbg.recover_heuristic_imports(assembled, tmp_path)
        assert count == 1

    def test_skips_ambiguous_basename_matches(self, tmp_path):
        src_dir = tmp_path / "src"
        other_dir = tmp_path / "other"
        src_dir.mkdir()
        other_dir.mkdir()
        (src_dir / "Main.m").write_text('#import "Common.h"\n', encoding="utf-8")

        assembled = make_assembled(
            [
                make_node("file:src/Main.m", file_path="src/Main.m"),
                make_node("file:src/Common.h", file_path="src/Common.h"),
                make_node("file:other/Common.h", file_path="other/Common.h"),
            ],
            [],
        )

        count, _ = mbg.recover_heuristic_imports(assembled, tmp_path)
        assert count == 0


# ── [D] recover_lockfile_module_deps ──────────────────────────────────────


class TestRecoverLockfileModuleDeps:
    def test_parses_podfile_lock_and_creates_edges(self, tmp_path):
        lock_content = """PODS:
  - MyApp (1.0.0):
    - AFNetworking
    - SDWebImage
  - AFNetworking (4.0.1):
    - AFNetworking/NSURLSession (= 4.0.1)
DEPENDENCIES:
  - AFNetworking
"""
        (tmp_path / "Podfile.lock").write_text(lock_content, encoding="utf-8")

        assembled = make_assembled(
            [
                make_node("module:MyApp", type="module", name="MyApp"),
                make_node("module:AFNetworking", type="module", name="AFNetworking"),
                make_node("module:SDWebImage", type="module", name="SDWebImage"),
            ],
            [],
        )

        count, lines = mbg.recover_lockfile_module_deps(assembled, tmp_path)

        assert count == 2
        edges = {(e["source"], e["target"]) for e in assembled["edges"]}
        assert ("module:MyApp", "module:AFNetworking") in edges
        assert ("module:MyApp", "module:SDWebImage") in edges
        for edge in assembled["edges"]:
            assert edge["type"] == "depends_on"
            assert edge["weight"] == 0.6
            assert edge["recoveredBy"] == "lockfile-deps"
            assert edge["confidence"] == 0.85
            assert edge["origin"] == "lockfile-deps"
        assert "Recovered 2" in lines[0]

    def test_skips_when_no_podfile_lock(self, tmp_path):
        assembled = make_assembled([], [])
        count, lines = mbg.recover_lockfile_module_deps(assembled, tmp_path)
        assert count == 0
        assert any("skipped" in line.lower() for line in lines)


# ── [I] confidence + origin on existing recovery functions ──────────────────


class TestRecoveryConfidenceAndOrigin:
    def test_import_map_recovery_fields(self, tmp_path):
        scan_path = tmp_path / "scan-result.json"
        scan_path.write_text(
            json.dumps({"importMap": {"src/A.java": ["src/B.java"]}}),
            encoding="utf-8",
        )
        assembled = make_assembled(
            [
                make_node("file:src/A.java", file_path="src/A.java"),
                make_node("file:src/B.java", file_path="src/B.java"),
            ],
            [],
        )

        mbg.recover_imports_from_scan(assembled, scan_path)
        edge = assembled["edges"][0]
        assert edge["confidence"] == 0.95
        assert edge["origin"] == "importMap-recovery"

    def test_rpc_recovery_fields(self):
        extraction_data = [{
            "path": "src/Service.java",
            "classes": [{
                "name": "MyService",
                "annotations": [{"name": "DubboService"}],
                "interfaces": ["com.example.Api"],
                "typedProperties": [],
                "methods": [],
            }],
            "functions": [],
        }]
        assembled = make_assembled(
            [make_node("class:src/Service.java:MyService", type="class", name="MyService")],
            [],
        )

        mbg.recover_rpc_mq_from_extraction(assembled, Path("/nonexistent"), extraction_data)
        edge = assembled["edges"][0]
        assert edge["confidence"] == 0.85
        assert edge["origin"] == "rpc-mq-recovery"

    def test_di_recovery_fields(self):
        extraction_data = [{
            "path": "src/Controller.java",
            "classes": [{
                "name": "MyController",
                "typedProperties": [{
                    "name": "service",
                    "type": "MyService",
                    "annotations": [{"name": "Autowired"}],
                }],
            }],
        }]
        assembled = make_assembled(
            [
                make_node("class:src/Controller.java:MyController", type="class"),
                make_node("class:src/Service.java:MyService", type="class"),
            ],
            [],
        )

        mbg.recover_injects_from_extraction(assembled, Path("/nonexistent"), extraction_data)
        edge = assembled["edges"][0]
        assert edge["confidence"] == 0.80
        assert edge["origin"] == "di-recovery"


# ── [H] resolve_unresolved_imports ────────────────────────────────────────


def write_extraction_results(tmp_path: Path, results: list[dict], batch: int = 1) -> Path:
    path = tmp_path / f"ua-file-extract-results-{batch}.json"
    path.write_text(json.dumps({"results": results}, indent=2), encoding="utf-8")
    return path


class TestResolveUnresolvedImports:
    def test_resolves_unresolved_import_by_full_basename(self, tmp_path):
        write_extraction_results(
            tmp_path,
            [{
                "path": "Source/Manager.m",
                "unresolvedImports": [{"source": "Manager.h", "line": 1, "kind": "import"}],
            }],
        )
        assembled = make_assembled(
            [
                make_node("file:Source/Manager.m", file_path="Source/Manager.m"),
                make_node("file:Source/Manager.h", file_path="Source/Manager.h"),
            ],
            [],
        )

        count, lines = mbg.resolve_unresolved_imports(assembled, tmp_path)

        assert count == 1
        assert len(assembled["edges"]) == 1
        edge = assembled["edges"][0]
        assert edge["source"] == "file:Source/Manager.m"
        assert edge["target"] == "file:Source/Manager.h"
        assert edge["type"] == "imports"
        assert edge["weight"] == 0.7
        assert edge["confidence"] == 0.80
        assert edge["origin"] == "unresolved-global-resolve"
        assert "Resolved 1" in lines[1]

    def test_resolves_by_stem_when_no_extension_match(self, tmp_path):
        write_extraction_results(
            tmp_path,
            [{
                "path": "Source/Manager.m",
                "unresolvedImports": [{"source": "Manager", "line": 1, "kind": "import"}],
            }],
        )
        assembled = make_assembled(
            [
                make_node("file:Source/Manager.m", file_path="Source/Manager.m"),
                make_node("file:Source/Manager.h", file_path="Source/Manager.h"),
            ],
            [],
        )

        count, _ = mbg.resolve_unresolved_imports(assembled, tmp_path)

        assert count == 1
        assert assembled["edges"][0]["target"] == "file:Source/Manager.h"

    def test_skips_ambiguous_matches(self, tmp_path):
        write_extraction_results(
            tmp_path,
            [{
                "path": "src/Main.m",
                "unresolvedImports": [{"source": "Common.h", "line": 1, "kind": "import"}],
            }],
        )
        assembled = make_assembled(
            [
                make_node("file:src/Main.m", file_path="src/Main.m"),
                make_node("file:src/Common.h", file_path="src/Common.h"),
                make_node("file:other/Common.h", file_path="other/Common.h"),
            ],
            [],
        )

        count, lines = mbg.resolve_unresolved_imports(assembled, tmp_path)

        assert count == 0
        assert len(assembled["edges"]) == 0
        assert any("ambiguous" in line.lower() for line in lines)

    def test_skips_self_references(self, tmp_path):
        write_extraction_results(
            tmp_path,
            [{
                "path": "Source/Manager.h",
                "unresolvedImports": [{"source": "Manager.h", "line": 1, "kind": "import"}],
            }],
        )
        assembled = make_assembled(
            [make_node("file:Source/Manager.h", file_path="Source/Manager.h")],
            [],
        )

        count, _ = mbg.resolve_unresolved_imports(assembled, tmp_path)

        assert count == 0
        assert len(assembled["edges"]) == 0

    def test_returns_empty_when_no_extraction_files(self, tmp_path):
        assembled = make_assembled([], [])

        count, lines = mbg.resolve_unresolved_imports(assembled, tmp_path)

        assert count == 0
        assert any("no extraction result files" in line.lower() for line in lines)
