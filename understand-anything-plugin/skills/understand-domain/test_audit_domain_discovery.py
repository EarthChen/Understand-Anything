#!/usr/bin/env python3
"""Smoke tests for audit_domain_discovery.py"""
from __future__ import annotations

import sys
from pathlib import Path

# Ensure the module is importable from this directory
sys.path.insert(0, str(Path(__file__).parent))

from audit_domain_discovery import (
    _extract_entity_nouns,
    _tag_overlap,
    audit_domain_discovery,
)


def test_extract_entity_nouns_basic() -> None:
    nouns = _extract_entity_nouns(["BasicUserLevelDomainRepo", "UserLevelV2DomainRepo"])
    assert "User" in nouns or "Level" in nouns or "Domain" in nouns, f"Expected entity nouns, got {nouns}"


def test_extract_entity_nouns_strips_verbs() -> None:
    nouns = _extract_entity_nouns(["getOrder"])
    assert "Order" in nouns, f"Expected 'Order' after stripping verb prefix, got {nouns}"


def test_extract_entity_nouns_empty() -> None:
    nouns = _extract_entity_nouns([])
    assert nouns == set(), f"Expected empty set, got {nouns}"


def test_tag_overlap_identical() -> None:
    assert _tag_overlap({"a", "b"}, {"a", "b"}) == 1.0


def test_tag_overlap_disjoint() -> None:
    assert _tag_overlap({"a", "b"}, {"c", "d"}) == 0.0


def test_tag_overlap_partial() -> None:
    overlap = _tag_overlap({"a", "b", "c"}, {"b", "c", "d"})
    assert 0.4 < overlap < 0.7, f"Expected ~0.5, got {overlap}"


def test_tag_overlap_empty() -> None:
    assert _tag_overlap(set(), {"a"}) == 0.0
    assert _tag_overlap({"a"}, set()) == 0.0


def test_audit_finds_entity_diversity() -> None:
    discovery = {
        "domains": [{
            "id": "domain:user-mgmt",
            "name": "User Management",
            "modules": ["src/user/level", "src/user/profile", "src/user/wealth"],
        }]
    }
    summary = {
        "modules": [
            {"path": "src/user/level", "tags": ["level", "growth"], "summaries": [], "files": []},
            {"path": "src/user/profile", "tags": ["profile", "identity"], "summaries": [], "files": []},
            {"path": "src/user/wealth", "tags": ["wealth", "charm"], "summaries": [], "files": []},
        ],
        "keyNodes": [
            {"id": "1", "name": "BasicUserLevelDomainRepo", "summary": "", "tags": [], "module": "src/user/level"},
            {"id": "2", "name": "UserProfileDomainRepo", "summary": "", "tags": [], "module": "src/user/profile"},
            {"id": "3", "name": "BasicUserWealCharmServiceImpl", "summary": "", "tags": [], "module": "src/user/wealth"},
            {"id": "4", "name": "LevelRuleV2ConfigProvider", "summary": "", "tags": [], "module": "src/user/level"},
        ],
    }
    result = audit_domain_discovery(discovery, summary)
    assert len(result["warnings"]) > 0, "Expected warnings for entity diversity"
    assert result["shouldRefine"] is True


def test_audit_no_warning_for_coherent_domain() -> None:
    discovery = {
        "domains": [{
            "id": "domain:order",
            "name": "Order Management",
            "modules": ["src/order"],
        }]
    }
    summary = {
        "modules": [
            {"path": "src/order", "tags": ["order", "checkout"], "summaries": [], "files": []},
        ],
        "keyNodes": [
            {"id": "1", "name": "OrderService", "summary": "", "tags": [], "module": "src/order"},
            {"id": "2", "name": "OrderRepository", "summary": "", "tags": [], "module": "src/order"},
        ],
    }
    result = audit_domain_discovery(discovery, summary)
    entity_warnings = [w for w in result["warnings"] if w["type"] == "entity_diversity"]
    assert len(entity_warnings) == 0, f"Expected no entity diversity warnings, got {entity_warnings}"


def test_audit_empty_domains() -> None:
    discovery = {"domains": []}
    summary = {"modules": [], "keyNodes": []}
    result = audit_domain_discovery(discovery, summary)
    assert result["warnings"] == []
    assert result["shouldRefine"] is False


def test_audit_empty_keynodes() -> None:
    discovery = {
        "domains": [{"id": "domain:test", "name": "Test", "modules": ["src/test"]}]
    }
    summary = {
        "modules": [{"path": "src/test", "tags": ["test"], "summaries": [], "files": []}],
        "keyNodes": [],
    }
    result = audit_domain_discovery(discovery, summary)
    assert result["warnings"] == []
    assert result["shouldRefine"] is False


def test_audit_tag_divergence() -> None:
    # Partial overlap (1 shared / 5 total = 0.2) triggers tag divergence
    discovery = {
        "domains": [{
            "id": "domain:mixed",
            "name": "Mixed",
            "modules": ["src/a", "src/b"],
        }]
    }
    summary = {
        "modules": [
            {"path": "src/a", "tags": ["alpha", "beta", "shared"], "summaries": [], "files": []},
            {"path": "src/b", "tags": ["gamma", "delta", "shared"], "summaries": [], "files": []},
        ],
        "keyNodes": [],
    }
    result = audit_domain_discovery(discovery, summary)
    tag_warnings = [w for w in result["warnings"] if w["type"] == "tag_divergence"]
    assert len(tag_warnings) > 0, f"Expected tag divergence warning, got {result['warnings']}"


if __name__ == "__main__":
    tests = [
        test_extract_entity_nouns_basic,
        test_extract_entity_nouns_strips_verbs,
        test_extract_entity_nouns_empty,
        test_tag_overlap_identical,
        test_tag_overlap_disjoint,
        test_tag_overlap_partial,
        test_tag_overlap_empty,
        test_audit_finds_entity_diversity,
        test_audit_no_warning_for_coherent_domain,
        test_audit_empty_domains,
        test_audit_empty_keynodes,
        test_audit_tag_divergence,
    ]
    for t in tests:
        t()
        print(f"  ✓ {t.__name__}")
    print(f"\nAll {len(tests)} tests passed.")
