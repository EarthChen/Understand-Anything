# Business Landscape Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the core cross-facet capabilities: extend `/understand-wiki` for mobile repositories (M1) and create the `/understand-business` skill for cross-facet domain aggregation (M2).

**Architecture:** Two sequential milestones — M1 extends the KG schema with `consumes_api` edge type and adapts wiki generation for mobile repos; M2 builds a new skill that matches domains across facets and generates interaction documents. Both milestones build on Phase 1 infrastructure (checkpoint-writer, resume-utils, config-reader).

**Tech Stack:** TypeScript (types/schema), JavaScript/ESM (shared utilities), Python (scripts), Vitest (unit tests), zod (schema validation)

**Design Spec:** `docs/superpowers/specs/2026-06-08-business-landscape-phase2-design.md`

---

## File Structure

### M1 New Files

| File | Responsibility |
|------|---------------|
| `understand-anything-plugin/skills/understand-wiki/build-client-graph.py` | Build client-graph.json from platform wikis (symmetric to build-system-graph.py) |

### M1 Modified Files

| File | Changes |
|------|---------|
| `understand-anything-plugin/packages/core/src/types.ts` | Add `consumes_api` edge type + `ApiCallMeta` interface |
| `understand-anything-plugin/packages/core/src/schema.ts` | Add `consumes_api` to EdgeTypeSchema enum + alias `"api_call"` |
| `understand-anything-plugin/packages/core/src/__tests__/schema.test.ts` | Add `consumes_api` edge validation tests |
| `understand-anything-plugin/skills/understand/SKILL.md` | Add `consumes_api` to edge type table |
| `understand-anything-plugin/skills/understand/languages/kotlin.md` | Add API call detection guidance (Retrofit, OkHttp) |
| `understand-anything-plugin/skills/understand/languages/swift.md` | Add API call detection guidance (URLSession, Alamofire) |
| `understand-anything-plugin/skills/understand/languages/objc.md` | Add API call detection guidance (NSURLSession, AFNetworking) |
| `understand-anything-plugin/skills/understand-wiki/SKILL.md` | Add `--repo-type` parameter documentation |
| `understand-anything-plugin/skills/understand-wiki/docs/wiki-phase0-prerequisites.md` | Add repo-type detection + server wiki check |
| `understand-anything-plugin/skills/understand-wiki/docs/wiki-phase1-generation.md` | Add wiki-worker mobile prompt branching |
| `understand-anything-plugin/skills/understand-wiki/docs/wiki-phase3-crossservice.md` | Add mobile mode client-graph.json generation |
| `understand-anything-plugin/agents/wiki-worker.md` | Add mobile mode prompt section |

### M2 New Files

| File | Responsibility |
|------|---------------|
| `understand-anything-plugin/skills/understand-business/SKILL.md` | 5-phase execution flow for business-landscape generation |
| `understand-anything-plugin/skills/understand-business/check_facets.py` | Phase 0: check facet availability from system.json |
| `understand-anything-plugin/skills/understand-business/domain_matcher.py` | Phase 1: deterministic domain matching (API + name + manual) |
| `understand-anything-plugin/skills/understand-business/assemble_landscape.py` | Phase 3: merge matches, generate domains.json + cross-facet-links.json |
| `understand-anything-plugin/skills/understand-business/validate_domain.py` | Phase 4: validate per-domain interaction document (DAG structure) |
| `understand-anything-plugin/skills/understand-business/validate_landscape.py` | Phase 5: full schema + reference integrity validation |
| `tests/understand-business/test_domain_matcher.py` | Unit tests for domain_matcher.py |
| `tests/understand-business/test_validate_domain.py` | Unit tests for validate_domain.py |
| `tests/understand-business/test_assemble_landscape.py` | Unit tests for assemble_landscape.py |
| `tests/understand-business/test_check_facets.py` | Unit tests for check_facets.py |
| `tests/understand-business/test_validate_landscape.py` | Unit tests for validate_landscape.py |

---

## M1 Tasks

### Task 1: KG Schema — `consumes_api` Edge Type

**Files:**
- Modify: `understand-anything-plugin/packages/core/src/types.ts`
- Modify: `understand-anything-plugin/packages/core/src/schema.ts`
- Modify: `understand-anything-plugin/packages/core/src/__tests__/schema.test.ts`

- [ ] **Step 1: Write failing test for `consumes_api` edge validation**

Add to `understand-anything-plugin/packages/core/src/__tests__/schema.test.ts` inside the existing edge validation describe block:

```typescript
it('accepts consumes_api edge type', () => {
  const graph = {
    nodes: [
      { id: 'function:OrderRepo.kt:createOrder', type: 'function', name: 'createOrder', filePath: 'OrderRepo.kt', summary: 'Creates order' },
      { id: 'endpoint:OrderRepo.kt:POST /api/orders', type: 'endpoint', name: 'POST /api/orders', filePath: 'OrderRepo.kt', summary: 'Order creation endpoint' },
    ],
    edges: [
      { source: 'function:OrderRepo.kt:createOrder', target: 'endpoint:OrderRepo.kt:POST /api/orders', type: 'consumes_api', weight: 0.7 },
    ],
    layers: [],
    tour: [],
  };
  const result = validateGraph(graph);
  expect(result.tier).toBe(0);
});

it('normalizes api_call alias to consumes_api', () => {
  const graph = {
    nodes: [
      { id: 'function:a', type: 'function', name: 'a', filePath: 'a.kt', summary: 'a' },
      { id: 'endpoint:b', type: 'endpoint', name: 'b', filePath: 'b.kt', summary: 'b' },
    ],
    edges: [
      { source: 'function:a', target: 'endpoint:b', type: 'api_call', weight: 0.7 },
    ],
    layers: [],
    tour: [],
  };
  const fixed = autoFixGraph(graph);
  expect(fixed.edges[0].type).toBe('consumes_api');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd understand-anything-plugin && pnpm test -- --grep "consumes_api"` from workspace root.
Expected: FAIL — `consumes_api` not in EdgeTypeSchema enum.

- [ ] **Step 3: Add `consumes_api` to types.ts**

In `understand-anything-plugin/packages/core/src/types.ts`, add `"consumes_api"` after the RPC edge types:

```typescript
// Edge types (39 total in 8 categories: Structural, Behavioral, Data flow, Dependencies, Semantic, Infrastructure/Schema, Domain, Knowledge)
export type EdgeType =
  | "imports" | "exports" | "contains" | "inherits" | "implements"  // Structural
  | "calls" | "subscribes" | "publishes" | "middleware"              // Behavioral
  | "provides_rpc" | "consumes_rpc"                                  // RPC (cross-service)
  | "consumes_api"                                                    // API consumption (client→server)
  | "injects"                                                        // Dependency Injection
  | "reads_from" | "writes_to" | "transforms" | "validates"         // Data flow
  | "depends_on" | "tested_by" | "configures"                       // Dependencies
  | "related" | "similar_to"                                         // Semantic
  | "deploys" | "serves" | "provisions" | "triggers"                // Infrastructure
  | "migrates" | "documents" | "routes" | "defines_schema"          // Schema/Data
  | "contains_flow" | "flow_step" | "cross_domain"                  // Domain
  | "cites" | "contradicts" | "builds_on" | "exemplifies" | "categorized_under" | "authored_by"; // Knowledge

// Metadata for consumes_api edges (client function → server endpoint)
export interface ApiCallMeta {
  method: string;   // "GET" | "POST" | "PUT" | "DELETE" | "PATCH"
  path: string;     // "/api/orders" or "/api/orders/{id}"
}
```

Update the comment to say "39 total" instead of "38 total".

- [ ] **Step 4: Add `consumes_api` to schema.ts**

In `understand-anything-plugin/packages/core/src/schema.ts`:

1. Add `"consumes_api"` to the `EdgeTypeSchema` enum after `"consumes_rpc"`:
```typescript
export const EdgeTypeSchema = z.enum([
  "imports", "exports", "contains", "inherits", "implements",
  "calls", "subscribes", "publishes", "middleware",
  "provides_rpc", "consumes_rpc",
  "consumes_api",                                                    // API consumption (client→server)
  "injects",
  // ... rest unchanged
]);
```

Update the comment to say "39 values".

2. Add `api_call` to `EDGE_TYPE_ALIASES`:
```typescript
export const EDGE_TYPE_ALIASES: Record<string, string> = {
  // ... existing aliases ...
  api_call: "consumes_api",
  http_call: "consumes_api",
  // ... rest unchanged
};
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd understand-anything-plugin && pnpm test`
Expected: All tests PASS including the new `consumes_api` tests.

- [ ] **Step 6: Commit**

