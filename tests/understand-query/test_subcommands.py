# tests/understand-query/test_subcommands.py
import json
import sys
from pathlib import Path
from unittest.mock import patch
from urllib.parse import parse_qs, urlparse

import pytest

SKILL_DIR = Path(__file__).resolve().parent.parent.parent / "understand-anything-plugin" / "skills" / "understand-query"
sys.path.insert(0, str(SKILL_DIR))
import ua_query  # noqa: E402

SERVER = "http://localhost:3001"


@pytest.fixture
def mock_fetch():
    with patch.object(ua_query, "fetch_json") as m:
        yield m


class TestKgSubcommand:
    def test_kg_list_nodes(self, mock_fetch, capsys):
        mock_fetch.return_value = {"nodes": [{"id": "n1", "type": "class", "name": "OrderController"}]}
        ua_query.main(["--server", SERVER, "kg", "--service", "order-service", "--type", "node"])
        out = json.loads(capsys.readouterr().out)
        assert out["nodes"][0]["name"] == "OrderController"
        mock_fetch.assert_called_once()
        assert "/api/graph" in mock_fetch.call_args[0][0]


class TestBusinessSubcommand:
    def test_business_list(self, mock_fetch, capsys):
        mock_fetch.return_value = {"domains": [{"id": "domain:order", "name": "Order"}]}
        ua_query.main(["--server", SERVER, "business", "--list"])
        out = json.loads(capsys.readouterr().out)
        assert len(out["domains"]) == 1

    def test_business_search(self, mock_fetch, capsys):
        mock_fetch.return_value = {"results": [{"id": "domain:order", "name": "Order", "match": "下单"}]}
        ua_query.main(["--server", SERVER, "business", "--search", "下单"])
        assert "results" in json.loads(capsys.readouterr().out)

    def test_business_search_comma_keywords_sent_as_single_query(self, mock_fetch):
        """Comma-separated keywords are sent as one q param; API splits and OR-matches."""
        mock_fetch.return_value = {"results": [{"id": "domain:friend", "name": "ClosedFriend", "match": "挚友"}]}
        ua_query.main(["--server", SERVER, "business", "--search", "挚友,ClosedFriend"])
        url = mock_fetch.call_args[0][0]
        assert "/api/search" in url
        qs = parse_qs(urlparse(url).query)
        assert qs["q"] == ["挚友,ClosedFriend"]
        assert qs["scope"] == ["business"]


class TestWikiSubcommand:
    """Bug 3: 'structure', 'flow', and default branches were dead/duplicate code.
    After fix: all three should hit the same /api/wiki/service/ endpoint,
    and cmd_wiki should have no redundant branches."""

    def test_wiki_type_structure_fetches_service_endpoint(self, mock_fetch):
        mock_fetch.return_value = {"sections": []}
        ua_query.main(["wiki", "--service", "svc", "--type", "structure"])
        url = mock_fetch.call_args[0][0]
        assert "/api/wiki/service/" in url

    def test_wiki_type_flow_fetches_service_endpoint(self, mock_fetch):
        mock_fetch.return_value = {"flows": []}
        ua_query.main(["wiki", "--service", "svc", "--type", "flow"])
        url = mock_fetch.call_args[0][0]
        assert "/api/wiki/service/" in url

    def test_wiki_default_fetches_service_endpoint(self, mock_fetch):
        mock_fetch.return_value = {"content": "ok"}
        ua_query.main(["wiki", "--service", "svc"])
        url = mock_fetch.call_args[0][0]
        assert "/api/wiki/service/" in url

