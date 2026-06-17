"""Mobile-only backward-compat guard: business-features.json additions are
additive only — no legacy key removed or renamed (Spec 2 test 14)."""
import pytest

from assemble_business_features import assemble_features

LEGACY_FEATURE_KEYS = {"id", "name", "clientLayers", "clientLayer", "serverLayer"}
LEGACY_LAYER_KEYS = {"facetType", "implType", "platforms", "deliveryPlatforms", "summary"}
LEGACY_SERVERINDEX_KEYS = {"features", "refCount", "service"}
LEGACY_STATS_KEYS = {"totalFeatures", "withServerAssociation", "serverDomainsReferenced"}

# 'project' is an intentional additive field: business features are now identified
# per frontend project (see frontend project-boundary design).
ADDITIVE_FEATURE_KEYS = {"project"}
ADDITIVE_LAYER_KEYS = {"units"}          # Task 3
ADDITIVE_SERVERINDEX_KEYS = {"touchpoints"}  # Task 3 (capability is added later by capability_review)


def _mobile_only():
    associations = [
        {"featureName": "即时通讯",
         "primaryServer": {"domain": "Cosmos IM", "service": "im", "confidence": 0.9},
         "supportingServers": [{"domain": "推送", "service": "push", "relationship": "calls", "confidence": 0.8}],
         "error": None},
        {"featureName": "苹果支付",
         "primaryServer": {"domain": "支付账户", "service": "pay", "confidence": 0.9},
         "supportingServers": [], "error": None},
    ]
    consolidation = {
        "consolidated": [{
            "name": "即时通讯", "implType": "cross-platform",
            "platforms": ["ios", "android"], "deliveryPlatforms": ["ios", "android"],
            "implementations": [
                {"platform": "ios", "domainName": "IM", "domainId": "im", "summary": "iOS IM"},
                {"platform": "android", "domainName": "IM", "domainId": "im", "summary": "Android IM"},
            ],
            "mergedSummary": "[ios] iOS IM [android] Android IM", "facetType": "mobile",
        }],
        "standalone": [
            {"name": "苹果支付", "platform": "ios", "domainId": "pay",
             "implType": "native-specific", "deliveryPlatforms": ["ios"], "facetType": "mobile"},
        ],
        "infrastructure": [],
    }
    return associations, consolidation


def test_feature_keys_are_additive_only():
    associations, consolidation = _mobile_only()
    result = assemble_features(associations, consolidation)
    for feat in result["features"]:
        extra = set(feat.keys()) - LEGACY_FEATURE_KEYS
        assert extra <= ADDITIVE_FEATURE_KEYS, f"unexpected feature keys: {extra}"
        assert LEGACY_FEATURE_KEYS <= set(feat.keys())


def test_client_layer_keys_are_additive_only():
    associations, consolidation = _mobile_only()
    result = assemble_features(associations, consolidation)
    for feat in result["features"]:
        for layer in feat["clientLayers"]:
            extra = set(layer.keys()) - LEGACY_LAYER_KEYS
            assert extra <= ADDITIVE_LAYER_KEYS, f"unexpected layer keys: {extra}"
            assert LEGACY_LAYER_KEYS <= set(layer.keys())


def test_serverindex_keys_are_additive_only():
    associations, consolidation = _mobile_only()
    result = assemble_features(associations, consolidation)
    for domain, entry in result["serverIndex"].items():
        extra = set(entry.keys()) - LEGACY_SERVERINDEX_KEYS
        assert extra <= ADDITIVE_SERVERINDEX_KEYS, f"unexpected serverIndex keys: {extra}"
        assert LEGACY_SERVERINDEX_KEYS <= set(entry.keys())


def test_stats_keys_unchanged():
    associations, consolidation = _mobile_only()
    result = assemble_features(associations, consolidation)
    assert set(result["stats"].keys()) == LEGACY_STATS_KEYS


def test_all_mobile_touchpoints_have_mobile_facet():
    associations, consolidation = _mobile_only()
    result = assemble_features(associations, consolidation)
    for entry in result["serverIndex"].values():
        for tp in entry["touchpoints"]:
            assert tp["facet"] == "mobile"
