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
            data = ua_query.fetch_json("http://localhost:3001", "/test", {"token": "t"}, timeout=5)
        assert data == {"ok": True}

    def test_fetch_json_connection_refused(self):
        with patch("urllib.request.urlopen", side_effect=URLError("Connection refused")):
            with pytest.raises(ua_query.ServerUnavailableError) as exc:
                ua_query.fetch_json("http://localhost:3001", "/test", timeout=1)
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
                ua_query.fetch_json("http://localhost:3001", "/test", timeout=1)

    def test_fetch_json_posts_json_body(self):
        captured = {}

        class _Resp:
            def read(self): return b'{"ok": true}'
            def __enter__(self): return self
            def __exit__(self, *a): return False

        def fake_urlopen(req, timeout=None):
            captured["method"] = req.get_method()
            captured["url"] = req.full_url
            captured["ctype"] = req.headers.get("Content-type")
            captured["data"] = req.data
            return _Resp()

        with patch("urllib.request.urlopen", fake_urlopen):
            data = ua_query.fetch_json("http://s", "/api/source", {"file": "A.java"})
        assert data == {"ok": True}
        assert captured["method"] == "POST"
        assert captured["url"] == "http://s/api/source"
        assert captured["ctype"] == "application/json"
        assert json.loads(captured["data"]) == {"file": "A.java"}

    def test_fetch_json_empty_params_posts_empty_object(self):
        class _Resp:
            def read(self): return b'{}'
            def __enter__(self): return self
            def __exit__(self, *a): return False
        captured = {}
        def fake_urlopen(req, timeout=None):
            captured["data"] = req.data
            return _Resp()
        with patch("urllib.request.urlopen", fake_urlopen):
            ua_query.fetch_json("http://s", "/api/services")
        assert json.loads(captured["data"]) == {}


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


class TestMainErrorHandling:
    def test_server_unavailable_returns_exit_2(self, capsys):
        with patch("ua_query.cmd_kg", side_effect=ua_query.ServerUnavailableError("server down")):
            code = ua_query.main(["kg", "--service", "s", "--type", "node"])
        assert code == 2
        assert "server down" in capsys.readouterr().err

    def test_runtime_error_returns_exit_1(self, capsys):
        with patch("ua_query.cmd_kg", side_effect=RuntimeError("boom")):
            code = ua_query.main(["kg", "--service", "s", "--type", "node"])
        assert code == 1
        assert "boom" in capsys.readouterr().err


class TestUrlEncoding:
    """Bug 1: User-supplied path segments must be URL-encoded."""

    @patch("_helpers.fetch_json")
    def test_wiki_service_with_slash_is_encoded(self, mock_fetch):
        mock_fetch.return_value = {}
        ua_query.main(["wiki", "--service", "a/b", "--type", "domain"])
        path_arg = mock_fetch.call_args[0][1]
        # "a/b" must be encoded as "a%2Fb" in the path, not left as raw "a/b"
        assert "a%2Fb" in path_arg
        # The encoded path segment must NOT contain a raw slash in the service part
        assert "/service/a%2Fb" in path_arg

    @patch("_helpers.fetch_json")
    def test_wiki_domain_with_question_mark_is_encoded(self, mock_fetch):
        mock_fetch.return_value = {}
        ua_query.main(["wiki", "--service", "svc", "--domain", "what?"])
        path_arg = mock_fetch.call_args[0][1]
        assert "what%3F" in path_arg


