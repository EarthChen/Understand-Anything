# Phase 2 — Step 0: Deterministic Structural Extraction

Run `extract-structure.mjs` once in **full mode** to produce a single global extraction result file. This is a deterministic step — do NOT delegate it to file-analyzer sub-agents. The extraction results are required by `merge-batch-graphs.py` for RPC/MQ annotation recovery.

## Step 0a — Generate full-mode input file

Write a helper script that reads `batches.json`, merges all files and importData across batches, and produces a single full-mode input JSON.

```bash
export PROJECT_ROOT
python3 - "$PROJECT_ROOT" << 'PYSCRIPT'
import json, sys, os
project_root = os.environ.get("PROJECT_ROOT", sys.argv[1])
tmp_dir = os.path.join(project_root, ".understand-anything", "tmp")
batches_path = os.path.join(project_root, ".understand-anything", "intermediate", "batches.json")
os.makedirs(tmp_dir, exist_ok=True)
batches = json.load(open(batches_path))["batches"]
all_files = []
all_import_data = {}
for batch in batches:
    files = batch.get("files", batch.get("batchFiles", []))
    all_files.extend(files)
    all_import_data.update(batch.get("batchImportData", {}))
inp = {
    "projectRoot": project_root,
    "fileList": all_files,
    "importData": all_import_data,
}
out_path = os.path.join(tmp_dir, "ua-full-extract-input.json")
with open(out_path, "w", encoding="utf-8") as f:
    json.dump(inp, f, ensure_ascii=False)
print(f"  Wrote {out_path} ({len(all_files)} files, {len(all_import_data)} import entries)")
PYSCRIPT
```

## Step 0b — Run extraction in full mode (with chunked processing)

Resume support: if `$PROJECT_ROOT/.understand-anything/tmp/ua-extract-results-full.json` already exists, is non-empty, and has `scriptCompleted: true`, skip extraction entirely.

```bash
MAX_RETRIES=2
for attempt in $(seq 0 $MAX_RETRIES); do
  node <SKILL_DIR>/extract-structure.mjs \
    $PROJECT_ROOT/.understand-anything/tmp/ua-full-extract-input.json \
    $PROJECT_ROOT/.understand-anything/tmp/ua-extract-results-full.json && break
  if [ $attempt -eq $MAX_RETRIES ]; then
    echo "FATAL: full-mode extraction failed after $MAX_RETRIES retries" >&2; exit 1;
  fi
  echo "Extraction failed, retrying ($((attempt+1))/$MAX_RETRIES)..."
done
```

The script internally processes files in chunks of 500 to manage memory. Note: if extraction crashes mid-way, all progress is lost (no intermediate checkpoints). For very large projects (5000+ files), consider monitoring memory usage.

## Step 0c — Verify raw output

```bash
test -s $PROJECT_ROOT/.understand-anything/tmp/ua-extract-results-full.json || {
  echo "FATAL: full-mode extraction results missing" >&2; exit 1;
}
node -e "
  const d = JSON.parse(require('fs').readFileSync(process.argv[1],'utf-8'));
  if (!d.scriptCompleted) { console.error('FATAL: extraction degraded (scriptCompleted=false)'); process.exit(1); }
  console.log('Extraction verified: ' + (d.results?.length || 0) + ' files analyzed, ' + (d.filesSkipped?.length || 0) + ' skipped');
" $PROJECT_ROOT/.understand-anything/tmp/ua-extract-results-full.json || exit 1
```

If the extraction script exits non-zero or the output file is missing/empty or `scriptCompleted` is false, report the error and abort Phase 2.

## Step 0c' — Convert to file-path-indexed format

Convert the raw extraction output into a file-path-indexed dictionary. The raw format (`{ scriptCompleted, results: [...] }`) is kept as `ua-extract-results-full.json` for rule engine and debugging; all downstream steps use `structural-analysis.json` (indexed format).

