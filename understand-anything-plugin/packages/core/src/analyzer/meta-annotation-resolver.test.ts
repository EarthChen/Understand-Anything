import { describe, it, expect } from "vitest";
import { resolveMetaAnnotations } from "./meta-annotation-resolver.js";

describe("resolveMetaAnnotations", () => {
  it("expands single-level meta-annotation", () => {
    const allClasses = [
      { name: "MyService", annotations: [{ name: "Service" }] },
      { name: "Service", annotations: [{ name: "Component" }] },
    ];
    const expanded = resolveMetaAnnotations("MyService", allClasses);
    expect(expanded.map((a) => a.name).sort()).toEqual(["Component", "Service"]);
  });

  it("expands multi-level meta-annotation chain", () => {
    const allClasses = [
      { name: "MyCustom", annotations: [{ name: "MyService" }] },
      { name: "MyService", annotations: [{ name: "Service" }] },
      { name: "Service", annotations: [{ name: "Component" }] },
      { name: "Component", annotations: [] },
    ];
    const expanded = resolveMetaAnnotations("MyCustom", allClasses);
    expect(expanded.map((a) => a.name).sort()).toEqual(["Component", "MyService", "Service"]);
  });

  it("handles circular references without infinite loop", () => {
    const allClasses = [
      { name: "A", annotations: [{ name: "B" }] },
      { name: "B", annotations: [{ name: "A" }] },
    ];
    const expanded = resolveMetaAnnotations("A", allClasses);
    expect(expanded.map((a) => a.name)).toContain("B");
  });

  it("returns empty for class with no meta-annotations", () => {
    const allClasses = [
      { name: "Plain", annotations: [{ name: "Component" }] },
      { name: "Component", annotations: [] },
    ];
    const expanded = resolveMetaAnnotations("Plain", allClasses);
    expect(expanded).toEqual([]);
  });
});
