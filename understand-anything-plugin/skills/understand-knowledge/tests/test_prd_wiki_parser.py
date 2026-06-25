import importlib.util
import tempfile
import unittest
from pathlib import Path


PARSER_PATH = Path(__file__).resolve().parents[1] / "parse-knowledge-base.py"
spec = importlib.util.spec_from_file_location("parser", PARSER_PATH)
parser = importlib.util.module_from_spec(spec)
spec.loader.exec_module(parser)


class ParserHelperTests(unittest.TestCase):
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

    def test_markdown_links_handle_fragments_titles_parentheses_and_non_http_schemes(self):
        text = (
            "[Section](#section) "
            '[Titled](docs/a.md "title") '
            "[Paren](docs/foo_(bar).md) "
            "[Mail](mailto:team@example.com)"
        )

        links = parser.extract_markdown_links(text)

        self.assertEqual(
            links["internal"],
            [
                {"label": "Section", "target": None, "fragment": "section"},
                {"label": "Titled", "target": "docs/a.md", "fragment": None},
                {"label": "Paren", "target": "docs/foo_(bar).md", "fragment": None},
                {"label": "Mail", "target": "mailto:team@example.com", "fragment": None},
            ],
        )
        self.assertEqual(links["external"], [])

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


if __name__ == "__main__":
    unittest.main()
