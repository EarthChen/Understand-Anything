import { describe, it, expect } from "vitest";
import type { KnowledgeGraph, GraphNode, GraphEdge, EdgeType, NodeType, StructuralAnalysis, AnalyzerPlugin, ReferenceResolution, ArtifactProvenance } from "./types.js";

describe("KnowledgeGraph types", () => {
  it("should create a valid empty KnowledgeGraph", () => {
    const graph: KnowledgeGraph = {
      version: "1.0.0",
      project: {
        name: "test-project",
        languages: [],
        frameworks: [],
        description: "A test project",
        analyzedAt: new Date().toISOString(),
        gitCommitHash: "abc123",
      },
      nodes: [],
      edges: [],
      layers: [],
      tour: [],
    };

    expect(graph.version).toBe("1.0.0");
    expect(graph.project.name).toBe("test-project");
    expect(graph.nodes).toHaveLength(0);
    expect(graph.edges).toHaveLength(0);
    expect(graph.layers).toHaveLength(0);
    expect(graph.tour).toHaveLength(0);
  });

  it("should create valid GraphNodes with all fields", () => {
    const fileNode: GraphNode = {
      id: "node-1",
      type: "file",
      name: "index.ts",
      filePath: "src/index.ts",
      lineRange: [1, 50],
      summary: "Entry point of the application",
      tags: ["entry", "typescript"],
      complexity: "simple",
      languageNotes: "Uses ES module syntax",
    };

    expect(fileNode.id).toBe("node-1");
    expect(fileNode.type).toBe("file");
    expect(fileNode.filePath).toBe("src/index.ts");
    expect(fileNode.lineRange).toEqual([1, 50]);
    expect(fileNode.tags).toContain("entry");
    expect(fileNode.complexity).toBe("simple");

    const functionNode: GraphNode = {
      id: "node-2",
      type: "function",
      name: "processData",
      filePath: "src/utils.ts",
      lineRange: [10, 25],
      summary: "Processes raw data into structured format",
      tags: ["utility", "data"],
      complexity: "moderate",
    };

    expect(functionNode.type).toBe("function");
    expect(functionNode.complexity).toBe("moderate");
    expect(functionNode.languageNotes).toBeUndefined();

    const classNode: GraphNode = {
      id: "node-3",
      type: "class",
      name: "DataStore",
      summary: "Manages application state",
      tags: ["state", "core"],
      complexity: "complex",
    };

    expect(classNode.type).toBe("class");
    expect(classNode.filePath).toBeUndefined();
    expect(classNode.lineRange).toBeUndefined();
  });

  it("should create valid GraphEdges with weight bounds", () => {
    const edge: GraphEdge = {
      source: "node-1",
      target: "node-2",
      type: "imports",
      direction: "forward",
      description: "index.ts imports processData from utils.ts",
      weight: 0.8,
    };

    expect(edge.source).toBe("node-1");
    expect(edge.target).toBe("node-2");
    expect(edge.type).toBe("imports");
    expect(edge.direction).toBe("forward");
    expect(edge.weight).toBeGreaterThanOrEqual(0);
    expect(edge.weight).toBeLessThanOrEqual(1);

    const minWeightEdge: GraphEdge = {
      source: "node-1",
      target: "node-3",
      type: "related",
      direction: "bidirectional",
      weight: 0,
    };

    expect(minWeightEdge.weight).toBe(0);
    expect(minWeightEdge.description).toBeUndefined();

    const maxWeightEdge: GraphEdge = {
      source: "node-2",
      target: "node-3",
      type: "calls",
      direction: "forward",
      weight: 1,
    };

    expect(maxWeightEdge.weight).toBe(1);
  });
});

