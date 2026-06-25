import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

SKILL_DIR = Path(__file__).resolve().parents[1]


def _import_skill_module(filename: str):
    path = SKILL_DIR / filename
    module_name = filename.replace("-", "_").removesuffix(".py")
    spec = importlib.util.spec_from_file_location(module_name, path)
    assert spec and spec.loader, f"Cannot load module from {path}"
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


build_system_graph = _import_skill_module("build-system-graph.py").build_system_graph


class BuildSystemGraphKnowledgeFacetTests(unittest.TestCase):
    def test_discovers_prd_wiki_as_knowledge_facet(self):
        """PRD wikis must be routable by dashboard/query through serviceIndex."""
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            prd = root / "amar-prd" / ".understand-anything"
            prd.mkdir(parents=True)
            (prd / "knowledge-graph.json").write_text(json.dumps({
                "version": "1.0.0",
                "project": {"name": "amar-prd", "frameworks": ["prd-wiki"], "languages": []},
                "nodes": [
                    {"id": "requirement:room", "name": "跨房间 PK", "type": "requirement"},
                    {"id": "testcase:room", "name": "PK 测试", "type": "testcase"},
                    {"id": "source:raw", "name": "原始 PRD", "type": "source"},
                ],
                "edges": [
                    {"source": "requirement:room", "target": "testcase:room", "type": "tested_by"}
                ],
                "layers": [],
                "tour": [],
            }), encoding="utf-8")

            graph = build_system_graph(str(root))

            self.assertEqual(graph["serviceIndex"]["amar-prd"]["facet"], "knowledge")
            self.assertEqual(graph["serviceIndex"]["amar-prd"]["profile"], "prd-wiki")
            self.assertEqual(graph["serviceIndex"]["amar-prd"]["basePath"], "amar-prd")
            self.assertTrue(any(node["id"] == "facet:knowledge" for node in graph["nodes"]))
            self.assertTrue(any(edge["source"] == "facet:knowledge" and edge["target"] == "microservice:amar-prd" for edge in graph["edges"]))


if __name__ == "__main__":
    unittest.main()
