import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from assemble_business_features import assemble_features


def _fe(name, project):
    return {"name": name, "implType": "frontend-web", "platforms": ["web"],
            "deliveryPlatforms": ["react"],
            "implementations": [{"platform": "web", "repo": project}],
            "mergedSummary": "", "facetType": "frontend", "project": project,
            "sourceRepos": [project]}


def _mob(name):
    return {"name": name, "implType": "native", "platforms": ["ios"],
            "deliveryPlatforms": ["ios"],
            "implementations": [{"platform": "ios", "repo": "app-ios"}],
            "mergedSummary": "", "facetType": "mobile", "project": None}


def _assoc(name, facet, project, domain):
    return {"featureName": name, "facetType": facet, "project": project,
            "primaryServer": {"domain": domain, "service": "svc", "confidence": 0.9},
            "supportingServers": [], "error": None}


def test_no_collision_frontend_and_mobile_merge():
    consolidation = {"consolidated": [_fe("订单", "seller-portal"), _mob("订单")],
                     "standalone": [], "infrastructure": []}
    associations = [_assoc("订单", "frontend", "seller-portal", "orders"),
                    _assoc("订单", "mobile", None, "orders")]
    result = assemble_features(associations, consolidation)
    feats = result["features"]
    assert len(feats) == 1
    facet_types = sorted(cl["facetType"] for cl in feats[0]["clientLayers"])
    assert facet_types == ["frontend", "mobile"]


def test_two_frontend_projects_split():
    consolidation = {"consolidated": [_fe("订单", "seller-portal"), _fe("订单", "buyer-web")],
                     "standalone": [], "infrastructure": []}
    associations = [_assoc("订单", "frontend", "seller-portal", "seller-orders"),
                    _assoc("订单", "frontend", "buyer-web", "buyer-orders")]
    result = assemble_features(associations, consolidation)
    feats = result["features"]
    assert len(feats) == 2
    assert {f["project"] for f in feats} == {"seller-portal", "buyer-web"}
    assert {f["id"] for f in feats} == {"feature:订单@seller-portal", "feature:订单@buyer-web"}


def test_three_way_collision_splits_to_three():
    consolidation = {"consolidated": [_fe("订单", "seller-portal"), _fe("订单", "buyer-web"), _mob("订单")],
                     "standalone": [], "infrastructure": []}
    associations = [_assoc("订单", "frontend", "seller-portal", "seller-orders"),
                    _assoc("订单", "frontend", "buyer-web", "buyer-orders"),
                    _assoc("订单", "mobile", None, "orders")]
    result = assemble_features(associations, consolidation)
    feats = result["features"]
    assert len(feats) == 3
    mobile_docs = [f for f in feats if any(cl["facetType"] == "mobile" for cl in f["clientLayers"])]
    assert len(mobile_docs) == 1


def test_serverindex_touchpoints_carry_project():
    consolidation = {"consolidated": [_fe("订单", "seller-portal"), _fe("订单", "buyer-web")],
                     "standalone": [], "infrastructure": []}
    associations = [_assoc("订单", "frontend", "seller-portal", "seller-orders"),
                    _assoc("订单", "frontend", "buyer-web", "buyer-orders")]
    result = assemble_features(associations, consolidation)
    tps = result["serverIndex"]["seller-orders"]["touchpoints"]
    assert tps[0]["project"] == "seller-portal"


def _fe_canonical(name):
    # A frontend merge-group canonical feature: spans projects, so project is None.
    return {"name": name, "implType": "frontend-web", "platforms": ["web"],
            "deliveryPlatforms": ["react"],
            "implementations": [{"platform": "web", "repo": "seller-portal"},
                                {"platform": "web", "repo": "ops-web"}],
            "mergedSummary": "", "facetType": "frontend", "project": None,
            "sourceRepos": ["seller-portal", "ops-web"]}


def test_canonical_frontend_not_dropped_when_colliding_with_splits():
    # A project=None canonical "订单" coexisting with two per-project "订单" features
    # (different projects) must NOT be dropped: expect 3 frontend business features.
    consolidation = {"consolidated": [
        _fe("订单", "alpha-web"), _fe("订单", "beta-web"), _fe_canonical("订单"),
    ], "standalone": [], "infrastructure": []}
    associations = [
        _assoc("订单", "frontend", "alpha-web", "alpha-orders"),
        _assoc("订单", "frontend", "beta-web", "beta-orders"),
        _assoc("订单", "frontend", None, "shared-orders"),
    ]
    result = assemble_features(associations, consolidation)
    feats = result["features"]
    assert len(feats) == 3
    ids = {f["id"] for f in feats}
    assert "feature:订单@alpha-web" in ids
    assert "feature:订单@beta-web" in ids
    assert "feature:订单" in ids  # the canonical, project=None
