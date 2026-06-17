import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
import association_discovery as ad


def test_same_name_two_projects_do_not_share_cache(monkeypatch):
    server_domains = {"orders": {"data": {"summary": "orders"}, "endpoints": [], "service": "svc"}}
    features = [
        {"name": "订单", "facetType": "frontend", "project": "seller-portal",
         "implType": "frontend-web", "deliveryPlatforms": ["web"], "mergedSummary": "seller"},
        {"name": "订单", "facetType": "frontend", "project": "buyer-web",
         "implType": "frontend-web", "deliveryPlatforms": ["web"], "mergedSummary": "buyer"},
    ]
    # Previous run only cached seller-portal's result.
    previous = [{
        "featureName": "订单", "facetType": "frontend", "project": "seller-portal",
        "primaryServer": {"domain": "orders", "service": "svc", "confidence": 0.9},
        "supportingServers": [], "error": None,
        "_promptHash": ad.compute_prompt_hash(features[0], server_domains),
    }]

    calls = {"n": 0}

    def fake_llm(prompt):
        calls["n"] += 1
        return '{"primaryServer": {"domain": "orders", "service": "svc", "confidence": 0.8}, "supportingServers": []}'

    monkeypatch.setattr(ad, "_call_llm", fake_llm)
    results, llm_calls, reused = ad.discover_associations(features, server_domains, previous_results=previous)

    # seller-portal reused from cache; buyer-web must NOT reuse seller's cache → 1 live call.
    assert reused == 1
    assert llm_calls == 1
    projects = sorted(r["project"] for r in results)
    assert projects == ["buyer-web", "seller-portal"]
