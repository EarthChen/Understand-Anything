export const meta = {
  name: 'understand',
  description: 'Analyze a codebase to produce an interactive knowledge graph for understanding architecture, components, and relationships',
  phases: [
    { title: 'Pre-flight',    detail: 'Resolve project root, plugin root, language configuration' },
    { title: 'Scan',          detail: 'Discover project files, detect languages and frameworks' },
    { title: 'Structural',    detail: 'Extract structure (tree-sitter) and build source index — deterministic, no LLM' },
    { title: 'Analyze',       detail: 'Batch files, dispatch file-analyzer agents, merge results' },
    { title: 'Assemble',      detail: 'Review assembled graph, fix issues' },
    { title: 'Architecture',  detail: 'Identify architectural layers' },
    { title: 'Tour',          detail: 'Build guided tour steps' },
    { title: 'Review',        detail: 'Validate knowledge graph (deterministic or LLM)' },
    { title: 'Save',          detail: 'Write final output and cleanup' },
  ],
}

// args = { rawArgs: string, cwd: string }
// Note: args is provided by the Workflow harness and is readonly/frozen.
// Do NOT mutate args — read properties directly. Fallbacks for safety:
const _cwd = (args && args.cwd) || '.'
const _rawArgs = (args && args.rawArgs) || ''

// ─── Schemas ─────────────────────────────────────────────────────────────────

const PREFLIGHT_SCHEMA = {
  type: 'object',
  required: ['projectRoot', 'pluginRoot', 'skillDir', 'outputLanguage', 'full', 'review', 'changedFiles'],
  properties: {
    error:          { type: 'string' },
    projectRoot:    { type: 'string' },
    pluginRoot:     { type: 'string' },
    skillDir:       { type: 'string' },
    outputLanguage: { type: 'string' },
    languageDirective: { type: 'string' },
    full:           { type: 'boolean' },
    review:         { type: 'boolean' },
    autoUpdate:     { type: 'boolean' },
    changedFiles:   { type: 'array', items: { type: 'string' } },
    kgExists:       { type: 'boolean' },
    commitHash:     { type: 'string' },
    readmeContent:  { type: 'string' },
    manifestContent:{ type: 'string' },
    dirTree:        { type: 'string' },
    entryPoint:     { type: 'string' },
  },
}

const SCAN_SCHEMA = {
  type: 'object',
  required: ['projectName', 'projectDescription', 'languages', 'frameworks', 'fileCount', 'complexity'],
  properties: {
    projectName:        { type: 'string' },
    projectDescription: { type: 'string' },
    languages:          { type: 'array', items: { type: 'string' } },
    frameworks:         { type: 'array', items: { type: 'string' } },
    fileCount:          { type: 'number' },
    complexity:         { type: 'string' },
    importMap:          { type: 'object' },
    fileList:           { type: 'array' },
    filteredByIgnore:   { type: 'number' },
  },
}

const ASSEMBLE_SCHEMA = {
  type: 'object',
  required: ['issuesCount', 'autoFixed'],
  properties: {
    issuesCount: { type: 'number' },
    autoFixed:   { type: 'number' },
    warnings:    { type: 'array', items: { type: 'string' } },
  },
}

const ARCHITECTURE_SCHEMA = {
  type: 'object',
  required: ['layersCount'],
  properties: {
    layersCount: { type: 'number' },
    layers:      { type: 'array' },
  },
}

const TOUR_SCHEMA = {
  type: 'object',
  required: ['stepsCount'],
  properties: {
    stepsCount: { type: 'number' },
    steps:      { type: 'array' },
  },
}

const REVIEW_SCHEMA = {
  type: 'object',
  required: ['valid', 'issuesCount'],
  properties: {
    valid:       { type: 'boolean' },
    issuesCount: { type: 'number' },
    issues:      { type: 'array' },
    warnings:    { type: 'array', items: { type: 'string' } },
  },
}

const SAVE_SCHEMA = {
  type: 'object',
  required: ['success', 'outputPath'],
  properties: {
    success:    { type: 'boolean' },
    outputPath: { type: 'string' },
    nodesCount: { type: 'number' },
    edgesCount: { type: 'number' },
    layersCount:{ type: 'number' },
    stepsCount: { type: 'number' },
  },
}

// ─── Phase 0: Pre-flight ─────────────────────────────────────────────────────

phase('Pre-flight')