```bash
git add understand-anything-plugin/packages/core/src/types.ts understand-anything-plugin/packages/core/src/schema.ts understand-anything-plugin/packages/core/src/__tests__/schema.test.ts
git commit -m "feat(kg): add consumes_api edge type for client→server API call tracking"
```

---

### Task 2: Mobile Language Snippets — API Call Detection Guidance

**Files:**
- Modify: `understand-anything-plugin/skills/understand/languages/kotlin.md`
- Modify: `understand-anything-plugin/skills/understand/languages/swift.md`
- Modify: `understand-anything-plugin/skills/understand/languages/objc.md`

- [ ] **Step 1: Add API call detection section to kotlin.md**

Append before the "Example Language Notes" section:

```markdown
## API Call Detection

When analyzing mobile/client code, identify HTTP API calls and create `consumes_api` edges with `{ method, path }` metadata:

- **Retrofit interfaces**: `@GET("/api/orders")`, `@POST("/api/orders/{id}")` → Create `endpoint` node for the API path, `consumes_api` edge from the interface method to the endpoint. Metadata: `{ "method": "GET", "path": "/api/orders" }`
- **OkHttp direct calls**: `Request.Builder().url("https://...").post(body).build()` → Extract URL path and HTTP method
- **Ktor client**: `client.get("https://...") {}`, `client.post("https://...") {}` → Extract path and method from function name
- **Dynamic URL construction**: If URL is built from variables/constants, extract the static path template; use `{param}` for path parameters (e.g., `/api/orders/{orderId}`)

For each unique API path discovered, create an `endpoint` node and a `consumes_api` edge from the calling function/class to that endpoint.
```

- [ ] **Step 2: Add API call detection section to swift.md**

Append before the "Example Language Notes" section:

```markdown
## API Call Detection

When analyzing mobile/client code, identify HTTP API calls and create `consumes_api` edges with `{ method, path }` metadata:

- **URLSession**: `URLSession.shared.dataTask(with: url)` — extract URL path; method from `URLRequest.httpMethod` (default: "GET")
- **Alamofire**: `AF.request("https://.../api/orders", method: .post)` → Extract path and method
- **Moya**: Target enum cases with `path` and `method` properties → Extract from enum definition
- **Async/await**: `let (data, _) = try await URLSession.shared.data(from: url)` → Extract URL path

For each unique API path discovered, create an `endpoint` node and a `consumes_api` edge from the calling function/class to that endpoint.
```

- [ ] **Step 3: Add API call detection section to objc.md**

Append before the "Example Language Notes" section (or at end if no such section):

```markdown
## API Call Detection

When analyzing mobile/client code, identify HTTP API calls and create `consumes_api` edges with `{ method, path }` metadata:

- **NSURLSession**: `[[NSURLSession sharedSession] dataTaskWithRequest:request]` — extract URL from `NSURLRequest`, method from `HTTPMethod` property
- **AFNetworking**: `[manager GET:@"/api/orders" parameters:nil ...]`, `[manager POST:@"/api/orders" ...]` → Extract path from first argument, method from selector name
- **NSURLConnection (legacy)**: `[NSURLConnection sendAsynchronousRequest:...]` → Extract URL and method from NSURLRequest

For each unique API path discovered, create an `endpoint` node and a `consumes_api` edge from the calling function/class to that endpoint.
```

- [ ] **Step 4: Commit**

```bash
git add understand-anything-plugin/skills/understand/languages/kotlin.md understand-anything-plugin/skills/understand/languages/swift.md understand-anything-plugin/skills/understand/languages/objc.md
git commit -m "feat(kg): add API call detection guidance to mobile language snippets"
```

---

### Task 3: /understand SKILL.md — Edge Type Table Update

**Files:**
- Modify: `understand-anything-plugin/skills/understand/SKILL.md`

- [ ] **Step 1: Add `consumes_api` to Edge Types table**

Find the Edge Types table (around line 904) and add `consumes_api` to the Behavioral category:

Change:
```markdown
### Edge Types (26 total)
| Category | Types |
|---|---|
| Structural | `imports`, `exports`, `contains`, `inherits`, `implements` |
| Behavioral | `calls`, `subscribes`, `publishes`, `middleware` |
```

To:
```markdown
### Edge Types (27 total)
| Category | Types |
|---|---|
| Structural | `imports`, `exports`, `contains`, `inherits`, `implements` |
| Behavioral | `calls`, `subscribes`, `publishes`, `middleware`, `consumes_api` |
```

- [ ] **Step 2: Add `consumes_api` to Edge Weight Conventions table**

Add a row after the `imports` weight entry:

```markdown
| `consumes_api` | 0.7 |
```

- [ ] **Step 3: Commit**

```bash
git add understand-anything-plugin/skills/understand/SKILL.md
git commit -m "docs(understand): add consumes_api to edge type table"
```

---

### Task 4: /understand-wiki — `--repo-type` Parameter & Phase 0 Extension

**Files:**
- Modify: `understand-anything-plugin/skills/understand-wiki/SKILL.md`
- Modify: `understand-anything-plugin/skills/understand-wiki/docs/wiki-phase0-prerequisites.md`

- [ ] **Step 1: Add `--repo-type` to SKILL.md Options section**

In the Options section (around line 13), add after the `--language` option:

```markdown
  - `--repo-type <type>` — Repository type: `backend` (default), `mobile`, or `frontend`. Controls wiki-worker prompt focus, domain classification strategy, and Phase 3 aggregation output.
```

Also update the `argument-hint` on line 4:

```markdown
argument-hint: ["[--batch] [--service=<name>] [--review] [--full] [--force] [--dry-run] [--continue-on-error] [--language <lang>] [--repo-type <type>]"]
```

- [ ] **Step 2: Add repo-type detection to Phase 0 prerequisites**

Read `understand-anything-plugin/skills/understand-wiki/docs/wiki-phase0-prerequisites.md` and add a new section after the existing detection logic:

```markdown
### Repo Type Detection

Parse `--repo-type` from `$ARGUMENTS`. Valid values: `backend` (default), `mobile`, `frontend`.

```bash
REPO_TYPE="backend"
if echo "$ARGUMENTS" | grep -q -- "--repo-type"; then
  REPO_TYPE=$(echo "$ARGUMENTS" | sed -n 's/.*--repo-type[= ]\([a-z]*\).*/\1/p')
