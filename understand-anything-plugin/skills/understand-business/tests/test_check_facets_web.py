import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from check_facets import check_facets


def test_web_facet_resolves_to_frontend_graph(tmp_path):
    # Project root with a 'web' facet whose dir has frontend-graph.json + wiki meta.
    ua = tmp_path / ".understand-anything"
    ua.mkdir(parents=True)
    web_dir = tmp_path / "web" / ".understand-anything"
    web_dir.mkdir(parents=True)
    (web_dir / "frontend-graph.json").write_text("{}", encoding="utf-8")
    (web_dir / "wiki").mkdir()
    (web_dir / "wiki" / "meta.json").write_text("{}", encoding="utf-8")
    (ua / "system.json").write_text(json.dumps({
        "facets": [{"id": "f1", "type": "web", "name": "portal", "path": "web"}]
    }), encoding="utf-8")

    result = check_facets(str(tmp_path))
    facet = result["facets"][0]
    # Before the fix this was status 'degraded' (no graph file mapped for 'web').
    assert facet["hasGraph"] is True
    assert facet["status"] == "available"
