import { describe, it, expect } from "vitest";
import { validateSystemGraph, type SystemGraph } from "../system-graph.js";

const validGraph: SystemGraph = {
  version: "1.0.0",
  generatedAt: "2026-06-04T12:00:00Z",
  project: {
    name: "Test System",
    serviceCount: 2,
    totalNodes: 500,
    totalEdges: 800,
  },
  nodes: [
    {
      id: "microservice:order-service",
      type: "microservice",
      name: "Order Service",
      summary: "Handles orders",
    },
    {
      id: "microservice:payment-service",
      type: "microservice",
      name: "Payment Service",
      summary: "Handles payments",
    },
  ],
  edges: [
    {
      source: "microservice:order-service",
      target: "microservice:payment-service",
      type: "rpc_call",
      weight: 0.8,
    },
  ],
  serviceIndex: {
    "order-service": { hasKg: true, hasWiki: true, hasDomain: false },
    "payment-service": { hasKg: true, hasWiki: false, hasDomain: false },
  },
};

describe("validateSystemGraph", () => {
  it("accepts a valid system graph", () => {
    const result = validateSystemGraph(validGraph);
    expect(result.valid).toBe(true);
    expect(result.data).toEqual(validGraph);
    expect(result.issues).toEqual([]);
  });

  it("rejects non-object input", () => {
    const result = validateSystemGraph(null);
    expect(result.valid).toBe(false);
    expect(result.data).toBeNull();
    expect(result.issues).toContain("Input is not an object");
  });

  it("rejects missing version", () => {
    const { version: _v, ...rest } = validGraph;
    const result = validateSystemGraph(rest);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.includes("version"))).toBe(true);
  });

  it("rejects invalid project.serviceCount", () => {
    const graph = {
      ...validGraph,
      project: { ...validGraph.project, serviceCount: "two" },
    };
    const result = validateSystemGraph(graph);
    expect(result.valid).toBe(false);
    expect(result.issues).toContain("project.serviceCount must be a number");
  });

  it("rejects duplicate node ids", () => {
    const graph = {
      ...validGraph,
      nodes: [
        validGraph.nodes[0],
        { ...validGraph.nodes[0] },
      ],
    };
    const result = validateSystemGraph(graph);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.includes("Duplicate node id"))).toBe(true);
  });

  it("rejects edges referencing unknown nodes", () => {
    const graph = {
      ...validGraph,
      edges: [
        {
          source: "microservice:missing",
          target: "microservice:payment-service",
          type: "rpc_call",
          weight: 1,
        },
      ],
    };
    const result = validateSystemGraph(graph);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.includes("source") && i.includes("not found"))).toBe(
      true,
    );
  });

  it("rejects non-array nodes", () => {
    const graph = { ...validGraph, nodes: "bad" };
    const result = validateSystemGraph(graph);
    expect(result.valid).toBe(false);
    expect(result.issues).toContain("'nodes' must be an array");
  });

  it("rejects non-array edges", () => {
    const graph = { ...validGraph, edges: "bad" };
    const result = validateSystemGraph(graph);
    expect(result.valid).toBe(false);
    expect(result.issues).toContain("'edges' must be an array");
  });
});
