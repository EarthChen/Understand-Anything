import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
import assemble_business_features as abf
from facets import FRONTEND_FACET_TYPES


def test_frontend_facets_constant_comes_from_registry():
    assert abf._FRONTEND_FACETS == FRONTEND_FACET_TYPES
