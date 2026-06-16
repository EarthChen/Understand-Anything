# Frontend Business Consolidation + Server-Anchored Unification (Spec 2) Design

**Goal:** Make `understand-business` treat `frontend` as a peer client facet (a `consolidate_frontend` symmetric to `_consolidate_mobile_domains`), collapse today's duplicated frontend-loading code into one strategy registry, and unify cross-client capabilities through the **server domain as the authoritative join** — refined by one bounded LLM review pass.

**Architecture:** A client-facet strategy registry gives every client facet type a single `(project_root, facet) -> {consolidated, standalone, infrastructure}` entry point. Cross-axis unification (mobile ≡ web) is realized **not** by client↔client merging but by anchoring on shared backend domains: every client feature already associates to server domains (Phase 2), so features touching an overlapping backend-domain set surface together under that domain. A final LLM review classifies and labels those server-anchored groupings.

**Tech Stack:** Python 3 stdlib, the existing `_call_llm` hook convention (placeholder overridden by the agent in production), pytest under `tests/understand-business/`.

---

## Context: where this sits

**Sub-project 2 of 2.** It consumes the `frontend-graph.json` aggregate produced by Spec 1 (`docs/superpowers/specs/2026-06-17-frontend-graph-aggregator-design.md`). Spec 1 already merged cross-repo same-name features into single `features[]` entries (each with `sourceRepos[]`) and emitted `domainLinks[]`; this spec consumes that merged artifact — it does **not** re-run cross-repo matching.

After both specs, the three client/server analysis stages are symmetric:

| business stage | server | mobile | frontend |
|----------------|--------|--------|----------|
| domain consolidation | `_load_server_domains` | `_consolidate_mobile_domains` | **`consolidate_frontend`** ← this spec |
| dispatch | facet-type checks scattered across 2 files | same | **one strategy registry** ← this spec |

## Decisions carried in from brainstorming

1. **Server domain is the authoritative business identity.** Clients (mobile, web) are presentation layers that associate to it. Cross-axis unification happens through shared backend domains, not direct client↔client merge.
2. **Join condition = overlapping backend-domain SET** (primary ∪ supporting), not just primary. This groups complementary splits (web "下单创建" + mobile "订单跟踪", both touching `OrderService`).
3. **One bounded LLM review** refines deterministic groupings (candidate→verify pattern); it never invents groupings. Degrades to mechanical labels without an LLM.
4. **Disjoint-domain cross-axis splits** (two halves touching entirely different backend domains) are represented by the existing server-side `businessFlows`, not forced into one feature.
5. **Pure client-only capabilities** (no backend dependency) are out of scope — each client's copy stands alone.

---

## Background: current state

- `_consolidate_mobile_domains(project_root, facet_path, sub_paths) -> {consolidated, standalone, infrastructure}` (in `domain_matcher.py`) is the mobile consolidation. Each `consolidated` item: `{name, implType, platforms, deliveryPlatforms, implementations, mergedSummary}`.
- **Frontend loading is duplicated in two places** that have already drifted (different `method`/`path` defaults were patched in review):
  - `association_discovery._load_frontend_features(project_root, facet) -> list[feature]`
  - the inline `elif facet.get('type') == 'frontend':` branch in `assemble_business_features.run_assemble_features`
- `assemble_business_features` emits `business-features.json`: `features[]` (each `{id, name, clientLayers[], clientLayer, serverLayer}`) + `serverIndex` (`{domain: {features: [names], refCount, service}}`) + `stats`.
- `_merge_server_associations(associations)` builds `serverIndex` by indexing each association's `primaryServer` and `supportingServers` under their domain.
- Phase 2 `association_discovery` already loads BOTH mobile and frontend client features into one pool and associates each to server domains. `route_phase3.py` routes association output to the feature-centric assembly.

---

## Design

### Component 1 — Client-facet strategy registry (`client_facets.py`)

