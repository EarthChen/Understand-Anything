#!/usr/bin/env python3
"""Single source of truth for facet types and platform vocabularies.

Every facet-type / platform set in understand-business derives from here so the
definitions can never drift apart again. Aliases are normalized to one canonical
name on input — internal code only ever sees canonical names.
"""

# Canonical facet types and their metadata.
#   role:       'client' | 'server' | 'shared' | 'test'
#   graph_file: aggregation graph a facet of this type produces (None = none)
#   supported:  whether the business pipeline has a strategy for this type
FACET_REGISTRY = {
    "server":   {"role": "server", "graph_file": "system-graph.json",   "supported": True},
    "mobile":   {"role": "client", "graph_file": "client-graph.json",   "supported": True},
    "frontend": {"role": "client", "graph_file": "frontend-graph.json", "supported": True},
    "shared":   {"role": "shared", "graph_file": None,                  "supported": False},
    "desktop":  {"role": "client", "graph_file": None,                  "supported": False},
    "test":     {"role": "test",   "graph_file": None,                  "supported": False},
}

# Input aliases → canonical name. Internal code never emits these.
#   backend: has historical data; must stay compatible (silent normalization).
#   web:     no historical data; canonical name is 'frontend'.
_INPUT_ALIASES = {"backend": "server", "web": "frontend"}


def canonical_facet(facet_type: str) -> str:
    """Normalize an alias to its canonical facet type. Unknown types pass through."""
    if facet_type in FACET_REGISTRY:
        return facet_type
    return _INPUT_ALIASES.get(facet_type, facet_type)


def graph_file_for(facet_type: str):
    """Aggregation graph filename for a facet type (alias-normalized), or None."""
    meta = FACET_REGISTRY.get(canonical_facet(facet_type))
    return meta["graph_file"] if meta else None


def is_supported_facet(facet_type: str) -> bool:
    """True if a facet type (alias-normalized) has a pipeline strategy."""
    meta = FACET_REGISTRY.get(canonical_facet(facet_type))
    return bool(meta and meta["supported"])


def feature_key(facet_type: str, project, name: str) -> tuple:
    """Canonical identity tuple for a client feature across the pipeline.

    (canonical facet, project-or-empty-string, feature name). Used as the
    association cache key and the per-(facet, project) association lookup key so
    every stage agrees on what makes two features 'the same'. facetType is part
    of identity so a frontend merge-canonical (project=None) and a mobile feature
    (project=None) with the same name do not collide.
    """
    return (canonical_facet(facet_type or ''), project or '', name)


# NOTE: these sets hold CANONICAL types only. Callers must run canonical_facet(t)
# BEFORE membership-testing a raw system.json facet type, so aliases ('backend',
# 'web') resolve in rather than silently falling through.
CLIENT_FACET_TYPES = frozenset(
    t for t, m in FACET_REGISTRY.items() if m["role"] == "client"
)
SERVER_FACET_TYPES = frozenset(
    t for t, m in FACET_REGISTRY.items() if m["role"] == "server"
)
FRONTEND_FACET_TYPES = frozenset({"frontend"})  # canonical; 'web' normalizes in

# Platform vocabularies (decoupled from facet types).
CLIENT_PLATFORMS = frozenset({
    "ios", "android", "flutter", "react-native", "kotlin-multiplatform", "web",
})
FRONTEND_PLATFORMS = frozenset({"web"})
SERVER_PLATFORMS = frozenset({
    "java", "java-spring", "kotlin", "go", "python", "node", "dotnet", "rust",
})
# "unknown" is a detection sentinel, not a real platform; kept only in ALL_PLATFORMS.
ALL_PLATFORMS = CLIENT_PLATFORMS | SERVER_PLATFORMS | {"unknown"}