fi
echo "[understand-wiki] Repo type: $REPO_TYPE"
```

**If `REPO_TYPE=mobile`:**

1. Read `system.json` to find server facet path:
```bash
SERVER_FACET_PATH=""
if [ -f "$PROJECT_ROOT/.understand-anything/system.json" ]; then
  SERVER_FACET_PATH=$(python3 -c "
import json, sys
with open('$PROJECT_ROOT/.understand-anything/system.json') as f:
    data = json.load(f)
for facet in data.get('facets', []):
    if facet.get('type') == 'backend':
        print(facet.get('path', ''))
        break
")
fi
```

2. Check if server wiki exists:
```bash
SERVER_WIKI_AVAILABLE=false
if [ -n "$SERVER_FACET_PATH" ] && [ -f "$PROJECT_ROOT/$SERVER_FACET_PATH/.understand-anything/wiki/meta.json" ]; then
  SERVER_WIKI_AVAILABLE=true
  echo "[understand-wiki] Server wiki found at $SERVER_FACET_PATH — will use for precise domain classification"
else
  echo "[understand-wiki] WARNING: Server wiki not found — domain classification will use code-structure inference (degraded accuracy)"
fi
```

3. Store in phase context: `REPO_TYPE`, `SERVER_WIKI_AVAILABLE`, `SERVER_FACET_PATH`
```

- [ ] **Step 3: Commit**

```bash
git add understand-anything-plugin/skills/understand-wiki/SKILL.md understand-anything-plugin/skills/understand-wiki/docs/wiki-phase0-prerequisites.md
git commit -m "feat(wiki): add --repo-type parameter and mobile detection in Phase 0"
```

---

### Task 5: /understand-wiki — Phase 1 Mobile Prompt & Domain Classification

**Files:**
- Modify: `understand-anything-plugin/skills/understand-wiki/docs/wiki-phase1-generation.md`
- Modify: `understand-anything-plugin/agents/wiki-worker.md`

- [ ] **Step 1: Read current wiki-worker.md to understand existing prompt structure**

Read `understand-anything-plugin/agents/wiki-worker.md` to understand the existing prompt template and identify where to add mobile mode branching.

- [ ] **Step 2: Add mobile mode prompt section to wiki-worker.md**

Add a new section after the existing prompt instructions:

```markdown
### Mobile Mode (`REPO_TYPE=mobile`)

When generating wiki for a mobile repository, adjust content focus:

**Content priorities (replace backend defaults):**
- **Screens & Navigation**: Document each screen/activity/view controller, navigation flows between screens, deep link handling
- **API Calls**: Document all HTTP API calls (endpoints consumed), request/response formats, error handling
- **State Management**: ViewModel/Store/BLoC patterns, data persistence (Room/Core Data/SharedPreferences)
- **Offline Strategy**: Cache policies, sync mechanisms, conflict resolution
- **Platform-Specific**: Push notifications, permissions, background tasks

**Domain classification strategy:**

IF `SERVER_WIKI_AVAILABLE=true`:
1. Load server wiki domain→endpoint mapping from `$SERVER_FACET_PATH/.understand-anything/wiki/`
2. For each candidate domain in client code:
   - Extract `consumes_api` edges from the client KG
   - Match API paths to server endpoints
   - Classify: client domain = server domain that owns the matched endpoints
3. Unmatched domains: classify from code structure/naming (mark as degraded confidence)

IF `SERVER_WIKI_AVAILABLE=false`:
1. Classify all domains from code structure/directory naming
2. Mark all domain classifications as degraded confidence
3. Record `sourceHashes["server/system-graph"] = null` in meta.json

**Entity naming conventions for mobile:**
- Use screen/activity names as primary entities (e.g., `OrderListScreen`, `OrderDetailActivity`)
- Use ViewModel/Repository names as secondary entities (e.g., `OrderViewModel`, `OrderRepository`)
- API call sites are tertiary (e.g., `OrderApiService.createOrder()`)
```

- [ ] **Step 3: Add mobile branching to Phase 1 generation doc**

In `docs/wiki-phase1-generation.md`, add a note about repo-type-aware wiki-worker dispatch:

```markdown
### Repo-Type-Aware Worker Dispatch

When dispatching wiki-worker agents, pass the `REPO_TYPE` context:

- `REPO_TYPE=backend` (default): Use existing backend-focused prompt
- `REPO_TYPE=mobile`: Use mobile-focused prompt (screens, API calls, state management)
- `REPO_TYPE=frontend`: Use frontend-focused prompt (routes, components, API calls, state)

Also pass `SERVER_WIKI_AVAILABLE` and `SERVER_FACET_PATH` when `REPO_TYPE=mobile` so the wiki-worker can perform server-aware domain classification.
```

- [ ] **Step 4: Commit**

```bash
git add understand-anything-plugin/agents/wiki-worker.md understand-anything-plugin/skills/understand-wiki/docs/wiki-phase1-generation.md
git commit -m "feat(wiki): add mobile mode prompt and domain classification to wiki-worker"
```

---

### Task 6: /understand-wiki — Phase 3 Mobile Mode: `build-client-graph.py`

**Files:**
- Create: `understand-anything-plugin/skills/understand-wiki/build-client-graph.py`
- Modify: `understand-anything-plugin/skills/understand-wiki/docs/wiki-phase3-crossservice.md`

- [ ] **Step 1: Create `build-client-graph.py`**

```python
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


def build_client_graph(project_root_str):
    project_root = Path(project_root_str)
    system_config = _load_system_config(project_root)
    if not system_config:
        print('[build-client-graph] ERROR: system.json not found', file=sys.stderr)
        sys.exit(1)

    client_facet = _find_client_facet(system_config)
    if not client_facet:
        print('[build-client-graph] ERROR: No mobile facet found in system.json', file=sys.stderr)
        sys.exit(1)

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
        print('[build-client-graph] WARNING: No integrated platforms found', file=sys.stderr)
        sys.exit(1)

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

    output_path = facet_path / '.understand-anything' / 'client-graph.json'
    output_path.parent.mkdir(parents=True, exist_ok=True)
    content = json.dumps(client_graph, indent=2, ensure_ascii=False)
    tmp_path = str(output_path) + '.tmp'
    with open(tmp_path, 'w') as f:
        f.write(content)
    Path(tmp_path).rename(output_path)

    content_hash = hashlib.sha256(content.encode()).hexdigest()
    print(f'[build-client-graph] Generated client-graph.json: {len(platforms)} platforms, {len(feature_map)} features, hash={content_hash[:12]}')


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print('Usage: python3 build-client-graph.py <project-root>', file=sys.stderr)
        sys.exit(1)
    build_client_graph(sys.argv[1])
```

- [ ] **Step 2: Add mobile mode to Phase 3 crossservice doc**

In `docs/wiki-phase3-crossservice.md`, add a new section before "### Step 5 — Update System Graph":

```markdown
### Mobile Mode — Client Graph Generation (REPO_TYPE=mobile)

When `REPO_TYPE=mobile` and at least 2 platforms have wiki (`meta.json` exists):

```bash
python3 "$SKILL_DIR/build-client-graph.py" "$PROJECT_ROOT"
```

This produces `client-graph.json` at `<client-facet-path>/.understand-anything/client-graph.json` with:
- `platforms[]` — list of integrated platforms (e.g., ["android", "ios"])
- `crossPlatformFrameworks[]` — detected cross-platform frameworks (e.g., ["flutter"])
- `featureMap[]` — per-domain implementation classification (`cross-platform` | `platform-specific` | `mixed`)

If the script fails, log a warning and continue — the client graph is needed for M2 but not a prerequisite for wiki completion.

**Trigger logic:**
```
IF REPO_TYPE == "mobile" AND integrated_platforms >= 2:
  python3 "$SKILL_DIR/build-client-graph.py" "$PROJECT_ROOT"
ELIF REPO_TYPE == "backend":
  python3 "$SKILL_DIR/build-system-graph.py" "$PROJECT_ROOT"  (existing behavior)
ELIF REPO_TYPE == "frontend":
  Skip Phase 3 (single repo, no aggregation needed)
```
```

- [ ] **Step 3: Commit**

```bash
git add understand-anything-plugin/skills/understand-wiki/build-client-graph.py understand-anything-plugin/skills/understand-wiki/docs/wiki-phase3-crossservice.md
git commit -m "feat(wiki): add build-client-graph.py for mobile Phase 3 aggregation"
```

---

### Task 7: M1 Regression Test

**Files:**
- No new files — this is a verification-only task

- [ ] **Step 1: Run existing test suite to verify no regressions**

```bash
cd understand-anything-plugin && pnpm test
```

Expected: All existing tests PASS. The `consumes_api` edge type addition should not break any existing functionality since it's additive.

- [ ] **Step 2: Verify build succeeds**

```bash
cd understand-anything-plugin && pnpm build
```

Expected: Build succeeds without errors.

- [ ] **Step 3: Verify schema validation accepts existing graphs**

The `consumes_api` edge type is optional — existing graphs without it should validate identically to before.

---

## M2 Tasks

### Task 8: check_facets.py — Phase 0 Facet Detection

**Files:**
- Create: `understand-anything-plugin/skills/understand-business/check_facets.py`
- Create: `tests/understand-business/test_check_facets.py`

- [ ] **Step 1: Write failing tests for check_facets**

Create `tests/understand-business/test_check_facets.py`:

```python
#!/usr/bin/env python3
import json
import os
import tempfile
import pytest
from pathlib import Path

import sys
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / 'understand-anything-plugin' / 'skills' / 'understand-business'))
from check_facets import check_facets


@pytest.fixture
def tmp_project(tmp_path):
    ua = tmp_path / '.understand-anything'
    ua.mkdir()
    return tmp_path


class TestCheckFacets:
    def test_returns_empty_when_no_system_json(self, tmp_project):
        result = check_facets(str(tmp_project))
        assert result['facets'] == []

    def test_detects_available_backend_facet(self, tmp_project):
        system = {'facets': [{'id': 'server', 'path': 'server/', 'type': 'backend'}]}
        (tmp_project / '.understand-anything' / 'system.json').write_text(json.dumps(system))
        server_ua = tmp_project / 'server' / '.understand-anything'
        server_ua.mkdir(parents=True)
        (server_ua / 'system-graph.json').write_text('{}')
        wiki_dir = server_ua / 'wiki'
        wiki_dir.mkdir()
        (wiki_dir / 'meta.json').write_text('{}')
        result = check_facets(str(tmp_project))
        assert len(result['facets']) == 1
        assert result['facets'][0]['status'] == 'available'

    def test_detects_missing_mobile_facet(self, tmp_project):
        system = {'facets': [{'id': 'client', 'path': 'client/', 'type': 'mobile'}]}
        (tmp_project / '.understand-anything' / 'system.json').write_text(json.dumps(system))
        (tmp_project / 'client').mkdir()
        result = check_facets(str(tmp_project))
        assert len(result['facets']) == 1
        assert result['facets'][0]['status'] == 'missing'

    def test_detects_degraded_facet_wiki_only(self, tmp_project):
        system = {'facets': [{'id': 'server', 'path': 'server/', 'type': 'backend'}]}
        (tmp_project / '.understand-anything' / 'system.json').write_text(json.dumps(system))
        server_ua = tmp_project / 'server' / '.understand-anything'
        wiki_dir = server_ua / 'wiki'
        wiki_dir.mkdir(parents=True)
        (wiki_dir / 'meta.json').write_text('{}')
        result = check_facets(str(tmp_project))
        assert result['facets'][0]['status'] == 'degraded'

    def test_writes_facet_status_json(self, tmp_project):
        system = {'facets': [{'id': 'server', 'path': 'server/', 'type': 'backend'}]}
        (tmp_project / '.understand-anything' / 'system.json').write_text(json.dumps(system))
        (tmp_project / 'server').mkdir()
        result = check_facets(str(tmp_project))
        output_path = tmp_project / '.understand-anything' / 'intermediate' / 'facet-status.json'
        assert output_path.exists()
        saved = json.loads(output_path.read_text())
        assert saved == result
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/earthchen/ai-work/Understand-Anything && uv run pytest tests/understand-business/test_check_facets.py -v`
Expected: FAIL — `check_facets` module not found.

- [ ] **Step 3: Implement check_facets.py**

Create `understand-anything-plugin/skills/understand-business/check_facets.py`:

```python
#!/usr/bin/env python3
"""Phase 0: Check facet availability from system.json.

Reads system.json, checks for each facet whether its aggregation graph
(system-graph.json for backend, client-graph.json for mobile) and wiki exist.

Usage:
    python3 check_facets.py <project-root>

Output:
    <project-root>/.understand-anything/intermediate/facet-status.json
"""
import json
import sys
from pathlib import Path


GRAPH_FILE_MAP = {
    'backend': 'system-graph.json',
    'mobile': 'client-graph.json',
    'frontend': None,
    'test': None,
}


def check_facets(project_root_str):
    project_root = Path(project_root_str)
    system_path = project_root / '.understand-anything' / 'system.json'

    if not system_path.exists():
        result = {'facets': []}
        _write_output(project_root, result)
        return result

    with open(system_path) as f:
        system_config = json.load(f)

    facets_result = []
    for facet in system_config.get('facets', []):
        facet_id = facet.get('id', '')
        facet_path = facet.get('path', '')
        facet_type = facet.get('type', '')

        facet_dir = project_root / facet_path
        ua_dir = facet_dir / '.understand-anything'
        graph_file = GRAPH_FILE_MAP.get(facet_type)

        has_graph = False
        graph_path = ''
        if graph_file:
            gp = ua_dir / graph_file
            has_graph = gp.exists()
            graph_path = str(gp.relative_to(project_root)) if has_graph else ''

        wiki_meta = ua_dir / 'wiki' / 'meta.json'
        has_wiki = wiki_meta.exists()

        if has_graph and has_wiki:
            status = 'available'
        elif has_wiki and not has_graph:
            status = 'degraded'
        else:
            status = 'missing'

        facets_result.append({
            'id': facet_id,
            'type': facet_type,
            'path': facet_path,
            'status': status,
            'graphPath': graph_path,
            'hasWiki': has_wiki,
            'hasGraph': has_graph,
        })

    result = {'facets': facets_result}
    _write_output(project_root, result)
    return result


def _write_output(project_root, result):
    output_dir = project_root / '.understand-anything' / 'intermediate'
    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / 'facet-status.json'
    output_path.write_text(json.dumps(result, indent=2, ensure_ascii=False))


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print('Usage: python3 check_facets.py <project-root>', file=sys.stderr)
        sys.exit(1)
    result = check_facets(sys.argv[1])
    for f in result['facets']:
        print(f"  [{f['status'].upper():>9}] {f['id']} ({f['type']}) at {f['path']}")
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest tests/understand-business/test_check_facets.py -v`
Expected: All 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add understand-anything-plugin/skills/understand-business/check_facets.py tests/understand-business/test_check_facets.py
git commit -m "feat(business): add check_facets.py for Phase 0 facet detection"
```

---

### Task 9: domain_matcher.py — Phase 1 Deterministic Domain Matching

**Files:**
- Create: `understand-anything-plugin/skills/understand-business/domain_matcher.py`
- Create: `tests/understand-business/test_domain_matcher.py`

- [ ] **Step 1: Write failing tests**

Create `tests/understand-business/test_domain_matcher.py`:

```python
#!/usr/bin/env python3
import json
import pytest
from pathlib import Path

import sys
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / 'understand-anything-plugin' / 'skills' / 'understand-business'))
from domain_matcher import match_domains, _normalize_name, _match_by_api, _match_by_name