New module owning the per-facet-type consolidation and a single dispatch point.

```python
# client_facets.py
from domain_matcher import _consolidate_mobile_domains

def consolidate_mobile(project_root: str, facet: dict) -> dict:
    return _consolidate_mobile_domains(
        project_root, facet['path'], facet.get('subPaths', [])
    )

def consolidate_frontend(project_root: str, facet: dict) -> dict:
    ...  # see Component 2

CLIENT_STRATEGIES = {
    'mobile':   consolidate_mobile,
    'frontend': consolidate_frontend,
}

def load_client_features(project_root: str, facet: dict) -> dict | None:
    """Return {consolidated, standalone, infrastructure}, or None if unsupported."""
    strategy = CLIENT_STRATEGIES.get(facet.get('type'))
    return strategy(project_root, facet) if strategy else None
```

**Refactor both consumers to dispatch through the registry**, deleting the two duplicate frontend loaders and the `if type=='mobile' / elif 'frontend'` ladders:

- `association_discovery.run_association_discovery`: replace the per-facet `if/elif` with `c = load_client_features(...)`; if `None`, append to `unsupportedFacets`; else extend the feature pool from `c['consolidated']` + flattened `c['standalone']`.
- `assemble_business_features.run_assemble_features`: same dispatch; remove the inline frontend branch and the second `_consolidate_mobile_domains` call.

This is the DRY fix: frontend loading exists once; mobile loading is called (not reimplemented) once.

### Component 2 — `consolidate_frontend(project_root, facet)`

Reads the `frontend-graph.json` aggregate (Spec 1) and returns the standard `{consolidated, standalone, infrastructure}` shape so downstream is uniform with mobile.

- Locate `frontend-graph.json` at `<project_root>/<facet.path>/.understand-anything/frontend-graph.json`, with the existing path-traversal guard (`.resolve()` + `is_relative_to(project_root)`).
- `frameworks = fg['project']['frameworks']`.
- For each `feat` in `fg['features']`:
  - **Infrastructure filter:** if `feat['name']` matches a frontend-infra keyword list (`layout`, `theme`, `i18n`, `locale`, `error-boundary`, `loading`, `toast`, `modal-shell`, `provider`) → append to `infrastructure` and skip. Keyword list is conservative; most infra is already excluded upstream by `frontend-flow.md`.
  - Else build a `consolidated` entry:
    ```python
    {
      'name': feat['name'],
      'implType': 'frontend-web',
      'platforms': ['web'],
      'deliveryPlatforms': frameworks,
      'implementations': [
        {'platform': 'web', 'repo': r} for r in feat.get('sourceRepos', [])
      ],
      'mergedSummary': _summarize(feat),   # "Routes: …. API: GET /…, POST /…"
      'facetType': 'frontend',
      'sourceRepos': feat.get('sourceRepos', []),
    }
    ```
  - `standalone` stays `[]` for frontend (no platform-specific standalone concept; cross-repo merge already happened in Spec 1).
- `_summarize(feat)` reuses the existing summary logic (`'Routes: ' + ', '.join(routes[:3])`, `'API: ' + ', '.join(f"{c.get('method','UNKNOWN')} {c.get('path','')}" for c in calls[:3])`), with the safe `.get` defaults that were patched in review.
- Missing/unparseable `frontend-graph.json` → return `{'consolidated': [], 'standalone': [], 'infrastructure': []}` (graceful, matches current `_load_frontend_features` fallback).

`implementations[].repo` is what lets `clientLayers` show per-repo `units` (e.g. web `{web-app, admin}`), parallel to mobile's per-platform breakdown.

### Component 3 — Server-domain-anchored `serverIndex`

Enrich `_merge_server_associations` so each domain carries its full cross-client surface instead of bare feature-name strings. The "overlapping-domain-set join" needs no new pass — indexing primary ∪ supporting under each domain already places co-touching features together.

