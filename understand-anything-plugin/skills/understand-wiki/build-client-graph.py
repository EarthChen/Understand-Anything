#!/usr/bin/env python3
"""Build client-graph.json from platform wiki data.

Reads wiki/domains/*.json from each platform directory (android, ios, flutter, etc.)
and produces a unified client-graph.json with cross-platform feature mapping.

Usage:
    python3 build-client-graph.py <project-root>

Output:
    <project-root>/<client-facet-path>/.understand-anything/client-graph.json
"""
import json
import sys
import hashlib
from pathlib import Path


def _load_system_config(project_root: Path):
    system_path = project_root / '.understand-anything' / 'system.json'
    if not system_path.exists():
        return None
    with open(system_path) as f:
        return json.load(f)


def _find_client_facet(system_config):
    for facet in system_config.get('facets', []):
        if facet.get('type') == 'mobile':
            return facet
    return None


def _load_platform_domains(platform_path: Path):
    wiki_domains_dir = platform_path / '.understand-anything' / 'wiki' / 'domains'
    if not wiki_domains_dir.exists():
        return {}
    domains = {}
    for f in wiki_domains_dir.glob('*.json'):
        try:
            with open(f) as fh:
                data = json.load(fh)
                domain_id = data.get('id', f.stem)
                domains[domain_id] = data
        except (json.JSONDecodeError, IOError):
            continue
    return domains


def _detect_cross_platform_frameworks(platform_domains_map):
    frameworks = set()
    for _platform, domains in platform_domains_map.items():
        for _did, domain in domains.items():
            for flow in domain.get('flows', []):
                for step in flow.get('steps', []):
                    desc = step.get('description', '').lower()
                    if 'flutter' in desc:
                        frameworks.add('flutter')
                    if 'react native' in desc or 'react-native' in desc:
                        frameworks.add('react-native')
                    if 'kmm' in desc or 'kotlin multiplatform' in desc:
                        frameworks.add('kmm')
    return sorted(frameworks)


def _normalize_domain_name(name):
    return name.lower().replace('-', '_').replace(' ', '_')


def _classify_impl_type(domain_name, platform_domains_map, cross_platform_frameworks):
    normalized = _normalize_domain_name(domain_name)
    has_cross_platform_ref = False
    has_native_ref = False
    implementations = {}

    for platform, domains in platform_domains_map.items():
        for did, domain in domains.items():
            d_name = _normalize_domain_name(domain.get('name', did))
            if d_name != normalized:
                continue
            wiki_ref = domain.get('_wiki_ref', '')
            domain_text = json.dumps(domain).lower()
            is_framework = any(fw in domain_text for fw in cross_platform_frameworks)
            if is_framework:
                has_cross_platform_ref = True
                fw = next((fw for fw in cross_platform_frameworks if fw in domain_text), 'unknown')
                implementations[platform] = {'framework': fw, 'ref': wiki_ref}
            else:
                has_native_ref = True
                implementations[platform] = {'framework': 'native', 'ref': wiki_ref}

    if has_cross_platform_ref and not has_native_ref:
        return 'cross-platform', implementations
    elif has_native_ref and not has_cross_platform_ref:
        return 'platform-specific', implementations
    elif has_cross_platform_ref and has_native_ref:
        return 'mixed', implementations
    else:
        return 'platform-specific', implementations


def build_client_graph(project_root_str: str) -> None:
    project_root = Path(project_root_str)
    system_config = _load_system_config(project_root)
    if not system_config:
        raise FileNotFoundError('[build-client-graph] system.json not found')

    client_facet = _find_client_facet(system_config)
    if not client_facet:
        raise ValueError('[build-client-graph] No mobile facet found in system.json')

    facet_path = project_root / client_facet['path']
    sub_paths = client_facet.get('subPaths', [])
    if not sub_paths:
        sub_paths = [d.name + '/' for d in facet_path.iterdir() if d.is_dir() and (d / '.understand-anything' / 'wiki' / 'meta.json').exists()]

    platforms = []
    platform_domains_map = {}
    for sp in sub_paths:
        platform_path = facet_path / sp.rstrip('/')
        if not platform_path.exists():
            continue
        platform_name = sp.rstrip('/')
        platforms.append(platform_name)
        domains = _load_platform_domains(platform_path)
        for did, domain in domains.items():
            domain['_wiki_ref'] = f"{client_facet['path']}{sp}.understand-anything/wiki/domains/{Path(did).stem}.json"
        platform_domains_map[platform_name] = domains

    if not platforms:
        raise FileNotFoundError('[build-client-graph] No integrated platforms found')

    cross_platform_frameworks = _detect_cross_platform_frameworks(platform_domains_map)

    all_domain_names = set()
    for domains in platform_domains_map.values():
        for domain in domains.values():
            all_domain_names.add(domain.get('name', ''))

    feature_map = []
    for domain_name in sorted(all_domain_names):
        if not domain_name:
            continue
        impl_type, implementations = _classify_impl_type(
            domain_name, platform_domains_map, cross_platform_frameworks
        )
        for impl in implementations.values():
            impl.pop('_wiki_ref', None)
        entry = {
            'domain': domain_name,
            'implType': impl_type,
            'implementations': implementations,
        }
        feature_map.append(entry)

    client_graph = {
        'platforms': platforms,
        'crossPlatformFrameworks': cross_platform_frameworks,
        'featureMap': feature_map,
    }

    # Hash is of canonical content (without contentHash), so integrity can be
    # verified by stripping the field, re-hashing, and comparing.
    content = json.dumps(client_graph, indent=2, ensure_ascii=False)
    content_hash = hashlib.sha256(content.encode()).hexdigest()
    client_graph['contentHash'] = content_hash
    content = json.dumps(client_graph, indent=2, ensure_ascii=False)

    output_path = facet_path / '.understand-anything' / 'client-graph.json'
    output_path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = str(output_path) + '.tmp'
    with open(tmp_path, 'w') as f:
        f.write(content)
    Path(tmp_path).rename(output_path)

    print(f'[build-client-graph] Generated client-graph.json: {len(platforms)} platforms, {len(feature_map)} features, hash={content_hash[:12]}')


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print('Usage: python3 build-client-graph.py <project-root>', file=sys.stderr)
        sys.exit(1)
    try:
        build_client_graph(sys.argv[1])
    except (FileNotFoundError, ValueError) as e:
        print(f'ERROR: {e}', file=sys.stderr)
        sys.exit(1)
