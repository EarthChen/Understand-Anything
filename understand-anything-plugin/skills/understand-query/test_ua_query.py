#!/usr/bin/env python3
"""Comprehensive tests for ua_query.py CLI (unittest-based, no external deps)."""
from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parent))

import ua_query
from ua_query import (
    build_url,
    format_output,
    parse_args,
    _search_api,
    _find_symbol_node,
    _extract_code_keywords,
    _extract_symbol,
    ServerUnavailableError,
)


# ──────────────────────────────────────────────
# build_url
# ──────────────────────────────────────────────

class TestBuildUrl(unittest.TestCase):
    def test_simple_path(self):
        assert build_url("http://localhost:3001", "/api/search") == "http://localhost:3001/api/search"

    def test_with_params(self):
        url = build_url("http://localhost:3001", "/api/search", {"q": "auth", "scope": "kg"})
        assert "/api/search?" in url
        assert "q=auth" in url
        assert "scope=kg" in url

    def test_strips_trailing_slash(self):
        assert build_url("http://localhost:3001/", "/api/search") == "http://localhost:3001/api/search"

    def test_empty_params(self):
        assert build_url("http://localhost:3001", "/api/search", {}) == "http://localhost:3001/api/search"

    def test_none_params(self):
        assert build_url("http://localhost:3001", "/api/search", None) == "http://localhost:3001/api/search"


# ──────────────────────────────────────────────
# format_output
# ──────────────────────────────────────────────

class TestFormatOutput(unittest.TestCase):
    def test_json_format(self):
        data = {"key": "value"}
        result = format_output(data, "json")
        parsed = json.loads(result)
        assert parsed == {"key": "value"}

    def test_json_unicode(self):
        data = {"name": "用户管理"}
        result = format_output(data, "json")
        assert "用户管理" in result

    def test_md_domains(self):
        data = {"domains": [{"name": "User Domain", "summary": "Handles users"}]}
        result = format_output(data, "md")
        assert "# Business Domains" in result
        assert "User Domain" in result

    def test_md_search_results(self):
        data = {"results": [{"name": "UserService", "summary": "User CRUD"}]}
        result = format_output(data, "md")
        assert "# Search Results" in result
        assert "UserService" in result

    def test_md_trace(self):
        data = {
            "service": "test-svc",
            "query": "auth",
            "matchedNodes": [{"name": "AuthController", "type": "endpoint", "relevance": 10}],
        }
        result = format_output(data, "md")
        assert "# Trace:" in result
        assert "AuthController" in result

    def test_md_ask_quick(self):
        data = {"question": "How does auth work?", "depth": "quick", "service": "auth-svc"}
        result = format_output(data, "md")
        assert "Ask:" in result
        assert "How does auth work?" in result

    @patch("_utils._format_business_features", return_value="# 业务功能全景\n")
    def test_md_business_features(self, mock_formatter):
        data = {
            "features": [{"name": "Auth", "clientLayer": {}, "serverLayer": {}}],
            "serverIndex": {"auth": {"service": "auth-svc", "features": ["Auth"], "refCount": 1}},
        }
        result = format_output(data, "md")
        mock_formatter.assert_called_once_with(data)
        assert "# 业务功能全景" in result

    def test_md_renders_structure_fallback(self):
        data = {
            "question": "test",
            "depth": "full",
            "matchedNodes": [],
            "structureFallback": {
                "hint": "Found 3 structure matches",
                "results": [{"name": "Foo", "file": "src/Foo.java", "startLine": 10, "endLine": 20, "type": "class"}],
            },
        }
        md = format_output(data, "md")
        assert "Structure Fallback" in md
        assert "Foo" in md
        assert "src/Foo.java:10-20" in md

    def test_md_renders_source_fallback(self):
        data = {
            "question": "test",
            "depth": "full",
            "matchedNodes": [],
            "sourceFallback": {
                "hint": "Found 2 source matches",
                "results": [{"file": "src/Foo.java", "startLine": 10, "endLine": 20, "snippet": "public void timeout() {...}", "score": 0.85}],
            },
        }
        md = format_output(data, "md")
        assert "Source Content Search" in md
        assert "timeout" in md
        assert "0.85" in md


# ──────────────────────────────────────────────
# parse_args
# ──────────────────────────────────────────────