class TestStructureSubcommand:
    """Tests for the 'structure' subcommand."""

    def test_structure_limit_defaults_to_none(self):
        # --limit defaults to None (not 50) so each structure subpath can apply the
        # server's per-endpoint default. The symbol-source endpoint caps limit at 20,
        # so sending the old 50 default produced HTTP 400.
        args = ua_query.parse_args(
            ["structure", "--service", "svc", "--symbol", "X", "--source"]
        )
        assert args.limit is None

    @patch("_helpers.fetch_json")
    def test_structure_symbol_source_omits_limit_when_unset(self, mock_fetch):
        mock_fetch.return_value = {"results": []}
        ua_query.main(
            ["structure", "--service", "my-svc", "--symbol", "X", "--source"]
        )
        path_arg = mock_fetch.call_args[0][1]
        params_arg = mock_fetch.call_args[0][2]
        assert path_arg == "/api/structure/symbol-source"
        assert "limit" not in params_arg

    @patch("_helpers.fetch_json")
    def test_structure_files(self, mock_fetch):
        mock_fetch.return_value = {"files": ["a.java", "b.java"], "total": 2}
        ua_query.main(["structure", "--service", "my-svc", "--files"])
        path_arg = mock_fetch.call_args[0][1]
        params_arg = mock_fetch.call_args[0][2]
        assert path_arg == "/api/structure/files"
        assert params_arg["service"] == "my-svc"

    @patch("_helpers.fetch_json")
    def test_structure_file(self, mock_fetch):
        mock_fetch.return_value = {"filePath": "src/A.java", "language": "java"}
        ua_query.main(["structure", "--service", "my-svc", "--file", "src/A.java"])
        path_arg = mock_fetch.call_args[0][1]
        params_arg = mock_fetch.call_args[0][2]
        assert path_arg == "/api/structure/file"
        assert params_arg["path"] == "src/A.java"

    @patch("_helpers.fetch_json")
    def test_structure_search_annotation(self, mock_fetch):
        mock_fetch.return_value = {"results": [], "total": 0}
        ua_query.main(["structure", "--service", "my-svc", "--annotation", "MoaProvider"])
        path_arg = mock_fetch.call_args[0][1]
        params_arg = mock_fetch.call_args[0][2]
        assert path_arg == "/api/structure/search"
        assert params_arg["annotation"] == "MoaProvider"

    @patch("_helpers.fetch_json")
    def test_structure_search_param_type(self, mock_fetch):
        mock_fetch.return_value = {"results": [], "total": 0}
        ua_query.main(["structure", "--service", "my-svc", "--param-type", "UserDTO"])
        params_arg = mock_fetch.call_args[0][2]
        assert params_arg["paramType"] == "UserDTO"

    @patch("_helpers.fetch_json")
    def test_structure_search_return_type(self, mock_fetch):
        mock_fetch.return_value = {"results": [], "total": 0}
        ua_query.main(["structure", "--service", "my-svc", "--return-type", "OrderResponse"])
        params_arg = mock_fetch.call_args[0][2]
        assert params_arg["returnType"] == "OrderResponse"

    @patch("_helpers.fetch_json")
    def test_structure_search_interface(self, mock_fetch):
        mock_fetch.return_value = {"results": [], "total": 0}
        ua_query.main(["structure", "--service", "my-svc", "--interface", "Serializable"])
        params_arg = mock_fetch.call_args[0][2]
        assert params_arg["interface"] == "Serializable"

    @patch("_helpers.fetch_json")
    def test_structure_search_with_path_filter(self, mock_fetch):
        mock_fetch.return_value = {"results": [], "total": 0}
        ua_query.main(["structure", "--service", "my-svc", "--annotation", "Service", "--path", "user/"])
        params_arg = mock_fetch.call_args[0][2]
        assert params_arg["pathPattern"] == "user/"

    def test_structure_search_requires_filter(self):
        with pytest.raises(SystemExit):
            ua_query.main(["structure", "--service", "my-svc"])

    @patch("_helpers.fetch_json")
    def test_structure_chain_up(self, mock_fetch):
        mock_fetch.return_value = {"chain": [{"name": "VipUser"}], "depth": 1}
        ua_query.main(["structure", "--service", "my-svc", "--chain", "VipUser", "--direction", "up"])
        path_arg = mock_fetch.call_args[0][1]
        params_arg = mock_fetch.call_args[0][2]
        assert path_arg == "/api/structure/chain"
        assert params_arg["class"] == "VipUser"
        assert params_arg["direction"] == "up"

    @patch("_helpers.fetch_json")
    def test_structure_chain_down(self, mock_fetch):
        mock_fetch.return_value = {"chain": [], "depth": 0}
        ua_query.main(["structure", "--service", "my-svc", "--chain", "BaseEntity", "--direction", "down"])
        params_arg = mock_fetch.call_args[0][2]
        assert params_arg["direction"] == "down"

    @patch("_helpers.fetch_json")
    def test_structure_implementors(self, mock_fetch):
        mock_fetch.return_value = {"implementors": [{"name": "UserDTO"}], "total": 1}
        ua_query.main(["structure", "--service", "my-svc", "--implementors", "Serializable"])
        path_arg = mock_fetch.call_args[0][1]
        params_arg = mock_fetch.call_args[0][2]
        assert path_arg == "/api/structure/implementors"
        assert params_arg["interface"] == "Serializable"


class TestSourceMultiFile:
    @patch("_helpers.fetch_json")
    def test_multi_file_aggregates(self, mock_fetch):
        mock_fetch.side_effect = [
            {"file": "A.java", "content": "AAA", "lineCount": 3},
            {"file": "B.java", "content": "BBB", "lineCount": 3}]
        out = ua_query.cmd_source(ua_query.parse_args(
            ["source", "--service", "svc", "--file", "A.java,B.java"]))
        assert [f["file"] for f in out["files"]] == ["A.java", "B.java"]
        assert out["files"][0]["content"] == "AAA"

    @patch("_helpers.fetch_json")
    def test_inline_range_sent_as_params(self, mock_fetch):
        mock_fetch.side_effect = [
            {"file": "A.java", "content": "x", "lineCount": 1},
            {"file": "B.java", "content": "y", "lineCount": 1}]
        ua_query.cmd_source(ua_query.parse_args(
            ["source", "--service", "svc", "--file", "A.java:10-20,B.java"]))
        server, path, params = mock_fetch.call_args_list[0][0][:3]
        assert path == "/api/source"
        assert params["start"] == "10" and params["end"] == "20"

    @patch("_helpers.fetch_json")
    def test_per_file_error_isolated(self, mock_fetch):
        mock_fetch.side_effect = [RuntimeError("HTTP 404: nope"),
                                  {"file": "B.java", "content": "ok", "lineCount": 1}]
        out = ua_query.cmd_source(ua_query.parse_args(
            ["source", "--service", "svc", "--file", "A.java,B.java"]))
        assert out["files"][0]["error"].startswith("HTTP 404")
        assert out["files"][1]["content"] == "ok"

    @patch("_helpers.fetch_json")
    def test_single_file_shape_unchanged(self, mock_fetch):
        mock_fetch.return_value = {"file": "A.java", "content": "x", "lineCount": 1}
        out = ua_query.cmd_source(ua_query.parse_args(
            ["source", "--service", "svc", "--file", "A.java"]))
        assert out == {"file": "A.java", "content": "x", "lineCount": 1}
