#!/usr/bin/env python3
import json
import pytest
from pathlib import Path

import sys
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / 'understand-anything-plugin' / 'skills' / 'understand-business'))
from domain_matcher import match_domains, _normalize_name, _match_by_api, _match_by_name


class TestNormalizeName:
    def test_lowercase(self):
        assert _normalize_name('Order-Management') == 'order_management'

    def test_hyphens_to_underscores(self):
        assert _normalize_name('order-management') == 'order_management'

    def test_spaces_to_underscores(self):
        assert _normalize_name('order management') == 'order_management'

    def test_chinese_preserved(self):
        assert _normalize_name('订单管理') == '订单管理'


class TestMatchByApi:
    def test_exact_path_match(self):
        server_domains = {
            'order-management': {
                'endpoints': ['POST /api/orders', 'GET /api/orders/{id}']
            }
        }
        client_domains = {
            '下单流程': {
                'api_calls': ['POST /api/orders']
            }
        }
        matches = _match_by_api(server_domains, client_domains)
        assert len(matches) == 1
        assert matches[0]['canonical'] == 'order-management'
        assert matches[0]['client'] == ['下单流程']

    def test_no_match_different_paths(self):
        server_domains = {
            'order-management': {'endpoints': ['POST /api/orders']}
        }
        client_domains = {
            'user-profile': {'api_calls': ['GET /api/users/me']}
        }
        matches = _match_by_api(server_domains, client_domains)
        assert len(matches) == 0

    def test_one_client_multiple_server_domains(self):
        server_domains = {
            'order-management': {'endpoints': ['POST /api/orders']},
            'payment': {'endpoints': ['POST /api/payments']},
        }
        client_domains = {
            'checkout': {'api_calls': ['POST /api/orders', 'POST /api/payments']}
        }
        matches = _match_by_api(server_domains, client_domains)
        assert len(matches) == 2


class TestMatchByName:
    def test_exact_name_match(self):
        server = {'order-management': {}}
        client = {'order-management': {}}
        matches = _match_by_name(server, client, already_matched_server=set(), already_matched_client=set())
        assert len(matches) == 1

    def test_normalized_name_match(self):
        server = {'order-management': {}}
        client = {'order_management': {}}
        matches = _match_by_name(server, client, already_matched_server=set(), already_matched_client=set())
        assert len(matches) == 1

    def test_skips_already_matched(self):
        server = {'order-management': {}}
        client = {'order-management': {}}
        matches = _match_by_name(server, client, already_matched_server={'order-management'}, already_matched_client=set())
        assert len(matches) == 0


class TestMatchDomains:
    def test_full_pipeline(self, tmp_path):
        server_wiki = tmp_path / 'server' / '.understand-anything' / 'wiki' / 'domains'
        server_wiki.mkdir(parents=True)
        (server_wiki / 'order-management.json').write_text(json.dumps({
            'id': 'domain:order-management',
            'name': 'order-management',
            'summary': 'Order management domain',
            'integrationPoints': {
                'inbound': [{'endpoint': 'POST /api/orders', 'type': 'REST'}]
            }
        }))

        client_wiki = tmp_path / 'client' / 'android' / '.understand-anything' / 'wiki' / 'domains'
        client_wiki.mkdir(parents=True)
        (client_wiki / 'order.json').write_text(json.dumps({
            'id': 'domain:order',
            'name': 'order-management',
            'summary': 'Order screen',
        }))

        client_kg = tmp_path / 'client' / 'android' / '.understand-anything'
        (client_kg / 'knowledge-graph.json').write_text(json.dumps({
            'nodes': [],
            'edges': [
                {'source': 'function:OrderRepo.kt:createOrder', 'target': 'endpoint:OrderRepo.kt:POST /api/orders', 'type': 'consumes_api'}
            ]
        }))

        system = {
            'facets': [
                {'id': 'server', 'path': 'server/', 'type': 'backend'},
                {'id': 'client', 'path': 'client/', 'type': 'mobile', 'subPaths': ['android/']}
            ]
        }

        result = match_domains(str(tmp_path), system)
        assert len(result['matched']) >= 1
        assert result['matched'][0]['matchType'] in ('auto-api', 'auto-name')
