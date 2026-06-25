import importlib.util
import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path


PARSER_PATH = Path(__file__).resolve().parents[1] / "parse-knowledge-base.py"
MERGE_PATH = Path(__file__).resolve().parents[1] / "merge-knowledge-graph.py"
FIXTURES = Path(__file__).resolve().parent / "fixtures"
spec = importlib.util.spec_from_file_location("parser", PARSER_PATH)
parser = importlib.util.module_from_spec(spec)
spec.loader.exec_module(parser)


class ParserHelperTests(unittest.TestCase):
    fixture_root = FIXTURES

    def run_parser(self, fixture: Path, *args: str):
        return subprocess.run(
            ["python3", str(PARSER_PATH), str(fixture), *args],
            check=False,
            capture_output=True,
            text=True,
        )

    def test_frontmatter_parser_handles_inline_arrays_and_quotes(self):
        text = """---
title: "跨房间 PK"
source_type: prd
source_path: "raw/prd/房间/2025-10-v2.25.0-跨房间PK.md"
tags: ["prd", "房间"]
sources: [raw/prd/房间/2025-10-v2.25.0-跨房间PK.md]
---

# 跨房间 PK
"""

        frontmatter = parser.extract_frontmatter(text)

        self.assertEqual(frontmatter["title"], "跨房间 PK")
        self.assertEqual(frontmatter["source_type"], "prd")
        self.assertEqual(frontmatter["tags"], ["prd", "房间"])
        self.assertEqual(
            frontmatter["sources"],
            ["raw/prd/房间/2025-10-v2.25.0-跨房间PK.md"],
        )

    def test_markdown_links_ignore_images_and_keep_external_links(self):
        text = (
            "[房间](concepts/房间.md) "
            "[Raw](../raw/prd/房间/a.md#section) "
            "[External](https://example.com/doc) "
            "![Image](images/a.png)"
        )

        links = parser.extract_markdown_links(text)

        self.assertEqual([link["label"] for link in links["internal"]], ["房间", "Raw"])
        self.assertEqual(links["internal"][1]["fragment"], "section")
        self.assertEqual(links["external"], ["https://example.com/doc"])

    def test_markdown_links_handle_fragments_titles_parentheses_and_uri_schemes(self):
        text = (
            "[Section](#section) "
            '[Titled](docs/a.md "title") '
            "[Paren](docs/foo_(bar).md) "
            "[Absolute](/docs/root.md) "
            "[Mail](mailto:team@example.com) "
            "[Ftp](ftp://example.com/file.md) "
            "[Obsidian](obsidian://open?vault=kb)"
        )

        links = parser.extract_markdown_links(text)

        self.assertEqual(
            links["internal"],
            [
                {"label": "Section", "target": None, "fragment": "section"},
                {"label": "Titled", "target": "docs/a.md", "fragment": None},
                {"label": "Paren", "target": "docs/foo_(bar).md", "fragment": None},
                {"label": "Absolute", "target": "/docs/root.md", "fragment": None},
            ],
        )
        self.assertEqual(
            links["external"],
            [
                "mailto:team@example.com",
                "ftp://example.com/file.md",
                "obsidian://open?vault=kb",
            ],
        )

    def test_profile_auto_detects_prd_wiki_signals(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            (root / "wiki" / "testcases").mkdir(parents=True)
            (root / "wiki" / "testcases" / "case.md").write_text(
                "# 用例\n",
                encoding="utf-8",
            )
            (root / "wiki" / "index.md").write_text(
                "# Index\n",
                encoding="utf-8",
            )

            detection = parser.detect_format(root)

        self.assertEqual(detection["profile"], "prd-wiki")

    def test_summaries_directory_auto_detects_prd_wiki_and_emits_requirements(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            (root / "wiki" / "summaries").mkdir(parents=True)
            (root / "wiki" / "concepts").mkdir()
            (root / "wiki" / "index.md").write_text(
                "# Index\n\n## 需求\n\n- [活动需求](summaries/activity.md)\n",
                encoding="utf-8",
            )
            (root / "wiki" / "summaries" / "activity.md").write_text(
                "# 活动需求\n\n支持活动入口。\n",
                encoding="utf-8",
            )
            (root / "wiki" / "concepts" / "room.md").write_text(
                "# Room\n",
                encoding="utf-8",
            )

            manifest = parser.parse_wiki(root)

        nodes_by_id = {node["id"]: node for node in manifest["nodes"]}
        self.assertEqual(manifest["profile"], "prd-wiki")
        self.assertEqual(nodes_by_id["requirement:summaries/activity"]["type"], "requirement")

    def test_profile_ignores_raw_frontmatter_in_flat_wiki(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            (root / "raw").mkdir()
            (root / "index.md").write_text("# Index\n", encoding="utf-8")
            (root / "article-a.md").write_text("# Article A\n", encoding="utf-8")
            (root / "article-b.md").write_text("# Article B\n", encoding="utf-8")
            (root / "raw" / "source.md").write_text(
                "---\nsource_type: prd\n---\n# Raw source\n",
                encoding="utf-8",
            )

            detection = parser.detect_format(root)

        self.assertEqual(detection["profile"], "generic")

    def test_parse_wiki_manifest_includes_profile(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            (root / "wiki" / "testcases").mkdir(parents=True)
            (root / "wiki" / "index.md").write_text("# Index\n", encoding="utf-8")
            (root / "wiki" / "article.md").write_text("# Article\n", encoding="utf-8")
            (root / "wiki" / "testcases" / "case.md").write_text(
                "# Case\n",
                encoding="utf-8",
            )

            manifest = parser.parse_wiki(root)

        self.assertEqual(manifest["profile"], "prd-wiki")

    def test_parse_wiki_keeps_string_and_inline_array_tags(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            (root / "wiki").mkdir()
            (root / "wiki" / "index.md").write_text("# Index\n", encoding="utf-8")
            (root / "wiki" / "string-tags.md").write_text(
                "---\ntags: alpha, beta\n---\n# String Tags\n",
                encoding="utf-8",
            )
            (root / "wiki" / "array-tags.md").write_text(
                "---\ntags: [gamma, delta]\n---\n# Array Tags\n",
                encoding="utf-8",
            )

            manifest = parser.parse_wiki(root)

        nodes_by_path = {
            node["filePath"]: node
            for node in manifest["nodes"]
            if node["type"] == "article"
        }
        self.assertEqual(nodes_by_path["string-tags.md"]["tags"], ["alpha", "beta"])
        self.assertEqual(nodes_by_path["array-tags.md"]["tags"], ["delta", "gamma"])

    def test_prd_wiki_scan_emits_requirement_testcase_sources_and_edges(self):
        manifest = parser.parse_wiki(FIXTURES / "prd-wiki")

        self.assertEqual(manifest["profile"], "prd-wiki")
        nodes_by_id = {node["id"]: node for node in manifest["nodes"]}
        required_ids = {
            "requirement:summaries/房间-2025-10-v2.25.0-跨房间PK",
            "testcase:testcases/房间-PK优化",
            "source:prd/房间/2025-10-v2.25.0-跨房间PK",
            "source:testcase/房间/PK优化",
        }
        self.assertTrue(required_ids.issubset(nodes_by_id))

        requirement = nodes_by_id["requirement:summaries/房间-2025-10-v2.25.0-跨房间PK"]
        testcase = nodes_by_id["testcase:testcases/房间-PK优化"]
        self.assertEqual(requirement["type"], "requirement")
        self.assertEqual(testcase["type"], "testcase")
        self.assertEqual(requirement["knowledgeMeta"]["business"], "房间")
        self.assertEqual(requirement["knowledgeMeta"]["version"], "v2.25.0")

        edges = {
            (edge["source"], edge["target"], edge["type"])
            for edge in manifest["edges"]
        }
        self.assertIn(
            (
                "requirement:summaries/房间-2025-10-v2.25.0-跨房间PK",
                "source:prd/房间/2025-10-v2.25.0-跨房间PK",
                "cites",
            ),
            edges,
        )
        self.assertIn(
            (
                "testcase:testcases/房间-PK优化",
                "source:testcase/房间/PK优化",
                "cites",
            ),
            edges,
        )
        self.assertIn(
            (
                "requirement:summaries/房间-2025-10-v2.25.0-跨房间PK",
                "testcase:testcases/房间-PK优化",
                "tested_by",
            ),
            edges,
        )

    def test_prd_wiki_infers_tested_by_from_business_and_normalized_titles(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            (root / "wiki" / "summaries").mkdir(parents=True)
            (root / "wiki" / "testcases").mkdir(parents=True)
            (root / "raw" / "prd" / "房间").mkdir(parents=True)
            (root / "raw" / "testcase" / "房间").mkdir(parents=True)
            (root / "raw" / "testcase" / "聊天").mkdir(parents=True)
            (root / "wiki" / "index.md").write_text("# Index\n", encoding="utf-8")
            (root / "wiki" / "summaries" / "房间-PK优化.md").write_text(
                "---\n"
                "title: PK优化\n"
                "type: summary\n"
                "source_type: prd\n"
                "source_path: raw/prd/房间/PK优化.md\n"
                "filename_business: 房间\n"
                "filename_detail: PK优化\n"
                "---\n"
                "# PK优化\n",
                encoding="utf-8",
            )
            (root / "wiki" / "testcases" / "房间-PK优化.md").write_text(
                "---\n"
                "title: PK优化 测试用例\n"
                "type: testcase\n"
                "source_type: testcase\n"
                "source_path: raw/testcase/房间/PK优化.md\n"
                "---\n"
                "# PK优化 测试用例\n",
                encoding="utf-8",
            )
            (root / "wiki" / "testcases" / "聊天-PK优化.md").write_text(
                "---\n"
                "title: PK优化 测试用例\n"
                "type: testcase\n"
                "source_type: testcase\n"
                "source_path: raw/testcase/聊天/PK优化.md\n"
                "---\n"
                "# PK优化 测试用例\n",
                encoding="utf-8",
            )
            (root / "raw" / "prd" / "房间" / "PK优化.md").write_text("# PRD\n", encoding="utf-8")
            (root / "raw" / "testcase" / "房间" / "PK优化.md").write_text("# Case\n", encoding="utf-8")
            (root / "raw" / "testcase" / "聊天" / "PK优化.md").write_text("# Case\n", encoding="utf-8")

            manifest = parser.parse_wiki(root)

        nodes_by_id = {node["id"]: node for node in manifest["nodes"]}
        self.assertEqual(
            nodes_by_id["testcase:testcases/房间-PK优化"]["knowledgeMeta"]["business"],
            "房间",
        )
        edges = {
            (edge["source"], edge["target"], edge["type"])
            for edge in manifest["edges"]
        }
        self.assertIn(
            (
                "requirement:summaries/房间-PK优化",
                "testcase:testcases/房间-PK优化",
                "tested_by",
            ),
            edges,
        )
        self.assertNotIn(
            (
                "requirement:summaries/房间-PK优化",
                "testcase:testcases/聊天-PK优化",
                "tested_by",
            ),
            edges,
        )

    def test_prd_wiki_prefers_specific_tested_by_matches_per_testcase(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            (root / "wiki" / "summaries").mkdir(parents=True)
            (root / "wiki" / "testcases").mkdir(parents=True)
            (root / "raw" / "prd" / "房间").mkdir(parents=True)
            (root / "raw" / "testcase" / "房间").mkdir(parents=True)
            (root / "wiki" / "index.md").write_text("# Index\n", encoding="utf-8")

            requirements = {
                "房间红包": "房间红包",
                "古尔邦节房间红包换皮": "古尔邦节房间红包换皮",
                "会员等级": "会员等级",
            }
            for file_stem, detail in requirements.items():
                (root / "wiki" / "summaries" / f"{file_stem}.md").write_text(
                    "---\n"
                    f"title: {detail}\n"
                    "type: summary\n"
                    "source_type: prd\n"
                    f"source_path: raw/prd/房间/{file_stem}.md\n"
                    "filename_business: 房间\n"
                    f"filename_detail: {detail}\n"
                    "---\n"
                    f"# {detail}\n",
                    encoding="utf-8",
                )
                (root / "raw" / "prd" / "房间" / f"{file_stem}.md").write_text("# PRD\n", encoding="utf-8")

            testcases = {
                "古尔邦节-房间红包换皮": "古尔邦节-房间红包换皮 测试用例",
                "房间红包-会员等级": "房间红包 会员等级 测试用例",
            }
            for file_stem, title in testcases.items():
                (root / "wiki" / "testcases" / f"{file_stem}.md").write_text(
                    "---\n"
                    f"title: {title}\n"
                    "type: testcase\n"
                    "source_type: testcase\n"
                    f"source_path: raw/testcase/房间/{file_stem}.md\n"
                    "---\n"
                    f"# {title}\n",
                    encoding="utf-8",
                )
                (root / "raw" / "testcase" / "房间" / f"{file_stem}.md").write_text("# Case\n", encoding="utf-8")

            manifest = parser.parse_wiki(root)

        edges = {
            (edge["source"], edge["target"], edge["type"])
            for edge in manifest["edges"]
        }
        specific_case = "testcase:testcases/古尔邦节-房间红包换皮"
        self.assertIn(
            ("requirement:summaries/古尔邦节房间红包换皮", specific_case, "tested_by"),
            edges,
        )
        self.assertNotIn(
            ("requirement:summaries/房间红包", specific_case, "tested_by"),
            edges,
        )

        combo_case = "testcase:testcases/房间红包-会员等级"
        self.assertIn(("requirement:summaries/房间红包", combo_case, "tested_by"), edges)
        self.assertIn(("requirement:summaries/会员等级", combo_case, "tested_by"), edges)

    def test_index_raw_links_do_not_become_category_members(self):
        manifest = parser.parse_wiki(FIXTURES / "prd-wiki")

        categories = {category["name"]: category["count"] for category in manifest["categories"]}
        self.assertEqual(categories["Summaries"], 1)
        self.assertNotIn(
            (
                "source:prd/房间/2025-10-v2.25.0-跨房间PK",
                "topic:summaries",
                "categorized_under",
            ),
            {
                (edge["source"], edge["target"], edge["type"])
                for edge in manifest["edges"]
            },
        )

    def test_unresolved_markdown_links_warn_but_fragment_only_does_not(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            (root / "wiki").mkdir()
            (root / "wiki" / "index.md").write_text("# Index\n", encoding="utf-8")
            (root / "wiki" / "page.md").write_text(
                "# Page\n\n"
                "[Missing Page](missing.md)\n"
                "[Missing Raw](../raw/prd/missing.md)\n"
                "[Fragment](#local-section)\n",
                encoding="utf-8",
            )

            manifest = parser.parse_wiki(root)

        self.assertEqual(manifest["stats"]["unresolved"], 2)
        self.assertTrue(
            any("Unresolved markdown link: missing.md in page.md" in warning for warning in manifest["warnings"])
        )
        self.assertTrue(
            any("../raw/prd/missing.md in page.md" in warning for warning in manifest["warnings"])
        )
        self.assertFalse(any("#local-section" in warning for warning in manifest["warnings"]))

    def test_generic_wiki_does_not_emit_prd_node_types(self):
        manifest = parser.parse_wiki(FIXTURES / "generic-wiki")

        self.assertEqual(manifest["profile"], "generic")
        nodes_by_id = {node["id"]: node for node in manifest["nodes"]}
        self.assertEqual(nodes_by_id["article:concepts/Topic"]["type"], "article")
        emitted_types = {node["type"] for node in manifest["nodes"]}
        self.assertNotIn("requirement", emitted_types)
        self.assertNotIn("testcase", emitted_types)

    def test_profile_override_generic_suppresses_prd_node_types(self):
        manifest = parser.parse_wiki(FIXTURES / "prd-wiki", profile_override="generic")

        self.assertEqual(manifest["profile"], "generic")
        emitted_types = {node["type"] for node in manifest["nodes"]}
        self.assertNotIn("requirement", emitted_types)
        self.assertNotIn("testcase", emitted_types)

    def test_profile_override_prd_wiki_sets_manifest_profile_for_generic_wiki(self):
        manifest = parser.parse_wiki(FIXTURES / "generic-wiki", profile_override="prd-wiki")

        self.assertEqual(manifest["profile"], "prd-wiki")

    def test_parse_writes_standard_knowledge_graph_artifact(self):
        """Dashboard/query integration depends on the standard knowledge-graph.json path."""
        with tempfile.TemporaryDirectory() as temp_dir:
            fixture = Path(temp_dir) / "prd-wiki"
            shutil.copytree(self.fixture_root / "prd-wiki", fixture)
            output_dir = fixture / ".understand-anything"
            final_graph = output_dir / "knowledge-graph.json"

            result = self.run_parser(fixture, "--profile", "prd-wiki")

            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertTrue(final_graph.is_file())
            graph = json.loads(final_graph.read_text(encoding="utf-8"))

        node_types = {node["type"] for node in graph["nodes"]}
        self.assertIn("requirement", node_types)
        self.assertIn("testcase", node_types)
        self.assertIn("prd-wiki", graph["project"].get("frameworks", []))


class MergeFixtureTests(unittest.TestCase):
    def setUp(self):
        spec = importlib.util.spec_from_file_location("merge_module", MERGE_PATH)
        self.merge_module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.merge_module)

    def test_merge_preserves_requirement_testcase_nodes(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            work = Path(temp_dir) / "prd-wiki"
            shutil.copytree(FIXTURES / "prd-wiki", work)
            manifest = parser.parse_wiki(work)
            intermediate = work / ".understand-anything" / "intermediate"
            intermediate.mkdir(parents=True, exist_ok=True)
            (intermediate / "scan-manifest.json").write_text(
                json.dumps(manifest, ensure_ascii=False),
                encoding="utf-8",
            )

            graph = self.merge_module.merge(work)

        node_types = {node["type"] for node in graph["nodes"]}
        self.assertIn("requirement", node_types)
        self.assertIn("testcase", node_types)
        self.assertIn("prd-wiki", graph["project"]["frameworks"])
        self.assertEqual(graph["kind"], "knowledge")
        self.assertEqual(
            graph["project"]["provenance"]["completedStages"],
            ["scan", "batch", "extract", "analyze", "merge", "validate"],
        )
        self.assertFalse(graph["project"]["provenance"]["degraded"])

    def test_merge_preserves_non_ascii_category_layers_and_tour(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            work = Path(temp_dir) / "prd-wiki"
            shutil.copytree(FIXTURES / "prd-wiki", work)
            (work / "wiki" / "index.md").write_text(
                "# 中文 PRD\n\n## 需求\n\n- [跨房间 PK](summaries/房间-2025-10-v2.25.0-跨房间PK.md)\n\n## 测试\n\n- [PK优化 测试用例](testcases/房间-PK优化.md)\n",
                encoding="utf-8",
            )
            manifest = parser.parse_wiki(work)
            intermediate = work / ".understand-anything" / "intermediate"
            intermediate.mkdir(parents=True, exist_ok=True)
            (intermediate / "scan-manifest.json").write_text(
                json.dumps(manifest, ensure_ascii=False),
                encoding="utf-8",
            )

            graph = self.merge_module.merge(work)

        layers = {layer["name"]: layer for layer in graph["layers"]}
        self.assertIn("需求", layers)
        self.assertIn("测试", layers)
        self.assertIn(
            "requirement:summaries/房间-2025-10-v2.25.0-跨房间PK",
            layers["需求"]["nodeIds"],
        )
        self.assertIn("topic:需求", layers["需求"]["nodeIds"])
        self.assertNotIn(
            "requirement:summaries/房间-2025-10-v2.25.0-跨房间PK",
            next(layer["nodeIds"] for layer in graph["layers"] if layer["id"] == "layer:other"),
        )
        self.assertGreater(len(graph["tour"]), 0)

    def test_merge_places_requirement_entity_children_in_requirement_layer(self):
        requirement_id = "requirement:summaries/房间-2025-10-v2.25.0-跨房间PK"
        entity_id = "entity:pk-mode"
        with tempfile.TemporaryDirectory() as temp_dir:
            work = Path(temp_dir) / "prd-wiki"
            shutil.copytree(FIXTURES / "prd-wiki", work)
            manifest = parser.parse_wiki(work)
            intermediate = work / ".understand-anything" / "intermediate"
            intermediate.mkdir(parents=True, exist_ok=True)
            (intermediate / "scan-manifest.json").write_text(
                json.dumps(manifest, ensure_ascii=False),
                encoding="utf-8",
            )
            (intermediate / "analysis-batch-1.json").write_text(
                json.dumps(
                    {
                        "nodes": [
                            {
                                "id": entity_id,
                                "type": "entity",
                                "name": "PK mode",
                                "summary": "Cross-room PK mode",
                                "tags": [],
                                "complexity": "simple",
                            }
                        ],
                        "edges": [
                            {
                                "source": requirement_id,
                                "target": entity_id,
                                "type": "related",
                                "direction": "forward",
                                "weight": 0.7,
                            }
                        ],
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )

            graph = self.merge_module.merge(work)

        layers_by_id = {layer["id"]: layer for layer in graph["layers"]}
        self.assertIn(entity_id, layers_by_id["layer:summaries"]["nodeIds"])
        self.assertNotIn(entity_id, layers_by_id.get("layer:other", {}).get("nodeIds", []))


if __name__ == "__main__":
    unittest.main()
