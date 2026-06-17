"""Tests for client_facets.py — strategy registry + consolidate_frontend (Spec 2 Component 1 & 2)."""
import json
from pathlib import Path

import pytest

from client_facets import (
    consolidate_frontend,
    load_client_features,
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
        _write_frontend_graph(tmp_path, [
            _feat("Order Management", source_repos=["web-app"]),
            _feat("Layout", source_repos=["web-app"]),
            _feat("ThemeProvider", source_repos=["web-app"]),
        ])
        result = consolidate_frontend(str(tmp_path), {"type": "frontend", "path": "frontend/"})
        consolidated_names = {e["name"] for e in result["consolidated"]}
        infra_names = {e["name"] for e in result["infrastructure"]}
        assert "Order Management" in consolidated_names
        assert "Layout" in infra_names
        assert "ThemeProvider" in infra_names
        assert "Layout" not in consolidated_names

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
        result = load_client_features(str(tmp_path), {"type": "desktop", "path": "desktop/"})
        assert result is None

    def test_registry_has_mobile_and_frontend(self):
        assert set(CLIENT_STRATEGIES.keys()) == {"mobile", "frontend"}
