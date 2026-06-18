"""Tests for ask --depth full domain flows handling.

Verifies that:
1. cmd_ask supplements domain flows when trace returns none
2. _fetch_domain_flows returns all flows in return_all mode
3. cmd_trace queries wiki/domain flows even on KG miss
4. Worker agent definition has drill-down constraint
"""
import argparse
import json
import pytest
from pathlib import Path
from unittest.mock import patch, MagicMock

import sys

sys.path.insert(0, str(Path(__file__).parent.parent))

from _helpers import _fetch_domain_flows
from _commands import cmd_ask, cmd_trace, _make_trace_args


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def mock_domain_graph():
    """Domain graph with multiple flows, some matching keywords."""
    return {
        "nodes": [
            {"id": "flow:1", "type": "flow", "name": "公会佣金周结算流程", "summary": "定时触发公会周结算"},
            {"id": "flow:2", "type": "flow", "name": "个人收益结算流程", "summary": "Kafka消费礼物订单后实时累加"},
            {"id": "flow:3", "type": "flow", "name": "Web端公会注册申请流程", "summary": "公会长通过Web端注册"},
            {"id": "step:1a", "type": "step", "name": "读取周结算账期配置"},
            {"id": "step:1b", "type": "step", "name": "执行公会周收益刷新"},
        ],
        "edges": [
            {"source": "flow:1", "target": "step:1a", "type": "flow_step", "weight": 1},
            {"source": "flow:1", "target": "step:1b", "type": "flow_step", "weight": 2},
        ],
    }


@pytest.fixture
def empty_domain_graph():
    """Domain graph with no flow nodes."""
    return {
        "nodes": [
            {"id": "step:1", "type": "step", "name": "some step"},
        ],
        "edges": [],
    }


# ---------------------------------------------------------------------------
# Test 1: cmd_ask supplements domain flows
# ---------------------------------------------------------------------------

class TestCmdAskSupplementsDomainFlows:
    """cmd_ask should call _fetch_domain_flows when trace returns no domainFlows."""

    @patch("_commands._fetch_domain_flows")
    @patch("_commands.cmd_trace")
    def test_ask_full_supplements_domain_flows_when_trace_misses(
        self, mock_trace, mock_fetch_flows
    ):
        """When cmd_trace returns no domainFlows (KG miss), cmd_ask should
        independently call _fetch_domain_flows and include the result."""
        # cmd_trace returns no domainFlows (simulating KG miss)
        mock_trace.return_value = {
            "matchedNodes": [],
            "hint": "No KG nodes matched",
        }
        mock_fetch_flows.return_value = [
            {"flow": {"name": "公会佣金周结算流程"}, "steps": []}
        ]

        args = _make_trace_args(
            server="http://localhost:3001",
            service="ultron-guild",
            query="公会结算",
            depth="full",
        )
        # cmd_ask reads depth from args
        args.depth = "full"

        result = cmd_ask(args)

        # Should have called _fetch_domain_flows
        mock_fetch_flows.assert_called_once()
        assert result.get("domainFlows") is not None
        assert len(result["domainFlows"]) == 1

    @patch("_commands._fetch_domain_flows")
    @patch("_commands.cmd_trace")
    def test_ask_full_does_not_override_existing_domain_flows(
        self, mock_trace, mock_fetch_flows
    ):
        """When cmd_trace already returned domainFlows, cmd_ask should NOT
        overwrite them with a fresh call."""
        existing_flows = [{"flow": {"name": "existing flow"}, "steps": []}]
        mock_trace.return_value = {
            "matchedNodes": [{"id": "node:1", "name": "TestNode"}],
            "domainFlows": existing_flows,
        }

        args = _make_trace_args(
            server="http://localhost:3001",
            service="ultron-guild",
            query="公会结算",
            depth="full",
        )
        args.depth = "full"

        result = cmd_ask(args)

        # Should NOT have called _fetch_domain_flows
        mock_fetch_flows.assert_not_called()
        assert result["domainFlows"] == existing_flows


# ---------------------------------------------------------------------------
# Test 2: _fetch_domain_flows return_all mode
# ---------------------------------------------------------------------------

