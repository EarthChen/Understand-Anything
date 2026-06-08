#!/usr/bin/env python3
"""Phase 5: Full business-landscape schema + reference integrity validation.

Validates domains.json, cross-facet-links.json, and all domain detail files.

Usage:
    python3 validate_landscape.py <project-root>

Exit code 0 = valid, 1 = errors
"""
import json
import sys
from pathlib import Path

from validate_domain import validate_domain_doc


def validate_landscape(project_root_str):
    project_root = Path(project_root_str)
    bl_dir = project_root / '.understand-anything' / 'business-landscape'
    errors = []

    domains_path = bl_dir / 'domains.json'
    if not domains_path.exists():
        errors.append('Missing required file: domains.json')
        return errors

    try:
        domains_data = json.loads(domains_path.read_text())
    except json.JSONDecodeError as e:
        errors.append(f'domains.json: invalid JSON — {e}')
        return errors

    if 'domains' not in domains_data or not isinstance(domains_data['domains'], list):
        errors.append("domains.json: missing or invalid 'domains' array")

    if 'stats' in domains_data:
        stats = domains_data['stats']
        actual_mapped = len(domains_data.get('domains', []))
        actual_unmapped = len(domains_data.get('unmapped', []))
        actual_total = actual_mapped + actual_unmapped
        if stats.get('totalDomains') != actual_total:
            errors.append(f"domains.json: stats.totalDomains ({stats.get('totalDomains')}) != actual count ({actual_total})")
        if stats.get('mappedDomains') != actual_mapped:
            errors.append(f"domains.json: stats.mappedDomains ({stats.get('mappedDomains')}) != actual ({actual_mapped})")

    for d in domains_data.get('domains', []):
        for field in ('id', 'name', 'summary', 'matchType', 'detailRef'):
            if field not in d:
                errors.append(f"domains.json: domain entry missing field '{field}'")

    links_path = bl_dir / 'cross-facet-links.json'
    if not links_path.exists():
        errors.append('Missing required file: cross-facet-links.json')
    else:
        try:
            links_data = json.loads(links_path.read_text())
            domain_ids = {d['id'] for d in domains_data.get('domains', []) if 'id' in d}
            for link in links_data.get('links', []):
                if link.get('domain') not in domain_ids:
                    errors.append(f"cross-facet-links.json: link references unknown domain '{link.get('domain')}'")
        except json.JSONDecodeError as e:
            errors.append(f'cross-facet-links.json: invalid JSON — {e}')

    domains_dir = bl_dir / 'domains'
    if domains_dir.exists():
        for f in domains_dir.glob('*.json'):
            try:
                doc = json.loads(f.read_text())
                doc_errors = validate_domain_doc(doc)
                for e in doc_errors:
                    errors.append(f'domains/{f.name}: {e}')
            except json.JSONDecodeError as e:
                errors.append(f'domains/{f.name}: invalid JSON — {e}')

    return errors


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print('Usage: python3 validate_landscape.py <project-root>', file=sys.stderr)
        sys.exit(1)
    errors = validate_landscape(sys.argv[1])
    if errors:
        print(f'Validation FAILED ({len(errors)} errors):', file=sys.stderr)
        for e in errors:
            print(f'  ERROR: {e}', file=sys.stderr)
        sys.exit(1)
    else:
        print('Validation PASSED')
        sys.exit(0)
