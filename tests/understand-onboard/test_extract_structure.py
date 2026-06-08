"""Tests for extract-structure.py — extracts structured data from knowledge graphs."""

import importlib.util
import json
import subprocess
import sys
from pathlib import Path

import pytest

# Import the module with a hyphenated filename via importlib
SCRIPTS_DIR = Path(__file__).resolve().parents[2] / "understand-anything-plugin" / "skills" / "understand-onboard" / "scripts"
_spec = importlib.util.spec_from_file_location("extract_structure", SCRIPTS_DIR / "extract-structure.py")
_mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_mod)
extract = _mod.extract


@pytest.fixture
def tmp_kg(tmp_path):
    """Helper to write a knowledge graph dict to a temp file and return its path."""
    def _write(kg_data):
        p = tmp_path / "knowledge-graph.json"
        p.write_text(json.dumps(kg_data))
        return str(p)
    return _write


class TestExtract:
    def test_basic_graph(self, tmp_kg):
        kg = {
            "nodes": [
                {"id": "n1", "type": "file", "layer": "src", "name": "main.py"},
                {"id": "n2", "type": "endpoint", "layer": "api", "name": "/health"},
                {"id": "n3", "type": "file", "layer": "src", "name": "utils.py"},
            ],
            "edges": [
                {"source": "n1", "target": "n2"},
                {"source": "n1", "target": "n3"},
            ],
        }
        result = extract(tmp_kg(kg))

        assert result["totalNodes"] == 3
        assert result["totalEdges"] == 2
        assert result["nodesByType"] == {"file": 2, "endpoint": 1}
        assert result["layers"] == ["api", "src"]
        assert result["entryPointCount"] == 1
        assert len(result["topEntryPoints"]) == 1
        assert result["topEntryPoints"][0]["id"] == "n2"
        assert result["topEntryPoints"][0]["label"] == "/health"

    def test_empty_graph(self, tmp_kg):
        kg = {"nodes": [], "edges": []}
        result = extract(tmp_kg(kg))

        assert result["totalNodes"] == 0
        assert result["totalEdges"] == 0
        assert result["nodesByType"] == {}
        assert result["layers"] == []
        assert result["entryPointCount"] == 0
        assert result["topEntryPoints"] == []

    def test_missing_edges_key(self, tmp_kg):
        kg = {"nodes": [{"id": "n1", "type": "file", "layer": "src"}]}
        result = extract(tmp_kg(kg))

        assert result["totalNodes"] == 1
        assert result["totalEdges"] == 0

    def test_missing_type_defaults_to_unknown(self, tmp_kg):
        kg = {
            "nodes": [
                {"id": "n1", "layer": "src"},
                {"id": "n2", "type": "file", "layer": "src"},
            ],
            "edges": [],
        }
        result = extract(tmp_kg(kg))

        assert result["nodesByType"] == {"unknown": 1, "file": 1}

    def test_missing_layer_defaults_to_unknown(self, tmp_kg):
        kg = {
            "nodes": [{"id": "n1", "type": "file"}],
            "edges": [],
        }
        result = extract(tmp_kg(kg))

        assert result["layers"] == ["unknown"]

    def test_top_entry_points_limited_to_10(self, tmp_kg):
        nodes = [
            {"id": f"ep{i}", "type": "endpoint", "layer": "api", "name": f"/route{i}"}
            for i in range(15)
        ]
        kg = {"nodes": nodes, "edges": []}
        result = extract(tmp_kg(kg))

        assert result["entryPointCount"] == 15
        assert len(result["topEntryPoints"]) == 10

    def test_entry_point_uses_id_as_label_when_name_missing(self, tmp_kg):
        kg = {
            "nodes": [{"id": "ep1", "type": "endpoint", "layer": "api"}],
            "edges": [],
        }
        result = extract(tmp_kg(kg))

        assert result["topEntryPoints"][0]["label"] == "ep1"

    def test_layers_are_sorted(self, tmp_kg):
        kg = {
            "nodes": [
                {"id": "n1", "type": "file", "layer": "z-layer"},
                {"id": "n2", "type": "file", "layer": "a-layer"},
                {"id": "n3", "type": "file", "layer": "m-layer"},
            ],
            "edges": [],
        }
        result = extract(tmp_kg(kg))

        assert result["layers"] == ["a-layer", "m-layer", "z-layer"]


class TestMainCLI:
    """Test the CLI entry point via subprocess."""

    def test_main_writes_output_file(self, tmp_path):
        kg = {
            "nodes": [{"id": "n1", "type": "file", "layer": "src", "name": "a.py"}],
            "edges": [],
        }
        kg_path = tmp_path / "kg.json"
        kg_path.write_text(json.dumps(kg))
        out_path = tmp_path / "output" / "structure.json"

        result = subprocess.run(
            [sys.executable, str(SCRIPTS_DIR / "extract-structure.py"), str(kg_path), str(out_path)],
            capture_output=True, text=True, timeout=10,
        )

        assert result.returncode == 0
        assert out_path.exists()
        data = json.loads(out_path.read_text())
        assert data["totalNodes"] == 1
        assert "1 nodes" in result.stdout

    def test_main_exits_with_error_on_missing_args(self):
        result = subprocess.run(
            [sys.executable, str(SCRIPTS_DIR / "extract-structure.py")],
            capture_output=True, text=True, timeout=10,
        )

        assert result.returncode == 1
        assert "Usage" in result.stderr
