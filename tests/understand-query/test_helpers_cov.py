"""Coverage-completion tests for understand-query/_helpers.py.

Each test asserts real behavior (returned service, node dict, crossServiceOrigin
hint, keyword list, etc.), not merely line execution. All network access is mocked
at the `_helpers.<name>` level because `_helpers` calls those symbols from its own
namespace.
"""
import argparse
import sys
from pathlib import Path
from unittest.mock import patch

import pytest

SKILL_DIR = (
    Path(__file__).resolve().parent.parent.parent
    / "understand-anything-plugin"
    / "skills"
    / "understand-query"
)
sys.path.insert(0, str(SKILL_DIR))
import _helpers  # noqa: E402

SERVER = "http://s"


# ---------------------------------------------------------------------------
# _extract_code_keywords (line 69 — individual long-word branch)
# ---------------------------------------------------------------------------
class TestExtractCodeKeywords:
    def test_long_word_added_individually(self):
        # "Closed" (cap len 6) is < 7, "Friend" (6) < 7, but "Greatest" (8) >= 7.
        kws = _helpers._extract_code_keywords("Greatest Closed Friend")
        # Full pascal first.
        assert kws[0] == "GreatestClosedFriend"
        # Long word "Greatest" appended individually (line 68-69).
        assert "Greatest" in kws
        # Suffix combos (len > 5).
        assert "ClosedFriend" in kws

    def test_suffix_branch_and_filtered_noise(self):
        # "flow"/"domain"/"step" are filtered out (line 62).
        kws = _helpers._extract_code_keywords("bind-closed-friend-flow")
        assert kws[0] == "BindClosedFriend"
        assert "flow" not in [k.lower() for k in kws if k == "Flow"]
        # suffix "ClosedFriend" present.
        assert "ClosedFriend" in kws

    def test_empty_returns_empty_list(self):
        assert _helpers._extract_code_keywords("flow domain step") == []
        assert _helpers._extract_code_keywords("") == []


# ---------------------------------------------------------------------------
# _search_api (covered indirectly but exercise optional params)
# ---------------------------------------------------------------------------
class TestSearchApi:
    @patch("_helpers.fetch_json")
    def test_all_optional_params_in_url(self, mock_fetch):
        mock_fetch.return_value = {"results": [{"id": "x"}]}
        out = _helpers._search_api(
            SERVER, "q", service="svc", scope="kg", limit=10,
            fusion="rrf", type="class", tag="t", offset=5,
        )
        assert out == [{"id": "x"}]
        url = mock_fetch.call_args[0][0]
        assert "service=svc" in url
        assert "fusion=rrf" in url
        assert "type=class" in url
        assert "tag=t" in url
        assert "offset=5" in url

    @patch("_helpers.fetch_json")
    def test_missing_results_key_returns_empty(self, mock_fetch):
        mock_fetch.return_value = {}
        assert _helpers._search_api(SERVER, "q") == []


# ---------------------------------------------------------------------------
# _find_symbol_node
# ---------------------------------------------------------------------------
class TestFindSymbolNode:
    @patch("_helpers._search_api")
    def test_exact_local_match_returned_immediately(self, mock_search):
        # Two exact matches; higher-scored one wins. No cross-service call needed.
        mock_search.return_value = [
            {"name": "OrderService", "type": "interface"},
            {"name": "OrderService", "type": "class", "filePath": "a.java"},
        ]
        node = _helpers._find_symbol_node(SERVER, "order", "OrderService")
        # The class with filePath scores higher than bare interface.
        assert node["type"] == "class"
        assert "crossServiceOrigin" not in node

    @patch("_helpers._cross_service_symbol_search")
    @patch("_helpers._search_api")
    def test_fuzzy_local_then_cross_service_exact(self, mock_search, mock_cross):
        # Local service returns only fuzzy (no exact) matches.
        mock_search.return_value = [{"name": "OrderServiceFactory", "type": "class"}]
        mock_cross.return_value = {
            "service": "impl-svc",
            "node": {"name": "OrderService", "type": "class"},
        }
        node = _helpers._find_symbol_node(SERVER, "order", "OrderService")
        assert node["crossServiceOrigin"]["originalService"] == "order"
        assert node["crossServiceOrigin"]["actualService"] == "impl-svc"
        assert "impl-svc" in node["crossServiceOrigin"]["hint"]
        # exact_only must be True for this path.
        assert mock_cross.call_args.kwargs["exact_only"] is True

    @patch("_helpers._cross_service_symbol_search")
    @patch("_helpers._search_api")
    def test_no_exact_anywhere_returns_best_local_fuzzy(self, mock_search, mock_cross):
        mock_search.return_value = [
            {"name": "OrderServiceHelper", "type": "function"},
            {"name": "OrderServiceImpl", "type": "class", "filePath": "x.java"},
        ]
        mock_cross.return_value = None  # no cross-service exact match
        node = _helpers._find_symbol_node(SERVER, "order", "OrderService")
        # Impl class scores highest among fuzzy locals.
        assert node["name"] == "OrderServiceImpl"
        assert "crossServiceOrigin" not in node

    @patch("_helpers._cross_service_symbol_search")
    @patch("_helpers._search_api")
    def test_no_local_then_cross_service_fallback(self, mock_search, mock_cross):
        mock_search.return_value = []  # nothing in specified service
        mock_cross.return_value = {
            "service": "other-svc",
            "node": {"name": "OrderService", "type": "class"},
        }
        node = _helpers._find_symbol_node(SERVER, "order", "OrderService")
        assert node["crossServiceOrigin"]["actualService"] == "other-svc"
        assert "other-svc" in node["crossServiceOrigin"]["hint"]
        assert mock_cross.call_args.kwargs["exact_only"] is False

    @patch("_helpers._cross_service_symbol_search")
    @patch("_helpers._search_api")
    def test_nothing_found_raises_runtime_error(self, mock_search, mock_cross):
        mock_search.return_value = []
        mock_cross.return_value = None
        with pytest.raises(RuntimeError, match="No KG node found for symbol"):
            _helpers._find_symbol_node(SERVER, "order", "Nope")