class TestParseArgs(unittest.TestCase):
    def test_kg_search(self):
        args = parse_args(["kg", "--service", "svc", "--search", "auth"])
        assert args.command == "kg"
        assert args.service == "svc"
        assert args.search == "auth"

    def test_kg_search_with_type(self):
        args = parse_args(["kg", "--service", "svc", "--search", "auth", "--type", "class"])
        assert args.type == "class"

    def test_kg_search_with_tag(self):
        args = parse_args(["kg", "--service", "svc", "--search", "auth", "--tag", "service"])
        assert args.tag == "service"

    def test_kg_search_with_offset(self):
        args = parse_args(["kg", "--service", "svc", "--search", "auth", "--offset", "10"])
        assert args.offset == 10

    def test_wiki_search(self):
        args = parse_args(["wiki", "--service", "svc", "--search", "auth"])
        assert args.command == "wiki"
        assert args.search == "auth"

    def test_business_search(self):
        args = parse_args(["business", "--search", "order"])
        assert args.command == "business"
        assert args.search == "order"

    def test_business_features(self):
        args = parse_args(["business", "--features"])
        assert args.command == "business"
        assert args.features is True

    def test_trace_basic(self):
        args = parse_args(["trace", "--query", "auth,认证", "--service", "svc"])
        assert args.command == "trace"
        assert args.query == "auth,认证"
        assert args.fusion == "rrf"

    def test_trace_fusion_none(self):
        args = parse_args(["trace", "--query", "auth", "--service", "svc", "--fusion", "none"])
        assert args.fusion == "none"

    def test_trace_auto_discover(self):
        args = parse_args(["trace", "--query", "auth", "--auto-discover"])
        assert args.auto_discover is True
        assert args.service is None

    def test_structure_annotation(self):
        args = parse_args(["structure", "--service", "svc", "--annotation", "@Service"])
        assert args.command == "structure"
        assert args.annotation == "@Service"

    def test_structure_q(self):
        args = parse_args(["structure", "--service", "svc", "--q", "getUser"])
        assert args.q == "getUser"

    def test_structure_section_key(self):
        args = parse_args(["structure", "--service", "svc", "--section-key", "spring.datasource"])
        assert args.section_key == "spring.datasource"

    def test_structure_section_value(self):
        args = parse_args(["structure", "--service", "svc", "--section-value", "UserService"])
        assert args.section_value == "UserService"

    def test_structure_offset(self):
        args = parse_args(["structure", "--service", "svc", "--q", "test", "--offset", "20"])
        assert args.offset == 20

    def test_structure_symbol(self):
        args = parse_args(["structure", "--service", "svc", "--symbol", "createOrder"])
        assert args.symbol == "createOrder"

    def test_structure_chain(self):
        args = parse_args(["structure", "--service", "svc", "--chain", "BaseEntity", "--direction", "down"])
        assert args.chain == "BaseEntity"
        assert args.direction == "down"

    def test_structure_implementors(self):
        args = parse_args(["structure", "--service", "svc", "--implementors", "Serializable"])
        assert args.implementors == "Serializable"

    def test_structure_file(self):
        args = parse_args(["structure", "--service", "svc", "--file", "UserService.java"])
        assert args.file == "UserService.java"

    def test_structure_grep(self):
        args = parse_args(["structure", "--service", "svc", "--grep", "timeout"])
        assert args.grep == "timeout"

    def test_source_search(self):
        args = parse_args(["source", "--service", "svc", "--search", "timeout"])
        assert args.command == "source"
        assert args.service == "svc"
        assert args.search == "timeout"
        assert args.limit == 20

    def test_source_file(self):
        args = parse_args(["source", "--service", "svc", "--file", "src/Foo.java", "--start", "10", "--end", "20"])
        assert args.command == "source"
        assert args.file == "src/Foo.java"
        assert args.start == 10
        assert args.end == 20

    def test_impact(self):
        args = parse_args(["impact", "--service", "svc", "--symbol", "createOrder", "--depth", "5"])
        assert args.command == "impact"
        assert args.depth == 5

    def test_callers(self):
        args = parse_args(["callers", "--service", "svc", "--symbol", "getUser"])
        assert args.command == "callers"

    def test_callees(self):
        args = parse_args(["callees", "--service", "svc", "--symbol", "getUser"])
        assert args.command == "callees"

    def test_global_format(self):
        args = parse_args(["--format", "md", "kg", "--service", "svc", "--search", "auth"])
        assert args.format == "md"

    def test_global_server(self):
        args = parse_args(["--server", "http://custom:9999", "kg", "--service", "svc", "--search", "auth"])
        assert args.server == "http://custom:9999"

    def test_ask_platform_arg(self):
        args = parse_args(["ask", "--query", "语聊房", "--platform", "android"])
        assert args.command == "ask"
        assert args.platform == "android"


# ──────────────────────────────────────────────
# _search_api
# ──────────────────────────────────────────────