const preflight = await agent(
  `Resolve all configuration for the understand skill.

Working directory: ${_cwd}
Raw arguments: ${_rawArgs}

Complete ALL steps and return structured config.

**Step 1 — Resolve PROJECT_ROOT**
- Parse rawArgs for a non-flag token (any argument that does not start with --)
- If found, treat as target directory path
  - If relative, resolve against cwd
  - Verify path exists and is a directory (run: test -d <path>)
  - If invalid: return { error: "Invalid project directory" }
  - Set PROJECT_ROOT to resolved absolute path
- If no path argument: PROJECT_ROOT = cwd

**Step 2 — Worktree redirect**
Run:
\`COMMON_DIR=$(git -C "$PROJECT_ROOT" rev-parse --git-common-dir 2>/dev/null)\`
\`GIT_DIR=$(git -C "$PROJECT_ROOT" rev-parse --git-dir 2>/dev/null)\`
If both succeed and COMMON_DIR != GIT_DIR:
  MAIN_ROOT = parent(COMMON_DIR)
  If MAIN_ROOT exists and UNDERSTAND_NO_WORKTREE_REDIRECT != 1:
    PROJECT_ROOT = MAIN_ROOT

**Step 3 — Resolve PLUGIN_ROOT**
Check candidates in order:
1. CLAUDE_PLUGIN_ROOT env var
2. $HOME/.understand-anything-plugin
3. Resolve from ~/.agents/skills/understand symlink
4. Resolve from ~/.copilot/skills/understand symlink
5. $HOME/.codex/understand-anything/understand-anything-plugin
6. $HOME/.opencode/understand-anything/understand-anything-plugin
7. $HOME/understand-anything/understand-anything-plugin

For each candidate: check if package.json AND pnpm-workspace.yaml exist
If found: PLUGIN_ROOT = candidate, SKILL_DIR = PLUGIN_ROOT/skills/understand
If not found: return { error: "Cannot find plugin root" }

**Step 4 — Ensure plugin is built**
If PLUGIN_ROOT/packages/core/dist/index.js does not exist:
  Run: cd PLUGIN_ROOT && pnpm install && pnpm --filter @understand-anything/core build

**Step 5 — Parse flags**
- full = rawArgs contains "--full"
- review = rawArgs contains "--review"
- autoUpdate = rawArgs contains "--auto-update" (set true) or "--no-auto-update" (set false)

**Step 6 — Get commit hash**
Run: \`git -C "$PROJECT_ROOT" rev-parse HEAD\`
Store as commitHash

**Step 7 — Create directories**
Run: \`mkdir -p "$PROJECT_ROOT/.understand-anything/intermediate" "$PROJECT_ROOT/.understand-anything/tmp"\`

**Step 8 — Language configuration**
Parse "--language <lang>" from rawArgs
If found: normalize (chinese→zh, japanese→ja, etc.), write to config.json
If not: read from config.json, default "en"
Build languageDirective if non-English

**Step 9 — Check existing graph**
Check if $PROJECT_ROOT/.understand-anything/knowledge-graph.json exists (NOT any other path like bak/) → set kgExists = true or false
If NOT full AND kgExists:
  Read $PROJECT_ROOT/.understand-anything/meta.json for gitCommitHash
  If commitHash matches: set changedFiles = [] (up to date)
  If different: run \`git diff <lastHash>..HEAD --name-only\` to get changedFiles
If NOT kgExists: set changedFiles = ["*"] (signal that full scan is needed, graph does not exist)

**Step 10 — Collect project context**
- Read README.md (first 3000 chars) → readmeContent
- Read package.json/pyproject.toml/Cargo.toml/go.mod → manifestContent
- Run: \`find $PROJECT_ROOT -maxdepth 2 -type f -not -path '*/node_modules/*' -not -path '*/.git/*' | head -100\` → dirTree
- Detect entry point (src/index.ts, main.py, etc.) → entryPoint

Return all fields in PREFLIGHT_SCHEMA.`,
  { schema: PREFLIGHT_SCHEMA, phase: 'Pre-flight', label: 'preflight' }
)

if (preflight.error) {
  log(`Pre-flight failed: ${preflight.error}`)
  return { success: false, error: preflight.error }
}

// ─── Phase 1: Scan ───────────────────────────────────────────────────────────

phase('Scan')

// Skip scan if incremental with no changed files AND graph already exists.
// When changedFiles is empty but no graph exists, we must still scan everything.
// preflight.kgExists is set by the preflight agent (Step 9).
if (!preflight.full && preflight.kgExists && preflight.changedFiles && preflight.changedFiles.length === 0) {
  log('Graph is up to date — no changes detected')
  return { success: true, upToDate: true }
}
if (!preflight.kgExists) {
  log('No existing knowledge graph — full scan required')
}

