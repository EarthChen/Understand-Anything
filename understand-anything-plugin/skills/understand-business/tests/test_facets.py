import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from facets import (
    FACET_REGISTRY,
    canonical_facet,
    graph_file_for,
    is_supported_facet,
    CLIENT_FACET_TYPES,
    SERVER_FACET_TYPES,
    FRONTEND_FACET_TYPES,
    CLIENT_PLATFORMS,
    FRONTEND_PLATFORMS,
    SERVER_PLATFORMS,
    ALL_PLATFORMS,
)


def test_canonical_facet_normalizes_aliases():
    assert canonical_facet("backend") == "server"
    assert canonical_facet("web") == "frontend"
    assert canonical_facet("frontend") == "frontend"
    assert canonical_facet("mobile") == "mobile"
    assert canonical_facet("unknown-thing") == "unknown-thing"


def test_graph_file_for_resolves_aliases():
    assert graph_file_for("server") == "system-graph.json"
    assert graph_file_for("backend") == "system-graph.json"
    assert graph_file_for("mobile") == "client-graph.json"
    assert graph_file_for("frontend") == "frontend-graph.json"
    assert graph_file_for("web") == "frontend-graph.json"  # the old check_facets bug
    assert graph_file_for("shared") is None
    assert graph_file_for("test") is None


def test_role_sets_are_canonical():
    assert CLIENT_FACET_TYPES == frozenset({"mobile", "frontend", "desktop"})
    assert SERVER_FACET_TYPES == frozenset({"server"})
    assert FRONTEND_FACET_TYPES == frozenset({"frontend"})


def test_supported_flags():
    assert is_supported_facet("server") is True
    assert is_supported_facet("mobile") is True
    assert is_supported_facet("frontend") is True
    assert is_supported_facet("web") is True       # alias resolves
    assert is_supported_facet("desktop") is False
    assert is_supported_facet("shared") is False
    assert is_supported_facet("unknown-thing") is False


def test_platform_sets():
    assert FRONTEND_PLATFORMS == frozenset({"web"})
    assert "web" in CLIENT_PLATFORMS
    assert "java-spring" in SERVER_PLATFORMS
    assert "web" not in SERVER_PLATFORMS
    assert "unknown" in ALL_PLATFORMS
