import json
import sys
from importlib import import_module
from pathlib import Path

import pytest

SKILL_DIR = Path(__file__).resolve().parent.parent.parent / "understand-anything-plugin" / "skills" / "understand-wiki"
sys.path.insert(0, str(SKILL_DIR))


@pytest.fixture
def verify():
    return import_module("verify-wiki-completeness")


def _write_minimal_wiki(wiki_dir: Path) -> None:
    wiki_dir.mkdir(parents=True, exist_ok=True)
    (wiki_dir / "service.json").write_text('{"name": "test"}', encoding="utf-8")
    (wiki_dir / "index.json").write_text(json.dumps({"entries": []}), encoding="utf-8")
    domains_dir = wiki_dir / "domains"
    domains_dir.mkdir(exist_ok=True)
    (domains_dir / "order.json").write_text('{"id": "order"}', encoding="utf-8")


def test_corrupt_meta_json_reports_error(tmp_path, verify):
    """verify-wiki-completeness should report error on corrupt JSON, not crash."""
    wiki_dir = tmp_path / ".understand-anything" / "wiki"
    _write_minimal_wiki(wiki_dir)
    (wiki_dir / "meta.json").write_text("{corrupt", encoding="utf-8")

    errors, warnings = verify.check_service_wiki(tmp_path, "monorepo")
    assert any("meta.json" in e.lower() or "invalid" in e.lower() for e in errors)


def test_corrupt_domain_graph_reports_error(tmp_path, verify):
    """Corrupt domain-graph.json should be reported, not crash domain checks."""
    wiki_dir = tmp_path / ".understand-anything" / "wiki"
    _write_minimal_wiki(wiki_dir)
    (wiki_dir / "meta.json").write_text(json.dumps({"generatedAt": "2024-01-01"}), encoding="utf-8")
    dg_path = tmp_path / ".understand-anything" / "domain-graph.json"
    dg_path.parent.mkdir(parents=True, exist_ok=True)
    dg_path.write_text("{bad json", encoding="utf-8")

    errors, warnings = verify.check_service_wiki(tmp_path, "monorepo")
    assert any("domain-graph.json" in e.lower() or "invalid" in e.lower() for e in errors)


def test_exit_code_2_for_warnings_only(tmp_path, verify, monkeypatch):
    """Exit code 2 when there are warnings but no errors."""
    wiki_dir = tmp_path / ".understand-anything" / "wiki"
    wiki_dir.mkdir(parents=True)
    (wiki_dir / "service.json").write_text('{"name": "test"}', encoding="utf-8")
    (wiki_dir / "meta.json").write_text(json.dumps({"generatedAt": "2024-01-01"}), encoding="utf-8")
    (wiki_dir / "index.json").write_text(json.dumps({"entries": []}), encoding="utf-8")
    # No domain files = warning but not error (domains_dir missing triggers error actually)

    monkeypatch.setattr(
        sys,
        "argv",
        ["verify-wiki-completeness.py", str(tmp_path), "--mode=single", "--repo-type=backend"],
    )
    # Low coverage triggers warning when meta is valid
    (wiki_dir / "meta.json").write_text(
        json.dumps({"sourceRefCoverage": {"coveragePercent": 50}}),
        encoding="utf-8",
    )
    domains_dir = wiki_dir / "domains"
    domains_dir.mkdir(exist_ok=True)
    (domains_dir / "order.json").write_text('{"id": "order"}', encoding="utf-8")

    assert verify.main() == 2


def test_frontend_batch_missing_frontend_graph_is_error(tmp_path, verify):
    """Batch mode with --repo-type=frontend should require frontend-graph.json."""
    wiki_dir = tmp_path / ".understand-anything" / "wiki"
    wiki_dir.mkdir(parents=True)
    for f in ("index.json", "meta.json", "overview.json", "architecture.json"):
        (wiki_dir / f).write_text('{"name": "test"}', encoding="utf-8")
    # No frontend-graph.json present

    errors, warnings = verify.check_parent_wiki(tmp_path, "frontend")
    assert any("frontend-graph.json" in e for e in errors)


def test_frontend_batch_passes_when_graph_exists(tmp_path, verify):
    """Batch mode with --repo-type=frontend should pass when frontend-graph.json exists."""
    wiki_dir = tmp_path / ".understand-anything" / "wiki"
    wiki_dir.mkdir(parents=True)
    for f in ("index.json", "meta.json", "overview.json", "architecture.json"):
        (wiki_dir / f).write_text('{"name": "test"}', encoding="utf-8")
    # Write cross-service-relationships.json to satisfy that check
    (tmp_path / ".understand-anything" / "cross-service-relationships.json").write_text("[]")
    # Write frontend-graph.json
    (tmp_path / ".understand-anything" / "frontend-graph.json").write_text(
        '{"facetType": "frontend"}', encoding="utf-8"
    )

    errors, _ = verify.check_parent_wiki(tmp_path, "frontend")
    assert not any("frontend-graph.json" in e for e in errors)
