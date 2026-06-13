import { describe, it, expect } from "vitest";
import { validateRuleConfig, detectFrameworks, mapAnnotationsToEdges, runRuleEngine } from "./rule-engine.js";

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

describe("runRuleEngine (full pipeline)", () => {
  it("produces edges from annotations, resolves meta-annotations, resolves call graph", () => {
    const extractionResults = [
      {
        path: "src/OrderServiceImpl.java",
        classes: [{
          name: "OrderServiceImpl",
          lineRange: [1, 30] as [number, number],
          methods: ["processOrder"],
          properties: [],
          annotations: [{ name: "MyService" }],
          interfaces: ["OrderService"],
          typedProperties: [{ name: "userClient", type: "UserClient", annotations: [{ name: "Autowired" }] }],
        }],
        functions: [{ name: "processOrder", lineRange: [10, 20] as [number, number] }],
        callGraph: [{ caller: "processOrder", callee: "userClient.getUser", lineNumber: 15 }],
        imports: [{ source: "./UserClient", specifiers: ["UserClient"] }],
        exports: [],
      },
      {
        path: "src/MyService.java",
        classes: [{
          name: "MyService",
          lineRange: [1, 5] as [number, number],
          methods: [],
          properties: [],
          annotations: [{ name: "Service" }],
        }],
        functions: [],
        callGraph: [],
        imports: [],
        exports: [],
      },
      {
        path: "src/Service.java",
        classes: [{
          name: "Service",
          lineRange: [1, 3] as [number, number],
          methods: [],
          properties: [],
          annotations: [{ name: "Component" }],
        }],
        functions: [],
        callGraph: [],
        imports: [],
        exports: [],
      },
      {
        path: "src/UserClient.java",
        classes: [{
          name: "UserClient",
          lineRange: [1, 10] as [number, number],
          methods: ["getUser"],
          properties: [],
          interfaces: ["UserLookup"],
        }],
        functions: [{ name: "getUser", lineRange: [5, 8] as [number, number] }],
        callGraph: [],
        imports: [],
        exports: [],
      },
    ];
    const result = runRuleEngine(extractionResults, { frameworks: ["spring"], packageJson: {} });

    // Meta-annotation: MyService -> Service -> Component
    expect(result.stats.metaAnnotationsExpanded).toBeGreaterThan(0);

    // DI edge from @Autowired
    expect(result.edges.some((e) => e.type === "injects" && e.source.includes("OrderServiceImpl"))).toBe(true);

    // Call graph resolution
    expect(result.edges.some((e) => e.type === "calls" && e.description.includes("getUser"))).toBe(true);

    // Stats
    expect(result.stats.totalFiles).toBe(4);
    expect(result.stats.edgesProduced).toBeGreaterThan(0);
  });

  it("auto-detects frameworks from packageJson when frameworks array is empty", () => {
    const extractionResults = [{
      path: "src/App.java",
      classes: [{
        name: "App",
        lineRange: [1, 5] as [number, number],
        methods: [],
        properties: [],
        annotations: [],
      }],
      functions: [],
      callGraph: [],
      imports: [],
      exports: [],
    }];
    const result = runRuleEngine(extractionResults, {
      frameworks: [],
      packageJson: { dependencies: { "spring-boot-starter": "3.0.0" } },
    });
    expect(result.stats.frameworkDetected).toContain("spring");
  });
});
