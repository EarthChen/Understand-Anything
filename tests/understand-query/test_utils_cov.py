# tests/understand-query/test_utils_cov.py
"""Exhaustive line-coverage tests for understand-query/_utils.py.

Each test crafts a dict whose keys match one specific branch of the
_format_markdown / _format_business_features rendering chain (or exercises
fetch_json / build_url / helper functions) and asserts a rendered field
appears in the output, so these are behavioural assertions, not mere line hits.
"""
import sys
from pathlib import Path
from unittest.mock import patch, MagicMock
from urllib.error import HTTPError, URLError

import pytest

SKILL_DIR = Path(__file__).resolve().parent.parent.parent / "understand-anything-plugin" / "skills" / "understand-query"
sys.path.insert(0, str(SKILL_DIR))
import _utils  # noqa: E402


def md(data):
    return _utils.format_output(data, "md")


# --------------------------------------------------------------------------
# fetch_json
# --------------------------------------------------------------------------
class TestFetchJson:
    def _resp(self, body: bytes):
        mock_resp = MagicMock()
        mock_resp.read.return_value = body
        mock_resp.__enter__ = lambda s: s
        mock_resp.__exit__ = MagicMock(return_value=False)
        return mock_resp

    def test_success(self):
        with patch("urllib.request.urlopen", return_value=self._resp(b'{"ok": true}')):
            assert _utils.fetch_json("http://localhost", "/x", {"token": "t"}, timeout=5) == {"ok": True}

    def test_http_error_json_body_no_suggestions(self):
        fp = MagicMock()
        fp.read.return_value = b'{"error":"not found"}'
        err = HTTPError("http://h/x", 404, "Not Found", None, fp)
        with patch("urllib.request.urlopen", side_effect=err):
            with pytest.raises(RuntimeError, match=r"HTTP 404: not found"):
                _utils.fetch_json("http://h", "/x", {"q": "1"})

    def test_http_error_with_suggestions(self):
        body = (
            b'{"error":"unknown symbol","suggestions":['
            b'{"name":"UserService","type":"class"},'
            b'{"id":"id-2","type":"method"},'
            b'{}]}'
        )
        fp = MagicMock()
        fp.read.return_value = body
        err = HTTPError("http://h/x", 422, "Unprocessable", None, fp)
        with patch("urllib.request.urlopen", side_effect=err):
            with pytest.raises(RuntimeError) as exc:
                _utils.fetch_json("http://h", "/x")
        msg = str(exc.value)
        assert "Did you mean:" in msg
        assert "UserService (class)" in msg  # name path
        assert "id-2 (method)" in msg        # id fallback path
        assert "? (?)" in msg                # name/id/type all missing path

    def test_http_error_non_json_body(self):
        fp = MagicMock()
        fp.read.return_value = b"<html>boom</html>"
        err = HTTPError("http://h/x", 500, "Err", None, fp)
        with patch("urllib.request.urlopen", side_effect=err):
            with pytest.raises(RuntimeError, match=r"HTTP 500: <html>boom</html>"):
                _utils.fetch_json("http://h", "/x")

    def test_timeout_error(self):
        with patch("urllib.request.urlopen", side_effect=TimeoutError("timed out")):
            with pytest.raises(RuntimeError, match=r"Request timed out \(3s\)"):
                _utils.fetch_json("http://h", "/x", {"a": "1"}, timeout=3)

    def test_oserror_timed_out_message(self):
        # An OSError (not TimeoutError) whose message contains "timed out".
        with patch("urllib.request.urlopen", side_effect=OSError("the operation timed out")):
            with pytest.raises(RuntimeError, match=r"Request timed out"):
                _utils.fetch_json("http://h", "/x", timeout=2)

    def test_oserror_unavailable(self):
        with patch("urllib.request.urlopen", side_effect=OSError("connection reset")):
            with pytest.raises(_utils.ServerUnavailableError, match=r"unavailable"):
                _utils.fetch_json("http://h", "/x", {"q": "1"})

    def test_urlerror_unavailable(self):
        with patch("urllib.request.urlopen", side_effect=URLError("refused")):
            with pytest.raises(_utils.ServerUnavailableError, match=r"unavailable"):
                _utils.fetch_json("http://h", "/x")