class TestSearchApi(unittest.TestCase):
    @patch("_helpers.fetch_json")
    def test_basic_call(self, mock_fetch):
        mock_fetch.return_value = {"results": [{"id": "1", "name": "Auth"}]}
        results = _search_api("http://localhost:3001", "auth")
        assert len(results) == 1
        assert results[0]["name"] == "Auth"
        call_url = mock_fetch.call_args[0][0]
        assert "q=auth" in call_url
        assert "scope=kg" in call_url

    @patch("_helpers.fetch_json")
    def test_with_service(self, mock_fetch):
        mock_fetch.return_value = {"results": []}
        _search_api("http://localhost:3001", "auth", service="svc")
        call_url = mock_fetch.call_args[0][0]
        assert "service=svc" in call_url

    @patch("_helpers.fetch_json")
    def test_with_type_filter(self, mock_fetch):
        mock_fetch.return_value = {"results": []}
        _search_api("http://localhost:3001", "auth", type="class")
        call_url = mock_fetch.call_args[0][0]
        assert "type=class" in call_url

    @patch("_helpers.fetch_json")
    def test_with_tag_filter(self, mock_fetch):
        mock_fetch.return_value = {"results": []}
        _search_api("http://localhost:3001", "auth", tag="service")
        call_url = mock_fetch.call_args[0][0]
        assert "tag=service" in call_url

    @patch("_helpers.fetch_json")
    def test_with_offset(self, mock_fetch):
        mock_fetch.return_value = {"results": []}
        _search_api("http://localhost:3001", "auth", offset=10)
        call_url = mock_fetch.call_args[0][0]
        assert "offset=10" in call_url

    @patch("_helpers.fetch_json")
    def test_offset_zero_not_sent(self, mock_fetch):
        mock_fetch.return_value = {"results": []}
        _search_api("http://localhost:3001", "auth", offset=0)
        call_url = mock_fetch.call_args[0][0]
        assert "offset" not in call_url

    @patch("_helpers.fetch_json")
    def test_with_fusion(self, mock_fetch):
        mock_fetch.return_value = {"results": []}
        _search_api("http://localhost:3001", "auth", fusion="rrf")
        call_url = mock_fetch.call_args[0][0]
        assert "fusion=rrf" in call_url

    @patch("_helpers.fetch_json")
    def test_fusion_none_not_sent(self, mock_fetch):
        mock_fetch.return_value = {"results": []}
        _search_api("http://localhost:3001", "auth", fusion="none")
        call_url = mock_fetch.call_args[0][0]
        assert "fusion" not in call_url

    @patch("_helpers.fetch_json")
    def test_type_none_not_sent(self, mock_fetch):
        mock_fetch.return_value = {"results": []}
        _search_api("http://localhost:3001", "auth", type=None)
        call_url = mock_fetch.call_args[0][0]
        assert "type" not in call_url

    @patch("_helpers.fetch_json")
    def test_tag_none_not_sent(self, mock_fetch):
        mock_fetch.return_value = {"results": []}
        _search_api("http://localhost:3001", "auth", tag=None)
        call_url = mock_fetch.call_args[0][0]
        assert "tag" not in call_url

    @patch("_helpers.fetch_json")
    def test_empty_results(self, mock_fetch):
        mock_fetch.return_value = {"results": []}
        results = _search_api("http://localhost:3001", "nonexistent")
        assert results == []

    @patch("_helpers.fetch_json")
    def test_missing_results_key(self, mock_fetch):
        mock_fetch.return_value = {"total": 0}
        results = _search_api("http://localhost:3001", "test")
        assert results == []


# ──────────────────────────────────────────────
# _find_symbol_node
# ──────────────────────────────────────────────

class TestFindSymbolNode(unittest.TestCase):
    @patch("_helpers._search_api")
    def test_exact_local_match(self, mock_search):
        mock_search.return_value = [
            {"name": "UserService", "type": "class", "id": "kg::UserService"},
            {"name": "UserServiceImpl", "type": "class", "id": "kg::UserServiceImpl"},
        ]
        result = _find_symbol_node("http://localhost:3001", "svc", "UserService")
        assert result["name"] == "UserService"

    @patch("_helpers._cross_service_symbol_search")
    @patch("_helpers._search_api")
    def test_fuzzy_local_then_cross_service_exact(self, mock_search, mock_cross):
        mock_search.return_value = [
            {"name": "UserHelper", "type": "class", "id": "kg::UserHelper"},
        ]
        mock_cross.return_value = {
            "node": {"name": "UserService", "type": "class", "id": "kg::UserService"},
            "service": "other-svc",
        }
        result = _find_symbol_node("http://localhost:3001", "svc", "UserService")
        assert result["name"] == "UserService"
        assert result.get("crossServiceOrigin") is not None

    @patch("_helpers._search_api")
    def test_no_match(self, mock_search):
        mock_search.return_value = []
        with self.assertRaises(RuntimeError):
            _find_symbol_node("http://localhost:3001", "svc", "NonExistent")

    @patch("_helpers._search_api")
    def test_prefers_implementation_suffix(self, mock_search):
        mock_search.return_value = [
            {"name": "UserService", "type": "class", "id": "kg::UserService"},
            {"name": "UserServiceImpl", "type": "class", "id": "kg::UserServiceImpl"},
        ]
        result = _find_symbol_node("http://localhost:3001", "svc", "User")
        assert result.get("name") is not None


# ──────────────────────────────────────────────
# _extract_code_keywords
# ──────────────────────────────────────────────

class TestExtractCodeKeywords(unittest.TestCase):
    def test_pascal_case(self):
        kws = _extract_code_keywords("Bind Closed Friend")
        assert "BindClosedFriend" in kws

    def test_kebab_case(self):
        kws = _extract_code_keywords("bind-closed-friend")
        assert "BindClosedFriend" in kws

    def test_filters_stop_words(self):
        kws = _extract_code_keywords("Create Order Flow")
        assert "CreateOrder" in kws

    def test_empty_input(self):
        kws = _extract_code_keywords("")
        assert kws == []

    def test_single_word(self):
        kws = _extract_code_keywords("Authentication")
        assert "Authentication" in kws

    def test_suffix_extraction(self):
        kws = _extract_code_keywords("Bind Closed Friend System")
        assert len(kws) >= 2


# ──────────────────────────────────────────────
# _extract_symbol
# ──────────────────────────────────────────────

class TestExtractSymbol(unittest.TestCase):
    def test_extracts_method(self):
        source = (
            "public class UserService {\n"
            "    public User getUser(Long id) {\n"
            "        return repository.findById(id);\n"
            "    }\n"
            "\n"
            "    public void deleteUser(Long id) {\n"
            "        repository.delete(id);\n"
            "    }\n"
            "}"
        )
        result = _extract_symbol(source, "getUser")
        assert result is not None
        assert "getUser" in result
        assert "repository.findById" in result

    def test_extracts_class(self):
        source = (
            "@Service\n"
            "public class UserService {\n"
            "    private final UserRepository repo;\n"
            "}"
        )
        result = _extract_symbol(source, "UserService")
        assert result is not None
        assert "UserService" in result

    def test_returns_none_for_missing(self):
        source = "public class Foo { }"
        result = _extract_symbol(source, "nonExistent")
        assert result is None

    def test_handles_nested_braces(self):
        source = (
            "public void process() {\n"
            "    if (true) {\n"
            "        for (int i = 0; i < 10; i++) {\n"
            "            System.out.println(i);\n"
            "        }\n"
            "    }\n"
            "}"
        )
        result = _extract_symbol(source, "process")
        assert result is not None
        assert "println" in result


