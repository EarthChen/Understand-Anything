"""Tests for client_facets.py — strategy registry + consolidate_frontend (Spec 2 Component 1 & 2)."""
import json
from pathlib import Path

import pytest

from client_facets import (
    consolidate_frontend,
    consolidate_mobile,
    load_client_features,
    _is_frontend_infra,
    CLIENT_STRATEGIES,
)


def _write_frontend_graph(project_root: Path, features: list, frameworks=None, facet_path="frontend"):
    """Write a minimal frontend-graph.json under <root>/<facet_path>/.understand-anything/."""
    fe_ua = project_root / facet_path / ".understand-anything"
    fe_ua.mkdir(parents=True, exist_ok=True)
    fg = {
        "version": "1.0.0",
        "facetType": "frontend",
        "project": {"name": "web", "frameworks": frameworks or ["react", "vite"]},
        "features": features,
    }
    (fe_ua / "frontend-graph.json").write_text(json.dumps(fg), encoding="utf-8")


def _feat(name, source_repos=None, routes=None, api_calls=None):
    return {
        "id": f"feature:{name}",
        "name": name,
        "sourceRepos": source_repos if source_repos is not None else [],
        "routes": routes or [],
        "apiCalls": api_calls or [],
        "pages": [],
        "components": [],
        "stateStores": [],
    }


class TestConsolidateFrontend:
    def test_reads_features_into_consolidated(self, tmp_path):
        _write_frontend_graph(tmp_path, [
            _feat("Order Management", source_repos=["web-app"],
                  routes=["/orders"],
                  api_calls=[{"method": "GET", "path": "/api/orders"}]),
        ])
        result = consolidate_frontend(str(tmp_path), {"type": "frontend", "path": "frontend/"})
        assert set(result.keys()) == {"consolidated", "standalone", "infrastructure"}
        assert result["standalone"] == []
        assert len(result["consolidated"]) == 1
        entry = result["consolidated"][0]
        assert entry["name"] == "Order Management"
        assert entry["implType"] == "frontend-web"
        assert entry["platforms"] == ["web"]
        assert entry["facetType"] == "frontend"
        assert "react" in entry["deliveryPlatforms"]
        assert "/orders" in entry["mergedSummary"]
        assert "GET /api/orders" in entry["mergedSummary"]

    def test_multi_repo_feature_yields_one_implementation_per_repo(self, tmp_path):
        _write_frontend_graph(tmp_path, [
            _feat("Order Management", source_repos=["web-app", "admin"]),
        ])
        result = consolidate_frontend(str(tmp_path), {"type": "frontend", "path": "frontend/"})
        impls = result["consolidated"][0]["implementations"]
        assert impls == [
            {"platform": "web", "repo": "web-app"},
            {"platform": "web", "repo": "admin"},
        ]
        assert result["consolidated"][0]["sourceRepos"] == ["web-app", "admin"]

    def test_single_repo_feature_has_single_implementation(self, tmp_path):
        _write_frontend_graph(tmp_path, [_feat("Checkout", source_repos=["web-app"])])
        result = consolidate_frontend(str(tmp_path), {"type": "frontend", "path": "frontend/"})
        impls = result["consolidated"][0]["implementations"]
        assert impls == [{"platform": "web", "repo": "web-app"}]

    def test_infra_named_feature_lands_in_infrastructure(self, tmp_path):
        # NOTE: updated for token-sequence matching. "Theme" (a standalone token)
        # is infra, but "ThemeProvider" is a single token "themeprovider" that no
        # longer matches "theme" or "provider" as a contiguous token run — and
        # "provider" was removed as a keyword anyway (it collides with business
        # feature names). So "ThemeProvider" stays a consolidated feature.
        _write_frontend_graph(tmp_path, [
            _feat("Order Management", source_repos=["web-app"]),
            _feat("Theme", source_repos=["web-app"]),
        ])
        result = consolidate_frontend(str(tmp_path), {"type": "frontend", "path": "frontend/"})
        consolidated_names = {e["name"] for e in result["consolidated"]}
        infra_names = {e["name"] for e in result["infrastructure"]}
        assert "Order Management" in consolidated_names
        assert "Theme" in infra_names
        assert "Theme" not in consolidated_names

    def test_missing_frontend_graph_returns_empty(self, tmp_path):
        (tmp_path / "frontend").mkdir()
        result = consolidate_frontend(str(tmp_path), {"type": "frontend", "path": "frontend/"})
        assert result == {"consolidated": [], "standalone": [], "infrastructure": []}

    def test_corrupt_frontend_graph_returns_empty(self, tmp_path):
        fe_ua = tmp_path / "frontend" / ".understand-anything"
        fe_ua.mkdir(parents=True)
        (fe_ua / "frontend-graph.json").write_text("{ not json", encoding="utf-8")
        result = consolidate_frontend(str(tmp_path), {"type": "frontend", "path": "frontend/"})
        assert result == {"consolidated": [], "standalone": [], "infrastructure": []}

    def test_absolute_facet_path_rejected_by_traversal_guard(self, tmp_path):
        result = consolidate_frontend(str(tmp_path), {"type": "frontend", "path": "/etc"})
        assert result == {"consolidated": [], "standalone": [], "infrastructure": []}


