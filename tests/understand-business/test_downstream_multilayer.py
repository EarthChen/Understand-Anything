"""Downstream post-processors must handle the plural clientLayers[] array.

assemble_business_features now emits one feature document per feature NAME with a
clientLayers[] array (one entry per facet) PLUS a backward-compat singular
clientLayer == clientLayers[0]. Three downstream steps were written before
clientLayers[] existed and only looked at the singular clientLayer (== layer 0):

  - detect_platforms.enrich_standard_platforms  (adds standardPlatform)
  - enrich_wiki_refs.enrich_wiki_refs            (adds wikiRef/flowCount)
  - build_feature_interactions.build_interaction_*  (builds flow docs)

DEFECT 6 — clientLayer / clientLayers[0] diverge on disk: enrichers re-read the
file with json.load so the singular and plural[0] become SEPARATE objects, then
mutate only the singular and write back, breaking clientLayer == clientLayers[0].

DEFECT 7 — secondary clientLayers[1:] never enriched: consumers read only layer 0,
so the second facet of a merged feature gets no standardPlatform / wikiRef /
interaction representation.

The common single-facet case must remain byte-identical.
"""
import json

import pytest

from detect_platforms import enrich_standard_platforms
from enrich_wiki_refs import enrich_wiki_refs
from build_feature_interactions import (
    build_interaction_skeleton,
    build_interaction_prompt,
)


# --------------------------------------------------------------------------- #
# Fixtures: on-disk project with system.json + business-features.json          #
# --------------------------------------------------------------------------- #
def _write_project(tmp_path, features):
    """Write a minimal .understand-anything/ project tree and return its root."""
    ua_dir = tmp_path / ".understand-anything"
    ua_dir.mkdir()
    (ua_dir / "system.json").write_text(
        json.dumps(
            {
                "facets": [
                    {
                        "type": "mobile",
                        "path": "mobile",
                        "subPaths": ["Amar", "ddoversea"],
                        "platformMapping": {"ios": "Amar", "android": "ddoversea"},
                    }
                ]
            }
        )
    )
    bl_dir = ua_dir / "business-landscape"
    bl_dir.mkdir()
    features_path = bl_dir / "business-features.json"
    features_path.write_text(
        json.dumps(
            {
                "features": features,
                "serverIndex": {},
                "stats": {
                    "totalFeatures": len(features),
                    "withServerAssociation": 0,
                    "serverDomainsReferenced": 0,
                },
            },
            ensure_ascii=False,
        )
    )
    return str(tmp_path), features_path


def _two_facet_feature():
    """A feature merged across mobile + frontend facets.

    clientLayer must equal clientLayers[0] (mobile) on input.
    """
    mobile_layer = {
        "facetType": "mobile",
        "implType": "cross-platform",
        "platforms": {
            "Amar": {"domainName": "直播", "wikiRef": None},
            "ddoversea": {"domainName": "语音房", "wikiRef": None},
        },
        "deliveryPlatforms": ["Amar", "ddoversea"],
        "summary": "Mobile voice room",
    }
    frontend_layer = {
        "facetType": "frontend",
        "implType": "frontend-web",
        "platforms": {
            "web": {"repos": ["web-app"], "domainName": "Web 直播"},
        },
        "deliveryPlatforms": ["react"],
        "summary": "Web voice room",
    }
    return {
        "id": "feature:voice-room",
        "name": "语聊房",
        "clientLayers": [mobile_layer, frontend_layer],
        "clientLayer": mobile_layer,  # == clientLayers[0]
        "serverLayer": {"primaryDomain": None, "supportingDomains": []},
    }


def _single_facet_feature():
    """A common single-facet (mobile) feature."""
    layer = {
        "facetType": "mobile",
        "implType": "cross-platform",
        "platforms": {
            "Amar": {"domainName": "直播", "wikiRef": None},
            "ddoversea": {"domainName": "语音房", "wikiRef": None},
        },
        "deliveryPlatforms": ["Amar", "ddoversea"],
        "summary": "Mobile only",
    }
    return {
        "id": "feature:single",
        "name": "单端功能",
        "clientLayers": [layer],
        "clientLayer": layer,
        "serverLayer": {"primaryDomain": None, "supportingDomains": []},
    }


