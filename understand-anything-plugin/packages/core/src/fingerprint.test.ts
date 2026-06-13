import { describe, it, expect } from "vitest";
import {
  extractFileFingerprint,
  compareFingerprints,
  contentHash,
  type FileFingerprint,
  type ClassFingerprint,
} from "./fingerprint.js";
import type { StructuralAnalysis } from "./types.js";

function makeFp(analysis: Partial<StructuralAnalysis> & { contentHash?: string }): FileFingerprint {
  const full: StructuralAnalysis = {
    functions: analysis.functions ?? [],
    classes: analysis.classes ?? [],
    imports: analysis.imports ?? [],
    exports: analysis.exports ?? [],
  };
  const fp = extractFileFingerprint("test.ts", "dummy", full);
  if (analysis.contentHash) {
    // Override contentHash to force comparison past the fast-path
    return { ...fp, contentHash: analysis.contentHash };
  }
  return fp;
}

describe("fingerprint with interface/enum/decorator", () => {
  it("detects STRUCTURAL change when decorator is added to class", () => {
    const old = makeFp({
      contentHash: "a",
      classes: [{ name: "A", lineRange: [1, 5], methods: [], properties: [], kind: "class" }],
    });
    const newFp = makeFp({
      contentHash: "b",
      classes: [{ name: "A", lineRange: [1, 5], methods: [], properties: [], kind: "class", annotations: [{ name: "Component" }] }],
    });
    expect(compareFingerprints(old, newFp).changeLevel).toBe("STRUCTURAL");
  });

  it("detects STRUCTURAL change when decorator is removed from class", () => {
    const old = makeFp({
      contentHash: "a",
      classes: [{ name: "A", lineRange: [1, 5], methods: [], properties: [], annotations: [{ name: "Component" }] }],
    });
    const newFp = makeFp({
      contentHash: "b",
      classes: [{ name: "A", lineRange: [1, 5], methods: [], properties: [] }],
    });
    expect(compareFingerprints(old, newFp).changeLevel).toBe("STRUCTURAL");
  });

  it("detects STRUCTURAL change when superclass is added", () => {
    const old = makeFp({
      contentHash: "a",
      classes: [{ name: "B", lineRange: [1, 10], methods: [], properties: [] }],
    });
    const newFp = makeFp({
      contentHash: "b",
      classes: [{ name: "B", lineRange: [1, 10], methods: [], properties: [], superclass: "BaseClass" }],
    });
    expect(compareFingerprints(old, newFp).changeLevel).toBe("STRUCTURAL");
  });

  it("detects STRUCTURAL change when interfaces list changes", () => {
    const old = makeFp({
      contentHash: "a",
      classes: [{ name: "C", lineRange: [1, 10], methods: [], properties: [], interfaces: ["Serializable"] }],
    });
    const newFp = makeFp({
      contentHash: "b",
      classes: [{ name: "C", lineRange: [1, 10], methods: [], properties: [], interfaces: ["Serializable", "Cloneable"] }],
    });
    expect(compareFingerprints(old, newFp).changeLevel).toBe("STRUCTURAL");
  });

  it("detects STRUCTURAL change when kind changes", () => {
    const old = makeFp({
      contentHash: "a",
      classes: [{ name: "D", lineRange: [1, 5], methods: [], properties: [], kind: "class" }],
    });
    const newFp = makeFp({
      contentHash: "b",
      classes: [{ name: "D", lineRange: [1, 5], methods: [], properties: [], kind: "abstract class" }],
    });
    expect(compareFingerprints(old, newFp).changeLevel).toBe("STRUCTURAL");
  });

  it("detects STRUCTURAL change when typedProperties change", () => {
    const old = makeFp({
      contentHash: "a",
      classes: [{ name: "E", lineRange: [1, 10], methods: [], properties: [], typedProperties: [{ name: "id", type: "string" }] }],
    });
    const newFp = makeFp({
      contentHash: "b",
      classes: [{ name: "E", lineRange: [1, 10], methods: [], properties: [], typedProperties: [{ name: "id", type: "string" }, { name: "name", type: "string" }] }],
    });
    expect(compareFingerprints(old, newFp).changeLevel).toBe("STRUCTURAL");
  });

  it("returns COSMETIC when only content hash differs but new fields are identical", () => {
    const old = makeFp({
      contentHash: "a",
      classes: [{ name: "F", lineRange: [1, 10], methods: [], properties: [], kind: "class", annotations: [{ name: "Component" }], superclass: "Base", interfaces: ["A"], typedProperties: [{ name: "x", type: "number" }] }],
    });
    const newFp = makeFp({
      contentHash: "b",
      classes: [{ name: "F", lineRange: [1, 10], methods: [], properties: [], kind: "class", annotations: [{ name: "Component" }], superclass: "Base", interfaces: ["A"], typedProperties: [{ name: "x", type: "number" }] }],
    });
    expect(compareFingerprints(old, newFp).changeLevel).toBe("COSMETIC");
  });

  it("populates new ClassFingerprint fields from analysis", () => {
    const fp = makeFp({
      classes: [{
        name: "G",
        lineRange: [1, 20],
        methods: ["doThing"],
        properties: ["value"],
        kind: "enum",
        annotations: [{ name: "Deprecated" }],
        superclass: "Parent",
        interfaces: ["Comparable", "Serializable"],
        typedProperties: [{ name: "label", type: "string" }],
      }],
    });
    const cls = fp.classes[0];
    expect(cls.kind).toBe("enum");
    expect(cls.decorators).toEqual(["Deprecated"]);
    expect(cls.superclass).toBe("Parent");
    expect(cls.interfaces).toEqual(["Comparable", "Serializable"]);
    expect(cls.typedPropertyNames).toEqual(["label"]);
  });
});