# --------------------------------------------------------------------------
# build_url
# --------------------------------------------------------------------------
class TestBuildUrl:
    def test_with_params(self):
        url = _utils.build_url("http://srv/", "/api/x", {"service": "s", "q": "a b"})
        assert url.startswith("http://srv/api/x?")
        assert "service=s" in url and "q=a+b" in url

    def test_without_params(self):
        assert _utils.build_url("http://srv/", "/api/x") == "http://srv/api/x"

    def test_without_params_none(self):
        assert _utils.build_url("http://srv", "/api/x", None) == "http://srv/api/x"


# --------------------------------------------------------------------------
# helpers
# --------------------------------------------------------------------------
class TestHelpers:
    def test_lang_known(self):
        assert _utils._lang_for_ext("gradle") == "groovy"
        assert _utils._lang_for_ext("kt") == "kotlin"

    def test_lang_unknown_fallback(self):
        assert _utils._lang_for_ext("weird") == "weird"

    def test_short_type_name(self):
        assert _utils._short_type_name("com.example.Foo") == "Foo"
        assert _utils._short_type_name("Bar") == "Bar"

    def test_format_output_json(self):
        out = _utils.format_output({"a": 1}, "json")
        assert '"a": 1' in out


# --------------------------------------------------------------------------
# _format_markdown — top-of-chain branches
# --------------------------------------------------------------------------
class TestSimpleBranches:
    def test_business_domains(self):
        out = md({"domains": [{"name": "Order", "summary": "order stuff"},
                              {"id": "d2"}]})
        assert "# Business Domains" in out
        assert "## Order" in out
        assert "order stuff" in out
        assert "## d2" in out  # id fallback

    def test_search_results(self):
        out = md({"results": [{"name": "n1", "match": "m1"},
                              {"id": "i2", "summary": "s2"}]})
        assert "# Search Results" in out
        assert "**n1**: m1" in out
        assert "**i2**: s2" in out


class TestAskQuick:
    def test_full(self):
        out = md({
            "question": "how?",
            "depth": "quick",
            "service": "svc",
            "autoDiscovered": True,
            "error": "boom",
            "businessContext": [{"name": "BC", "summary": "ctx"}],
        })
        assert "# Ask: how?" in out
        assert "Depth: quick | Service: svc" in out
        assert "Auto-discovered service: **svc**" in out
        assert "**Error:** boom" in out
        assert "## Business Context" in out
        assert "**BC**: ctx" in out

    def test_business_search_when_no_context(self):
        out = md({
            "question": "q?",
            "depth": "quick",
            "businessSearch": [{"id": "b1", "match": "matched"}],
        })
        assert "## Business Search" in out
        assert "**b1**: matched" in out
        assert "Service: auto" in out  # default service