# ---------------------------------------------------------------------------
# _cross_service_symbol_search
# ---------------------------------------------------------------------------
class TestCrossServiceSymbolSearch:
    @patch("_helpers._search_api")
    def test_search_raises_returns_none_and_logs(self, mock_search, capsys):
        mock_search.side_effect = RuntimeError("boom")
        out = _helpers._cross_service_symbol_search(SERVER, "svc", "Foo")
        assert out is None
        assert "cross-service search failed" in capsys.readouterr().err

    @patch("_helpers._search_api")
    def test_empty_after_excluding_service_returns_none(self, mock_search):
        # All hits belong to the excluded service → no candidates.
        mock_search.return_value = [{"name": "Foo", "service": "svc"}]
        assert _helpers._cross_service_symbol_search(SERVER, "svc", "Foo") is None

    @patch("_helpers._search_api")
    def test_exact_only_filter_empties_returns_none(self, mock_search):
        mock_search.return_value = [{"name": "FooBar", "service": "other"}]
        out = _helpers._cross_service_symbol_search(
            SERVER, "svc", "Foo", exact_only=True
        )
        assert out is None

    @patch("_helpers._search_api")
    def test_impl_score_sort_prefers_impl_class(self, mock_search):
        mock_search.return_value = [
            {"name": "Foo", "service": "a", "type": "function"},
            {"name": "FooServiceImpl", "service": "b", "type": "class"},
        ]
        out = _helpers._cross_service_symbol_search(SERVER, "exclude", "Foo")
        # Impl + class bonuses push FooServiceImpl to the top.
        assert out["service"] == "b"
        assert out["node"]["name"] == "FooServiceImpl"

    @patch("_helpers._search_api")
    def test_exact_only_keeps_exact_match(self, mock_search):
        mock_search.return_value = [
            {"name": "FooHelper", "service": "a", "type": "class"},
            {"name": "Foo", "service": "b", "type": "class"},
        ]
        out = _helpers._cross_service_symbol_search(
            SERVER, "exclude", "Foo", exact_only=True
        )
        assert out["node"]["name"] == "Foo"
        assert out["service"] == "b"


# ---------------------------------------------------------------------------
# _effective_service
# ---------------------------------------------------------------------------
class TestEffectiveService:
    def test_returns_actual_service_when_cross_origin(self):
        node = {"crossServiceOrigin": {"actualService": "real-svc"}}
        assert _helpers._effective_service(node, "fallback") == "real-svc"

    def test_returns_fallback_when_no_origin(self):
        assert _helpers._effective_service({}, "fallback") == "fallback"

    def test_returns_fallback_when_origin_missing_actual(self):
        node = {"crossServiceOrigin": {"originalService": "x"}}
        assert _helpers._effective_service(node, "fallback") == "fallback"


# ---------------------------------------------------------------------------
# _fetch_neighbors
# ---------------------------------------------------------------------------
class TestFetchNeighbors:
    @patch("_helpers.fetch_json")
    def test_builds_url_with_edge_type(self, mock_fetch):
        mock_fetch.return_value = {"neighbors": []}
        out = _helpers._fetch_neighbors(
            SERVER, "svc", "n1", direction="out", depth=2, edge_type="calls"
        )
        assert out == {"neighbors": []}
        url = mock_fetch.call_args[0][0]
        assert "/api/graph-query/neighbors" in url
        assert "service=svc" in url
        assert "node=n1" in url
        assert "direction=out" in url
        assert "depth=2" in url
        assert "edgeType=calls" in url

    @patch("_helpers.fetch_json")
    def test_no_edge_type_omits_param(self, mock_fetch):
        mock_fetch.return_value = {"neighbors": [1]}
        _helpers._fetch_neighbors(SERVER, "svc", "n1")
        url = mock_fetch.call_args[0][0]
        assert "edgeType" not in url


# ---------------------------------------------------------------------------
# _neighbor_entries
# ---------------------------------------------------------------------------
class TestNeighborEntries:
    def test_full_entry_mapping(self):
        data = {
            "neighbors": [
                {
                    "node": {"id": "n1", "name": "Foo", "type": "class", "filePath": "f.java"},
                    "edge": {"type": "calls"},
                    "direction": "out",
                }
            ]
        }
        entries = _helpers._neighbor_entries(data)
        assert entries == [
            {
                "id": "n1",
                "name": "Foo",
                "type": "class",
                "filePath": "f.java",
                "direction": "out",
                "edgeType": "calls",
            }
        ]

    def test_missing_node_and_edge_use_defaults(self):
        # node is None → {} ; name falls back to id ("?" when absent).
        data = {"neighbors": [{"direction": "in"}]}
        entries = _helpers._neighbor_entries(data)
        assert entries[0]["id"] == ""
        assert entries[0]["name"] == "?"
        assert entries[0]["edgeType"] == ""
        assert entries[0]["direction"] == "in"

    def test_empty_neighbors(self):
        assert _helpers._neighbor_entries({}) == []


