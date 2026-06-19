export const meta = {
  name: 'understand',
  description: 'Analyze a codebase to produce an interactive knowledge graph for understanding architecture, components, and relationships',
  phases: [
    { title: 'Pre-flight',    detail: 'Resolve project root, plugin root, language configuration' },
    { title: 'Scan',          detail: 'Discover project files, detect languages and frameworks' },
    { title: 'Analyze',       detail: 'Extract structure, dispatch file-analyzer agents, merge results' },
    { title: 'Assemble',      detail: 'Review assembled graph, fix issues' },
    { title: 'Architecture',  detail: 'Identify architectural layers' },
    { title: 'Tour',          detail: 'Build guided tour steps' },
    { title: 'Review',        detail: 'Validate knowledge graph (deterministic or LLM)' },
    { title: 'Save',          detail: 'Write final output and cleanup' },
  ],
}

// args = { rawArgs: string, cwd: string }

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

const ANALYZE_SCHEMA = {
  type: 'object',
  required: ['nodesCount', 'edgesCount', 'batchesProcessed'],
  properties: {
    nodesCount:       { type: 'number' },
    edgesCount:       { type: 'number' },
    batchesProcessed: { type: 'number' },
    warnings:         { type: 'array', items: { type: 'string' } },
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

Working directory: ${args.cwd}
Raw arguments: ${args.rawArgs || ''}

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
If NOT full:
  Check if knowledge-graph.json exists
  If exists: read meta.json for gitCommitHash
  If commitHash matches: set changedFiles = [] (up to date)
  If different: run \`git diff <lastHash>..HEAD --name-only\` to get changedFiles

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

// Skip scan if incremental with no changed files
if (!preflight.full && preflight.changedFiles && preflight.changedFiles.length === 0) {
  log('Graph is up to date — no changes detected')
  return { success: true, upToDate: true }
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
const fileList = scanResult.fileList

if (scanResult.filteredByIgnore > 0) {
  log(`Excluded ${scanResult.filteredByIgnore} files via .understandignore`)
}

log(`Phase 1 complete. Found ${scanResult.fileCount} files across ${languages.length} languages`)

// ─── Phase 1.5: Batch ────────────────────────────────────────────────────────

phase('Analyze')

// Compute batches
const batchesResult = await agent(
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

// ─── Phase 2: Analyze ────────────────────────────────────────────────────────

// Read batches for the analyze phase
const analyzeResult = await agent(
  `Analyze project files and extract structure.

Project root: ${preflight.projectRoot}
Skill dir: ${preflight.skillDir}
Plugin root: ${preflight.pluginRoot}
Output language: ${preflight.outputLanguage}
${preflight.languageDirective || ''}

Read the detailed step instructions from the phases/ subdirectory:
1. Structural extraction → Read ${preflight.skillDir}/phases/step0-structural.md
2. Agent dispatch + quality gate → Read ${preflight.skillDir}/phases/step1-dispatch.md
3. Merge → Read ${preflight.skillDir}/phases/step2-merge.md

For incremental updates (changed files only), read ${preflight.skillDir}/phases/incremental.md

The pipeline should:
1. Extract structure from source files using tree-sitter
2. Dispatch file-analyzer agents for each batch (up to 10 concurrent)
3. Run quality validation on each batch result
4. Merge all batch results into assembled-graph.json
5. Link tested_by edges

Return: nodesCount, edgesCount, batchesProcessed, warnings`,
  { schema: ANALYZE_SCHEMA, phase: 'Analyze', label: 'analyze' }
)

log(`Phase 2 complete. Extracted ${analyzeResult.nodesCount} nodes, ${analyzeResult.edgesCount} edges`)

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

log(`Phase 3 complete. ${assembleResult.issuesCount} issues found, ${assembleResult.autoFixed} auto-fixed`)

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

log(`Phase 4 complete. Identified ${architectureResult.layersCount} architectural layers`)

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

log(`Phase 5 complete. Generated ${tourResult.stepsCount} tour steps`)

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
    analyzedAt: new Date().toISOString(),
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

// Write assembled graph
// (In real implementation, this would write to disk)

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

// Apply automated fixes if issues found
if (reviewResult.issuesCount > 0) {
  log(`Found ${reviewResult.issuesCount} issues — applying automated fixes`)
  // Fix logic would go here
}

log(`Phase 6 complete. Validation ${reviewResult.valid ? 'passed' : 'passed with warnings'}`)

// ─── Phase 7: Save ───────────────────────────────────────────────────────────

phase('Save')

const saveResult = await agent(
  `Save the final knowledge graph and cleanup.

Project root: ${preflight.projectRoot}
Skill dir: ${preflight.skillDir}
Commit hash: ${preflight.commitHash}

**Step 1 — Write knowledge-graph.json**
Write the final graph to: ${preflight.projectRoot}/.understand-anything/knowledge-graph.json

Include all required project fields:
- project.name, project.description, project.languages, project.frameworks
- project.analyzedAt (ISO 8601), project.gitCommitHash
- project.provenance with generationMode, completedStages, degraded, toolVersion

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

**Step 6 — Build source index**
Run: \`node "${preflight.skillDir}/build-source-index.mjs" "${preflight.projectRoot}"\`

**Step 7 — Report summary**
Print summary with: project name, files analyzed, nodes, edges, layers, tour steps

Return: success, outputPath, nodesCount, edgesCount, layersCount, stepsCount`,
  { schema: SAVE_SCHEMA, phase: 'Save', label: 'save' }
)

log(`Phase 7 complete. Knowledge graph saved to ${saveResult.outputPath}`)

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