# --------------------------------------------------------------------------
# Trace result rendering (the matchedNodes branch)
# --------------------------------------------------------------------------
class TestTrace:
    def test_matched_nodes_with_all_fields(self):
        out = md({
            "matchedNodes": [
                {
                    "name": "Foo", "type": "class", "relevance": 9,
                    "filePath": "a/B.java", "lineRange": "1-5",
                    "blastRadius": {"total": 7}, "summary": "does foo",
                },
            ],
            "service": "svc", "query": "find foo", "autoDiscovered": True,
        })
        assert "# Trace: find foo (service: svc)" in out
        assert "Auto-discovered service: **svc**" in out
        assert "## Matched Nodes (1)" in out
        assert "blast=7" in out
        assert "`a/B.java:1-5`" in out
        assert "does foo" in out

    def test_matched_nodes_minimal_no_filepath_no_blast(self):
        out = md({"matchedNodes": [{"name": "Bare"}], "question": "qx"})
        assert "# Trace: qx" in out
        assert "**Bare**" in out
        # no location backticks for the node line
        assert "`:" not in out

    def test_trace_hint_when_no_nodes(self):
        out = md({"matchedNodes": [], "traceHint": "try searching"})
        assert "**Hint:** try searching" in out

    def test_neighbors(self):
        out = md({
            "matchedNodes": [{"name": "C"}],
            "neighbors": {
                "center": {"name": "Center"},
                "totalEdges": 3,
                "neighbors": [{"direction": "out", "name": "N", "type": "fn", "edgeType": "calls"}],
            },
        })
        assert "## Neighbors (center: Center, edges: 3)" in out
        assert "[out] **N** (fn) via _calls_" in out

    def test_business_context_in_trace(self):
        out = md({
            "matchedNodes": [{"name": "C"}],
            "businessContext": [{"id": "bc1", "match": "biz"}],
        })
        assert "## Business Context" in out
        assert "**bc1**: biz" in out

    def test_wiki_domain_block(self):
        out = md({
            "matchedNodes": [{"name": "C"}],
            "wikiDomain": {
                "name": "Payments",
                "summary": "payment domain",
                "businessRules": [{"id": "BR1", "description": "must pay"}],
                "entities": [{"name": "Invoice", "description": "an invoice"}],
            },
        })
        assert "## Wiki Domain Detail" in out
        assert "**Payments**" in out
        assert "payment domain" in out
        assert "### Business Rules" in out
        assert "**BR1**: must pay" in out
        assert "### Entities" in out
        assert "**Invoice**: an invoice" in out

    def test_domain_flows(self):
        out = md({
            "matchedNodes": [{"name": "C"}],
            "domainFlows": [{
                "flow": {"name": "Checkout", "summary": "checkout flow"},
                "steps": [{"name": "AddToCart", "summary": "add"},
                          {"name": "Pay", "summary": "pay"}],
            }],
        })
        assert "## Domain Flows" in out
        assert "### Checkout" in out
        assert "checkout flow" in out
        assert "1. AddToCart" in out
        assert "2. Pay" in out

    def test_source_by_file_with_relationships(self):
        out = md({
            "matchedNodes": [{"name": "C"}],
            "relationshipMap": [
                {"fromName": "A", "toName": "B", "edgeType": "calls", "direction": "out"},
                {"from": "X", "to": "Y"},  # fallback names
            ],
            "sourceByFile": {
                "src/A.py": {
                    "lineRange": "1-3",
                    "symbols": [{"name": "fn"}, {}],
                    "source": "print(1)",
                },
                "noext": {"source": "x"},  # no '.' -> java default
            },
        })
        assert "## Source by File" in out
        assert "### Relationships (2 edges between matched nodes)" in out
        assert "**A** → **B** via _calls_ (out)" in out
        assert "**X** → **Y**" in out
        assert "### `src/A.py` (lines 1-3)" in out
        assert "Symbols: fn, ?" in out
        assert "```python" in out
        assert "print(1)" in out

    def test_source_block(self):
        out = md({
            "matchedNodes": [{"name": "C"}],
            "source": {"file": "A.kt", "lineRange": "10-20", "content": "fun x() {}"},
        })
        assert "## Source: A.kt (lines 10-20)" in out
        assert "```kotlin" in out
        assert "fun x() {}" in out

    def test_source_no_ext_defaults_java(self):
        out = md({
            "matchedNodes": [{"name": "C"}],
            "source": {"file": "Makefile", "content": "all:"},
        })
        assert "```java" in out

    def test_source_reads(self):
        out = md({
            "matchedNodes": [{"name": "C"}],
            "sourceReads": [
                {"node": "doIt", "type": "method", "file": "A.ts", "lineRange": "1-2", "content": "x"},
                {"content": "y"},  # missing file -> java default + '?'
            ],
        })
        assert "## Source Code Reads" in out
        assert "### doIt (method) — `A.ts:1-2`" in out
        assert "```typescript" in out
        assert "### ? (?) — `?:`" in out

    def test_cross_service_rpc_hint(self):
        out = md({
            "matchedNodes": [{"name": "C"}],
            "crossServiceRpcHint": {
                "message": "RPC deps found",
                "rpcInterfaces": [
                    {"interface": "IFoo", "implementedIn": "svc-b", "implClass": "FooImpl"},
                    {"implClass": "Bar"},  # implementedIn missing -> "unknown"
                    "RawString",  # non-dict branch
                ],
            },
        })
        assert "## Cross-Service RPC Dependencies" in out
        assert "RPC deps found" in out
        assert "**IFoo** → service: `svc-b`, impl: `FooImpl`" in out
        assert "service: `unknown`" in out
        assert "- RawString" in out

    def test_cross_service_trace_full(self):
        out = md({
            "matchedNodes": [{"name": "C"}],
            "crossServiceTrace": {
                "hint": "follows to svc-b",
                "targetService": "svc-b",
                "targetTrace": {
                    "matchedNodes": [{"name": "TFoo", "type": "class", "relevance": 5, "filePath": "T.java"}],
                    "wikiDomain": {"name": "TDomain", "summary": "target dom"},
                    "source": {"file": "T.go", "content": "package main"},
                    "sourceReads": [{"node": "tr", "file": "R.rs", "content": "fn r() {}"}],
                },
            },
        })
        assert "## Cross-Service Trace" in out
        assert "follows to svc-b" in out
        assert "### Target: svc-b — Matched Nodes (1)" in out
        assert "**TFoo** (class, relevance=5) `T.java`" in out
        assert "### Target Wiki: TDomain" in out
        assert "target dom" in out
        assert "### Target Source: `T.go`" in out
        assert "```go" in out
        assert "### tr — `R.rs`" in out
        assert "```rs" in out  # 'rs' not in _LANG_BY_EXT -> fallback to ext itself
        assert "fn r() {}" in out

    def test_cross_service_trace_uses_traceResult_and_defaults(self):
        # targetTrace missing -> traceResult fallback; node/source missing branches.
        out = md({
            "matchedNodes": [{"name": "C"}],
            "crossServiceTrace": {
                "traceResult": {
                    "matchedNodes": [{}],  # no filePath -> loc empty; defaults '?'
                    "source": {"file": "noext", "content": "z"},  # no '.' -> java
                    "sourceReads": [{"content": "w"}],  # no file -> java
                },
            },
        })
        assert "## Cross-Service Trace" in out
        assert "### Target: ? — Matched Nodes (1)" in out
        assert "**?** (?, relevance=?)" in out
        # source default java fence appears for the cross-service source
        assert "### Target Source: `noext`" in out

    def test_structure_fallback_all_loc_forms(self):
        out = md({
            "matchedNodes": [],
            "structureFallback": {
                "hint": "structural hint",
                "results": [
                    {"name": "A", "file": "a.java", "startLine": 1, "endLine": 9, "type": "class"},
                    {"name": "B", "filePath": "b.java", "lineRange": [3, 7], "kind": "method"},
                    {"name": "C"},  # no lines, no file -> '?'
                ],
            },
        })
        assert "## Structure Fallback" in out
        assert "> structural hint" in out
        assert "| A | a.java:1-9 | class |" in out
        assert "| B | b.java:3-7 | method |" in out
        assert "| C | ? | ? |" in out

    def test_source_fallback_all_line_forms_and_snippets(self):
        out = md({
            "matchedNodes": [],
            "sourceFallback": {
                "hint": "src hint",
                "results": [
                    {"file": "a.py", "startLine": 1, "endLine": 3, "chunk": "block", "score": 0.5,
                     "snippet": "print(1)"},
                    {"file": "b.py", "lineRange": [4, 6], "type": "fn", "score": 7,
                     "content": "def f(): pass"},
                    {"file": "c.py", "line": 42, "score": None},  # line form + score "-"
                    {"file": "d.py"},  # no lines -> "-"; no snippet -> continue
                ],
            },
        })
        assert "## Source Content Search" in out
        assert "> src hint" in out
        assert "| a.py | 1-3 | block | 0.50 |" in out
        assert "| b.py | 4-6 | fn | 7 |" in out
        assert "| c.py | 42 | - | - |" in out
        assert "| d.py | - | - | - |" in out
        # snippets section
        assert "<details><summary>Snippet: a.py</summary>" in out
        assert "print(1)" in out
        assert "def f(): pass" in out  # content fallback for snippet


