#!/usr/bin/env npx tsx
// packages/core/src/analyzer/rule-engine-postprocess.ts
//
// CLI script that runs the rule engine to produce annotation→edge mappings.
//
// Two modes:
//   1. KG mode:        npx tsx rule-engine-postprocess.ts <graph.json> [--dry-run]
//                      Reads annotations from existing graph nodes, runs rule engine,
//                      merges new edges into the graph.
//
//   2. Extraction mode: npx tsx rule-engine-postprocess.ts <extract-results.json> <output.json>
//                       Reads extraction results from extract-structure.mjs, runs rule engine,
//                       writes { edges, unresolved } to output file.

import { readFileSync, writeFileSync } from "fs";
import { runRuleEngine } from "./rule-engine.js";
import type { GraphEdge } from "../types.js";

// Shape of class-like nodes as stored in a serialized knowledge graph
interface SerializedClassNode {
  type: string;
  name: string;
  filePath?: string;
  annotations?: Array<{ name: string; arguments?: Record<string, string> }>;
  typedProperties?: Array<{ name: string; type?: string; annotations?: Array<{ name: string; arguments?: Record<string, string> }> }>;
  methods?: string[];
  properties?: string[];
  interfaces?: string[];
}

const args = process.argv.slice(2);
const positionalArgs = args.filter(a => !a.startsWith("--"));

const inputPath = positionalArgs[0];
const outputPath = positionalArgs[1];
const extractionMode = args.includes("--mode=extraction-input");

if (!inputPath) {
  console.error("Usage:");
  console.error("  KG mode:        npx tsx rule-engine-postprocess.ts <graph.json> [--dry-run]");
  console.error("  Extraction mode: npx tsx rule-engine-postprocess.ts <extract-results.json> <output.json> --mode=extraction-input");
  process.exit(1);
}

const dryRun = args.includes("--dry-run");

// --- Extraction mode: read extraction results directly ---
if (extractionMode) {
  const inputData = JSON.parse(readFileSync(inputPath, "utf-8"));

  // Support both formats: { results: [...] } from extract-structure.mjs
  // and { extractionResults: [...] } from wrapper scripts
  const extractionResults = inputData.results || inputData.extractionResults;

  if (!Array.isArray(extractionResults)) {
    console.error("Error: input JSON missing 'results' or 'extractionResults' array");
    process.exit(1);
  }

  const result = runRuleEngine(extractionResults, { frameworks: [], packageJson: {} });

  const output = {
    edges: result.edges,
    unresolved: result.unresolved,
    stats: {
      totalEdges: result.edges.length,
      unresolved: result.unresolved.length,
    },
  };

  if (outputPath) {
    writeFileSync(outputPath, JSON.stringify(output, null, 2));
  }
  console.log(JSON.stringify(output.stats));
  process.exit(0);
}

// --- KG mode: merge edges into existing graph ---
const graph = JSON.parse(readFileSync(inputPath, "utf-8"));

if (!graph.nodes || !Array.isArray(graph.nodes)) {
  console.error("Error: graph JSON missing 'nodes' array");
  process.exit(1);
}
if (!graph.edges || !Array.isArray(graph.edges)) {
  console.error("Error: graph JSON missing 'edges' array");
  process.exit(1);
}

// Extract annotations from existing nodes
const extractionResults = (graph.nodes as SerializedClassNode[])
  .filter((n) => (n.type === "class" || n.type === "interface") && ((n.annotations?.length ?? 0) > 0 || (n.typedProperties?.length ?? 0) > 0))
  .map((n) => ({
    path: n.filePath || "",
    classes: [{
      name: n.name,
      lineRange: [0, 0] as [number, number],
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

// Merge new edges (no duplicates)
const existingKeys = new Set(
  (graph.edges as GraphEdge[]).map((e) => `${e.source}|${e.target}|${e.type}`)
);
const newEdges = result.edges.filter(
  (e) => !existingKeys.has(`${e.source}|${e.target}|${e.type}`)
);

graph.edges.push(...newEdges);

const stats = {
  edgesAdded: newEdges.length,
  totalEdges: graph.edges.length,
  unresolved: result.unresolved.length,
};

if (dryRun) {
  console.log(JSON.stringify({ ...stats, dryRun: true }));
} else {
  writeFileSync(inputPath, JSON.stringify(graph, null, 2));
  console.log(JSON.stringify(stats));
}
