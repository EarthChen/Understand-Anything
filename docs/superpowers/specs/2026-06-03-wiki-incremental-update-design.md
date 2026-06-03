# Wiki Incremental Update Mechanism — Design Spec

**Status**: Approved  
**Date**: 2026-06-03  
**Related**: [understand-wiki design](./2026-06-03-understand-wiki-design.md)

---

## Problem Statement

The `/understand-wiki` command currently only supports two states:
1. **Skip**: commit hash unchanged → do nothing
2. **Full regeneration**: commit hash changed → regenerate all wiki pages

This means any code change triggers full wiki regeneration for the entire service, even if only one domain was affected. For services with 10+ domains, this is wasteful (both in time and LLM tokens).

## Goal

Implement domain-level incremental updates: detect which domains changed and only regenerate their corresponding wiki pages.

---

## Design Decision

**Primary mechanism: Domain-Graph Diffing (DG Diff)**

Rationale:
- `/understand-domain` always regenerates DG fully from KG (lightweight, no file scanning)
- We can cheaply compare old vs new DG to identify changed domains
- Self-contained: doesn't require modifying upstream commands
- Catches all change types including domain boundary reclassification

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                  Wiki Incremental Update Flow                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  1. Save DG Snapshot                                             │
│     domain-graph.json → wiki/domain-graph.snapshot.json          │
│                     ↓                                            │
│  2. /understand (incremental) → KG updated                       │
│                     ↓                                            │
│  3. /understand-domain (full) → DG regenerated                   │
│                     ↓                                            │
│  4. wiki-diff-domains.py(snapshot, new_DG)                       │
│                     ↓                                            │
│  5. Dirty Domain List                                            │
│     ├── empty → update meta.json only, DONE                     │
│     └── non-empty ↓                                             │
│  6. Dispatch wiki-worker ONLY for dirty domains                  │
│                     ↓                                            │
│  7. Merge: replace dirty pages, preserve clean pages             │
│                     ↓                                            │
│  8. Update index.json + meta.json                                │
│                     ↓                                            │
│  9. Quality Gate (only on new/modified pages)                    │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
```

---

## Domain Change Detection Rules

A domain is classified as **"modified"** when ANY of these conditions are true:

| Condition | Example |
|---|---|
| `nodeIds` set changed | Node added to or removed from domain |
| `flows` array changed | Flow added, removed, or steps reordered |
| Domain-internal edges changed | New `imports` / `calls` edges between nodes within the domain |

A domain is classified as **"added"** when it exists in new DG but not in snapshot.

A domain is classified as **"removed"** when it exists in snapshot but not in new DG.

---

## Diff Script: `wiki-diff-domains.py`

### Input
- `--old <path>`: Path to DG snapshot (domain-graph.snapshot.json)
- `--new <path>`: Path to current DG (domain-graph.json)
- `--kg <path>`: Path to KG (for edge comparison within domains)

### Output (JSON to stdout)
```json
{
  "added": ["new-domain-id"],
  "removed": ["old-domain-id"],
  "modified": ["order", "payment"],
  "unchanged": ["auth", "user", "notification"],
  "serviceOverviewDirty": true,
  "crossServiceDirty": false,
  "summary": "2 modified, 1 added, 0 removed, 3 unchanged"
}
```

### Service Overview Dirty Conditions
- Any domain added or removed
- Total node count changed by ≥10%
- Architecture layer definitions changed (layer count or layer assignments)

### Cross-Service Dirty Conditions
- Any `provides_rpc` or `consumes_rpc` edge added/removed/changed in KG

---

## Per-Component Trigger Matrix

| Wiki Component | Regenerate When | Skip When |
|---|---|---|
| Domain page X | X in `added` or `modified` | X in `unchanged` |
| Service overview | `serviceOverviewDirty = true` | Only internal domain content changed |
| Cross-service page | `crossServiceDirty = true` | Only internal changes |
| Parent-level wiki | Any child service wiki was updated | All child services unchanged |

---

## Fallback to Full Generation

If ANY of these conditions are met, bypass incremental and do full generation:

1. No `wiki/meta.json` exists (first run)
2. No DG snapshot available (`wiki/domain-graph.snapshot.json` missing)
3. `--full` flag explicitly passed
4. `wiki-diff-domains.py` exits with error
5. **>80% of domains marked as modified** (heuristic: likely a mass reclassification; full regen produces cleaner results)

When falling back, log the reason:
```
[understand-wiki] Incremental skipped: <reason>. Running full generation.
```

---

## SKILL.md Integration Points

### Phase 0 — Step 5 (Prerequisite Verification) — New Sub-step

Before triggering `/understand-domain`, save the snapshot:

```bash
DG_PATH="$SERVICE_UA/domain-graph.json"
DG_SNAPSHOT="$SERVICE_UA/wiki/domain-graph.snapshot.json"

if [ -f "$DG_PATH" ] && [ -f "$SERVICE_UA/wiki/meta.json" ]; then
  cp "$DG_PATH" "$DG_SNAPSHOT"
  echo "[understand-wiki] DG snapshot saved for incremental diff."
