"""association_discovery stamps facetType onto every association (DEFECT 2 root).

discover_associations must propagate each feature's facetType onto:
  - freshly-parsed results,
  - error results,
  - cache-reused results (shallow copy with the CURRENT feature's facetType).
This is additive: existing consumers ignore the key.
"""
import association_discovery as ad


_SERVER_DOMAINS = {
    "OrderService": {"data": {"summary": "orders"}, "endpoints": ["/api/orders"], "service": "order"},
}


def _feature(name, facet):
    return {
        "name": name,
        "implType": "frontend-web",
        "deliveryPlatforms": ["react"],
        "mergedSummary": f"{name} summary",
        "facetType": facet,
    }


def test_parsed_result_carries_feature_facettype(monkeypatch):
    monkeypatch.setattr(
        ad, "_call_llm",
        lambda prompt: '{"primaryServer": {"domain": "OrderService", "service": "order", "confidence": 0.9}, "supportingServers": []}',
    )
    feats = [_feature("Orders", "frontend")]
    results, _, _ = ad.discover_associations(feats, _SERVER_DOMAINS)
    assert results[0]["facetType"] == "frontend"


def test_error_result_carries_feature_facettype(monkeypatch):
    def _boom(prompt):
        raise NotImplementedError("no llm")

    monkeypatch.setattr(ad, "_call_llm", _boom)
    feats = [_feature("Orders", "mobile")]
    results, _, _ = ad.discover_associations(feats, _SERVER_DOMAINS)
    assert results[0]["error"]
    assert results[0]["facetType"] == "mobile"


def test_cache_reused_result_uses_current_feature_facettype(monkeypatch):
    monkeypatch.setattr(
        ad, "_call_llm",
        lambda prompt: '{"primaryServer": {"domain": "OrderService", "service": "order", "confidence": 0.9}, "supportingServers": []}',
    )
    feat = _feature("Orders", "frontend")
    prompt_hash = ad.compute_prompt_hash(feat, _SERVER_DOMAINS)
    # Previous run recorded this feature under a DIFFERENT facet; the reused copy
    # must reflect the current feature's facet, not the stale one.
    previous = [{
        "featureName": "Orders",
        "primaryServer": {"domain": "OrderService", "service": "order", "confidence": 0.9},
        "supportingServers": [],
        "error": None,
        "_promptHash": prompt_hash,
        "facetType": "mobile",
    }]
    results, llm_calls, reused = ad.discover_associations(
        [feat], _SERVER_DOMAINS, previous_results=previous
    )
    assert reused == 1
    assert llm_calls == 0
    assert results[0]["facetType"] == "frontend"
    # must be a copy: previous entry untouched
    assert previous[0]["facetType"] == "mobile"