# ──────────────────────────────────────────────
# cmd_* commands (mock fetch_json)
# ──────────────────────────────────────────────

class TestCmdKg(unittest.TestCase):
    @patch("_helpers.fetch_json")
    def test_search(self, mock_fetch):
        mock_fetch.return_value = {"results": [{"id": "1", "name": "UserService"}]}
        args = parse_args(["kg", "--service", "svc", "--search", "UserService"])
        from ua_query import cmd_kg
        result = cmd_kg(args)
        assert "nodes" in result
        assert len(result["nodes"]) == 1

    @patch("_helpers.fetch_json")
    def test_search_with_type_api_filter(self, mock_fetch):
        mock_fetch.return_value = {"results": [{"id": "1", "name": "UserService", "type": "class"}]}
        args = parse_args(["kg", "--service", "svc", "--search", "User", "--type", "class"])
        from ua_query import cmd_kg
        cmd_kg(args)
        call_url = mock_fetch.call_args[0][0]
        assert "type=class" in call_url

    @patch("_helpers.fetch_json")
    def test_search_with_tag_api_filter(self, mock_fetch):
        mock_fetch.return_value = {"results": []}
        args = parse_args(["kg", "--service", "svc", "--search", "User", "--tag", "auth"])
        from ua_query import cmd_kg
        cmd_kg(args)
        call_url = mock_fetch.call_args[0][0]
        assert "tag=auth" in call_url

    @patch("_helpers.fetch_json")
    def test_node_lookup(self, mock_fetch):
        mock_fetch.return_value = {
            "nodes": [{"name": "UserService", "type": "class", "id": "kg::UserService"}],
            "edges": [],
        }
        args = parse_args(["kg", "--service", "svc", "--node", "UserService"])
        from ua_query import cmd_kg
        result = cmd_kg(args)
        assert "nodes" in result

    @patch("_helpers.fetch_json")
    def test_neighbors(self, mock_fetch):
        mock_fetch.return_value = {"neighbors": [{"name": "Auth"}], "center": {"name": "User"}}
        args = parse_args(["kg", "--service", "svc", "--neighbors", "UserService"])
        from ua_query import cmd_kg
        result = cmd_kg(args)
        assert "neighbors" in result


class TestCmdStructure(unittest.TestCase):
    @patch("_helpers.fetch_json")
    def test_search_annotation(self, mock_fetch):
        mock_fetch.return_value = {"results": [{"name": "UserController", "annotations": "@Controller"}]}
        args = parse_args(["structure", "--service", "svc", "--annotation", "@Controller"])
        from ua_query import cmd_structure
        result = cmd_structure(args)
        assert "results" in result

    @patch("_helpers.fetch_json")
    def test_search_q(self, mock_fetch):
        mock_fetch.return_value = {"results": []}
        args = parse_args(["structure", "--service", "svc", "--q", "getUser"])
        from ua_query import cmd_structure
        cmd_structure(args)
        call_url = mock_fetch.call_args[0][0]
        assert "q=getUser" in call_url

    @patch("_helpers.fetch_json")
    def test_search_section_key(self, mock_fetch):
        mock_fetch.return_value = {"results": []}
        args = parse_args(["structure", "--service", "svc", "--section-key", "spring.datasource"])
        from ua_query import cmd_structure
        cmd_structure(args)
        call_url = mock_fetch.call_args[0][0]
        assert "sectionKey=spring.datasource" in call_url

    @patch("_helpers.fetch_json")
    def test_search_section_value(self, mock_fetch):
        mock_fetch.return_value = {"results": []}
        args = parse_args(["structure", "--service", "svc", "--section-value", "UserService"])
        from ua_query import cmd_structure
        cmd_structure(args)
        call_url = mock_fetch.call_args[0][0]
        assert "sectionValue=UserService" in call_url

    @patch("_helpers.fetch_json")
    def test_search_offset(self, mock_fetch):
        mock_fetch.return_value = {"results": []}
        args = parse_args(["structure", "--service", "svc", "--q", "test", "--offset", "20"])
        from ua_query import cmd_structure
        cmd_structure(args)
        call_url = mock_fetch.call_args[0][0]
        assert "offset=20" in call_url

    @patch("_helpers.fetch_json")
    def test_search_no_filter_raises(self, mock_fetch):
        args = parse_args(["structure", "--service", "svc"])
        from ua_query import cmd_structure
        with self.assertRaises(SystemExit):
            cmd_structure(args)

    @patch("_helpers.fetch_json")
    def test_file_lookup(self, mock_fetch):
        mock_fetch.return_value = {"filePath": "src/UserService.java", "functions": []}
        args = parse_args(["structure", "--service", "svc", "--file", "UserService.java"])
        from ua_query import cmd_structure
        result = cmd_structure(args)
        assert "functions" in result or "filePath" in result

    @patch("_helpers.fetch_json")
    def test_chain(self, mock_fetch):
        mock_fetch.return_value = {"className": "UserEntity", "direction": "up", "chain": []}
        args = parse_args(["structure", "--service", "svc", "--chain", "UserEntity"])
        from ua_query import cmd_structure
        result = cmd_structure(args)
        assert "chain" in result

    @patch("_helpers.fetch_json")
    def test_implementors(self, mock_fetch):
        mock_fetch.return_value = {"interface": "Serializable", "implementors": []}
        args = parse_args(["structure", "--service", "svc", "--implementors", "Serializable"])
        from ua_query import cmd_structure
        result = cmd_structure(args)
        assert "implementors" in result

    @patch("_helpers.fetch_json")
    def test_grep(self, mock_fetch):
        mock_fetch.return_value = {"query": "timeout", "results": [], "totalResults": 0}
        args = parse_args(["structure", "--service", "svc", "--grep", "timeout", "--path", "*.yml", "--limit", "10"])
        from ua_query import cmd_structure
        cmd_structure(args)
        call_url = mock_fetch.call_args[0][0]
        assert "/api/source/search" in call_url
        assert "q=timeout" in call_url
        assert "service=svc" in call_url
        assert "path=" in call_url
        assert "limit=10" in call_url

    @patch("_helpers.fetch_json")
    def test_grep_deprecation_hint(self, mock_fetch):
        mock_fetch.return_value = {"query": "timeout", "results": [], "totalResults": 0}
        import io
        args = parse_args(["structure", "--service", "svc", "--grep", "timeout"])
        from ua_query import cmd_structure
        stderr_buf = io.StringIO()
        with patch("sys.stderr", stderr_buf):
            cmd_structure(args)
        assert "[DEPRECATED]" in stderr_buf.getvalue()
        assert "source --service" in stderr_buf.getvalue()


