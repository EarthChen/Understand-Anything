# Phase 2 — Incremental Update Path

**Prerequisite:** Incremental runs require `scan-result.json` from a prior full analysis (Phase 1) or preserved from Phase 7 cleanup. Without it, run a full analysis first.

Write the changed-files list (one path per line) to a temp file:
```bash
git diff <lastCommitHash>..HEAD --name-only > $PROJECT_ROOT/.understand-anything/tmp/changed-files.txt
```

Run compute-batches with `--changed-files`:
```bash
node <SKILL_DIR>/compute-batches.mjs $PROJECT_ROOT \
  --changed-files=$PROJECT_ROOT/.understand-anything/tmp/changed-files.txt
```

This produces a `batches.json` that contains only batches with changed files, but neighborMap entries still reference unchanged files (with their full-graph batchIndex) so cross-batch edges remain emittable.

Run deterministic structural extraction for all changed batches (same Step 0 as the full path above), then compute a dispatch plan (Step 0d), dispatch file-analyzer subagents using fusion groups (Step 1), and run the quality gate (Step 1.5–1.7) per the same template as the full path.

After batches complete:
1. Remove old nodes whose `filePath` matches any changed file from the existing graph
2. Remove old edges whose `source` or `target` references a removed node
3. Write the pruned existing nodes/edges as `batch-0.json` in the intermediate directory (reserved index 0 — live batches use 1-based `batchIndex`)
4. Run the same merge script — it will combine `batch-0.json` with the fresh `batch-*.json` files:
   ```bash
   python <SKILL_DIR>/merge-batch-graphs.py $PROJECT_ROOT
   ```
