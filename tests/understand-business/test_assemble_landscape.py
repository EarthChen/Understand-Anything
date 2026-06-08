#!/usr/bin/env python3
import json
import pytest

from assemble_landscape import assemble_landscape


@pytest.fixture
def tmp_project(tmp_path):
    intermediate = tmp_path / '.understand-anything' / 'intermediate'
    intermediate.mkdir(parents=True)
    return tmp_path


class TestAssembleLandscape:
    def test_generates_domains_json(self, tmp_project):
        matches = {
            'matched': [
                {'canonical': 'order-management', 'server': ['order-management'], 'client': ['下单'], 'matchType': 'auto-api', 'confidence': 1.0}
            ],
            'candidates': []
        }
        intermediate = tmp_project / '.understand-anything' / 'intermediate'
        (intermediate / 'phase1-matches.json').write_text(json.dumps(matches))

        result = assemble_landscape(str(tmp_project))
        domains_path = intermediate / 'domains.json'
        assert domains_path.exists()
        domains = json.loads(domains_path.read_text())
        assert len(domains['domains']) == 1
        assert domains['stats']['totalDomains'] == 1

    def test_includes_unmapped_domains(self, tmp_project):
        matches = {
            'matched': [],
            'candidates': [
                {'server': 'user-mgmt', 'client': 'profile', 'reason': 'no match'}
            ]
        }
        llm_match = {'match': False, 'confidence': 0.3, 'reason': 'different domains', '_checkpoint': {'status': 'complete'}}
        intermediate = tmp_project / '.understand-anything' / 'intermediate'
        (intermediate / 'phase1-matches.json').write_text(json.dumps(matches))
        (intermediate / 'match-user-mgmt-profile.json').write_text(json.dumps(llm_match))

        result = assemble_landscape(str(tmp_project))
        domains = json.loads((intermediate / 'domains.json').read_text())
        assert len(domains['unmapped']) >= 1

    def test_generates_cross_facet_links(self, tmp_project):
        matches = {
            'matched': [
                {'canonical': 'order-management', 'server': ['order-management'], 'client': ['下单'], 'matchType': 'auto-api', 'confidence': 1.0}
            ],
            'candidates': []
        }
        intermediate = tmp_project / '.understand-anything' / 'intermediate'
        (intermediate / 'phase1-matches.json').write_text(json.dumps(matches))

        result = assemble_landscape(str(tmp_project))
        links_path = intermediate / 'cross-facet-links.json'
        assert links_path.exists()

    def test_updates_domain_mapping(self, tmp_project):
        matches = {
            'matched': [
                {'canonical': 'order-management', 'server': ['order-management'], 'client': ['下单'], 'matchType': 'auto-api', 'confidence': 1.0}
            ],
            'candidates': []
        }
        intermediate = tmp_project / '.understand-anything' / 'intermediate'
        (intermediate / 'phase1-matches.json').write_text(json.dumps(matches))

        assemble_landscape(str(tmp_project))
        mapping_path = tmp_project / '.understand-anything' / 'domain-mapping.json'
        assert mapping_path.exists()
        mapping = json.loads(mapping_path.read_text())
        assert len(mapping['mappings']) == 1
