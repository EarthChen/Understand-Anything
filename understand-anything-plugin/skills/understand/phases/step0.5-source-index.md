# Phase 1.5 — Step 3: Build Source Search Index

Build the serialized MiniSearch index for full-text source code search. This is a deterministic step — no LLM involved. Runs after structural extraction completes.

## Step 3a — Verify prerequisite

`structural-analysis.json` must exist at `$PROJECT_ROOT/.understand-anything/intermediate/extraction/structural-analysis.json` (copied during structural extraction). If missing, skip this step with a warning.

```bash
test -f "$PROJECT_ROOT/.understand-anything/intermediate/extraction/structural-analysis.json" || {
  echo "WARNING: structural-analysis.json not found, skipping source index build" >&2
  exit 0
}
```

## Step 3b — Build source index

```bash
node <SKILL_DIR>/build-source-index.mjs "$PROJECT_ROOT"
```

The script:
1. Reads `structural-analysis.json` (AST boundaries: functions, classes, headers, gaps)
2. Reads the original source files from `$PROJECT_ROOT`
3. Chunks source code by AST boundaries
4. Builds a MiniSearch inverted index
5. Serializes to `$PROJECT_ROOT/.understand-anything/intermediate/extraction/source-index.json`

The serialized file contains only the inverted index and metadata references (filePath, startLine, endLine) — NOT raw source content — keeping file size small (~5-12MB for large projects).

## Step 3c — Verify output

```bash
test -f "$PROJECT_ROOT/.understand-anything/intermediate/extraction/source-index.json" || {
  echo "WARNING: source-index.json not generated" >&2
}
```

**If the script exits non-zero**, log a warning but do NOT abort — source search is a non-critical enhancement. The dashboard and query commands will fall back to building the index on-demand at query time.

Report: `Source index built: <N> chunks indexed.`
