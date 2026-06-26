"""Tests for knowledge read subcommand."""
import unittest
from unittest.mock import patch, MagicMock
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))


class TestKnowledgeReadCommand(unittest.TestCase):
    @patch("_helpers.fetch_json")
    def test_single_node_read(self, mock_fetch):
        mock_fetch.return_value = {
            "nodes": [
                {
                    "id": "article:concepts/Room",
                    "type": "article",
                    "name": "Room",
                    "knowledgeMeta": {"content": "# Room\n\nRoom domain content."},
                }
            ]
        }
        from _commands import cmd_knowledge
        import argparse

        args = argparse.Namespace(
            server="http://localhost:3001",
            service=None,
            knowledge_action="read",
            node="article:concepts/Room",
            format="json",
        )
        with patch("_commands._resolve_knowledge_service", return_value="test-svc"):
            result = cmd_knowledge(args)

        self.assertEqual(result["kind"], "knowledge-read")
        self.assertEqual(result["total"], 1)
        self.assertEqual(result["nodes"][0]["id"], "article:concepts/Room")

    @patch("_helpers.fetch_json")
    def test_multiple_nodes_read(self, mock_fetch):
        mock_fetch.return_value = {
            "nodes": [
                {"id": "article:A", "type": "article", "name": "A"},
                {"id": "article:B", "type": "article", "name": "B"},
            ]
        }
        from _commands import cmd_knowledge
        import argparse

        args = argparse.Namespace(
            server="http://localhost:3001",
            service="test-svc",
            knowledge_action="read",
            node="article:A,article:B",
            format="json",
        )
        result = cmd_knowledge(args)

        self.assertEqual(result["total"], 2)
        call_args = mock_fetch.call_args
        nodes_param = call_args[0][2].get("nodes", "")
        self.assertIn("article:A", nodes_param)
        self.assertIn("article:B", nodes_param)

    @patch("_helpers.fetch_json")
    def test_node_limit_caps_at_10(self, mock_fetch):
        mock_fetch.return_value = {"nodes": []}
        from _commands import cmd_knowledge
        import argparse

        many_ids = ",".join(f"article:node{i}" for i in range(15))
        args = argparse.Namespace(
            server="http://localhost:3001",
            service="test-svc",
            knowledge_action="read",
            node=many_ids,
            format="json",
        )
        result = cmd_knowledge(args)

        call_args = mock_fetch.call_args
        nodes_param = call_args[0][2].get("nodes", "")
        actual_count = len([n for n in nodes_param.split(",") if n.strip()])
        self.assertLessEqual(actual_count, 10)


if __name__ == "__main__":
    unittest.main()