# --------------------------------------------------------------------------
# Symbol / matches
# --------------------------------------------------------------------------
class TestSymbol:
    def test_symbol_with_and_without_source(self):
        out = md({
            "symbol": "doThing",
            "matches": [
                {"kind": "method", "name": "doThing", "filePath": "A.kt", "lineRange": [1, 4],
                 "source": "fun doThing() {}"},
                {"name": "noSrc"},  # no source, no lineRange, no '.' in filePath
            ],
        })
        assert "# Symbol: doThing" in out
        assert "## method `doThing` — `A.kt:L1-4`" in out
        assert "```kotlin" in out
        assert "fun doThing() {}" in out
        assert "`?:`" in out  # default filePath '?'


# --------------------------------------------------------------------------
# Impact radius
# --------------------------------------------------------------------------
class TestImpact:
    def test_small(self):
        out = md({
            "impactRadius": 2, "affectedNodes": [
                {"name": "N1", "type": "fn", "distance": 1, "path": ["A", "B"]},
            ],
            "center": {"name": "Hub"}, "service": "svc", "depth": 2, "direction": "down",
        })
        assert "# Impact Analysis: Hub" in out
        assert "Service: svc | Depth: 2 | Direction: down | Radius: 2" in out
        assert "**N1** (fn, d=1) — A → B" in out

    def test_truncates_over_30(self):
        nodes = [{"name": f"N{i}"} for i in range(35)]
        out = md({"impactRadius": 1, "affectedNodes": nodes})
        assert "... and 5 more" in out


