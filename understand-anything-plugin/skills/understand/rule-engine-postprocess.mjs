#!/usr/bin/env node
/**
 * rule-engine-postprocess.mjs
 *
 * CLI script that runs the rule engine to produce annotation→edge mappings.
 *
 * Two modes:
 *   1. KG mode:        node rule-engine-postprocess.mjs <graph.json> [--dry-run]
 *                      Reads annotations from existing graph nodes, runs rule engine,
 *                      merges new edges into the graph.
 *
 *   2. Extraction mode: node rule-engine-postprocess.mjs <extract-results.json> <output.json> --mode=extraction-input
 *                       Reads extraction results from extract-structure.mjs, runs rule engine,
 *                       writes { edges, unresolved } to output file.
 */

import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readFileSync, writeFileSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pluginRoot = resolve(__dirname, '../..');
const require = createRequire(resolve(pluginRoot, 'package.json'));

// Resolve @understand-anything/core
let core;
try {
  core = await import(pathToFileURL(require.resolve('@understand-anything/core')).href);
} catch {
  core = await import(pathToFileURL(resolve(pluginRoot, 'packages/core/dist/index.js')).href);
}

const { runRuleEngine } = core;

// --- Parse args ---
const args = process.argv.slice(2);
const positionalArgs = args.filter(a => !a.startsWith("--"));

const inputPath = positionalArgs[0];
const outputPath = positionalArgs[1];
const extractionMode = args.includes("--mode=extraction-input");
const dryRun = args.includes("--dry-run");

if (!inputPath) {
  process.stderr.write("Usage:\n");
  process.stderr.write("  KG mode:        node rule-engine-postprocess.mjs <graph.json> [--dry-run]\n");
  process.stderr.write("  Extraction mode: node rule-engine-postprocess.mjs <extract-results.json> <output.json> --mode=extraction-input\n");
  process.exit(1);
}

// --- Extraction mode ---
if (extractionMode) {
  const inputData = JSON.parse(readFileSync(inputPath, "utf-8"));
  const extractionResults = inputData.results || inputData.extractionResults;

  if (!Array.isArray(extractionResults)) {
    process.stderr.write("Error: input JSON missing 'results' or 'extractionResults' array\n");
    process.exit(1);
  }

  const result = runRuleEngine(extractionResults, { frameworks: [], packageJson: {} });

  const output = {
    edges: result.edges,
    unresolved: result.unresolved,
    stats: {
      totalEdges: result.edges.length,
      unresolvedCalls: result.unresolved.length,
    },
  };

  if (outputPath) {
    writeFileSync(outputPath, JSON.stringify(output, null, 2));
  }
  console.log(JSON.stringify(output.stats));
  process.exit(0);
}

// --- KG mode ---
const graph = JSON.parse(readFileSync(inputPath, "utf-8"));

if (!graph.nodes || !Array.isArray(graph.nodes)) {
  process.stderr.write("Error: graph JSON missing 'nodes' array\n");
  process.exit(1);
}
if (!graph.edges || !Array.isArray(graph.edges)) {
  process.stderr.write("Error: graph JSON missing 'edges' array\n");
  process.exit(1);
}

const extractionResults = graph.nodes
  .filter(n => (n.type === "class" || n.type === "interface") && (n.annotations?.length > 0 || n.typedProperties?.length > 0))
  .map(n => ({
    path: n.filePath || "",
    classes: [{
      name: n.name,
      lineRange: [0, 0],
      methods: n.methods || [],
      properties: n.properties || [],
      annotations: n.annotations || [],
      interfaces: n.interfaces || [],
      typedProperties: n.typedProperties || [],
    }],
    functions: [],
    callGraph: [],
    imports: [],
    exports: [],
  }));

const result = runRuleEngine(extractionResults, { frameworks: [], packageJson: {} });

const existingKeys = new Set(
  graph.edges.map(e => `${e.source}|${e.target}|${e.type}`)
);
const newEdges = result.edges.filter(
  e => !existingKeys.has(`${e.source}|${e.target}|${e.type}`)
);

graph.edges.push(...newEdges);

const stats = {
  edgesAdded: newEdges.length,
  totalEdges: graph.edges.length,
  unresolvedCalls: result.unresolved.length,
};

if (dryRun) {
  console.log(JSON.stringify({ ...stats, dryRun: true }));
} else {
  writeFileSync(inputPath, JSON.stringify(graph, null, 2));
  console.log(JSON.stringify(stats));
}
