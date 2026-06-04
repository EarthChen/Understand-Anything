## Phase 3 — Index Construction (Legacy)

> **Note:** Service-level index and metadata generation has been moved to the deterministic assembly pipeline (Phase 1.5).
> `build-wiki-index.py` and `assemble-wiki.py` now handle `index.json` and `meta.json` deterministically.
> See [Phase 1.5 — Assembly Pipeline](wiki-phase1.5-assembly.md) for details.

Report: `[Phase 3/5] Building parent-level index...`

This phase now only handles **parent-level** index and meta construction (for multi-service projects).

### Parent-Level Index

Write `$PROJECT_ROOT/.understand-anything/wiki/index.json`:
```json
{
  "entries": [
    { "id": "wiki:overview", "name": "System Overview", "type": "overview", "summary": "..." },
    { "id": "wiki:architecture", "name": "System Architecture", "type": "architecture", "summary": "..." },
    { "id": "wiki:cross-domain:order-creation", "name": "Order Creation (E2E)", "type": "domain", "summary": "..." }
  ]
}
```

### Parent-Level Meta

Write `$PROJECT_ROOT/.understand-anything/wiki/meta.json`:
```json
{
  "gitCommitHash": "<latest commit across all integrated services>",
  "generatedAt": "<ISO 8601>",
  "version": "1.0.0",
  "outputLanguage": "<$OUTPUT_LANGUAGE>",
  "serviceCount": 3
}
```