class TestNormalizeName:
    def test_lowercase(self):
        assert _normalize_name('Order-Management') == 'order_management'

    def test_hyphens_to_underscores(self):
        assert _normalize_name('order-management') == 'order_management'

    def test_spaces_to_underscores(self):
        assert _normalize_name('order management') == 'order_management'

    def test_chinese_preserved(self):
        assert _normalize_name('订单管理') == '订单管理'


class TestMatchByApi:
    def test_exact_path_match(self):
        server_domains = {
            'order-management': {
                'endpoints': ['POST /api/orders', 'GET /api/orders/{id}']
            }
        }
        client_domains = {
            '下单流程': {
                'api_calls': ['POST /api/orders']
            }
        }
        matches = _match_by_api(server_domains, client_domains)
        assert len(matches) == 1
        assert matches[0]['canonical'] == 'order-management'
        assert matches[0]['client'] == ['下单流程']

    def test_no_match_different_paths(self):
        server_domains = {
            'order-management': {'endpoints': ['POST /api/orders']}
        }
        client_domains = {
            'user-profile': {'api_calls': ['GET /api/users/me']}
        }
        matches = _match_by_api(server_domains, client_domains)
        assert len(matches) == 0

    def test_one_client_multiple_server_domains(self):
        server_domains = {
            'order-management': {'endpoints': ['POST /api/orders']},
            'payment': {'endpoints': ['POST /api/payments']},
        }
        client_domains = {
            'checkout': {'api_calls': ['POST /api/orders', 'POST /api/payments']}
        }
        matches = _match_by_api(server_domains, client_domains)
        assert len(matches) == 2


class TestMatchByName:
    def test_exact_name_match(self):
        server = {'order-management': {}}
        client = {'order-management': {}}
        matches = _match_by_name(server, client, already_matched_server=set(), already_matched_client=set())
        assert len(matches) == 1

    def test_normalized_name_match(self):
        server = {'order-management': {}}
        client = {'order_management': {}}
        matches = _match_by_name(server, client, already_matched_server=set(), already_matched_client=set())
        assert len(matches) == 1

    def test_skips_already_matched(self):
        server = {'order-management': {}}
        client = {'order-management': {}}
        matches = _match_by_name(server, client, already_matched_server={'order-management'}, already_matched_client=set())
        assert len(matches) == 0


class TestMatchDomains:
    def test_full_pipeline(self, tmp_path):
        server_wiki = tmp_path / 'server' / '.understand-anything' / 'wiki' / 'domains'
        server_wiki.mkdir(parents=True)
        (server_wiki / 'order-management.json').write_text(json.dumps({
            'id': 'domain:order-management',
            'name': 'order-management',
            'summary': 'Order management domain',
            'integrationPoints': {
                'inbound': [{'endpoint': 'POST /api/orders', 'type': 'REST'}]
            }
        }))

        client_wiki = tmp_path / 'client' / 'android' / '.understand-anything' / 'wiki' / 'domains'
        client_wiki.mkdir(parents=True)
        (client_wiki / 'order.json').write_text(json.dumps({
            'id': 'domain:order',
            'name': 'order-management',
            'summary': 'Order screen',
        }))

        client_kg = tmp_path / 'client' / 'android' / '.understand-anything'
        (client_kg / 'knowledge-graph.json').write_text(json.dumps({
            'nodes': [],
            'edges': [
                {'source': 'function:OrderRepo.kt:createOrder', 'target': 'endpoint:OrderRepo.kt:POST /api/orders', 'type': 'consumes_api'}
            ]
        }))

        system = {
            'facets': [
                {'id': 'server', 'path': 'server/', 'type': 'backend'},
                {'id': 'client', 'path': 'client/', 'type': 'mobile', 'subPaths': ['android/']}
            ]
        }

        result = match_domains(str(tmp_path), system)
        assert len(result['matched']) >= 1
        assert result['matched'][0]['matchType'] in ('auto-api', 'auto-name')
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/understand-business/test_domain_matcher.py -v`
Expected: FAIL — `domain_matcher` module not found.

- [ ] **Step 3: Implement domain_matcher.py**

Create `understand-anything-plugin/skills/understand-business/domain_matcher.py`:

```python
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
    wiki_dir = Path(project_root) / server_path / '.understand-anything' / 'wiki' / 'domains'
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
    root = Path(project_root) / client_path
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