# ---------------------------------------------------------------------------
# _nodes_for_file
# ---------------------------------------------------------------------------
class TestNodesForFile:
    def test_various_match_modes_and_skips_empty(self):
        nodes = [
            {"id": "1", "filePath": "src\\main\\Order.java"},   # backslash → match via endswith
            {"id": "2", "filePath": "other/Foo.java"},          # no match
            {"id": "3", "filePath": ""},                        # empty → skipped (continue)
            {"id": "4", "filePath": "deep/nested/order.java"},  # substring/endswith match
        ]
        matched = _helpers._nodes_for_file(nodes, "Order.java")
        matched_ids = {n["id"] for n in matched}
        assert "1" in matched_ids
        assert "4" in matched_ids
        assert "2" not in matched_ids
        assert "3" not in matched_ids

    def test_exact_normalized_match(self):
        nodes = [{"id": "x", "filePath": "Order.java"}]
        assert _helpers._nodes_for_file(nodes, "order.java")[0]["id"] == "x"

    def test_no_match_returns_empty(self):
        assert _helpers._nodes_for_file([{"id": "1", "filePath": "a.py"}], "b.py") == []


# ---------------------------------------------------------------------------
# _is_test_path
# ---------------------------------------------------------------------------
class TestIsTestPath:
    @pytest.mark.parametrize(
        "path,expected",
        [
            ("src/test/Foo.java", True),
            ("src/FooTest.java", True),
            ("src/foo.spec.ts", True),
            ("src/main/Order.java", False),
        ],
    )
    def test_markers(self, path, expected):
        assert _helpers._is_test_path(path) is expected


# ---------------------------------------------------------------------------
# _auto_discover_service — Strategy 0 (class-keyword exact KG match)
# ---------------------------------------------------------------------------
class TestAutoDiscoverStrategy0:
    @patch("_helpers._search_api")
    @patch("_helpers.fetch_json")
    def test_exact_impl_class_decisive_early_return(self, mock_fetch, mock_search):
        # query has a PascalCase class keyword (>5 chars, has lowercase).
        mock_fetch.return_value = {
            "services": [{"name": "order-svc", "dataLayers": {"kg": True}}]
        }
        # KG hit: exact name + class type + Impl suffix → bonus 20 (>=15) → early return.
        mock_search.return_value = [
            {"name": "OrderServiceImpl", "type": "class"}
        ]
        svc, biz = _helpers._auto_discover_service(SERVER, "OrderServiceImpl")
        assert svc == "order-svc"
        assert biz == []
        # Early return means wiki/business strategies never ran (only services + KG).
        # fetch_json called once (services list).
        assert mock_fetch.call_count == 1

    @patch("_helpers._search_api")
    @patch("_helpers.fetch_json")
    def test_exact_class_without_impl_bonus_15_early_return(self, mock_fetch, mock_search):
        mock_fetch.return_value = {
            "services": [{"name": "acct-svc", "dataLayers": {"kg": True}}]
        }
        # Exact name + class type, no Impl suffix → bonus 15 → still >=15 → early return.
        mock_search.return_value = [{"name": "AccountManager", "type": "class"}]
        # "AccountManager" ends with "Manager" (an impl suffix) → would be 20.
        # Use a non-impl class keyword instead to exercise the 15 branch.
        mock_search.return_value = [{"name": "BillingEntity", "type": "class"}]
        svc, biz = _helpers._auto_discover_service(SERVER, "BillingEntity")
        assert svc == "acct-svc"

    @patch("_helpers._search_api")
    @patch("_helpers.fetch_json")
    def test_partial_class_match_only_8_votes_no_early_return(self, mock_fetch, mock_search):
        # Strategy 0 yields only partial (8 vote) matches → < 15 → no early return,
        # then falls through. Provide wiki votes so it resolves later.
        services_resp = {
            "services": [{"name": "svc-a", "dataLayers": {"kg": True}}]
        }

        def fetch_side(url):
            return services_resp

        mock_fetch.side_effect = fetch_side

        def search_side(server, query, service=None, scope="kg", **kw):
            if scope == "kg" and service == "svc-a" and query == "OrderThing":
                # partial match: class type, name contains keyword but not exact.
                return [{"name": "OrderThingFactory", "type": "class"}]
            if scope == "wiki":
                return [{"service": "wiki-svc"}]
            return []

        mock_search.side_effect = search_side
        svc, biz = _helpers._auto_discover_service(SERVER, "OrderThing")
        # Strategy 0 gave svc-a +8; wiki gave wiki-svc +2. Strategy 2/3 gated by
        # `if not service_votes`, so they are skipped. Best = svc-a (8).
        assert svc == "svc-a"

    @patch("_helpers._search_api")
    @patch("_helpers.fetch_json")
    def test_strategy0_skips_service_without_kg_layer(self, mock_fetch, mock_search):
        mock_fetch.return_value = {
            "services": [
                {"name": "no-kg", "dataLayers": {"wiki": True}},   # skipped (no kg)
                {"name": "has-kg", "dataLayers": {"kg": True}},
            ]
        }
        mock_search.return_value = [{"name": "WidgetService", "type": "class"}]
        svc, _ = _helpers._auto_discover_service(SERVER, "WidgetService")
        assert svc == "has-kg"

    @patch("_helpers._search_api")
    @patch("_helpers.fetch_json")
    def test_strategy0_search_runtime_error_continues(self, mock_fetch, mock_search):
        mock_fetch.return_value = {
            "services": [
                {"name": "svc-err", "dataLayers": {"kg": True}},
                {"name": "svc-ok", "dataLayers": {"kg": True}},
            ]
        }

        def search_side(server, query, service=None, scope="kg", **kw):
            if service == "svc-err":
                raise RuntimeError("kg down")
            if service == "svc-ok":
                return [{"name": "PaymentService", "type": "class"}]
            return []

        mock_search.side_effect = search_side
        svc, _ = _helpers._auto_discover_service(SERVER, "PaymentService")
        # svc-err raised (continue), svc-ok exact impl → early return.
        assert svc == "svc-ok"

    @patch("_helpers._search_api")
    @patch("_helpers.fetch_json")
    def test_strategy0_services_fetch_runtime_error_falls_through(self, mock_fetch, mock_search):
        # /api/services raises in Strategy 0 → outer except pass; then wiki resolves.
        def fetch_side(url):
            raise RuntimeError("services down")

        mock_fetch.side_effect = fetch_side

        def search_side(server, query, service=None, scope="kg", **kw):
            if scope == "wiki":
                return [{"service": "wiki-only"}]
            return []

        mock_search.side_effect = search_side
        svc, biz = _helpers._auto_discover_service(SERVER, "WidgetThing")
        assert svc == "wiki-only"
        assert biz == [{"service": "wiki-only"}]


