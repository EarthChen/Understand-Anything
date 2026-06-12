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

Matching layers (executed in order):
1. **API endpoint exact match** — client API call path matches server endpoint path
2. **Domain name exact match** — normalized case-insensitive name equality
3. **Fuzzy CJK match** — substring containment, common prefix (≥2 chars, ≥50%), or character bigram Jaccard (≥0.4)
4. **Manual mapping** — from `domain-mapping.json`

**IMPORTANT**: `system.json` must include `subPaths` for each facet (list of subdirectory names containing individual services). Without this, only the parent-level wiki domains are loaded.

Report: `Phase 1 complete. <N> domains matched deterministically, <M> candidates for LLM verification.`

### Phase 2 — LLM Domain Match & Association Discovery

Report: `[Phase 2/5] Verifying domain match candidates and discovering associations...`

**Skip if no candidates from Phase 1.**

Phase 2 uses two LLM strategies:

#### Strategy A: Pairwise Match (same as before)
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

#### Strategy B: Cross-Facet Association Discovery (NEW)
When Strategy A yields 0 matches (coverage = 0%), execute association discovery:

1. Collect ALL server domain summaries + endpoints AND ALL client domain summaries + API calls
2. Prompt LLM with the full picture:

```
These are business domains from two facets of the same product. The server-side domains represent backend business logic, and the client-side domains represent frontend/mobile integration patterns.

Server domains:
<list of {name, summary, endpoints}>

Client domains:
<list of {name, summary, api_calls}>

Even if the domains have different names or granularities, identify which client domains CALL or DEPEND ON which server domains based on:
1. API endpoint overlap (client calls server endpoints)
2. Business capability overlap (client feature relies on server domain)
3. Data flow relationship (client displays data produced by server domain)

Respond with JSON:
{
  "associations": [
    {
      "server_domain": "<server domain name>",
      "client_domain": "<client domain name>",
      "relationship": "calls|depends_on|displays",
      "confidence": 0.0-1.0,
      "shared_endpoints": ["<endpoint paths if any>"],
      "reason": "explanation"
    }
  ]
}
```

3. For associations with `confidence >= 0.6`:
   - Create a merged domain entry with `matchType: "llm-association"`
   - Use the server domain name as canonical (it represents the business logic)
   - Include both facets in the merged domain

4. Write to `intermediate/phase2-associations.json`

Report: `Phase 2 complete. <N> candidates verified, <M> auto-matched (confidence ≥ 0.7), <K> associations discovered, <L> unmapped.`

### Phase 3 — Output Assembly & Index Generation

Report: `[Phase 3/5] Assembling business-landscape index...`

```bash
python3 "$SKILL_DIR/assemble_landscape.py" "$PROJECT_ROOT"
```

Read output files:
- `intermediate/domains.json` — domain index with stats
- `intermediate/cross-facet-links.json` — cross-facet API endpoint mappings
- `domain-mapping.json` — updated at project root for future runs

#### Domain File Naming Convention (MANDATORY)

All domain files under `business-landscape/domains/` MUST follow this format:
- **Prefix**: Always `domain-` (e.g. `domain-user-profile.json`)
- **Slug**: English kebab-case only (e.g. `domain-user-profile.json`, NOT `domain-用户资料.json`)
- **`--language` controls content only**: The `--language` flag determines the language of JSON content (name, summary, steps), NOT filenames
- **No CJK in filenames**: Filenames must be ASCII kebab-case for cross-platform compatibility
- **No duplicates**: Each domain ID maps to exactly one file

`validate_landscape.py` enforces these rules in Phase 5.

Report: `Phase 3 complete. <N> domains mapped (<coverage>% coverage), <M> unmapped.`

### Phase 4 — Cross-Facet Interaction Document Generation

Report: `[Phase 4/5] Generating interaction documents...`

For each domain in `intermediate/domains.json.domains[]`:

1. Check checkpoint: `intermediate/domain-{name}.json` (use domain `name` field, not raw `id`; apply the naming convention from Phase 3)
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
4. **Build system topology registry** (Dashboard service discovery):

   a. **Generate `system-graph.json`** — use the canonical `build-system-graph.py` script (do NOT manually merge facet graphs):

   ```bash
   WIKI_SKILL_DIR="$(dirname "$SKILL_DIR")/../.understand-anything-plugin/skills/understand-wiki"
   # Fallback: check common plugin install paths
   if [ ! -f "$WIKI_SKILL_DIR/build-system-graph.py" ]; then
     WIKI_SKILL_DIR="$HOME/.understand-anything-plugin/skills/understand-wiki"
   fi
   python3 "$WIKI_SKILL_DIR/build-system-graph.py" "$PROJECT_ROOT"
   ```

   This script automatically:
   - Reads `system.json` facets to discover all services (server + mobile)
   - Uses `microservice:` prefix for service node IDs (CRITICAL: never use `service:` prefix)
   - Generates `facet` group nodes and `contains` edges linking facets to their services
   - Matches RPC edges across services via `provides_rpc`/`consumes_rpc` in each service's KG
   - Enriches from `wiki/architecture.json` cross-service calls if available
   - Writes to `$PROJECT_ROOT/.understand-anything/system-graph.json`

   **Validate immediately after generation:**
   ```bash
   node -e "const{validateSystemGraph}=require('@understand-anything/core/system-graph');const d=require('$PROJECT_ROOT/.understand-anything/system-graph.json');const r=validateSystemGraph(d);console.log(r.valid?'PASS':'FAIL',r.issues.length,'issues');if(!r.valid)console.log(r.issues.join('\n'))"
   ```

   If validation fails, check:
   - Node ID prefix mismatch (must be `microservice:`, not `service:`)
   - Missing mobile/client nodes (check `system.json` facet paths)
   - Edge targets referencing non-existent nodes

   b. **Generate `wiki/` directory** — build root-level wiki entry points for Dashboard navigation:
   - `wiki/meta.json`: `{ "generatedAt": "<ISO>", "version": "1.0.0", "outputLanguage": "<lang>", "serviceCount": <N> }`
   - `wiki/overview.json`: system overview with `facets[]` array grouping services by facet, including services and techStack
   - `wiki/index.json`: navigation entries linking to each service wiki, MUST include a `cross-domain` entry for business panorama:
     ```json
     { "id": "wiki:business", "name": "跨端业务全景", "type": "cross-domain", "summary": "<N>个已匹配的跨端业务域" }
     ```
   - `wiki/domains/business.json`: cross-platform business panorama document:
     ```json
     {
       "id": "cross-domain:business",
       "name": "跨端业务全景",
       "summary": "<describe cross-platform communication>",
       "services": ["<all services involved>"],
       "steps": [
         { "order": 1, "service": "<svc>", "description": "<cross-platform step>", "crossServiceCall": {"interface": "...", "method": "...", "type": "bridge|http|moa_rpc"} }
       ],
       "architecture": {
         "layers": [{ "name": "<layer>", "services": ["..."], "description": "..." }],
         "communications": [{ "from": "<svc>", "to": "<svc>", "protocol": "<protocol>", "description": "..." }]
       }
     }
     ```
     This document shows the CROSS-PLATFORM interactions (mobile↔backend), NOT copies of internal per-facet flows. Build it from the domain matching results and cross-facet-links.
     **Validated by** `validate_landscape.py` → `validate_business_panorama()` (checks required fields, step structure, architecture communications).

   - `wiki/architecture.json`: top-level system architecture (SERVICE perspective, facet-grouped):
     ```json
     {
       "facets": [
         { "name": "mobile", "label": "移动客户端", "services": ["ddoversea", "ddoversea_flutter"], "description": "..." },
         { "name": "backend", "label": "后端微服务", "services": ["ultron-relation", "ultron-basic-user"], "description": "..." }
       ],
       "crossServiceCalls": ["<merged from per-facet architecture.json — see note below>"],
       "eventFlows": [],
       "sharedResources": []
     }
     ```

     **CRITICAL: Populating `crossServiceCalls`**:
     Read each facet's wiki `architecture.json` (e.g. `<facet-path>/.understand-anything/wiki/architecture.json`) and merge their `crossServiceCalls` arrays into the root-level file. The server facet's architecture typically contains all intra-backend RPC calls — include ALL of them here (the Dashboard's `architectureToMarkdown` function handles cross-facet filtering automatically via the `facets` field). Without this data, the architecture page will only show a service name table with no Mermaid diagram.

     The `facets` field enables the Dashboard to render Mermaid subgraphs grouped by facet type. Intra-facet calls remain visible in each facet's own architecture page.

   The Dashboard reads `system-graph.json` as its authoritative service registry (no directory scanning).

If validation fails:
- Report errors
- Set `meta.json.status = "degraded"`
- Still produce output (degraded is better than nothing)
- Still generate system-graph.json and wiki/ (topology is independent of business-landscape quality)

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
║         .understand-anything/system-graph.json   ║
║         .understand-anything/wiki/               ║
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