def match_domains(project_root_str, system_config=None):
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest tests/understand-business/test_domain_matcher.py -v`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add understand-anything-plugin/skills/understand-business/domain_matcher.py tests/understand-business/test_domain_matcher.py
git commit -m "feat(business): add domain_matcher.py for Phase 1 deterministic matching"
```

---

### Task 10: validate_domain.py — Phase 4 Interaction Document Validation

**Files:**
- Create: `understand-anything-plugin/skills/understand-business/validate_domain.py`
- Create: `tests/understand-business/test_validate_domain.py`

- [ ] **Step 1: Write failing tests**

Create `tests/understand-business/test_validate_domain.py`:

```python
#!/usr/bin/env python3
import json
import pytest
from pathlib import Path

import sys
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / 'understand-anything-plugin' / 'skills' / 'understand-business'))
from validate_domain import validate_domain_doc


class TestValidateDomainDoc:
    def test_valid_minimal_doc(self):
        doc = {
            'id': 'domain:order-management',
            'name': '订单管理',
            'summary': '用户从下单到支付完成的完整业务流程',
            'interactions': [{
                'id': 'flow:create-order',
                'name': '创建订单',
                'steps': [
                    {'id': 'step:1', 'facet': 'client', 'description': '用户点击下单', 'after': []},
                    {'id': 'step:2', 'facet': 'server', 'description': '校验库存', 'after': ['step:1'], 'terminal': True},
                ]
            }],
            'businessRules': [],
            'facets': {'server': {'domainRef': 'server/order-service/.understand-anything/wiki/domains/order-management.json'}}
        }
        errors = validate_domain_doc(doc)
        assert len(errors) == 0

    def test_missing_id(self):
        doc = {'name': 'test', 'summary': 'test', 'interactions': [], 'businessRules': [], 'facets': {}}
        errors = validate_domain_doc(doc)
        assert any('id' in e for e in errors)

    def test_invalid_id_pattern(self):
        doc = {'id': 'invalid', 'name': 'test', 'summary': 'test', 'interactions': [], 'businessRules': [], 'facets': {}}
        errors = validate_domain_doc(doc)
        assert any('domain:' in e for e in errors)

    def test_invalid_step_reference_in_after(self):
        doc = {
            'id': 'domain:test',
            'name': 'test',
            'summary': 'test',
            'interactions': [{
                'id': 'flow:test',
                'name': 'test',
                'steps': [
                    {'id': 'step:1', 'facet': 'server', 'description': 'test', 'after': ['step:nonexistent']},
                ]
            }],
            'businessRules': [],
            'facets': {}
        }
        errors = validate_domain_doc(doc)
        assert any('nonexistent' in e for e in errors)

    def test_invalid_branch_next_reference(self):
        doc = {
            'id': 'domain:test',
            'name': 'test',
            'summary': 'test',
            'interactions': [{
                'id': 'flow:test',
                'name': 'test',
                'steps': [
                    {'id': 'step:1', 'facet': 'server', 'description': 'test', 'after': [],
                     'branches': [{'condition': 'ok', 'next': ['step:missing']}]},
                ]
            }],
            'businessRules': [],
            'facets': {}
        }
        errors = validate_domain_doc(doc)
        assert any('missing' in e for e in errors)

    def test_no_terminal_step_warns(self):
        doc = {
            'id': 'domain:test',
            'name': 'test',
            'summary': 'test',
            'interactions': [{
                'id': 'flow:test',
                'name': 'test',
                'steps': [
                    {'id': 'step:1', 'facet': 'server', 'description': 'test', 'after': []},
                ]
            }],
            'businessRules': [],
            'facets': {}
        }
        errors = validate_domain_doc(doc)
        assert any('terminal' in e.lower() for e in errors)

    def test_business_rule_missing_required_fields(self):
        doc = {
            'id': 'domain:test',
            'name': 'test',
            'summary': 'test',
            'interactions': [],
            'businessRules': [{'id': 'rule:1'}],
            'facets': {}
        }
        errors = validate_domain_doc(doc)
        assert any('rule' in e or 'enforcedBy' in e for e in errors)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/understand-business/test_validate_domain.py -v`
Expected: FAIL.

- [ ] **Step 3: Implement validate_domain.py**

Create `understand-anything-plugin/skills/understand-business/validate_domain.py`:

```python
#!/usr/bin/env python3
"""Phase 4: Validate per-domain interaction document.

Checks DAG structure, step references, business rules, and facet references.

Usage:
    python3 validate_domain.py <domain-json-path>

Exit code 0 = valid, 1 = validation errors (printed to stderr)
"""
import json
import sys
from pathlib import Path


def validate_domain_doc(doc):
    errors = []

    if 'id' not in doc:
        errors.append("Missing required field: 'id'")
    elif not doc['id'].startswith('domain:'):
        errors.append(f"Field 'id' must match pattern 'domain:*', got '{doc['id']}'")

    for field in ('name', 'summary'):
        if field not in doc or not doc.get(field, '').strip():
            errors.append(f"Missing or empty required field: '{field}'")

    if 'interactions' not in doc:
        errors.append("Missing required field: 'interactions'")
    elif not isinstance(doc['interactions'], list):
        errors.append("'interactions' must be an array")
    else:
        for i, interaction in enumerate(doc['interactions']):
            errors.extend(_validate_interaction(interaction, i))

    if 'businessRules' not in doc:
        errors.append("Missing required field: 'businessRules'")
    elif isinstance(doc['businessRules'], list):
        for j, rule in enumerate(doc['businessRules']):
            errors.extend(_validate_business_rule(rule, j))

    if 'facets' not in doc:
        errors.append("Missing required field: 'facets'")

    return errors


def _validate_interaction(interaction, idx):
    errors = []
    prefix = f"interactions[{idx}]"

    for field in ('id', 'name', 'steps'):
        if field not in interaction:
            errors.append(f"{prefix}: missing required field '{field}'")

    steps = interaction.get('steps', [])
    if not isinstance(steps, list):
        errors.append(f"{prefix}: 'steps' must be an array")
        return errors

    step_ids = {s.get('id') for s in steps if isinstance(s, dict)}

    has_terminal = False
    for s_idx, step in enumerate(steps):
        if not isinstance(step, dict):
            errors.append(f"{prefix}.steps[{s_idx}]: must be an object")
            continue

        for field in ('id', 'facet', 'description'):
            if field not in step:
                errors.append(f"{prefix}.steps[{s_idx}]: missing required field '{field}'")

        for after_ref in step.get('after', []):
            if after_ref not in step_ids:
                errors.append(f"{prefix}.steps[{s_idx}]: 'after' references nonexistent step '{after_ref}'")

        for branch in step.get('branches', []):
            for next_ref in branch.get('next', []):
                if next_ref not in step_ids:
                    errors.append(f"{prefix}.steps[{s_idx}]: branch 'next' references nonexistent step '{next_ref}'")

        for parallel_ref in step.get('parallel', []):
            if parallel_ref not in step_ids:
                errors.append(f"{prefix}.steps[{s_idx}]: 'parallel' references nonexistent step '{parallel_ref}'")

        if step.get('terminal'):
            has_terminal = True

    if steps and not has_terminal:
        errors.append(f"{prefix}: no step has 'terminal: true' — at least one terminal step required per interaction")

    return errors


def _validate_business_rule(rule, idx):
    errors = []
    prefix = f"businessRules[{idx}]"

    for field in ('id', 'rule', 'enforcedBy'):
        if field not in rule:
            errors.append(f"{prefix}: missing required field '{field}'")

    return errors


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print('Usage: python3 validate_domain.py <domain-json-path>', file=sys.stderr)
        sys.exit(1)

    path = Path(sys.argv[1])
    if not path.exists():
        print(f'File not found: {path}', file=sys.stderr)
        sys.exit(1)

    doc = json.loads(path.read_text())
    errors = validate_domain_doc(doc)

    if errors:
        for e in errors:
            print(f'  ERROR: {e}', file=sys.stderr)
        sys.exit(1)
    else:
        print(f'Validation passed: {path.name}')
        sys.exit(0)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest tests/understand-business/test_validate_domain.py -v`
Expected: All 7 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add understand-anything-plugin/skills/understand-business/validate_domain.py tests/understand-business/test_validate_domain.py
git commit -m "feat(business): add validate_domain.py for Phase 4 interaction doc validation"
```

---

### Task 11: assemble_landscape.py — Phase 3 Output Assembly

**Files:**
- Create: `understand-anything-plugin/skills/understand-business/assemble_landscape.py`
- Create: `tests/understand-business/test_assemble_landscape.py`

- [ ] **Step 1: Write failing tests**

Create `tests/understand-business/test_assemble_landscape.py`:

```python
#!/usr/bin/env python3
import json
import pytest
from pathlib import Path

