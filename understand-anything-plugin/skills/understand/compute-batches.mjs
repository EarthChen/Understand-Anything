#!/usr/bin/env node
/**
 * compute-batches.mjs — Phase 1.5 of /understand
 *
 * Reads scan-result.json, runs Louvain community detection on the import
 * graph, and writes batches.json containing batches + neighborMap.
 *
 * Usage:
 *   node compute-batches.mjs <project-root> [--changed-files=<path>]
 *
 * Input:  <project-root>/.understand-anything/intermediate/scan-result.json
 * Output: <project-root>/.understand-anything/intermediate/batches.json
 */

import { readFileSync, writeFileSync, existsSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const __filename = fileURLToPath(import.meta.url);
const PLUGIN_ROOT = resolve(dirname(__filename), '../..');
const require = createRequire(resolve(PLUGIN_ROOT, 'package.json'));

let core;
try {
  core = await import(pathToFileURL(require.resolve('@understand-anything/core')).href);
} catch {
  core = await import(pathToFileURL(resolve(PLUGIN_ROOT, 'packages/core/dist/index.js')).href);
}
const { TreeSitterPlugin, PluginRegistry, builtinLanguageConfigs, registerAllParsers } = core;

import Graph from 'graphology';
import louvain from 'graphology-communities-louvain';

/**
 * For each code file, returns its top-level exported symbol names (functions,
 * classes, exported consts). Per-file errors are swallowed into [] with a
 * visible warning so a single bad file does not abort batching.
 *
 * Returns Map<path, string[]>.
 */
async function extractExports(projectRoot, codeFiles) {
  let registry;
  try {
    const tsConfigs = builtinLanguageConfigs.filter(c => c.treeSitter);
    const tsPlugin = new TreeSitterPlugin(tsConfigs);
    await tsPlugin.init();
    registry = new PluginRegistry();
    registry.register(tsPlugin);
    registerAllParsers(registry);
  } catch (err) {
    process.stderr.write(
      `Warning: compute-batches: tree-sitter init failed (${err.message}) ` +
      `— all symbols=[] in neighborMap — cross-batch edges limited to file-level\n`,
    );
    return new Map(codeFiles.map(f => [f.path, []]));
  }

  const exportsByPath = new Map();
  for (const file of codeFiles) {
    const abs = join(projectRoot, file.path);
    let content;
    try {
      content = readFileSync(abs, 'utf-8');
    } catch (err) {
      process.stderr.write(
        `Warning: compute-batches: exports extraction failed for ${file.path} ` +
        `(read error: ${err.message}) — symbols=[] in neighborMap — ` +
        `cross-batch edges to this file limited to file-level\n`,
      );
      exportsByPath.set(file.path, []);
      continue;
    }
    try {
      const analysis = registry.analyzeFile(file.path, content);
      const names = (analysis?.exports || []).map(e => e.name).filter(Boolean);
      exportsByPath.set(file.path, names);
    } catch (err) {
      process.stderr.write(
        `Warning: compute-batches: exports extraction failed for ${file.path} ` +
        `(analyze error: ${err.message}) — symbols=[] in neighborMap — ` +
        `cross-batch edges to this file limited to file-level\n`,
      );
      exportsByPath.set(file.path, []);
    }
  }
  return exportsByPath;
}

/**
 * Build batches for non-code files per Groups A-E in the design spec.
 * Returns Array<{ files: FileMeta[], mergeable: boolean }> — caller assigns
 * batchIndex. `mergeable=false` for semantic Groups A-D (Dockerfile clusters,
 * .github/workflows, .gitlab-ci/.circleci, SQL migrations) preserves their
 * boundary intent across the merge-small pass; Group E (catch-all parent-dir
 * grouping) is `mergeable=true` so its tiny singletons can be pooled.
 */
function buildNonCodeBatches(nonCodeFiles) {
  const byPath = new Map(nonCodeFiles.map(f => [f.path, f]));
  const consumed = new Set();
  const groups = [];

  const dirOf = p => p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '';
  const baseOf = p => p.includes('/') ? p.slice(p.lastIndexOf('/') + 1) : p;

  // Group A: per-directory Dockerfile clusters.
  const dirsWithDockerfile = new Set(
    [...byPath.keys()]
      .filter(p => baseOf(p) === 'Dockerfile')
      .map(dirOf),
  );
  for (const dir of [...dirsWithDockerfile].sort()) {
    const inDir = [...byPath.keys()].filter(p => dirOf(p) === dir);
    const cluster = inDir.filter(p => {
      const b = baseOf(p);
      return b === 'Dockerfile'
        || b === '.dockerignore'
        || b.startsWith('docker-compose.');
    });
    if (cluster.length) {
      groups.push({ files: cluster.map(p => byPath.get(p)), mergeable: false });
      cluster.forEach(p => consumed.add(p));
    }
  }

  // Group B: .github/workflows/*
  const ghWorkflows = [...byPath.keys()].filter(
    p => p.startsWith('.github/workflows/') && (p.endsWith('.yml') || p.endsWith('.yaml')),
  ).filter(p => !consumed.has(p));
  if (ghWorkflows.length) {
    groups.push({ files: ghWorkflows.map(p => byPath.get(p)), mergeable: false });
    ghWorkflows.forEach(p => consumed.add(p));
  }

  // Group C: .gitlab-ci.yml + .circleci/*
  const ciFiles = [...byPath.keys()].filter(
    p => (p === '.gitlab-ci.yml' || p.startsWith('.circleci/'))
      && !consumed.has(p),
  );
  if (ciFiles.length) {
    groups.push({ files: ciFiles.map(p => byPath.get(p)), mergeable: false });
    ciFiles.forEach(p => consumed.add(p));
  }

  // Group D: SQL migrations per migrations/ or migration/ directory.
  // Defensive consumed.has check: no upstream group consumes SQL today, but
  // future Group additions could; keep the check for forward-compat.
  const migrationDirs = new Set(
    [...byPath.keys()]
      .filter(p => p.endsWith('.sql'))
      .map(dirOf)
      .filter(d => /(^|\/)migrations?$/.test(d)),
  );
  for (const dir of migrationDirs) {
    const sqls = [...byPath.keys()]
      .filter(p => dirOf(p) === dir && p.endsWith('.sql') && !consumed.has(p))
      .sort();
    if (sqls.length) {
      groups.push({ files: sqls.map(p => byPath.get(p)), mergeable: false });
      sqls.forEach(p => consumed.add(p));
    }
  }

  // Group E: all remaining grouped by immediate parent dir, max 20 per batch
  const remainingByDir = new Map();
  for (const p of [...byPath.keys()].sort()) {
    if (consumed.has(p)) continue;
    const dir = dirOf(p);
    if (!remainingByDir.has(dir)) remainingByDir.set(dir, []);
    remainingByDir.get(dir).push(p);
  }
  // Per design spec: max files per parent-dir batch for Group E.
  const MAX_E = 20;
  for (const [, paths] of remainingByDir) {
    for (let i = 0; i < paths.length; i += MAX_E) {
      const slice = paths.slice(i, i + MAX_E);
      groups.push({ files: slice.map(p => byPath.get(p)), mergeable: true });
    }
  }

  return groups;
}

/**
 * Build a lookup map from file path → batchIndex across all batches (code +
 * non-code). Used to resolve cross-batch neighbor references in neighborMap.
 */
function buildBatchOfMap(allBatches) {
  const m = new Map();
  for (const b of allBatches) {
    for (const f of b.files) m.set(f.path, b.batchIndex);
  }
  return m;
}

/**
 * Returns Map<path, communityId> via Louvain. May throw — caller must catch
 * and fall back if it does. Honors UA_COMPUTE_BATCHES_FORCE_LOUVAIN_THROW=1
 * to allow tests to exercise the fallback path.
 */
function runLouvain(codeFiles, importMap, resolution = 1.0) {
  if (process.env.UA_COMPUTE_BATCHES_FORCE_LOUVAIN_THROW === '1') {
    throw new Error('forced throw via UA_COMPUTE_BATCHES_FORCE_LOUVAIN_THROW');
  }
  const g = new Graph({ type: 'undirected', allowSelfLoops: false });
  for (const f of codeFiles) g.addNode(f.path);
  for (const [src, targets] of Object.entries(importMap)) {
    if (!g.hasNode(src)) continue;
    for (const tgt of targets) {
      if (!g.hasNode(tgt) || src === tgt || g.hasEdge(src, tgt)) continue;
      g.addEdge(src, tgt);
    }
  }
  const cs = louvain(g, { randomWalk: false, resolution });  // { nodeId: communityId }
  return new Map(Object.entries(cs));
}

/**
 * Returns Map<path, communityId> via alphabetical chunking of `batchSize`
 * files per batch. Deterministic, used as fallback when Louvain fails.
 */
function countBasedAssignment(codeFiles, batchSize = 12) {
  const out = new Map();
  const sorted = [...codeFiles].map(f => f.path).sort();
  for (let i = 0; i < sorted.length; i++) {
    out.set(sorted[i], `count_${Math.floor(i / batchSize)}`);
  }
  return out;
}

/**
 * Pool small mergeable batches into "misc" batches to reduce dispatch overhead.
 * Preserves semantic groupings (non-code Groups A-D, marked `mergeable=false`)
 * regardless of size; only merges code Louvain singletons / orphans and
 * Group E parent-dir batches that fall below MIN_BATCH_SIZE.
 *
 * On a 314-file microservices-demo run, vanilla Louvain produced 87 singleton
 * communities → 87 dispatch tasks of size 1. This pass collapses them into
 * ceil(N / MAX_MERGE_TARGET) misc batches, drastically cutting orchestration
 * overhead while leaving the high-modularity communities untouched.
 *
 * Returns the rewritten batch list with reassigned batchIndex (1-based,
 * keepers first preserving their relative order, misc batches appended).
 */
function mergeSmallBatches(bareBatches, opts = {}) {
  const MIN_BATCH_SIZE = opts.minBatchSize ?? 8;
  const MAX_MERGE_TARGET = opts.maxMergeTarget ?? 40;

  const keepers = [];
  const smallMergeable = [];
  for (const b of bareBatches) {
    if (b.mergeable && b.files.length < MIN_BATCH_SIZE) {
      smallMergeable.push(b);
    } else {
      keepers.push(b);
    }
  }

  if (smallMergeable.length === 0) {
    // Nothing to merge — strip mergeable flag and renumber for cleanliness.
    return keepers.map((b, i) => ({
      batchIndex: i + 1,
      files: b.files,
    }));
  }

  // Pool and sort deterministically by path so repeated runs match byte-for-byte.
  const pooledFiles = smallMergeable
    .flatMap(b => b.files)
    .sort((a, b) => a.path.localeCompare(b.path));

  const miscBatches = [];
  for (let i = 0; i < pooledFiles.length; i += MAX_MERGE_TARGET) {
    miscBatches.push({ files: pooledFiles.slice(i, i + MAX_MERGE_TARGET) });
  }

  // Use `Info:` rather than `Warning:` — singleton consolidation is a
  // routine optimization, not a fallback/degrade path. Per
  // [[feedback_visible_warnings]] only fallbacks should bubble as Warning:
  // to the Phase 7 final report. Real warnings would get drowned out if
  // every normal Louvain run with singletons (i.e. almost every run) added
  // a Warning: line.
  process.stderr.write(
    `Info: compute-batches: merged ${smallMergeable.length} small batches ` +
    `(${pooledFiles.length} files) into ${miscBatches.length} misc batches ` +
    `— singletons and orphans consolidated\n`,
  );

  const final = [...keepers, ...miscBatches];
  return final.map((b, i) => ({
    batchIndex: i + 1,
    files: b.files,
  }));
}

/**
 * Absorb structurally weak batches into their strongest adjacent batch.
 * A batch is "weak" when it is mergeable, has <= 5 files, and its intra-edge
 * ratio (edges where both endpoints are inside the batch / all edges touching
 * the batch) is below 0.2 — meaning the files barely reference each other.
 *
 * For each weak batch, find adjacent batches (those sharing import edges with
 * the weak batch's files) and merge into the one with the most connecting
 * edges, provided the combined size stays within maxCommunitySize.
 *
 * Returns the rewritten batch list with reassigned sequential batchIndex.
 */
function absorbWeakBatches(batches, importMap, opts = {}) {
  const maxCommunitySize = opts.maxCommunitySize ?? 50;

  // Build path → batchIndex lookup (O(1) per file instead of O(batches)).
  const pathToBatch = new Map();
  for (const b of batches) {
    for (const f of b.files) pathToBatch.set(f.path, b.batchIndex);
  }

  // Single pass: compute intra/cross counts AND per-batch neighbor edge map.
  const intraByBatch = new Map(batches.map(b => [b.batchIndex, 0]));
  const crossByBatch = new Map(batches.map(b => [b.batchIndex, 0]));
  // neighborEdges: batchIndex → Map<neighborBatchIndex, edgeCount>
  const neighborEdges = new Map(batches.map(b => [b.batchIndex, new Map()]));

  for (const [src, targets] of Object.entries(importMap)) {
    const srcBatch = pathToBatch.get(src);
    if (srcBatch === undefined) continue;
    for (const tgt of targets) {
      const tgtBatch = pathToBatch.get(tgt);
      if (tgtBatch === undefined) continue;
      if (srcBatch === tgtBatch) {
        intraByBatch.set(srcBatch, intraByBatch.get(srcBatch) + 1);
      } else {
        crossByBatch.set(srcBatch, crossByBatch.get(srcBatch) + 1);
        crossByBatch.set(tgtBatch, crossByBatch.get(tgtBatch) + 1);
        const srcNeighbors = neighborEdges.get(srcBatch);
        srcNeighbors.set(tgtBatch, (srcNeighbors.get(tgtBatch) || 0) + 1);
        const tgtNeighbors = neighborEdges.get(tgtBatch);
        tgtNeighbors.set(srcBatch, (tgtNeighbors.get(srcBatch) || 0) + 1);
      }
    }
  }

  // Index batches by batchIndex for O(1) lookup.
  const batchByIndex = new Map(batches.map(b => [b.batchIndex, b]));

  // Identify weak batches and absorb them.
  const absorbed = new Set();
  let sizeRejected = 0;
  for (const b of batches) {
    if (b.mergeable === false) continue;
    if (b.files.length > 5) continue;

    const intra = intraByBatch.get(b.batchIndex) || 0;
    const cross = crossByBatch.get(b.batchIndex) || 0;
    const total = intra + cross;
    const ratio = total > 0 ? intra / total : 0;
    if (ratio >= 0.2) continue;

    // Use pre-computed neighbor edges instead of re-scanning importMap.
    const edgeCounts = neighborEdges.get(b.batchIndex);
    if (!edgeCounts || edgeCounts.size === 0) continue; // isolated

    // Pick strongest neighbor.
    const [targetBatchIdx] = [...edgeCounts.entries()]
      .sort((a, bb) => bb[1] - a[1])[0];

    const targetBatch = batchByIndex.get(targetBatchIdx);
    if (!targetBatch) continue;
    if (targetBatch.files.length + b.files.length > maxCommunitySize) {
      sizeRejected++;
      continue;
    }

    // Merge: add weak batch's files into target.
    targetBatch.files.push(...b.files);
    absorbed.add(b.batchIndex);
  }

  if (sizeRejected > 0) {
    process.stderr.write(
      `Info: compute-batches: ${sizeRejected} weak batch(es) skipped — combined size would exceed maxCommunitySize=${maxCommunitySize}\n`,
    );
  }

  if (absorbed.size === 0) return batches;

  // Renumber surviving batches sequentially, preserving all fields.
  const survivors = batches.filter(b => !absorbed.has(b.batchIndex));
  return survivors.map((b, i) => ({
    ...b,
    batchIndex: i + 1,
  }));
}


/**
 * Split batches that span more than `maxDirs` distinct second-level directories.
 * Each resulting sub-batch must have >= `minBatchSize` files or the batch is left intact.
 * Returns rewritten batch list with sequential batchIndex.
 */
function splitMixedDirBatches(batches, maxDirs, minBatchSize) {
  const secondLevelDir = p => {
    const parts = p.split('/');
    return parts.length > 1 ? parts[1] : parts[0];
  };

  const result = [];
  let splitCount = 0;
  for (const b of batches) {
    const dirGroups = new Map();
    for (const f of b.files) {
      const d = secondLevelDir(f.path);
      if (!dirGroups.has(d)) dirGroups.set(d, []);
      dirGroups.get(d).push(f);
    }
    if (dirGroups.size > maxDirs && dirGroups.size > 1) {
      const canSplit = [...dirGroups.values()].every(g => g.length >= minBatchSize);
      if (canSplit) {
        splitCount++;
        for (const [, files] of dirGroups) {
          result.push({ files });
        }
        continue;
      }
    }
    result.push({ files: b.files });
  }

  if (splitCount > 0) {
    process.stderr.write(
      `Info: compute-batches: split ${splitCount} batches exceeding --max-dirs-per-batch=${maxDirs}\n`,
    );
  }

  return result.map((b, i) => ({ batchIndex: i + 1, files: b.files }));
}

// ── Main: load → Louvain (or count-fallback) → enrich → write batches.json ─
async function main() {
  const projectRoot = process.argv[2];
  if (!projectRoot) {
    process.stderr.write(
      'Usage: node compute-batches.mjs <project-root> [--changed-files=<path>] ' +
      '[--max-community-size=N] [--min-batch-size=N] [--max-merge-target=N] [--dry-run]\n',
    );
    process.exit(1);
  }

  // ── Configurable batch parameters (CLI flags with sensible defaults) ──
  const config = {
    maxCommunitySize: 50,
    minBatchSize: 8,
    maxMergeTarget: 40,
    excludeHubs: null,
    maxDirsPerBatch: null,
    resolution: null,
  };
  let dryRun = false;
  let changedFiles = null;
  for (const arg of process.argv.slice(3)) {
    const m = arg.match(/^--changed-files=(.+)$/);
    if (m) {
      const p = m[1];
      let content;
      try {
        content = readFileSync(p, 'utf-8');
      } catch (err) {
        process.stderr.write(
          `Error: compute-batches: --changed-files path not readable: ${p} (${err.message})\n`,
        );
        process.exit(1);
      }
      const lines = content
        .split('\n')
        .map(s => s.trim())
        .filter(Boolean);
      changedFiles = new Set(lines);
    }
    const numMatch = arg.match(/^--(max-community-size|min-batch-size|max-merge-target|exclude-hubs|max-dirs-per-batch|resolution)=(\d+(?:\.\d+)?)$/);
    if (numMatch) {
      config[numMatch[1].replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = Number(numMatch[2]);
    }
    if (arg === '--dry-run') dryRun = true;
  }

  const scanPath = join(projectRoot, '.understand-anything', 'intermediate', 'scan-result.json');
  if (!existsSync(scanPath)) {
    process.stderr.write(`Error: scan-result.json not found at ${scanPath}\n`);
    process.exit(1);
  }

  const scan = JSON.parse(readFileSync(scanPath, 'utf-8'));
  const files = scan.files || [];
  const codeFiles = files.filter(f => f.fileCategory === 'code');
  const nonCodeFiles = files.filter(f => f.fileCategory !== 'code');

  // Prefer importMap embedded in scan-result.json; fall back to separate
  // import-map.json produced by extract-import-map.mjs (the deterministic
  // extractor writes its output to a standalone file).
  let importMap = scan.importMap || {};
  if (Object.keys(importMap).length === 0) {
    const importMapPath = join(projectRoot, '.understand-anything', 'intermediate', 'import-map.json');
    if (existsSync(importMapPath)) {
      try {
        const imData = JSON.parse(readFileSync(importMapPath, 'utf-8'));
        importMap = imData.importMap || {};
        process.stderr.write(
          `Info: compute-batches: loaded importMap from import-map.json ` +
          `(${Object.keys(importMap).length} entries)\n`,
        );
      } catch (err) {
        process.stderr.write(
          `Warning: compute-batches: failed to read import-map.json ` +
          `(${err.message}) — proceeding without import edges\n`,
        );
      }
    }
  }

  process.stderr.write(
    `Config: maxCommunitySize=${config.maxCommunitySize}, ` +
    `minBatchSize=${config.minBatchSize}, maxMergeTarget=${config.maxMergeTarget}\n`,
  );
  process.stderr.write(`Loaded ${files.length} files (${codeFiles.length} code).\n`);

  const effectiveResolution = config.resolution !== null ? config.resolution : 1.0;
  const exportsByPath = await extractExports(projectRoot, codeFiles);

  let algorithm = 'louvain';
  let perFileCommunity;
  let hubFiles = [];
  let hubDegrees = [];

  if (config.excludeHubs !== null) {
    const degree = new Map();
    for (const f of codeFiles) degree.set(f.path, 0);
    for (const [src, targets] of Object.entries(importMap)) {
      if (degree.has(src)) degree.set(src, degree.get(src) + targets.length);
      for (const tgt of targets) {
        if (degree.has(tgt)) degree.set(tgt, degree.get(tgt) + 1);
      }
    }
    const normalFiles = [];
    for (const f of codeFiles) {
      if (degree.get(f.path) >= config.excludeHubs) {
        hubFiles.push(f);
        hubDegrees.push(degree.get(f.path));
      } else {
        normalFiles.push(f);
      }
    }
    const normalSet = new Set(normalFiles.map(f => f.path));
    const filteredImportMap = {};
    for (const [src, targets] of Object.entries(importMap)) {
      if (!normalSet.has(src)) continue;
      const ft = targets.filter(t => normalSet.has(t));
      if (ft.length) filteredImportMap[src] = ft;
    }
    try {
      perFileCommunity = runLouvain(normalFiles, filteredImportMap, effectiveResolution);
    } catch (err) {
      process.stderr.write(
        `Warning: compute-batches: Louvain failed (${err.message}) ` +
        `— falling back to count-based grouping (12 files/batch) ` +
        `— module semantic boundaries lost\n`,
      );
      perFileCommunity = countBasedAssignment(normalFiles, 12);
      algorithm = 'count-fallback';
    }
    for (const hub of hubFiles) {
      const importers = [];
      for (const [src, targets] of Object.entries(importMap)) {
        if (targets.includes(hub.path)) importers.push(src);
      }
      const batchCounts = new Map();
      for (const imp of importers) {
        const cid = perFileCommunity.get(imp);
        if (cid !== undefined) batchCounts.set(cid, (batchCounts.get(cid) || 0) + 1);
      }
      if (batchCounts.size > 0) {
        const [bestCid] = [...batchCounts.entries()].sort((a, b) => b[1] - a[1])[0];
        perFileCommunity.set(hub.path, bestCid);
      } else {
        const outNeighbors = importMap[hub.path] || [];
        for (const tgt of outNeighbors) {
          const cid = perFileCommunity.get(tgt);
          if (cid !== undefined) { perFileCommunity.set(hub.path, cid); break; }
        }
        if (!perFileCommunity.has(hub.path)) {
          const cids = [...new Set(perFileCommunity.values())];
          perFileCommunity.set(hub.path, cids[0] || '0');
        }
      }
    }
    process.stderr.write(
      `Info: compute-batches: excluded ${hubFiles.length} hub files (degree > ${config.excludeHubs}) from Louvain — reassigned to strongest importing batch\n`,
    );
  } else {
    try {
      perFileCommunity = runLouvain(codeFiles, importMap, effectiveResolution);
    } catch (err) {
      process.stderr.write(
        `Warning: compute-batches: Louvain failed (${err.message}) ` +
        `— falling back to count-based grouping (12 files/batch) ` +
        `— module semantic boundaries lost\n`,
      );
      perFileCommunity = countBasedAssignment(codeFiles, 12);
      algorithm = 'count-fallback';
    }
  }

  // Group files by community id
  const filesByCommunity = new Map();
  for (const [path, cid] of perFileCommunity) {
    if (!filesByCommunity.has(cid)) filesByCommunity.set(cid, []);
    filesByCommunity.get(cid).push(path);
  }

  // Size enforcement only on louvain output. count-fallback already chunked.
  const MAX_COMMUNITY_SIZE = config.maxCommunitySize;
  const splitCommunities = new Map();
  let nextSyntheticId = 0;
  if (algorithm === 'louvain') {
    for (const [cid, paths] of filesByCommunity) {
      if (paths.length <= MAX_COMMUNITY_SIZE) {
        splitCommunities.set(cid, paths);
        continue;
      }
      process.stderr.write(
        `Warning: compute-batches: community size ${paths.length} > max ${MAX_COMMUNITY_SIZE} ` +
        `— splitting via alphabetical chunking — modularity may decrease\n`,
      );
      const sorted = [...paths].sort();
      const parts = Math.ceil(paths.length / MAX_COMMUNITY_SIZE);
      const perPart = Math.ceil(paths.length / parts);
      for (let i = 0; i < parts; i++) {
        const slice = sorted.slice(i * perPart, (i + 1) * perPart);
        const synthId = `__split_${cid}_${nextSyntheticId++}`;
        splitCommunities.set(synthId, slice);
      }
    }
  } else {
    for (const [cid, paths] of filesByCommunity) splitCommunities.set(cid, paths);
  }

  // Sort communities by size desc, then by min-path asc for determinism
  const sortedCommunities = [...splitCommunities.entries()]
    .sort((a, b) => {
      if (b[1].length !== a[1].length) return b[1].length - a[1].length;
      const minA = [...a[1]].sort()[0];
      const minB = [...b[1]].sort()[0];
      return minA.localeCompare(minB);
    });

  // Build per-batch file list with full file metadata from scan
  const fileMetaByPath = new Map(files.map(f => [f.path, f]));
  // Safe: every path in a community is a graph node, and graph nodes are a
  // subset of files (see addNode loop above). fileMetaByPath.get() can
  // never return undefined here.

  // First-pass: assemble bare batches (no batchImportData/neighborMap yet).
  // All Louvain communities are mergeable=true so the merge-small pass can
  // collapse singletons / 2-file orphans. Non-code groups carry per-group
  // mergeable flags from buildNonCodeBatches (false for semantic Groups A-D,
  // true for Group E catch-all).
  const codeBatchObjsBare = sortedCommunities.map(([, paths], idx) => ({
    batchIndex: idx + 1,
    files: paths.sort().map(p => fileMetaByPath.get(p)),
    mergeable: true,
  }));
  const nonCodeGroups = buildNonCodeBatches(nonCodeFiles);
  const nonCodeBatchObjsBare = nonCodeGroups.map((g, i) => ({
    batchIndex: codeBatchObjsBare.length + i + 1,
    files: g.files,
    mergeable: g.mergeable,
  }));
  const bareBatches = [...codeBatchObjsBare, ...nonCodeBatchObjsBare];
  const mergedBareBatches = mergeSmallBatches(bareBatches, {
    minBatchSize: config.minBatchSize,
    maxMergeTarget: config.maxMergeTarget,
  });
  const absorbedBatches = absorbWeakBatches(mergedBareBatches, importMap, {
    maxCommunitySize: config.maxCommunitySize,
  });
  const dirSplitCount0 = absorbedBatches.length;
  const batchesAfterDirSplit = config.maxDirsPerBatch !== null
    ? splitMixedDirBatches(absorbedBatches, config.maxDirsPerBatch, Math.min(config.minBatchSize, 3))
    : absorbedBatches;
  const dirSplitCount = batchesAfterDirSplit.length - dirSplitCount0;
  const absorbedCount = mergedBareBatches.length - absorbedBatches.length;
  if (absorbedCount > 0) {
    process.stderr.write(
      `Info: compute-batches: absorbed ${absorbedCount} weak batches into adjacent strong batches\n`,
    );
  }
  const batchOf = buildBatchOfMap(batchesAfterDirSplit);

  // Build reverse import map: target → [sources that import target]
  const reverseImportMap = new Map();
  for (const [src, targets] of Object.entries(importMap)) {
    for (const tgt of targets) {
      if (!reverseImportMap.has(tgt)) reverseImportMap.set(tgt, []);
      reverseImportMap.get(tgt).push(src);
    }
  }

  // Compute neighbor degree (number of import relations) per path, used for
  // truncation when neighborMap[file] has > MAX_NEIGHBORS entries.
  const NEIGHBOR_DEGREE = new Map();
  for (const f of codeFiles) {
    const outDeg = (importMap[f.path] || []).length;
    const inDeg = (reverseImportMap.get(f.path) || []).length;
    NEIGHBOR_DEGREE.set(f.path, outDeg + inDeg);
  }

  const MAX_NEIGHBORS = 50;

  // Second-pass: enrich each batch with batchImportData + neighborMap
  const batches = batchesAfterDirSplit.map(b => {
    const batchPaths = new Set(b.files.map(f => f.path));
    const batchImportData = {};
    const neighborMap = {};
    for (const f of b.files) {
      batchImportData[f.path] = (importMap[f.path] || []).slice();

      // 1-hop neighbors: imports out + imported-by in, excluding same batch.
      // Note on truncation: we measure "popularity" by total raw 1-hop neighbor
      // count (rawCount), not kept.length. A widely-imported hub like a logger
      // module may have N>50 inbound imports but, after Louvain + size
      // enforcement, only some land in other batches — kept.length can be < 50
      // while the file is still a high-degree hub whose missing relationships
      // matter for downstream cross-batch edge confidence. Warning on rawCount
      // surfaces this; truncation on kept ensures the JSON stays bounded.
      const outNeighbors = importMap[f.path] || [];
      const inNeighbors = reverseImportMap.get(f.path) || [];
      const all = new Set([...outNeighbors, ...inNeighbors]);
      const rawCount = all.size;
      const filtered = [...all].filter(p => batchOf.has(p) && !batchPaths.has(p));

      let kept = filtered.map(p => ({
        path: p,
        batchIndex: batchOf.get(p),
        symbols: exportsByPath.get(p) || [],
      }));

      if (rawCount > MAX_NEIGHBORS) {
        kept.sort((a, b2) => (NEIGHBOR_DEGREE.get(b2.path) || 0)
                            - (NEIGHBOR_DEGREE.get(a.path) || 0)
                            || a.path.localeCompare(b2.path));  // deterministic tiebreak
        const beforeSlice = kept.length;
        kept = kept.slice(0, MAX_NEIGHBORS);
        process.stderr.write(
          `Warning: compute-batches: neighborMap for ${f.path} has high 1-hop degree ${rawCount} ` +
          `— exceeds soft cap of ${MAX_NEIGHBORS} — keeping top ${kept.length} cross-batch entries ` +
          `(${beforeSlice - kept.length} dropped by degree sort)\n`,
        );
      }

      if (kept.length) neighborMap[f.path] = kept;
    }
    return { batchIndex: b.batchIndex, files: b.files, batchImportData, neighborMap };
  });

  let finalBatches = batches;
  if (changedFiles) {
    finalBatches = batches.filter(b => b.files.some(f => changedFiles.has(f.path)));
    // batchIndex on filtered batches retains the full-graph assignment
    // (the design says neighborMap should still reference unchanged files'
    // full-graph batchIndex). No renumbering.
  }

  // Note: under --changed-files mode, totalFiles is the FULL project file
  // count (unchanged from the input scan) while totalBatches reflects only
  // the filtered set written to disk. batchIndex values on the kept batches
  // preserve the full-graph assignment so neighborMap references resolve.
  const output = {
    schemaVersion: 1,
    algorithm,
    totalFiles: scan.files.length,
    totalBatches: finalBatches.length,
    exportsByPath: Object.fromEntries(exportsByPath),
    batches: finalBatches,
  };

  // ── Diagnostic: intra-batch edge ratio + orchestrator recommendation ──
  const batchSizes = finalBatches.map(b => b.files.length);
  const maxSize = batchSizes.length ? Math.max(...batchSizes) : 0;
  const minSize = batchSizes.length ? Math.min(...batchSizes) : 0;
  const avgSize = batchSizes.length ? (batchSizes.reduce((a, b) => a + b, 0) / batchSizes.length).toFixed(1) : 0;

  const fileToBatch = new Map();
  for (const b of finalBatches) {
    for (const f of b.files) fileToBatch.set(f.path, b.batchIndex);
  }
  let intra = 0, cross = 0;
  for (const [src, targets] of Object.entries(importMap)) {
    const sb = fileToBatch.get(src);
    if (sb === undefined) continue;
    for (const tgt of targets) {
      const tb = fileToBatch.get(tgt);
      if (tb === undefined) continue;
      if (sb === tb) intra++; else cross++;
    }
  }
  const total = intra + cross;
  const intraRatio = total > 0 ? (intra / total * 100).toFixed(1) : '0.0';

  const hubDiag = config.excludeHubs !== null
    ? `, hub-files=${hubFiles.length}(degrees: ${hubDegrees.sort((a, b) => a - b).join(', ')})`
    : '';
  process.stderr.write(
    `Diagnostic: ${finalBatches.length} batches, avg=${avgSize} files/batch, ` +
    `intra-edge=${intraRatio}% (${intra}/${total}), ` +
    `sizes(max=${maxSize},min=${minSize}), ` +
    `absorbed=${absorbedCount}` + hubDiag + `, ` +
    `params(maxCommunitySize=${config.maxCommunitySize},minBatchSize=${config.minBatchSize},maxMergeTarget=${config.maxMergeTarget})\n`,
  );

  if (config.maxDirsPerBatch !== null) {
    const secondLevelDir = p => {
      const parts = p.split('/');
      return parts.length > 1 ? parts[1] : parts[0];
    };
    let singleDir = 0, mixedDir = 0;
    for (const b of finalBatches) {
      const dirs = new Set(b.files.map(f => secondLevelDir(f.path)));
      if (dirs.size <= 1) singleDir++; else mixedDir++;
    }
    process.stderr.write(
      `Coherence: ${singleDir} single-dir, ${mixedDir} mixed-dir (split ${dirSplitCount} batches)\n`,
    );
  }

  // Orchestrator recommendation — per-batch inspection is primary, global ratio is a rough guide
  const ratio = parseFloat(intraRatio);
  const smallCount = finalBatches.filter(b => b.files.length <= 5).length;
  const largeCount = finalBatches.filter(b => b.files.length > 30).length;
  if (ratio >= 60 && finalBatches.length > 15) {
    process.stderr.write(
      `Recommendation: quality=HIGH (intra-edge ${intraRatio}% >= 60%), batches=${finalBatches.length}. ` +
      `Global grouping is good. Inspect per-batch listings to decide which batches to merge. ` +
      `Hint: ${smallCount} small batches (<=5 files) — try --min-batch-size first (safe, won't touch large batches).\n`,
    );
  } else if (ratio >= 60 && finalBatches.length <= 15) {
    process.stderr.write(
      `Recommendation: quality=HIGH (intra-edge ${intraRatio}%), batches=${finalBatches.length}. ` +
      `Good balance. No adjustment needed.\n`,
    );
  } else if (ratio >= 40) {
    process.stderr.write(
      `Recommendation: quality=MODERATE (intra-edge ${intraRatio}%), batches=${finalBatches.length}. ` +
      `Inspect per-batch listings: merge small batches with low intra-edges; keep large cohesive batches. ` +
      `Hint: ${smallCount} small batches, ${largeCount} large batches — try --min-batch-size first.\n`,
    );
  } else {
    process.stderr.write(
      `Recommendation: quality=LOW (intra-edge ${intraRatio}%), batches=${finalBatches.length}. ` +
      `Boundaries are weak. Inspect per-batch listings to identify which groupings make sense. ` +
      `Hint: --max-community-size will reshuffle all batches; only use if smaller params can't help.\n`,
    );
  }

  if (dryRun) {
    // Per-batch content listing for orchestrator inspection
    for (const b of finalBatches) {
      const paths = b.files.map(f => f.path).sort();
      const dirs = [...new Set(paths.map(p => {
        const parts = p.split('/');
        return parts.length > 2 ? parts.slice(0, -1).join('/') : parts[0];
      }))];
      let batchIntra = 0, batchCross = 0;
      for (const f of paths) {
        for (const t of (importMap[f] || [])) {
          if (fileToBatch.get(t) === b.batchIndex) batchIntra++;
          else batchCross++;
        }
      }
      const batchTotal = batchIntra + batchCross;
      const batchRatio = batchTotal > 0 ? (batchIntra / batchTotal * 100).toFixed(1) : '0.0';
      process.stderr.write(
        `\n  Batch ${b.batchIndex} (${b.files.length} files, ${batchIntra} intra-edges, intra-ratio ${batchRatio}%):\n` +
        `    Dirs: ${dirs.join(', ')}\n` +
        paths.map(p => `    ${p}`).join('\n') + '\n',
      );
    }
    process.stderr.write(`\nDry-run mode. No batches written. Adjust parameters and re-run without --dry-run.\n`);
    process.exit(0);
  }

  // ── Write batches.json ──
  const outPath = join(projectRoot, '.understand-anything', 'intermediate', 'batches.json');
  writeFileSync(outPath, JSON.stringify(output, null, 2), 'utf-8');
  process.stderr.write(
    `Wrote ${finalBatches.length} batches (sizes: max=${maxSize}, min=${minSize}) to ${outPath}\n`,
  );
}

// ---------------------------------------------------------------------------
// Run only when executed directly as a CLI; importing the module (e.g. from
// tests) must not trigger main().
//
// Canonicalize both sides through realpathSync. Node ESM resolves
// import.meta.url through symlinks but pathToFileURL(process.argv[1]) preserves
// them, so a raw equality check silently no-ops when the script is invoked via
// a symlinked plugin install path (the default in Claude Code / Copilot CLI
// caches). See GitHub issue #162.
// ---------------------------------------------------------------------------
function isCliEntry() {
  if (!process.argv[1]) return false;
  try {
    const modulePath = realpathSync(fileURLToPath(import.meta.url));
    const argvPath = realpathSync(process.argv[1]);
    return modulePath === argvPath;
  } catch {
    return false;
  }
}

if (isCliEntry()) {
  try {
    await main();
  } catch (err) {
    process.stderr.write(`compute-batches.mjs failed: ${err.message}\n${err.stack}\n`);
    process.exit(1);
  }
}
