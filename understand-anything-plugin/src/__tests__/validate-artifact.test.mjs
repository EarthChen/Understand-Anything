import { describe, it, expect } from "vitest";
import { validateArtifact } from "../../skills/understand/validate-artifact.mjs";

describe("validateArtifact", () => {
  describe("missing artifact", () => {
    it("returns missing status when file does not exist", () => {
      const result = validateArtifact({
        artifactPath: "/nonexistent/knowledge-graph.json",
        contract: "knowledge-graph:complete",
        readFile: () => { throw new Error("ENOENT"); },
        getGitCommitHash: () => "abc123",
      });
      expect(result.valid).toBe(false);
      expect(result.status).toBe("missing");
    });
  });

  describe("invalid JSON", () => {
    it("returns degraded status when JSON is invalid", () => {
      const result = validateArtifact({
        artifactPath: "/test/knowledge-graph.json",
        contract: "knowledge-graph:complete",
        readFile: () => "{ invalid json",
        getGitCommitHash: () => "abc123",
      });
      expect(result.valid).toBe(false);
      expect(result.status).toBe("degraded");
      expect(result.reason).toContain("invalid JSON");
    });
  });

  describe("no provenance", () => {
    it("returns degraded status when provenance is missing", () => {
      const graph = JSON.stringify({
        version: "1.0.0",
        project: { name: "test", languages: [], frameworks: [], description: "", analyzedAt: "", gitCommitHash: "abc123" },
        nodes: [], edges: [], layers: [], tour: [],
      });
      const result = validateArtifact({
        artifactPath: "/test/knowledge-graph.json",
        contract: "knowledge-graph:complete",
        readFile: () => graph,
        getGitCommitHash: () => "abc123",
      });
      expect(result.valid).toBe(false);
      expect(result.status).toBe("degraded");
      expect(result.reason).toContain("no provenance");
    });
  });

  describe("degraded provenance", () => {
    it("returns degraded status when provenance.degraded is true", () => {
      const graph = JSON.stringify({
        version: "1.0.0",
        project: {
          name: "test", languages: [], frameworks: [], description: "",
          analyzedAt: "", gitCommitHash: "abc123",
          provenance: {
            generationMode: "full",
            completedStages: ["scan", "extract"],
            degraded: true,
            gitCommitHash: "abc123",
            toolVersion: "1.0.0",
            analyzedAt: "2026-06-08T12:00:00Z",
          },
        },
        nodes: [], edges: [], layers: [], tour: [],
      });
      const result = validateArtifact({
        artifactPath: "/test/knowledge-graph.json",
        contract: "knowledge-graph:complete",
        readFile: () => graph,
        getGitCommitHash: () => "abc123",
      });
      expect(result.valid).toBe(false);
      expect(result.status).toBe("degraded");
    });
  });

  describe("stale artifact", () => {
    it("returns stale status when gitCommitHash mismatches", () => {
      const graph = JSON.stringify({
        version: "1.0.0",
        project: {
          name: "test", languages: [], frameworks: [], description: "",
          analyzedAt: "", gitCommitHash: "oldhash",
          provenance: {
            generationMode: "full",
            completedStages: ["scan", "batch", "extract", "analyze", "merge", "validate"],
            degraded: false,
            gitCommitHash: "oldhash",
            toolVersion: "1.0.0",
            analyzedAt: "2026-06-08T12:00:00Z",
          },
        },
        nodes: [], edges: [], layers: [], tour: [],
      });
      const result = validateArtifact({
        artifactPath: "/test/knowledge-graph.json",
        contract: "knowledge-graph:complete",
        readFile: () => graph,
        getGitCommitHash: () => "newhash",
      });
      expect(result.valid).toBe(false);
      expect(result.status).toBe("stale");
    });
  });

  describe("complete artifact", () => {
    it("returns complete status for valid artifact with provenance", () => {
      const graph = JSON.stringify({
        version: "1.0.0",
        project: {
          name: "test", languages: [], frameworks: [], description: "",
          analyzedAt: "", gitCommitHash: "abc123",
          provenance: {
            generationMode: "full",
            completedStages: ["scan", "batch", "extract", "analyze", "merge", "validate"],
            degraded: false,
            gitCommitHash: "abc123",
            toolVersion: "1.0.0",
            analyzedAt: "2026-06-08T12:00:00Z",
          },
        },
        nodes: [], edges: [], layers: [], tour: [],
      });
      const result = validateArtifact({
        artifactPath: "/test/knowledge-graph.json",
        contract: "knowledge-graph:complete",
        readFile: () => graph,
        getGitCommitHash: () => "abc123",
      });
      expect(result.valid).toBe(true);
      expect(result.status).toBe("complete");
    });
  });

  describe("contract stage requirements", () => {
    it("rejects artifact missing required stages", () => {
      const graph = JSON.stringify({
        version: "1.0.0",
        project: {
          name: "test", languages: [], frameworks: [], description: "",
          analyzedAt: "", gitCommitHash: "abc123",
          provenance: {
            generationMode: "full",
            completedStages: ["scan"],
            degraded: false,
            gitCommitHash: "abc123",
            toolVersion: "1.0.0",
            analyzedAt: "2026-06-08T12:00:00Z",
          },
        },
        nodes: [], edges: [], layers: [], tour: [],
      });
      const result = validateArtifact({
        artifactPath: "/test/knowledge-graph.json",
        contract: "knowledge-graph:complete",
        readFile: () => graph,
        getGitCommitHash: () => "abc123",
      });
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("missing stages");
    });
  });

  describe("semantic check — Java RPC annotations", () => {
    const completeProvenance = {
      generationMode: "full",
      completedStages: ["scan", "batch", "extract", "analyze", "merge", "validate"],
      degraded: false,
      gitCommitHash: "abc123",
      toolVersion: "1.0.0",
      analyzedAt: "2026-06-08T12:00:00Z",
    };

    it("fails when source has @MoaProvider but KG lacks provides_rpc edges", () => {
      const graph = JSON.stringify({
        version: "1.0.0",
        project: { name: "test", languages: ["java"], frameworks: [], description: "", analyzedAt: "", gitCommitHash: "abc123", provenance: completeProvenance },
        nodes: [{ id: "class:src/Foo.java:Foo", type: "class", name: "Foo" }],
        edges: [],  // no provides_rpc
        layers: [], tour: [],
      });
      const result = validateArtifact({
        artifactPath: "/test/knowledge-graph.json",
        contract: "knowledge-graph:complete",
        readFile: () => graph,
        getGitCommitHash: () => "abc123",
        semanticCheck: {
          sourceFiles: [{ path: "src/Foo.java", content: "@MoaProvider\npublic class Foo {}" }],
        },
      });
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("provides_rpc");
    });

    it("passes when source has @MoaProvider and KG has provides_rpc edge", () => {
      const graph = JSON.stringify({
        version: "1.0.0",
        project: { name: "test", languages: ["java"], frameworks: [], description: "", analyzedAt: "", gitCommitHash: "abc123", provenance: completeProvenance },
        nodes: [{ id: "class:src/Foo.java:Foo", type: "class", name: "Foo" }],
        edges: [{ source: "class:src/Foo.java:Foo", target: "class:src/Bar.java:Bar", type: "provides_rpc", direction: "forward", weight: 0.9 }],
        layers: [], tour: [],
      });
      const result = validateArtifact({
        artifactPath: "/test/knowledge-graph.json",
        contract: "knowledge-graph:complete",
        readFile: () => graph,
        getGitCommitHash: () => "abc123",
        semanticCheck: {
          sourceFiles: [{ path: "src/Foo.java", content: "@MoaProvider\npublic class Foo {}" }],
        },
      });
      expect(result.valid).toBe(true);
    });

    it("fails when source has @MoaConsumer but KG lacks consumes_rpc edges", () => {
      const graph = JSON.stringify({
        version: "1.0.0",
        project: { name: "test", languages: ["java"], frameworks: [], description: "", analyzedAt: "", gitCommitHash: "abc123", provenance: completeProvenance },
        nodes: [],
        edges: [],
        layers: [], tour: [],
      });
      const result = validateArtifact({
        artifactPath: "/test/knowledge-graph.json",
        contract: "knowledge-graph:complete",
        readFile: () => graph,
        getGitCommitHash: () => "abc123",
        semanticCheck: {
          sourceFiles: [{ path: "src/Client.java", content: "@MoaConsumer\npublic class Client {}" }],
        },
      });
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("consumes_rpc");
    });

    it("passes when no RPC annotations in source", () => {
      const graph = JSON.stringify({
        version: "1.0.0",
        project: { name: "test", languages: ["java"], frameworks: [], description: "", analyzedAt: "", gitCommitHash: "abc123", provenance: completeProvenance },
        nodes: [],
        edges: [],
        layers: [], tour: [],
      });
      const result = validateArtifact({
        artifactPath: "/test/knowledge-graph.json",
        contract: "knowledge-graph:complete",
        readFile: () => graph,
        getGitCommitHash: () => "abc123",
        semanticCheck: {
          sourceFiles: [{ path: "src/Plain.java", content: "public class Plain {}" }],
        },
      });
      expect(result.valid).toBe(true);
    });
  });
});
