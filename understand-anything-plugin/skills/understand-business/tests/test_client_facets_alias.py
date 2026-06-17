import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from client_facets import load_client_features


def test_web_alias_uses_frontend_strategy(tmp_path):
    # A 'web' facet should be handled by the frontend strategy (not unsupported).
    web_dir = tmp_path / "web" / ".understand-anything"
    web_dir.mkdir(parents=True)
    (web_dir / "frontend-graph.json").write_text(json.dumps({
        "project": {"frameworks": ["react"]},
        "features": [{"name": "Orders", "sourceRepos": ["web"], "routes": [], "apiCalls": []}],
    }), encoding="utf-8")

    result = load_client_features(str(tmp_path), {"type": "web", "name": "portal", "path": "web"})
    assert result is not None
    assert [f["name"] for f in result["consolidated"]] == ["Orders"]


def test_desktop_is_unsupported(tmp_path):
    result = load_client_features(str(tmp_path), {"type": "desktop", "name": "d", "path": "d"})
    assert result is None