class TestCmdSource(unittest.TestCase):
    @patch("_helpers.fetch_json")
    def test_source_search(self, mock_fetch):
        """source --search calls /api/source/search"""
        mock_fetch.return_value = {
            "query": "timeout",
            "results": [{"file": "src/Foo.java", "line": 42, "content": "timeout"}],
            "totalResults": 1,
        }
        args = parse_args(["source", "--service", "svc", "--search", "timeout"])
        from ua_query import cmd_source
        result = cmd_source(args)
        call_url = mock_fetch.call_args[0][0]
        assert "/api/source/search" in call_url
        assert "q=timeout" in call_url
        assert "service=svc" in call_url
        assert result["results"][0]["file"] == "src/Foo.java"

    @patch("_helpers.fetch_json")
    def test_source_search_with_path(self, mock_fetch):
        mock_fetch.return_value = {"query": "timeout", "results": [], "totalResults": 0}
        args = parse_args(["source", "--service", "svc", "--search", "timeout", "--path", "*.yml", "--limit", "50"])
        from ua_query import cmd_source
        cmd_source(args)
        call_url = mock_fetch.call_args[0][0]
        assert "path=" in call_url
        assert "limit=50" in call_url

    @patch("_helpers.fetch_json")
    def test_source_file(self, mock_fetch):
        """source --file calls /api/source"""
        mock_fetch.return_value = {"file": "src/Foo.java", "content": "class Foo {}"}
        args = parse_args(["source", "--service", "svc", "--file", "src/Foo.java", "--start", "10", "--end", "20"])
        from ua_query import cmd_source
        result = cmd_source(args)
        call_url = mock_fetch.call_args[0][0]
        assert "/api/source" in call_url
        assert "file=src" in call_url or "Foo.java" in call_url
        assert "start=10" in call_url
        assert "end=20" in call_url
        assert "content" in result

    def test_source_requires_service(self):
        """source without --service fails"""
        with self.assertRaises(SystemExit):
            parse_args(["source", "--search", "test"])

    def test_source_requires_search_or_file(self):
        args = parse_args(["source", "--service", "svc"])
        from ua_query import cmd_source
        with self.assertRaises(SystemExit):
            cmd_source(args)


class TestCmdWiki(unittest.TestCase):
    @patch("_helpers.fetch_json")
    def test_search(self, mock_fetch):
        mock_fetch.return_value = {"results": [{"id": "wiki::auth", "name": "Authentication"}]}
        args = parse_args(["wiki", "--service", "svc", "--search", "auth"])
        from ua_query import cmd_wiki
        result = cmd_wiki(args)
        assert isinstance(result, list)
        assert len(result) == 1

    @patch("_helpers.fetch_json")
    def test_overview(self, mock_fetch):
        mock_fetch.return_value = {"services": []}
        args = parse_args(["wiki", "--overview"])
        from ua_query import cmd_wiki
        result = cmd_wiki(args)
        assert "services" in result