# --------------------------------------------------------------------------
# Callers / callees
# --------------------------------------------------------------------------
class TestCallersCallees:
    def test_callers(self):
        out = md({
            "callers": [{"name": "X", "type": "fn", "edgeType": "calls", "filePath": "X.java"}],
            "center": {"name": "Tgt"}, "total": 1,
        })
        assert "# Callers: Tgt" in out
        assert "Total: 1" in out
        assert "**X** (fn) via _calls_ `X.java`" in out

    def test_callees_no_filepath(self):
        out = md({"callees": [{"name": "Y"}], "center": {"name": "Tgt"}})
        assert "# Callees: Tgt" in out
        assert "Total: 1" in out  # len fallback
        assert "**Y**" in out


# --------------------------------------------------------------------------
# Hotspots
# --------------------------------------------------------------------------
class TestHotspots:
    def test_hotspots_with_long_filepath(self):
        long_fp = "x" * 50
        out = md({
            "service": "svc", "totalNodes": 99,
            "hotspots": [
                {"name": "H", "type": "class", "fanIn": 4, "fanOut": 2, "score": 3, "filePath": long_fp},
                {"name": "H2"},  # no filePath
            ],
        })
        assert "# Hotspots (svc)" in out
        assert "Total nodes: 99" in out
        assert "..." + "x" * 37 in out  # truncated path
        assert "| H | class | 4 | 2 | 3 |" in out


# --------------------------------------------------------------------------
# Affected tests
# --------------------------------------------------------------------------
class TestAffectedTests:
    def test_with_tests(self):
        out = md({
            "changedFiles": ["a.java", "b.java"],
            "affectedTests": [{"testFile": "ATest.java", "reason": "imports", "relatedSymbol": "A"}],
        })
        assert "# Affected Tests" in out
        assert "Changed files: a.java, b.java" in out
        assert "**ATest.java** — imports (via A)" in out

    def test_empty(self):
        out = md({"affectedTests": [], "changedFiles": []})
        assert "_No affected tests found._" in out


# --------------------------------------------------------------------------
# Services list
# --------------------------------------------------------------------------
class TestServicesList:
    def test_services(self):
        out = md({
            "services": [
                {"name": "svc-a", "dataLayers": {"kg": True, "wiki": True, "domain": False, "business": True}},
                {"name": "svc-b", "dataLayers": {}},
            ],
        })
        assert "# Services" in out
        assert "| svc-a |" in out
        assert "✓" in out
        assert "—" in out


# --------------------------------------------------------------------------
# Wiki overview
# --------------------------------------------------------------------------
class TestWikiOverview:
    def test_full(self):
        out = md({
            "overview": {
                "name": "MySvc",
                "description": "a service",
                "techStack": [{"name": "Spring", "role": "framework"}, "PlainTech"],
                "modules": [{"name": "core", "description": "core mod"}, "PlainMod"],
                "entryPoints": [{"name": "Main", "type": "class", "description": "entry"}, "PlainEP"],
            },
            "index": {"entries": [{"name": "Dom1", "summary": "d1"}, "PlainEntry"]},
        })
        assert "# Wiki: MySvc" in out
        assert "a service" in out
        assert "## Tech Stack" in out
        assert "**Spring**: framework" in out
        assert "- PlainTech" in out
        assert "## Modules" in out
        assert "**core**: core mod" in out
        assert "- PlainMod" in out
        assert "## Entry Points" in out
        assert "**Main** (class): entry" in out
        assert "- PlainEP" in out
        assert "## Domains (2)" in out
        assert "**Dom1**: d1" in out
        assert "- PlainEntry" in out

    def test_minimal_no_optional_sections(self):
        # overview present but empty inner lists -> skips tech/modules/eps/domains
        out = md({"overview": {"name": "Empty"}, "index": "not-a-dict"})
        assert "# Wiki: Empty" in out
        assert "## Tech Stack" not in out


