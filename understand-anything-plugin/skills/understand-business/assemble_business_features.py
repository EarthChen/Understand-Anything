#!/usr/bin/env python3
"""Phase 4 alternative: Assemble feature-centric business documents.

Produces business_features.json with feature-centric structure where each
feature has a clientLayer (platforms, implementations) and serverLayer
(primary + supporting server domains).

Usage:
    python3 assemble_business_features.py <project-root>

Reads:
    intermediate/phase2-associations.json
    (consolidation data from domain_matcher)

Output:
    business-landscape/business-features.json
"""
import json
import sys
from pathlib import Path


def _build_feature_document(feature_data, association: dict) -> dict:
    """Build a single feature document combining client and server layers.

    feature_data may be a single dict or a list of dicts (one per facet).
    When multiple facets produce the same feature name, each becomes a
    separate entry in clientLayers[].
    """
    if isinstance(feature_data, dict):
        feature_data_list = [feature_data]
    else:
        feature_data_list = list(feature_data)

    name = feature_data_list[0].get('name', 'unknown') if feature_data_list else 'unknown'

    client_layers = []
    for fd in feature_data_list:
        facet_type = fd.get('facetType', 'mobile')
        platforms_dict = {}
        units = {}
        for impl in fd.get('implementations', []):
            platform = impl.get('platform', '')
            if facet_type == 'frontend':
                # Frontend emits one implementation per repo, all on platform 'web'.
                # Keying platforms_dict by platform alone would drop every repo but
                # the last, so aggregate repos under the single 'web' entry.
                entry = platforms_dict.setdefault(platform, {'repos': []})
                repo = impl.get('repo', '')
                if repo and repo not in entry['repos']:
                    entry['repos'].append(repo)
            else:
                platforms_dict[platform] = {k: v for k, v in impl.items() if k != 'platform'}
            unit_key = impl.get('repo', '') if facet_type == 'frontend' else platform
            if unit_key:
                units[unit_key] = {k: v for k, v in impl.items() if k not in ('platform', 'repo')}
        if not platforms_dict:
            for p in fd.get('platforms', []):
                platforms_dict[p] = {}
        client_layers.append({
            'facetType': facet_type,
            'implType': fd.get('implType', 'unknown'),
            'platforms': platforms_dict,
            'units': units,
            'deliveryPlatforms': fd.get('deliveryPlatforms', []),
            'summary': fd.get('mergedSummary', ''),
        })

    # Build server layer from association (skip if errored)
    primary = association.get('primaryServer') if not association.get('error') else None
    supporting = association.get('supportingServers') or []

    primary_domain = None
    if primary and isinstance(primary, dict) and primary.get('domain'):
        primary_domain = {
            'name': primary.get('domain', ''),
            'service': primary.get('service', ''),
            'confidence': primary.get('confidence', 0),
        }

    server_layer = {
        'primaryDomain': primary_domain,
        'supportingDomains': [
            {
                'name': s.get('domain', ''),
                'service': s.get('service', ''),
                'relationship': s.get('relationship', 'unknown'),
                'confidence': s.get('confidence', 0),
            }
            for s in supporting
            if isinstance(s, dict)
        ],
    }

    return {
        'id': f'feature:{name}',
        'name': name,
        'clientLayers': client_layers,
        'clientLayer': client_layers[0] if client_layers else {},  # backward-compat
        'serverLayer': server_layer,
    }


def _merge_server_associations(associations: list, facet_map: dict | None = None) -> dict:
    """Build reverse index: server domain → the client features that depend on it.

    Each domain entry carries:
      - features[]: legacy feature-name list (retained for backward compat)
      - refCount, service: retained for backward compat
      - touchpoints[]: {feature, facet, role}, role ∈ {primary, supporting} — the
        server-anchored join. Indexing primary ∪ supporting under each domain
        already co-locates features that touch the same backend domain.

    facet_map maps featureName → facetType; unknown names resolve to "unknown".
    """
    facet_map = facet_map or {}
    index: dict = {}

    def _ensure(domain: str, service: str) -> dict:
        if domain not in index:
            index[domain] = {'features': [], 'refCount': 0, 'service': service, 'touchpoints': []}
        return index[domain]

    for assoc in associations:
        if assoc.get('error'):
            continue
        feature_name = assoc.get('featureName', '')
        # Prefer the association's own facet (each facet contributes its own
        # correctly-labeled touchpoints); fall back to facet_map for old phase2
        # files that predate the additive facetType key.
        facet = assoc.get('facetType') or facet_map.get(feature_name, 'unknown')

        primary = assoc.get('primaryServer')
        if primary and isinstance(primary, dict):
            domain = primary.get('domain', '')
            if domain:
                entry = _ensure(domain, primary.get('service', ''))
                entry['features'].append(feature_name)
                entry['refCount'] += 1
                entry['touchpoints'].append(
                    {'feature': feature_name, 'facet': facet, 'role': 'primary'}
                )

        for s in (assoc.get('supportingServers') or []):
            if not isinstance(s, dict):
                continue
            domain = s.get('domain', '')
            if domain:
                entry = _ensure(domain, s.get('service', ''))
                if feature_name not in entry['features']:
                    entry['features'].append(feature_name)
                    entry['refCount'] += 1
                entry['touchpoints'].append(
                    {'feature': feature_name, 'facet': facet, 'role': 'supporting'}
                )

    return index