class TestCmdBusiness(unittest.TestCase):
    @patch("_helpers.fetch_json")
    def test_search_calls_business_search_api(self, mock_fetch):
        mock_fetch.return_value = {
            "query": "PK",
            "results": [{"featureName": "语聊房", "matchType": "flow"}],
            "totalResults": 1,
        }
        args = parse_args(["business", "--search", "PK"])
        from ua_query import cmd_business
        result = cmd_business(args)
        call_url = mock_fetch.call_args[0][0]
        assert "/api/business/search" in call_url
        assert "q=PK" in call_url
        assert result["totalResults"] == 1

    @patch("_helpers.fetch_json")
    def test_search_with_platform_sends_both_parameters(self, mock_fetch):
        mock_fetch.return_value = {
            "query": "PK",
            "platform": "android",
            "results": [],
            "totalResults": 0,
        }
        args = parse_args(["business", "--search", "PK", "--platform", "android"])
        from ua_query import cmd_business
        cmd_business(args)
        call_url = mock_fetch.call_args[0][0]
        assert "/api/business/search" in call_url
        assert "q=PK" in call_url
        assert "platform=android" in call_url

    @patch("_helpers.fetch_json")
    def test_search(self, mock_fetch):
        mock_fetch.return_value = {
            "query": "order",
            "results": [{"featureName": "Order Domain", "matchType": "feature"}],
            "totalResults": 1,
        }
        args = parse_args(["business", "--search", "order"])
        from ua_query import cmd_business
        result = cmd_business(args)
        call_url = mock_fetch.call_args[0][0]
        assert "/api/business/search" in call_url
        assert "q=order" in call_url
        assert result["totalResults"] == 1

    @patch("_helpers.fetch_json")
    def test_list(self, mock_fetch):
        mock_fetch.return_value = {"domains": []}
        args = parse_args(["business", "--list"])
        from ua_query import cmd_business
        result = cmd_business(args)
        assert "domains" in result

    @patch("_helpers.fetch_json")
    def test_panorama(self, mock_fetch):
        mock_fetch.return_value = {"domains": []}
        args = parse_args(["business", "--panorama"])
        from ua_query import cmd_business
        result = cmd_business(args)
        assert "domains" in result

    @patch("_helpers.fetch_json")
    def test_features(self, mock_fetch):
        mock_fetch.return_value = {
            "features": [{"name": "Auth", "clientLayer": {}, "serverLayer": {}}],
            "serverIndex": {"auth": {"service": "auth-svc", "features": ["Auth"], "refCount": 1}},
            "stats": {"totalFeatures": 1, "withServerAssociation": 1, "serverDomainsReferenced": 1},
        }
        args = parse_args(["business", "--features"])
        from ua_query import cmd_business
        result = cmd_business(args)
        call_url = mock_fetch.call_args[0][0]
        assert "/api/business/features" in call_url
        assert "features" in result
        assert "serverIndex" in result

    @patch("_helpers.fetch_json")
    def test_platform_drilldown(self, mock_fetch):
        mock_fetch.return_value = {
            "feature": {"id": "feature:voice-room", "name": "语聊房"},
            "platform": "android",
            "repoName": "ddoversea",
            "platformDetail": {"name": "语音房", "summary": "Android voice room"},
        }
        args = parse_args(["business", "--domain", "语聊房", "--platform", "android"])
        from ua_query import cmd_business
        result = cmd_business(args)
        call_url = mock_fetch.call_args[0][0]
        assert "/api/business/domains/" in call_url
        assert "platform=android" in call_url
        assert result["platform"] == "android"
        assert result["repoName"] == "ddoversea"
        assert result["platformDetail"]["name"] == "语音房"

    def test_parse_args_business_flow_filter(self):
        args = parse_args(["business", "--domain", "语聊房", "--platform", "android", "--flow", "PK"])
        assert args.command == "business"
        assert args.domain == "语聊房"
        assert args.platform == "android"
        assert args.flow == "PK"

    @patch("_helpers.fetch_json")
    def test_platform_flow_filter(self, mock_fetch):
        mock_fetch.return_value = {
            "feature": {"id": "feature:voice-room", "name": "语聊房"},
            "platform": "android",
            "repoName": "ddoversea",
            "platformDetail": {
                "flows": [{"name": "PK Battle"}],
                "filteredBy": "keyword",
                "totalFlows": 5,
            },
        }
        args = parse_args(["business", "--domain", "语聊房", "--platform", "android", "--flow", "PK"])
        from ua_query import cmd_business
        result = cmd_business(args)
        call_url = mock_fetch.call_args[0][0]
        assert "platform=android" in call_url
        assert "flow=PK" in call_url
        assert result["platformDetail"]["flows"] == [{"name": "PK Battle"}]


class TestCmdDomain(unittest.TestCase):
    @patch("_helpers.fetch_json")
    def test_domain_search_uses_api(self, mock_fetch):
        """domain --search should call /api/search with scope=domain."""
        mock_fetch.return_value = {"results": [{"id": "flow:pk", "name": "PK Battle", "type": "flow"}]}
        args = parse_args(["domain", "--service", "svc", "--search", "PK"])
        from ua_query import cmd_domain
        result = cmd_domain(args)
        call_url = mock_fetch.call_args[0][0]
        assert "/api/search" in call_url
        assert "scope=domain" in call_url
        assert "q=PK" in call_url
        assert "service=svc" in call_url
        assert len(result["nodes"]) == 1
        assert result["nodes"][0]["name"] == "PK Battle"


