#!/usr/bin/env npx tsx
// packages/core/src/analyzer/rule-engine-postprocess.ts
//
// CLI script that applies the rule engine to an existing knowledge-graph.json
// for incremental upgrade — reads annotations from existing graph nodes, runs
// the rule engine, and merges new edges without duplicates.

import { readFileSync, writeFileSync } from "fs";
import { runRuleEngine } from "./rule-engine.js";

const graphPath = process.argv[2];
if (!graphPath) {
  console.error("Usage: npx tsx rule-engine-postprocess.ts <graph-path> [--dry-run]");
  process.exit(1);
}

const dryRun = process.argv.includes("--dry-run");

const graph = JSON.parse(readFileSync(graphPath, "utf-8"));

if (!graph.nodes || !Array.isArray(graph.nodes)) {
  console.error("Error: graph JSON missing 'nodes' array");
  process.exit(1);
}
if (!graph.edges || !Array.isArray(graph.edges)) {
  console.error("Error: graph JSON missing 'edges' array");
  process.exit(1);
}

// Extract annotations from existing nodes
const extractionResults = graph.nodes
  .filter((n: any) => n.annotations?.length > 0 || n.typedProperties?.length > 0)
  .map((n: any) => ({
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
  graph.edges.map((e: any) => `${e.source}|${e.target}|${e.type}`)
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
  writeFileSync(graphPath, JSON.stringify(graph, null, 2));
  console.log(JSON.stringify(stats));
}
