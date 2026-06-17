import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
import facets
import scenario_detector
import client_facets
import assemble_business_features as abf


def test_role_sets_are_the_registry_objects():
    # Consumers import the registry's sets, not private copies.
    assert scenario_detector.CLIENT_FACET_TYPES is facets.CLIENT_FACET_TYPES
    assert scenario_detector.SERVER_FACET_TYPES is facets.SERVER_FACET_TYPES
    assert abf._FRONTEND_FACETS is facets.FRONTEND_FACET_TYPES


def test_every_supported_client_type_has_a_strategy():
    for ftype, meta in facets.FACET_REGISTRY.items():
        if meta["role"] == "client" and meta["supported"]:
            assert ftype in client_facets.CLIENT_STRATEGIES, ftype
        if meta["role"] == "client" and not meta["supported"]:
            assert ftype not in client_facets.CLIENT_STRATEGIES, ftype


def test_every_supported_type_has_graph_file():
    for ftype, meta in facets.FACET_REGISTRY.items():
        if meta["supported"]:
            assert meta["graph_file"], ftype


def test_platform_union_matches_schema_enum():
    schema = json.loads(
        (Path(__file__).parent.parent / "schemas" / "system.schema.json").read_text()
    )
    enum = set(schema["definitions"]["service"]["properties"]["platform"]["enum"])
    assert facets.ALL_PLATFORMS == enum