class TestFetchDomainFlowsAllMode:
    """_fetch_domain_flows should support returning all flows when return_all=True."""

    @patch("_helpers.fetch_json")
    def test_returns_all_flow_names_and_summaries(self, mock_fetch, mock_domain_graph):
        """When return_all=True, returns all flows with name+summary,
        not just keyword-matched ones."""
        mock_fetch.return_value = mock_domain_graph

        result = _fetch_domain_flows(
            "http://localhost:3001", "ultron-guild", "公会结算", return_all=True
        )

        assert result is not None
        # Should return all 3 flows, not just the keyword-matched one
        flow_names = [r["flow"]["name"] for r in result]
        assert "公会佣金周结算流程" in flow_names
        assert "个人收益结算流程" in flow_names  # Previously would be missed
        assert "Web端公会注册申请流程" in flow_names

    @patch("_helpers.fetch_json")
    def test_keyword_matched_flows_include_steps(self, mock_fetch, mock_domain_graph):
        """Flows matching keywords should still include detailed steps."""
        mock_fetch.return_value = mock_domain_graph

        # Use "佣金" as keyword — it IS a substring of "公会佣金周结算流程"
        result = _fetch_domain_flows(
            "http://localhost:3001", "ultron-guild", "佣金", return_all=True
        )

        assert result is not None
        # Find the keyword-matched flow
        matched = [r for r in result if r["flow"]["name"] == "公会佣金周结算流程"]
        assert len(matched) == 1
        assert len(matched[0]["steps"]) == 2  # Has steps from edges

        # Non-matched flows should have empty steps
        unmatched = [r for r in result if r["flow"]["name"] == "个人收益结算流程"]
        assert len(unmatched) == 1
        assert len(unmatched[0]["steps"]) == 0

    @patch("_helpers.fetch_json")
    def test_returns_none_when_no_flows_exist(self, mock_fetch, empty_domain_graph):
        """Returns None when domain graph has no flow nodes."""
        mock_fetch.return_value = empty_domain_graph

        result = _fetch_domain_flows(
            "http://localhost:3001", "ultron-guild", "公会结算"
        )

        assert result is None


# ---------------------------------------------------------------------------
# Test 3: cmd_trace executes wiki/domain even on KG miss
# ---------------------------------------------------------------------------

class TestCmdTraceWikiDomainOnKgMiss:
    """cmd_trace should query wiki/domain flows regardless of KG match status."""

    @patch("_commands._fetch_domain_flows")
    @patch("_commands._fetch_wiki_domain")
    @patch("_helpers.fetch_json")
    def test_trace_queries_domain_flows_even_when_no_kg_match(
        self, mock_fetch, mock_wiki, mock_flows
    ):
        """cmd_trace should query domain flows even when KG search returns no matches."""
        # Simulate KG miss: search returns empty
        def side_effect(server, path, params=None):
            if "/api/kg" in path or "search" in path:
                return {"results": [], "nodes": []}
            if "/api/graph" in path and params and params.get("file") == "domain-graph.json":
                return {
                    "nodes": [{"id": "flow:1", "type": "flow", "name": "Test Flow", "summary": "test"}],
                    "edges": [],
                }
            return {}

        mock_fetch.side_effect = side_effect
        mock_wiki.return_value = None
        mock_flows.return_value = [{"flow": {"name": "Test Flow"}, "steps": []}]

        args = _make_trace_args(
            server="http://localhost:3001",
            service="ultron-guild",
            query="公会结算",
            domain_flows=True,
        )

        result = cmd_trace(args)

        # domain flows should be queried even though KG had no matches
        mock_flows.assert_called_once()
        assert result.get("domainFlows") is not None

    @patch("_commands._fetch_wiki_domain")
    @patch("_helpers.fetch_json")
    def test_trace_queries_wiki_even_when_no_kg_match(self, mock_fetch, mock_wiki):
        """cmd_trace should query wiki even when KG search returns no matches."""
        def side_effect(server, path, params=None):
            if "/api/kg" in path or "search" in path:
                return {"results": [], "nodes": []}
            return {}

        mock_fetch.side_effect = side_effect
        mock_wiki.return_value = {"domain": "settlement", "detail": "wiki content"}

        args = _make_trace_args(
            server="http://localhost:3001",
            service="ultron-guild",
            query="公会结算",
            wiki=True,
        )

        result = cmd_trace(args)

        # wiki should be queried even though KG had no matches
        mock_wiki.assert_called_once()
        assert result.get("wikiDomain") is not None


# ---------------------------------------------------------------------------
# Test 4: Worker agent definition
# ---------------------------------------------------------------------------

class TestWorkerAgentDefinition:
    """Worker agent definition should contain drill-down constraint."""

    def test_worker_has_drill_down_only_directive(self):
        """Worker agent definition should contain 'Drill-down only' directive."""
        worker_path = Path(__file__).parent.parent.parent.parent / "agents" / "understand-query-worker.md"
        if not worker_path.exists():
            pytest.skip(f"Worker agent file not found at {worker_path}")

        content = worker_path.read_text()
        assert "Drill-down only" in content or "drill-down only" in content.lower(), (
            "Worker agent definition should contain drill-down only constraint"
        )
