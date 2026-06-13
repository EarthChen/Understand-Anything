# Three-Layer Analysis Architecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a three-layer analysis architecture that moves deterministic work (annotation→edge mapping, call graph resolution, meta-annotation tracking) from LLM agents to tree-sitter + a configurable rule engine, leaving LLM only for semantic analysis.

**Architecture:** Layer 1 (tree-sitter) enhanced with TS extractor improvements → Layer 2 (rule engine) processes extraction results deterministically → Layer 3 (LLM) narrowed to semantic-only tasks. Pipeline shifts to full-mode extraction before batch splitting.

**Tech Stack:** TypeScript, Vitest, tree-sitter (web-tree-sitter WASM), pnpm monorepo

**Spec:** `.claude/spec/giggly-chasing-fox.md`

---

## File Structure

| File | Role | Status |
|------|------|--------|
| `packages/core/src/analyzer/graph-traversal.ts` | Generic BFS engine | Create |
| `packages/core/src/analyzer/graph-traversal.test.ts` | BFS tests | Create |
| `packages/core/src/plugins/extractors/typescript-extractor.ts` | TS/JS structural extraction | Modify |
| `packages/core/src/plugins/extractors/typescript-extractor.test.ts` | TS extractor tests | Create |
| `packages/core/src/analyzer/rule-engine.ts` | Rule engine core + framework detection + annotation mapping | Create |
| `packages/core/src/analyzer/rule-engine.test.ts` | Rule engine tests | Create |
| `packages/core/src/analyzer/meta-annotation-resolver.ts` | Meta-annotation recursive tracking (JVM only) | Create |
| `packages/core/src/analyzer/meta-annotation-resolver.test.ts` | Meta-annotation tests | Create |
| `packages/core/src/analyzer/call-graph-resolver.ts` | Deterministic cross-file call resolution | Create |
| `packages/core/src/analyzer/call-graph-resolver.test.ts` | Call graph resolver tests | Create |
| `packages/core/src/analyzer/fqn-builder.ts` | FQN construction per language | Create |
| `packages/core/src/analyzer/fqn-builder.test.ts` | FQN builder tests | Create |
| `packages/core/src/analyzer/rule-engine-postprocess.ts` | CLI script for existing graphs | Create |
| `packages/core/src/fingerprint.ts` | Add interface/enum/decorator signatures | Modify |
| `packages/core/src/fingerprint.test.ts` | Fingerprint tests | Modify |
| `src/diff-analyzer.ts` | Upgrade to multi-hop BFS | Modify |
| `skills/understand/extract-structure.mjs` | Full-mode extraction | Modify |
| `skills/understand/merge-batch-graphs.py` | Read global extraction results | Modify |
| `agents/file-analyzer.md` | Remove annotation mapping, add ruleEngineEdges | Modify |

---

## Task 1: Graph Traversal BFS Engine

**Files:**
- Create: `understand-anything-plugin/packages/core/src/analyzer/graph-traversal.ts`
- Create: `understand-anything-plugin/packages/core/src/analyzer/graph-traversal.test.ts`

Extract the BFS engine from `packages/dashboard/src/api/handlers/graph-query.ts:107-161` into a reusable core module.

- [ ] **Step 1: Write failing tests for graph-traversal**

```typescript
// packages/core/src/analyzer/graph-traversal.test.ts
import { describe, it, expect } from "vitest";
import { traverseNeighbors } from "./graph-traversal.js";
import type { KnowledgeGraph, GraphNode, GraphEdge } from "../types.js";

function makeGraph(nodes: string[], edges: Array<[string, string, string]>): KnowledgeGraph {
  return {
    project: { name: "test", language: "ts" },
    nodes: nodes.map((id) => ({ id, type: "function", name: id, summary: "", tags: [], complexity: "simple" })),
    edges: edges.map(([source, target, type]) => ({
      source, target, type: type as any, direction: "forward" as const, weight: 0.8, description: "",
    })),
    layers: [],
    domains: [],
    tours: [],
  };
}

describe("traverseNeighbors", () => {
  it("finds direct neighbors (depth 1)", () => {
    const graph = makeGraph(["A", "B", "C"], [["A", "B", "calls"], ["B", "C", "calls"]]);
    const results = traverseNeighbors(graph, ["A"], "outbound", ["calls"], 1);
    expect(results.map((r) => r.nodeId)).toEqual(["B"]);
    expect(results[0].depth).toBe(1);
  });

  it("finds transitive neighbors (depth 2)", () => {
    const graph = makeGraph(["A", "B", "C"], [["A", "B", "calls"], ["B", "C", "calls"]]);
    const results = traverseNeighbors(graph, ["A"], "outbound", ["calls"], 2);
    expect(results.map((r) => r.nodeId)).toEqual(["B", "C"]);
    expect(results.find((r) => r.nodeId === "C")!.depth).toBe(2);
  });

  it("handles cycles without infinite loop", () => {
    const graph = makeGraph(["A", "B"], [["A", "B", "calls"], ["B", "A", "calls"]]);
    const results = traverseNeighbors(graph, ["A"], "outbound", ["calls"], 5);
    expect(results.map((r) => r.nodeId)).toEqual(["B"]);
  });

  it("filters by edge type", () => {
    const graph = makeGraph(["A", "B", "C"], [["A", "B", "calls"], ["A", "C", "injects"]]);
    const results = traverseNeighbors(graph, ["A"], "outbound", ["calls"], 1);
    expect(results.map((r) => r.nodeId)).toEqual(["B"]);
  });

  it("supports multiple edge types", () => {
    const graph = makeGraph(["A", "B", "C"], [["A", "B", "calls"], ["A", "C", "injects"]]);
    const results = traverseNeighbors(graph, ["A"], "outbound", ["calls", "injects"], 1);
    expect(results.map((r) => r.nodeId).sort()).toEqual(["B", "C"]);
  });

  it("supports inbound direction", () => {
    const graph = makeGraph(["A", "B", "C"], [["B", "A", "calls"], ["C", "A", "calls"]]);
    const results = traverseNeighbors(graph, ["A"], "inbound", ["calls"], 1);
    expect(results.map((r) => r.nodeId).sort()).toEqual(["B", "C"]);
  });

  it("supports both direction", () => {
    const graph = makeGraph(["A", "B", "C"], [["A", "B", "calls"], ["C", "A", "calls"]]);
    const results = traverseNeighbors(graph, ["A"], "both", ["calls"], 1);
    expect(results.map((r) => r.nodeId).sort()).toEqual(["B", "C"]);
  });

  it("returns empty for isolated node", () => {
    const graph = makeGraph(["A", "B"], []);
    const results = traverseNeighbors(graph, ["A"], "both", ["calls"], 3);
    expect(results).toEqual([]);
  });

  it("handles multiple center nodes", () => {
    const graph = makeGraph(["A", "B", "C"], [["A", "C", "calls"], ["B", "C", "calls"]]);
    const results = traverseNeighbors(graph, ["A", "B"], "outbound", ["calls"], 1);
    expect(results.map((r) => r.nodeId)).toEqual(["C"]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @understand-anything/core test -- --run packages/core/src/analyzer/graph-traversal.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement graph-traversal.ts**

```typescript
// packages/core/src/analyzer/graph-traversal.ts
import type { KnowledgeGraph } from "../types.js";

