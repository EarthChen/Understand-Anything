"""serverIndex touchpoints + clientLayers[].units (Spec 2 Component 3, tests 7-9)."""
import pytest

from assemble_business_features import assemble_features, _merge_server_associations


def _assoc(feature_name, primary, supporting=None, facet=None):
    a = {
        "featureName": feature_name,
        "primaryServer": primary,
        "supportingServers": supporting or [],
        "error": None,
    }
    if facet is not None:
        a["facetType"] = facet
    return a


def _frontend(name, repos):
    return {
        "name": name, "implType": "frontend-web", "platforms": ["web"],
        "deliveryPlatforms": ["react"],
        "implementations": [{"platform": "web", "repo": r} for r in repos],
        "mergedSummary": f"Routes: /{name}", "facetType": "frontend",
        "sourceRepos": repos,
    }


def _mobile(name, platforms):
    return {
        "name": name, "implType": "cross-platform", "platforms": platforms,
        "deliveryPlatforms": platforms,
        "implementations": [{"platform": p, "domainName": name, "domainId": name, "summary": ""} for p in platforms],
        "mergedSummary": "", "facetType": "mobile",
    }


class TestTouchpoints:
    def test_shared_domain_gets_two_touchpoints_with_facet_and_role(self):
        assoc = [
            _assoc("下单创建", {"domain": "OrderService", "service": "order", "confidence": 0.9}),
            _assoc("订单跟踪", {"domain": "OrderService", "service": "order", "confidence": 0.9}),
        ]
        consol = {
            "consolidated": [_frontend("下单创建", ["web-app"]), _mobile("订单跟踪", ["ios"])],
            "standalone": [],
        }
        result = assemble_features(assoc, consol)
        entry = result["serverIndex"]["OrderService"]
        tps = {(t["feature"], t["facet"], t["role"]) for t in entry["touchpoints"]}
        assert tps == {("下单创建", "frontend", "primary"), ("订单跟踪", "mobile", "primary")}

    def test_complementary_split_groups_under_shared_domain(self):
        # web "下单创建" → primary Order; mobile "订单跟踪" → primary Order + supporting Push.
        assoc = [
            _assoc("下单创建", {"domain": "OrderService", "service": "order", "confidence": 0.9}),
            _assoc("订单跟踪", {"domain": "OrderService", "service": "order", "confidence": 0.9},
                   supporting=[{"domain": "PushService", "service": "push",
                                "relationship": "calls", "confidence": 0.8}]),
        ]
        consol = {
            "consolidated": [_frontend("下单创建", ["web-app"]), _mobile("订单跟踪", ["ios"])],
            "standalone": [],
        }
        result = assemble_features(assoc, consol)
        order_features = {t["feature"] for t in result["serverIndex"]["OrderService"]["touchpoints"]}
        assert order_features == {"下单创建", "订单跟踪"}
        push = result["serverIndex"]["PushService"]
        assert push["touchpoints"][0] == {"feature": "订单跟踪", "facet": "mobile", "role": "supporting"}

    def test_legacy_serverindex_fields_retained(self):
        assoc = [_assoc("下单创建", {"domain": "OrderService", "service": "order", "confidence": 0.9})]
        consol = {"consolidated": [_frontend("下单创建", ["web-app"])], "standalone": []}
        entry = assemble_features(assoc, consol)["serverIndex"]["OrderService"]
        assert entry["features"] == ["下单创建"]
        assert entry["refCount"] == 1
        assert entry["service"] == "order"

    def test_unknown_feature_facet_is_unknown(self):
        # association references a feature not present in consolidation.
        assoc = [_assoc("Ghost", {"domain": "OrderService", "service": "order", "confidence": 0.9})]
        consol = {"consolidated": [], "standalone": []}
        entry = assemble_features(assoc, consol)["serverIndex"]["OrderService"]
        assert entry["touchpoints"][0]["facet"] == "unknown"

    def test_merge_server_associations_default_facet_map(self):
        # Called with one positional arg (as the pre-existing tests do) → facet "unknown", no crash.
        index = _merge_server_associations([_assoc("X", {"domain": "D", "service": "s", "confidence": 0.9})])
        assert index["D"]["touchpoints"][0]["facet"] == "unknown"
        assert index["D"]["refCount"] == 1

    def test_multifacet_primary_dedups_features_and_refcount_not_touchpoints(self):
        # FIX 1: one feature NAME with two associations (mobile + frontend), both
        # primaryServer → the SAME domain. features/refCount must dedup (it is ONE
        # feature), but BOTH per-facet touchpoints must be recorded so
        # capability_review's >=2-facet gate still fires.
        assoc = [
            _assoc("Order Management",
                   {"domain": "OrderService", "service": "order", "confidence": 0.9},
                   facet="mobile"),
            _assoc("Order Management",
                   {"domain": "OrderService", "service": "order", "confidence": 0.9},
                   facet="frontend"),
        ]
        entry = _merge_server_associations(assoc)["OrderService"]
        assert entry["refCount"] == 1
        assert entry["features"] == ["Order Management"]
        assert len(entry["touchpoints"]) == 2
        facets = {t["facet"] for t in entry["touchpoints"]}
        assert facets == {"mobile", "frontend"}
        assert all(t["role"] == "primary" for t in entry["touchpoints"])


class TestClientLayerUnits:
    def test_web_units_keyed_by_repos(self):
        assoc = [_assoc("Orders", {"domain": "OrderService", "service": "order", "confidence": 0.9})]
        consol = {"consolidated": [_frontend("Orders", ["web-app", "admin"])], "standalone": []}
        layer = assemble_features(assoc, consol)["features"][0]["clientLayers"][0]
        assert set(layer["units"].keys()) == {"web-app", "admin"}

    def test_mobile_units_keyed_by_platforms(self):
        assoc = [_assoc("Orders", {"domain": "OrderService", "service": "order", "confidence": 0.9})]
        consol = {"consolidated": [_mobile("Orders", ["ios", "android"])], "standalone": []}
        layer = assemble_features(assoc, consol)["features"][0]["clientLayers"][0]
        assert set(layer["units"].keys()) == {"ios", "android"}

    def test_platforms_dict_still_present(self):
        assoc = [_assoc("Orders", {"domain": "OrderService", "service": "order", "confidence": 0.9})]
        consol = {"consolidated": [_mobile("Orders", ["ios"])], "standalone": []}
        layer = assemble_features(assoc, consol)["features"][0]["clientLayers"][0]
        assert "ios" in layer["platforms"]
        assert "units" in layer