import sys
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / 'understand-anything-plugin' / 'skills' / 'understand-business'))
from assemble_landscape import assemble_landscape


@pytest.fixture
def tmp_project(tmp_path):
    intermediate = tmp_path / '.understand-anything' / 'intermediate'
    intermediate.mkdir(parents=True)
    return tmp_path


class TestAssembleLandscape:
    def test_generates_domains_json(self, tmp_project):
        matches = {
            'matched': [
                {'canonical': 'order-management', 'server': ['order-management'], 'client': ['下单'], 'matchType': 'auto-api', 'confidence': 1.0}
            ],
            'candidates': []
        }
        intermediate = tmp_project / '.understand-anything' / 'intermediate'
        (intermediate / 'phase1-matches.json').write_text(json.dumps(matches))

        result = assemble_landscape(str(tmp_project))
        domains_path = intermediate / 'domains.json'
        assert domains_path.exists()
        domains = json.loads(domains_path.read_text())
        assert len(domains['domains']) == 1
        assert domains['stats']['totalDomains'] == 1

    def test_includes_unmapped_domains(self, tmp_project):
        matches = {
            'matched': [],
            'candidates': [
                {'server': 'user-mgmt', 'client': 'profile', 'reason': 'no match'}
            ]
        }
        llm_match = {'match': False, 'confidence': 0.3, 'reason': 'different domains', '_checkpoint': {'status': 'complete'}}
        intermediate = tmp_project / '.understand-anything' / 'intermediate'
        (intermediate / 'phase1-matches.json').write_text(json.dumps(matches))
        (intermediate / 'match-user-mgmt-profile.json').write_text(json.dumps(llm_match))

        result = assemble_landscape(str(tmp_project))
        domains = json.loads((intermediate / 'domains.json').read_text())
        assert len(domains['unmapped']) >= 1

    def test_generates_cross_facet_links(self, tmp_project):
        matches = {
            'matched': [
                {'canonical': 'order-management', 'server': ['order-management'], 'client': ['下单'], 'matchType': 'auto-api', 'confidence': 1.0}
            ],
            'candidates': []
        }
        intermediate = tmp_project / '.understand-anything' / 'intermediate'
        (intermediate / 'phase1-matches.json').write_text(json.dumps(matches))

        result = assemble_landscape(str(tmp_project))
        links_path = intermediate / 'cross-facet-links.json'
        assert links_path.exists()

    def test_updates_domain_mapping(self, tmp_project):
        matches = {
            'matched': [
                {'canonical': 'order-management', 'server': ['order-management'], 'client': ['下单'], 'matchType': 'auto-api', 'confidence': 1.0}
            ],
            'candidates': []
        }
        intermediate = tmp_project / '.understand-anything' / 'intermediate'
        (intermediate / 'phase1-matches.json').write_text(json.dumps(matches))

        assemble_landscape(str(tmp_project))
        mapping_path = tmp_project / '.understand-anything' / 'domain-mapping.json'
        assert mapping_path.exists()
        mapping = json.loads(mapping_path.read_text())
        assert len(mapping['mappings']) == 1
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/understand-business/test_assemble_landscape.py -v`
Expected: FAIL.

- [ ] **Step 3: Implement assemble_landscape.py**

Create `understand-anything-plugin/skills/understand-business/assemble_landscape.py`:

```python
#!/usr/bin/env python3
"""Phase 3: Merge domain matches and generate domains.json + cross-facet-links.json.

Reads Phase 1 deterministic matches and Phase 2 LLM verification results,
produces the business-landscape index files.

Usage:
    python3 assemble_landscape.py <project-root>

Output:
    intermediate/domains.json
    intermediate/cross-facet-links.json
    .understand-anything/domain-mapping.json (updated)
"""
import json
import sys
from pathlib import Path


def assemble_landscape(project_root_str):
    project_root = Path(project_root_str)
    intermediate = project_root / '.understand-anything' / 'intermediate'

    phase1_path = intermediate / 'phase1-matches.json'
    if not phase1_path.exists():
        print('[assemble-landscape] ERROR: phase1-matches.json not found', file=sys.stderr)
        return None

    phase1 = json.loads(phase1_path.read_text())
    all_matched = list(phase1.get('matched', []))

    for candidate in phase1.get('candidates', []):
        s_name = candidate['server']
        c_name = candidate['client']
        match_file = intermediate / f'match-{s_name}-{c_name}.json'
        if match_file.exists():
            try:
                llm_result = json.loads(match_file.read_text())
                checkpoint = llm_result.get('_checkpoint', {})
                if checkpoint.get('status') != 'complete':
                    continue
                if llm_result.get('match') and llm_result.get('confidence', 0) >= 0.7:
                    all_matched.append({
                        'canonical': s_name,
                        'server': [s_name],
                        'client': [c_name],
                        'matchType': 'auto-llm',
                        'confidence': llm_result.get('confidence', 0.7),
                    })
            except (json.JSONDecodeError, IOError):
                continue

    matched_server = set()
    matched_client = set()
    for m in all_matched:
        matched_server.update(m.get('server', []))
        matched_client.update(m.get('client', []))

    domains_list = []
    for m in all_matched:
        domain_entry = {
            'id': f"domain:{m['canonical']}",
            'name': m['canonical'],
            'summary': '',
            'facets': ['server', 'client'],
            'matchType': m.get('matchType', 'unknown'),
            'matchConfidence': m.get('confidence', 1.0),
            'detailRef': f"business-landscape/domains/{m['canonical']}.json",
        }
        domains_list.append(domain_entry)

    unmapped = []
    for candidate in phase1.get('candidates', []):
        s_name = candidate['server']
        c_name = candidate['client']
        if s_name not in matched_server:
            unmapped.append({'facet': 'server', 'domain': s_name, 'reason': candidate.get('reason', 'no match')})
        if c_name not in matched_client:
            unmapped.append({'facet': 'client', 'domain': c_name, 'reason': candidate.get('reason', 'no match')})

    seen_unmapped = set()
    deduped_unmapped = []
    for u in unmapped:
        key = (u['facet'], u['domain'])
        if key not in seen_unmapped:
            seen_unmapped.add(key)
            deduped_unmapped.append(u)

    total = len(domains_list) + len(deduped_unmapped)
    domains_json = {
        'domains': domains_list,
        'unmapped': deduped_unmapped,
        'stats': {
            'totalDomains': total,
            'mappedDomains': len(domains_list),
            'unmappedDomains': len(deduped_unmapped),
            'coverageRate': round(len(domains_list) / total, 2) if total > 0 else 0,
        }
    }
    (intermediate / 'domains.json').write_text(json.dumps(domains_json, indent=2, ensure_ascii=False))

    links = []
    for m in all_matched:
        links.append({
            'domain': f"domain:{m['canonical']}",
            'serverEndpoints': [],
            'clientApiCalls': [],
            'matchDetails': [{
                'matchLayer': 1 if m['matchType'] in ('auto-api', 'auto-name', 'manual') else 2,
                'matchType': m['matchType'],
            }],
        })
    cross_facet_links = {'links': links, 'unmatchedEndpoints': {'server': [], 'client': []}}
    (intermediate / 'cross-facet-links.json').write_text(json.dumps(cross_facet_links, indent=2, ensure_ascii=False))

    mapping = {'mappings': [], 'unmapped': deduped_unmapped}
    for m in all_matched:
        mapping['mappings'].append({
            'canonical': m['canonical'],
            'aliases': {
                'server': m.get('server', []),
                'client': m.get('client', []),
            },
            'matchType': m.get('matchType', 'unknown'),
        })
    mapping_path = project_root / '.understand-anything' / 'domain-mapping.json'
    mapping_path.write_text(json.dumps(mapping, indent=2, ensure_ascii=False))

    return domains_json


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print('Usage: python3 assemble_landscape.py <project-root>', file=sys.stderr)
        sys.exit(1)
    result = assemble_landscape(sys.argv[1])
    if result:
        stats = result['stats']
        print(f"Assembled: {stats['mappedDomains']} mapped, {stats['unmappedDomains']} unmapped ({stats['coverageRate']*100:.0f}% coverage)")
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest tests/understand-business/test_assemble_landscape.py -v`
Expected: All 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add understand-anything-plugin/skills/understand-business/assemble_landscape.py tests/understand-business/test_assemble_landscape.py
git commit -m "feat(business): add assemble_landscape.py for Phase 3 output assembly"
```

---

### Task 12: validate_landscape.py — Phase 5 Full Validation

**Files:**
- Create: `understand-anything-plugin/skills/understand-business/validate_landscape.py`
- Create: `tests/understand-business/test_validate_landscape.py`

