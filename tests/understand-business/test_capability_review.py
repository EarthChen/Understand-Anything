"""Bounded LLM capability review (Spec 2 Component 4, tests 10-13)."""
import json
from pathlib import Path

import pytest

import capability_review
from capability_review import (
    run_capability_review,
    parse_review_response,
    build_review_prompt,
)


def _write_business_features(root: Path, server_index: dict):
    out = root / ".understand-anything" / "business-landscape"
    out.mkdir(parents=True, exist_ok=True)
    data = {"features": [], "serverIndex": server_index, "stats": {}}
    (out / "business-features.json").write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    return out / "business-features.json"


def _multi_facet_index():
    return {
        "OrderService": {
            "features": ["下单创建", "订单跟踪"], "refCount": 2, "service": "order",
            "touchpoints": [
                {"feature": "下单创建", "facet": "frontend", "role": "primary"},
                {"feature": "订单跟踪", "facet": "mobile", "role": "primary"},
            ],
        }
    }


@pytest.fixture(autouse=True)
def _restore_llm():
    """Each test may monkeypatch _call_llm; restore the placeholder afterwards."""
    original = capability_review._call_llm
    yield
    capability_review._call_llm = original


class TestParseReviewResponse:
    def test_valid_response_parsed(self):
        resp = json.dumps({"label": "订单管理", "relationship": "complementary-split",
                           "summary": "web 创建;mobile 跟踪", "flagged": []})
        result = parse_review_response(resp, "OrderService")
        assert result["label"] == "订单管理"
        assert result["relationship"] == "complementary-split"
        assert result["summary"]

    def test_shared_infrastructure_keeps_domain_name_as_label(self):
        resp = json.dumps({"label": "登录", "relationship": "shared-infrastructure", "summary": "共享鉴权"})
        result = parse_review_response(resp, "AuthService")
        assert result["label"] == "AuthService"  # must NOT assert one capability
        assert result["relationship"] == "shared-infrastructure"

    def test_malformed_response_degrades(self):
        result = parse_review_response("not json at all", "OrderService")
        assert result["label"] == "OrderService"
        assert result["relationship"] == "unknown"

    def test_unknown_relationship_normalized(self):
        resp = json.dumps({"label": "X", "relationship": "made-up", "summary": ""})
        assert parse_review_response(resp, "D")["relationship"] == "unknown"


