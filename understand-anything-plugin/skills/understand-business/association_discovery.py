#!/usr/bin/env python3
"""Phase 2 alternative: Association Discovery for client×server scenarios.

Instead of N×M pairwise "same domain?" questions, asks N per-feature queries:
"Which server domains does this client feature depend on?"

This reduces LLM calls from O(N×M) to O(N) and produces M:N associations
that correctly model the consumer-provider relationship.

Usage:
    python3 association_discovery.py <project-root>

Reads:
    <project-root>/.understand-anything/intermediate/phase1-matches.json
    (for consolidation data in .consolidated field)

Output:
    <project-root>/.understand-anything/intermediate/phase2-associations.json
"""
import hashlib
import json
import sys
from pathlib import Path

MIN_CONFIDENCE_DEFAULT = 0.5


def compute_prompt_hash(feature: dict, server_domains: dict) -> str:
    """Compute a stable hash of the LLM prompt inputs for change detection.

    Covers feature metadata + sorted server domain summaries/endpoints.
    If hash matches previous run, LLM call can be skipped.
    """
    key_parts = [
        feature.get('name', ''),
        feature.get('implType', ''),
        json.dumps(sorted(feature.get('deliveryPlatforms', [])), ensure_ascii=False),
        feature.get('mergedSummary', ''),
    ]
    for name in sorted(server_domains.keys()):
        info = server_domains[name]
        key_parts.append(name)
        key_parts.append(info.get('data', {}).get('summary', '')[:120])
        key_parts.append(','.join((info.get('endpoints', []) or [])[:3]))
    raw = '\n'.join(key_parts)
    return hashlib.sha256(raw.encode()).hexdigest()[:16]


def build_discovery_prompt(feature: dict, server_domains: dict, max_summary_len: int = 120) -> str:
    """Build an LLM prompt asking which server domains a client feature depends on."""
    server_list = []
    for name, info in server_domains.items():
        summary = info.get('data', {}).get('summary', '')
        if len(summary) > max_summary_len:
            summary = summary[:max_summary_len] + '...'
        endpoints = info.get('endpoints', [])
        service = info.get('service', '')
        ep_str = ', '.join(endpoints[:3]) if endpoints else 'N/A'
        server_list.append(f"  - {name} (service: {service})\n    Summary: {summary}\n    Endpoints: {ep_str}")

    server_block = '\n'.join(server_list)

    return f"""以下是一个客户端业务功能:
功能名: {feature.get('name', 'unknown')}
实现类型: {feature.get('implType', 'unknown')}
覆盖平台: {', '.join(feature.get('deliveryPlatforms', []))}
描述: {feature.get('mergedSummary', '')}

以下是后端所有业务域的摘要:
{server_block}

请判断这个客户端功能会调用/依赖哪些后端域。
返回严格 JSON 格式:
{{
  "primaryServer": {{"domain": "<最主要的后端域名>", "service": "<服务名>", "confidence": 0.0-1.0}},
  "supportingServers": [
    {{"domain": "<辅助后端域名>", "service": "<服务名>", "relationship": "calls|depends_on|displays", "confidence": 0.0-1.0}}
  ]
}}

规则:
- primaryServer 是该功能最核心依赖的后端域(若无明确依赖则设为 null)
- supportingServers 列出所有辅助依赖
- confidence 基于业务逻辑的关联程度
- relationship: calls=直接API调用, depends_on=间接依赖, displays=展示其数据"""


def _extract_json(text: str) -> str:
    """Strip markdown fences if LLM wraps JSON in ```json blocks."""
    import re
    match = re.search(r'```(?:json)?\s*\n?(.*?)\n?```', text, re.DOTALL)
    if match:
        return match.group(1).strip()
    # Fallback: find first { to last }
    start = text.find('{')
    end = text.rfind('}')
    if start != -1 and end != -1 and end > start:
        return text[start:end + 1]
    return text