# ---------------------------------------------------------------------------
# _auto_discover_service — Strategy 1 (wiki votes)
# ---------------------------------------------------------------------------
class TestAutoDiscoverStrategy1:
    @patch("_helpers._search_api")
    def test_wiki_votes_resolve_service(self, mock_search):
        # No class keywords → Strategy 0 skipped entirely.
        def search_side(server, query, service=None, scope="kg", **kw):
            if scope == "wiki":
                return [
                    {"service": "alpha"},
                    {"service": "alpha"},
                    {"service": "beta"},
                    {"service": ""},  # falsy svc ignored
                ]
            return []

        mock_search.side_effect = search_side
        svc, biz = _helpers._auto_discover_service(SERVER, "place an order")
        assert svc == "alpha"  # 2 votes vs 1
        assert biz[0]["service"] == "alpha"

    @patch("_helpers._search_api")
    def test_wiki_runtime_error_then_unresolved(self, mock_search):
        # wiki raises; business + kg also empty → returns (None, []).
        def search_side(server, query, service=None, scope="kg", **kw):
            if scope == "wiki":
                raise RuntimeError("wiki down")
            return []

        mock_search.side_effect = search_side
        with patch("_helpers.fetch_json") as mock_fetch:
            mock_fetch.return_value = {"services": []}
            svc, biz = _helpers._auto_discover_service(SERVER, "lowercase only")
        assert svc is None
        assert biz == []


# ---------------------------------------------------------------------------
# _auto_discover_service — Strategy 2 (business search) + 2b
# ---------------------------------------------------------------------------
class TestAutoDiscoverStrategy2:
    @patch("_helpers._search_api")
    @patch("_helpers.fetch_json")
    def test_business_search_with_platform_uses_api_and_facets(self, mock_fetch, mock_search):
        # wiki empty → no votes → Strategy 2 runs. platform set → /api/business/search.
        mock_search.return_value = []  # wiki + any kg empty

        def fetch_side(url):
            assert "/api/business/search" in url
            assert "platform=android" in url
            return {
                "results": [
                    {
                        "services": ["svc-direct"],
                        "facets": {
                            "web": {"services": [{"name": "svc-facet"}]},
                            "bad": "not-a-dict",  # exercises isinstance(facet_data, dict) False
                        },
                    }
                ]
            }

        mock_fetch.side_effect = fetch_side
        svc, biz = _helpers._auto_discover_service(
            SERVER, "closed friend", platform="android"
        )
        # svc-direct +3, svc-facet +2 → svc-direct wins.
        assert svc == "svc-direct"
        assert biz  # biz_results set from biz_hits
        # platform path sets biz_features_api_used=True → Strategy 2b skipped.
        # Only one fetch_json (business search), no second.
        assert mock_fetch.call_count == 1

    @patch("_helpers._search_api")
    def test_business_search_without_platform_uses_scope_business(self, mock_search):
        # No platform → biz_hits via _search_api(scope="business"). String service entries.
        def search_side(server, query, service=None, scope="kg", **kw):
            if scope == "wiki":
                return []
            if scope == "business":
                return [{"services": ["biz-svc", ""]}]  # "" ignored
            return []

        mock_search.side_effect = search_side
        # Strategy 2b also runs (biz_features_api_used False) → it calls fetch_json.
        with patch("_helpers.fetch_json") as mock_fetch:
            mock_fetch.return_value = {}  # 2b returns nothing useful
            svc, biz = _helpers._auto_discover_service(SERVER, "some feature")
        assert svc == "biz-svc"
        assert biz == [{"services": ["biz-svc", ""]}]

    @patch("_helpers._search_api")
    def test_business_search_runtime_error_handled(self, mock_search):
        def search_side(server, query, service=None, scope="kg", **kw):
            if scope == "wiki":
                return []
            if scope == "business":
                raise RuntimeError("business down")
            return []

        mock_search.side_effect = search_side
        with patch("_helpers.fetch_json") as mock_fetch:
            # Strategy 2b fetch + Strategy 3 services fetch.
            def fetch_side(url):
                if "/api/business/search" in url:
                    return {}  # no results
                if "/api/services" in url:
                    return {"services": []}
                return {}

            mock_fetch.side_effect = fetch_side
            svc, biz = _helpers._auto_discover_service(SERVER, "x feature")
        assert svc is None


