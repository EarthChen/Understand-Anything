import { describe, it, expect } from "vitest";
import { buildDiffContext, formatDiffAnalysis } from "./diff-analyzer.js";
import type { DiffContext } from "./diff-analyzer.js";
import type { KnowledgeGraph, GraphNode, GraphEdge, Layer } from "@understand-anything/core";

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

describe("formatDiffAnalysis", () => {
  const emptyCtx: DiffContext = {
    projectName: "test",
    changedFiles: [],
    changedNodes: [],
    affectedNodes: [],
    impactedEdges: [],
    affectedLayers: [],
    unmappedFiles: [],
  };

  function makeNode(overrides: Partial<GraphNode> & { id: string }): GraphNode {
    return {
      id: overrides.id,
      type: (overrides.type ?? "function") as GraphNode["type"],
      name: overrides.name ?? overrides.id,
      summary: overrides.summary ?? "",
      filePath: overrides.filePath,
      tags: overrides.tags ?? [],
      complexity: (overrides.complexity ?? "simple") as GraphNode["complexity"],
    };
  }

  it("handles empty changed nodes", () => {
    const result = formatDiffAnalysis(emptyCtx);
    expect(result).toContain("No mapped components found for changed files.");
    expect(result).toContain("# Diff Analysis: test");
  });

  it("lists changed nodes with details", () => {
    const ctx: DiffContext = {
      ...emptyCtx,
      changedNodes: [
        makeNode({ id: "fn:auth", name: "authenticate", type: "function", summary: "Auth handler", complexity: "simple", filePath: "src/auth.ts" }),
      ],
    };
    const result = formatDiffAnalysis(ctx);
    expect(result).toContain("**authenticate** (function)");
    expect(result).toContain("Auth handler");
    expect(result).toContain("File: `src/auth.ts`");
    expect(result).toContain("Complexity: simple");
  });

  it("lists affected nodes", () => {
    const ctx: DiffContext = {
      ...emptyCtx,
      affectedNodes: [
        makeNode({ id: "fn:db", name: "queryDB", type: "function", summary: "Runs queries" }),
        makeNode({ id: "fn:cache", name: "invalidate", type: "function", summary: "Clears cache" }),
      ],
    };
    const result = formatDiffAnalysis(ctx);
    expect(result).toContain("These components are connected to changed code");
    expect(result).toContain("**queryDB** (function)");
    expect(result).toContain("**invalidate** (function)");
  });

  it("shows no downstream impact when affectedNodes is empty", () => {
    const result = formatDiffAnalysis(emptyCtx);
    expect(result).toContain("No downstream impact detected.");
  });

  it("lists affected layers", () => {
    const layer: Layer = { id: "l1", name: "Presentation", description: "UI layer", nodeIds: ["fn:auth"] };
    const ctx: DiffContext = {
      ...emptyCtx,
      affectedLayers: [layer],
    };
    const result = formatDiffAnalysis(ctx);
    expect(result).toContain("**Presentation**: UI layer");
  });

  it("shows no layers affected when empty", () => {
    const result = formatDiffAnalysis(emptyCtx);
    expect(result).toContain("No layers affected.");
  });

  it("lists impacted relationships", () => {
    const edge: GraphEdge = { source: "fn:a", target: "fn:b", type: "calls", direction: "forward", weight: 1 };
    const ctx: DiffContext = {
      ...emptyCtx,
      impactedEdges: [edge],
    };
    const result = formatDiffAnalysis(ctx);
    expect(result).toContain("## Impacted Relationships");
    expect(result).toContain("fn:a --[calls]--> fn:b");
  });

  it("lists unmapped files", () => {
    const ctx: DiffContext = {
      ...emptyCtx,
      unmappedFiles: ["src/new.ts", "src/other.ts"],
    };
    const result = formatDiffAnalysis(ctx);
    expect(result).toContain("## Unmapped Files");
    expect(result).toContain("`src/new.ts`");
    expect(result).toContain("`src/other.ts`");
    expect(result).toContain("2 files not in the knowledge graph");
  });

  it("does not render unmapped files section when empty", () => {
    const result = formatDiffAnalysis(emptyCtx);
    expect(result).not.toContain("## Unmapped Files");
  });

  it("reports low risk for simple localized changes", () => {
    const ctx: DiffContext = {
      ...emptyCtx,
      changedNodes: [
        makeNode({ id: "fn:a", name: "helper", complexity: "simple" }),
      ],
    };
    const result = formatDiffAnalysis(ctx);
    expect(result).toContain("**Low risk**");
  });

  it("flags high complexity in risk assessment", () => {
    const ctx: DiffContext = {
      ...emptyCtx,
      changedNodes: [
        makeNode({ id: "fn:a", name: "bigFunc", complexity: "complex" }),
      ],
    };
    const result = formatDiffAnalysis(ctx);
    expect(result).toContain("**High complexity**");
    expect(result).toContain("bigFunc");
    expect(result).not.toContain("**Low risk**");
  });

  it("flags cross-layer impact in risk assessment", () => {
    const ctx: DiffContext = {
      ...emptyCtx,
      affectedLayers: [
        { id: "l1", name: "Presentation", description: "UI", nodeIds: [] },
        { id: "l2", name: "Data", description: "DB", nodeIds: [] },
      ],
    };
    const result = formatDiffAnalysis(ctx);
    expect(result).toContain("**Cross-layer impact**");
    expect(result).toContain("2 architectural layers");
    expect(result).not.toContain("**Low risk**");
  });

  it("flags wide blast radius when more than 5 components affected", () => {
    const nodes = Array.from({ length: 6 }, (_, i) =>
      makeNode({ id: `fn:${i}`, name: `func${i}` }),
    );
    const ctx: DiffContext = {
      ...emptyCtx,
      affectedNodes: nodes,
    };
    const result = formatDiffAnalysis(ctx);
    expect(result).toContain("**Wide blast radius**");
    expect(result).toContain("6 components affected");
    expect(result).not.toContain("**Low risk**");
  });

  it("flags new/unmapped files in risk assessment", () => {
    const ctx: DiffContext = {
      ...emptyCtx,
      unmappedFiles: ["src/new.ts"],
    };
    const result = formatDiffAnalysis(ctx);
    expect(result).toContain("**New/unmapped files**");
    expect(result).not.toContain("**Low risk**");
  });
});