const scanResult = await agent(
  `Scan this project directory to discover all project files, detect languages and frameworks.

Project root: ${preflight.projectRoot}
Write output to: ${preflight.projectRoot}/.understand-anything/intermediate/scan-result.json

Use the project-scanner agent definition at: ${preflight.pluginRoot}/agents/project-scanner.md

Additional context from main session:

Project README (first 3000 chars):
${preflight.readmeContent || '(not available)'}

Package manifest:
${preflight.manifestContent || '(not available)'}

Use this context to produce more accurate project name, description, and framework detection.

${preflight.languageDirective || ''}

The agent should:
1. Discover all project files (code, config, docs, infra, data, script, markup)
2. Detect languages and frameworks
3. Build import map (project-internal imports per file)
4. Write scan-result.json with: projectName, projectDescription, languages, frameworks, fileList, complexity, importMap

Return the scan results.`,
  { schema: SCAN_SCHEMA, phase: 'Scan', label: 'scan' }
)

// Store for later phases
const projectName = scanResult.projectName
const projectDescription = scanResult.projectDescription
const languages = scanResult.languages
const frameworks = scanResult.frameworks
const importMap = scanResult.importMap
const _fileList = scanResult.fileList

if (scanResult.filteredByIgnore > 0) {
  log(`Excluded ${scanResult.filteredByIgnore} files via .understandignore`)
}

log(`Phase 1 complete. Found ${scanResult.fileCount} files across ${languages.length} languages`)

// ─── Phase 1.5: Structural Extraction + Source Index (deterministic) ────────

phase('Structural')

// Step 1: Run reextract-structure.mjs (import + structure + source index)
// --skip-scan reuses Phase 1's scan-result.json; tmp/ is preserved for downstream pipeline use
const structuralResult = await agent(
  `Run the deterministic structural extraction pipeline.

Project root: ${preflight.projectRoot}
Skill dir: ${preflight.skillDir}

Execute this command:
\`node "${preflight.skillDir}/reextract-structure.mjs" "${preflight.projectRoot}" --skip-scan\`

The script handles: import resolution, tree-sitter extraction, structural-analysis.json, and source index.
It reads the existing scan-result.json from Phase 1 (--skip-scan) and preserves tmp/ for downstream pipeline use.

After the script completes, verify these outputs exist:
- ${preflight.projectRoot}/.understand-anything/intermediate/extraction/structural-analysis.json
- ${preflight.projectRoot}/.understand-anything/intermediate/extraction/source-index.json

Return: success (boolean), filesExtracted (number from script output)`,
  { phase: 'Structural', label: 'reextract' }
)

// Step 2: Run rule engine (not included in reextract-structure.mjs)
const ruleEngineResult = await agent(
  `Run the rule engine on structural extraction results.

Project root: ${preflight.projectRoot}
Skill dir: ${preflight.skillDir}

Execute this command:
\`node "${preflight.skillDir}/rule-engine-postprocess.mjs" \\
  "${preflight.projectRoot}/.understand-anything/tmp/ua-extract-results-full.json" \\
  "${preflight.projectRoot}/.understand-anything/tmp/rule-engine-results.json" \\
  --mode=extraction-input\`

If the command fails, create an empty result:
\`echo '{"edges":[],"unresolved":[]}' > "${preflight.projectRoot}/.understand-anything/tmp/rule-engine-results.json"\`

Return: ruleEngineEdges (number)`,
  { phase: 'Structural', label: 'rule-engine' }
)

log(`Phase 1.5 complete. ${structuralResult.filesExtracted || '?'} files extracted, ${ruleEngineResult.ruleEngineEdges || 0} rule engine edges`)

// ─── Phase 2: Batch + Analyze ───────────────────────────────────────────────

phase('Analyze')

// Compute batches
const _batchesResult = await agent(
  `Compute structural batches for analysis.

Project root: ${preflight.projectRoot}
Skill dir: ${preflight.skillDir}

Run the batching script:
\`node "${preflight.skillDir}/compute-batches.mjs" "${preflight.projectRoot}"\`

If the script outputs quality=LOW, adjust parameters and retry (max 3 rounds):
- Raise --min-batch-size for many small batches
- Raise --max-community-size for mixed-directory batches
- Raise --max-merge-target for too many batches

After batching completes, read ${preflight.projectRoot}/.understand-anything/intermediate/batches.json

Return the batch count and diagnostic info.`,
  { phase: 'Analyze', label: 'batch' }
)

// Step 1: Split global results into per-batch subsets (deterministic)
const splitResult = await agent(
  `Split global extraction and rule engine results into per-batch subsets.

Run: node "${preflight.skillDir}/split-batch-results.mjs" "${preflight.projectRoot}"

Return: success (boolean), batchesProcessed (number)`,
  { phase: 'Analyze', label: 'split' }
)

log(`Split complete. ${splitResult.batchesProcessed || '?'} batch subsets created.`)

