# Frontend Graph Aggregator (Spec 1) Design

**Goal:** Make `frontend-graph.json` a multi-repo aggregate so a web facet composed of several repos (e.g. `web-app/` + `admin/`) is analyzed as one coherent frontend axis — mirroring how `build-client-graph.py` aggregates mobile platforms into `client-graph.json`.

**Architecture:** Enhance the existing `build-frontend-graph.py` from a single-repo tool into an aggregator. It discovers the web facet's sub-repos, runs the existing per-repo extraction on each, unions the results with per-repo provenance, and emits cross-repo `domainLinks[]`. No new artifact name, no new wiring, no new LLM.

**Tech Stack:** Python 3 (stdlib only: `json`, `re`, `hashlib`, `pathlib`), Node-driven `workflow.js` orchestration (unchanged), pytest fixtures under `tests/understand-wiki/`.

---

## Context: where this sits

This is **Sub-project 1 of 2** in making `frontend` a fully peer repo-type, symmetric with `mobile` and `backend` across the three analysis skills:

| Stage | backend | mobile | frontend |
|-------|---------|--------|----------|
| `understand-domain` flow strategy | backend-flow | mobile-flow | frontend-flow ✓ (exists) |
| wiki per-unit human docs | service wiki | platform `wiki/domains` | repo `wiki/domains` ✓ (exists) |
| wiki per-axis machine aggregate | `build-system-graph.py` → `system-graph.json` | `build-client-graph.py` → `client-graph.json` | **`build-frontend-graph.py` → `frontend-graph.json`** ← THIS SPEC |
| business domain consolidation | `_load_server_domains` | `_consolidate_mobile_domains` | `consolidate_frontend` ← Spec 2 |

**Spec 2 (out of scope here)** consumes the `frontend-graph.json` this spec produces: a `consolidate_frontend` strategy (symmetric to `_consolidate_mobile_domains`, reading `domainLinks[]`), a client-facet strategy registry that collapses today's duplicated frontend-loading code, a server-domain-anchored `serverIndex` view (cross-axis unification via shared backend domains, not client↔client merge), and one bounded LLM review pass that classifies/labels those server-anchored groupings.

## Key decision: `frontend-graph.json` IS the aggregate

`frontend-graph.json` plays the exact role `client-graph.json` plays for mobile — the **per-axis machine artifact consumed by business**. It is NOT a per-repo artifact.

Consequences:
- A web repo running wiki in single-service mode produces only standard `wiki/domains` (human docs), exactly like a mobile platform. It does **not** emit a per-repo `frontend-graph.json`.
- There is **no** separate `web-graph.json`. `frontend-graph.json` carries the multi-repo aggregate (a `repos[]` dimension + cross-repo `domainLinks[]`).
- For a single-repo web facet, the aggregate trivially contains one repo — current output shape is preserved.

## Background: current state

`build-frontend-graph.py` today (`build_frontend_graph(service_root_str)`):
- Reads `<service-root>/.understand-anything/{knowledge-graph,domain-graph}.json` — a **single** repo.
- Extracts `routes`, `pages`, `components`, `stateStores`, `apiCalls`, `features[]` from that one repo.
- Writes `<service-root>/.understand-anything/frontend-graph.json`.

`workflow.js` (line ~861-865) already routes the frontend batch case to `build-frontend-graph.py "${projectRoot}"`. `verify-wiki-completeness.py` already requires `frontend-graph.json`. So the **wiring is already correct** — only the script needs to become multi-repo aware.

`build-client-graph.py` is the reference aggregator: it finds the mobile facet, iterates `subPaths` (with a directory-scan fallback), loads each platform's `wiki/domains`, and builds `domainLinks[]` by exact normalized-name matching across platforms (`canonicalFeature` + `mappings: {platform: domain_id}`).

---

## Design

### Component: enhanced `build-frontend-graph.py`

Three additions, no behavior change for single-repo inputs.

#### 1. Repo discovery — `_discover_repos(root: Path) -> list[tuple[str, Path]]`

Returns `[(repo_name, repo_root), ...]`. Resolution order:

1. **Single-repo (current behavior):** if `root/.understand-anything/domain-graph.json` exists, return `[(root.name, root)]`.
2. **Multi-repo aggregate:** otherwise, scan `root`'s immediate subdirectories; each `d` where `d/.understand-anything/domain-graph.json` exists is a web repo → `(d.name, d)`, sorted by name.
3. If a `system.json` is discoverable (at `root` or its parent) with a `frontend` facet declaring `subPaths`, use those subPaths to select/order the repos instead of a raw scan. This honors explicit config (layout B: `web/{web-app,admin}`) while the scan handles zero-config layouts.