- [ ] **Step 1: Write failing tests**

Create `tests/understand-business/test_validate_landscape.py`:

```python
#!/usr/bin/env python3
import json
import pytest
from pathlib import Path

import sys
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / 'understand-anything-plugin' / 'skills' / 'understand-business'))
from validate_landscape import validate_landscape


@pytest.fixture
def tmp_landscape(tmp_path):
    bl = tmp_path / '.understand-anything' / 'business-landscape'
    bl.mkdir(parents=True)
    domains_dir = bl / 'domains'
    domains_dir.mkdir()
    return tmp_path, bl


class TestValidateLandscape:
    def test_valid_landscape(self, tmp_landscape):
        root, bl = tmp_landscape
        (bl / 'domains.json').write_text(json.dumps({
            'domains': [{'id': 'domain:order', 'name': 'order', 'summary': 'test', 'facets': ['server'], 'matchType': 'auto-api', 'matchConfidence': 1.0, 'detailRef': 'business-landscape/domains/order.json'}],
            'unmapped': [],
            'stats': {'totalDomains': 1, 'mappedDomains': 1, 'unmappedDomains': 0, 'coverageRate': 1.0}
        }))
        (bl / 'cross-facet-links.json').write_text(json.dumps({
            'links': [{'domain': 'domain:order', 'serverEndpoints': [], 'clientApiCalls': [], 'matchDetails': []}],
            'unmatchedEndpoints': {'server': [], 'client': []}
        }))
        (bl / 'domains' / 'order.json').write_text(json.dumps({
            'id': 'domain:order', 'name': 'order', 'summary': 'test',
            'interactions': [{'id': 'flow:create', 'name': 'create', 'steps': [
                {'id': 'step:1', 'facet': 'server', 'description': 'test', 'after': [], 'terminal': True}
            ]}],
            'businessRules': [], 'facets': {}
        }))
        errors = validate_landscape(str(root))
        assert len(errors) == 0

    def test_missing_domains_json(self, tmp_landscape):
        root, bl = tmp_landscape
        (bl / 'cross-facet-links.json').write_text('{}')
        errors = validate_landscape(str(root))
        assert any('domains.json' in e for e in errors)

    def test_stats_inconsistency(self, tmp_landscape):
        root, bl = tmp_landscape
        (bl / 'domains.json').write_text(json.dumps({
            'domains': [{'id': 'domain:order', 'name': 'order', 'summary': 'test', 'facets': [], 'matchType': 'auto-api', 'matchConfidence': 1.0, 'detailRef': 'business-landscape/domains/order.json'}],
            'unmapped': [],
            'stats': {'totalDomains': 5, 'mappedDomains': 1, 'unmappedDomains': 0, 'coverageRate': 1.0}
        }))
        (bl / 'cross-facet-links.json').write_text(json.dumps({'links': [], 'unmatchedEndpoints': {'server': [], 'client': []}}))
        (bl / 'domains' / 'order.json').write_text(json.dumps({
            'id': 'domain:order', 'name': 'order', 'summary': 'test', 'interactions': [], 'businessRules': [], 'facets': {}
        }))
        errors = validate_landscape(str(root))
        assert any('stats' in e.lower() or 'totalDomains' in e for e in errors)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/understand-business/test_validate_landscape.py -v`
Expected: FAIL.

- [ ] **Step 3: Implement validate_landscape.py**

Create `understand-anything-plugin/skills/understand-business/validate_landscape.py`:

```python
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest tests/understand-business/test_validate_landscape.py -v`
Expected: All 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add understand-anything-plugin/skills/understand-business/validate_landscape.py tests/understand-business/test_validate_landscape.py
git commit -m "feat(business): add validate_landscape.py for Phase 5 full validation"
```

---

### Task 13: /understand-business SKILL.md — Phase 0-5 Execution Flow

**Files:**
- Create: `understand-anything-plugin/skills/understand-business/SKILL.md`

- [ ] **Step 1: Create SKILL.md**

Create `understand-anything-plugin/skills/understand-business/SKILL.md`:

```markdown
---
name: understand-business
description: Aggregate server + client wiki into a unified business-landscape with cross-facet domain matching, interaction documents, and business rules.
argument-hint: ["[--full] [--cascade] [--cascade=deep] [--dry-run] [--budget <tokens>] [--language <lang>]"]
---

# /understand-business

Generate a cross-facet business-landscape by reading server and client wiki data, matching domains across facets, and producing interaction documents that describe end-to-end business flows.

## Options

- `$ARGUMENTS` may contain:
  - `--full` — Force full regeneration, ignoring all checkpoints
  - `--cascade` — Auto-trigger missing dependency generation (one level deep)
  - `--cascade=deep` — Auto-trigger full dependency chain generation
  - `--dry-run` — Preview what would be generated without running any LLM calls
  - `--budget <tokens>` — Maximum token budget for LLM calls; pause and prompt if exceeded
  - `--language <lang>` — Generate content in specified language (ISO 639-1 or friendly name)

---

## Progress Reporting

Report progress at each phase transition:
> `[Phase N/5] <phase name>...`

Phase completion:
> `Phase N complete. <one-line summary>`

---

## Prerequisites

- Server wiki must exist at `<server-facet-path>/.understand-anything/wiki/meta.json`
- Client wiki should exist at `<client-facet-path>/.understand-anything/wiki/meta.json` (degraded mode without it)
- `system.json` must exist at project root with `facets[]` declaration

---

## Workflow Phases

### Phase 0 — Configuration & Input Detection

Report: `[Phase 0/5] Checking facet availability...`

```bash
python3 "$SKILL_DIR/check_facets.py" "$PROJECT_ROOT"
```

Read the output at `$PROJECT_ROOT/.understand-anything/intermediate/facet-status.json`.

**If `--cascade` and a facet is missing:**
- Backend missing: dispatch `/understand-wiki --batch` subagent for server facet
- Mobile missing: dispatch `/understand-wiki --repo-type=mobile` subagent for client facet
- Wait for subagent completion, then re-run check_facets.py

**If no cascade and a facet is missing:**
- Log warning: `WARNING: <facet> wiki not available — business-landscape will be degraded`
- Continue with available facets

**If zero facets available:**
- Report error and STOP: `ERROR: No facet wiki data available. Run /understand-wiki first.`

### Phase 1 — Deterministic Domain Matching

Report: `[Phase 1/5] Matching domains across facets...`

```bash
python3 "$SKILL_DIR/domain_matcher.py" "$PROJECT_ROOT"
```

Read the output at `$PROJECT_ROOT/.understand-anything/intermediate/phase1-matches.json`.

Report: `Phase 1 complete. <N> domains matched deterministically, <M> candidates for LLM verification.`

### Phase 2 — LLM Domain Match Verification

Report: `[Phase 2/5] Verifying domain match candidates...`

**Skip if no candidates from Phase 1.**

For each candidate pair in `phase1-matches.json.candidates[]`:

1. Check checkpoint: `intermediate/match-{server}-{client}.json`
   - If exists and `_checkpoint.status == "complete"` → skip (already verified)
   - If exists and `_checkpoint.status == "degraded"` or `"failed"` → re-verify

2. Prompt LLM with both domains' data:

```
Given these two domains from different facets, determine if they represent the same business concept:

Server domain: "<name>"
  Summary: <summary>
  Endpoints: <endpoint list>

Client domain: "<name>"
  Summary: <summary>
  API calls: <API call list>

Respond with JSON only:
{
  "match": true/false,
  "confidence": 0.0-1.0,
  "reason": "one sentence explanation"
}
```

3. Validate LLM output: must be valid JSON with `match` (boolean), `confidence` (number 0-1), `reason` (string)
4. Write checkpoint using `checkpoint-writer.mjs` pattern:
   - `{ match, confidence, reason, _checkpoint: { status: "complete" } }`

Report: `Phase 2 complete. <N> candidates verified, <M> auto-matched (confidence ≥ 0.7), <K> unmapped.`

### Phase 3 — Output Assembly & Index Generation

Report: `[Phase 3/5] Assembling business-landscape index...`

```bash
python3 "$SKILL_DIR/assemble_landscape.py" "$PROJECT_ROOT"
```

Read output files:
- `intermediate/domains.json` — domain index with stats
- `intermediate/cross-facet-links.json` — cross-facet API endpoint mappings
- `domain-mapping.json` — updated at project root for future runs

Report: `Phase 3 complete. <N> domains mapped (<coverage>% coverage), <M> unmapped.`

### Phase 4 — Cross-Facet Interaction Document Generation

Report: `[Phase 4/5] Generating interaction documents...`

For each domain in `intermediate/domains.json.domains[]`:

1. Check checkpoint: `intermediate/domain-{id}.json`
   - If exists and `_checkpoint.status == "complete"` → skip
   - If exists and `_checkpoint.status == "degraded"` or `"failed"` → re-generate

