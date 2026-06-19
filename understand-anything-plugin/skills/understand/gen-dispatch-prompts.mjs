#!/usr/bin/env node
/**
 * gen-dispatch-prompts.mjs — Deterministic dispatch prompt generator.
 *
 * Reads dispatch-plan.json + scan-result.json, writes lightweight config files
 * (paths + metadata only) AND per-group batch slice files for file-analyzer agents.
 *
 * Usage: node gen-dispatch-prompts.mjs <projectRoot> <skillDir> [languageDirective]
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const projectRoot = process.argv[2];
const skillDir = process.argv[3];
const languageDirective = process.argv[4] || '';

if (!projectRoot || !skillDir) {
  console.error('Usage: node gen-dispatch-prompts.mjs <projectRoot> <skillDir> [languageDirective]');
  process.exit(1);
}

const tmpDir = join(projectRoot, '.understand-anything', 'tmp');
const intermediateDir = join(projectRoot, '.understand-anything', 'intermediate');
const batchesPath = join(intermediateDir, 'batches.json');
const dispatchPlanPath = join(tmpDir, 'dispatch-plan.json');
const scanResultPath = join(intermediateDir, 'scan-result.json');
const outputDir = join(tmpDir, 'dispatch-prompts');

// Validate required input files exist
for (const [label, filePath] of [
  ['batches.json', batchesPath],
  ['dispatch-plan.json', dispatchPlanPath],
  ['scan-result.json', scanResultPath],
]) {
  if (!existsSync(filePath)) {
    console.error(`ERROR: ${label} not found at ${filePath}`);
    console.error('Run the batching and dispatch-planner steps first.');
    process.exit(1);
  }
}

mkdirSync(outputDir, { recursive: true });

const dispatchPlan = JSON.parse(readFileSync(dispatchPlanPath, 'utf-8'));
const scanResult = JSON.parse(readFileSync(scanResultPath, 'utf-8'));
const allBatches = JSON.parse(readFileSync(batchesPath, 'utf-8')).batches;

// Build batchIndex → batch lookup
const batchByIndex = new Map();
for (const batch of allBatches) {
  batchByIndex.set(batch.batchIndex, batch);
}

const fusionGroups = dispatchPlan.fusionGroups || [];
const totalBatches = allBatches.length;

const projectName = scanResult.projectName || 'unknown';
const projectDescription = scanResult.projectDescription || '';
const languages = scanResult.languages || [];

for (const group of fusionGroups) {
  // Config file: paths + metadata only (no embedded batch data)
  const config = {
    projectRoot,
    projectName,
    projectDescription,
    languages,
    skillDir,
    languageDirective: languageDirective || '',
    batchesPath,
    batchSlicePath: join(outputDir, `batches-group-${group.groupIndex}.json`),
    batchIndices: group.batchIndices,
    totalBatches,
    groupIndex: group.groupIndex,
  };

  const configPath = join(outputDir, `group-${group.groupIndex}.json`);
  writeFileSync(configPath, JSON.stringify(config, null, 2));

  // Per-group batch slice: only the batches this group needs
  const groupBatches = group.batchIndices
    .map(idx => batchByIndex.get(idx))
    .filter(Boolean);

  const slicePath = join(outputDir, `batches-group-${group.groupIndex}.json`);
  writeFileSync(slicePath, JSON.stringify({ batches: groupBatches }, null, 2));
}

console.log(`Generated ${fusionGroups.length} dispatch prompt files and batch slices`);