```bash
python3 -c "
import json, os
src = os.path.join('$PROJECT_ROOT', '.understand-anything', 'tmp', 'ua-extract-results-full.json')
dst = os.path.join('$PROJECT_ROOT', '.understand-anything', 'tmp', 'structural-analysis.json')
data = json.load(open(src, encoding='utf-8'))
merged = {}
for r in data.get('results', []):
    p = r.get('path', '')
    if p:
        merged[p] = {k: v for k, v in r.items() if k != 'path'}
with open(dst, 'w', encoding='utf-8') as f:
    json.dump(merged, f, indent=2, ensure_ascii=False)
print(f'  Converted to file-path-indexed format: {len(merged)} files')
"
```

## Step 0c.5 — Run rule engine (deterministic annotation→edge mapping)

Run the rule engine once on the global extraction results to produce annotation-driven edges. This is a deterministic step — do NOT delegate it to LLM agents.

The rule engine maps annotations (e.g., `@Autowired`, `@DubboService`, `@FeignClient`) to graph edges (`injects`, `provides_rpc`, `consumes_rpc`) using built-in framework rules. It also expands meta-annotations and resolves cross-file call graphs.

### Step 0c.5a — Run rule engine on global extraction results

**Rule engine failure is non-fatal** — file-analyzer can still produce edges from LLM semantic analysis.

```bash
EXTRACT_FILE="$PROJECT_ROOT/.understand-anything/tmp/ua-extract-results-full.json"
RULE_OUTPUT="$PROJECT_ROOT/.understand-anything/tmp/rule-engine-results.json"

node <SKILL_DIR>/rule-engine-postprocess.mjs \
  "$EXTRACT_FILE" \
  "$RULE_OUTPUT" \
  --mode=extraction-input

if [ $? -ne 0 ]; then
  echo "WARNING: Rule engine failed globally (all annotation edges lost), file-analyzer will proceed without ruleEngineEdges" >&2
  echo '{"edges":[],"unresolved":[]}' > "$RULE_OUTPUT"
fi
```

### Step 0c.5b — Verify rule engine output and compute statistics

```bash
if [ -f "$RULE_OUTPUT" ]; then
  node -e "
    const d = JSON.parse(require('fs').readFileSync(process.argv[1],'utf-8'));
    if (!Array.isArray(d.edges)) { console.error('WARNING: rule engine output missing edges array, using empty edges'); process.exit(0); }
    console.log('Rule engine: ' + d.edges.length + ' edges, ' + (d.unresolved || []).length + ' unresolved');
  " "$RULE_OUTPUT"
fi
```

### Step 0c.5c — Sanity check (warn if suspiciously low)

```bash
TOTAL_BATCHES=$(python3 -c "import json; print(len(json.load(open('$PROJECT_ROOT/.understand-anything/intermediate/batches.json'))['batches']))")
TOTAL_RULE_EDGES=$(node -e "const d=JSON.parse(require('fs').readFileSync(process.argv[1],'utf-8'));console.log((d.edges||[]).length)" "$RULE_OUTPUT" 2>/dev/null || echo 0)
if [ "$TOTAL_RULE_EDGES" -eq 0 ] && [ "$TOTAL_BATCHES" -gt 0 ]; then
  echo "WARNING: Rule engine produced 0 edges. This is expected for projects without annotations (Python, Go, JS), but suspicious for Java/Kotlin/Spring projects." >&2
fi
```

Report: `Rule engine complete. $TOTAL_RULE_EDGES annotation edges.`

## Step 0c.6 — Split global results into per-batch subsets

The file-analyzer agents expect per-batch extraction and rule engine files. Split the global results into per-batch subset files so downstream steps (dispatch planner, file-analyzer, quality gate, merge) remain unchanged.

