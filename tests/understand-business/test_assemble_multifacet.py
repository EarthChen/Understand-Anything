"""Multi-facet assembly defects (DEFECT 2/3/4/5).

A feature whose NAME appears in two facets (mobile + frontend) must:
  - produce exactly ONE feature document with one clientLayers[] entry per facet (DEFECT 3);
  - have its shared backend domain carry touchpoints for BOTH facets, so
    capability_review's >=2-facet gate passes (DEFECT 2);
A consolidated feature with NO association record must still appear (DEFECT 4).
A multi-repo frontend feature must preserve ALL repos in units AND platforms (DEFECT 5).

These exercise assemble_features with associations that are self-describing via
the additive `facetType` key produced by association_discovery.
"""
import pytest

from assemble_business_features import assemble_features, _build_feature_document


def _mobile(name, platforms=("ios",)):
    return {
        "name": name,
        "implType": "cross-platform",
        "platforms": list(platforms),
        "deliveryPlatforms": list(platforms),
        "implementations": [
            {"platform": p, "framework": "native", "ref": f"mobile/{p}/..."}
            for p in platforms
        ],
        "mergedSummary": "Mobile impl",
        "facetType": "mobile",
    }


def _frontend(name, repos=("web-app",)):
    return {
        "name": name,
        "implType": "frontend-web",
        "platforms": ["web"],
        "deliveryPlatforms": ["react"],
        "implementations": [{"platform": "web", "repo": r, "ref": f"{r}/src"} for r in repos],
        "mergedSummary": "Frontend impl",
        "facetType": "frontend",
    }


def _assoc(feature_name, domain, facet, supporting=None):
    """An association as produced by association_discovery, now self-describing via facetType."""
    return {
        "featureName": feature_name,
        "primaryServer": {"domain": domain, "service": "svc", "confidence": 0.9},
        "supportingServers": supporting or [],
        "error": None,
        "facetType": facet,
    }


class TestSingleFeatureDocumentPerName:
    def test_name_in_two_facets_yields_exactly_one_document(self):
        # DEFECT 3: two associations (one per facet) for the same name must NOT
        # produce two documents.
        assoc = [
            _assoc("Order Management", "OrderService", "mobile"),
            _assoc("Order Management", "OrderService", "frontend"),
        ]
        consol = {
            "consolidated": [_mobile("Order Management"), _frontend("Order Management")],
            "standalone": [],
        }
        result = assemble_features(assoc, consol)
        docs = [f for f in result["features"] if f["name"] == "Order Management"]
        assert len(docs) == 1, f"expected exactly one document, got {len(docs)}"
        assert result["stats"]["totalFeatures"] == 1

    def test_single_document_has_both_client_layers(self):
        assoc = [
            _assoc("Order Management", "OrderService", "mobile"),
            _assoc("Order Management", "OrderService", "frontend"),
        ]
        consol = {
            "consolidated": [_mobile("Order Management"), _frontend("Order Management")],
            "standalone": [],
        }
        result = assemble_features(assoc, consol)
        feat = result["features"][0]
        facets = {layer["facetType"] for layer in feat["clientLayers"]}
        assert facets == {"mobile", "frontend"}


class TestTouchpointFacetPerAssociation:
    def test_shared_domain_carries_both_facets(self):
        # DEFECT 2: touchpoints for a shared backend domain must reflect EACH
        # association's own facet, not a single first-seen facet.
        assoc = [
            _assoc("Order Management", "OrderService", "mobile"),
            _assoc("Order Management", "OrderService", "frontend"),
        ]
        consol = {
            "consolidated": [_mobile("Order Management"), _frontend("Order Management")],
            "standalone": [],
        }
        result = assemble_features(assoc, consol)
        entry = result["serverIndex"]["OrderService"]
        facets = {t["facet"] for t in entry["touchpoints"]}
        assert facets == {"mobile", "frontend"}, (
            f"capability_review's >=2-facet gate would under-count; got facets={facets}"
        )
        # >=2 touchpoints AND >=2 facets so the LLM capability gate fires.
        assert len(entry["touchpoints"]) >= 2
        assert len(facets) >= 2

    def test_facet_map_fallback_when_association_lacks_facettype(self):
        # Backward compat: an old phase2 association without facetType falls back
        # to facet_map (derived from consolidation).
        assoc = [
            {
                "featureName": "Order Management",
                "primaryServer": {"domain": "OrderService", "service": "svc", "confidence": 0.9},
                "supportingServers": [],
                "error": None,
                # no facetType
            }
        ]
        consol = {"consolidated": [_frontend("Order Management")], "standalone": []}
        result = assemble_features(assoc, consol)
        entry = result["serverIndex"]["OrderService"]
        assert entry["touchpoints"][0]["facet"] == "frontend"


class TestConsolidatedFeatureWithoutAssociation:
    def test_feature_with_no_association_still_appears(self):
        # DEFECT 4: a consolidated feature that has NO association record at all
        # must still become a document.
        assoc = [_assoc("Order Management", "OrderService", "mobile")]
        consol = {
            "consolidated": [
                _mobile("Order Management"),
                _frontend("Design System"),  # no association anywhere
            ],
            "standalone": [],
        }
        result = assemble_features(assoc, consol)
        names = [f["name"] for f in result["features"]]
        assert "Design System" in names
        ds = next(f for f in result["features"] if f["name"] == "Design System")
        assert ds["serverLayer"]["primaryDomain"] is None
        assert ds["clientLayers"][0]["facetType"] == "frontend"


class TestMultiRepoFrontendNonLossy:
    def test_multi_repo_units_preserve_all_repos(self):
        # DEFECT 5 (units half): per-repo units map must keep every repo.
        assoc = [_assoc("Orders", "OrderService", "frontend")]
        consol = {"consolidated": [_frontend("Orders", repos=["web-app", "admin", "portal"])], "standalone": []}
        layer = assemble_features(assoc, consol)["features"][0]["clientLayers"][0]
        assert set(layer["units"].keys()) == {"web-app", "admin", "portal"}

    def test_multi_repo_platforms_preserve_all_repos(self):
        # DEFECT 5 (platforms half): repeated 'web' platform must NOT overwrite —
        # repos aggregate under the single 'web' entry.
        assoc = [_assoc("Orders", "OrderService", "frontend")]
        consol = {"consolidated": [_frontend("Orders", repos=["web-app", "admin", "portal"])], "standalone": []}
        layer = assemble_features(assoc, consol)["features"][0]["clientLayers"][0]
        assert "web" in layer["platforms"]
        repos = layer["platforms"]["web"].get("repos", [])
        assert set(repos) == {"web-app", "admin", "portal"}, (
            f"no repo may be silently dropped; got {repos}"
        )

    def test_mobile_platforms_path_unchanged(self):
        assoc = [_assoc("Orders", "OrderService", "mobile")]
        consol = {"consolidated": [_mobile("Orders", platforms=["ios", "android"])], "standalone": []}
        layer = assemble_features(assoc, consol)["features"][0]["clientLayers"][0]
        assert set(layer["platforms"].keys()) == {"ios", "android"}
        # mobile entries keep their per-platform impl detail (not a repos list)
        assert "framework" in layer["platforms"]["ios"]