# --------------------------------------------------------------------------- #
# (a) enrich_standard_platforms — invariant + secondary layer                  #
# --------------------------------------------------------------------------- #
class TestEnrichStandardPlatformsMultiLayer:
    def test_invariant_holds_on_disk_after_enrich(self, tmp_path):
        """DEFECT 6: clientLayer and clientLayers[0] must AGREE on disk."""
        root, features_path = _write_project(tmp_path, [_two_facet_feature()])

        enrich_standard_platforms(root)

        saved = json.loads(features_path.read_text())
        feat = saved["features"][0]
        # singular carries standardPlatform...
        assert feat["clientLayer"]["platforms"]["Amar"]["standardPlatform"] == "ios"
        # ...and plural[0] must carry it too (invariant: clientLayer == clientLayers[0])
        assert (
            feat["clientLayers"][0]["platforms"]["Amar"]["standardPlatform"] == "ios"
        ), "clientLayers[0] diverged from clientLayer on disk (DEFECT 6)"
        assert feat["clientLayer"] == feat["clientLayers"][0]

    def test_secondary_layer_is_enriched(self, tmp_path):
        """DEFECT 7: a frontend secondary layer that names a mapped repo gets enriched."""
        feature = _two_facet_feature()
        # Give the frontend (secondary) layer a platform key that maps to a standard.
        feature["clientLayers"][1]["platforms"] = {
            "Amar": {"domainName": "Web 直播", "wikiRef": None},
        }
        root, features_path = _write_project(tmp_path, [feature])

        enrich_standard_platforms(root)

        saved = json.loads(features_path.read_text())
        frontend_layer = saved["features"][0]["clientLayers"][1]
        assert (
            frontend_layer["platforms"]["Amar"]["standardPlatform"] == "ios"
        ), "secondary clientLayers[1] was never enriched (DEFECT 7)"

    def test_frontend_web_platform_does_not_crash(self, tmp_path):
        """A {'web': {'repos': [...]}} entry is simply skipped (repo not in mapping)."""
        root, features_path = _write_project(tmp_path, [_two_facet_feature()])

        enrich_standard_platforms(root)  # must not raise

        saved = json.loads(features_path.read_text())
        web = saved["features"][0]["clientLayers"][1]["platforms"]["web"]
        assert "standardPlatform" not in web

    def test_single_facet_unchanged(self, tmp_path):
        """Single-facet output must be identical to the layer-0-only behaviour."""
        root, features_path = _write_project(tmp_path, [_single_facet_feature()])

        enrich_standard_platforms(root)

        saved = json.loads(features_path.read_text())
        feat = saved["features"][0]
        platforms = feat["clientLayer"]["platforms"]
        assert platforms["Amar"]["standardPlatform"] == "ios"
        assert platforms["ddoversea"]["standardPlatform"] == "android"
        assert feat["clientLayer"] == feat["clientLayers"][0]


# --------------------------------------------------------------------------- #
# enrich_wiki_refs — secondary layer + invariant                               #
# --------------------------------------------------------------------------- #
class TestEnrichWikiRefsMultiLayer:
    def _project_with_wiki(self, tmp_path, feature):
        """Build a project where both Amar and ddoversea have a matching wiki page."""
        root, features_path = _write_project(tmp_path, [feature])
        for platform_name, domain_id in (("Amar", "live"), ("ddoversea", "voice")):
            wiki_dir = (
                tmp_path
                / "mobile"
                / platform_name
                / ".understand-anything"
                / "wiki"
                / "domains"
            )
            wiki_dir.mkdir(parents=True)
            (wiki_dir / f"{domain_id}.json").write_text(
                json.dumps({"name": "dom", "flows": [{"id": "f1"}]})
            )
        return root, features_path

    def test_secondary_layer_wiki_enriched_and_invariant(self, tmp_path):
        """DEFECT 6+7: secondary layer gets wikiRef AND clientLayer==clientLayers[0]."""
        feature = _two_facet_feature()
        # layer 0 (mobile) Amar resolves via domainId; layer 1 (frontend) reuses Amar
        feature["clientLayers"][0]["platforms"]["Amar"]["domainId"] = "live"
        feature["clientLayers"][1]["platforms"] = {
            "Amar": {"domainName": "Web", "domainId": "live"},
        }
        root, features_path = self._project_with_wiki(tmp_path, feature)

        enrich_wiki_refs(root)

        saved = json.loads(features_path.read_text())
        feat = saved["features"][0]
        # invariant preserved on disk
        assert feat["clientLayer"] == feat["clientLayers"][0]
        assert feat["clientLayer"]["platforms"]["Amar"]["wikiRef"] is not None
        # secondary layer enriched (DEFECT 7)
        assert (
            feat["clientLayers"][1]["platforms"]["Amar"]["wikiRef"] is not None
        ), "secondary clientLayers[1] wikiRef was never resolved (DEFECT 7)"

    def test_single_facet_wiki_unchanged(self, tmp_path):
        feature = _single_facet_feature()
        feature["clientLayers"][0]["platforms"]["Amar"]["domainId"] = "live"
        root, features_path = self._project_with_wiki(tmp_path, feature)

        result = enrich_wiki_refs(root)

        saved = json.loads(features_path.read_text())
        feat = saved["features"][0]
        assert feat["clientLayer"]["platforms"]["Amar"]["wikiRef"] is not None
        assert feat["clientLayer"] == feat["clientLayers"][0]
        assert result["enriched"] >= 1


# --------------------------------------------------------------------------- #
# (b) build_interaction_* — union across facets                                #
# --------------------------------------------------------------------------- #
class TestBuildInteractionMultiLayer:
    def test_skeleton_includes_both_facet_platforms(self):
        """DEFECT 7: client layer must union platforms across ALL clientLayers."""
        skeleton = build_interaction_skeleton(_two_facet_feature())
        client_layer = skeleton["layers"][0]
        assert client_layer["name"] == "client"
        names = set(client_layer["platforms"])
        assert {"Amar", "ddoversea"} <= names  # facet 0
        assert "web" in names, "frontend facet's 'web' platform was dropped (DEFECT 7)"

    def test_prompt_includes_both_facet_platforms(self):
        feature = _two_facet_feature()
        skeleton = build_interaction_skeleton(feature)
        prompt = build_interaction_prompt(feature, skeleton)
        assert "Amar" in prompt
        assert "web" in prompt

    def test_single_facet_skeleton_unchanged(self):
        feature = _single_facet_feature()
        skeleton = build_interaction_skeleton(feature)
        client_layer = skeleton["layers"][0]
        assert set(client_layer["platforms"]) == {"Amar", "ddoversea"}
