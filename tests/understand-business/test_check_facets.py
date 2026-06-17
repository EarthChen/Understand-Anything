#!/usr/bin/env python3
import json
import os
import tempfile
import pytest
from pathlib import Path

from check_facets import check_facets


@pytest.fixture
def tmp_project(tmp_path):
    ua = tmp_path / '.understand-anything'
    ua.mkdir()
    return tmp_path


class TestCheckFacets:
    def test_returns_empty_when_no_system_json(self, tmp_project):
        result = check_facets(str(tmp_project))
        assert result['facets'] == []

    def test_detects_available_backend_facet(self, tmp_project):
        system = {'facets': [{'id': 'server', 'path': 'server/', 'type': 'backend'}]}
        (tmp_project / '.understand-anything' / 'system.json').write_text(json.dumps(system))
        server_ua = tmp_project / 'server' / '.understand-anything'
        server_ua.mkdir(parents=True)
        (server_ua / 'system-graph.json').write_text('{}')
        wiki_dir = server_ua / 'wiki'
        wiki_dir.mkdir()
        (wiki_dir / 'meta.json').write_text('{}')
        result = check_facets(str(tmp_project))
        assert len(result['facets']) == 1
        assert result['facets'][0]['status'] == 'available'

    def test_detects_missing_mobile_facet(self, tmp_project):
        system = {'facets': [{'id': 'client', 'path': 'client/', 'type': 'mobile'}]}
        (tmp_project / '.understand-anything' / 'system.json').write_text(json.dumps(system))
        (tmp_project / 'client').mkdir()
        result = check_facets(str(tmp_project))
        assert len(result['facets']) == 1
        assert result['facets'][0]['status'] == 'missing'

    def test_detects_degraded_facet_wiki_only(self, tmp_project):
        system = {'facets': [{'id': 'server', 'path': 'server/', 'type': 'backend'}]}
        (tmp_project / '.understand-anything' / 'system.json').write_text(json.dumps(system))
        server_ua = tmp_project / 'server' / '.understand-anything'
        wiki_dir = server_ua / 'wiki'
        wiki_dir.mkdir(parents=True)
        (wiki_dir / 'meta.json').write_text('{}')
        result = check_facets(str(tmp_project))
        assert result['facets'][0]['status'] == 'degraded'

    def test_path_traversal_raises(self, tmp_project):
        """Bug H5: A facet path like '../../etc' must be rejected."""
        system = {'facets': [{'id': 'server', 'path': '../../etc', 'type': 'backend'}]}
        (tmp_project / '.understand-anything' / 'system.json').write_text(json.dumps(system))
        with pytest.raises(ValueError, match='escapes project root'):
            check_facets(str(tmp_project))

    def test_writes_facet_status_json(self, tmp_project):
        system = {'facets': [{'id': 'server', 'path': 'server/', 'type': 'backend'}]}
        (tmp_project / '.understand-anything' / 'system.json').write_text(json.dumps(system))
        (tmp_project / 'server').mkdir()
        result = check_facets(str(tmp_project))
        output_path = tmp_project / '.understand-anything' / 'intermediate' / 'facet-status.json'
        assert output_path.exists()
        saved = json.loads(output_path.read_text())
        assert saved == result


class TestFrontendFacet:
    def test_frontend_facet_available_when_graph_and_wiki_exist(self, tmp_project):
        system = {"facets": [{"id": "web", "path": "frontend/", "type": "frontend"}]}
        (tmp_project / ".understand-anything" / "system.json").write_text(json.dumps(system))
        fe_ua = tmp_project / "frontend" / ".understand-anything"
        fe_ua.mkdir(parents=True)
        (fe_ua / "frontend-graph.json").write_text("{}")
        wiki_dir = fe_ua / "wiki"
        wiki_dir.mkdir()
        (wiki_dir / "meta.json").write_text("{}")
        result = check_facets(str(tmp_project))
        assert len(result["facets"]) == 1
        fe = result["facets"][0]
        assert fe["status"] == "available"
        assert fe["hasGraph"] is True

    def test_frontend_facet_degraded_when_wiki_only(self, tmp_project):
        system = {"facets": [{"id": "web", "path": "frontend/", "type": "frontend"}]}
        (tmp_project / ".understand-anything" / "system.json").write_text(json.dumps(system))
        fe_ua = tmp_project / "frontend" / ".understand-anything"
        wiki_dir = fe_ua / "wiki"
        wiki_dir.mkdir(parents=True)
        (wiki_dir / "meta.json").write_text("{}")
        result = check_facets(str(tmp_project))
        assert result["facets"][0]["status"] == "degraded"

    def test_frontend_facet_missing_when_neither_exists(self, tmp_project):
        system = {"facets": [{"id": "web", "path": "frontend/", "type": "frontend"}]}
        (tmp_project / ".understand-anything" / "system.json").write_text(json.dumps(system))
        (tmp_project / "frontend").mkdir()
        result = check_facets(str(tmp_project))
        assert result["facets"][0]["status"] == "missing"
