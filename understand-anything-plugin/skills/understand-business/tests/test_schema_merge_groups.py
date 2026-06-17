import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from detect_platforms import validate_system_json


def test_frontend_merge_groups_validate(tmp_path):
    ua = tmp_path / ".understand-anything"
    ua.mkdir(parents=True)
    (ua / "system.json").write_text(json.dumps({
        "facets": [{
            "type": "frontend", "name": "web", "path": "web",
            "subPaths": ["seller-portal", "ops-web"],
            "frontendMergeGroups": [
                {"canonicalName": "订单", "members": [
                    {"project": "seller-portal", "feature": "订单"},
                    {"project": "ops-web", "feature": "订单管理"}]}
            ],
        }]
    }, ensure_ascii=False), encoding="utf-8")
    result = validate_system_json(str(tmp_path))
    assert result["valid"] is True, result["errors"]
