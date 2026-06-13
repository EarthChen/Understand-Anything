import { describe, it, expect } from "vitest";
import { buildDiffContext } from "./diff-analyzer.js";
import type { KnowledgeGraph, GraphNode, GraphEdge } from "@understand-anything/core";

function makeGraph(
  nodes: Array<Partial<GraphNode> & { id: string }>,
  edges: Array<[string, string, string]>,
): KnowledgeGraph {
  return {
    version: "1",
    project: {
      name: "test-project",
      languages: ["ts"],
      frameworks: [],
      description: "",
      analyzedAt: "",
      gitCommitHash: "",
    },
    nodes: nodes.map((n) => ({
      id: n.id,
      type: (n.type ?? "function") as GraphNode["type"],
      name: n.name ?? n.id,
      summary: n.summary ?? "",
      filePath: n.filePath,
      tags: n.tags ?? [],
      complexity: (n.complexity ?? "simple") as GraphNode["complexity"],
    })),
    edges: edges.map(([source, target, type]) => ({
      source,
      target,
      type: type as GraphEdge["type"],
      direction: "forward" as const,
      weight: 0.8,
    })),
    layers: [],
    tour: [],
  };
}

describe("buildDiffContext", () => {
  it("maps changed files to graph nodes", () => {
    const graph = makeGraph(
      [
        { id: "file:A.ts", type: "file", filePath: "A.ts" },
        { id: "fn:foo", type: "function" },
      ],
      [["file:A.ts", "fn:foo", "contains"]],
    );
    const ctx = buildDiffContext(graph, ["A.ts"]);
    expect(ctx.changedNodes.map((n) => n.id)).toEqual(["file:A.ts", "fn:foo"]);
    expect(ctx.unmappedFiles).toEqual([]);
  });

  it("tracks unmapped files", () => {
    const graph = makeGraph(
      [{ id: "file:A.ts", type: "file", filePath: "A.ts" }],
      [],
    );
    const ctx = buildDiffContext(graph, ["A.ts", "missing.ts"]);
    expect(ctx.unmappedFiles).toEqual(["missing.ts"]);
  });
});

describe("buildDiffContext multi-hop", () => {
  // Graph: A.ts contains foo, foo calls bar, bar calls baz
  const graph = makeGraph(
    [
      { id: "file:A.ts", type: "file", filePath: "A.ts" },
      { id: "fn:foo", type: "function" },
      { id: "fn:B.bar", type: "function" },
      { id: "fn:C.baz", type: "function" },
    ],
    [
      ["file:A.ts", "fn:foo", "contains"],
      ["fn:foo", "fn:B.bar", "calls"],
      ["fn:B.bar", "fn:C.baz", "calls"],
    ],
  );

  it("finds affected nodes at depth 2", () => {
    const ctx = buildDiffContext(graph, ["A.ts"], { maxDepth: 2 });
    expect(ctx.affectedNodes.map((n) => n.id).sort()).toEqual([
      "fn:B.bar",
      "fn:C.baz",
    ]);
  });

  it("respects maxDepth=1 (backward compatible)", () => {
    const ctx = buildDiffContext(graph, ["A.ts"], { maxDepth: 1 });
    expect(ctx.affectedNodes.map((n) => n.id)).toEqual(["fn:B.bar"]);
  });

  it("defaults to maxDepth=1 when options not provided", () => {
    const ctx = buildDiffContext(graph, ["A.ts"]);
    expect(ctx.affectedNodes.map((n) => n.id)).toEqual(["fn:B.bar"]);
  });

  it("collects impacted edges across hops", () => {
    const ctx = buildDiffContext(graph, ["A.ts"], { maxDepth: 2 });
    const edgeKeys = ctx.impactedEdges.map(
      (e) => `${e.source}->${e.target}`,
    );
    expect(edgeKeys).toContain("fn:foo->fn:B.bar");
    expect(edgeKeys).toContain("fn:B.bar->fn:C.baz");
  });

  it("does not include changed nodes in affected nodes", () => {
    const ctx = buildDiffContext(graph, ["A.ts"], { maxDepth: 2 });
    const affectedIds = ctx.affectedNodes.map((n) => n.id);
    expect(affectedIds).not.toContain("file:A.ts");
    expect(affectedIds).not.toContain("fn:foo");
  });

  it("handles depth 0 (no affected nodes)", () => {
    const ctx = buildDiffContext(graph, ["A.ts"], { maxDepth: 0 });
    expect(ctx.affectedNodes).toEqual([]);
  });

  it("handles graph with no edges", () => {
    const isolatedGraph = makeGraph(
      [
        { id: "file:A.ts", type: "file", filePath: "A.ts" },
        { id: "fn:foo", type: "function" },
      ],
      [["file:A.ts", "fn:foo", "contains"]],
    );
    const ctx = buildDiffContext(isolatedGraph, ["A.ts"], { maxDepth: 3 });
    expect(ctx.affectedNodes).toEqual([]);
  });
});
