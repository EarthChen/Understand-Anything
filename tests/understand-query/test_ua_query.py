# tests/understand-query/test_ua_query.py
import json
import sys
from pathlib import Path
from unittest.mock import patch, MagicMock
from urllib.error import HTTPError, URLError

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

    def test_fetch_json_http_error_preserves_status_code(self):
        """Bug 2: HTTPError must be caught BEFORE URLError so the HTTP status is not lost."""
        mock_resp = MagicMock()
        mock_resp.read.return_value = b'{"error":"not found"}'
        http_err = HTTPError(
            url="http://localhost:3001/test",
            code=404,
            msg="Not Found",
            hdrs=None,
            fp=mock_resp,
        )
        with patch("urllib.request.urlopen", side_effect=http_err):
            with pytest.raises(RuntimeError, match=r"HTTP 404"):
                ua_query.fetch_json("http://localhost:3001/test", timeout=1)


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
        args = ua_query.parse_args(["--server", "http://x:9", "kg", "--service", "s"])
        assert args.server == "http://x:9"
        assert args.command == "kg"


class TestUrlEncoding:
    """Bug 1: User-supplied path segments must be URL-encoded."""

    @patch("_helpers.fetch_json")
    def test_wiki_service_with_slash_is_encoded(self, mock_fetch):
        mock_fetch.return_value = {}
        ua_query.main(["wiki", "--service", "a/b", "--type", "domain"])
        url = mock_fetch.call_args[0][0]
        # "a/b" must be encoded as "a%2Fb" in the path, not left as raw "a/b"
        assert "a%2Fb" in url
        # The encoded path segment must NOT contain a raw slash in the service part
        path_part = url.split("?")[0]
        assert "/service/a%2Fb" in path_part

    @patch("_helpers.fetch_json")
    def test_wiki_domain_with_question_mark_is_encoded(self, mock_fetch):
        mock_fetch.return_value = {}
        ua_query.main(["wiki", "--service", "svc", "--domain", "what?"])
        url = mock_fetch.call_args[0][0]
        assert "what%3F" in url


class TestStructureSubcommand:
    """Tests for the 'structure' subcommand."""

    @patch("_helpers.fetch_json")
    def test_structure_files(self, mock_fetch):
        mock_fetch.return_value = {"files": ["a.java", "b.java"], "total": 2}
        ua_query.main(["structure", "--service", "my-svc", "--files"])
        url = mock_fetch.call_args[0][0]
        assert "/api/structure/files" in url
        assert "service=my-svc" in url

    @patch("_helpers.fetch_json")
    def test_structure_file(self, mock_fetch):
        mock_fetch.return_value = {"filePath": "src/A.java", "language": "java"}
        ua_query.main(["structure", "--service", "my-svc", "--file", "src/A.java"])
        url = mock_fetch.call_args[0][0]
        assert "/api/structure/file" in url
        assert "path=src" in url

    @patch("_helpers.fetch_json")
    def test_structure_search_annotation(self, mock_fetch):
        mock_fetch.return_value = {"results": [], "total": 0}
        ua_query.main(["structure", "--service", "my-svc", "--annotation", "MoaProvider"])
        url = mock_fetch.call_args[0][0]
        assert "/api/structure/search" in url
        assert "annotation=MoaProvider" in url

    @patch("_helpers.fetch_json")
    def test_structure_search_param_type(self, mock_fetch):
        mock_fetch.return_value = {"results": [], "total": 0}
        ua_query.main(["structure", "--service", "my-svc", "--param-type", "UserDTO"])
        url = mock_fetch.call_args[0][0]
        assert "paramType=UserDTO" in url

    @patch("_helpers.fetch_json")
    def test_structure_search_return_type(self, mock_fetch):
        mock_fetch.return_value = {"results": [], "total": 0}
        ua_query.main(["structure", "--service", "my-svc", "--return-type", "OrderResponse"])
        url = mock_fetch.call_args[0][0]
        assert "returnType=OrderResponse" in url

    @patch("_helpers.fetch_json")
    def test_structure_search_interface(self, mock_fetch):
        mock_fetch.return_value = {"results": [], "total": 0}
        ua_query.main(["structure", "--service", "my-svc", "--interface", "Serializable"])
        url = mock_fetch.call_args[0][0]
        assert "interface=Serializable" in url

    @patch("_helpers.fetch_json")
    def test_structure_search_with_path_filter(self, mock_fetch):
        mock_fetch.return_value = {"results": [], "total": 0}
        ua_query.main(["structure", "--service", "my-svc", "--annotation", "Service", "--path", "user/"])
        url = mock_fetch.call_args[0][0]
        assert "pathPattern=user" in url

    def test_structure_search_requires_filter(self):
        with pytest.raises(SystemExit):
            ua_query.main(["structure", "--service", "my-svc"])

    @patch("_helpers.fetch_json")
    def test_structure_chain_up(self, mock_fetch):
        mock_fetch.return_value = {"chain": [{"name": "VipUser"}], "depth": 1}
        ua_query.main(["structure", "--service", "my-svc", "--chain", "VipUser", "--direction", "up"])
        url = mock_fetch.call_args[0][0]
        assert "/api/structure/chain" in url
        assert "class=VipUser" in url
        assert "direction=up" in url

    @patch("_helpers.fetch_json")
    def test_structure_chain_down(self, mock_fetch):
        mock_fetch.return_value = {"chain": [], "depth": 0}
        ua_query.main(["structure", "--service", "my-svc", "--chain", "BaseEntity", "--direction", "down"])
        url = mock_fetch.call_args[0][0]
        assert "direction=down" in url

    @patch("_helpers.fetch_json")
    def test_structure_implementors(self, mock_fetch):
        mock_fetch.return_value = {"implementors": [{"name": "UserDTO"}], "total": 1}
        ua_query.main(["structure", "--service", "my-svc", "--implementors", "Serializable"])
        url = mock_fetch.call_args[0][0]
        assert "/api/structure/implementors" in url
        assert "interface=Serializable" in url
