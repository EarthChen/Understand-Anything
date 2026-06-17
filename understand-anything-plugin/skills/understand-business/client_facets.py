#!/usr/bin/env python3
"""Client-facet strategy registry (Spec 2 Component 1 & 2).

Gives every client facet type a single
`(project_root, facet) -> {consolidated, standalone, infrastructure}` entry
point so the rest of the business pipeline never branches on facet type.
Adding a new client facet type = register one strategy here, zero pipeline edits.
"""
import json
from pathlib import Path

from domain_matcher import _consolidate_mobile_domains

# Conservative frontend-infrastructure keywords. Most infra is already excluded
# upstream by frontend-flow.md; this is a backstop for anything that slips through.
_FRONTEND_INFRA_KEYWORDS = (
    'layout', 'theme', 'i18n', 'locale', 'error-boundary',
    'loading', 'toast', 'modal-shell', 'provider',
)


def consolidate_mobile(project_root: str, facet: dict) -> dict:
    """Mobile consolidation — delegates to the existing domain_matcher logic."""
    return _consolidate_mobile_domains(
        project_root, facet['path'], facet.get('subPaths', [])
    )


def _summarize(feat: dict) -> str:
    """Build a one-line summary from a frontend feature's routes + API calls.

    Uses the safe `.get` defaults that were patched into the original loaders in
    review (`method` defaults to 'UNKNOWN', `path` to '').
    """
    routes = feat.get('routes', [])
    calls = feat.get('apiCalls', [])
    parts = []
    if routes:
        parts.append('Routes: ' + ', '.join(routes[:3]))
    if calls:
        parts.append('API: ' + ', '.join(
            f"{c.get('method', 'UNKNOWN')} {c.get('path', '')}" for c in calls[:3]
        ))
    return '. '.join(parts)


def _is_frontend_infra(name: str) -> bool:
    lowered = name.lower()
    return any(kw in lowered for kw in _FRONTEND_INFRA_KEYWORDS)


def consolidate_frontend(project_root: str, facet: dict) -> dict:
    """Read frontend-graph.json (Spec 1 aggregate) → {consolidated, standalone, infrastructure}.

    Missing/unparseable graph or a facet path that escapes the project root →
    empty consolidation (graceful; matches the prior loader's fallback).
    """
    empty = {'consolidated': [], 'standalone': [], 'infrastructure': []}
    root = Path(project_root).resolve()
    fg_path = (
        root / facet.get('path', '') /
        '.understand-anything' / 'frontend-graph.json'
    ).resolve()
    if not fg_path.is_relative_to(root):
        return empty
    if not fg_path.is_file():
        return empty
    try:
        fg = json.loads(fg_path.read_text(encoding='utf-8'))
    except (json.JSONDecodeError, OSError):
        return empty

    frameworks = fg.get('project', {}).get('frameworks', [])
    consolidated = []
    infrastructure = []
    for feat in fg.get('features', []):
        name = feat.get('name', '')
        if _is_frontend_infra(name):
            infrastructure.append({
                'name': name,
                'implType': 'infrastructure',
                'platforms': ['web'],
                'deliveryPlatforms': frameworks,
                'facetType': 'frontend',
            })
            continue
        source_repos = feat.get('sourceRepos', [])
        consolidated.append({
            'name': name,
            'implType': 'frontend-web',
            'platforms': ['web'],
            'deliveryPlatforms': frameworks,
            'implementations': [
                {'platform': 'web', 'repo': r} for r in source_repos
            ],
            'mergedSummary': _summarize(feat),
            'facetType': 'frontend',
            'sourceRepos': source_repos,
        })
    return {
        'consolidated': consolidated,
        'standalone': [],
        'infrastructure': infrastructure,
    }


CLIENT_STRATEGIES = {
    'mobile': consolidate_mobile,
    'frontend': consolidate_frontend,
}


def load_client_features(project_root: str, facet: dict) -> dict | None:
    """Return {consolidated, standalone, infrastructure}, or None if unsupported."""
    strategy = CLIENT_STRATEGIES.get(facet.get('type'))
    return strategy(project_root, facet) if strategy else None
