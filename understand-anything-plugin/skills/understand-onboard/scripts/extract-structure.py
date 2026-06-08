#!/usr/bin/env python3
"""Extract structured data from knowledge-graph.json for onboarding generation.

Usage: python3 extract-structure.py <kg-path> <output-path>
"""

import json
import sys
from collections import Counter
from pathlib import Path


def extract(kg_path: str) -> dict:
    with open(kg_path) as f:
        kg = json.load(f)

    nodes = kg.get('nodes', [])
    edges = kg.get('edges', [])

    node_types = Counter(n.get('type', 'unknown') for n in nodes)
    entry_points = [n for n in nodes if n.get('type') == 'endpoint']
    layers = sorted(set(n.get('layer', 'unknown') for n in nodes))

    return {
        'totalNodes': len(nodes),
        'totalEdges': len(edges),
        'nodesByType': dict(node_types),
        'layers': layers,
        'entryPointCount': len(entry_points),
        'topEntryPoints': [
            {'id': n['id'], 'label': n.get('name', n['id'])}
            for n in entry_points[:10]
        ],
    }


def main():
    if len(sys.argv) < 3:
        print('Usage: python3 extract-structure.py <kg-path> <output-path>', file=sys.stderr)
        sys.exit(1)
    kg_path, output_path = sys.argv[1], sys.argv[2]
    result = extract(kg_path)
    output = Path(output_path)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, indent=2, ensure_ascii=False) + '\n')
    print(f'Extracted structure: {result["totalNodes"]} nodes, {result["totalEdges"]} edges')


if __name__ == '__main__':
    main()