class TestLoadClientFeaturesDispatch:
    def test_frontend_dispatches_to_frontend_shape(self, tmp_path):
        _write_frontend_graph(tmp_path, [_feat("Orders", source_repos=["web-app"])])
        result = load_client_features(str(tmp_path), {"type": "frontend", "path": "frontend/"})
        assert result is not None
        assert result["consolidated"][0]["implType"] == "frontend-web"

    def test_mobile_dispatches_to_mobile_shape(self, tmp_path):
        # No client-graph / wiki present → empty consolidation, but a valid mobile-shaped dict.
        (tmp_path / "mobile").mkdir()
        result = load_client_features(
            str(tmp_path), {"type": "mobile", "path": "mobile/", "subPaths": []}
        )
        assert result is not None
        assert set(result.keys()) == {"consolidated", "standalone", "infrastructure"}

    def test_unknown_type_returns_none(self, tmp_path):
        # 'desktop' is recognized as a client facet type by scenario_detector but
        # is intentionally not registered → unsupported → None (Finding #13).
        result = load_client_features(str(tmp_path), {"type": "desktop", "path": "desktop/"})
        assert result is None

    def test_registry_has_mobile_frontend_and_web(self):
        # 'web' is registered as an alias for the frontend strategy (Finding #13).
        assert set(CLIENT_STRATEGIES.keys()) == {"mobile", "frontend", "web"}


class TestFrontendInfraTokenMatching:
    """Finding #9: token-sequence matching (not substring) + drop ambiguous keywords."""

    @pytest.mark.parametrize("name", [
        "Provider Onboarding",   # 'provider' removed as keyword
        "Loading Dock Management",  # 'loading' removed as keyword
        "Reorder History",       # 'order' must not match inside 'reorder' (and isn't a keyword)
    ])
    def test_business_features_are_not_infra(self, name):
        assert _is_frontend_infra(name) is False

    @pytest.mark.parametrize("name", [
        "Layout",
        "Theme",
        "Error Boundary",
        "Toast",
        "Modal Shell",
        "i18n",
        "Locale Switcher",
    ])
    def test_infra_names_are_infra(self, name):
        assert _is_frontend_infra(name) is True

    def test_multiword_keyword_matches_as_contiguous_run(self):
        # 'error-boundary' tokenizes to ('error', 'boundary') and must match
        # the contiguous run within "Error Boundary Wrapper".
        assert _is_frontend_infra("Error Boundary Wrapper") is True

    def test_substring_does_not_match(self):
        # 'theme' must not match inside a single token like 'themepark'.
        assert _is_frontend_infra("Themepark Bookings") is False


class TestConsolidateMobileMissingPath:
    """Finding #10: missing/empty 'path' must not crash and must not scan the root."""

    def test_missing_path_returns_empty_consolidation(self, tmp_path):
        result = consolidate_mobile(str(tmp_path), {"type": "mobile", "subPaths": []})
        assert result == {"consolidated": [], "standalone": [], "infrastructure": []}

    def test_empty_path_returns_empty_consolidation(self, tmp_path):
        result = consolidate_mobile(str(tmp_path), {"type": "mobile", "path": "", "subPaths": []})
        assert result == {"consolidated": [], "standalone": [], "infrastructure": []}

    def test_load_client_features_mobile_missing_path_does_not_crash(self, tmp_path):
        result = load_client_features(str(tmp_path), {"type": "mobile"})
        assert result == {"consolidated": [], "standalone": [], "infrastructure": []}


class TestConsolidateMobileTraversalGuard:
    """Below-cut: mobile facet path that escapes project root → empty/fallback."""

    def test_absolute_path_outside_root_returns_empty(self, tmp_path):
        result = consolidate_mobile(
            str(tmp_path), {"type": "mobile", "path": "/etc", "subPaths": ["passwd"]}
        )
        assert result == {"consolidated": [], "standalone": [], "infrastructure": []}

    def test_dotdot_path_escaping_root_returns_empty(self, tmp_path):
        result = consolidate_mobile(
            str(tmp_path), {"type": "mobile", "path": "../../etc", "subPaths": []}
        )
        assert result == {"consolidated": [], "standalone": [], "infrastructure": []}


class TestWebAliasDispatch:
    """Finding #13: 'web' dispatches to the frontend strategy."""

    def test_web_dispatches_to_frontend_strategy(self, tmp_path):
        _write_frontend_graph(tmp_path, [_feat("Orders", source_repos=["web-app"])], facet_path="web")
        result = load_client_features(str(tmp_path), {"type": "web", "path": "web/"})
        assert result is not None
        assert result["consolidated"][0]["implType"] == "frontend-web"
        # Same strategy object as 'frontend'.
        assert CLIENT_STRATEGIES["web"] is CLIENT_STRATEGIES["frontend"]

    def test_web_missing_graph_returns_empty_triple(self, tmp_path):
        (tmp_path / "web").mkdir()
        result = load_client_features(str(tmp_path), {"type": "web", "path": "web/"})
        assert result == {"consolidated": [], "standalone": [], "infrastructure": []}
