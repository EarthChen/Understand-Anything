"""Tests for cmd_ask PRD context from knowledge services.

Verifies that cmd_ask queries knowledge services (e.g. amar-prd) for PRD
content after business context and before trace, and includes results in
result["prdContext"].
"""
import argparse
import pytest
from pathlib import Path
from unittest.mock import patch

import sys

sys.path.insert(0, str(Path(__file__).parent.parent))

from _commands import cmd_ask


def _make_ask_args(**overrides):
    defaults = {
        "server": "http://localhost:3001",
        "service": None,
        "query": "公会结算",
        "depth": "standard",
        "platform": None,
        "limit": 5,
        "fusion": "rrf",
        "format": "json",
    }
    defaults.update(overrides)
    return argparse.Namespace(**defaults)


PRD_RESULT = [{"id": "requirement:1", "name": "公会结算需求", "type": "requirement"}]


class TestCmdAskPrdContext:
    """cmd_ask should query knowledge services and include prdContext."""

    @patch("_commands.cmd_trace")
    @patch("_commands._search_api")
    @patch("_helpers._discover_knowledge_services")
    @patch("_commands._auto_discover_service")
    def test_cmd_ask_includes_prd_context_when_knowledge_service_exists(
        self, mock_auto_discover, mock_discover, mock_search, mock_trace
    ):
        mock_auto_discover.return_value = ("code-svc", [{"name": "biz hit"}])
        mock_discover.return_value = ["amar-prd"]
        mock_search.return_value = PRD_RESULT
        mock_trace.return_value = {"matchedNodes": [], "hint": "No KG nodes matched"}

        args = _make_ask_args(query="公会结算", depth="standard")
        result = cmd_ask(args)

        assert "prdContext" in result
        assert result["prdContext"] == PRD_RESULT

        prd_calls = [
            c for c in mock_search.call_args_list
            if c.kwargs.get("service") == "amar-prd" and c.kwargs.get("scope") == "kg"
        ]
        assert len(prd_calls) == 1
        mock_trace.assert_called_once()

    @patch("_commands.cmd_trace")
    @patch("_commands._search_api")
    @patch("_helpers._discover_knowledge_services")
    def test_cmd_ask_prd_context_empty_when_no_knowledge_services(
        self, mock_discover, mock_search, mock_trace
    ):
        mock_discover.return_value = []
        mock_trace.return_value = {"matchedNodes": []}

        args = _make_ask_args(service="code-svc", depth="standard")
        result = cmd_ask(args)

        assert result.get("prdContext") == []

        kg_calls = [
            c for c in mock_search.call_args_list
            if c.kwargs.get("scope") == "kg"
        ]
        assert len(kg_calls) == 0

    @patch("_commands.cmd_trace")
    @patch("_commands._search_api")
    @patch("_helpers._discover_knowledge_services")
    def test_cmd_ask_prd_context_survives_search_error(
        self, mock_discover, mock_search, mock_trace
    ):
        mock_discover.return_value = ["amar-prd"]

        def search_side_effect(server, query, **kwargs):
            if kwargs.get("scope") == "kg" and kwargs.get("service") == "amar-prd":
                raise RuntimeError("knowledge search failed")
            return []

        mock_search.side_effect = search_side_effect
        mock_trace.return_value = {"matchedNodes": [{"id": "node:1", "name": "TestNode"}]}

        args = _make_ask_args(service="code-svc", depth="standard")
        result = cmd_ask(args)

        assert result.get("prdContext") == []
        mock_trace.assert_called_once()
        assert result.get("matchedNodes") == [{"id": "node:1", "name": "TestNode"}]

    @patch("_helpers._discover_knowledge_services")
    @patch("_commands._auto_discover_service")
    def test_cmd_ask_quick_depth_skips_prd_context(
        self, mock_auto_discover, mock_discover
    ):
        mock_auto_discover.return_value = ("code-svc", [{"name": "biz hit"}])
        mock_discover.return_value = ["amar-prd"]

        args = _make_ask_args(query="公会结算", depth="quick")
        result = cmd_ask(args)

        mock_discover.assert_not_called()
        assert "prdContext" not in result or result.get("prdContext") == []

    @patch("_commands.cmd_trace")
    @patch("_commands._search_api")
    @patch("_helpers._discover_knowledge_services")
    def test_cmd_ask_prd_context_merges_multiple_knowledge_services(
        self, mock_discover, mock_search, mock_trace
    ):
        mock_discover.return_value = ["prd-a", "prd-b"]

        prd_a_result = [{"id": "requirement:a", "name": "需求 A"}]
        prd_b_result = [{"id": "requirement:b", "name": "需求 B"}]

        def search_side_effect(server, query, **kwargs):
            svc = kwargs.get("service")
            if kwargs.get("scope") == "kg" and svc == "prd-a":
                return prd_a_result
            if kwargs.get("scope") == "kg" and svc == "prd-b":
                return prd_b_result
            return []

        mock_search.side_effect = search_side_effect
        mock_trace.return_value = {"matchedNodes": []}

        args = _make_ask_args(service="code-svc", query="跨房间 PK", depth="standard")
        result = cmd_ask(args)

        assert result.get("prdContext") == prd_a_result + prd_b_result
