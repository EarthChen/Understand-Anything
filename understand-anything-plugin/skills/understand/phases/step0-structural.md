# Phase 1.5 — Step 0: Deterministic Structural Extraction

Run `extract-structure.mjs` once in **full mode** to produce a single global extraction result file. This is a deterministic step — do NOT delegate it to file-analyzer sub-agents. The extraction results are required by `merge-batch-graphs.py` for RPC/MQ annotation recovery.

**This step runs BEFORE batch computation** — it reads the file list directly from `scan-result.json`.

## Step 0a — Generate full-mode input file

Read `scan-result.json` to build the full-mode input JSON. The scan result already contains `fileList` and `importMap` in the correct format.

```bash
export PROJECT_ROOT
python3 - "$PROJECT_ROOT" << 'PYSCRIPT'
import json, sys, os
project_root = os.environ.get("PROJECT_ROOT", sys.argv[1])
tmp_dir = os.path.join(project_root, ".understand-anything", "tmp")
scan_path = os.path.join(project_root, ".understand-anything", "intermediate", "scan-result.json")
os.makedirs(tmp_dir, exist_ok=True)
scan = json.load(open(scan_path, encoding="utf-8"))
all_files = scan.get("fileList") or scan.get("files", [])
all_import_data = scan.get("importMap", {})
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

Also copy to `intermediate/extraction/` for downstream use (source index build, dashboard StructureIndex).

```bash
python3 -c "
import json, os, shutil
src = os.path.join('$PROJECT_ROOT', '.understand-anything', 'tmp', 'ua-extract-results-full.json')
dst = os.path.join('$PROJECT_ROOT', '.understand-anything', 'tmp', 'structural-analysis.json')
final = os.path.join('$PROJECT_ROOT', '.understand-anything', 'intermediate', 'extraction', 'structural-analysis.json')
data = json.load(open(src, encoding='utf-8'))
merged = {}
for r in data.get('results', []):
    p = r.get('path', '')
    if p:
        merged[p] = {k: v for k, v in r.items() if k != 'path'}
with open(dst, 'w', encoding='utf-8') as f:
    json.dump(merged, f, indent=2, ensure_ascii=False)
os.makedirs(os.path.dirname(final), exist_ok=True)
shutil.copy2(dst, final)
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
node <SKILL_DIR>/split-batch-results.mjs $PROJECT_ROOT
```

Report: `[Phase 2/8] Structural extraction complete for <totalBatches> batches. Computing dispatch plan...`

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

## Step 0e — Generate per-group config and batch slice files

Run the deterministic prompt generator to create lightweight config files and per-group batch slices for file-analyzer agents:

```bash
node <SKILL_DIR>/gen-dispatch-prompts.mjs $PROJECT_ROOT <SKILL_DIR> "$LANGUAGE_DIRECTIVE"
```

The script reads `dispatch-plan.json` and `scan-result.json`, then writes to `$PROJECT_ROOT/.understand-anything/tmp/dispatch-prompts/`:
- `group-<groupIndex>.json` — config file with project metadata, batchIndices, and file paths
- `batches-group-<groupIndex>.json` — pre-sliced batch data containing only the batches for this group

The batch slice files allow file-analyzer agents to read only their assigned batches instead of loading the entire `batches.json`.