class TestRunCapabilityReview:
    def test_multi_facet_domain_enriched_by_llm(self, tmp_path):
        bf = _write_business_features(tmp_path, _multi_facet_index())
        capability_review._call_llm = lambda prompt: json.dumps({
            "label": "订单管理", "relationship": "complementary-split",
            "summary": "web 创建;mobile 跟踪", "flagged": [],
        })
        run_capability_review(str(tmp_path))
        data = json.loads(bf.read_text(encoding="utf-8"))
        cap = data["serverIndex"]["OrderService"]["capability"]
        assert cap == {"label": "订单管理", "relationship": "complementary-split",
                       "summary": "web 创建;mobile 跟踪"}

    def test_no_llm_degrades_to_mechanical(self, tmp_path):
        bf = _write_business_features(tmp_path, _multi_facet_index())
        # default _call_llm raises NotImplementedError → mechanical fallback
        run_capability_review(str(tmp_path))
        cap = json.loads(bf.read_text(encoding="utf-8"))["serverIndex"]["OrderService"]["capability"]
        assert cap["label"] == "OrderService"
        assert cap["relationship"] == "unknown"

    def test_single_facet_domain_skips_llm(self, tmp_path):
        index = {
            "AuthService": {
                "features": ["登录", "登出"], "refCount": 2, "service": "auth",
                "touchpoints": [
                    {"feature": "登录", "facet": "mobile", "role": "primary"},
                    {"feature": "登出", "facet": "mobile", "role": "primary"},
                ],
            }
        }
        bf = _write_business_features(tmp_path, index)
        calls = []
        capability_review._call_llm = lambda prompt: calls.append(prompt) or "{}"
        run_capability_review(str(tmp_path))
        assert calls == []  # single-facet → no LLM cost
        cap = json.loads(bf.read_text(encoding="utf-8"))["serverIndex"]["AuthService"]["capability"]
        assert cap["label"] == "AuthService"
        assert cap["relationship"] == "unknown"

    def test_flagged_touchpoint_annotated_not_deleted(self, tmp_path):
        bf = _write_business_features(tmp_path, _multi_facet_index())
        capability_review._call_llm = lambda prompt: json.dumps({
            "label": "订单管理", "relationship": "complementary-split", "summary": "x",
            "flagged": [{"feature": "订单跟踪", "reason": "weak association"}],
        })
        run_capability_review(str(tmp_path))
        tps = json.loads(bf.read_text(encoding="utf-8"))["serverIndex"]["OrderService"]["touchpoints"]
        assert len(tps) == 2  # nothing deleted
        flagged = next(t for t in tps if t["feature"] == "订单跟踪")
        assert flagged["flagged"]["reason"] == "weak association"

    def test_caching_skips_unchanged_domain(self, tmp_path):
        bf = _write_business_features(tmp_path, _multi_facet_index())
        calls = []
        capability_review._call_llm = lambda prompt: calls.append(1) or json.dumps(
            {"label": "订单管理", "relationship": "complementary-split", "summary": "x", "flagged": []})
        run_capability_review(str(tmp_path))   # first run → 1 LLM call
        run_capability_review(str(tmp_path))   # second run → unchanged → reuse, no call
        assert len(calls) == 1

    def test_missing_business_features_returns_error(self, tmp_path):
        result = run_capability_review(str(tmp_path))
        assert "error" in result

    def test_stale_flag_cleared_when_regrouping_unflags(self, tmp_path):
        bf = _write_business_features(tmp_path, _multi_facet_index())
        # Run 1: LLM flags 订单跟踪.
        capability_review._call_llm = lambda prompt: json.dumps({
            "label": "订单管理", "relationship": "complementary-split", "summary": "x",
            "flagged": [{"feature": "订单跟踪", "reason": "weak"}]})
        run_capability_review(str(tmp_path))
        # Change the grouping (append a touchpoint → hash changes); LLM now flags nothing.
        data = json.loads(bf.read_text(encoding="utf-8"))
        data["serverIndex"]["OrderService"]["touchpoints"].append(
            {"feature": "退款", "facet": "frontend", "role": "supporting"})
        bf.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
        capability_review._call_llm = lambda prompt: json.dumps({
            "label": "订单管理", "relationship": "complementary-split", "summary": "x", "flagged": []})
        run_capability_review(str(tmp_path))
        tps = json.loads(bf.read_text(encoding="utf-8"))["serverIndex"]["OrderService"]["touchpoints"]
        tracking = next(t for t in tps if t["feature"] == "订单跟踪")
        assert "flagged" not in tracking  # stale flag cleared on re-review

    def test_unexpected_llm_exception_degrades_gracefully(self, tmp_path):
        bf = _write_business_features(tmp_path, _multi_facet_index())
        def boom(prompt):
            raise ValueError("unexpected provider error")
        capability_review._call_llm = boom
        result = run_capability_review(str(tmp_path))  # must NOT raise
        cap = json.loads(bf.read_text(encoding="utf-8"))["serverIndex"]["OrderService"]["capability"]
        assert cap["relationship"] == "unknown"  # mechanical fallback

    def test_llm_failure_does_not_poison_cache_and_is_retried_on_recovery(self, tmp_path):
        # DEFECT 1: an LLM failure must NOT persist _capabilityHash, so a later run
        # (working LLM, unchanged grouping) re-attempts the review instead of reusing.
        bf = _write_business_features(tmp_path, _multi_facet_index())

        def boom(prompt):
            raise ValueError("provider down")
        capability_review._call_llm = boom
        run1 = run_capability_review(str(tmp_path))  # degrade
        assert run1["mechanical"] == 1
        assert run1["reused"] == 0
        entry = json.loads(bf.read_text(encoding="utf-8"))["serverIndex"]["OrderService"]
        # The failure path must not poison the cache.
        assert "_capabilityHash" not in entry

        # Run 2: LLM recovers, grouping unchanged → must re-review, not reuse.
        calls = []
        capability_review._call_llm = lambda prompt: calls.append(1) or json.dumps({
            "label": "订单管理", "relationship": "complementary-split",
            "summary": "web 创建;mobile 跟踪", "flagged": []})
        run2 = run_capability_review(str(tmp_path))
        assert calls == [1]  # LLM actually re-invoked
        assert run2["reviewed"] == 1
        assert run2["reused"] == 0
        cap = json.loads(bf.read_text(encoding="utf-8"))["serverIndex"]["OrderService"]["capability"]
        assert cap["relationship"] == "complementary-split"

    def test_mechanical_by_gate_path_still_caches(self, tmp_path):
        # DEFECT 1 distinction: a domain that misses the gate (single facet) is
        # deterministic and SHOULD remain cached → reused on rerun.
        index = {
            "AuthService": {
                "features": ["登录", "登出"], "refCount": 2, "service": "auth",
                "touchpoints": [
                    {"feature": "登录", "facet": "mobile", "role": "primary"},
                    {"feature": "登出", "facet": "mobile", "role": "primary"},
                ],
            }
        }
        bf = _write_business_features(tmp_path, index)
        run1 = run_capability_review(str(tmp_path))
        assert run1["mechanical"] == 1
        entry = json.loads(bf.read_text(encoding="utf-8"))["serverIndex"]["AuthService"]
        assert "_capabilityHash" in entry  # gate-mechanical path caches the hash
        run2 = run_capability_review(str(tmp_path))
        assert run2["reused"] == 1
        assert run2["mechanical"] == 0

    def test_missing_facet_does_not_inflate_gate(self, tmp_path):
        # DEFECT 2: a touchpoint with no 'facet' must not count as a second facet.
        index = {
            "MixedService": {
                "features": ["登录", "杂项"], "refCount": 2, "service": "mixed",
                "touchpoints": [
                    {"feature": "登录", "facet": "mobile", "role": "primary"},
                    {"feature": "杂项", "role": "primary"},  # no 'facet' key
                ],
            }
        }
        bf = _write_business_features(tmp_path, index)
        calls = []
        capability_review._call_llm = lambda prompt: calls.append(prompt) or "{}"
        result = run_capability_review(str(tmp_path))
        assert calls == []  # single genuine facet → no LLM call
        assert result["mechanical"] == 1
        assert result["reviewed"] == 0
        cap = json.loads(bf.read_text(encoding="utf-8"))["serverIndex"]["MixedService"]["capability"]
        assert cap["relationship"] == "unknown"

    def test_flag_with_no_feature_does_not_tag_featureless_touchpoint(self, tmp_path):
        # DEFECT 3: a malformed flag with no 'feature' must not match a featureless touchpoint.
        index = {
            "OrderService": {
                "features": ["下单创建"], "refCount": 2, "service": "order",
                "touchpoints": [
                    {"feature": "下单创建", "facet": "frontend", "role": "primary"},
                    {"facet": "mobile", "role": "primary"},  # no 'feature' key
                ],
            }
        }
        bf = _write_business_features(tmp_path, index)
        capability_review._call_llm = lambda prompt: json.dumps({
            "label": "订单管理", "relationship": "complementary-split", "summary": "x",
            "flagged": [{"reason": "malformed, no feature"}]})  # flag missing 'feature'
        run_capability_review(str(tmp_path))
        tps = json.loads(bf.read_text(encoding="utf-8"))["serverIndex"]["OrderService"]["touchpoints"]
        featureless = next(t for t in tps if "feature" not in t)
        assert "flagged" not in featureless  # must NOT be tagged by the empty-feature flag


class TestBuildReviewPrompt:
    def test_prompt_mentions_domain_and_touchpoints(self):
        prompt = build_review_prompt("OrderService", "order", [
            {"feature": "下单创建", "facet": "frontend", "role": "primary"},
        ])
        assert "OrderService" in prompt
        assert "下单创建" in prompt
