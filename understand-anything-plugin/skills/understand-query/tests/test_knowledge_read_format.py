"""Tests for knowledge-read and knowledge-search markdown formatting."""
import unittest
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from _utils import _format_markdown


class TestKnowledgeReadFormat(unittest.TestCase):
    def test_knowledge_read_renders_content(self):
        data = {
            "kind": "knowledge-read",
            "service": "test-svc",
            "nodes": [
                {
                    "id": "article:concepts/Room",
                    "type": "article",
                    "name": "Room",
                    "filePath": "wiki/concepts/Room.md",
                    "knowledgeMeta": {
                        "content": "# Room\n\nRoom business domain.",
                        "sourcePath": "raw/prd/Room.md",
                    },
                }
            ],
            "total": 1,
        }
        output = _format_markdown(data)
        self.assertIn("Room", output)
        self.assertIn("Room business domain", output)
        self.assertIn("raw/prd/Room.md", output)

    def test_knowledge_search_shows_snippet(self):
        data = {
            "kind": "knowledge-search",
            "service": "test-svc",
            "query": "room",
            "results": [
                {
                    "id": "article:concepts/Room",
                    "name": "Room",
                    "type": "article",
                    "summary": "Room domain overview",
                    "score": 8.5,
                    "contentSnippet": "Room business domain covers PK, gifts, and more.",
                }
            ],
        }
        output = _format_markdown(data)
        self.assertIn("Room", output)
        self.assertIn("Room business domain covers PK", output)


if __name__ == "__main__":
    unittest.main()