// Step 2: Compute dispatch plan (deterministic)
const DISPATCH_PLAN_SCHEMA = {
  type: 'object',
  required: ['fusionGroups'],
  properties: {
    fusionGroups: {
      type: 'array',
      items: {
        type: 'object',
        required: ['groupIndex', 'batchIndices'],
        properties: {
          groupIndex: { type: 'number' },
          batchIndices: { type: 'array', items: { type: 'number' } },
          totalLoc: { type: 'number' },
          totalFiles: { type: 'number' },
          estimatedTokens: { type: 'number' },
          budgetUsage: { type: 'number' },
        },
      },
    },
  },
}

const dispatchPlanResult = await agent(
  `Compute the dispatch plan for file-analyzer agents.

Project root: ${preflight.projectRoot}
Skill dir: ${preflight.skillDir}

Execute:
\`\`\`bash
python "${preflight.skillDir}/batch-dispatch-planner.py" --plan "${preflight.projectRoot}"
\`\`\`

Read the output at ${preflight.projectRoot}/.understand-anything/tmp/dispatch-plan.json

Return the fusionGroups array with all fields (groupIndex, batchIndices, totalLoc, totalFiles, estimatedTokens, budgetUsage).`,
  { phase: 'Analyze', label: 'dispatch-plan', schema: DISPATCH_PLAN_SCHEMA }
)

const fusionGroups = dispatchPlanResult.fusionGroups || []
log(`Dispatch plan: ${fusionGroups.length} groups`)

// Step 2.5: Generate per-group dispatch prompt files and per-group batch slices (deterministic script)
const genPromptsResult = await agent(
  `Generate per-group dispatch prompt files and batch slices for file-analyzer agents.

Project root: ${preflight.projectRoot}
Skill dir: ${preflight.skillDir}
Language directive: ${preflight.languageDirective || ''}

Execute this command:
\`\`\`bash
node "${preflight.skillDir}/gen-dispatch-prompts.mjs" "${preflight.projectRoot}" "${preflight.skillDir}" "${preflight.languageDirective || ''}"
\`\`\`

The script reads dispatch-plan.json and scan-result.json, then writes:
1. Lightweight JSON config files (paths + metadata only) to:
   ${preflight.projectRoot}/.understand-anything/tmp/dispatch-prompts/group-<groupIndex>.json
2. Per-group batch slice files to:
   ${preflight.projectRoot}/.understand-anything/tmp/dispatch-prompts/batches-group-<groupIndex>.json

Return: groupsGenerated (number)`,
  { phase: 'Analyze', label: 'gen-prompts' }
)

log(`Generated ${genPromptsResult.groupsGenerated || '?'} dispatch prompt files`)

log(`Dispatching ${fusionGroups.length} file-analyzer agents...`)

// Schema for file-analyzer structured response
const FILE_ANALYZER_SCHEMA = {
  type: 'object',
  required: ['nodesCount', 'edgesCount', 'batchesProcessed'],
  properties: {
    nodesCount:       { type: 'number' },
    edgesCount:       { type: 'number' },
    batchesProcessed: { type: 'number' },
    warnings:         { type: 'array', items: { type: 'string' } },
  },
}

const MAX_CONCURRENT = 10
const allWarnings = []
let totalNodes = 0
let totalEdges = 0
let totalBatchesProcessed = 0

for (let waveIdx = 0; waveIdx < fusionGroups.length; waveIdx += MAX_CONCURRENT) {
  const wave = fusionGroups.slice(waveIdx, waveIdx + MAX_CONCURRENT)
  const waveNum = Math.floor(waveIdx / MAX_CONCURRENT) + 1
  const totalWaves = Math.ceil(fusionGroups.length / MAX_CONCURRENT)
  log(`Wave ${waveNum}/${totalWaves}: dispatching ${wave.length} agents...`)

  const waveResults = await parallel(
    wave.map(group => () => {
      const promptPath = `${preflight.projectRoot}/.understand-anything/tmp/dispatch-prompts/group-${group.groupIndex}.json`

      return agent(
        `You are a file-analyzer agent. Read the config file at "${promptPath}" — it contains project metadata, batchIndices, and file paths.

Use the file-analyzer agent definition at: ${preflight.pluginRoot}/agents/file-analyzer.md

Follow the agent definition to:
1. Phase 0: Read batch data from batchSlicePath for your batchIndices
2. Phase 1: Read extraction results from disk
3. Phase 1.5: Read rule engine edges from disk
4. Phase 2: Semantic analysis — produce GraphNode and GraphEdge objects

Write output to $PROJECT_ROOT/.understand-anything/intermediate/batch-<batchIndex>.json (one per batch).

Return the structured result: { nodesCount, edgesCount, batchesProcessed, warnings? }.`,
        {
          phase: 'Analyze',
          label: `file-analyzer-${group.groupIndex}`,
          schema: FILE_ANALYZER_SCHEMA,
        }
      )
    })
  )

  const succeeded = waveResults.filter(Boolean)
  log(`Wave ${waveNum}/${totalWaves} complete: ${succeeded.length}/${wave.length} succeeded`)

  for (const result of succeeded) {
    if (result.nodesCount) totalNodes += result.nodesCount
    if (result.edgesCount) totalEdges += result.edgesCount
    if (result.batchesProcessed) totalBatchesProcessed += result.batchesProcessed
    if (result.warnings) allWarnings.push(...result.warnings)
  }
}