```json
"serverIndex": {
  "OrderService.订单域": {
    "service": "OrderService",
    "refCount": 2,
    "touchpoints": [
      { "feature": "下单创建", "facet": "frontend", "role": "primary" },
      { "feature": "订单跟踪", "facet": "mobile",   "role": "primary" }
    ],
    "capability": { "label": "订单管理", "relationship": "complementary-split",
                    "summary": "web 负责创建下单;mobile 负责跟踪与核销" }
  }
}
```

- `touchpoints[]` replaces `features[]`; each `{feature, facet, role}` where `role ∈ {primary, supporting}` (already known at index time — `_merge_server_associations` indexes `primaryServer` vs `supportingServers` separately).
- **`facet` resolution:** Phase 2 `associations[]` carry only `featureName`, not facet. `assemble` already rebuilds the consolidation via the registry, so it holds a `featureName → facetType` map; pass that map into the `serverIndex` builder so each touchpoint gets its `facet`. Unknown names (feature not in any consolidation) → `facet: "unknown"`.
- `capability` is filled by Component 4 (or a mechanical fallback).
- `refCount` and `service` are preserved for backward compatibility.

`clientLayers[]` in each feature also gains per-facet `units` (keys are platforms for mobile, repos for web) sourced from `implementations[].platform`/`implementations[].repo`. Existing `platforms` dict and backward-compat `clientLayer` field are retained.

### Component 4 — Bounded LLM capability review (`capability_review.py`)

A candidate→verify pass over the deterministic `serverIndex`. Mirrors `association_discovery`'s structure (`build_*_prompt` / `parse_*_response` / `_call_llm` placeholder overridden by the agent).

**Runs only for domains with ≥2 touchpoints across ≥2 facets** (single-touchpoint or single-facet domains get a mechanical label, no LLM cost).

```python
def build_review_prompt(domain_name, domain_summary, touchpoints) -> str: ...
def parse_review_response(response, domain_name) -> dict: ...   # {label, relationship, summary, flagged: [{feature, reason}]}
def _call_llm(prompt: str) -> str:                              # placeholder; agent overrides in production
    raise NotImplementedError("LLM call not configured.")
def run_capability_review(project_root_str) -> dict: ...        # reads business-features.json, enriches serverIndex.capability, writes back
```

**LLM tasks (bounded — judges within the given grouping, never invents groupings):**
1. Classify the relationship of the touchpoints: `replication` | `complementary-split` | `shared-infrastructure`.
2. Produce a canonical `label` + one-line `summary` of how the clients divide the work.
3. `flagged[]`: touchpoints whose association to this domain looks implausible (advisory only — annotate `touchpoint.flagged = {reason}`; never auto-delete).

For `relationship == "shared-infrastructure"` (e.g. many unrelated features touching `AuthService`), `label` stays the domain's own name and the summary notes it is shared infra — i.e. do **not** assert the touchpoints are one capability.

**Degradation (no LLM / `NotImplementedError` / parse failure):** `capability = {label: <domain display name>, relationship: "unknown", summary: ""}`, no `flagged`. The knowledge base remains complete; only the semantic labels are mechanical.

**Caching:** hash `(domain_name + sorted touchpoint identities)`; unchanged groupings reuse the previous review (same `_promptHash` pattern as `association_discovery`).

**Placement:** a new step after `assemble_business_features` in the feature-centric route (Assembly Routing → assemble → `capability_review`). Added to `understand-business/SKILL.md` as a feature-centric assembly step, described like the existing LLM phases.

### Data flow

```
frontend-graph.json (Spec 1) ─┐
client-graph.json + wiki/domains ─┤
                                  ▼
   client_facets.load_client_features  ──►  {consolidated, standalone, infrastructure} per facet
                                  ▼
   association_discovery (Phase 2, existing)  ──►  each client feature → server domains
                                  ▼
   assemble_business_features  ──►  features[] (clientLayers + units) + serverIndex (touchpoints, deterministic join)
                                  ▼
   capability_review (LLM, bounded)  ──►  serverIndex[domain].capability {label, relationship, summary}
                                  ▼
   business-features.json  (complete, server-anchored, labeled)
```