fi
```

### Phase 1 — After DG is ready, before wiki-worker dispatch

```bash
WIKI_META="$SERVICE_UA/wiki/meta.json"
DG_SNAPSHOT="$SERVICE_UA/wiki/domain-graph.snapshot.json"

if [ -f "$WIKI_META" ] && [ -f "$DG_SNAPSHOT" ] && ! echo "$ARGUMENTS" | grep -q '\-\-full'; then
  # Incremental path
  DIFF_RESULT=$(python3 "$SKILL_DIR/wiki-diff-domains.py" \
    --old "$DG_SNAPSHOT" \
    --new "$SERVICE_UA/domain-graph.json" \
    --kg "$SERVICE_UA/knowledge-graph.json")
  
  DIFF_EXIT=$?
  if [ $DIFF_EXIT -ne 0 ]; then
    echo "[understand-wiki] Incremental skipped: diff script error. Running full generation."
    INCREMENTAL=false
  else
    MODIFIED_COUNT=$(echo "$DIFF_RESULT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d['added'])+len(d['modified']))")
    TOTAL_COUNT=$(echo "$DIFF_RESULT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d['added'])+len(d['modified'])+len(d['unchanged']))")
    
    if [ "$TOTAL_COUNT" -gt 0 ] && [ $((MODIFIED_COUNT * 100 / TOTAL_COUNT)) -gt 80 ]; then
      echo "[understand-wiki] Incremental skipped: ${MODIFIED_COUNT}/${TOTAL_COUNT} domains modified (>80%). Running full generation."
      INCREMENTAL=false
    else
      INCREMENTAL=true
      DIRTY_DOMAINS=$(echo "$DIFF_RESULT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(' '.join(d['added']+d['modified']))")
    fi
  fi
else
  # Full generation path
  INCREMENTAL=false
fi
```

### Phase 1 — Wiki Worker Dispatch (Modified)

```bash
if [ "$INCREMENTAL" = true ]; then
  # Only dispatch for dirty domains
  for DOMAIN_ID in $DIRTY_DOMAINS; do
    echo "[understand-wiki] Regenerating domain page: $DOMAIN_ID"
    # dispatch wiki-worker with --domain=$DOMAIN_ID
  done
  
  # Handle removed domains
  REMOVED_DOMAINS=$(echo "$DIFF_RESULT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(' '.join(d['removed']))")
  for DOMAIN_ID in $REMOVED_DOMAINS; do
    rm -f "$SERVICE_UA/wiki/domains/${DOMAIN_ID}.json"
    echo "[understand-wiki] Removed obsolete domain page: $DOMAIN_ID"
  done
  
  # Conditionally regenerate service overview
  SERVICE_OVERVIEW_DIRTY=$(echo "$DIFF_RESULT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['serviceOverviewDirty'])")
  if [ "$SERVICE_OVERVIEW_DIRTY" = "True" ]; then
    echo "[understand-wiki] Regenerating service overview..."
    # dispatch wiki-worker for service-overview
  fi
else
  # Full generation: dispatch wiki-worker for all domains
  # (existing behavior)
fi
```

---

## meta.json Extension

Add per-domain tracking to `wiki/meta.json`:

```json
{
  "version": "1.0",
  "serviceName": "order-service",
  "generatedAt": "2026-06-03T12:00:00Z",
  "gitCommitHash": "abc1234",
  "language": "zh",
  "domainStates": {
    "order-management": {
      "lastGeneratedAt": "2026-06-03T12:00:00Z",
      "nodeCount": 15,
      "flowCount": 3
    },
    "payment": {
      "lastGeneratedAt": "2026-06-03T11:30:00Z",
      "nodeCount": 8,
      "flowCount": 2
    }
  }
}
```

---

## Edge Cases

| Scenario | Behavior |
|---|---|
| First run (no wiki) | Full generation, no snapshot needed |
| DG unchanged | All domains "unchanged" → only update meta.json commit hash |
| Node moved between domains | Both source and target domains marked "modified" |
| New domain created | "added" → full page generation for new domain |
| Domain renamed (same nodes) | "removed" + "added" → delete old + create new |
| DG non-determinism | May cause spurious diffs (correct but wasteful). Fallback if >80% modified. |
| Snapshot corrupted/missing | Fall back to full generation |
| >80% domains modified | Fall back to full generation (likely mass reclassification) |

---

## Implementation Artifacts

| Artifact | Type | Description |
|---|---|---|
| `wiki-diff-domains.py` | New script | Compare old/new DG, output dirty domain list |
| `SKILL.md` Phase 0/1 | Update | Add snapshot + incremental dispatch logic |
| `meta.json` schema | Update | Add `domainStates` field |
| `wiki-schema.ts` | Update | Validate new `domainStates` in meta |
| `wiki-worker.md` | Update | Support `--domain=<id>` for single-domain generation |

---

## Performance Impact

| Scenario | Full Gen | Incremental |
|---|---|---|
| 10 domains, 1 changed | 10 wiki-worker calls | 1 wiki-worker call |
| 10 domains, 3 changed | 10 wiki-worker calls | 3 wiki-worker calls |
| 10 domains, all changed | 10 wiki-worker calls | Fallback → 10 calls |
| No code change | Skip (same as before) | Skip (same as before) |

Token savings: ~70-90% reduction for typical single-domain changes.