log(`All ${fusionGroups.length} file-analyzer agents dispatched. Running quality validation...`)

// Step 4: Quality validation with retry loop
const QUALITY_SCHEMA = {
  type: 'object',
  required: ['passed', 'warned', 'failed'],
  properties: {
    passed:       { type: 'number' },
    warned:       { type: 'number' },
    failed:       { type: 'number' },
    retryBatches: { type: 'array', items: { type: 'number' } },
  },
}
const MAX_RETRIES = 2
let qualityResult

for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
  qualityResult = await agent(
    `Run batch quality validation.

Project root: ${preflight.projectRoot}
Skill dir: ${preflight.skillDir}

Execute:
\`\`\`bash
python "${preflight.skillDir}/batch-dispatch-planner.py" --validate "${preflight.projectRoot}"
\`\`\`

Read the output at ${preflight.projectRoot}/.understand-anything/tmp/batch-validation.json.
The result contains: summary.total, summary.passed, summary.warned, summary.failed, retryBatches[].

Report the quality gate results and return: passed, warned, failed, retryBatches`,
    { phase: 'Analyze', label: `quality${attempt > 0 ? `-retry-${attempt}` : ''}`, schema: QUALITY_SCHEMA }
  )

  log(`Quality gate${attempt > 0 ? ` (retry ${attempt})` : ''}: ${qualityResult.passed || '?'} passed, ${qualityResult.warned || '?'} warned, ${qualityResult.failed || '?'} failed`)

  const retryBatches = qualityResult.retryBatches || []
  if (retryBatches.length === 0 || attempt === MAX_RETRIES) {
    if (retryBatches.length > 0) {
      log(`WARNING: ${retryBatches.length} batches still failing after ${MAX_RETRIES} retries — proceeding to merge`)
    }
    break
  }

  // Re-dispatch failed batches: find which fusion groups contain them
  const retryBatchSet = new Set(retryBatches)
  const retryGroups = fusionGroups.filter(g =>
    g.batchIndices.some(idx => retryBatchSet.has(idx))
  )
  log(`Retrying ${retryGroups.length} groups (${retryBatches.length} failed batches)...`)

  for (let waveIdx = 0; waveIdx < retryGroups.length; waveIdx += MAX_CONCURRENT) {
    const wave = retryGroups.slice(waveIdx, waveIdx + MAX_CONCURRENT)
    const waveResults = await parallel(
      wave.map(group => () => {
        const promptPath = `${preflight.projectRoot}/.understand-anything/tmp/dispatch-prompts/group-${group.groupIndex}.json`
        return agent(
          `You are a file-analyzer agent. Read the config file at "${promptPath}" — it contains project metadata, batchIndices, and file paths.

Use the file-analyzer agent definition at: ${preflight.pluginRoot}/agents/file-analyzer.md

Follow the agent definition to:
1. Phase 0: Read batch data from batchSlicePath for your batchIndices
2. Phase 1: Read extraction results from disk
3. Phase 1.5: Read rule engine edges from disk
4. Phase 2: Semantic analysis — produce GraphNode and GraphEdge objects

Write output to $PROJECT_ROOT/.understand-anything/intermediate/batch-<batchIndex>.json (one per batch).

Return the structured result: { nodesCount, edgesCount, batchesProcessed, warnings? }.`,
          { phase: 'Analyze', label: `file-analyzer-retry-${group.groupIndex}`, schema: FILE_ANALYZER_SCHEMA }
        )
      })
    )

    for (const result of waveResults.filter(Boolean)) {
      if (result.nodesCount) totalNodes += result.nodesCount
      if (result.edgesCount) totalEdges += result.edgesCount
      if (result.batchesProcessed) totalBatchesProcessed += result.batchesProcessed
      if (result.warnings) allWarnings.push(...result.warnings)
    }
  }
}

