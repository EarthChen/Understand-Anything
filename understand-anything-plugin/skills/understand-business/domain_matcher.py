#!/usr/bin/env python3
"""Phase 1: Deterministic domain matching across facets.

Three-layer matching (all deterministic, no LLM):
  Layer 1a: API endpoint exact match (client API call path == server endpoint path)
  Layer 1b: Domain name exact match (case-insensitive, normalized punctuation)
  Layer 1c: Manual mapping from domain-mapping.json

Unmatched pairs → candidates[] for Phase 2 LLM verification.

Usage:
    python3 domain_matcher.py <project-root>

Output:
    <project-root>/.understand-anything/intermediate/phase1-matches.json
"""
import json
import sys
from pathlib import Path


def _normalize_name(name):
    return name.lower().replace('-', '_').replace(' ', '_')


def _load_server_domains(project_root, server_path):
    facet_dir = (Path(project_root) / server_path).resolve()
    if not facet_dir.is_relative_to(Path(project_root).resolve()):
        raise ValueError(f"Path escapes project root: {server_path}")
    wiki_dir = facet_dir / '.understand-anything' / 'wiki' / 'domains'
    domains = {}
    if not wiki_dir.exists():
        return domains
    for f in wiki_dir.glob('*.json'):
        try:
            data = json.loads(f.read_text())
            name = data.get('name', f.stem)
            endpoints = []
            ip = data.get('integrationPoints', {})
            for entry in ip.get('inbound', []):
                ep = entry.get('endpoint', '')
                if ep:
                    endpoints.append(ep)
            domains[name] = {'data': data, 'endpoints': endpoints, 'file': str(f)}
        except (json.JSONDecodeError, IOError):
            continue
    return domains


def _load_client_domains(project_root, client_path, sub_paths):
    domains = {}
    facet_dir = (Path(project_root) / client_path).resolve()
    if not facet_dir.is_relative_to(Path(project_root).resolve()):
        raise ValueError(f"Path escapes project root: {client_path}")
    root = facet_dir
    for sp in sub_paths:
        platform = sp.rstrip('/')
        wiki_dir = root / platform / '.understand-anything' / 'wiki' / 'domains'
        kg_path = root / platform / '.understand-anything' / 'knowledge-graph.json'

        api_calls_by_domain = {}
        if kg_path.exists():
            try:
                kg = json.loads(kg_path.read_text())
                for edge in kg.get('edges', []):
                    if edge.get('type') == 'consumes_api':
                        target = edge.get('target', '')
                        if ':' in target:
                            path_part = target.split(':', 2)[-1] if target.count(':') >= 2 else target
                            api_calls_by_domain.setdefault('_all', []).append(path_part)
            except (json.JSONDecodeError, IOError):
                pass

        if not wiki_dir.exists():
            continue
        for f in wiki_dir.glob('*.json'):
            try:
                data = json.loads(f.read_text())
                name = data.get('name', f.stem)
                if name not in domains:
                    domains[name] = {'data': data, 'api_calls': list(api_calls_by_domain.get('_all', [])), 'platform': platform, 'file': str(f)}
            except (json.JSONDecodeError, IOError):
                continue
    return domains


def _match_by_api(server_domains, client_domains):
    endpoint_to_server = {}
    for s_name, s_info in server_domains.items():
        for ep in s_info.get('endpoints', []):
            path = ep.split(' ', 1)[-1] if ' ' in ep else ep
            endpoint_to_server[path] = s_name

    matches = []
    matched_pairs = set()
    for c_name, c_info in client_domains.items():
        for api_call in c_info.get('api_calls', []):
            path = api_call.split(' ', 1)[-1] if ' ' in api_call else api_call
            if path in endpoint_to_server:
                s_name = endpoint_to_server[path]
                pair_key = (s_name, c_name)
                if pair_key not in matched_pairs:
                    matched_pairs.add(pair_key)
                    matches.append({
                        'canonical': s_name,
                        'server': [s_name],
                        'client': [c_name],
                        'matchType': 'auto-api',
                        'confidence': 1.0,
                    })
    return matches


def _match_by_name(server_domains, client_domains, already_matched_server, already_matched_client):
    matches = []
    server_norm = {_normalize_name(k): k for k in server_domains if k not in already_matched_server}
    for c_name in client_domains:
        if c_name in already_matched_client:
            continue
        c_norm = _normalize_name(c_name)
        if c_norm in server_norm:
            s_name = server_norm[c_norm]
            matches.append({
                'canonical': s_name,
                'server': [s_name],
                'client': [c_name],
                'matchType': 'auto-name',
                'confidence': 1.0,
            })
    return matches


def _load_manual_mappings(project_root):
    mapping_path = Path(project_root) / '.understand-anything' / 'domain-mapping.json'
    if not mapping_path.exists():
        return []
    try:
        data = json.loads(mapping_path.read_text())
        return data.get('mappings', [])
    except (json.JSONDecodeError, IOError):
        return []


def match_domains(project_root_str: str, system_config: dict | None = None) -> dict:
    project_root = Path(project_root_str)

    if system_config is None:
        system_path = project_root / '.understand-anything' / 'system.json'
        if not system_path.exists():
            return {'matched': [], 'candidates': []}
        system_config = json.loads(system_path.read_text())

    server_facet = None
    client_facet = None
    for facet in system_config.get('facets', []):
        if facet.get('type') == 'backend':
            server_facet = facet
        elif facet.get('type') == 'mobile':
            client_facet = facet

    if not server_facet or not client_facet:
        return {'matched': [], 'candidates': []}

    server_domains = _load_server_domains(project_root_str, server_facet['path'])
    client_domains = _load_client_domains(
        project_root_str,
        client_facet['path'],
        client_facet.get('subPaths', [])
    )

    all_matched = []
    matched_server = set()
    matched_client = set()

    manual_mappings = _load_manual_mappings(project_root_str)
    for m in manual_mappings:
        canonical = m.get('canonical', '')
        server_aliases = m.get('aliases', {}).get('server', [])
        client_aliases = m.get('aliases', {}).get('client', [])
        all_matched.append({
            'canonical': canonical,
            'server': server_aliases,
            'client': client_aliases,
            'matchType': 'manual',
            'confidence': 1.0,
        })
        matched_server.update(server_aliases)
        matched_client.update(client_aliases)

    api_matches = _match_by_api(server_domains, client_domains)
    for m in api_matches:
        for s in m['server']:
            matched_server.add(s)
        for c in m['client']:
            matched_client.add(c)
        all_matched.append(m)

    name_matches = _match_by_name(server_domains, client_domains, matched_server, matched_client)
    for m in name_matches:
        for s in m['server']:
            matched_server.add(s)
        for c in m['client']:
            matched_client.add(c)
        all_matched.append(m)

    candidates = []
    for s_name in server_domains:
        if s_name in matched_server:
            continue
        for c_name in client_domains:
            if c_name in matched_client:
                continue
            candidates.append({
                'server': s_name,
                'client': c_name,
                'reason': 'name mismatch, no shared API endpoints',
            })

    result = {'matched': all_matched, 'candidates': candidates}

    output_dir = project_root / '.understand-anything' / 'intermediate'
    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / 'phase1-matches.json').write_text(json.dumps(result, indent=2, ensure_ascii=False))

    return result


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print('Usage: python3 domain_matcher.py <project-root>', file=sys.stderr)
        sys.exit(1)
    result = match_domains(sys.argv[1])
    print(f"Matched: {len(result['matched'])}, Candidates for LLM: {len(result['candidates'])}")