def _merge_feature_associations(assocs: list) -> dict:
    """Combine the associations for one feature name (one per facet) into a single
    association for the feature document. Single/!valid cases pass through unchanged."""
    valid = [a for a in assocs if a and not a.get('error')]
    if not valid:
        return assocs[0] if assocs else {}
    if len(valid) == 1:
        return valid[0]
    primaries = [a['primaryServer'] for a in valid
                 if isinstance(a.get('primaryServer'), dict) and a['primaryServer'].get('domain')]
    chosen = max(primaries, key=lambda p: p.get('confidence', 0)) if primaries else None
    seen = {chosen.get('domain')} if chosen else set()
    supporting = []
    for p in primaries:                      # demote non-chosen primaries to supporting
        if p is not chosen and p.get('domain') not in seen:
            seen.add(p.get('domain'))
            supporting.append({**p, 'relationship': p.get('relationship', 'depends_on')})
    for a in valid:
        for s in (a.get('supportingServers') or []):
            if isinstance(s, dict) and s.get('domain') and s.get('domain') not in seen:
                seen.add(s.get('domain'))
                supporting.append(s)
    return {'primaryServer': chosen, 'supportingServers': supporting, 'error': None}


def assemble_features(associations: list, consolidation: dict) -> dict:
    """Assemble feature-centric documents from associations and consolidation data."""
    # Build name→[feature_data] lookup; list supports multiple facets per feature name.
    feature_lookup: dict = {}
    facet_map: dict = {}
    for f in consolidation.get('consolidated', []):
        feature_lookup.setdefault(f['name'], []).append(f)
        facet_map.setdefault(f['name'], f.get('facetType', 'unknown'))
    for f in consolidation.get('standalone', []):
        feature_lookup.setdefault(f['name'], []).append({
            'name': f['name'],
            'implType': f.get('implType', 'native-specific'),
            'platforms': [f.get('platform', '')],
            'deliveryPlatforms': f.get('deliveryPlatforms', []),
            'implementations': [],
            'mergedSummary': '',
            'facetType': f.get('facetType', 'mobile'),
        })
        facet_map.setdefault(f['name'], f.get('facetType', 'mobile'))

    # Group associations by feature name (a name may have one association per facet).
    assoc_by_name: dict = {}
    for assoc in associations:
        assoc_by_name.setdefault(assoc.get('featureName', ''), []).append(assoc)

    # Ordered unique feature names: consolidation order first (insertion-ordered
    # feature_lookup), then any association-only names not in consolidation.
    ordered_names = list(feature_lookup.keys())
    for name in assoc_by_name:
        if name not in feature_lookup:
            ordered_names.append(name)

    # Build feature documents — ONE per unique feature name.
    features = []
    with_association = 0
    for name in ordered_names:
        feature_data_list = feature_lookup.get(name) or [{
            'name': name,
            'implType': 'unknown',
            'platforms': [],
            'deliveryPlatforms': [],
            'implementations': [],
            'mergedSummary': '',
            'facetType': 'unknown',
        }]
        assocs = assoc_by_name.get(name) or [{}]
        merged = _merge_feature_associations(assocs)
        doc = _build_feature_document(feature_data_list, merged)
        features.append(doc)
        if doc['serverLayer']['primaryDomain'] is not None:
            with_association += 1

    server_index = _merge_server_associations(associations, facet_map)

    return {
        'features': features,
        'serverIndex': server_index,
        'stats': {
            'totalFeatures': len(features),
            'withServerAssociation': with_association,
            'serverDomainsReferenced': len(server_index),
        },
    }


def run_assemble_features(project_root_str: str) -> dict:
    """Full pipeline: read Phase 2 results, assemble, write output."""
    project_root = Path(project_root_str)
    intermediate_dir = project_root / '.understand-anything' / 'intermediate'

    assoc_path = intermediate_dir / 'phase2-associations.json'
    if not assoc_path.exists():
        return {'error': 'phase2-associations.json not found. Run Phase 2 first.'}

    try:
        assoc_data = json.loads(assoc_path.read_text())
    except (json.JSONDecodeError, IOError) as e:
        return {'error': f'Failed to parse phase2-associations.json: {e}'}

    associations = assoc_data.get('associations', [])

    # Re-derive consolidation through the client-facet strategy registry.
    from client_facets import load_client_features

    system_path = project_root / '.understand-anything' / 'system.json'
    if not system_path.exists():
        return {'error': 'system.json not found'}

    try:
        system_config = json.loads(system_path.read_text())
    except (json.JSONDecodeError, IOError) as e:
        return {'error': f'Failed to parse system.json: {e}'}

    consolidation = {'consolidated': [], 'standalone': [], 'infrastructure': []}
    for facet in system_config.get('facets', []):
        c = load_client_features(project_root_str, facet)
        if c is None:
            continue
        facet_type = facet.get('type', '')
        for item in c['consolidated']:
            item.setdefault('facetType', facet_type)
        for item in c['standalone']:
            item.setdefault('facetType', facet_type)
        consolidation['consolidated'].extend(c['consolidated'])
        consolidation['standalone'].extend(c['standalone'])
        consolidation['infrastructure'].extend(c['infrastructure'])

    result = assemble_features(associations, consolidation)

    # Write output
    output_dir = project_root / '.understand-anything' / 'business-landscape'
    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / 'business-features.json').write_text(
        json.dumps(result, indent=2, ensure_ascii=False)
    )

    return result


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print('Usage: python3 assemble_business_features.py <project-root>', file=sys.stderr)
        sys.exit(1)
    result = run_assemble_features(sys.argv[1])
    if 'error' in result:
        print(f"ERROR: {result['error']}", file=sys.stderr)
        sys.exit(1)
    stats = result['stats']
    print(f"Features: {stats['totalFeatures']}, with server: {stats['withServerAssociation']}, server domains: {stats['serverDomainsReferenced']}")