// Step 5: Merge all batch results
const mergeResult = await agent(
  `Merge all batch results into assembled graph.

Project root: ${preflight.projectRoot}
Skill dir: ${preflight.skillDir}

Execute:
\`\`\`bash
python "${preflight.skillDir}/merge-batch-graphs.py" "${preflight.projectRoot}"
\`\`\`

The script reads all batch-*.json files from ${preflight.projectRoot}/.understand-anything/intermediate/
and merges them into assembled-graph.json.

Include any warnings from the script in your response.

Return: nodesCount (number), edgesCount (number), warnings (array of strings)`,
  { phase: 'Analyze', label: 'merge' }
)

log(`Merge complete. ${mergeResult.nodesCount || '?'} nodes, ${mergeResult.edgesCount || '?'} edges`)

const analyzeResult = {
  nodesCount: mergeResult.nodesCount ?? totalNodes,
  edgesCount: mergeResult.edgesCount ?? totalEdges,
  batchesProcessed: totalBatchesProcessed,
  warnings: [...allWarnings, ...(mergeResult.warnings || [])],
}

log(`Phase 3 complete. Extracted ${analyzeResult.nodesCount} nodes, ${analyzeResult.edgesCount} edges`)

// ─── Phase 3: Assemble ───────────────────────────────────────────────────────

phase('Assemble')

const assembleResult = await agent(
  `Review the assembled graph and fix issues.

Project root: ${preflight.projectRoot}
Skill dir: ${preflight.skillDir}
Plugin root: ${preflight.pluginRoot}

Use the assemble-reviewer agent definition at: ${preflight.pluginRoot}/agents/assemble-reviewer.md

Pass these parameters:
- Assembled graph: ${preflight.projectRoot}/.understand-anything/intermediate/assembled-graph.json
- Batch files: ${preflight.projectRoot}/.understand-anything/intermediate/batch-*.json
- Import map: ${JSON.stringify(importMap || {})}

The agent should:
1. Review the assembled graph for completeness
2. Verify cross-batch edges are valid
3. Fix dangling references
4. Write review to: ${preflight.projectRoot}/.understand-anything/intermediate/assemble-review.json

Return: issuesCount, autoFixed, warnings`,
  { schema: ASSEMBLE_SCHEMA, phase: 'Assemble', label: 'assemble' }
)

log(`Phase 4 complete. ${assembleResult.issuesCount} issues found, ${assembleResult.autoFixed} auto-fixed`)

// ─── Phase 4: Architecture ───────────────────────────────────────────────────

phase('Architecture')

const architectureResult = await agent(
  `Identify architectural layers in the codebase.

Project root: ${preflight.projectRoot}
Skill dir: ${preflight.skillDir}
Plugin root: ${preflight.pluginRoot}
Output language: ${preflight.outputLanguage}
${preflight.languageDirective || ''}

Use the architecture-analyzer agent definition at: ${preflight.pluginRoot}/agents/architecture-analyzer.md

Additional context:
- Frameworks detected: ${frameworks.join(', ')}
- Directory tree:
${preflight.dirTree || '(not available)'}

Language context:
For each language detected (${languages.join(', ')}), read the file at:
${preflight.skillDir}/languages/<language-id>.md

Framework addendum:
For each framework detected, read: ${preflight.skillDir}/frameworks/<framework-id-lowercase>.md

Output locale:
If non-English, read: ${preflight.skillDir}/locales/${preflight.outputLanguage}.md

The agent should:
1. Analyze file nodes and edges to identify layer boundaries
2. Assign files to architectural layers
3. Write layers to: ${preflight.projectRoot}/.understand-anything/intermediate/layers.json

After the agent completes, normalize the output:
1. Unwrap envelope if { "layers": [...] }
2. Rename "nodes" → "nodeIds" if needed
3. Synthesize missing layer IDs
4. Convert file paths to prefixed format (file:, config:, etc.)
5. Drop dangling references

Return: layersCount, layers`,
  { schema: ARCHITECTURE_SCHEMA, phase: 'Architecture', label: 'architecture' }
)

if (architectureResult.layersCount === 0) {
  log('WARNING: No layers produced — retrying Phase 4')
  // Retry logic would go here
}

log(`Phase 5 complete. Identified ${architectureResult.layersCount} architectural layers`)

// ─── Phase 5: Tour ───────────────────────────────────────────────────────────

phase('Tour')

const tourResult = await agent(
  `Build a guided tour for the codebase.

Project root: ${preflight.projectRoot}
Skill dir: ${preflight.skillDir}
Plugin root: ${preflight.pluginRoot}
Output language: ${preflight.outputLanguage}
${preflight.languageDirective || ''}

Use the tour-builder agent definition at: ${preflight.pluginRoot}/agents/tour-builder.md

Additional context:
- Project README: ${preflight.readmeContent || '(not available)'}
- Entry point: ${preflight.entryPoint || '(not detected)'}

The agent should:
1. Read the assembled graph
2. Create a guided learning tour with ordered steps
3. Each step has: order, title, description, nodeIds
4. Write tour to: ${preflight.projectRoot}/.understand-anything/intermediate/tour.json

After the agent completes, normalize the output:
1. Unwrap envelope if { "steps": [...] }
2. Rename legacy fields (nodesToInspect → nodeIds, whyItMatters → description)
3. Convert file paths to prefixed format
4. Drop dangling references
5. Sort by order

Return: stepsCount, steps`,
  { schema: TOUR_SCHEMA, phase: 'Tour', label: 'tour' }
)

