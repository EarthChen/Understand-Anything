#!/usr/bin/env node
/**
 * Diagnose batching quality for compute-batches.mjs output.
 * Usage: node diagnose-batches.mjs <project-root>
 *
 * Reads batches.json + scan-result.json, reports:
 * 1. Batch size distribution
 * 2. Intra-batch vs cross-batch edge ratio (higher = better batching)
 * 3. Per-batch file listing (what's grouped together)
 * 4. Actionable suggestions
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const projectRoot = process.argv[2];
if (!projectRoot) {
  process.stderr.write('Usage: node diagnose-batches.mjs <project-root>\n');
  process.exit(1);
}

const uaDir = join(projectRoot, '.understand-anything');
const batchesPath = join(uaDir, 'intermediate', 'batches.json');
const scanPath = join(uaDir, 'intermediate', 'scan-result.json');

const batches = JSON.parse(readFileSync(batchesPath, 'utf-8'));
const scan = JSON.parse(readFileSync(scanPath, 'utf-8'));
const importMap = scan.importMap || {};

// ── 1. Size distribution ──
const sizes = batches.batches.map(b => b.files.length);
console.log(`\n=== Batch Size Distribution (${batches.totalBatches} batches, ${batches.totalFiles} files) ===`);
console.log(`  min=${Math.min(...sizes)}  max=${Math.max(...sizes)}  avg=${(sizes.reduce((a, b) => a + b, 0) / sizes.length).toFixed(1)}`);

const buckets = {};
for (const s of sizes) {
  const key = s <= 5 ? '1-5' : s <= 10 ? '6-10' : s <= 20 ? '11-20' : s <= 35 ? '21-35' : '36+';
  buckets[key] = (buckets[key] || 0) + 1;
}
for (const [k, v] of Object.entries(buckets).sort()) {
  console.log(`  ${k} files: ${v} batches`);
}

// ── 2. Cross-batch edge analysis ──
const fileToBatch = new Map();
for (const b of batches.batches) {
  for (const f of b.files) fileToBatch.set(f.path, b.batchIndex);
}

let intraEdges = 0, crossEdges = 0, danglingEdges = 0;

for (const [src, targets] of Object.entries(importMap)) {
  const srcBatch = fileToBatch.get(src);
  if (srcBatch === undefined) { danglingEdges++; continue; }
  for (const tgt of targets) {
    const tgtBatch = fileToBatch.get(tgt);
    if (tgtBatch === undefined) { danglingEdges++; continue; }
    if (srcBatch === tgtBatch) {
      intraEdges++;
    } else {
      crossEdges++;
    }
  }
}

const totalEdges = intraEdges + crossEdges;
const intraRatio = totalEdges > 0 ? (intraEdges / totalEdges * 100).toFixed(1) : 0;
console.log(`\n=== Edge Analysis ===`);
console.log(`  Intra-batch edges: ${intraEdges} (${intraRatio}%)`);
console.log(`  Cross-batch edges: ${crossEdges} (${(100 - intraRatio).toFixed(1)}%)`);
console.log(`  Dangling (no batch): ${danglingEdges}`);
console.log(`  → Higher intra-batch % = better semantic grouping (target: >60%)`);

// ── 3. Per-batch content ──
console.log(`\n=== Per-Batch Contents ===`);
for (const b of batches.batches) {
  const paths = b.files.map(f => f.path).sort();
  const dirs = [...new Set(paths.map(p => {
    const parts = p.split('/');
    return parts.length > 2 ? parts.slice(0, -1).join('/') : parts[0];
  }))];

  let batchIntra = 0;
  for (const f of paths) {
    const targets = importMap[f] || [];
    for (const t of targets) {
      if (fileToBatch.get(t) === b.batchIndex) batchIntra++;
    }
  }

  console.log(`\n  Batch ${b.batchIndex} (${b.files.length} files, ${batchIntra} intra-edges):`);
  console.log(`    Dirs: ${dirs.slice(0, 3).join(', ')}${dirs.length > 3 ? ` ... +${dirs.length - 3} more` : ''}`);
  for (const p of paths.slice(0, 5)) {
    console.log(`    ${p}`);
  }
  if (paths.length > 5) console.log(`    ... +${paths.length - 5} more`);
}

// ── 4. Suggestion ──
console.log(`\n=== Suggestion ===`);
if (batches.totalBatches > 25 && parseFloat(intraRatio) > 50) {
  console.log(`  Batches can likely be reduced. Current ${batches.totalBatches} batches with ${intraRatio}% intra-batch edges.`);
  console.log(`  Try: MAX_COMMUNITY_SIZE=50, MIN_BATCH_SIZE=8, MAX_MERGE_TARGET=40`);
  console.log(`  Expected: ~${Math.round(batches.totalBatches * 0.6)} batches`);
} else if (parseFloat(intraRatio) < 40) {
  console.log(`  Cross-batch edges are high (${(100 - parseFloat(intraRatio))}%). Current batching captures module boundaries well.`);
  console.log(`  Reducing batches may hurt quality — files from different modules would be merged.`);
} else {
  console.log(`  Batching quality is decent (${intraRatio}% intra). Moderate reduction possible.`);
}
