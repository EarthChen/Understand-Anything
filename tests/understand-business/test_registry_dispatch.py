"""De-dup regression: association_discovery and assemble both route frontend
through the registry, so their frontend feature pools cannot drift (Spec 2 test 6)."""
import json
from pathlib import Path

import pytest

import association_discovery
import assemble_business_features
from association_discovery import run_association_discovery
from assemble_business_features import run_assemble_features


@pytest.fixture
def project_with_server_and_frontend(tmp_path):
    """A project root with a backend facet (no domains) and a frontend facet."""
    ua = tmp_path / ".understand-anything"
    ua.mkdir()
    system = {
        "facets": [
            {"name": "api", "type": "backend", "path": "backend/", "subPaths": []},
            {"name": "web", "type": "frontend", "path": "frontend/"},
        ]
    }
    (ua / "system.json").write_text(json.dumps(system), encoding="utf-8")
    (tmp_path / "backend" / ".understand-anything").mkdir(parents=True)

    fe_ua = tmp_path / "frontend" / ".understand-anything"
    fe_ua.mkdir(parents=True)
    fg = {
        "version": "1.0.0",
        "facetType": "frontend",
        "project": {"name": "web", "frameworks": ["react"]},
        "features": [
            {"id": "feature:orders", "name": "Order Management", "sourceRepos": ["web-app"],
             "routes": ["/orders"], "apiCalls": [{"method": "GET", "path": "/api/orders"}],
             "pages": [], "components": [], "stateStores": []},
            {"id": "feature:profile", "name": "User Profile", "sourceRepos": ["web-app"],
             "routes": ["/profile"], "apiCalls": [], "pages": [], "components": [], "stateStores": []},
        ],
    }
    (fe_ua / "frontend-graph.json").write_text(json.dumps(fg), encoding="utf-8")
    return tmp_path


def test_loader_was_deleted_from_association_discovery():
    """The duplicate frontend loader must be gone — there is one loader, in client_facets."""
    assert not hasattr(association_discovery, "_load_frontend_features")


def test_both_paths_reference_the_registry():
    # Both consumers import load_client_features inside their run_* functions
    # (matching the existing local-import style), so assert against source text.
    assoc_src = Path(association_discovery.__file__).read_text(encoding="utf-8")
    asm_src = Path(assemble_business_features.__file__).read_text(encoding="utf-8")
    assert "load_client_features" in assoc_src
    assert "load_client_features" in asm_src
    # The duplicate frontend loader is gone from association_discovery.
    assert "_load_frontend_features" not in assoc_src


def test_frontend_feature_pools_match_across_paths(project_with_server_and_frontend):
    root = str(project_with_server_and_frontend)

    # association_discovery's pool (LLM is not configured → each feature errors but is
    # still recorded with its featureName).
    assoc_out = run_association_discovery(root)
    assoc_names = {a["featureName"] for a in assoc_out["associations"]}

    # assemble re-derives the consolidation via the same registry and builds one
    # feature doc per association.
    asm_out = run_assemble_features(root)
    asm_names = {f["name"] for f in asm_out["features"]}

    assert assoc_names == {"Order Management", "User Profile"}
    assert assoc_names == asm_names