class TestAutoDiscoverStrategy2b:
    @patch("_helpers._search_api")
    @patch("_helpers.fetch_json")
    def test_business_features_api_votes_and_dedup(self, mock_fetch, mock_search):
        # wiki empty, scope=business empty → service_votes empty after Strategy 2,
        # so Strategy 2b runs (no platform → biz_features_api_used still False).
        def search_side(server, query, service=None, scope="kg", **kw):
            return []  # everything empty so 2b is the resolver

        mock_search.side_effect = search_side

        def fetch_side(url):
            if "/api/business/search" in url:
                return {
                    "results": [
                        {"service": "feat-svc"},
                        {"service": "feat-svc"},  # dedup → only +2 once
                        {"serverService": "feat-svc2"},
                        {"service": None},  # no svc, ignored
                    ]
                }
            return {"services": []}

        mock_fetch.side_effect = fetch_side
        svc, biz = _helpers._auto_discover_service(SERVER, "billing report")
        # feat-svc +2, feat-svc2 +2 → tie; max() picks first inserted ('feat-svc').
        assert svc == "feat-svc"
        assert biz  # biz_results = biz_resp["results"]

    @patch("_helpers._search_api")
    @patch("_helpers.fetch_json")
    def test_business_features_api_with_platform_param(self, mock_fetch, mock_search):
        # Strategy 2 ran with platform → biz_features_api_used True → 2b SKIPPED.
        # But Strategy 2 itself produced no votes (empty results). Strategy 3 resolves.
        def search_side(server, query, service=None, scope="kg", **kw):
            if scope == "kg" and service == "kg-svc":
                return [{"name": "billing report exact match thing", "type": "class",
                         "summary": "billing report"}]
            return []

        mock_search.side_effect = search_side

        calls = {"n": 0}

        def fetch_side(url):
            calls["n"] += 1
            if "/api/business/search" in url:
                return {"results": []}  # Strategy 2 yields nothing
            if "/api/services" in url:
                return {"services": [{"name": "kg-svc", "dataLayers": {"kg": True}}]}
            return {}

        mock_fetch.side_effect = fetch_side
        svc, biz = _helpers._auto_discover_service(
            SERVER, "billing report", platform="ios"
        )
        assert svc == "kg-svc"

    @patch("_helpers._search_api")
    @patch("_helpers.fetch_json")
    def test_2b_runs_with_platform_when_votes_already_exist(self, mock_fetch, mock_search):
        # Wiki populates votes (Strategy 2 is gated by `not service_votes` → skipped,
        # so biz_features_api_used stays False). With a platform set, Strategy 2b runs
        # and adds the platform param (line 330).
        def search_side(server, query, service=None, scope="kg", **kw):
            if scope == "wiki":
                return [{"service": "wiki-svc"}]
            return []

        mock_search.side_effect = search_side

        captured = {}

        def fetch_side(url):
            if "/api/business/search" in url:
                captured["url"] = url
                return {"results": [{"service": "feat-svc"}]}
            return {}

        mock_fetch.side_effect = fetch_side
        svc, biz = _helpers._auto_discover_service(
            SERVER, "closed friend", platform="harmony"
        )
        # wiki-svc has 2 votes, feat-svc (from 2b) has 2 → tie; first inserted wins.
        assert svc == "wiki-svc"
        # Confirm 2b actually ran with the platform param.
        assert "platform=harmony" in captured["url"]

    @patch("_helpers._search_api")
    @patch("_helpers.fetch_json")
    def test_business_features_runtime_error_handled(self, mock_fetch, mock_search):
        mock_search.return_value = []  # wiki + business empty

        def fetch_side(url):
            if "/api/business/search" in url:
                raise RuntimeError("features down")
            if "/api/services" in url:
                return {"services": []}
            return {}

        mock_fetch.side_effect = fetch_side
        svc, biz = _helpers._auto_discover_service(SERVER, "feature x")
        assert svc is None
        assert biz == []


