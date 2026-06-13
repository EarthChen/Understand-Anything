import { describe, it, expect } from "vitest";
import { validateRuleConfig, detectFrameworks, mapAnnotationsToEdges } from "./rule-engine.js";

describe("validateRuleConfig", () => {
  it("accepts valid config", () => {
    const config = {
      version: 1,
      rules: {
        annotations: {
          MyAnnotation: { edge: "injects", weight: 0.7 },
        },
      },
    };
    expect(() => validateRuleConfig(config)).not.toThrow();
  });

  it("rejects invalid edge type", () => {
    const config = {
      version: 1,
      rules: { annotations: { MyAnnotation: { edge: "invalid_edge_type" } } },
    };
    expect(() => validateRuleConfig(config)).toThrow(/EdgeType/);
  });

  it("rejects weight out of range", () => {
    const config = {
      version: 1,
      rules: { annotations: { MyAnnotation: { edge: "injects", weight: 1.5 } } },
    };
    expect(() => validateRuleConfig(config)).toThrow(/weight/);
  });

  it("rejects missing version", () => {
    const config = { rules: { annotations: {} } };
    expect(() => validateRuleConfig(config)).toThrow(/version/);
  });
});

describe("detectFrameworks", () => {
  it("detects Spring from dependencies", () => {
    const frameworks = detectFrameworks(["spring-boot-starter", "spring-context", "junit"]);
    expect(frameworks).toContain("spring");
  });

  it("detects React from dependencies", () => {
    const frameworks = detectFrameworks(["react", "react-dom", "typescript"]);
    expect(frameworks).toContain("react");
  });

  it("returns empty for unknown dependencies", () => {
    const frameworks = detectFrameworks(["lodash", "express"]);
    expect(frameworks).toEqual([]);
  });
});

describe("mapAnnotationsToEdges", () => {
  it("maps @Autowired to injects edge", () => {
    const fileResult = {
      path: "src/MyService.java",
      classes: [{
        name: "MyService",
        lineRange: [1, 10] as [number, number],
        methods: [],
        properties: [],
        typedProperties: [{
          name: "userRepository",
          type: "UserRepository",
          annotations: [{ name: "Autowired" }],
        }],
        annotations: [],
      }],
      functions: [],
      imports: [],
      exports: [],
    };
    const result = mapAnnotationsToEdges([fileResult], { frameworks: ["spring"] });
    expect(result.edges).toHaveLength(1);
    expect(result.edges[0].type).toBe("injects");
    expect(result.edges[0].source).toContain("MyService");
  });

  it("maps @DubboService + implements to provides_rpc edge", () => {
    const fileResult = {
      path: "src/UserServiceImpl.java",
      classes: [{
        name: "UserServiceImpl",
        lineRange: [1, 20] as [number, number],
        methods: [],
        properties: [],
        annotations: [{ name: "DubboService" }],
        interfaces: ["UserService"],
      }],
      functions: [],
      imports: [],
      exports: [],
    };
    const result = mapAnnotationsToEdges([fileResult], { frameworks: ["dubbo"] });
    expect(result.edges.some((e) => e.type === "provides_rpc")).toBe(true);
  });

  it("collects unresolved annotations", () => {
    const fileResult = {
      path: "src/Unknown.java",
      classes: [{
        name: "Unknown",
        lineRange: [1, 5] as [number, number],
        methods: [],
        properties: [],
        annotations: [{ name: "SomeCustomThing" }],
      }],
      functions: [],
      imports: [],
      exports: [],
    };
    const result = mapAnnotationsToEdges([fileResult], { frameworks: [] });
    expect(result.unresolved).toHaveLength(1);
    expect(result.unresolved[0].annotation).toBe("SomeCustomThing");
  });
});