def parse_discovery_response(
    response: str,
    feature_name: str,
    min_confidence: float = MIN_CONFIDENCE_DEFAULT,
    valid_domains: set | None = None,
) -> dict:
    """Parse LLM response into structured association result."""
    cleaned = _extract_json(response)
    try:
        data = json.loads(cleaned)
    except (json.JSONDecodeError, TypeError):
        return {
            'featureName': feature_name,
            'primaryServer': None,
            'supportingServers': [],
            'error': 'Invalid JSON response',
        }

    primary = data.get('primaryServer')
    supporting = data.get('supportingServers', []) or []

    if not isinstance(supporting, list):
        supporting = []

    def _safe_confidence(val) -> float:
        try:
            return float(val) if val is not None else 0.0
        except (TypeError, ValueError):
            return 0.0

    # Validate and filter primary server
    if primary and isinstance(primary, dict):
        if _safe_confidence(primary.get('confidence')) < min_confidence:
            primary = None
        elif valid_domains and primary.get('domain') not in valid_domains:
            primary = None
    else:
        primary = None

    # Filter supporting servers by confidence and domain validity
    filtered_supporting = []
    for s in supporting:
        if not isinstance(s, dict):
            continue
        if _safe_confidence(s.get('confidence')) < min_confidence:
            continue
        if valid_domains and s.get('domain') not in valid_domains:
            continue
        filtered_supporting.append(s)

    return {
        'featureName': feature_name,
        'primaryServer': primary,
        'supportingServers': filtered_supporting,
        'error': None,
    }


def _call_llm(prompt: str) -> str:
    """Placeholder for LLM call. Overridden in tests, replaced by actual LLM in production."""
    raise NotImplementedError(
        "LLM call not configured. In production, this is replaced by the agent's LLM."
    )


def discover_associations(
    features: list,
    server_domains: dict,
    min_confidence: float = MIN_CONFIDENCE_DEFAULT,
    previous_results: list | None = None,
) -> tuple[list, int, int]:
    """Run association discovery with incremental support.

    Args:
        features: List of consolidated client features from Phase 1a.
        server_domains: Dict of server domain name → {data, endpoints, service}.
        min_confidence: Minimum confidence threshold for supporting servers.
        previous_results: Previous association results for cache comparison.

    Returns:
        Tuple of (results, llm_calls, reused_count).
    """
    results = []
    valid_domain_names = set(server_domains.keys())

    prev_by_name: dict[str, dict] = {}
    if previous_results:
        for r in previous_results:
            fname = r.get('featureName', '')
            if fname and r.get('_promptHash') and not r.get('error'):
                prev_by_name[fname] = r

    llm_calls = 0
    reused = 0

    for feature in features:
        feature_name = feature.get('name', 'unknown')
        prompt_hash = compute_prompt_hash(feature, server_domains)

        prev = prev_by_name.get(feature_name)
        if prev and prev.get('_promptHash') == prompt_hash:
            results.append(prev)
            reused += 1
            continue

        prompt = build_discovery_prompt(feature, server_domains)
        try:
            response = _call_llm(prompt)
            llm_calls += 1
        except (NotImplementedError, RuntimeError, OSError) as e:
            results.append({
                'featureName': feature_name,
                'primaryServer': None,
                'supportingServers': [],
                'error': str(e),
                '_promptHash': prompt_hash,
            })
            continue

        result = parse_discovery_response(
            response, feature_name, min_confidence, valid_domain_names
        )
        result['_promptHash'] = prompt_hash
        results.append(result)

    return results, llm_calls, reused


def to_phase3_format(associations: list) -> list:
    """Transform association results into Phase 3 compatible flat format.

    Phase 3 (assemble_landscape.py) expects:
      {server_domain, client_domain, confidence, relationship, matchType}
    """
    flat = []
    for assoc in associations:
        if assoc.get('error'):
            continue
        feature_name = assoc.get('featureName', '')
        primary = assoc.get('primaryServer')
        if primary and isinstance(primary, dict):
            flat.append({
                'server_domain': primary.get('domain', ''),
                'client_domain': feature_name,
                'confidence': primary.get('confidence', 0),
                'relationship': 'primary',
                'matchType': 'llm-association',
            })
        for s in assoc.get('supportingServers', []):
            flat.append({
                'server_domain': s.get('domain', ''),
                'client_domain': feature_name,
                'confidence': s.get('confidence', 0),
                'relationship': s.get('relationship', 'depends_on'),
                'matchType': 'llm-association',
            })
    return flat


