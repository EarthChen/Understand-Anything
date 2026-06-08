# tests/understand-query/test_ua_query.py
import json
import sys
from pathlib import Path
from unittest.mock import patch, MagicMock
from urllib.error import URLError

import pytest

SKILL_DIR = Path(__file__).resolve().parent.parent.parent / "understand-anything-plugin" / "skills" / "understand-query"
sys.path.insert(0, str(SKILL_DIR))
import ua_query  # noqa: E402


class TestHttpClient:
    def test_fetch_json_success(self):
        mock_resp = MagicMock()
        mock_resp.read.return_value = b'{"ok": true}'
        mock_resp.__enter__ = lambda s: s
        mock_resp.__exit__ = MagicMock(return_value=False)
        with patch("urllib.request.urlopen", return_value=mock_resp):
            data = ua_query.fetch_json("http://localhost:3001/test?token=t", timeout=5)
        assert data == {"ok": True}

    def test_fetch_json_connection_refused(self):
        with patch("urllib.request.urlopen", side_effect=URLError("Connection refused")):
            with pytest.raises(ua_query.ServerUnavailableError) as exc:
                ua_query.fetch_json("http://localhost:3001/test", timeout=1)
        assert "server" in str(exc.value).lower() or "unavailable" in str(exc.value).lower()


class TestOutputFormatting:
    def test_format_json(self):
        out = ua_query.format_output({"a": 1}, "json")
        assert json.loads(out) == {"a": 1}

    def test_format_markdown(self):
        out = ua_query.format_output({"domains": [{"name": "Order", "summary": "test"}]}, "md")
        assert "Order" in out
        assert "#" in out or "##" in out


class TestArgParsing:
    def test_parses_global_flags(self):
        args = ua_query.parse_args(["--server", "http://x:9", "--token", "tok", "kg", "--service", "s"])
        assert args.server == "http://x:9"
        assert args.token == "tok"
        assert args.command == "kg"