# ---------------------------------------------------------------------------
# _auto_discover_service — Strategy 3 (per-service KG scoring) + final returns
# ---------------------------------------------------------------------------
class TestAutoDiscoverStrategy3:
    @patch("_helpers._search_api")
    @patch("_helpers.fetch_json")
    def test_kg_scoring_resolves_service(self, mock_fetch, mock_search):
        def search_side(server, query, service=None, scope="kg", **kw):
            if scope == "wiki":
                return []
            if scope == "business":
                return []
            if scope == "kg" and service == "kg-strong":
                # exact name match → score 15 (> 3.0) → vote int(15)=15.
                return [{"name": "place an order", "type": "class"}]
            if scope == "kg" and service == "kg-weak":
                # low score (< 3.0) → no vote.
                return [{"name": "zzz", "type": ""}]
            return []

        mock_search.side_effect = search_side

        def fetch_side(url):
            if "/api/business/search" in url:
                return {}
            if "/api/services" in url:
                return {
                    "services": [
                        {"name": "kg-strong", "dataLayers": {"kg": True}},
                        {"name": "kg-weak", "dataLayers": {"wiki": True}},
                        {"name": "no-layers", "dataLayers": {}},  # skipped
                    ]
                }
            return {}

        mock_fetch.side_effect = fetch_side
        svc, biz = _helpers._auto_discover_service(SERVER, "place an order")
        assert svc == "kg-strong"

    @patch("_helpers._search_api")
    @patch("_helpers.fetch_json")
    def test_strategy3_kg_search_error_continues(self, mock_fetch, mock_search):
        def search_side(server, query, service=None, scope="kg", **kw):
            if scope in ("wiki", "business"):
                return []
            if service == "err-svc":
                raise RuntimeError("kg err")
            if service == "good-svc":
                return [{"name": "place order", "type": "class"}]
            return []

        mock_search.side_effect = search_side

        def fetch_side(url):
            if "/api/business/search" in url:
                return {}
            if "/api/services" in url:
                return {
                    "services": [
                        {"name": "err-svc", "dataLayers": {"kg": True}},
                        {"name": "good-svc", "dataLayers": {"kg": True}},
                    ]
                }
            return {}

        mock_fetch.side_effect = fetch_side
        svc, _ = _helpers._auto_discover_service(SERVER, "place order")
        assert svc == "good-svc"

    @patch("_helpers._search_api")
    @patch("_helpers.fetch_json")
    def test_strategy3_services_fetch_error_returns_none(self, mock_fetch, mock_search):
        mock_search.return_value = []  # wiki + business empty

        def fetch_side(url):
            if "/api/business/search" in url:
                return {}
            if "/api/services" in url:
                raise RuntimeError("services down")
            return {}

        mock_fetch.side_effect = fetch_side
        svc, biz = _helpers._auto_discover_service(SERVER, "something")
        assert svc is None
        assert biz == []

    @patch("_helpers._search_api")
    def test_search_query_uses_long_parts_fallback(self, mock_search):
        # All comma parts are > 20 chars → short_parts empty → fallback branch (parts[:2]).
        captured = {}

        def search_side(server, query, service=None, scope="kg", **kw):
            if scope == "wiki":
                captured["wiki_q"] = query
                return [{"service": "ok-svc"}]
            return []

        mock_search.side_effect = search_side
        long1 = "this_is_a_really_long_keyword_one"
        long2 = "this_is_a_really_long_keyword_two"
        svc, _ = _helpers._auto_discover_service(SERVER, f"{long1},{long2}")
        assert svc == "ok-svc"
        # search_query = " ".join(parts[:2]) since short_parts is empty.
        assert captured["wiki_q"] == f"{long1} {long2}"


# ---------------------------------------------------------------------------
# _fetch_wiki_domain
# ---------------------------------------------------------------------------
class TestFetchWikiDomain:
    @patch("_helpers._search_api")
    @patch("_helpers.fetch_json")
    def test_success_fetches_domain_detail(self, mock_fetch, mock_search):
        mock_search.return_value = [{"name": "Order Flow", "type": "domain"}]
        mock_fetch.return_value = {"name": "Order Flow", "summary": "ok"}
        out = _helpers._fetch_wiki_domain(SERVER, "svc", "order")
        assert out["summary"] == "ok"
        url = mock_fetch.call_args[0][0]
        assert "/api/wiki/service/svc/domain/order-flow" in url

    @patch("_helpers._search_api")
    def test_empty_results_returns_none(self, mock_search):
        mock_search.return_value = []
        assert _helpers._fetch_wiki_domain(SERVER, "svc", "order") is None

    @patch("_helpers._search_api")
    def test_fallback_to_first_three_when_no_domain_type(self, mock_search):
        # No results typed as domain → fall back to first 3 results' names (line 376).
        mock_search.return_value = [{"name": "Misc", "type": "other"}]
        with patch("_helpers.fetch_json") as mock_fetch:
            mock_fetch.return_value = {"name": "Misc"}
            out = _helpers._fetch_wiki_domain(SERVER, "svc", "q")
        assert out["name"] == "Misc"

    @patch("_helpers._search_api")
    def test_blank_name_skipped_then_none(self, mock_search):
        # Domain name resolves to empty string → `if not name: continue` → return None.
        mock_search.return_value = [{"name": "", "id": "", "type": "domain"}]
        assert _helpers._fetch_wiki_domain(SERVER, "svc", "q") is None

    @patch("_helpers._search_api")
    def test_domain_fetch_error_continues_then_none(self, mock_search):
        mock_search.return_value = [{"name": "Order", "type": "domain"}]
        with patch("_helpers.fetch_json") as mock_fetch:
            mock_fetch.side_effect = RuntimeError("404")
            out = _helpers._fetch_wiki_domain(SERVER, "svc", "q")
        assert out is None  # inner except continue → loop ends → return None

    @patch("_helpers._search_api")
    def test_outer_search_error_returns_none(self, mock_search):
        mock_search.side_effect = RuntimeError("wiki down")
        assert _helpers._fetch_wiki_domain(SERVER, "svc", "q") is None


