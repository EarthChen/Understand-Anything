import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from scenario_detector import detect_scenario, CLIENT_FACET_TYPES, SERVER_FACET_TYPES


def _write_system(tmp_path, facets):
    ua = tmp_path / ".understand-anything"
    ua.mkdir(parents=True)
    (ua / "system.json").write_text(json.dumps({"facets": facets}), encoding="utf-8")


def test_backend_alias_classified_as_server(tmp_path):
    _write_system(tmp_path, [
        {"type": "backend", "name": "svc", "path": "server"},
        {"type": "mobile", "name": "app", "path": "mobile"},
    ])
    result = detect_scenario(str(tmp_path))
    assert result["scenario"] == "client_server"
    assert result["server_facet"]["type"] == "backend"


def test_web_alias_classified_as_client(tmp_path):
    _write_system(tmp_path, [
        {"type": "server", "name": "svc", "path": "server"},
        {"type": "web", "name": "portal", "path": "web"},
    ])
    result = detect_scenario(str(tmp_path))
    assert result["scenario"] == "client_server"
    assert len(result["client_facets"]) == 1


def test_role_sets_come_from_registry():
    assert "mobile" in CLIENT_FACET_TYPES and "frontend" in CLIENT_FACET_TYPES
    assert SERVER_FACET_TYPES == frozenset({"server"})
