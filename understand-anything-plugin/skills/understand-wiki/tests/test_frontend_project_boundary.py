import importlib.util
import sys
from pathlib import Path

SKILL_DIR = Path(__file__).resolve().parent.parent
if str(SKILL_DIR) not in sys.path:
    sys.path.insert(0, str(SKILL_DIR))


def _import_skill_module(filename: str):
    path = SKILL_DIR / filename
    module_name = filename.replace("-", "_").removesuffix(".py")
    spec = importlib.util.spec_from_file_location(module_name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


bfg = _import_skill_module("build-frontend-graph.py")


def _repo(name, feats):
    return {"name": name, "features": feats}


def _feat(fid, name, **kw):
    base = {"id": fid, "name": name, "sourceDomain": fid.replace("feature:", "domain:"),
            "routes": [], "pages": [], "components": [], "stateStores": [],
            "apiCalls": [], "uiRules": [], "interactionRules": [],
            "stateTransitions": [], "apiSequence": []}
    base.update(kw)
    return base


def test_same_name_across_projects_not_merged():
    per_repo = [
        _repo("seller-portal", [_feat("feature:订单", "订单", routes=["/s/orders"])]),
        _repo("buyer-web", [_feat("feature:订单", "订单", routes=["/b/orders"])]),
    ]
    features, domain_links = bfg._aggregate_features(per_repo, merge_groups=[])
    names_projects = sorted((f["name"], f["project"]) for f in features)
    assert names_projects == [("订单", "buyer-web"), ("订单", "seller-portal")]
    assert all(len(f["sourceRepos"]) == 1 for f in features)
    assert domain_links == []
    ids = [f["id"] for f in features]
    assert "feature:buyer-web:订单" in ids
    assert "feature:seller-portal:订单" in ids


def test_explicit_merge_group_merges():
    per_repo = [
        _repo("seller-portal", [_feat("feature:订单", "订单", routes=["/s/orders"])]),
        _repo("ops-web", [_feat("feature:订单管理", "订单管理", routes=["/ops/orders"])]),
    ]
    groups = [{"canonicalName": "订单", "members": [
        {"project": "seller-portal", "feature": "订单"},
        {"project": "ops-web", "feature": "订单管理"},
    ]}]
    features, domain_links = bfg._aggregate_features(per_repo, merge_groups=groups)
    merged = [f for f in features if f["name"] == "订单"]
    assert len(merged) == 1
    assert sorted(merged[0]["sourceRepos"]) == ["ops-web", "seller-portal"]
    assert sorted(merged[0]["routes"]) == ["/ops/orders", "/s/orders"]
    assert len(domain_links) == 1
    assert domain_links[0]["canonicalFeature"] == "订单"


def test_merge_group_with_one_missing_member_falls_back_to_per_project():
    per_repo = [
        _repo("seller-portal", [_feat("feature:订单", "订单", routes=["/s/orders"])]),
    ]
    groups = [{"canonicalName": "订单", "members": [
        {"project": "seller-portal", "feature": "订单"},
        {"project": "ops-web", "feature": "订单管理"},  # not present
    ]}]
    features, domain_links = bfg._aggregate_features(per_repo, merge_groups=groups)
    assert len(features) == 1
    assert features[0]["id"] == "feature:seller-portal:订单"
    assert features[0]["project"] == "seller-portal"
    assert domain_links == []