# --------------------------------------------------------------------------
# Business features (features + serverIndex)
# --------------------------------------------------------------------------
class TestBusinessFeatures:
    def test_full(self):
        out = md({
            "features": [
                {
                    "name": "Login",
                    "clientLayer": {"implType": "native", "deliveryPlatforms": ["ios", "android"]},
                    "serverLayer": {"primaryDomain": {"service": "auth-svc", "confidence": 0.873}},
                },
                {
                    "name": "Search",
                    "clientLayer": {"platforms": {"web": {}}},  # platforms keys fallback
                    "serverLayer": {"primaryDomain": {"name": "search-dom", "confidence": "high"}},
                },
            ],
            "serverIndex": {
                "auth": {"service": "auth-svc", "features": ["Login"], "refCount": 3},
            },
            "stats": {"totalFeatures": 2, "withServerAssociation": 1, "serverDomainsReferenced": 1},
        })
        assert "# 业务功能全景" in out
        assert "共 2 个功能" in out
        assert "## 功能概览" in out
        assert "| Login | native | ios, android | auth-svc | 0.87 |" in out
        assert "| Search | - | web | search-dom | high |" in out
        assert "## 服务端反向索引" in out
        assert "| auth | auth-svc | Login | 3 |" in out

    def test_no_stats_no_features_no_index(self):
        out = md({"features": [], "serverIndex": {}})
        # routes to _format_business_features (features key + serverIndex key present)
        assert "# 业务功能全景" in out
        assert "## 功能概览" not in out


# --------------------------------------------------------------------------
# Business domain (interactions / businessRules)
# --------------------------------------------------------------------------
class TestBusinessDomain:
    def test_with_name_and_all_sections(self):
        out = md({
            "name": "Orders",
            "summary": "order domain",
            "interactions": [
                {"name": "PlaceOrder", "description": "place an order"},
                "PlainInteraction",
            ],
            "businessRules": [
                {"id": "BR1", "description": "no negative qty"},
                "PlainRule",
            ],
            "facets": {
                "mobile": {"services": [{"name": "m-svc"}, "raw-svc"]},
                "web": "web-svc-string",
            },
        })
        assert "# Business: Orders" in out
        assert "order domain" in out
        assert "## Interactions" in out
        assert "**PlaceOrder**: place an order" in out
        assert "- PlainInteraction" in out
        assert "## Business Rules" in out
        assert "**BR1**: no negative qty" in out
        assert "- PlainRule" in out
        assert "## Facets" in out
        assert "**mobile**: m-svc, raw-svc" in out
        assert "**web**: web-svc-string" in out

    def test_no_name_uses_overview_title(self):
        out = md({"businessRules": [], "interactions": []})
        assert "# Business Overview" in out

    def test_domain_field_used_as_name(self):
        out = md({"domain": "Billing", "interactions": [{"id": "i1"}]})
        assert "# Business: Billing" in out
        assert "**i1**" in out


# --------------------------------------------------------------------------
# Business panorama (architecture + services, no interactions)
# --------------------------------------------------------------------------
class TestPanorama:
    def test_full(self):
        out = md({
            "name": "Shop",
            "summary": "shop panorama",
            "services": [{"name": "svc1", "description": "first"}, "PlainSvc"],
            "architecture": {
                "layers": [{"name": "L1", "description": "layer one"}, "PlainLayer"],
                "communications": [{"name": "Sync", "description": "sync comm"}, "PlainComm"],
            },
            "steps": [{"name": "Step1", "description": "do step"}, "PlainStep"],
        })
        assert "# Panorama: Shop" in out
        assert "shop panorama" in out
        assert "## Services (2)" in out
        assert "**svc1**: first" in out
        assert "- PlainSvc" in out
        assert "## Architecture Layers" in out
        assert "**L1**: layer one" in out
        assert "- PlainLayer" in out
        assert "## Communications" in out
        assert "**Sync**: sync comm" in out
        assert "- PlainComm" in out
        assert "## Steps" in out
        assert "1. **Step1**: do step" in out
        assert "2. PlainStep" in out

    def test_no_name_default_title(self):
        out = md({"architecture": {}, "services": ["svc-only"]})
        assert "# Business Panorama" in out
        assert "- svc-only" in out


