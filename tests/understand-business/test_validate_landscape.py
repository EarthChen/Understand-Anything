#!/usr/bin/env python3
import json
import pytest
from pathlib import Path

from validate_landscape import validate_landscape


@pytest.fixture
def tmp_landscape(tmp_path):
    bl = tmp_path / '.understand-anything' / 'business-landscape'
    bl.mkdir(parents=True)
    domains_dir = bl / 'domains'
    domains_dir.mkdir()
    return tmp_path, bl


class TestImportFromDifferentCwd:
    """Bug H4: validate_landscape.py must resolve validate_domain via __file__, not cwd."""

    def test_source_has_file_based_path_setup(self):
        """validate_landscape.py must insert its own directory into sys.path
        before importing validate_domain, so the import works regardless of cwd.

        This is a source-level check because Python's import caching makes it
        impractical to test the import failure in-process after the test runner
        has already loaded the module.
        """
        import textwrap
        script = Path(__file__).resolve().parent.parent.parent / 'understand-anything-plugin' / 'skills' / 'understand-business' / 'validate_landscape.py'
        source = script.read_text()
        assert 'os.path.dirname(__file__)' in source or 'Path(__file__).parent' in source, (
            "validate_landscape.py must resolve validate_domain relative to __file__, "
            "not rely on cwd or caller-provided sys.path"
        )


class TestValidateLandscape:
    def test_valid_landscape(self, tmp_landscape):
        root, bl = tmp_landscape
        (bl / 'domains.json').write_text(json.dumps({
            'domains': [{'id': 'domain:order', 'name': 'order', 'summary': 'test', 'facets': ['server'], 'matchType': 'auto-api', 'matchConfidence': 1.0, 'detailRef': 'business-landscape/domains/order.json'}],
            'unmapped': [],
            'stats': {'totalDomains': 1, 'mappedDomains': 1, 'unmappedDomains': 0, 'coverageRate': 1.0}
        }))
        (bl / 'cross-facet-links.json').write_text(json.dumps({
            'links': [{'domain': 'domain:order', 'serverEndpoints': [], 'clientApiCalls': [], 'matchDetails': []}],
            'unmatchedEndpoints': {'server': [], 'client': []}
        }))
        (bl / 'domains' / 'order.json').write_text(json.dumps({
            'id': 'domain:order', 'name': 'order', 'summary': 'test',
            'interactions': [{'id': 'flow:create', 'name': 'create', 'steps': [
                {'id': 'step:1', 'facet': 'server', 'description': 'test', 'after': [], 'terminal': True}
            ]}],
            'businessRules': [], 'facets': {}
        }))
        errors = validate_landscape(str(root))
        assert len(errors) == 0

    def test_missing_domains_json(self, tmp_landscape):
        root, bl = tmp_landscape
        (bl / 'cross-facet-links.json').write_text('{}')
        errors = validate_landscape(str(root))
        assert any('domains.json' in e for e in errors)

    def test_stats_inconsistency(self, tmp_landscape):
        root, bl = tmp_landscape
        (bl / 'domains.json').write_text(json.dumps({
            'domains': [{'id': 'domain:order', 'name': 'order', 'summary': 'test', 'facets': [], 'matchType': 'auto-api', 'matchConfidence': 1.0, 'detailRef': 'business-landscape/domains/order.json'}],
            'unmapped': [],
            'stats': {'totalDomains': 5, 'mappedDomains': 1, 'unmappedDomains': 0, 'coverageRate': 1.0}
        }))
        (bl / 'cross-facet-links.json').write_text(json.dumps({'links': [], 'unmatchedEndpoints': {'server': [], 'client': []}}))
        (bl / 'domains' / 'order.json').write_text(json.dumps({
            'id': 'domain:order', 'name': 'order', 'summary': 'test', 'interactions': [], 'businessRules': [], 'facets': {}
        }))
        errors = validate_landscape(str(root))
        assert any('stats' in e.lower() or 'totalDomains' in e for e in errors)
