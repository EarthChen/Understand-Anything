import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from assemble_business_features import _build_feature_document


def test_raw_web_facettype_is_treated_as_frontend():
    # A feature_data with a raw 'web' facetType (alias) must aggregate per-repo like
    # 'frontend' (multiple web implementations under one 'web' platform entry), not be
    # mis-handled as a non-frontend facet.
    fd = {
        "name": "订单", "facetType": "web", "implType": "frontend-web",
        "deliveryPlatforms": ["react"],
        "implementations": [
            {"platform": "web", "repo": "seller-portal"},
            {"platform": "web", "repo": "ops-web"},
        ],
        "mergedSummary": "",
    }
    doc = _build_feature_document([fd], {})
    layer = doc["clientLayers"][0]
    # Frontend aggregation keeps all repos under the single 'web' platform entry.
    assert sorted(layer["platforms"]["web"]["repos"]) == ["ops-web", "seller-portal"]