Directory scan is the robust default (no dependency on `system.json` location), mirroring `build-client-graph.py`'s subPaths-then-scan fallback.

#### 2. Per-repo extraction + provenance

For each `(repo_name, repo_root)`, run the **existing** extraction functions (`_extract_routes`, `_extract_pages`, `_extract_components`, `_extract_state_stores`, `_extract_api_calls`, `_build_features`) against that repo's root + KG. Provenance is added **only where it is non-breaking and actually needed**:

- `routes`, `pages`, `components`, `stateStores`: stay **`sorted(set(...))` string lists** (their current type), unioned across repos. **No per-item `repo` field** — changing these from strings to objects would break the existing schema/consumers for zero downstream benefit (Spec 2's `consolidate_frontend` works at the feature level, not the inventory level). Per-route provenance, if ever needed, is derivable from `features[].routes` + `features[].sourceRepos`.
- `apiCalls`: already objects `{method, path, source}` → gain `"repo": "<repo_name>"` (additive, non-breaking).
- `features[]`: gain `"sourceRepos": ["<repo_name>"]` (a list, so cross-repo matches list multiple repos). This is the provenance Spec 2 actually consumes.

For a single repo, `apiCalls[].repo` and `features[].sourceRepos` are still populated (with that one repo's name). All additions are **additive** — existing consumers (`association_discovery._load_frontend_features`, `assemble_business_features`) read `features[].{name, routes, apiCalls}` and ignore unknown fields, so no consumer breaks.

#### 3. Cross-repo `domainLinks[]`

Mirror `build-client-graph._build_domain_links`, minus mobile semantic families:

- Normalize each feature name (`name.lower().replace('-', '_').replace(' ', '_')`).
- Group features by normalized name across repos.
- When ≥2 repos share a normalized name, emit one link:
  `{ "canonicalFeature": "<first repo's display name>", "mappings": { "<repo>": "<feature_id>", ... } }`.
- **No `SEMANTIC_FAMILIES`** (YAGNI — web repos usually share a design language and name consistently; add families later only if real data needs it).

When `features[]` from different repos share a name, they are merged into a single aggregate feature whose `sourceRepos` lists all contributing repos and whose `routes`/`apiCalls`/`components` are the union (deduped). Features unique to one repo stay as single-`sourceRepos` entries (union, not merge — this is the common case for distinct modules like admin-only pages).

### Aggregate `frontend-graph.json` schema

```json
{
  "version": "1.0.0",
  "facetType": "frontend",
  "project": {
    "name": "<facet or root name>",
    "frameworks": ["Next.js", "React"],
    "languages": ["TypeScript"],
    "provenance": {
      "generationMode": "wiki",
      "degraded": false,
      "generatedAt": "2026-06-17T00:00:00.000Z",
      "gitCommitHash": ""
    }
  },
  "repos": ["admin", "web-app"],
  "routes":     ["/login", "/orders"],
  "pages":      ["pages/orders/index.tsx"],
  "components": ["components/orders/OrderList.tsx"],
  "stateStores":["stores/auth.ts", "stores/order.ts"],
  "apiCalls":   [{ "method": "POST", "path": "/api/orders", "source": "api/orders.ts", "repo": "web-app" }],
  "features": [
    {
      "id": "feature:auth",
      "name": "用户认证",
      "sourceDomain": "domain:auth",
      "sourceRepos": ["admin", "web-app"],
      "routes": ["/login"],
      "pages": [],
      "components": [],
      "stateStores": ["stores/auth.ts"],
      "apiCalls": [{ "method": "POST", "path": "/api/login", "source": "api/auth.ts", "lineRange": [] }],
      "uiRules": [], "interactionRules": [], "stateTransitions": [], "apiSequence": []
    }
  ],
  "domainLinks": [
    { "canonicalFeature": "用户认证", "mappings": { "admin": "feature:auth", "web-app": "feature:auth" } }
  ],
  "contentHash": "sha256:..."
}
```

New fields vs today: `repos[]`, `domainLinks[]`, `apiCalls[].repo`, `features[].sourceRepos`. Top-level `routes`/`pages`/`components`/`stateStores` keep their string-list type (unioned). For a single-repo facet, `repos` has one entry, `domainLinks` is `[]`, and the output is shape-compatible with today's.

### Wiring — no changes needed

- `workflow.js` already calls `build-frontend-graph.py "${projectRoot}"` in the frontend batch path. With `projectRoot = web/`, the enhanced script discovers `web/`'s sub-repos. No edit.
- `verify-wiki-completeness.py` already requires `frontend-graph.json` for `repo_type == "frontend"` (both single and batch read it at the service/parent root). No edit. (Single web repo: the gate finds the single-repo `frontend-graph.json`; multi-repo: it finds the aggregate at `web/`.)

This is the payoff of treating `frontend-graph.json` as the aggregate: the integration points already point at the right artifact.

### Data flow

```
web/web-app/.understand-anything/{knowledge-graph,domain-graph}.json ─┐
web/admin/.understand-anything/{knowledge-graph,domain-graph}.json   ─┤
                                                                      ▼
                              build-frontend-graph.py  web/   (batch)
                              ├─ _discover_repos → [admin, web-app]
                              ├─ per-repo extract (+repo provenance)
                              ├─ union routes/pages/components/stores/apiCalls
                              ├─ merge/union features (+sourceRepos)
                              └─ domainLinks by cross-repo name match
                                                                      ▼
                              web/.understand-anything/frontend-graph.json
                                                                      ▼
                              (Spec 2) business: consolidate_frontend reads it
```

### Error handling / degradation

- **< 2 repos discovered, but root itself is a repo:** single-repo path — `repos=[name]`, `domainLinks=[]`, output unchanged.
- **A sub-repo missing `domain-graph.json` or `knowledge-graph.json`:** skip that repo, `print` a `WARN` to stderr, continue with the rest. Do not abort.
- **Zero repos with usable graphs:** raise `FileNotFoundError` (same failure class the script already raises), so `workflow.js` surfaces it.
- **`_validate` on the aggregate:** existing validation (facetType, provenance present, non-empty features with evidence) runs on the unioned graph. If features exist but none has route/page/API/store/component evidence → invalid (abort), same as today. Partial evidence → `degraded=True` + warnings, same as today.
- **`contentHash`:** computed after all fields (including `degraded`) are finalized, then appended — preserve the existing ordering fix.

### Backward compatibility

- Single-repo web facets: identical output shape plus the additive `repos`/`repo`/`sourceRepos` fields and an empty `domainLinks`. Existing readers ignore the new fields.
- The CLI stays `python3 build-frontend-graph.py <root>`; `<root>` may now be either a single repo (current) or a parent containing web sub-repos (new).

---

## Testing strategy

New/updated tests in `tests/understand-wiki/test_build_frontend_graph.py` (fixtures build temp dirs with `.understand-anything/{knowledge-graph,domain-graph}.json` per repo):

1. **Multi-repo union (distinct modules):** `web-app` has `订单` feature, `admin` has `权限` feature, no shared names → aggregate `features` contains both, `domainLinks == []`, each feature's `sourceRepos` is single, `repos == ["admin", "web-app"]`.
2. **Cross-repo shared feature:** both repos have `用户认证` → one merged feature with `sourceRepos == ["admin", "web-app"]`, routes/apiCalls unioned+deduped, exactly one `domainLink` whose `mappings` covers both repos.
3. **Provenance tagging:** every `apiCalls` item carries a `repo` field matching its source repo; top-level `routes` remains a flat string list (assert it is `list[str]`, not objects — guards the non-breaking decision).
4. **Single-repo backward compat:** root has its own `domain-graph.json` → `repos` has one entry, `domainLinks == []`, feature shape matches the pre-change output (assert against a snapshot of today's fields).
5. **Missing sub-repo graph:** one sub-repo lacks `domain-graph.json` → it is skipped, a WARN is emitted, other repos still aggregate (assert remaining repo present, no exception).
6. **contentHash verifiable:** strip `contentHash`, re-serialize with `indent=2, ensure_ascii=False`, re-hash → equals the stored hash.
7. **explicit subPaths from system.json:** a `system.json` with a `frontend` facet listing `subPaths` selects/orders repos accordingly (layout B), overriding raw scan order.

Gate tests in `tests/understand-wiki/` (or existing completeness test file):

8. **frontend batch gate:** `verify-wiki-completeness.py <web/> --mode=batch --repo-type=frontend --parent-root=<web/>` errors when `frontend-graph.json` absent, passes when present (confirm no regression from the schema change).

---

## Out of scope (Spec 2 — understand-business)

- `consolidate_frontend(project_root, facet)` reading `frontend-graph.json` `domainLinks[]` (symmetric to `_consolidate_mobile_domains` reading `client-graph.json`).
- Client-facet strategy registry collapsing the two duplicated frontend loaders (`association_discovery._load_frontend_features` + the inline branch in `assemble_business_features`).
- Server-domain-anchored unification: cross-axis grouping via shared backend-domain sets (primary+supporting overlap), enriched `serverIndex` carrying `{facet, feature, role}`. No client↔client merge.
- One bounded LLM review pass over the deterministic server-anchored groupings: classify relationship (replication / complementary-split / shared-infra), produce a canonical capability label, sanity-check associations. Degrades to mechanical labels without an LLM.
- Cross-axis split across **disjoint** backend domains is represented as a server-side `businessFlows` journey (existing), not forced into one feature.