2. **Deterministic extraction:** Read each facet's wiki flow data for this domain. Build step skeleton from existing flow steps.

3. **LLM generation:** Given the step skeletons from all facets, generate the interaction document:

```
Given these wiki flow data from server and client facets for the "<domain name>" business domain, generate a cross-facet interaction document.

Server flows:
<server wiki domain flows JSON>

Client flows:
<client wiki domain flows JSON>

Generate a JSON document with this structure:
{
  "id": "domain:<slug>",
  "name": "<domain name>",
  "summary": "<3-5 sentence overview>",
  "interactions": [
    {
      "id": "flow:<slug>",
      "name": "<flow name>",
      "steps": [
        {
          "id": "step:<N>",
          "facet": "server|client|frontend",
          "description": "<what happens>",
          "after": ["step:<previous>"],
          "branches": [{ "condition": "<condition>", "next": ["step:<N>"] }],
          "parallel": ["step:<N>"],
          "terminal": true/false,
          "relatedRules": ["rule:<id>"]
        }
      ]
    }
  ],
  "businessRules": [
    {
      "id": "rule:<slug>",
      "rule": "<human-readable rule>",
      "enforcedBy": ["server/<service>"],
      "observedBy": ["client"],
      "relatedFlows": ["flow:<slug>"]
    }
  ],
  "facets": {
    "server": { "service": "<service>", "domainRef": "<path>" },
    "client": { ... }
  }
}

IMPORTANT:
- Steps use DAG structure via "after" field, NOT linear array order
- Each interaction MUST have at least one step with "terminal": true
- "branches" represent conditional paths; "parallel" represents concurrent execution
- All step ID references in "after", "branches.next", "parallel" must reference valid step IDs within the same interaction
```

4. **Validate:** Run `validate_domain.py` on LLM output
5. **Retry on failure:** Re-prompt with validation errors (max 2 retries)
6. **Degrade on persistent failure:** Write checkpoint with `status: "degraded"`

Report after each domain: `  Domain <N>/<total>: <domain-name> — <complete|degraded>`

Report: `Phase 4 complete. <N>/<total> domains with interaction documents (<M> degraded).`

### Phase 5 — Validation & Final Output

Report: `[Phase 5/5] Validating and finalizing...`

```bash
python3 "$SKILL_DIR/validate_landscape.py" "$PROJECT_ROOT"
```

If validation passes:
1. Move files from `intermediate/` to `business-landscape/`:
   - `intermediate/domains.json` → `business-landscape/domains.json`
   - `intermediate/cross-facet-links.json` → `business-landscape/cross-facet-links.json`
   - `intermediate/domain-*.json` → `business-landscape/domains/*.json`
2. Generate `business-landscape/meta.json`:
```json
{
  "contentHash": "sha256:<hash of all output files>",
  "sourceHashes": {
    "server/system-graph": "sha256:<from system-graph.json>",
    "client/client-graph": "sha256:<from client-graph.json>"
  },
  "generatedAt": "<ISO 8601>",
  "version": "1.0",
  "status": "complete",
  "_checkpoint": { "status": "complete" }
}
```
3. Clean up intermediate files (keep if `--keep-intermediate`)

If validation fails:
- Report errors
- Set `meta.json.status = "degraded"`
- Still produce output (degraded is better than nothing)

Print final summary:
```
╔══════════════════════════════════════════════════╗
║          /understand-business Complete            ║
╠══════════════════════════════════════════════════╣
║ Domains:    <mapped> mapped / <total> total      ║
║ Coverage:   <rate>%                              ║
║ Unmapped:   <count> domains                      ║
║ Interactions: <count> documents generated        ║
║ Status:     <complete|degraded>                  ║
║                                                  ║
║ Output: .understand-anything/business-landscape/ ║
╚══════════════════════════════════════════════════╝
```

---

## Error Handling

| Scenario | Action |
|----------|--------|
| system.json missing | Report error, STOP |
| All facet wikis missing | Report error, STOP |
| Some facet wikis missing | Degrade: generate with available data, mark `degraded: true` |
| Phase 1 script fails | Report error, STOP (deterministic should not fail) |
| Phase 2 LLM call fails | Skip candidate → unmapped list |
| Phase 2 LLM output invalid | Skip candidate → unmapped list |
| Phase 4 LLM call fails | Retry 2x → degrade domain |
| Phase 4 validation fails | Retry 2x → degrade domain |
| Phase 5 validation fails | Report errors, produce degraded output |
| Disk write fails | STOP immediately (data consistency) |

**Never silently drop errors.** Every failure must appear in the final report.
```

- [ ] **Step 2: Commit**

```bash
git add understand-anything-plugin/skills/understand-business/SKILL.md
git commit -m "feat(business): add /understand-business SKILL.md with 5-phase execution flow"
```

---

### Task 14: TypeScript Interfaces for Business-Landscape Schema

**Files:**
- Modify: `understand-anything-plugin/packages/core/src/types.ts`

- [ ] **Step 1: Add business-landscape interfaces**

Append to `understand-anything-plugin/packages/core/src/types.ts`:

```typescript
// Business-landscape domain matching result
export interface BusinessDomain {
  id: string;
  name: string;
  summary: string;
  facets: string[];
  implType?: "cross-platform" | "platform-specific" | "mixed";
  matchType: "manual" | "auto-api" | "auto-name" | "auto-llm";
  matchConfidence: number;
  detailRef: string;
}

// Cross-facet API endpoint link
export interface CrossFacetLink {
  domain: string;
  serverEndpoints: string[];
  clientApiCalls: Array<{ platform: string; path: string; file: string }>;
  matchDetails: Array<{ serverEndpoint?: string; clientApiCall?: string; matchLayer: number; matchType: string }>;
}

// Business interaction step (DAG node)
export interface InteractionStep {
  id: string;
  facet: string;
  description: string;
  after?: string[];
  branches?: Array<{ condition: string; next: string[]; relatedRules?: string[] }>;
  parallel?: string[];
  terminal?: boolean;
  relatedRules?: string[];
}

// Business interaction flow
export interface BusinessInteraction {
  id: string;
  name: string;
  triggerRules?: string[];
  steps: InteractionStep[];
}

// Business rule
export interface BusinessRule {
  id: string;
  rule: string;
  enforcedBy: string[];
  observedBy?: string[];
  relatedFlows?: string[];
}
```

- [ ] **Step 2: Verify build succeeds**

Run: `cd understand-anything-plugin && pnpm build`
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add understand-anything-plugin/packages/core/src/types.ts
git commit -m "feat(types): add business-landscape TypeScript interfaces"
```

---

### Task 15: Full Regression Test

**Files:**
- No new files — verification only

- [ ] **Step 1: Run all TypeScript tests**

```bash
cd understand-anything-plugin && pnpm test
```

Expected: All existing + new tests PASS.

- [ ] **Step 2: Run all Python tests**

```bash
uv run pytest tests/ -v
```

Expected: All Python tests PASS (check_facets, domain_matcher, validate_domain, assemble_landscape, validate_landscape).

- [ ] **Step 3: Verify build**

```bash
cd understand-anything-plugin && pnpm build
```

Expected: Build succeeds.

- [ ] **Step 4: Commit summary**

No commit needed — this is verification only. All individual tasks have their own commits.

---

## Self-Review Checklist

1. **Spec coverage:** Every task block in the design spec maps to at least one implementation task:
   - M1 Task Block 1 (KG Schema) → Task 1
   - M1 Task Block 2 (Language Snippets) → Task 2
   - M1 Task Block 3 (SKILL.md) → Task 3
   - M1 Task Block 4 (Wiki Extension) → Tasks 4, 5, 6
   - M1 Task Block 5 (Regression) → Task 7
   - M2 Task Block 1 (SKILL.md) → Task 13
   - M2 Task Block 2 (Phase 0) → Task 8
   - M2 Task Block 3 (Phase 1) → Task 9
   - M2 Task Block 4 (Phase 2) → Covered in SKILL.md (Task 13) — LLM execution, no separate script
   - M2 Task Block 5 (Phase 3) → Task 11
   - M2 Task Block 6 (Phase 4) → Task 10 (validation) + SKILL.md (LLM execution)
   - M2 Task Block 7 (Phase 5) → Task 12
   - TypeScript interfaces → Task 14

2. **Placeholder scan:** No TBD/TODO/placeholder found.

3. **Type consistency:** `consumes_api` used consistently across types.ts, schema.ts, language snippets, and SKILL.md. `BusinessDomain`, `CrossFacetLink`, `InteractionStep`, `BusinessInteraction`, `BusinessRule` interfaces match the JSON schemas in SKILL.md and PRD.