### Error handling / degradation

- Unsupported client facet type (`desktop`, etc. with no strategy) → recorded in `unsupportedFacets`, pipeline continues. Adding support later = register one strategy, zero pipeline edits.
- `frontend-graph.json` missing/unparseable → empty consolidation for that facet (no crash); that facet contributes no features.
- No LLM available → mechanical capability labels (above).
- Mobile-only project → registry dispatches only `consolidate_mobile`; `serverIndex` touchpoints all `facet=mobile`; output is shape-compatible with today's plus the additive `touchpoints`/`capability` fields. (Regression-tested.)

### Backward compatibility

- `business-features.json` additions are additive: `serverIndex[domain].touchpoints` (alongside retained `refCount`/`service`), `serverIndex[domain].capability`, `clientLayers[].units`. The retained `features[]`, `clientLayer`, `serverLayer`, and `stats` keep their shapes. `serverIndex[domain].features` (legacy name-list) is retained as a derived convenience to avoid breaking existing readers.
- All LLM additions degrade to deterministic values, so a no-LLM run still produces valid output.

---

## Testing strategy

`tests/understand-business/`:

**Registry + `consolidate_frontend`**
1. `consolidate_frontend` reads a fixture `frontend-graph.json` → `{consolidated, standalone, infrastructure}`; a multi-repo feature yields `implementations` with one entry per `sourceRepo`.
2. Infra-named feature (`Layout`, `ThemeProvider`) → lands in `infrastructure`, not `consolidated`.
3. Single-repo `frontend-graph.json` → consolidated entries with single-repo `implementations`.
4. Missing/corrupt `frontend-graph.json` → empty consolidation, no exception; path-traversal guard rejects an absolute `facet.path` (returns empty).
5. `load_client_features` dispatch: `mobile`→mobile shape, `frontend`→frontend shape, unknown type→`None`.
6. **De-duplication regression:** the frontend feature list produced via `association_discovery`'s path equals the one via `assemble`'s path (both now call the registry) — guards against the historic drift.

**Server-anchored `serverIndex`**
7. Two features (one `facet=frontend`, one `facet=mobile`) sharing `OrderService` → one `serverIndex` entry with two `touchpoints` carrying correct `facet`/`role`.
8. Complementary split: web "下单创建" (primary Order) + mobile "订单跟踪" (primary Order, supporting Push) → grouped under Order via overlapping-set join.
9. `clientLayers[].units`: web layer keyed by repos (`web-app`,`admin`); mobile layer keyed by platforms.

**Capability review**
10. Valid LLM response → `capability {label, relationship, summary}` enriched; `shared-infrastructure` response keeps domain name as label and does not assert one capability.
11. Malformed response / `NotImplementedError` (no LLM) → mechanical fallback `{label: <domain>, relationship: "unknown"}`.
12. Single-facet domain (only mobile touchpoints) → no LLM call, mechanical label.
13. Flagged association → annotated `touchpoint.flagged`, association NOT deleted.

**Backward compat**
14. Mobile-only project → `business-features.json` matches a snapshot of today's output plus only the additive fields (no removed/renamed keys).

---

## Out of scope (future)

- **LLM cross-axis merge for disjoint-domain splits** (two halves touching entirely different backend domains). Represented via server-side `businessFlows` for now; revisit with LLM only if real data shows this pattern is common.
- **Pure client-only capability merge** (features with no backend dependency, e.g. offline mode) — each client copy stands alone.
- **`desktop` / other client facet types** — the registry makes these a one-line addition when needed; not built now (YAGNI).
- **Frontend `SEMANTIC_FAMILIES`** for `domainLinks` (Spec 1 deferred this; add only if web naming proves inconsistent in practice).