```bash
python3 - "$PROJECT_ROOT" << 'PYSCRIPT'
import json, sys, os
project_root = sys.argv[1]
tmp_dir = os.path.join(project_root, ".understand-anything", "tmp")
batches_path = os.path.join(project_root, ".understand-anything", "intermediate", "batches.json")

def extract_path_from_node_id(node_id):
    """Extract file path from node ID like 'class:path/to/file:ClassName'."""
    if ":" not in node_id:
        return node_id
    parts = node_id.split(":", 1)
    rest = parts[1]
    if ":" in rest:
        return rest.rsplit(":", 1)[0]
    return rest

# Load global extraction results (file-path-indexed format)
with open(os.path.join(tmp_dir, "structural-analysis.json"), encoding="utf-8") as f:
    extraction_by_path = json.load(f)

# Load global rule engine results
rule_path = os.path.join(tmp_dir, "rule-engine-results.json")
with open(rule_path, encoding="utf-8") as f:
    rule_data = json.load(f)
all_edges = rule_data.get("edges", [])
all_unresolved = rule_data.get("unresolved", [])

# Load batches
batches = json.load(open(batches_path))["batches"]

for batch in batches:
    batch_index = batch["batchIndex"]
    batch_files = batch.get("files", batch.get("batchFiles", []))
    batch_paths = sorted(f["path"] for f in batch_files)
    batch_path_set = set(batch_paths)

    # Filter extraction results for this batch
    batch_results = [extraction_by_path[p] for p in batch_paths if p in extraction_by_path]
    extract_out = {
        "scriptCompleted": True,
        "filesAnalyzed": len(batch_results),
        "filesSkipped": [p for p in batch_paths if p not in extraction_by_path],
        "results": [{"path": p, **extraction_by_path[p]} for p in batch_paths if p in extraction_by_path],
    }
    extract_path = os.path.join(tmp_dir, f"ua-file-extract-results-{batch_index}.json")
    with open(extract_path, "w", encoding="utf-8") as f:
        json.dump(extract_out, f, ensure_ascii=False)

    # Filter rule engine edges for this batch (match by source path)
    batch_edges = [e for e in all_edges if extract_path_from_node_id(e.get("source", "")) in batch_path_set]
    # Filter unresolved by file field (not all unresolved — each batch gets its own subset)
    batch_unresolved = [u for u in all_unresolved if u.get("file", "") in batch_path_set]
    rule_out = {"edges": batch_edges, "unresolved": batch_unresolved,
                "stats": {"totalEdges": len(batch_edges), "unresolved": len(batch_unresolved)}}
    rule_out_path = os.path.join(tmp_dir, f"ua-rule-engine-results-{batch_index}.json")
    with open(rule_out_path, "w", encoding="utf-8") as f:
        json.dump(rule_out, f, ensure_ascii=False)

print(f"  Split into {len(batches)} batch subsets (extraction + rule engine)")
PYSCRIPT
```

Report: `[Phase 2/7] Structural extraction complete for <totalBatches> batches. Computing dispatch plan...`

## Step 0d — Compute dispatch plan (fusion groups + quality gate)

Run the batch dispatch planner to compute context-aware fusion groups. This groups multiple batches into fewer subagent dispatches using LPT (Longest Processing Time) load balancing based on estimated token consumption:

```bash
python <SKILL_DIR>/batch-dispatch-planner.py --plan $PROJECT_ROOT
```

Read the output at `$PROJECT_ROOT/.understand-anything/tmp/dispatch-plan.json`. The plan contains:
- `fusionGroups[]`: each group specifies `batchIndices` (which batches to assign), `totalLoc`, `totalFiles`, `estimatedTokens`, and `budgetUsage`
- `wavesNeeded`: how many sequential waves are needed given the `MAX_CONCURRENT=5` constraint
- `oversizedGroups[]`: groups that exceed the context budget — warn the user but proceed

If the script fails, fall back to 1:1 dispatch (one subagent per batch, up to 10 concurrent).

Report: `Dispatch plan: <totalBatches> batches → <actualGroups> groups (<wavesNeeded> wave(s), max 10 concurrent)`
