## Phase 3 — Index Construction

Report: `[Phase 3/4] Building search index...`

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