# --------------------------------------------------------------------------
# Wiki architecture (crossServiceCalls / eventFlows / mobile arch keys / facets list)
# --------------------------------------------------------------------------
class TestWikiArchitecture:
    def test_cross_service_calls_and_events_and_facets(self):
        out = md({
            "facets": [
                {"name": "mobile", "services": [{"name": "m1"}, "raw2"]},
            ],
            "crossServiceCalls": [
                {"caller": {"service": "a"}, "callee": {"service": "b", "interface": "IFoo"}, "type": "rpc"},
                {"from": "x", "to": "y", "protocol": "http", "detail": "some detail"},  # no iface
                "RawCall",
            ],
            "eventFlows": [
                {"name": "Ev1", "producer": "p", "consumer": "c"},
                "RawEvent",
            ],
        })
        assert "# Architecture" in out
        assert "## Facets" in out
        assert "**mobile**: m1, raw2" in out
        assert "## Cross-Service Calls (3)" in out
        assert "`a` → `b` via **IFoo** (rpc)" in out
        assert "`x` → `y` (http): some detail" in out
        assert "- RawCall" in out
        assert "## Event Flows (2)" in out
        assert "**Ev1**: p → c" in out
        assert "- RawEvent" in out

    def test_cross_service_calls_truncation(self):
        calls = [{"caller": {"service": f"a{i}"}, "callee": {"service": "b"}} for i in range(35)]
        out = md({"crossServiceCalls": calls})
        assert "... and 5 more" in out

    def test_event_flow_fallback_keys(self):
        out = md({"eventFlows": [{"event": "E", "from": "P", "to": "C"}]})
        assert "**E**: P → C" in out

    def test_mobile_feature_parity(self):
        out = md({
            "featureParity": [
                {"feature": "Login",
                 "platforms": {"ios": {"impl": "NativeLogin"}, "android": {"domain": "auth"}},
                 "note": "ok"},
                {"feature": "Pay", "platforms": {"ios": {}}, "note": ""},  # empty p_info -> "-"
            ],
        })
        assert "## 功能对等矩阵" in out
        # platform_cols sorted: android, ios
        assert "| 功能 | android | ios | 备注 |" in out
        assert "| Login | auth | NativeLogin | ok |" in out
        assert "| Pay | - | - |  |" in out

    def test_mobile_shared_infra(self):
        out = md({
            "sharedInfrastructure": [
                {"resource": "Redis", "type": "cache", "platforms": ["ios", "android"], "detail": "session"},
            ],
        })
        assert "## 共享基础设施" in out
        assert "**Redis** (cache): session — ios, android" in out

    def test_mobile_native_bridge(self):
        out = md({
            "nativeBridge": [
                {"from": "rn", "to": "native", "mechanism": "JSBridge", "detail": "calls"},
            ],
        })
        assert "## 原生桥接" in out
        assert "rn → native: **JSBridge** — calls" in out

    def test_mobile_domain_mapping(self):
        out = md({
            "domainMapping": [
                {"canonicalFeature": "Login",
                 "mappings": {"ios": "domain:auth-ios", "android": "auth-android"}},
            ],
        })
        assert "## 跨平台域映射" in out
        assert "| 功能 | android | ios |" in out
        # "domain:" prefix removed from ios mapping
        assert "| Login | auth-android | auth-ios |" in out


# --------------------------------------------------------------------------
# Domain graph (flows / nodes / flow / edges)
# --------------------------------------------------------------------------
class TestDomainGraph:
    def test_flows(self):
        out = md({"flows": [{"name": "F1", "summary": "flow one"}]})
        assert "# Domain Graph" in out
        assert "## Flows" in out
        assert "**F1**: flow one" in out

    def test_nodes(self):
        nodes = [{"name": f"N{i}", "type": "t", "summary": "s"} for i in range(35)]
        out = md({"nodes": nodes})
        assert "## Nodes" in out
        assert "**N0** (t): s" in out
        assert "... and 5 more" in out

    def test_flow_with_steps(self):
        out = md({
            "nodes": [],  # nodes present but empty so flow branch reachable
            "flow": {"name": "Checkout", "summary": "checkout flow"},
            "steps": [{"name": "S1", "summary": "step one"}],
        })
        assert "## Flow: Checkout" in out
        assert "checkout flow" in out
        assert "1. **S1** — step one" in out

    def test_edges_only(self):
        out = md({
            "nodes": [],
            "edges": [{"source": "a", "target": "b", "type": "calls"}],
        })
        assert "## Edges (1)" in out
        assert "`a` → `b` (calls)" in out


# --------------------------------------------------------------------------
# Freshness / stale
# --------------------------------------------------------------------------
class TestFreshness:
    def test_stale(self):
        out = md({"stale": [{"service": "svc", "layer": "kg", "age": "2d"}]})
        assert "# Data Freshness" in out
        assert "## Stale Layers" in out
        assert "**svc** / kg: last updated 2d" in out

    def test_freshness_dict_list_and_scalar(self):
        out = md({
            "freshness": {
                "current": [{"service": "s1", "layer": "wiki"}, "PlainItem"],
                "lastRun": "yesterday",
            },
        })
        assert "## current" in out
        assert "**s1** / wiki" in out
        assert "- PlainItem" in out
        assert "**lastRun:** yesterday" in out


