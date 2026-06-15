# Phase 2 — Step 1: Dispatch file-analyzer agents

**Before dispatching**, detect already-completed batches by checking for existing output files. This enables automatic resume when a previous run was interrupted.

For each batch in `batches.json`, check if its output already exists on disk:
- Single-file: `$PROJECT_ROOT/.understand-anything/intermediate/batch-<batchIndex>.json` (non-empty)
- Split-file: `$PROJECT_ROOT/.understand-anything/intermediate/batch-<batchIndex>-part-*.json` (at least one non-empty part)

If an output file exists but contains invalid JSON (e.g. truncated from a crash), treat it as incomplete and re-process.

Filter to only include batches **without** existing output. If all batches are complete, skip directly to the merge step. If some batches were skipped, report:
> `Resuming: <N>/<total> batches already complete. Dispatching remaining <M>...`

For remaining batches, use the fusion groups from `dispatch-plan.json` (Step 0d) to determine subagent dispatch. Each fusion group becomes **one subagent invocation** handling multiple batches. Run up to **10 subagents concurrently** (one wave at a time if `wavesNeeded > 1`).

If `dispatch-plan.json` is unavailable (Step 0d failed), fall back to 1:1 dispatch (one subagent per batch, up to 10 concurrent).

For each fusion group, dispatch a subagent using the `file-analyzer` agent definition (at `agents/file-analyzer.md`). Append the following additional context:

> **Additional context from main session:**
>
> Project: `<projectName>` — `<projectDescription>`
> Languages: `<languages from Phase 1>`
>
> $LANGUAGE_DIRECTIVE

Dispatch prompt template — fill in values per fusion group. When a group contains multiple batches, concatenate all batch sections into the same prompt:

> Analyze these files and produce GraphNode and GraphEdge objects.
> Project root: `$PROJECT_ROOT`
> Project: `<projectName>`
> Languages: `<languages>`
> Skill directory (for bundled scripts): `<SKILL_DIR>`
>
> **You are processing fusion group <groupIndex> containing <N> batch(es): [<batchIndices>].**
> **You MUST write one output file per batch** — `batch-<batchIndex>.json` or `batch-<batchIndex>-part-<k>.json` for split mode.

For EACH batch in the fusion group, include a batch section:

> ---
> ### Batch <batchIndex>/<totalBatches>
> **Extraction results (already generated — do NOT re-run extract-structure.mjs):** `$PROJECT_ROOT/.understand-anything/tmp/ua-file-extract-results-<batchIndex>.json`
> **Rule engine edges (already generated — do NOT re-run rule engine):** Read from `$PROJECT_ROOT/.understand-anything/tmp/ua-rule-engine-results-<batchIndex>.json`
> **Output:** write to `$PROJECT_ROOT/.understand-anything/intermediate/batch-<batchIndex>.json` (single-file mode) OR `batch-<batchIndex>-part-<k>.json` (split mode, per Step B of your output protocol).
>
> Pre-resolved import data for this batch (use directly — do NOT re-resolve imports from source):
> ```json
> <batchImportData JSON from batches.json[i].batchImportData>
> ```
>
> Cross-batch neighbors with their exported symbols (confidence boost for cross-batch edges):
> ```json
> <neighborMap JSON from batches.json[i].neighborMap>
> ```
>
> Rule engine edges for this batch (annotation→edge mapping, meta-annotation resolution, call graph resolution):
> ```json
> <Read from $PROJECT_ROOT/.understand-anything/tmp/ua-rule-engine-results-<batchIndex>.json — include the full "edges" and "unresolved" arrays>
> ```
>
> Files to analyze in this batch (every entry MUST be passed through to `batchFiles` with all four fields — `path`, `language`, `sizeLines`, `fileCategory`):
> 1. `<path>` (<sizeLines> lines, language: `<language>`, fileCategory: `<fileCategory>`)
> 2. `<path>` (<sizeLines> lines, language: `<language>`, fileCategory: `<fileCategory>`)
> ...

**Cross-batch edge generation in fusion groups.** When a fusion group contains multiple batches, the file-analyzer can see files from all batches in the group. Actively generate `depends_on`, `calls`, and `imports` edges for cross-batch file relationships within the same fusion group — for example, if batch 3 contains `Manager.m` and batch 7 contains `Manager.h`, emit a `depends_on` edge from the `.m` file to the `.h` file. Write cross-batch edges to the **source file's** batch output file (i.e., the edge goes into `batch-<sourceBatchIndex>.json`). This significantly improves cross-module relationship coverage for languages with header/implementation separation (C, C++, Objective-C) and module-level imports.

**Output naming is per-batchIndex — no fusion.** If you fuse multiple small batches into a single file-analyzer dispatch for token efficiency, the dispatched agent must STILL write one output file per original `batchIndex` using `batch-<batchIndex>.json` or `batch-<batchIndex>-part-<k>.json`. The merge script's regex (`batch-(\d+)(?:-part-(\d+))?\.json`) silently drops any other naming (e.g., `batch-fused-8-13.json`, `batch-8-13.json`), losing every node and edge in that file. After each dispatch returns, verify each `batchIndex` in the dispatched input has a corresponding `batch-<batchIndex>.json` (or `batch-<batchIndex>-part-*.json`) on disk before proceeding to the next dispatch.

After ALL batches complete, report to the user: `All <totalBatches> batches dispatched. Running quality validation...`

---

## Step 1.5 — Per-batch quality gate

Run the batch dispatch planner in validate mode to check each batch's output quality:

```bash
python <SKILL_DIR>/batch-dispatch-planner.py --validate $PROJECT_ROOT
```

Read the output at `$PROJECT_ROOT/.understand-anything/tmp/batch-validation.json`. The validation checks per-batch:
- **Node coverage**: ≥80% of batch files should have a file-level node
- **Edge ratio**: ≥30% of node count
- **Description coverage**: ≥50% of file nodes should have descriptions

The result contains:
- `summary`: `{ total, passed, warned, failed }`
- `retryBatches[]`: list of batch indices that failed quality checks

Report: `Quality gate: <passed> passed, <warned> warned, <failed> failed out of <total> batches`

The script exits with code **2** when one or more batches failed quality checks (`summary.failed > 0`). Exit code **0** means all batches passed or were warned only. Exit code **1** indicates a fatal error (e.g., missing `batches.json`).

If `failed == 0`, skip Step 1.6 and proceed to merge.

## Step 1.6 — Selective retry for failed batches

If `retryBatches` is non-empty, re-dispatch **only** the failed batches using 1:1 dispatch (one subagent per failed batch, no fusion — these need maximum attention). Use the same dispatch template as Step 1, but append:

> **RETRY RUN — Previous attempt produced low-quality output.** Pay extra attention to generating complete file-level nodes for every file in this batch, with meaningful descriptions and edges.

After retry completes, re-run the quality gate (validates all batches). If any batches still fail, proceed to Step 1.7.

Maximum retry: **1 attempt** per failed batch. Do not retry more than once.

## Step 1.7 — Deterministic recovery fallback

Batches that still fail after retry will be handled by `merge-batch-graphs.py`'s deterministic recovery logic (e.g., `injects` edge recovery from extraction results). No further action needed here — the merge script's built-in recovery is the final safety net.

Report: `Phase 2 complete. <totalBatches> batches analyzed (<retryCount> retried, <stillFailedCount> deferred to deterministic recovery).`