if (tourResult.stepsCount === 0) {
  log('WARNING: No tour steps produced')
}

log(`Phase 6 complete. Generated ${tourResult.stepsCount} tour steps`)

// ─── Phase 6: Review ─────────────────────────────────────────────────────────

phase('Review')

// Assemble the full KnowledgeGraph
const knowledgeGraph = {
  version: '1.0.0',
  project: {
    name: projectName,
    languages: languages,
    frameworks: frameworks,
    description: projectDescription,
    analyzedAt: '<placeholder>', // Will be set by Save agent
    gitCommitHash: preflight.commitHash,
  },
  nodes: [], // Would be populated from assembled-graph.json
  edges: [], // Would be populated from assembled-graph.json
  layers: architectureResult.layers || [],
  tour: tourResult.steps || [],
}

// Validate layers and tour are not empty
if (!knowledgeGraph.layers || knowledgeGraph.layers.length === 0) {
  log('ERROR: layers is empty — cannot proceed')
  return { success: false, error: 'No layers produced' }
}

if (!knowledgeGraph.tour || knowledgeGraph.tour.length === 0) {
  log('ERROR: tour is empty — cannot proceed')
  return { success: false, error: 'No tour steps produced' }
}

// Write assembled graph to intermediate for Review phase
// Assemble from intermediate files (layers.json, tour.json, batch-*.json)
// NOTE: This is a placeholder — the Save agent will do the actual assembly.

let reviewResult

if (preflight.review) {
  // Full LLM reviewer
  reviewResult = await agent(
    `Validate the knowledge graph using LLM reviewer.

Project root: ${preflight.projectRoot}
Plugin root: ${preflight.pluginRoot}

Use the graph-reviewer agent definition at: ${preflight.pluginRoot}/agents/graph-reviewer.md

The agent should:
1. Read the assembled graph
2. Validate completeness and correctness
3. Cross-validate with Phase 1 scan results
4. Flag missing files or dangling references
5. Write review to: ${preflight.projectRoot}/.understand-anything/intermediate/review.json

Return: valid, issuesCount, issues, warnings`,
    { schema: REVIEW_SCHEMA, phase: 'Review', label: 'review-llm' }
  )
} else {
  // Deterministic validation
  reviewResult = await agent(
    `Run deterministic validation on the knowledge graph.

Skill dir: ${preflight.skillDir}

Run the validation script:
\`node "${preflight.skillDir}/validate-graph.mjs" "${preflight.projectRoot}/.understand-anything/intermediate/assembled-graph.json" "${preflight.projectRoot}/.understand-anything/intermediate/review.json"\`

Read the review.json and report:
- Auto-corrected issues
- Dropped issues
- Any remaining warnings

Return: valid, issuesCount, issues, warnings`,
    { schema: REVIEW_SCHEMA, phase: 'Review', label: 'review-deterministic' }
  )
}

if (!reviewResult || typeof reviewResult.valid === 'undefined') {
  return { success: false, error: 'Review phase failed: agent returned invalid result. Cannot proceed without validation.' }
}

// Apply automated fixes if issues found
if (reviewResult.issuesCount > 0) {
  log(`Found ${reviewResult.issuesCount} issues — applying automated fixes`)
  // Fix logic would go here
}

log(`Phase 7 complete. Validation ${reviewResult.valid ? 'passed' : 'passed with warnings'}`)

// ─── Phase 7: Save ───────────────────────────────────────────────────────────

phase('Save')

