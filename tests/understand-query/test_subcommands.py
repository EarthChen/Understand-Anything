# tests/understand-query/test_subcommands.py
import json
import sys
from pathlib import Path
from unittest.mock import patch

import pytest

SKILL_DIR = Path(__file__).resolve().parent.parent.parent / "understand-anything-plugin" / "skills" / "understand-query"
sys.path.insert(0, str(SKILL_DIR))
import ua_query  # noqa: E402

TOKEN = "test-tok"
SERVER = "http://localhost:3001"


@pytest.fixture
def mock_fetch():
    with patch.object(ua_query, "fetch_json") as m:
        yield m


class TestKgSubcommand:
    def test_kg_list_nodes(self, mock_fetch, capsys):
        mock_fetch.return_value = {"nodes": [{"id": "n1", "type": "class", "name": "OrderController"}]}
        ua_query.main(["--token", TOKEN, "--server", SERVER, "kg", "--service", "order-service", "--type", "node"])
        out = json.loads(capsys.readouterr().out)
        assert out["nodes"][0]["name"] == "OrderController"
        mock_fetch.assert_called_once()
        assert "/api/graph" in mock_fetch.call_args[0][0]


class TestBusinessSubcommand:
    def test_business_list(self, mock_fetch, capsys):
        mock_fetch.return_value = {"domains": [{"id": "domain:order", "name": "Order"}]}
        ua_query.main(["--token", TOKEN, "business", "--list"])
        out = json.loads(capsys.readouterr().out)
        assert len(out["domains"]) == 1

    def test_business_search(self, mock_fetch, capsys):
        mock_fetch.return_value = {"results": [{"id": "domain:order", "name": "Order", "match": "下单"}]}
        ua_query.main(["--token", TOKEN, "business", "--search", "下单"])
        assert "results" in json.loads(capsys.readouterr().out)
