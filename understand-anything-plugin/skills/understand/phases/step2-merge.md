# Phase 2 — Step 2: Merge

Run the merge-and-normalize script bundled with this skill (located next to this SKILL.md file — use the skill directory path, not the project root):
```bash
python <SKILL_DIR>/merge-batch-graphs.py $PROJECT_ROOT
```

This script reads all `batch-*.json` files (including `batch-<i>-part-<k>.json` produced by file-analyzers that split their output) from `$PROJECT_ROOT/.understand-anything/intermediate/`, then in one pass:
- Combines all nodes and edges across batches
- Normalizes node IDs (strips double prefixes, project-name prefixes, adds missing prefixes)
- Normalizes complexity values (`low`→`simple`, `medium`→`moderate`, `high`→`complex`, etc.)
- Rewrites edge references to match corrected node IDs
- Deduplicates nodes by ID (keeps last occurrence) and edges by `(source, target, type)`
- Drops dangling edges referencing missing nodes
- Logs all corrections and dropped items to stderr

The merge script also runs a `tested_by` linker that canonicalizes test-coverage edges in two passes. **Pass 1** walks LLM-emitted `tested_by` edges and flips inverted ones in place; semantically broken edges (test↔test, prod↔prod, orphan endpoints) are dropped. **Pass 2** supplements with path-convention pairings. Production nodes that end up sourcing any `tested_by` edge get a `"tested"` tag. All resulting edges run `production → test`.

Output: `$PROJECT_ROOT/.understand-anything/intermediate/assembled-graph.json`

The merge script also writes `$PROJECT_ROOT/.understand-anything/manifest.json` for cross-repo sharing.

Include the script's warnings in `$PHASE_WARNINGS` for the reviewer.