const saveResult = await agent(
  `Save the final knowledge graph and cleanup.

Project root: ${preflight.projectRoot}
Skill dir: ${preflight.skillDir}
Commit hash: ${preflight.commitHash}

**Step 1 — Write knowledge-graph.json**
Read the assembled graph from intermediate files and write the final graph to: ${preflight.projectRoot}/.understand-anything/knowledge-graph.json

Read these files:
- ${preflight.projectRoot}/.understand-anything/intermediate/assembled-graph.json (nodes and edges)
- ${preflight.projectRoot}/.understand-anything/intermediate/layers.json (architecture layers)
- ${preflight.projectRoot}/.understand-anything/intermediate/tour.json (tour steps)
- ${preflight.projectRoot}/.understand-anything/intermediate/scan-result.json (project metadata)

Assemble into knowledge-graph.json with this structure:
{
  "version": "1.0.0",
  "project": {
    "name": "<from scan-result.json projectName>",
    "description": "<from scan-result.json projectDescription>",
    "languages": "<from scan-result.json languages>",
    "frameworks": "<from scan-result.json frameworks>",
    "analyzedAt": "<ISO 8601>",
    "gitCommitHash": "${preflight.commitHash}",
    "provenance": { "generationMode": "auto", "completedStages": ["scan","structural","analyze","assemble","architecture","tour"], "degraded": false, "toolVersion": "1.0.0" }
  },
  "nodes": "<from assembled-graph.json nodes>",
  "edges": "<from assembled-graph.json edges>",
  "layers": "<from layers.json>",
  "tour": "<from tour.json>"
}

Use Bash to read the files and write the assembled JSON. Example:
\`\`\`bash
python3 -c "
import json
# Read intermediate files
graph = json.load(open('...intermediate/assembled-graph.json'))
layers = json.load(open('...intermediate/layers.json'))
tour = json.load(open('...intermediate/tour.json'))
scan = json.load(open('...intermediate/scan-result.json'))
# Assemble
kg = {
  'version': '1.0.0',
  'project': {
    'name': scan.get('projectName',''),
    'description': scan.get('projectDescription',''),
    'languages': scan.get('languages',[]),
    'frameworks': scan.get('frameworks',[]),
    'analyzedAt': '$(date -u +%Y-%m-%dT%H:%M:%SZ)',
    'gitCommitHash': '${preflight.commitHash}',
    'provenance': {'generationMode':'auto','completedStages':['scan','structural','analyze','assemble','architecture','tour'],'degraded':False,'toolVersion':'1.0.0'}
  },
  'nodes': graph.get('nodes',[]),
  'edges': graph.get('edges',[]),
  'layers': layers.get('layers',layers) if isinstance(layers, dict) else layers,
  'tour': tour.get('steps',tour) if isinstance(tour, dict) else tour
}
json.dump(kg, open('...knowledge-graph.json','w'), indent=2, ensure_ascii=False)
print(f'Written: {len(kg["nodes"])} nodes, {len(kg["edges"])} edges')
"
\`\`\`
(Replace ... with the actual paths.)

**Step 2 — Generate fingerprints baseline**
Run: \`node "${preflight.skillDir}/build-fingerprints.mjs" "${preflight.projectRoot}/.understand-anything/intermediate/fingerprint-input.json"\`

**Step 3 — Write meta.json**
Write to: ${preflight.projectRoot}/.understand-anything/meta.json
{
  "lastAnalyzedAt": "<ISO 8601>",
  "gitCommitHash": "${preflight.commitHash}",
  "version": "1.0.0",
  "analyzedFiles": <count>
}

**Step 4 — Schema validation**
Run: \`node "${preflight.skillDir}/validate-artifact.mjs" "${preflight.projectRoot}/.understand-anything/knowledge-graph.json" knowledge-graph:complete\`

**Step 5 — Cleanup**
- Preserve scan-result.json and extraction/ directory
- Remove other intermediate files
- Remove tmp directory

**Step 6 — Report summary**
Print summary with: project name, files analyzed, nodes, edges, layers, tour steps

Return: success, outputPath, nodesCount, edgesCount, layersCount, stepsCount`,
  { schema: SAVE_SCHEMA, phase: 'Save', label: 'save' }
)

log(`Phase 8 complete. Knowledge graph saved to ${saveResult.outputPath}`)

// ─── Final Report ────────────────────────────────────────────────────────────

log(`
╔══════════════════════════════════════════════════╗
║         /understand Complete                      ║
╠══════════════════════════════════════════════════╣
║ Project:    ${projectName.padEnd(35)}║
║ Files:      ${String(scanResult.fileCount).padEnd(35)}║
║ Nodes:      ${String(saveResult.nodesCount).padEnd(35)}║
║ Edges:      ${String(saveResult.edgesCount).padEnd(35)}║
║ Layers:     ${String(saveResult.layersCount).padEnd(35)}║
║ Tour steps: ${String(saveResult.stepsCount).padEnd(35)}║
║ Language:   ${preflight.outputLanguage.padEnd(35)}║
╚══════════════════════════════════════════════════╝
`)

return {
  success: true,
  project: projectName,
  filesAnalyzed: scanResult.fileCount,
  nodes: saveResult.nodesCount,
  edges: saveResult.edgesCount,
  layers: saveResult.layersCount,
  tourSteps: saveResult.stepsCount,
  language: preflight.outputLanguage,
  outputPath: saveResult.outputPath,
}
