## Phase 4 — Parent Index Construction

Report: `[Phase 4/5] Building parent-level index...`

This phase handles **parent-level** index and meta construction (for multi-service projects).

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

### Endpoint Index

Aggregate per-service endpoint files into a parent-level index for Dashboard consumption.

```bash
mkdir -p "$PROJECT_ROOT/.understand-anything/wiki/endpoints"
for svc in $SERVICES; do
  cp "$PROJECT_ROOT/$svc/.understand-anything/wiki/endpoints/"*.json \
     "$PROJECT_ROOT/.understand-anything/wiki/endpoints/" 2>/dev/null || true
done
python3 "$SKILL_DIR/build-endpoint-index.py" \
  --wiki-dir "$PROJECT_ROOT/.understand-anything/wiki"
```

**Behavior:**
- Copies per-service endpoint files from service-level wiki dirs to parent wiki dir
- Runs `build-endpoint-index.py` to produce `endpoints/index.json` with `byService`, `byProtocol`, and `byTopic` groupings
- Dashboard serves this at `/api/wiki/endpoints/index`

**On failure:** Log warning and continue (endpoint index is optional).
