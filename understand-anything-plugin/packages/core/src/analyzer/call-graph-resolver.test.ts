import { describe, it, expect } from "vitest";
import { resolveCallGraph, type FileExtraction } from "./call-graph-resolver.js";

describe("resolveCallGraph", () => {
  it("resolves simple function call via import", () => {
    const files: FileExtraction[] = [
      {
        path: "src/a.ts",
        functions: [{ name: "caller", lineRange: [1, 5] }],
        callGraph: [{ caller: "caller", callee: "helper", lineNumber: 3 }],
        imports: [{ source: "./b", specifiers: ["helper"] }],
        classes: [],
      },
      {
        path: "src/b.ts",
        functions: [{ name: "helper", lineRange: [1, 3] }],
        callGraph: [],
        imports: [],
        classes: [],
      },
    ];
    const result = resolveCallGraph(files);
    expect(result.edges).toHaveLength(1);
    expect(result.edges[0].calleeFile).toBe("src/b.ts");
    expect(result.edges[0].calleeFunc).toBe("helper");
  });

  it("resolves method call via type lookup", () => {
    const files: FileExtraction[] = [
      {
        path: "src/controller.ts",
        functions: [{ name: "handle", lineRange: [1, 10] }],
        callGraph: [{ caller: "handle", callee: "service.process", lineNumber: 5 }],
        imports: [{ source: "./service", specifiers: ["MyService"] }],
        classes: [{
          name: "Controller",
          lineRange: [1, 10],
          methods: ["handle"],
          properties: [],
          typedProperties: [{ name: "service", type: "MyService" }],
        }],
      },
      {
        path: "src/service.ts",
        functions: [],
        callGraph: [],
        imports: [],
        classes: [{
          name: "MyService",
          lineRange: [1, 10],
          methods: ["process"],
          properties: [],
        }],
      },
    ];
    const result = resolveCallGraph(files);
    expect(result.edges.some((e) => e.calleeFile === "src/service.ts" && e.calleeFunc === "process")).toBe(true);
  });

  it("prefers resolved owner metadata over ambiguous short method names", () => {
    const files: FileExtraction[] = [
      {
        path: "lib/user_controller.dart",
        functions: [],
        callGraph: [{
          caller: "load",
          callee: "api.fetch",
          lineNumber: 8,
          callerQualifiedName: "UserController#load",
          calleeOwner: "UserApi",
          calleeQualifiedName: "UserApi#fetch",
        }],
        imports: [],
        classes: [{
          name: "UserController",
          lineRange: [1, 12],
          methods: ["load"],
          properties: [],
        }],
      },
      {
        path: "lib/audit_api.dart",
        functions: [],
        callGraph: [],
        imports: [],
        classes: [{
          name: "AuditApi",
          lineRange: [1, 5],
          methods: ["fetch"],
          properties: [],
        }],
      },
      {
        path: "lib/user_api.dart",
        functions: [],
        callGraph: [],
        imports: [],
        classes: [{
          name: "UserApi",
          lineRange: [1, 5],
          methods: ["fetch"],
          properties: [],
        }],
      },
    ];

    const result = resolveCallGraph(files);

    expect(result.unresolved).toHaveLength(0);
    expect(result.edges).toEqual([
      expect.objectContaining({
        callerFile: "lib/user_controller.dart",
        callerFunc: "load",
        calleeFile: "lib/user_api.dart",
        calleeFunc: "fetch",
        lineNumber: 8,
      }),
    ]);
  });

  it("marks unresolvable calls as unresolved", () => {
    const files: FileExtraction[] = [
      {
        path: "src/a.ts",
        functions: [{ name: "caller", lineRange: [1, 5] }],
        callGraph: [{ caller: "caller", callee: "unknownFunc", lineNumber: 3 }],
        imports: [],
        classes: [],
      },
    ];
    const result = resolveCallGraph(files);
    expect(result.unresolved).toHaveLength(1);
    expect(result.unresolved[0].callee).toBe("unknownFunc");
  });
});