def _load_frontend_features(project_root_str: str, facet: dict) -> list:
    """Load features from frontend-graph.json for a frontend facet."""
    project_root = Path(project_root_str).resolve()
    fg_path = (
        project_root / facet.get('path', '') /
        '.understand-anything' / 'frontend-graph.json'
    ).resolve()
    if not fg_path.is_relative_to(project_root):
        return []
    if not fg_path.exists():
        return []
    try:
        fg = json.loads(fg_path.read_text(encoding='utf-8'))
    except (json.JSONDecodeError, OSError):
        return []

    frameworks = fg.get('project', {}).get('frameworks', [])
    features = []
    for feat in fg.get('features', []):
        routes = feat.get('routes', [])
        calls = feat.get('apiCalls', [])
        summary_parts = []
        if routes:
            summary_parts.append('Routes: ' + ', '.join(routes[:3]))
        if calls:
            summary_parts.append('API: ' + ', '.join(
                f"{c.get('method', 'UNKNOWN')} {c.get('path', '')}" for c in calls[:3]
            ))
        features.append({
            'name': feat.get('name', ''),
            'implType': 'frontend-web',
            'platforms': ['web'],
            'deliveryPlatforms': frameworks,
            'mergedSummary': '. '.join(summary_parts),
        })
    return features


def run_association_discovery(project_root_str: str) -> dict:
    """Full pipeline: load data, run discovery, write output."""
    project_root = Path(project_root_str)
    intermediate_dir = project_root / '.understand-anything' / 'intermediate'

    system_path = project_root / '.understand-anything' / 'system.json'
    if not system_path.exists():
        return {'error': 'system.json not found'}

    try:
        system_config = json.loads(system_path.read_text())
    except (json.JSONDecodeError, IOError) as e:
        return {'error': f'Failed to parse system.json: {e}'}

    from domain_matcher import _load_server_domains, _consolidate_mobile_domains
    from scenario_detector import CLIENT_FACET_TYPES

    server_facet = None
    client_facets = []
    for facet in system_config.get('facets', []):
        ftype = facet.get('type', '')
        if ftype in ('server', 'backend') and server_facet is None:
            server_facet = facet
        elif ftype in CLIENT_FACET_TYPES:
            client_facets.append(facet)

    if not server_facet:
        return {'error': 'Missing server facet'}
    if not client_facets:
        return {'error': 'Missing client facet(s)'}

    server_domains = _load_server_domains(
        project_root_str, server_facet['path'], server_facet.get('subPaths', [])
    )

    # Consolidate features from all client facets
    all_features = []
    unsupported_facets = []
    for client_facet in client_facets:
        if client_facet.get('type') == 'mobile':
            consolidation = _consolidate_mobile_domains(
                project_root_str, client_facet['path'], client_facet.get('subPaths', [])
            )
            all_features.extend(consolidation['consolidated'])
            all_features.extend([
                {'name': d['name'], 'implType': d['implType'],
                 'platforms': [d['platform']], 'deliveryPlatforms': d['deliveryPlatforms'],
                 'mergedSummary': d.get('summary', '')}
                for d in consolidation['standalone']
            ])
        elif client_facet.get('type') == 'frontend':
            fe_features = _load_frontend_features(project_root_str, client_facet)
            all_features.extend(fe_features)
        else:
            unsupported_facets.append(client_facet.get('name', client_facet.get('type')))

    previous_results = None
    prev_path = intermediate_dir / 'phase2-associations.json'
    if prev_path.exists():
        try:
            prev_data = json.loads(prev_path.read_text())
            previous_results = prev_data.get('associations')
        except (json.JSONDecodeError, IOError):
            pass

    output = {
        'associations': [],
        'phase3_compatible': [],
        'featureCount': len(all_features),
        'serverDomainCount': len(server_domains),
        'llmCalls': 0,
        'reusedFromCache': 0,
        'unsupportedFacets': unsupported_facets,
    }

    if all_features:
        results, llm_calls, reused = discover_associations(
            all_features, server_domains,
            previous_results=previous_results,
        )
        output['associations'] = results
        output['phase3_compatible'] = to_phase3_format(results)
        output['llmCalls'] = llm_calls
        output['reusedFromCache'] = reused

    intermediate_dir.mkdir(parents=True, exist_ok=True)
    (intermediate_dir / 'phase2-associations.json').write_text(
        json.dumps(output, indent=2, ensure_ascii=False)
    )

    return output


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print('Usage: python3 association_discovery.py <project-root>', file=sys.stderr)
        sys.exit(1)
    result = run_association_discovery(sys.argv[1])
    if 'error' in result:
        print(f"ERROR: {result['error']}", file=sys.stderr)
        sys.exit(1)
    total = result['featureCount']
    reused = result.get('reusedFromCache', 0)
    llm = result.get('llmCalls', 0)
    print(f"Associations: {len(result['associations'])} features → {result['serverDomainCount']} server domains")
    print(f"LLM calls: {llm}, reused: {reused}/{total}")
