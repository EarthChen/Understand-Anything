#!/usr/bin/env python3
"""Client-facet strategy registry (Spec 2 Component 1 & 2).

Gives every client facet type a single
`(project_root, facet) -> {consolidated, standalone, infrastructure}` entry
point so the rest of the business pipeline never branches on facet type.
Adding a new client facet type = register one strategy here, zero pipeline edits.
"""
import json
import re
from pathlib import Path

from domain_matcher import _consolidate_mobile_domains

# Conservative frontend-infrastructure keywords. Most infra is already excluded
# upstream by frontend-flow.md; this is a backstop for anything that slips through.
# 'provider' and 'loading' were intentionally removed: they collide with real
# business feature names ('Provider Onboarding', 'Loading Dock Management'), and
# this backstop deliberately favors keeping features over dropping them (the
# primary infra filter is upstream).
_FRONTEND_INFRA_KEYWORDS = (
    'layout', 'theme', 'i18n', 'locale', 'error-boundary',
    'toast', 'modal-shell',
)

_TOKEN_SPLIT = re.compile(r'[\s\-_]+')
# camelCase / Pascal-case + letter↔digit boundary splitter. Applied per chunk
# (after the whitespace/hyphen/underscore split) so that CamelCase infra
# component names — which dominate frontend code — also split into their words:
# 'ThemeProvider' → ('theme', 'provider'), 'AppLayout' → ('app', 'layout').
_CAMEL_SPLIT = re.compile(r'[A-Z]+(?=[A-Z][a-z])|[A-Z]?[a-z]+|[A-Z]+|\d+')


def _tokenize(text: str) -> tuple:
    """Split into lowercase tokens on whitespace/hyphen/underscore AND camelCase.

    Splitting must happen before lowercasing so camelCase boundaries survive.
    Keywords are tokenized with this same function, so both sides split
    identically — e.g. 'i18n' → ('i', '18', 'n') on both the keyword and the
    name, keeping the 'i18n' keyword match intact.
    """
    return tuple(
        part.lower()
        for chunk in _TOKEN_SPLIT.split(text)
        if chunk
        for part in _CAMEL_SPLIT.findall(chunk)
    )


def consolidate_mobile(project_root: str, facet: dict) -> dict:
    """Mobile consolidation — delegates to the existing domain_matcher logic.

    A missing or empty 'path' returns the empty consolidation (graceful; mirrors
    consolidate_frontend's missing-path behavior) rather than scanning the root.
    """
    path = facet.get('path', '')
    if not path:
        return {'consolidated': [], 'standalone': [], 'infrastructure': []}
    return _consolidate_mobile_domains(
        project_root, path, facet.get('subPaths', [])
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
    """True if any infra keyword appears as a CONTIGUOUS token run within `name`.

    Token-sequence (not substring) matching: 'error-boundary' matches "Error
    Boundary Wrapper" and 'i18n' matches the token 'i18n', while 'order' would
    never match inside the single token 'reorder'.
    """
    tokens = _tokenize(name)
    for kw in _FRONTEND_INFRA_KEYWORDS:
        kw_tokens = _tokenize(kw)
        n = len(kw_tokens)
        if n == 0:
            continue
        for i in range(len(tokens) - n + 1):
            if tokens[i:i + n] == kw_tokens:
                return True
    return False


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


# NOTE: keep this in sync with scenario_detector.CLIENT_FACET_TYPES. Any type
# recognized there but NOT registered here (currently 'desktop') is treated as
# unsupported — load_client_features returns None and association_discovery
# surfaces it via `unsupportedFacets`, contributing zero features. 'web' is
# registered as an alias for the frontend strategy: a web facet IS a frontend facet.
CLIENT_STRATEGIES = {
    'mobile': consolidate_mobile,
    'frontend': consolidate_frontend,
    'web': consolidate_frontend,
}


def load_client_features(project_root: str, facet: dict) -> dict | None:
    """Return {consolidated, standalone, infrastructure}, or None if unsupported."""
    strategy = CLIENT_STRATEGIES.get(facet.get('type'))
    return strategy(project_root, facet) if strategy else None