# ---------------------------------------------------------------------------
# _fetch_domain_flows
# ---------------------------------------------------------------------------
class TestFetchDomainFlows:
    @patch("_helpers.fetch_json")
    def test_relevant_flow_with_steps(self, mock_fetch):
        mock_fetch.return_value = {
            "nodes": [
                {"id": "f1", "type": "flow", "name": "Bind Friend", "summary": "binds"},
                {"id": "s1", "type": "step", "name": "Step1"},
                {"id": "s2", "type": "step", "name": "Step2"},
            ],
            "edges": [
                {"source": "f1", "target": "s2", "type": "flow_step", "weight": 2},
                {"source": "f1", "target": "s1", "type": "flow_step", "weight": 1},
                {"source": "f1", "target": "x", "type": "other"},  # ignored
            ],
        }
        out = _helpers._fetch_domain_flows(SERVER, "svc", "bind")
        assert len(out) == 1
        assert out[0]["flow"]["id"] == "f1"
        # Steps sorted by edge weight: s1 (w=1) then s2 (w=2).
        step_ids = [s["id"] for s in out[0]["steps"]]
        assert set(step_ids) == {"s1", "s2"}

    @patch("_helpers.fetch_json")
    def test_no_relevant_falls_back_to_first_flows(self, mock_fetch):
        # Keyword matches nothing → relevant = flows[:10] (line 409).
        mock_fetch.return_value = {
            "nodes": [{"id": "f1", "type": "flow", "name": "Other", "summary": ""}],
            "edges": [],
        }
        out = _helpers._fetch_domain_flows(SERVER, "svc", "nomatch")
        assert len(out) == 1
        assert out[0]["flow"]["id"] == "f1"
        assert out[0]["steps"] == []

    @patch("_helpers.fetch_json")
    def test_no_flows_returns_none(self, mock_fetch):
        mock_fetch.return_value = {"nodes": [{"id": "n", "type": "class"}], "edges": []}
        assert _helpers._fetch_domain_flows(SERVER, "svc", "q") is None

    @patch("_helpers.fetch_json")
    def test_runtime_error_returns_none(self, mock_fetch):
        mock_fetch.side_effect = RuntimeError("graph down")
        assert _helpers._fetch_domain_flows(SERVER, "svc", "q") is None


# ---------------------------------------------------------------------------
# _extract_symbol
# ---------------------------------------------------------------------------
class TestExtractSymbol:
    def test_found_block_with_brace_tracking(self):
        content = (
            "package x;\n"
            "// header\n"
            "public class Foo {\n"
            "  void bar() {\n"
            "    doThing();\n"
            "  }\n"
            "}\n"
            "// trailing after block\n"
        )
        out = _helpers._extract_symbol(content, "class Foo")
        assert out is not None
        assert "class Foo" in out
        assert "void bar()" in out
        # Block ends at closing brace; trailing comment excluded.
        assert "trailing after block" not in out

    def test_symbol_with_paren_line(self):
        content = "def helper(x):\n    return x\nother = 1\n"
        out = _helpers._extract_symbol(content, "helper")
        assert out is not None
        assert "helper" in out

    def test_not_found_returns_none(self):
        content = "nothing relevant here\njust text\n"
        assert _helpers._extract_symbol(content, "Missing") is None

    def test_context_lines_included(self):
        # start_idx > 3 so context_start = start_idx - 3 (exercise max(0, ...)).
        content = "\n".join(
            ["a", "b", "c", "d", "e", "target() {", "  x;", "}"]
        )
        out = _helpers._extract_symbol(content, "target")
        # context_start = 5-3 = 2 → includes line "c".
        assert "c" in out.split("\n")