describe("Extended types", () => {
  it("accepts all 23 node types via NodeType alias", () => {
    const nodeTypes: NodeType[] = [
      "file", "function", "class", "module", "concept",
      "config", "document", "service", "table", "endpoint",
      "pipeline", "schema", "resource",
      "domain", "flow", "step",
      "article", "entity", "topic", "claim", "source", "requirement", "testcase",
    ];
    expect(nodeTypes).toHaveLength(23);
    // NodeType and GraphNode["type"] should be interchangeable
    const check: GraphNode["type"] = nodeTypes[0];
    expect(check).toBe("file");
  });

  it("accepts all edge types including RPC", () => {
    const edgeTypes: EdgeType[] = [
      "imports", "exports", "contains", "inherits", "implements",
      "calls", "subscribes", "publishes", "middleware",
      "provides_rpc", "consumes_rpc",
      "reads_from", "writes_to", "transforms", "validates",
      "depends_on", "tested_by", "configures",
      "related", "similar_to",
      "deploys", "serves", "migrates", "documents",
      "provisions", "routes", "defines_schema", "triggers",
    ];
    expect(edgeTypes).toHaveLength(28);
  });

  it("StructuralAnalysis has optional non-code fields", () => {
    const analysis: StructuralAnalysis = {
      functions: [], classes: [], imports: [], exports: [],
      sections: [{ name: "Introduction", level: 1, lineRange: [1, 10] }],
      definitions: [{ name: "users", kind: "table", lineRange: [1, 20], fields: ["id", "name"] }],
      services: [{ name: "web", image: "node:22", ports: [3000], lineRange: [1, 5] }],
      endpoints: [{ method: "GET", path: "/api/users", lineRange: [5, 15] }],
      steps: [{ name: "build", lineRange: [1, 5] }],
      resources: [{ name: "aws_s3_bucket.main", kind: "aws_s3_bucket", lineRange: [1, 10] }],
    };
    expect(analysis.sections).toHaveLength(1);
    expect(analysis.definitions).toHaveLength(1);
    expect(analysis.services).toHaveLength(1);
    expect(analysis.services![0].lineRange).toEqual([1, 5]);
    expect(analysis.endpoints).toHaveLength(1);
    expect(analysis.steps).toHaveLength(1);
    expect(analysis.resources).toHaveLength(1);
  });

  it("ServiceInfo.lineRange is optional for backward compat", () => {
    const svcWithout: import("./types.js").ServiceInfo = { name: "web", ports: [3000] };
    const svcWith: import("./types.js").ServiceInfo = { name: "db", ports: [5432], lineRange: [10, 20] };
    expect(svcWithout.lineRange).toBeUndefined();
    expect(svcWith.lineRange).toEqual([10, 20]);
  });

  it("StructuralAnalysis is backward compatible (non-code fields are optional)", () => {
    const analysis: StructuralAnalysis = {
      functions: [], classes: [], imports: [], exports: [],
    };
    expect(analysis.sections).toBeUndefined();
    expect(analysis.definitions).toBeUndefined();
    expect(analysis.services).toBeUndefined();
  });

  it("AnalyzerPlugin allows optional resolveImports", () => {
    const plugin: AnalyzerPlugin = {
      name: "test-plugin",
      languages: ["markdown"],
      analyzeFile: () => ({ functions: [], classes: [], imports: [], exports: [] }),
      // resolveImports is optional — not provided
    };
    expect(plugin.resolveImports).toBeUndefined();
    expect(plugin.analyzeFile).toBeDefined();
  });

  it("AnalyzerPlugin supports extractReferences", () => {
    const refs: ReferenceResolution[] = [
      { source: "README.md", target: "./docs/guide.md", referenceType: "file", line: 5 },
    ];
    const plugin: AnalyzerPlugin = {
      name: "test-plugin",
      languages: ["markdown"],
      analyzeFile: () => ({ functions: [], classes: [], imports: [], exports: [] }),
      extractReferences: () => refs,
    };
    expect(plugin.extractReferences!("README.md", "")).toEqual(refs);
  });
});

describe("ArtifactProvenance", () => {
  it("should create a valid ArtifactProvenance with all required fields", () => {
    const provenance: ArtifactProvenance = {
      generationMode: "full",
      completedStages: ["scan", "batch", "extract", "analyze", "merge", "validate"],
      degraded: false,
      gitCommitHash: "abc123def",
      toolVersion: "1.0.0",
      analyzedAt: "2026-06-08T12:00:00Z",
    };

    expect(provenance.generationMode).toBe("full");
    expect(provenance.completedStages).toContain("extract");
    expect(provenance.degraded).toBe(false);
    expect(provenance.gitCommitHash).toBe("abc123def");
    expect(provenance.toolVersion).toBe("1.0.0");
    expect(provenance.analyzedAt).toBeDefined();
  });

  it("should allow incremental generation mode", () => {
    const provenance: ArtifactProvenance = {
      generationMode: "incremental",
      completedStages: ["extract", "analyze", "merge", "validate"],
      degraded: false,
      gitCommitHash: "abc123def",
      toolVersion: "1.0.0",
      analyzedAt: "2026-06-08T12:00:00Z",
    };
    expect(provenance.generationMode).toBe("incremental");
  });

  it("should allow standalone generation mode", () => {
    const provenance: ArtifactProvenance = {
      generationMode: "standalone",
      completedStages: ["scan", "analyze"],
      degraded: false,
      gitCommitHash: "abc123def",
      toolVersion: "1.0.0",
      analyzedAt: "2026-06-08T12:00:00Z",
    };
    expect(provenance.generationMode).toBe("standalone");
  });

  it("should allow degraded=true with qualityGates", () => {
    const provenance: ArtifactProvenance = {
      generationMode: "full",
      completedStages: ["scan", "batch", "extract"],
      degraded: true,
      qualityGates: { semanticCompleteness: false },
      gitCommitHash: "abc123def",
      toolVersion: "1.0.0",
      analyzedAt: "2026-06-08T12:00:00Z",
    };
    expect(provenance.degraded).toBe(true);
    expect(provenance.qualityGates?.semanticCompleteness).toBe(false);
  });

  it("ProjectMeta should accept optional provenance field", () => {
    const graph: KnowledgeGraph = {
      version: "1.0.0",
      project: {
        name: "test-project",
        languages: ["java"],
        frameworks: ["spring"],
        description: "Test",
        analyzedAt: "2026-06-08T12:00:00Z",
        gitCommitHash: "abc123def",
        provenance: {
          generationMode: "full",
          completedStages: ["scan", "batch", "extract", "analyze", "merge", "validate"],
          degraded: false,
          gitCommitHash: "abc123def",
          toolVersion: "1.0.0",
          analyzedAt: "2026-06-08T12:00:00Z",
        },
      },
      nodes: [],
      edges: [],
      layers: [],
      tour: [],
    };
    expect(graph.project.provenance?.generationMode).toBe("full");
    expect(graph.project.provenance?.degraded).toBe(false);
  });

  it("ProjectMeta should work without provenance (backward compat)", () => {
    const graph: KnowledgeGraph = {
      version: "1.0.0",
      project: {
        name: "test-project",
        languages: [],
        frameworks: [],
        description: "Test",
        analyzedAt: "2026-06-08T12:00:00Z",
        gitCommitHash: "abc123def",
      },
      nodes: [],
      edges: [],
      layers: [],
      tour: [],
    };
    expect(graph.project.provenance).toBeUndefined();
  });
});
