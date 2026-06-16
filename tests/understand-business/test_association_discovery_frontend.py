"""Tests for association_discovery.py — frontend facet feature loading."""
import json
from pathlib import Path

import pytest
from association_discovery import _load_frontend_features


@pytest.fixture
def project_with_frontend_facet(tmp_path):
    """Project root with a frontend facet and frontend-graph.json."""
    ua = tmp_path / ".understand-anything"
    ua.mkdir()
    fe_dir = tmp_path / "frontend"
    fe_ua = fe_dir / ".understand-anything"
    fe_ua.mkdir(parents=True)
    fg = {
        "version": "1.0.0",
        "facetType": "frontend",
        "project": {"name": "admin-web", "frameworks": ["react", "vite"],
                    "provenance": {"generationMode": "wiki"}},
        "features": [
            {
                "id": "feature:order-management",
                "name": "Order Management",
                "sourceDomain": "domain:order-management",
                "routes": ["/orders"],
                "pages": ["src/pages/orders/List.tsx"],
                "apiCalls": [{"method": "GET", "path": "/api/orders", "source": "src/api/orders.ts"}],
                "stateStores": [],
                "components": [],
            }
        ],
    }
    (fe_ua / "frontend-graph.json").write_text(json.dumps(fg))
    return tmp_path


class TestLoadFrontendFeatures:
    def test_loads_features_from_frontend_graph(self, project_with_frontend_facet):
        facet = {"type": "frontend", "path": "frontend/"}
        features = _load_frontend_features(str(project_with_frontend_facet), facet)
        assert len(features) == 1
        assert features[0]["name"] == "Order Management"

    def test_feature_has_required_fields(self, project_with_frontend_facet):
        facet = {"type": "frontend", "path": "frontend/"}
        features = _load_frontend_features(str(project_with_frontend_facet), facet)
        feat = features[0]
        assert "name" in feat
        assert "implType" in feat
        assert "platforms" in feat
        assert "deliveryPlatforms" in feat
        assert "mergedSummary" in feat

    def test_feature_impltype_is_frontend_web(self, project_with_frontend_facet):
        facet = {"type": "frontend", "path": "frontend/"}
        features = _load_frontend_features(str(project_with_frontend_facet), facet)
        assert features[0]["implType"] == "frontend-web"

    def test_platforms_contains_web(self, project_with_frontend_facet):
        facet = {"type": "frontend", "path": "frontend/"}
        features = _load_frontend_features(str(project_with_frontend_facet), facet)
        assert "web" in features[0]["platforms"]

    def test_delivery_platforms_from_frameworks(self, project_with_frontend_facet):
        facet = {"type": "frontend", "path": "frontend/"}
        features = _load_frontend_features(str(project_with_frontend_facet), facet)
        assert "react" in features[0]["deliveryPlatforms"]

    def test_merged_summary_includes_routes(self, project_with_frontend_facet):
        facet = {"type": "frontend", "path": "frontend/"}
        features = _load_frontend_features(str(project_with_frontend_facet), facet)
        assert "/orders" in features[0]["mergedSummary"]

    def test_missing_frontend_graph_returns_empty(self, tmp_path):
        facet = {"type": "frontend", "path": "frontend/"}
        (tmp_path / "frontend").mkdir()
        features = _load_frontend_features(str(tmp_path), facet)
        assert features == []