export interface TraversalResult {
  nodeId: string;
  depth: number;
  edge: { source: string; target: string; type: string };
}

export function traverseNeighbors(
  graph: KnowledgeGraph,
  centerIds: string[],
  direction: "inbound" | "outbound" | "both",
  edgeTypes: string[],
  maxDepth: number,
): TraversalResult[] {
  const edgeTypeSet = new Set(edgeTypes);
  const centerSet = new Set(centerIds);
  const results: TraversalResult[] = [];
  const expanded = new Set<string>(centerIds);
  let frontier = [...centerIds];

  for (let depth = 1; depth <= maxDepth; depth++) {
    const nextFrontier: string[] = [];
    for (const currentId of frontier) {
      for (const edge of graph.edges) {
        if (!edgeTypeSet.has(edge.type)) continue;

        let neighborId: string | null = null;

        if (edge.source === currentId && direction !== "inbound") {
          neighborId = edge.target;
        } else if (edge.target === currentId && direction !== "outbound") {
          neighborId = edge.source;
        }

        if (!neighborId || centerSet.has(neighborId)) continue;

        results.push({
          nodeId: neighborId,
          depth,
          edge: { source: edge.source, target: edge.target, type: edge.type },
        });

        if (!expanded.has(neighborId)) {
          expanded.add(neighborId);
          nextFrontier.push(neighborId);
        }
      }
    }
    frontier = nextFrontier;
  }

  return results;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @understand-anything/core test -- --run packages/core/src/analyzer/graph-traversal.test.ts`
Expected: All 9 tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/analyzer/graph-traversal.ts packages/core/src/analyzer/graph-traversal.test.ts
git commit -m "feat: add generic BFS graph traversal engine to core"
```

---

## Task 2: Diff Analyzer Multi-Hop Upgrade

**Files:**
- Modify: `understand-anything-plugin/src/diff-analyzer.ts`

Depends on: Task 1

- [ ] **Step 1: Write failing test for multi-hop diff analysis**

```typescript
// Add to an existing test file or create src/diff-analyzer.test.ts
import { describe, it, expect } from "vitest";
import { buildDiffContext } from "./diff-analyzer.js";
import type { KnowledgeGraph } from "@understand-anything/core/types";

describe("buildDiffContext multi-hop", () => {
  it("finds affected nodes at depth 2", () => {
    const graph: KnowledgeGraph = {
      project: { name: "test", language: "ts" },
      nodes: [
        { id: "file:A.ts", type: "file", name: "A.ts", summary: "", tags: [], complexity: "simple", filePath: "A.ts" },
        { id: "fn:A.foo", type: "function", name: "foo", summary: "", tags: [], complexity: "simple" },
        { id: "fn:B.bar", type: "function", name: "bar", summary: "", tags: [], complexity: "simple" },
        { id: "fn:C.baz", type: "function", name: "baz", summary: "", tags: [], complexity: "simple" },
      ],
      edges: [
        { source: "file:A.ts", target: "fn:A.foo", type: "contains", direction: "forward", weight: 1, description: "" },
        { source: "fn:A.foo", target: "fn:B.bar", type: "calls", direction: "forward", weight: 0.8, description: "" },
        { source: "fn:B.bar", target: "fn:C.baz", type: "calls", direction: "forward", weight: 0.8, description: "" },
      ],
      layers: [],
      domains: [],
      tours: [],
    };
    const ctx = buildDiffContext(graph, ["A.ts"], { maxDepth: 2 });
    expect(ctx.affectedNodes.map((n) => n.id).sort()).toEqual(["fn:B.bar", "fn:C.baz"]);
  });

  it("respects maxDepth=1 (backward compatible)", () => {
    const graph: KnowledgeGraph = {
      project: { name: "test", language: "ts" },
      nodes: [
        { id: "file:A.ts", type: "file", name: "A.ts", summary: "", tags: [], complexity: "simple", filePath: "A.ts" },
        { id: "fn:A.foo", type: "function", name: "foo", summary: "", tags: [], complexity: "simple" },
        { id: "fn:B.bar", type: "function", name: "bar", summary: "", tags: [], complexity: "simple" },
        { id: "fn:C.baz", type: "function", name: "baz", summary: "", tags: [], complexity: "simple" },
      ],
      edges: [
        { source: "file:A.ts", target: "fn:A.foo", type: "contains", direction: "forward", weight: 1, description: "" },
        { source: "fn:A.foo", target: "fn:B.bar", type: "calls", direction: "forward", weight: 0.8, description: "" },
        { source: "fn:B.bar", target: "fn:C.baz", type: "calls", direction: "forward", weight: 0.8, description: "" },
      ],
      layers: [],
      domains: [],
      tours: [],
    };
    const ctx = buildDiffContext(graph, ["A.ts"], { maxDepth: 1 });
    expect(ctx.affectedNodes.map((n) => n.id)).toEqual(["fn:B.bar"]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- --run src/diff-analyzer.test.ts`
Expected: FAIL — `buildDiffContext` doesn't accept options parameter

- [ ] **Step 3: Implement multi-hop BFS in diff-analyzer**

Modify `buildDiffContext()` to accept an optional `options` parameter with `maxDepth` (default 1 for backward compatibility). Replace the single-hop edge scan with a call to `traverseNeighbors()` from Task 1.

Key changes:
- Add `options?: { maxDepth?: number }` parameter
- Import `traverseNeighbors` from `@understand-anything/core/analyzer/graph-traversal`
- Replace the 1-hop loop (lines 54-69) with `traverseNeighbors(graph, [...changedNodeIds], "both", undefined, maxDepth)`
- Map results to `affectedNodeIds` and `impactedEdges`
- Add `depth` field to `DiffContext.affectedNodes` entries

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- --run src/diff-analyzer.test.ts`
Expected: All tests PASS (including existing tests + new multi-hop tests)

- [ ] **Step 5: Commit**

```bash
git add src/diff-analyzer.ts src/diff-analyzer.test.ts
git commit -m "feat: upgrade diff-analyzer to multi-hop BFS traversal"
```

---

## Task 3: TypeScript Extractor — Interface, Enum, Type Alias

**Files:**
- Modify: `understand-anything-plugin/packages/core/src/plugins/extractors/typescript-extractor.ts`
- Create: `understand-anything-plugin/packages/core/src/plugins/extractors/typescript-extractor.test.ts`

- [ ] **Step 1: Write failing tests for interface extraction**

```typescript
// packages/core/src/plugins/extractors/typescript-extractor.test.ts
import { describe, it, expect } from "vitest";
import { TypeScriptExtractor } from "./typescript-extractor.js";

const extractor = new TypeScriptExtractor();

describe("TypeScriptExtractor interface extraction", () => {
  it("extracts interface with methods and properties", () => {
    const code = `
interface UserService {
  getUser(id: string): User;
  name: string;
  age: number;
}`;
    const result = extractor.extract(code, "test.ts");
    expect(result.classes).toHaveLength(1);
    expect(result.classes[0].name).toBe("UserService");
    expect(result.classes[0].kind).toBe("interface");
    expect(result.classes[0].methods).toContain("getUser");
    expect(result.classes[0].properties).toEqual(expect.arrayContaining(["name", "age"]));
  });

  it("extracts interface with extends", () => {
    const code = `
interface AdminService extends UserService {
  grantPermission(perm: string): void;
}`;
    const result = extractor.extract(code, "test.ts");
    expect(result.classes[0].kind).toBe("interface");
    expect(result.classes[0].interfaces).toContain("UserService");
  });

  it("extracts exported interface", () => {
    const code = `export interface PublicAPI { query(): void; }`;
    const result = extractor.extract(code, "test.ts");
    expect(result.classes).toHaveLength(1);
    expect(result.exports.some((e) => e.name === "PublicAPI")).toBe(true);
  });
});

describe("TypeScriptExtractor enum extraction", () => {
  it("extracts enum with members", () => {
    const code = `
enum Status {
  Active,
  Inactive,
  Pending,
}`;
    const result = extractor.extract(code, "test.ts");
    expect(result.classes).toHaveLength(1);
    expect(result.classes[0].name).toBe("Status");
    expect(result.classes[0].kind).toBe("enum");
    expect(result.classes[0].properties).toEqual(expect.arrayContaining(["Active", "Inactive", "Pending"]));
  });

  it("extracts exported enum", () => {
    const code = `export enum Color { Red, Green, Blue }`;
    const result = extractor.extract(code, "test.ts");
    expect(result.classes[0].kind).toBe("enum");
    expect(result.exports.some((e) => e.name === "Color")).toBe(true);
  });
});

describe("TypeScriptExtractor type alias extraction", () => {
  it("extracts type alias", () => {
    const code = `type UserID = string | number;`;
    const result = extractor.extract(code, "test.ts");
    expect(result.classes).toHaveLength(1);
    expect(result.classes[0].name).toBe("UserID");
    expect(result.classes[0].kind).toBe("type");
  });

  it("extracts exported type alias", () => {
    const code = `export type Callback = (err: Error | null) => void;`;
    const result = extractor.extract(code, "test.ts");
    expect(result.classes[0].kind).toBe("type");
    expect(result.exports.some((e) => e.name === "Callback")).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @understand-anything/core test -- --run packages/core/src/plugins/extractors/typescript-extractor.test.ts`
Expected: FAIL — interface/enum/type not extracted

- [ ] **Step 3: Implement interface extraction**

In `processTopLevelNode()`, add cases:
```typescript
case "interface_declaration":
  this.extractInterface(node, classes);
  break;
case "enum_declaration":
  this.extractEnum(node, classes);
  break;
case "type_alias_declaration":
  this.extractTypeAlias(node, classes);
  break;
```

Implement `extractInterface()`: read name from `type_identifier`, iterate body for `method_signature` → `methods[]` and `property_signature` → `typedProperties[]`, check `extends_type_clause` → `interfaces[]`, push with `kind: "interface"`.

Implement `extractEnum()`: read name, iterate `enum_body` for members → `properties[]`, push with `kind: "enum"`.

Implement `extractTypeAlias()`: read name, push with `kind: "type"` and line range only.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @understand-anything/core test -- --run packages/core/src/plugins/extractors/typescript-extractor.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/plugins/extractors/typescript-extractor.ts packages/core/src/plugins/extractors/typescript-extractor.test.ts
git commit -m "feat: add interface/enum/type alias extraction to TS extractor"
```

---

## Task 4: TypeScript Extractor — Decorators, Heritage, Class Members

**Files:**
- Modify: `understand-anything-plugin/packages/core/src/plugins/extractors/typescript-extractor.ts`
- Modify: `understand-anything-plugin/packages/core/src/plugins/extractors/typescript-extractor.test.ts`

Depends on: Task 3

- [ ] **Step 1: Write failing tests**

```typescript
describe("TypeScriptExtractor decorator extraction", () => {
  it("extracts class decorators", () => {
    const code = `
@Component({ selector: 'app-root' })
class App {}
`;
    const result = extractor.extract(code, "test.ts");
    expect(result.classes[0].annotations).toBeDefined();
    expect(result.classes[0].annotations![0].name).toBe("Component");
    expect(result.classes[0].annotations![0].arguments).toEqual({ selector: "app-root" });
  });

  it("extracts method decorators", () => {
    const code = `
class Controller {
  @Get('/api')
  handle() {}
}`;
    const result = extractor.extract(code, "test.ts");
    expect(result.classes[0].methods).toContain("handle");
  });
});

describe("TypeScriptExtractor heritage extraction", () => {
  it("extracts extends", () => {
    const code = `class AdminService extends BaseService { }`;
    const result = extractor.extract(code, "test.ts");
    expect(result.classes[0].superclass).toBe("BaseService");
  });

  it("extracts implements", () => {
    const code = `class MyService implements Service, Serializable { }`;
    const result = extractor.extract(code, "test.ts");
    expect(result.classes[0].interfaces).toEqual(expect.arrayContaining(["Service", "Serializable"]));
  });
});

describe("TypeScriptExtractor typed properties", () => {
  it("extracts typed class fields", () => {
    const code = `
class User {
  name: string;
  age: number;
}`;
    const result = extractor.extract(code, "test.ts");
    expect(result.classes[0].typedProperties).toBeDefined();
    expect(result.classes[0].typedProperties!.map((p) => p.name)).toEqual(expect.arrayContaining(["name", "age"]));
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @understand-anything/core test -- --run packages/core/src/plugins/extractors/typescript-extractor.test.ts`
Expected: FAIL — decorators/heritage/typedProperties not extracted

- [ ] **Step 3: Implement decorator extraction, heritage, typed properties**

Add `extractDecorators()` helper (reference Java's `extractAnnotations()` pattern at java-extractor.ts:91-127):
- Walk node's children for `decorator` type
- Extract name from `identifier` or `member_expression`
- For `call_expression` decorators, extract arguments
- Return `AnnotationInfo[]`

Modify `extractClass()`:
- Call `extractDecorators(node)` → `annotations`
- Find `class_heritage` child → extract `extends` → `superclass`, `implements` → `interfaces[]`
- For `public_field_definition`/`property_definition` in class body → extract type annotation → `typedProperties[]`
- Attach decorators to methods/properties

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @understand-anything/core test -- --run packages/core/src/plugins/extractors/typescript-extractor.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/plugins/extractors/typescript-extractor.ts packages/core/src/plugins/extractors/typescript-extractor.test.ts
git commit -m "feat: add decorator/heritage/typedProperties extraction to TS extractor"
```

---

## Task 5: TypeScript Extractor — CommonJS and Export Extensions

**Files:**
- Modify: `understand-anything-plugin/packages/core/src/plugins/extractors/typescript-extractor.ts`
- Modify: `understand-anything-plugin/packages/core/src/plugins/extractors/typescript-extractor.test.ts`

Depends on: Task 4

- [ ] **Step 1: Write failing tests**

```typescript
describe("TypeScriptExtractor CommonJS support", () => {
  it("detects require() as import", () => {
    const code = `const fs = require('fs');`;
    const result = extractor.extract(code, "test.ts");
    expect(result.imports).toHaveLength(1);
    expect(result.imports[0].source).toBe("fs");
  });

  it("detects module.exports as export", () => {
    const code = `module.exports = { foo: 1 };`;
    const result = extractor.extract(code, "test.ts");
    expect(result.exports.length).toBeGreaterThan(0);
  });
});

describe("TypeScriptExtractor export extensions", () => {
  it("handles export interface", () => {
    const code = `export interface API { query(): void; }`;
    const result = extractor.extract(code, "test.ts");
    expect(result.classes).toHaveLength(1);
    expect(result.exports.some((e) => e.name === "API")).toBe(true);
  });

  it("handles export enum", () => {
    const code = `export enum Dir { Up, Down }`;
    const result = extractor.extract(code, "test.ts");
    expect(result.classes[0].kind).toBe("enum");
    expect(result.exports.some((e) => e.name === "Dir")).toBe(true);
  });

  it("handles export type", () => {
    const code = `export type ID = string;`;
    const result = extractor.extract(code, "test.ts");
    expect(result.classes[0].kind).toBe("type");
    expect(result.exports.some((e) => e.name === "ID")).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @understand-anything/core test -- --run packages/core/src/plugins/extractors/typescript-extractor.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement CommonJS and export extensions**

CommonJS support:
- In `processTopLevelNode()`, for `variable_declaration`/`lexical_declaration`, detect `require()` call in initializer → add to `imports[]`
- In `expression_statement`, detect `module.exports = ...` or `exports.foo = ...` → add to `exports[]`

Export extensions:
- In `processExportStatement()`, add cases for `interface_declaration`, `enum_declaration`, `type_alias_declaration` in the child type switch

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @understand-anything/core test -- --run packages/core/src/plugins/extractors/typescript-extractor.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/plugins/extractors/typescript-extractor.ts packages/core/src/plugins/extractors/typescript-extractor.test.ts
git commit -m "feat: add CommonJS support and export interface/enum/type to TS extractor"
```

---

## Task 6: FQN Builder

**Files:**
- Create: `understand-anything-plugin/packages/core/src/analyzer/fqn-builder.ts`
- Create: `understand-anything-plugin/packages/core/src/analyzer/fqn-builder.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// packages/core/src/analyzer/fqn-builder.test.ts
import { describe, it, expect } from "vitest";
import { buildFQN, type ExtractionResult } from "./fqn-builder.js";

describe("buildFQN", () => {
  it("builds FQN from Java package declaration", () => {
    const result = buildFQN({
      language: "java",
      filePath: "src/main/java/com/example/service/UserService.java",
      packageName: "com.example.service",
      className: "UserServiceImpl",
    });
    expect(result).toBe("com.example.service.UserServiceImpl");
  });

  it("builds FQN from file path when no package declaration", () => {
    const result = buildFQN({
      language: "java",
      filePath: "src/com/example/service/UserService.java",
      className: "UserService",
    });
    expect(result).toBe("com.example.service.UserService");
  });

  it("builds FQN for TypeScript from import path", () => {
    const result = buildFQN({
      language: "typescript",
      filePath: "src/services/user-service.ts",
      className: "UserService",
      projectRoot: "/project",
    });
    expect(result).toBe("src/services/user-service.UserService");
  });

  it("returns short name when no path info available", () => {
    const result = buildFQN({
      language: "typescript",
      filePath: "unknown.ts",
      className: "MyClass",
    });
    expect(result).toBe("MyClass");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @understand-anything/core test -- --run packages/core/src/analyzer/fqn-builder.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement fqn-builder.ts**

```typescript
// packages/core/src/analyzer/fqn-builder.ts
export interface FQNInput {
  language: string;
  filePath: string;
  packageName?: string;
  className: string;
  projectRoot?: string;
}

export function buildFQN(input: FQNInput): string {
  const { language, filePath, packageName, className } = input;

  // Java/Kotlin: package declaration is authoritative
  if (packageName && (language === "java" || language === "kotlin")) {
    return `${packageName}.${className}`;
  }

  // Java/Kotlin fallback: derive from file path
  if (language === "java" || language === "kotlin") {
    const match = filePath.match(/(?:src\/(?:main\/)?(?:java|kotlin)\/)(.+)\//);
    if (match) {
      return `${match[1].replace(/\//g, ".")}.${className}`;
    }
  }

  // Dart: library declaration or import path
  if (language === "dart" && packageName) {
    return `${packageName}.${className}`;
  }

  // TypeScript/JavaScript: use file path
  if (language === "typescript" || language === "javascript") {
    const normalized = filePath.replace(/\.(ts|tsx|js|jsx)$/, "").replace(/\/index$/, "");
    return `${normalized}.${className}`;
  }

  // Swift: module.type
  if (language === "swift") {
    const module = filePath.split("/")[0] || "main";
    return `${module}.${className}`;
  }

  // ObjC: from #import path
  if (language === "objc" || language === "objectivec") {
    const normalized = filePath.replace(/\.(h|m|mm)$/, "").replace(/\//g, ".");
    return `${normalized}.${className}`;
  }

  // C/C++: namespace + class or file path
  if (language === "cpp" || language === "c") {
    if (packageName) return `${packageName}::${className}`;
    const normalized = filePath.replace(/\.(cpp|cc|c|h|hpp)$/, "").replace(/\//g, "::");
    return `${normalized}::${className}`;
  }

  // Fallback: short name
  return className;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @understand-anything/core test -- --run packages/core/src/analyzer/fqn-builder.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/analyzer/fqn-builder.ts packages/core/src/analyzer/fqn-builder.test.ts
git commit -m "feat: add multi-language FQN builder for cross-service linking"
```

---

## Task 7: Rule Engine Core — Types, Config Validation, Framework Detection

**Files:**
- Create: `understand-anything-plugin/packages/core/src/analyzer/rule-engine.ts`
- Create: `understand-anything-plugin/packages/core/src/analyzer/rule-engine.test.ts`

- [ ] **Step 1: Write failing tests for config validation**

```typescript
// packages/core/src/analyzer/rule-engine.test.ts
import { describe, it, expect } from "vitest";
import { validateRuleConfig, detectFrameworks, type RuleConfig } from "./rule-engine.js";

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
      rules: {
        annotations: {
          MyAnnotation: { edge: "invalid_edge_type" },
        },
      },
    };
    expect(() => validateRuleConfig(config)).toThrow(/EdgeType/);
  });

  it("rejects weight out of range", () => {
    const config = {
      version: 1,
      rules: {
        annotations: {
          MyAnnotation: { edge: "injects", weight: 1.5 },
        },
      },
    };
    expect(() => validateRuleConfig(config)).toThrow(/weight/);
  });

  it("rejects missing version", () => {
    const config = { rules: { annotations: {} } };
    expect(() => validateRuleConfig(config)).toThrow(/version/);
  });
});

describe("detectFrameworks", () => {
  it("detects Spring from pom.xml dependencies", () => {
    const deps = ["spring-boot-starter", "spring-context", "junit"];
    const frameworks = detectFrameworks(deps);
    expect(frameworks).toContain("spring");
  });

  it("detects React from package.json dependencies", () => {
    const deps = ["react", "react-dom", "typescript"];
    const frameworks = detectFrameworks(deps);
    expect(frameworks).toContain("react");
  });

  it("returns empty for unknown dependencies", () => {
    const frameworks = detectFrameworks(["lodash", "express"]);
    expect(frameworks).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @understand-anything/core test -- --run packages/core/src/analyzer/rule-engine.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement rule engine types and config validation**

Create `rule-engine.ts` with:
- `FrameworkRule`, `EdgeMapping`, `ConfigBinding` interfaces (from spec)
- `RuleConfig` interface with `version` and `rules` fields
- `validateRuleConfig()` — checks version, edge types against known EdgeType list, weight range [0,1], role values
- `detectFrameworks(dependencies: string[])` — maps dependency names to framework IDs using `detectionKeywords` from built-in rules
- Built-in framework rules registry (Java/Kotlin Spring, Dubbo, MOA, Feign, gRPC, Kafka, Retrofit, JAX-RS, plus TS/Dart/Swift/ObjC/C++ rules from spec)

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @understand-anything/core test -- --run packages/core/src/analyzer/rule-engine.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/analyzer/rule-engine.ts packages/core/src/analyzer/rule-engine.test.ts
git commit -m "feat: add rule engine core with config validation and framework detection"
```

---

## Task 8: Rule Engine — Annotation-to-Edge Mapping

**Files:**
- Modify: `understand-anything-plugin/packages/core/src/analyzer/rule-engine.ts`
- Modify: `understand-anything-plugin/packages/core/src/analyzer/rule-engine.test.ts`

Depends on: Task 6, Task 7

- [ ] **Step 1: Write failing tests for annotation mapping**

```typescript
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @understand-anything/core test -- --run packages/core/src/analyzer/rule-engine.test.ts`
Expected: FAIL — `mapAnnotationsToEdges` not found

- [ ] **Step 3: Implement annotation-to-edge mapping**

Add `mapAnnotationsToEdges()` to `rule-engine.ts`:
- Takes `ExtractionResult[]` and `{ frameworks: string[], userRules?: RuleConfig }`
- For each file, for each class:
  - Check class-level annotations against built-in + user rules → produce edges (e.g., `@DubboService` → `provides_rpc`)
  - Check property-level annotations → produce edges (e.g., `@Autowired` → `injects`)
  - Check method-level annotations → produce edges (e.g., `@KafkaListener` → `subscribes`)
  - For RPC providers, use `interfaces[]` to build FQN → create synthetic target node
  - For RPC consumers, use `typedProperties[].type` to build FQN → create synthetic target node
  - Collect unmatched annotations into `unresolved[]`
- Returns `{ edges, unresolved, stats }`

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @understand-anything/core test -- --run packages/core/src/analyzer/rule-engine.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/analyzer/rule-engine.ts packages/core/src/analyzer/rule-engine.test.ts
git commit -m "feat: add annotation-to-edge mapping to rule engine"
```

---

## Task 9: Meta-Annotation Resolver

**Files:**
- Create: `understand-anything-plugin/packages/core/src/analyzer/meta-annotation-resolver.ts`
- Create: `understand-anything-plugin/packages/core/src/analyzer/meta-annotation-resolver.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// packages/core/src/analyzer/meta-annotation-resolver.test.ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @understand-anything/core test -- --run packages/core/src/analyzer/meta-annotation-resolver.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement meta-annotation resolver**

```typescript
// packages/core/src/analyzer/meta-annotation-resolver.ts
import type { AnnotationInfo } from "../types.js";

interface ClassAnnotations {
  name: string;
  annotations: AnnotationInfo[];
}

export function resolveMetaAnnotations(
  className: string,
  allClasses: ClassAnnotations[],
): AnnotationInfo[] {
  const classMap = new Map(allClasses.map((c) => [c.name, c]));
  const target = classMap.get(className);
  if (!target) return [];

  const result: AnnotationInfo[] = [];
  const visited = new Set<string>();

  function resolve(annName: string) {
    if (visited.has(annName)) return;
    visited.add(annName);

    const annClass = classMap.get(annName);
    if (!annClass) return;

    for (const meta of annClass.annotations) {
      result.push(meta);
      resolve(meta.name);
    }
  }

  for (const ann of target.annotations) {
    resolve(ann.name);
  }

  return result;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @understand-anything/core test -- --run packages/core/src/analyzer/meta-annotation-resolver.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/analyzer/meta-annotation-resolver.ts packages/core/src/analyzer/meta-annotation-resolver.test.ts
git commit -m "feat: add meta-annotation recursive resolver for JVM languages"
```

---

## Task 10: Call Graph Resolver

**Files:**
- Create: `understand-anything-plugin/packages/core/src/analyzer/call-graph-resolver.ts`
- Create: `understand-anything-plugin/packages/core/src/analyzer/call-graph-resolver.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// packages/core/src/analyzer/call-graph-resolver.test.ts
import { describe, it, expect } from "vitest";
import { resolveCallGraph, type CallGraphEntry, type FileExtraction } from "./call-graph-resolver.js";

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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @understand-anything/core test -- --run packages/core/src/analyzer/call-graph-resolver.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement call graph resolver**

Add `resolveCallGraph()`:
1. Build global symbol index: `Map<functionName, filePath[]>`
2. Build per-file import map: `Map<localName, sourceFilePath>`
3. For each `CallGraphEntry`:
   - Parse callee: strip `new`, parens
   - If `obj.method()` → try to find `obj` type from class `typedProperties[]` → resolve to `Type.method`
   - Look up import map → find candidate file
   - Look up symbol index → confirm function exists
   - Emit resolved edge or mark as `unresolved`

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @understand-anything/core test -- --run packages/core/src/analyzer/call-graph-resolver.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/analyzer/call-graph-resolver.ts packages/core/src/analyzer/call-graph-resolver.test.ts
git commit -m "feat: add deterministic cross-file call graph resolver"
```

---

## Task 11: Rule Engine — Full Integration

**Files:**
- Modify: `understand-anything-plugin/packages/core/src/analyzer/rule-engine.ts`
- Modify: `understand-anything-plugin/packages/core/src/analyzer/rule-engine.test.ts`

Depends on: Tasks 7, 8, 9, 10

- [ ] **Step 1: Write integration test for full rule engine pipeline**

```typescript
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
        functions: [{ name: "processOrder", lineRange: [10, 20] }],
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
        functions: [{ name: "getUser", lineRange: [5, 8] }],
        callGraph: [],
        imports: [],
        exports: [],
      },
    ];
    const result = runRuleEngine(extractionResults, { frameworks: ["spring"], packageJson: {} });

    // Meta-annotation: MyService → Service → Component
    expect(result.stats.metaAnnotationsExpanded).toBeGreaterThan(0);

    // DI edge from @Autowired
    expect(result.edges.some((e) => e.type === "injects" && e.source.includes("OrderServiceImpl"))).toBe(true);

    // Call graph resolution
    expect(result.edges.some((e) => e.type === "calls" && e.calleeFunc === "getUser")).toBe(true);

    // Stats
    expect(result.stats.totalFiles).toBe(4);
    expect(result.stats.edgesProduced).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @understand-anything/core test -- --run packages/core/src/analyzer/rule-engine.test.ts`
Expected: FAIL — `runRuleEngine` not found

- [ ] **Step 3: Implement runRuleEngine() orchestrator**

Add `runRuleEngine()` to `rule-engine.ts`:
1. Call `detectFrameworks()` from package.json dependencies
2. Call `mapAnnotationsToEdges()` for per-file annotation mapping
3. Call `resolveMetaAnnotations()` globally for JVM classes
4. Re-run annotation mapping with expanded annotations
5. Call `resolveCallGraph()` for cross-file call resolution
6. Merge all edges, apply dedup (high weight wins, rule engine wins on tie)
7. Return `{ edges, unresolved, stats }`

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @understand-anything/core test -- --run packages/core/src/analyzer/rule-engine.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/analyzer/rule-engine.ts packages/core/src/analyzer/rule-engine.test.ts
git commit -m "feat: integrate full rule engine pipeline with meta-annotation and call graph resolution"
```

---

## Task 12: Fingerprint Upgrade

**Files:**
- Modify: `understand-anything-plugin/packages/core/src/fingerprint.ts`
- Modify: `understand-anything-plugin/packages/core/src/fingerprint.test.ts` (if exists)

- [ ] **Step 1: Write failing tests for new fingerprint fields**

```typescript
describe("fingerprint with interface/enum/decorator", () => {
  it("detects STRUCTURAL change when interface is added", () => {
    const old = createFingerprint({ classes: [{ name: "A", methods: [], properties: [], exported: false, lineCount: 5 }] });
    const newFp = createFingerprint({
      classes: [{ name: "A", methods: [], properties: [], exported: false, lineCount: 5 }],
      interfaces: [{ name: "IService", methods: ["doWork"], properties: [] }],
    });
    expect(compareFingerprints(old, newFp).changeType).toBe("STRUCTURAL");
  });

  it("detects STRUCTURAL change when decorator is added", () => {
    const old = createFingerprint({ classes: [{ name: "A", methods: [], properties: [], exported: false, lineCount: 5 }] });
    const newFp = createFingerprint({
      classes: [{ name: "A", methods: [], properties: [], exported: false, lineCount: 5, decorators: ["Component"] }],
    });
    expect(compareFingerprints(old, newFp).changeType).toBe("STRUCTURAL");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @understand-anything/core test -- --run packages/core/src/fingerprint.test.ts`
Expected: FAIL

- [ ] **Step 3: Add new fields to ClassFingerprint and comparison logic**

Modify `ClassFingerprint`:
```typescript
export interface ClassFingerprint {
  name: string;
  methods: string[];
  properties: string[];
  exported: boolean;
  lineCount: number;
  // New fields
  kind?: string;
  decorators?: string[];
  superclass?: string;
  interfaces?: string[];
  typedPropertyNames?: string[];
}
```

Update `compareFingerprints()` to check for changes in new fields → STRUCTURAL.

Update `createFingerprint()` (or equivalent) to populate new fields from `StructuralAnalysis`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @understand-anything/core test -- --run packages/core/src/fingerprint.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/fingerprint.ts packages/core/src/fingerprint.test.ts
git commit -m "feat: track interface/enum/decorator in fingerprint for incremental analysis"
```

---

## Task 13: Pipeline Refactor — Full-Mode Extraction

**Files:**
- Modify: `understand-anything-plugin/skills/understand/extract-structure.mjs`

- [ ] **Step 1: Read current extract-structure.mjs to understand interface**

Read the file and identify:
- Current input format: `{ batchFiles, batchImportData }`
- Output format: per-batch JSON
- The `buildOutput()` and `buildResult()` functions

- [ ] **Step 2: Add full-mode input support**

Modify the script to accept both formats:
```javascript
// Support both old (per-batch) and new (full-mode) input
const files = input.fileList || input.batchFiles;
const importData = input.importData || input.batchImportData;
```

- [ ] **Step 3: Add chunked processing for memory management**

```javascript
const CHUNK_SIZE = 500;
const chunks = [];
for (let i = 0; i < files.length; i += CHUNK_SIZE) {
  chunks.push(files.slice(i, i + CHUNK_SIZE));
}

const allResults = [];
for (const chunk of chunks) {
  const chunkResults = processFiles(chunk, importData);
  allResults.push(...chunkResults);
  // Release intermediate memory
}
```

- [ ] **Step 4: Write test for full-mode extraction**

Test that full-mode output produces the same extraction results as per-batch mode for the same files.

- [ ] **Step 5: Commit**

```bash
git add skills/understand/extract-structure.mjs
git commit -m "feat: add full-mode extraction with chunked processing to extract-structure"
```

---

## Task 14: LLM Agent Update — file-analyzer.md

**Files:**
- Modify: `understand-anything-plugin/agents/file-analyzer.md`

- [ ] **Step 1: Read current file-analyzer.md**

Identify the sections to delete/modify:
- "RPC and Message-Queue Annotation Detection" section
- Edge Signal Quick Reference annotation entries
- Edge table RPC/MQ rows

- [ ] **Step 2: Delete annotation mapping sections**

Remove the RPC/MQ annotation detection section and quick reference entries.

- [ ] **Step 3: Add Phase 1.5 — Read Rule Engine Output**

Add the new section before Phase 2 explaining `ruleEngineEdges` and `unresolvedAnnotations` input fields.

- [ ] **Step 4: Update edge table**

Mark RPC/MQ edges as "规则引擎产出，LLM 不需要创建".

- [ ] **Step 5: Commit**

```bash
git add agents/file-analyzer.md
git commit -m "feat: narrow file-analyzer LLM agent to semantic-only, remove annotation mapping"
```

---

## Task 15: Pipeline Refactor — merge-batch-graphs.py

**Files:**
- Modify: `understand-anything-plugin/skills/understand/merge-batch-graphs.py`

- [ ] **Step 1: Read current recovery functions**

Read `recover_injects_from_extraction()`, `recover_rpc_mq_from_extraction()`, `recover_imports_from_scan()` to understand their input format.

- [ ] **Step 2: Add global extraction results reader**

Add a function that reads a single global extraction results file instead of multiple per-batch files:
```python
def read_global_extraction_results(global_file: Path) -> list[dict]:
    """Read single global extraction results file."""
    data = json.loads(global_file.read_text(encoding="utf-8"))
    return data.get("results", [])
```

- [ ] **Step 3: Update recovery functions to support both formats**

Modify each recovery function to accept either per-batch files or a single global file:
```python
def recover_injects_from_extraction(assembled, tmp_dir, global_results=None):
    if global_results:
        # Use global results directly
        extraction_data = global_results
    else:
        # Fallback to per-batch files
        extraction_files = sorted(tmp_dir.glob("ua-file-extract-results-*.json"))
        ...
```

- [ ] **Step 4: Commit**

```bash
git add skills/understand/merge-batch-graphs.py
git commit -m "feat: update merge recovery functions to read global extraction results"
```

---

## Task 16: Rule Engine Postprocess CLI Script

**Files:**
- Create: `understand-anything-plugin/packages/core/src/analyzer/rule-engine-postprocess.ts`

Depends on: Task 11

- [ ] **Step 1: Write the CLI script**

```typescript
#!/usr/bin/env npx tsx
// packages/core/src/analyzer/rule-engine-postprocess.ts
import { readFileSync, writeFileSync } from "fs";
import { runRuleEngine } from "./rule-engine.js";

const graphPath = process.argv[2];
if (!graphPath) {
  console.error("Usage: npx tsx rule-engine-postprocess.ts <graph-path>");
  process.exit(1);
}

const graph = JSON.parse(readFileSync(graphPath, "utf-8"));

// Extract annotations from existing nodes
const extractionResults = graph.nodes
  .filter((n: any) => n.annotations?.length > 0)
  .map((n: any) => ({
    path: n.filePath || "",
    classes: [{
      name: n.name,
      lineRange: [0, 0],
      methods: [],
      properties: [],
      annotations: n.annotations,
      interfaces: n.interfaces || [],
      typedProperties: n.typedProperties || [],
    }],
    functions: [],
    callGraph: [],
    imports: [],
    exports: [],
  }));

const result = runRuleEngine(extractionResults, { frameworks: [], packageJson: {} });

// Merge new edges (no duplicates)
const existingKeys = new Set(
  graph.edges.map((e: any) => `${e.source}|${e.target}|${e.type}`)
);
const newEdges = result.edges.filter(
  (e) => !existingKeys.has(`${e.source}|${e.target}|${e.type}`)
);

graph.edges.push(...newEdges);
writeFileSync(graphPath, JSON.stringify(graph, null, 2));

console.log(JSON.stringify({
  edgesAdded: newEdges.length,
  totalEdges: graph.edges.length,
  unresolved: result.unresolved.length,
}));
```

- [ ] **Step 2: Write a test**

Test that running postprocess on a sample graph adds expected edges without duplicating existing ones.

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/analyzer/rule-engine-postprocess.ts
git commit -m "feat: add rule-engine-postprocess CLI for incremental graph upgrade"
```

---

## Task 17: Integration Verification

- [ ] **Step 1: Build core package**

Run: `pnpm --filter @understand-anything/core build`
Expected: SUCCESS — no type errors

- [ ] **Step 2: Run all core tests**

Run: `pnpm --filter @understand-anything/core test`
Expected: All tests PASS, no regressions

- [ ] **Step 3: Run root tests**

Run: `pnpm test`
Expected: All tests PASS

- [ ] **Step 4: Run lint**

Run: `pnpm lint`
Expected: No errors

- [ ] **Step 5: Final commit with all integration fixes**

```bash
git add -A
git commit -m "feat: three-layer analysis architecture — all components integrated"
```
