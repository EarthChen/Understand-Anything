import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from detect_platforms import validate_system_json


def test_backend_alias_passes_validation(tmp_path):
    ua = tmp_path / ".understand-anything"
    ua.mkdir(parents=True)
    (ua / "system.json").write_text(json.dumps({
        "facets": [{"type": "backend", "name": "svc", "path": "server"}]
    }), encoding="utf-8")
    result = validate_system_json(str(tmp_path))
    assert result["valid"] is True, result["errors"]


def test_unknown_facet_type_still_fails(tmp_path):
    ua = tmp_path / ".understand-anything"
    ua.mkdir(parents=True)
    (ua / "system.json").write_text(json.dumps({
        "facets": [{"type": "banana", "name": "svc", "path": "server"}]
    }), encoding="utf-8")
    result = validate_system_json(str(tmp_path))
    assert result["valid"] is False