# --------------------------------------------------------------------------
# KG file content
# --------------------------------------------------------------------------
class TestKgFileContent:
    def test_with_ext(self):
        out = md({"content": "print(1)", "file": "a.py", "lineCount": 1})
        assert "# Source: a.py" in out
        assert "Lines: 1" in out
        assert "```python" in out
        assert "print(1)" in out

    def test_no_ext_defaults_java(self):
        out = md({"content": "x", "file": "Makefile"})
        assert "```java" in out


# --------------------------------------------------------------------------
# Generic dict fallback
# --------------------------------------------------------------------------
class TestGenericDictFallback:
    def test_all_value_types(self):
        out = md({
            "skip_none": None,
            "skip_empty_list": [],
            "skip_empty_dict": {},
            "short_str_field": "hello",
            "long_string_value": "L" * 350,  # > 300 -> heading + body
            "an_int": 42,
            "a_bool": True,
            "some_list": [
                {"name": "Item1", "summary": "sum1"},
                {"foo": "bar"},  # no name -> json dump branch
                "plain",
            ],
            "nested_dict": {
                "scalar": "v",
                "alist": [1, 2, 3],
                "subdict": {"k": "v"},
                "noneval": None,
            },
        })
        assert "**Short Str Field:** hello" in out
        assert "## Long String Value" in out
        assert "LLL" in out
        assert "**An Int:** 42" in out
        assert "**A Bool:** True" in out
        assert "## Some List (3)" in out
        assert "**Item1**: sum1" in out
        assert '{"foo": "bar"}' in out
        assert "- plain" in out
        assert "## Nested Dict" in out
        assert "**scalar:** v" in out
        assert "**alist:** (3 items)" in out
        assert '**subdict:** {"k": "v"}' in out
        # None inside nested dict produces no line
        assert "noneval" not in out

    def test_list_truncation_in_generic(self):
        out = md({"big_list": [{"name": f"N{i}", "summary": "s"} for i in range(25)]})
        assert "## Big List (25)" in out
        assert "_... and 5 more_" in out


# --------------------------------------------------------------------------
# Top-level list fallback
# --------------------------------------------------------------------------
class TestListFallback:
    def test_list_of_dicts_and_scalars(self):
        data = [{"name": "A", "summary": "sa"}, {"foo": 1}, "plain"]
        out = md(data)
        assert "# Results (3)" in out
        assert "**A**: sa" in out
        assert '{"foo": 1}' in out
        assert "- plain" in out

    def test_list_truncation(self):
        out = md([{"name": f"N{i}"} for i in range(35)])
        assert "# Results (35)" in out
        assert "... and 5 more" in out


# --------------------------------------------------------------------------
# Final JSON fallback
# --------------------------------------------------------------------------
class TestJsonFallback:
    def test_scalar_falls_through(self):
        out = md(12345)
        assert "```json" in out
        assert "12345" in out

    def test_empty_dict_falls_through(self):
        # empty dict: generic branch produces no lines -> falls to json fallback
        out = md({})
        assert "```json" in out
        assert "{}" in out

    def test_dict_with_only_empty_values_falls_through(self):
        out = md({"a": None, "b": [], "c": {}})
        assert "```json" in out


def test_format_markdown_symbols_batch():
    from _utils import _format_markdown
    md = _format_markdown({"symbols": [
        {"symbol": "Foo", "matches": [
            {"kind": "class", "name": "Foo", "filePath": "F.java", "lineRange": [1, 9], "source": "class Foo {}"}]},
        {"symbol": "Bar", "matches": [], "error": "HTTP 400: limit"}]})
    assert "# Symbols (2)" in md
    assert "## Foo" in md
    assert "class Foo {}" in md
    assert "> error: HTTP 400: limit" in md


def test_format_markdown_source_files_batch():
    from _utils import _format_markdown
    md_out = _format_markdown({"files": [
        {"file": "A.java", "lineRange": [1, 3], "content": "AAA", "lineCount": 3},
        {"file": "B.java", "error": "HTTP 404: nope"}]})
    assert "# Source Files (2)" in md_out
    assert "## Source: A.java (lines 1-3)" in md_out
    assert "AAA" in md_out
    assert "> error: HTTP 404: nope" in md_out
