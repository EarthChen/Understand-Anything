#!/usr/bin/env node
/**
 * split-batch-results.mjs
 *
 * Split global extraction and rule engine results into per-batch subset files.
 * Used by both the workflow pipeline (Phase 2) and the SKILL.md manual path.
 *
 * Usage:
 *   node split-batch-results.mjs <PROJECT_ROOT>
 *
 * Input:
 *   - .understand-anything/intermediate/batches.json
 *   - .understand-anything/intermediate/extraction/structural-analysis.json
 *   - .understand-anything/tmp/rule-engine-results.json
 *
 * Output:
 *   - .understand-anything/tmp/ua-file-extract-results-<batchIndex>.json
 *   - .understand-anything/tmp/ua-rule-engine-results-<batchIndex>.json
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const projectRoot = process.argv[2];
if (!projectRoot) {
  console.error('用法: node split-batch-results.mjs <PROJECT_ROOT>');
  process.exit(1);
}

const tmpDir = join(projectRoot, '.understand-anything', 'tmp');
const batchesPath = join(projectRoot, '.understand-anything', 'intermediate', 'batches.json');

function extractPathFromNodeId(nodeId) {
  if (!nodeId.includes(':')) return nodeId;
  const rest = nodeId.split(':').slice(1).join(':');
  const lastColon = rest.lastIndexOf(':');
  return lastColon > 0 ? rest.substring(0, lastColon) : rest;
}

// Load global extraction results
const extractionDir = join(projectRoot, '.understand-anything', 'intermediate', 'extraction');
const extractionByPath = JSON.parse(readFileSync(join(extractionDir, 'structural-analysis.json'), 'utf-8'));

// Load global rule engine results
const ruleData = JSON.parse(readFileSync(join(tmpDir, 'rule-engine-results.json'), 'utf-8'));
const allEdges = ruleData.edges || [];
const allUnresolved = ruleData.unresolved || [];

// Load batches
const batches = JSON.parse(readFileSync(batchesPath, 'utf-8')).batches;

for (const batch of batches) {
  const batchIndex = batch.batchIndex;
  const batchFiles = batch.files || [];
  const batchPaths = batchFiles.map(f => f.path).sort();
  const batchPathSet = new Set(batchPaths);

  // Extraction results: only files in this batch
  const batchResults = batchPaths.filter(p => extractionByPath[p]).map(p => ({ path: p, ...extractionByPath[p] }));
  const extractOut = {
    scriptCompleted: true,
    filesAnalyzed: batchResults.length,
    filesSkipped: batchPaths.filter(p => !extractionByPath[p]),
    results: batchResults,
  };
  writeFileSync(join(tmpDir, 'ua-file-extract-results-' + batchIndex + '.json'), JSON.stringify(extractOut));

  // Rule engine edges: assign to BOTH source and target batches (cross-batch edges)
  const batchEdges = allEdges.filter(e => {
    const srcPath = extractPathFromNodeId(e.source || '');
    const tgtPath = extractPathFromNodeId(e.target || '');
    return batchPathSet.has(srcPath) || batchPathSet.has(tgtPath);
  });
  const batchUnresolved = allUnresolved.filter(u => batchPathSet.has(u.file || ''));
  const ruleOut = {
    edges: batchEdges,
    unresolved: batchUnresolved,
    stats: { totalEdges: batchEdges.length, unresolvedCalls: batchUnresolved.length }
  };
  writeFileSync(join(tmpDir, 'ua-rule-engine-results-' + batchIndex + '.json'), JSON.stringify(ruleOut));
}

console.log('  Split into ' + batches.length + ' batch subsets (extraction + rule engine)');