# ---------------------------------------------------------------------------
# _cmd_structure_symbol
# ---------------------------------------------------------------------------
class TestCmdStructureSymbol:
    @patch("_helpers.fetch_json")
    def test_source_mode_with_path(self, mock_fetch):
        mock_fetch.return_value = {"results": [{"name": "Foo", "source": "code"}]}
        args = argparse.Namespace(
            server=SERVER, service="svc", symbol="Foo",
            limit=5, path="src/**", source=True,
        )
        out = _helpers._cmd_structure_symbol(args)
        assert out["symbol"] == "Foo"
        assert out["matches"] == [{"name": "Foo", "source": "code"}]
        url = mock_fetch.call_args[0][0]
        assert "/api/structure/symbol-source" in url
        assert "pathPattern=" in url

    @patch("_helpers.fetch_json")
    def test_non_source_mode_maps_fields(self, mock_fetch):
        mock_fetch.return_value = {
            "results": [
                {
                    "name": "Bar",
                    "kind": "method",
                    "filePath": "B.java",
                    "lineRange": [1, 5],
                    "match": {"score": 1},
                }
            ]
        }
        args = argparse.Namespace(
            server=SERVER, service="svc", symbol="Bar",
            limit=10, path=None, source=False,
        )
        out = _helpers._cmd_structure_symbol(args)
        assert out["symbol"] == "Bar"
        m = out["matches"][0]
        assert m["name"] == "Bar"
        assert m["kind"] == "method"
        assert m["filePath"] == "B.java"
        assert m["lineRange"] == [1, 5]
        assert m["match"] == {"score": 1}
        url = mock_fetch.call_args[0][0]
        assert "/api/structure/search" in url
        assert "pathPattern" not in url

    @patch("_helpers.fetch_json")
    def test_non_source_mode_with_path(self, mock_fetch):
        # Exercises the non-source path-pattern branch (line 480).
        mock_fetch.return_value = {"results": []}
        args = argparse.Namespace(
            server=SERVER, service="svc", symbol="P",
            limit=5, path="lib/**", source=False,
        )
        out = _helpers._cmd_structure_symbol(args)
        assert out == {"symbol": "P", "matches": []}
        url = mock_fetch.call_args[0][0]
        assert "/api/structure/search" in url
        assert "pathPattern=lib" in url

    @patch("_helpers.fetch_json")
    def test_limit_floored_to_one(self, mock_fetch):
        mock_fetch.return_value = {"results": []}
        args = argparse.Namespace(
            server=SERVER, service="svc", symbol="X",
            limit=0, path=None, source=False,
        )
        out = _helpers._cmd_structure_symbol(args)
        assert out["matches"] == []
        url = mock_fetch.call_args[0][0]
        assert "limit=1" in url

    @patch("_helpers.fetch_json")
    def test_source_mode_no_path(self, mock_fetch):
        mock_fetch.return_value = {"results": []}
        args = argparse.Namespace(
            server=SERVER, service="svc", symbol="Z",
            limit=3, path=None, source=True,
        )
        out = _helpers._cmd_structure_symbol(args)
        assert out["symbol"] == "Z"
        url = mock_fetch.call_args[0][0]
        assert "/api/structure/symbol-source" in url
        assert "pathPattern" not in url

    @patch("_helpers.fetch_json")
    def test_source_mode_omits_limit_when_unset(self, mock_fetch):
        # When --limit is not passed (None), the symbol-source request must NOT send
        # a limit param so the server applies its per-endpoint default (5). Sending
        # the old CLI default (50) made the endpoint reject it: it caps limit at 20
        # and returns HTTP 400 "limit must be between 1 and 20".
        mock_fetch.return_value = {"results": []}
        args = argparse.Namespace(
            server=SERVER, service="svc", symbol="GuildProfitSettlement",
            limit=None, path=None, source=True,
        )
        _helpers._cmd_structure_symbol(args)
        url = mock_fetch.call_args[0][0]
        assert "/api/structure/symbol-source" in url
        assert "limit=" not in url

    @patch("_helpers.fetch_json")
    def test_source_mode_forwards_explicit_limit(self, mock_fetch):
        # An explicit --limit is still honored on the symbol-source path.
        mock_fetch.return_value = {"results": []}
        args = argparse.Namespace(
            server=SERVER, service="svc", symbol="X",
            limit=10, path=None, source=True,
        )
        _helpers._cmd_structure_symbol(args)
        url = mock_fetch.call_args[0][0]
        assert "limit=10" in url

    @patch("_helpers.fetch_json")
    def test_non_source_mode_unset_limit_defaults_to_50(self, mock_fetch):
        # The non-source symbol search hits /api/structure/search (cap 500); an unset
        # --limit falls back to the historical default of 50.
        mock_fetch.return_value = {"results": []}
        args = argparse.Namespace(
            server=SERVER, service="svc", symbol="X",
            limit=None, path=None, source=False,
        )
        _helpers._cmd_structure_symbol(args)
        url = mock_fetch.call_args[0][0]
        assert "/api/structure/search" in url
        assert "limit=50" in url


# ---------------------------------------------------------------------------
# _kg_file_toc
# ---------------------------------------------------------------------------
class TestKgFileToc:
    def test_matches_by_filepath_and_id_sorted_by_line(self):
        args = argparse.Namespace(file="Order.java")
        graph = {
            "nodes": [
                {"name": "B", "type": "method", "filePath": "src/order.java",
                 "lineRange": [50, 60], "summary": "later"},
                {"name": "A", "type": "class", "filePath": "src/Order.java",
                 "lineRange": [10, 100], "summary": "x" * 200},
                {"name": "ById", "type": "field", "id": "src/order.java#fld",
                 "filePath": "", "lineRange": None, "summary": ""},
                {"name": "Other", "type": "class", "filePath": "src/Foo.java",
                 "lineRange": [1, 2], "summary": ""},  # no match
            ]
        }
        out = _helpers._kg_file_toc(args, graph)
        names = [s["name"] for s in out]
        # "Other" excluded; matched: A, B (filePath), ById (id substring).
        assert "Other" not in names
        assert "A" in names and "B" in names and "ById" in names
        # summary truncated to 80 chars.
        a = next(s for s in out if s["name"] == "A")
        assert len(a["summary"]) == 80
        # Sorted by lineRange[0]; node with None lineRange sorts to 9999 (last).
        assert names[-1] == "ById"
        assert names.index("A") < names.index("B")

    def test_no_match_returns_empty(self):
        args = argparse.Namespace(file="nonexistent.java")
        out = _helpers._kg_file_toc(args, {"nodes": [{"name": "X", "filePath": "a.py"}]})
        assert out == []
