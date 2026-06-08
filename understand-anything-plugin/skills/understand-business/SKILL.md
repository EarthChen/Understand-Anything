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
