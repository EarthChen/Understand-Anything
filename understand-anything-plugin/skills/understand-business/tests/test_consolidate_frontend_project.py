import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from client_facets import consolidate_frontend


def test_consolidated_entry_carries_project(tmp_path):
    web_dir = tmp_path / "web" / ".understand-anything"
    web_dir.mkdir(parents=True)
    (web_dir / "frontend-graph.json").write_text(json.dumps({
        "project": {"frameworks": ["react"]},
        "features": [
            {"name": "订单", "project": "seller-portal", "sourceRepos": ["seller-portal"],
             "routes": ["/s/orders"], "apiCalls": []},
            {"name": "订单", "project": "buyer-web", "sourceRepos": ["buyer-web"],
             "routes": ["/b/orders"], "apiCalls": []},
        ],
    }), encoding="utf-8")

    result = consolidate_frontend(str(tmp_path), {"type": "frontend", "name": "p", "path": "web"})
    projects = sorted(c["project"] for c in result["consolidated"])
    assert projects == ["buyer-web", "seller-portal"]
