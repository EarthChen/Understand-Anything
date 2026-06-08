#!/usr/bin/env python3
import json
import pytest
from pathlib import Path

import sys
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / 'understand-anything-plugin' / 'skills' / 'understand-business'))
from validate_landscape import validate_landscape


@pytest.fixture
def tmp_landscape(tmp_path):
    bl = tmp_path / '.understand-anything' / 'business-landscape'
    bl.mkdir(parents=True)
    domains_dir = bl / 'domains'
    domains_dir.mkdir()
    return tmp_path, bl


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
