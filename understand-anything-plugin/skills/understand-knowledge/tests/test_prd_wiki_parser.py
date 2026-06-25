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


if __name__ == "__main__":
    unittest.main()
