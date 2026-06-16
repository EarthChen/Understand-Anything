#!/usr/bin/env python3
"""Tests for _load_frontend_features in association_discovery.py."""
import json
import sys
import pytest
from pathlib import Path

# The worktree contains the updated association_discovery.py with
# _load_frontend_features; ensure it takes precedence over the main-repo copy.
_WORKTREE_SKILLS = (
    Path(__file__).resolve().parent.parent.parent
    / '.claude' / 'worktrees' / 'feat-frontend-web-facet'
    / 'understand-anything-plugin' / 'skills' / 'understand-business'
)
if _WORKTREE_SKILLS.is_dir():
    sys.path.insert(0, str(_WORKTREE_SKILLS))

from association_discovery import _load_frontend_features


class TestLoadFrontendFeatures:
    def test_returns_empty_when_no_file(self, tmp_path):
        """Missing frontend-graph.json returns empty list."""
        facet = {"type": "frontend", "path": "frontend/"}
        features = _load_frontend_features(str(tmp_path), facet)
        assert features == []

    def test_returns_empty_on_invalid_json(self, tmp_path):
        """Malformed JSON returns empty list without raising."""
        fg_dir = tmp_path / '.understand-anything'
        fg_dir.mkdir(parents=True)
        (fg_dir / 'frontend-graph.json').write_text('not-json', encoding='utf-8')
        facet = {"type": "frontend", "path": ""}
        features = _load_frontend_features(str(tmp_path), facet)
        assert features == []

    def test_returns_empty_when_features_missing(self, tmp_path):
        """frontend-graph.json with no features key returns empty list."""
        fg_dir = tmp_path / '.understand-anything'
        fg_dir.mkdir(parents=True)
        (fg_dir / 'frontend-graph.json').write_text(
            json.dumps({"project": {"frameworks": ["React"]}}), encoding='utf-8'
        )
        facet = {"type": "frontend", "path": ""}
        features = _load_frontend_features(str(tmp_path), facet)
        assert features == []

    def test_loads_basic_feature(self, tmp_path):
        """A valid frontend-graph.json with one feature is parsed correctly."""
        fg_dir = tmp_path / '.understand-anything'
        fg_dir.mkdir(parents=True)
        graph = {
            "project": {"frameworks": ["React"]},
            "features": [{"name": "Auth", "routes": ["/login"], "apiCalls": []}],
        }
        (fg_dir / 'frontend-graph.json').write_text(json.dumps(graph), encoding='utf-8')
        facet = {"type": "frontend", "path": ""}
        features = _load_frontend_features(str(tmp_path), facet)
        assert len(features) == 1
        assert features[0]['name'] == 'Auth'
        assert features[0]['implType'] == 'frontend-web'
        assert features[0]['platforms'] == ['web']
        assert features[0]['deliveryPlatforms'] == ['React']

    def test_feature_with_api_calls(self, tmp_path):
        """apiCalls are reflected in mergedSummary."""
        fg_dir = tmp_path / '.understand-anything'
        fg_dir.mkdir(parents=True)
        graph = {
            "project": {"frameworks": ["Vue"]},
            "features": [
                {
                    "name": "Dashboard",
                    "routes": [],
                    "apiCalls": [{"method": "GET", "path": "/api/data"}],
                }
            ],
        }
        (fg_dir / 'frontend-graph.json').write_text(json.dumps(graph), encoding='utf-8')
        facet = {"type": "frontend", "path": ""}
        features = _load_frontend_features(str(tmp_path), facet)
        assert len(features) == 1
        assert 'GET /api/data' in features[0]['mergedSummary']

    def test_loads_feature_from_subfacet_path(self, tmp_path):
        """Path inside the project root resolves correctly."""
        sub = tmp_path / 'web'
        fg_dir = sub / '.understand-anything'
        fg_dir.mkdir(parents=True)
        graph = {
            "project": {"frameworks": ["Next.js"]},
            "features": [{"name": "Home", "routes": ["/"], "apiCalls": []}],
        }
        (fg_dir / 'frontend-graph.json').write_text(json.dumps(graph), encoding='utf-8')
        facet = {"type": "frontend", "path": "web"}
        features = _load_frontend_features(str(tmp_path), facet)
        assert len(features) == 1
        assert features[0]['name'] == 'Home'

    def test_dotdot_path_returns_empty(self, tmp_path):
        """A relative traversal path like ../../etc must not escape the project root."""
        facet = {"type": "frontend", "path": "../../etc"}
        features = _load_frontend_features(str(tmp_path), facet)
        assert features == []

    def test_absolute_facet_path_returns_empty(self, tmp_path):
        """An absolute facet path must not escape the project root."""
        facet = {"type": "frontend", "path": "/etc"}
        features = _load_frontend_features(str(tmp_path), facet)
        assert features == []