class TestCmdAsk(unittest.TestCase):
    @patch("_commands._detect_and_follow_cross_service_rpc", return_value=None)
    @patch("_commands.cmd_trace")
    @patch("_helpers.fetch_json")
    @patch("_helpers._search_api")
    def test_ask_structure_fallback(self, mock_search_api, mock_fetch, mock_trace, mock_cross):
        """When ask finds no KG matches, should fallback to structure search."""
        mock_search_api.return_value = []
        mock_trace.return_value = {"matchedNodes": []}
        mock_fetch.return_value = {
            "results": [{"name": "PkBattleService", "type": "class"}],
        }
        args = parse_args(["ask", "--service", "svc", "--query", "PK对战", "--depth", "full"])
        from ua_query import cmd_ask
        result = cmd_ask(args)
        assert result["matchedNodes"] == []
        assert "structureFallback" in result
        assert result["structureFallback"]["keywords"] == ["PK"]
        assert len(result["structureFallback"]["results"]) == 1
        structure_calls = [
            c for c in mock_fetch.call_args_list
            if "/api/structure/search" in c[0][0]
        ]
        assert len(structure_calls) == 1
        assert "q=PK" in structure_calls[0][0][0]

    @patch("_commands._detect_and_follow_cross_service_rpc", return_value=None)
    @patch("_commands.cmd_trace")
    @patch("_helpers.fetch_json")
    @patch("_helpers._search_api")
    def test_ask_source_fallback(self, mock_search_api, mock_fetch, mock_trace, mock_cross):
        """When ask finds no KG or structure matches, should fallback to source grep."""
        mock_search_api.return_value = []
        mock_trace.return_value = {"matchedNodes": []}

        def fetch_side_effect(url, *args, **kwargs):
            if "/api/structure/search" in url:
                return {"results": []}
            if "/api/source/search" in url:
                return {
                    "results": [
                        {"file": "RoomManager.kt", "line": 42, "content": "// 房间管理"},
                    ],
                }
            return {}

        mock_fetch.side_effect = fetch_side_effect
        args = parse_args(["ask", "--service", "svc", "--query", "RoomManager", "--depth", "full"])
        from ua_query import cmd_ask
        result = cmd_ask(args)
        assert result["matchedNodes"] == []
        assert "structureFallback" not in result
        assert "sourceFallback" in result
        assert len(result["sourceFallback"]["results"]) == 1
        source_calls = [
            c for c in mock_fetch.call_args_list
            if "/api/source/search" in c[0][0]
        ]
        assert len(source_calls) == 1
        assert "q=RoomManager" in source_calls[0][0][0]

    @patch("_commands._detect_and_follow_cross_service_rpc", return_value=None)
    @patch("_commands.cmd_trace")
    @patch("_helpers.fetch_json")
    @patch("_helpers._search_api")
    def test_ask_chinese_source_fallback(self, mock_search_api, mock_fetch, mock_trace, mock_cross):
        """Chinese-only queries should use original query for source grep fallback."""
        mock_search_api.return_value = []
        mock_trace.return_value = {"matchedNodes": []}

        def fetch_side_effect(url, *args, **kwargs):
            if "/api/structure/search" in url:
                return {"results": []}
            if "/api/source/search" in url:
                return {
                    "results": [
                        {"file": "RoomFragment.java", "line": 10, "content": "房间管理"},
                    ],
                }
            return {}

        mock_fetch.side_effect = fetch_side_effect
        args = parse_args(["ask", "--service", "svc", "--query", "房间管理", "--depth", "full"])
        from ua_query import cmd_ask
        result = cmd_ask(args)
        assert "sourceFallback" in result
        source_calls = [
            c for c in mock_fetch.call_args_list
            if "/api/source/search" in c[0][0]
        ]
        assert len(source_calls) == 1
        assert "q=" in source_calls[0][0][0]
        assert "%E6%88%BF%E9%97%B4" in source_calls[0][0][0] or "房间管理" in source_calls[0][0][0]

    @patch("_commands._detect_and_follow_cross_service_rpc", return_value=None)
    @patch("_commands.cmd_trace")
    @patch("_helpers.fetch_json")
    @patch("_helpers._search_api")
    def test_ask_propagates_trace_hint(self, mock_search_api, mock_fetch, mock_trace, mock_cross):
        """ask propagates hint from trace result"""
        mock_search_api.return_value = []
        mock_trace.return_value = {
            "matchedNodes": [],
            "hint": "No KG nodes matched in service",
            "crossServiceTrace": {"targetService": "other-svc", "traceResult": {}},
            "crossServiceRpcHint": {"message": "RPC detected", "rpcInterfaces": []},
        }
        args = parse_args(["ask", "--service", "svc", "--query", "auth", "--depth", "standard"])
        from ua_query import cmd_ask
        result = cmd_ask(args)
        assert result["traceHint"] == "No KG nodes matched in service"
        assert result["crossServiceTrace"] == mock_trace.return_value["crossServiceTrace"]
        assert result["crossServiceRpcHint"] == mock_trace.return_value["crossServiceRpcHint"]

    @patch("_commands._detect_and_follow_cross_service_rpc", return_value=None)
    @patch("_commands.cmd_trace")
    @patch("_helpers.fetch_json")
    @patch("_helpers._search_api")
    def test_ask_source_fallback_full_query(self, mock_search_api, mock_fetch, mock_trace, mock_cross):
        """ask sourceFallback uses full query including Chinese"""
        mock_search_api.return_value = []
        mock_trace.return_value = {"matchedNodes": []}

        def fetch_side_effect(url, *args, **kwargs):
            if "/api/structure/search" in url:
                return {"results": []}
            if "/api/source/search" in url:
                return {
                    "results": [
                        {"file": "PkService.java", "line": 10, "content": "PK超时处理"},
                    ],
                }
            return {}

        mock_fetch.side_effect = fetch_side_effect
        args = parse_args(["ask", "--service", "svc", "--query", "PK超时", "--depth", "full"])
        from ua_query import cmd_ask
        result = cmd_ask(args)
        assert "sourceFallback" in result
        source_calls = [
            c for c in mock_fetch.call_args_list
            if "/api/source/search" in c[0][0]
        ]
        assert len(source_calls) == 1
        call_url = source_calls[0][0][0]
        assert "PK" in call_url
        assert "%E8%B6%85%E6%97%B6" in call_url or "超时" in call_url

    @patch("_commands._detect_and_follow_cross_service_rpc", return_value=None)
    @patch("_commands.cmd_trace")
    @patch("_helpers.fetch_json")
    @patch("_helpers._search_api")
    def test_ask_source_fallback_handles_fetch_error(self, mock_search_api, mock_fetch, mock_trace, mock_cross):
        """ask sourceFallback survives fetch_json errors"""
        mock_search_api.return_value = []
        mock_trace.return_value = {"matchedNodes": []}

        def fetch_side_effect(url, *args, **kwargs):
            if "/api/structure/search" in url:
                return {"results": []}
            if "/api/source/search" in url:
                raise RuntimeError("source search failed")
            return {}

        mock_fetch.side_effect = fetch_side_effect
        args = parse_args(["ask", "--service", "svc", "--query", "RoomManager", "--depth", "full"])
        from ua_query import cmd_ask
        result = cmd_ask(args)
        assert "sourceFallback" not in result


