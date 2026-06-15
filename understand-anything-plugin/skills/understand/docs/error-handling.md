# Error Handling

## Unified Failure Strategy

| Artifact State | Action |
|---|---|
| missing | Build upstream |
| stale (gitCommitHash mismatch) | Rebuild upstream |
| degraded (provenance.degraded=true or no provenance) | Rebuild upstream |
| build fails | Retry (max 2 retries) |
| retry fails | Abort — do NOT continue with weak artifacts |

**Extraction (deterministic scripts) — HARD ABORT:**
- `extract-structure.mjs` and `extract-import-map.mjs` failures are non-recoverable.
- Retry up to 2 times. If still failing, abort Phase 2 entirely.
- Do NOT proceed with agent dispatch without extraction results.
- A graph without structural extraction data is worse than no graph.

**Subagent dispatches (LLM agents) — RETRY-THEN-SKIP:**
- If any subagent dispatch fails, retry **once** with the same prompt plus additional context about the failure.
- Track all warnings and errors from each phase in a `$PHASE_WARNINGS` list. When using `--review`, pass this list to the graph-reviewer in Phase 6. On the default path, include accumulated warnings in the Phase 7 final report.
- If it fails a second time, skip that phase and continue with partial results.
- ALWAYS save partial results — a partial graph is better than no graph.
- Report any skipped phases or errors in the final summary so the user knows what happened.
- NEVER silently drop errors. Every failure must be visible in the final report.