class TestCmdTrace(unittest.TestCase):
    @patch("_helpers._auto_discover_service")
    @patch("_helpers.fetch_json")
    def test_basic_trace(self, mock_fetch, mock_auto):
        mock_auto.return_value = ("svc", [])
        mock_fetch.return_value = {
            "matchedNodes": [{"name": "AuthController", "type": "endpoint", "id": "kg::Auth", "summary": "Auth endpoints"}],
            "service": "svc",
            "query": "auth",
        }
        args = parse_args(["trace", "--query", "auth", "--service", "svc"])
        from ua_query import cmd_trace
        result = cmd_trace(args)
        assert "matchedNodes" in result

    @patch("_helpers._auto_discover_service")
    @patch("_helpers.fetch_json")
    def test_trace_with_type_filter(self, mock_fetch, mock_auto):
        mock_auto.return_value = ("svc", [])
        mock_fetch.return_value = {
            "matchedNodes": [{"name": "Auth", "type": "class", "id": "kg::Auth", "summary": ""}],
            "service": "svc",
            "query": "auth",
        }
        args = parse_args(["trace", "--query", "auth", "--service", "svc", "--type", "class"])
        from ua_query import cmd_trace
        result = cmd_trace(args)
        assert "matchedNodes" in result


# ──────────────────────────────────────────────
# Error handling
# ──────────────────────────────────────────────

class TestErrorHandling(unittest.TestCase):
    @patch("_helpers.fetch_json")
    def test_server_unavailable(self, mock_fetch):
        mock_fetch.side_effect = ServerUnavailableError("Server down")
        args = parse_args(["kg", "--service", "svc", "--search", "auth"])
        from ua_query import cmd_kg
        with self.assertRaises(ServerUnavailableError):
            cmd_kg(args)

    @patch("_helpers.fetch_json")
    def test_http_error(self, mock_fetch):
        mock_fetch.side_effect = RuntimeError("HTTP 404: not found")
        args = parse_args(["kg", "--service", "svc", "--search", "auth"])
        from ua_query import cmd_kg
        with self.assertRaises(RuntimeError):
            cmd_kg(args)


# ──────────────────────────────────────────────
# main entry point
# ──────────────────────────────────────────────

class TestMain(unittest.TestCase):
    def _run_main(self, argv):
        import io
        buf = io.StringIO()
        with patch("sys.stdout", buf):
            from ua_query import main
            exit_code = main(argv)
        return exit_code, buf.getvalue()

    @patch("_helpers.fetch_json")
    def test_main_kg_search(self, mock_fetch):
        mock_fetch.return_value = {"results": [{"id": "1", "name": "Auth"}]}
        exit_code, output = self._run_main(["kg", "--service", "svc", "--search", "auth"])
        assert exit_code == 0
        assert "Auth" in output

    @patch("_helpers.fetch_json")
    def test_main_server_error(self, mock_fetch):
        mock_fetch.side_effect = ServerUnavailableError("Server down")
        exit_code, _ = self._run_main(["kg", "--service", "svc", "--search", "auth"])
        assert exit_code == 2

    @patch("_helpers.fetch_json")
    def test_main_runtime_error(self, mock_fetch):
        mock_fetch.side_effect = RuntimeError("HTTP 400: bad request")
        exit_code, _ = self._run_main(["kg", "--service", "svc", "--search", "auth"])
        assert exit_code == 1

    @patch("_helpers.fetch_json")
    def test_main_json_output(self, mock_fetch):
        mock_fetch.return_value = {"results": [{"id": "1", "name": "Test"}]}
        _, output = self._run_main(["--format", "json", "kg", "--service", "svc", "--search", "test"])
        parsed = json.loads(output)
        assert parsed["nodes"][0]["name"] == "Test"

    @patch("_helpers.fetch_json")
    def test_main_json_structure(self, mock_fetch):
        mock_fetch.return_value = {"results": [{"name": "getUser", "type": "function"}]}
        _, output = self._run_main(["--format", "json", "structure", "--service", "svc", "--q", "getUser"])
        parsed = json.loads(output)
        assert "results" in parsed

if __name__ == "__main__":
    unittest.main()
