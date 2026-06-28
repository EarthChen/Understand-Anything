# Callgraph AST Resolver MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an AST-backed callgraph resolver MVP so exact callee queries such as `UserProfileMoaWrapperService#queryUserExtend` and `com.immomo.moaservice.ultron.wrapper.user.moa.UserProfileMoaWrapperService#queryUserExtend` match resolved receiver owner metadata before falling back to the existing lower-camel receiver heuristic.

**Architecture:** Keep the current structure-index storage model and enrich each extractor's `callGraph` entries with optional resolved callee metadata. Add a small shared resolver helper for binding names to types, then let Java/Kotlin/Swift/Objective-C extractors populate it from fields, parameters, local variables, imports, packages, and static-looking type calls. Dashboard exact matching reads `calleeQualifiedName` and `calleeOwner` first, then preserves existing `receiver.method`, method-only, and heuristic behavior for old indexes.

**Tech Stack:** TypeScript, Vitest, tree-sitter extractors, existing `daily-update.mjs --mode reextract --force`, existing dashboard `/api/structure/callgraph`.

---

## File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `understand-anything-plugin/packages/core/src/plugins/extractors/callgraph-resolution.ts` | Shared type binding, import qualification, method-name construction helpers |
| Create | `understand-anything-plugin/packages/core/src/plugins/extractors/__tests__/callgraph-resolution.test.ts` | Unit tests for binding precedence and FQN normalization |
| Modify | `understand-anything-plugin/packages/core/src/types.ts` | Extend `CallGraphEntry` with resolved callee fields |
| Modify | `understand-anything-plugin/packages/dashboard/src/api/handlers/structure-callgraph.ts` | Prefer resolved exact owner/FQN matches and project new fields |
| Modify | `understand-anything-plugin/packages/dashboard/src/api/handlers/__tests__/structure-callgraph-matching.test.ts` | Cover resolved FQN, owner mismatch, old-index fallback, projection |
| Modify | `understand-anything-plugin/packages/core/src/plugins/extractors/java-extractor.ts` | Resolve Java receiver owners from AST bindings |
| Modify | `understand-anything-plugin/packages/core/src/plugins/extractors/__tests__/java-extractor.test.ts` | Java resolver tests for field, parameter, local shadowing, static calls, overload metadata |
| Modify | `understand-anything-plugin/packages/core/src/plugins/extractors/kotlin-extractor.ts` | Resolve Kotlin receiver owners from AST bindings |
| Modify | `understand-anything-plugin/packages/core/src/plugins/extractors/__tests__/kotlin-extractor.test.ts` | Kotlin resolver tests for property, constructor property, param, local, nullable receiver |
| Modify | `understand-anything-plugin/packages/core/src/plugins/extractors/swift-extractor.ts` | Resolve Swift receiver owners from typed properties, params, locals |
| Modify | `understand-anything-plugin/packages/core/src/plugins/extractors/__tests__/swift-extractor.test.ts` | Swift resolver tests for property, parameter, local variable |
| Modify | `understand-anything-plugin/packages/core/src/plugins/extractors/objc-extractor.ts` | Resolve Objective-C receiver owners from interface properties, params, locals |
| Modify | `understand-anything-plugin/packages/core/src/plugins/extractors/__tests__/objc-extractor.test.ts` | Objective-C resolver tests for property and local pointer receiver |
| Modify | `understand-anything-plugin/skills/understand-query/SKILL.md` | Document exact FQN matching and reextract requirement |
| Modify | `understand-anything-plugin/agents/understand-query-worker.md` | Teach agents to prefer `FQN#method`, `Class#method`, method-only, plus `--argc` |

## MVP Boundaries

This MVP resolves common direct receiver owners:

- Class fields/properties.
- Constructor and method parameters.
- Local variable declarations.
- Package/import-qualified Java/Kotlin class names.
- Static-looking calls where the receiver token names a known/imported type.
- Objective-C typed pointer receivers such as `UserProfileMoaWrapperService *service`.

This MVP intentionally leaves these as unresolved or heuristic:

- Return-type inference through chained calls such as `factory.create().queryUserExtend()`.
- Dependency-injection runtime bindings and proxy subclasses.
- Generic type argument inference beyond using the outer type name.
- Same-arity overload disambiguation by argument type. `argumentCount` remains the supported overload filter.
- Cross-file symbol lookup beyond package/import text already present in the file.

## Success Criteria

- Exact callee query `com.example.UserProfileMoaWrapperService#queryUserExtend` matches an entry whose receiver is named `profileWrapper` when the AST declared `profileWrapper` as `UserProfileMoaWrapperService`.
- Exact callee query `OtherService#queryUserExtend` does not match that entry.
- Existing indexes without `calleeQualifiedName` still support method-only, `receiver.method`, and lower-camel owner heuristic matching.
- Java, Kotlin, Swift, and Objective-C extractor tests pass.
- Dashboard callgraph matching tests pass.
- `daily-update.mjs --mode reextract --force --dry-run` remains the full structure regeneration entrypoint.

---

### Task 1: Shared Resolver Metadata and Helpers

**Files:**
- Create: `understand-anything-plugin/packages/core/src/plugins/extractors/callgraph-resolution.ts`
- Create: `understand-anything-plugin/packages/core/src/plugins/extractors/__tests__/callgraph-resolution.test.ts`
- Modify: `understand-anything-plugin/packages/core/src/types.ts`

- [ ] **Step 1: Write failing helper tests**

Create `understand-anything-plugin/packages/core/src/plugins/extractors/__tests__/callgraph-resolution.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  TypeScopeStack,
  buildQualifiedMethodName,
  qualifyTypeName,
  stripTypeSyntax,
} from "../callgraph-resolution.js";

describe("callgraph resolution helpers", () => {
  it("uses local bindings before parameters and fields", () => {
    const scopes = new TypeScopeStack();
    scopes.set("service", { type: "FieldService", qualifiedType: "com.example.FieldService", kind: "field" });
    scopes.pushScope();
    scopes.set("service", { type: "ParamService", qualifiedType: "com.example.ParamService", kind: "parameter" });
    scopes.pushScope();
    scopes.set("service", { type: "LocalService", qualifiedType: "com.example.LocalService", kind: "local" });

    expect(scopes.resolve("service")).toEqual({
      type: "LocalService",
      qualifiedType: "com.example.LocalService",
      kind: "local",
    });
  });

  it("falls back to package qualification for simple class names", () => {
    expect(qualifyTypeName("UserService", {
      packageName: "com.example",
      imports: new Map(),
      knownTypes: new Map(),
    })).toBe("com.example.UserService");
  });

  it("prefers explicit imports over package qualification", () => {
    expect(qualifyTypeName("UserService", {
      packageName: "com.local",
      imports: new Map([["UserService", "com.remote.UserService"]]),
      knownTypes: new Map(),
    })).toBe("com.remote.UserService");
  });

  it("strips syntax noise from receiver types", () => {
    expect(stripTypeSyntax("List<UserProfileMoaWrapperService>?")).toBe("List");
    expect(stripTypeSyntax("UserProfileMoaWrapperService *")).toBe("UserProfileMoaWrapperService");
  });

  it("builds qualified method names from owner and method", () => {
    expect(buildQualifiedMethodName("com.example.UserService", "queryUserExtend"))
      .toBe("com.example.UserService#queryUserExtend");
  });
});
```

- [ ] **Step 2: Run helper test to verify it fails**

Run:

```bash
cd understand-anything-plugin/packages/core
pnpm test src/plugins/extractors/__tests__/callgraph-resolution.test.ts
```

Expected: fail because `callgraph-resolution.js` is not implemented.

- [ ] **Step 3: Add shared resolver helper**

Create `understand-anything-plugin/packages/core/src/plugins/extractors/callgraph-resolution.ts`:

```ts
export type CallResolutionKind =
  | "field"
  | "parameter"
  | "local"
  | "static"
  | "implicit-owner"
  | "heuristic"
  | "unresolved";

export interface TypeBinding {
  type: string;
  qualifiedType?: string;
  kind: Exclude<CallResolutionKind, "static" | "implicit-owner" | "heuristic" | "unresolved">;
}

export interface QualificationContext {
  packageName?: string;
  imports: Map<string, string>;
  knownTypes: Map<string, string>;
}

export class TypeScopeStack {
  private scopes: Array<Map<string, TypeBinding>> = [new Map()];

  pushScope(): void {
    this.scopes.push(new Map());
  }

  popScope(): void {
    if (this.scopes.length > 1) this.scopes.pop();
  }

  set(name: string, binding: TypeBinding): void {
    const trimmed = name.trim();
    if (!trimmed) return;
    this.scopes[this.scopes.length - 1].set(trimmed, binding);
  }

  resolve(name: string): TypeBinding | undefined {
    const trimmed = name.trim();
    for (let index = this.scopes.length - 1; index >= 0; index -= 1) {
      const binding = this.scopes[index].get(trimmed);
      if (binding) return binding;
    }
    return undefined;
  }
}

export function stripTypeSyntax(typeText: string): string {
  return typeText
    .trim()
    .replace(/[?!]+$/u, "")
    .replace(/\s*\*+$/u, "")
    .replace(/\s*&+$/u, "")
    .replace(/<.*>$/u, "")
    .replace(/\[\]$/u, "")
    .trim();
}

export function simpleTypeName(typeText: string): string {
  const stripped = stripTypeSyntax(typeText);
  const parts = stripped.split(".").filter(Boolean);
  return parts[parts.length - 1] ?? stripped;
}

export function qualifyTypeName(typeText: string, context: QualificationContext): string | undefined {
  const stripped = stripTypeSyntax(typeText);
  if (!stripped) return undefined;
  if (stripped.includes(".")) return stripped;
  const simple = simpleTypeName(stripped);
  return context.knownTypes.get(simple)
    ?? context.imports.get(simple)
    ?? (context.packageName ? `${context.packageName}.${simple}` : simple);
}

export function buildQualifiedMethodName(owner: string | undefined, methodName: string | undefined): string | undefined {
  if (!owner || !methodName) return undefined;
  return `${owner}#${methodName}`;
}
```

- [ ] **Step 4: Extend core `CallGraphEntry`**

Modify `understand-anything-plugin/packages/core/src/types.ts` so `CallGraphEntry` includes these optional fields while keeping all existing fields:

```ts
  receiverType?: string;
  receiverQualifiedType?: string;
  calleeOwner?: string;
  calleeQualifiedName?: string;
  resolutionKind?: "field" | "parameter" | "local" | "static" | "implicit-owner" | "heuristic" | "unresolved";
```

Place them next to the existing `receiver`, `methodName`, `argumentCount`, and `callerQualifiedName` metadata fields.

- [ ] **Step 5: Run helper test and type build**

Run:

```bash
cd understand-anything-plugin/packages/core
pnpm test src/plugins/extractors/__tests__/callgraph-resolution.test.ts
pnpm build
```

Expected: both commands pass.

- [ ] **Step 6: Commit**

```bash
git add understand-anything-plugin/packages/core/src/plugins/extractors/callgraph-resolution.ts \
  understand-anything-plugin/packages/core/src/plugins/extractors/__tests__/callgraph-resolution.test.ts \
  understand-anything-plugin/packages/core/src/types.ts
git commit -m "feat: add callgraph resolution metadata"
```

---

### Task 2: Dashboard Exact Matching Uses Resolved Callee Owners

**Files:**
- Modify: `understand-anything-plugin/packages/dashboard/src/api/handlers/structure-callgraph.ts`
- Modify: `understand-anything-plugin/packages/dashboard/src/api/handlers/__tests__/structure-callgraph-matching.test.ts`

- [ ] **Step 1: Add failing resolved matching tests**

Append these tests to `describe("callgraph exact matching", ...)` in `structure-callgraph-matching.test.ts`:

```ts
  it("matches FQN#method using resolved calleeQualifiedName before receiver heuristic", () => {
    expect(matchesCallgraphEntry(
      {
        caller: "getQuickMessage",
        callee: "profileWrapper.queryUserExtend",
        receiver: "profileWrapper",
        receiverType: "UserProfileMoaWrapperService",
        receiverQualifiedType: "com.immomo.moaservice.ultron.wrapper.user.moa.UserProfileMoaWrapperService",
        calleeOwner: "UserProfileMoaWrapperService",
        calleeQualifiedName: "com.immomo.moaservice.ultron.wrapper.user.moa.UserProfileMoaWrapperService#queryUserExtend",
        methodName: "queryUserExtend",
        resolutionKind: "field",
        lineNumber: 318,
      },
      {
        callee: "com.immomo.moaservice.ultron.wrapper.user.moa.UserProfileMoaWrapperService#queryUserExtend",
        exact: true,
      },
    )).toBe(true);
  });

  it("rejects the wrong resolved owner even when method name matches", () => {
    expect(matchesCallgraphEntry(
      {
        caller: "getQuickMessage",
        callee: "profileWrapper.queryUserExtend",
        receiver: "profileWrapper",
        receiverType: "UserProfileMoaWrapperService",
        receiverQualifiedType: "com.immomo.moaservice.ultron.wrapper.user.moa.UserProfileMoaWrapperService",
        calleeOwner: "UserProfileMoaWrapperService",
        calleeQualifiedName: "com.immomo.moaservice.ultron.wrapper.user.moa.UserProfileMoaWrapperService#queryUserExtend",
        methodName: "queryUserExtend",
        resolutionKind: "field",
        lineNumber: 318,
      },
      { callee: "com.example.OtherService#queryUserExtend", exact: true },
    )).toBe(false);
  });

  it("keeps old-index owner heuristic when resolved callee fields are absent", () => {
    expect(matchesCallgraphEntry(
      {
        caller: "getQuickMessage",
        callee: "userProfileMoaWrapperService.queryUserExtend",
        receiver: "userProfileMoaWrapperService",
        methodName: "queryUserExtend",
        lineNumber: 318,
      },
      { callee: "UserProfileMoaWrapperService#queryUserExtend", exact: true },
    )).toBe(true);
  });
```

Extend the projection test expected object with:

```ts
      receiverType: "OrderRepository",
      receiverQualifiedType: "com.example.OrderRepository",
      calleeOwner: "OrderRepository",
      calleeQualifiedName: "com.example.OrderRepository#save",
      resolutionKind: "field",
```

- [ ] **Step 2: Run dashboard matching test to verify it fails**

Run:

```bash
cd understand-anything-plugin/packages/dashboard
pnpm test src/api/handlers/__tests__/structure-callgraph-matching.test.ts
```

Expected: fail because `CallGraphEntry` and projection do not expose resolved fields, and owner matching still relies on lower-camel receiver heuristic.

- [ ] **Step 3: Add resolved fields and exact owner matching**

Modify `CallGraphEntry` in `structure-callgraph.ts` to include the same five optional fields added to core:

```ts
  receiverType?: string
  receiverQualifiedType?: string
  calleeOwner?: string
  calleeQualifiedName?: string
  resolutionKind?: "field" | "parameter" | "local" | "static" | "implicit-owner" | "heuristic" | "unresolved"
```

Add helpers near `normalizeOwnerMethod`:

```ts
function ownerMatchesResolved(entry: CallGraphEntry, raw: string, methodName: string): boolean | undefined {
  const normalized = normalizeOwnerMethod(raw)
  if (entry.calleeQualifiedName !== undefined) {
    if (entry.calleeQualifiedName === raw) return true
    if (entry.calleeQualifiedName.endsWith(`#${methodName}`)) {
      const resolvedOwner = entry.calleeQualifiedName.slice(0, -(`#${methodName}`).length)
      const requestedOwner = normalized.slice(0, -(`#${methodName}`).length)
      return resolvedOwner === requestedOwner || resolvedOwner.endsWith(`.${requestedOwner}`)
    }
    return false
  }
  if (entry.calleeOwner !== undefined) {
    return entry.calleeOwner === parsedOwnerClass(raw) && entryMethodName(entry) === methodName
  }
  return undefined
}

function parsedOwnerClass(raw: string): string {
  const parsed = parseCallQuery(raw)
  return parsed.kind === "ownerMethod" ? parsed.ownerClass : raw
}
```

In `matchesCallee`, replace the owner-method branch with:

```ts
  const resolved = ownerMatchesResolved(entry, raw, parsed.methodName)
  if (resolved !== undefined) return resolved
  const expectedReceiver = lowerCamel(parsed.ownerClass)
  return entryReceiver(entry) === expectedReceiver && entryMethodName(entry) === parsed.methodName
```

In `projectCallgraphResult`, include the five new optional fields with the existing optional-field spread style.

- [ ] **Step 4: Run dashboard matching tests**

Run:

```bash
cd understand-anything-plugin/packages/dashboard
pnpm test src/api/handlers/__tests__/structure-callgraph-matching.test.ts
pnpm typecheck
```

Expected: both commands pass.

- [ ] **Step 5: Commit**

```bash
git add understand-anything-plugin/packages/dashboard/src/api/handlers/structure-callgraph.ts \
  understand-anything-plugin/packages/dashboard/src/api/handlers/__tests__/structure-callgraph-matching.test.ts
git commit -m "feat: match callgraph exact queries by resolved callee owner"
```

---

### Task 3: Java AST Resolver MVP

**Files:**
- Modify: `understand-anything-plugin/packages/core/src/plugins/extractors/java-extractor.ts`
- Modify: `understand-anything-plugin/packages/core/src/plugins/extractors/__tests__/java-extractor.test.ts`

- [ ] **Step 1: Add failing Java tests**

Append this `describe` block to `java-extractor.test.ts`:

```ts
  describe("extractCallGraph - resolved callee owner", () => {
    it("resolves field, parameter, local shadow, static, and overload metadata", () => {
      const { tree, parser, root } = parse(`package com.example;

import com.remote.UserProfileMoaWrapperService;
import com.remote.StaticTools;

public class QuickMessageService {
    private UserProfileMoaWrapperService userProfileMoaWrapperService;

    public void getQuickMessage(UserProfileMoaWrapperService parameterService) {
        userProfileMoaWrapperService.queryUserExtend(1);
        parameterService.queryUserExtend(1, 2);
        OtherService userProfileMoaWrapperService = new OtherService();
        userProfileMoaWrapperService.queryUserExtend();
        StaticTools.queryUserExtend();
        unknownService.queryUserExtend();
    }
}
`);
      const result = extractor.extractCallGraph(root);

      expect(result).toMatchObject([
        {
          caller: "getQuickMessage",
          receiver: "userProfileMoaWrapperService",
          methodName: "queryUserExtend",
          argumentCount: 1,
          receiverType: "UserProfileMoaWrapperService",
          receiverQualifiedType: "com.remote.UserProfileMoaWrapperService",
          calleeOwner: "UserProfileMoaWrapperService",
          calleeQualifiedName: "com.remote.UserProfileMoaWrapperService#queryUserExtend",
          resolutionKind: "field",
        },
        {
          receiver: "parameterService",
          argumentCount: 2,
          receiverType: "UserProfileMoaWrapperService",
          receiverQualifiedType: "com.remote.UserProfileMoaWrapperService",
          calleeQualifiedName: "com.remote.UserProfileMoaWrapperService#queryUserExtend",
          resolutionKind: "parameter",
        },
        {
          receiver: "userProfileMoaWrapperService",
          argumentCount: 0,
          receiverType: "OtherService",
          receiverQualifiedType: "com.example.OtherService",
          calleeQualifiedName: "com.example.OtherService#queryUserExtend",
          resolutionKind: "local",
        },
        {
          receiver: "StaticTools",
          receiverType: "StaticTools",
          receiverQualifiedType: "com.remote.StaticTools",
          calleeQualifiedName: "com.remote.StaticTools#queryUserExtend",
          resolutionKind: "static",
        },
        {
          receiver: "unknownService",
          methodName: "queryUserExtend",
          resolutionKind: "unresolved",
        },
      ]);

      tree.delete();
      parser.delete();
    });
  });
```

- [ ] **Step 2: Run Java extractor test to verify it fails**

Run:

```bash
cd understand-anything-plugin/packages/core
pnpm test src/plugins/extractors/__tests__/java-extractor.test.ts
```

Expected: fail because resolved callee fields are missing.

- [ ] **Step 3: Implement Java resolver bindings**

Modify `java-extractor.ts`:

1. Import shared helpers:

```ts
import {
  TypeScopeStack,
  buildQualifiedMethodName,
  qualifyTypeName,
  simpleTypeName,
} from "./callgraph-resolution.js";
```

2. At the start of `extractCallGraph`, build a qualification context:

```ts
const packageName = this.extractPackageName(rootNode);
const imports = this.extractImports(rootNode);
const knownTypes = this.extractKnownTypes(rootNode, packageName, imports);
const typeScopes = new TypeScopeStack();
```

3. Add private helpers in `JavaExtractor`:

```ts
private extractPackageName(rootNode: TreeSitterNode): string | undefined {
  for (let i = 0; i < rootNode.childCount; i += 1) {
    const child = rootNode.child(i);
    if (child?.type === "package_declaration") {
      return child.text.replace(/^package\s+/u, "").replace(/;$/u, "").trim();
    }
  }
  return undefined;
}

private extractImports(rootNode: TreeSitterNode): Map<string, string> {
  const imports = new Map<string, string>();
  this.traverse(rootNode, (node) => {
    if (node.type !== "import_declaration") return;
    const value = node.text.replace(/^import\s+static\s+/u, "").replace(/^import\s+/u, "").replace(/;$/u, "").trim();
    const simple = value.split(".").filter(Boolean).at(-1);
    if (simple && simple !== "*") imports.set(simple, value);
  });
  return imports;
}

private extractKnownTypes(rootNode: TreeSitterNode, packageName: string | undefined, imports: Map<string, string>): Map<string, string> {
  const knownTypes = new Map<string, string>();
  this.traverse(rootNode, (node) => {
    if (!["class_declaration", "interface_declaration", "enum_declaration"].includes(node.type)) return;
    const name = node.childForFieldName("name")?.text;
    if (name) knownTypes.set(name, packageName ? `${packageName}.${name}` : name);
  });
  for (const [simple, fqn] of imports) knownTypes.set(simple, fqn);
  return knownTypes;
}
```

4. When entering a class body, add field bindings for `field_declaration` children to the outer scope. Use each declarator name and the declaration type node text; bind `{ type: simpleTypeName(typeText), qualifiedType: qualifyTypeName(typeText, context), kind: "field" }`.

5. When entering `method_declaration` or `constructor_declaration`, call `typeScopes.pushScope()`, bind every formal parameter as `kind: "parameter"`, then traverse method body. Pop the scope when leaving the method node.

6. When visiting `local_variable_declaration`, bind each variable declarator as `kind: "local"` in the current method scope. This makes local variables shadow parameters and fields because `TypeScopeStack.resolve` searches from inner scope outward.

7. When emitting a `method_invocation`, resolve `objectNode?.text`:

```ts
const binding = objectNode ? typeScopes.resolve(objectNode.text) : undefined;
const staticOwner = !binding && objectNode
  ? qualifyTypeName(objectNode.text, { packageName, imports, knownTypes })
  : undefined;
const receiverType = binding?.type ?? (staticOwner ? simpleTypeName(staticOwner) : undefined);
const receiverQualifiedType = binding?.qualifiedType ?? staticOwner;
const resolutionKind = binding?.kind ?? (staticOwner ? "static" : "unresolved");
const calleeOwner = receiverType;
const calleeQualifiedName = buildQualifiedMethodName(receiverQualifiedType, nameNode?.text);
```

Spread these fields into the existing `entries.push` without removing `caller`, `callee`, `lineNumber`, `columnNumber`, `receiver`, `methodName`, `argumentCount`, `callText`, `callerOwner`, or `callerQualifiedName`.

- [ ] **Step 4: Run Java extractor tests**

Run:

```bash
cd understand-anything-plugin/packages/core
pnpm test src/plugins/extractors/__tests__/java-extractor.test.ts
pnpm build
```

Expected: both commands pass.

- [ ] **Step 5: Commit**

```bash
git add understand-anything-plugin/packages/core/src/plugins/extractors/java-extractor.ts \
  understand-anything-plugin/packages/core/src/plugins/extractors/__tests__/java-extractor.test.ts
git commit -m "feat: resolve Java callgraph callee owners"
```

---

### Task 4: Kotlin AST Resolver MVP

**Files:**
- Modify: `understand-anything-plugin/packages/core/src/plugins/extractors/kotlin-extractor.ts`
- Modify: `understand-anything-plugin/packages/core/src/plugins/extractors/__tests__/kotlin-extractor.test.ts`

- [ ] **Step 1: Add failing Kotlin tests**

Append a callgraph resolver test that parses:

```kotlin
package com.example

import com.remote.UserProfileMoaWrapperService

class QuickMessageService(
    private val constructorService: UserProfileMoaWrapperService
) {
    private val fieldService: UserProfileMoaWrapperService? = null

    fun getQuickMessage(parameterService: UserProfileMoaWrapperService) {
        fieldService?.queryUserExtend(1)
        constructorService.queryUserExtend(1, 2)
        parameterService.queryUserExtend()
        val fieldService: OtherService = OtherService()
        fieldService.queryUserExtend()
        UnknownService.queryUserExtend()
    }
}
```

Assert the emitted entries include:

```ts
expect(result).toEqual(expect.arrayContaining([
  expect.objectContaining({
    receiver: "fieldService",
    receiverType: "UserProfileMoaWrapperService",
    receiverQualifiedType: "com.remote.UserProfileMoaWrapperService",
    calleeQualifiedName: "com.remote.UserProfileMoaWrapperService#queryUserExtend",
    resolutionKind: "field",
  }),
  expect.objectContaining({
    receiver: "constructorService",
    argumentCount: 2,
    resolutionKind: "field",
  }),
  expect.objectContaining({
    receiver: "parameterService",
    resolutionKind: "parameter",
  }),
  expect.objectContaining({
    receiver: "fieldService",
    receiverType: "OtherService",
    receiverQualifiedType: "com.example.OtherService",
    resolutionKind: "local",
  }),
  expect.objectContaining({
    receiver: "UnknownService",
    receiverQualifiedType: "com.example.UnknownService",
    resolutionKind: "static",
  }),
]));
```

- [ ] **Step 2: Run Kotlin test to verify it fails**

Run:

```bash
cd understand-anything-plugin/packages/core
pnpm test src/plugins/extractors/__tests__/kotlin-extractor.test.ts
```

Expected: fail because Kotlin callGraph entries do not include resolved callee metadata.

- [ ] **Step 3: Implement Kotlin resolver**

Modify `kotlin-extractor.ts` with the same shared helper imports as Java. Build `packageName`, `imports`, and `knownTypes` by reading `package_header`, `import_header`, and class/object/interface declarations. Bind:

- `property_declaration` under class body as `kind: "field"`.
- Primary constructor `val`/`var` parameters as `kind: "field"`.
- Function parameters as `kind: "parameter"`.
- `variable_declaration` under a function body as `kind: "local"`.

When emitting a `call_expression`, strip Kotlin receiver suffixes already handled by the existing receiver cleanup, then apply:

```ts
const binding = receiver ? typeScopes.resolve(receiver) : undefined;
const staticOwner = !binding && receiver ? qualifyTypeName(receiver, context) : undefined;
const receiverType = binding?.type ?? (staticOwner ? simpleTypeName(staticOwner) : undefined);
const receiverQualifiedType = binding?.qualifiedType ?? staticOwner;
const resolutionKind = binding?.kind ?? (staticOwner ? "static" : "unresolved");
```

Populate `calleeOwner`, `calleeQualifiedName`, and `resolutionKind` while preserving the current trailing-lambda and argument-count behavior.

- [ ] **Step 4: Run Kotlin extractor tests**

Run:

```bash
cd understand-anything-plugin/packages/core
pnpm test src/plugins/extractors/__tests__/kotlin-extractor.test.ts
pnpm build
```

Expected: both commands pass.

- [ ] **Step 5: Commit**

```bash
git add understand-anything-plugin/packages/core/src/plugins/extractors/kotlin-extractor.ts \
  understand-anything-plugin/packages/core/src/plugins/extractors/__tests__/kotlin-extractor.test.ts
git commit -m "feat: resolve Kotlin callgraph callee owners"
```

---

### Task 5: Swift and Objective-C Resolver MVP

**Files:**
- Modify: `understand-anything-plugin/packages/core/src/plugins/extractors/swift-extractor.ts`
- Modify: `understand-anything-plugin/packages/core/src/plugins/extractors/__tests__/swift-extractor.test.ts`
- Modify: `understand-anything-plugin/packages/core/src/plugins/extractors/objc-extractor.ts`
- Modify: `understand-anything-plugin/packages/core/src/plugins/extractors/__tests__/objc-extractor.test.ts`

- [ ] **Step 1: Add failing Swift test**

Add a Swift callgraph resolver test with:

```swift
class QuickMessageService {
    private let fieldService: UserProfileMoaWrapperService

    func getQuickMessage(parameterService: UserProfileMoaWrapperService) {
        fieldService.queryUserExtend(1)
        parameterService.queryUserExtend()
        let fieldService: OtherService = OtherService()
        fieldService.queryUserExtend()
    }
}
```

Assert `fieldService` first resolves as `field`, `parameterService` resolves as `parameter`, and the local `fieldService` call resolves as `local` with `OtherService#queryUserExtend`.

- [ ] **Step 2: Add failing Objective-C test**

Add an Objective-C callgraph resolver test with:

```objc
@interface QuickMessageService
@property(nonatomic, strong) UserProfileMoaWrapperService *fieldService;
@end

@implementation QuickMessageService
- (void)getQuickMessage:(UserProfileMoaWrapperService *)parameterService {
    [self.fieldService queryUserExtend:1];
    [parameterService queryUserExtend];
    OtherService *fieldService = [OtherService new];
    [fieldService queryUserExtend];
}
@end
```

Assert `self.fieldService` resolves as `field`, `parameterService` resolves as `parameter`, and local `fieldService` resolves as `local`.

- [ ] **Step 3: Run Swift and Objective-C tests to verify they fail**

Run:

```bash
cd understand-anything-plugin/packages/core
pnpm test src/plugins/extractors/__tests__/swift-extractor.test.ts src/plugins/extractors/__tests__/objc-extractor.test.ts
```

Expected: fail because resolved fields are not emitted.

- [ ] **Step 4: Implement Swift resolver**

In `swift-extractor.ts`, import the shared helpers. Use a `TypeScopeStack`:

- Bind `property_declaration` typed properties as `field`.
- Bind function parameters typed as `name: Type` as `parameter`.
- Bind `let` and `var` typed declarations as `local`.
- For calls with receiver text, resolve the receiver token through the scope stack.
- Swift has no package/import FQN in this MVP, so `receiverQualifiedType` equals the stripped type name.

Set `calleeOwner`, `calleeQualifiedName`, and `resolutionKind` on existing callGraph entries without changing existing caller/callee fields.

- [ ] **Step 5: Implement Objective-C resolver**

In `objc-extractor.ts`, import the shared helpers. Use a `TypeScopeStack`:

- Bind `property_declaration` type/name pairs as `field`.
- Normalize `self.fieldService` by looking up `fieldService` in field bindings.
- Bind method parameters typed as `UserProfileMoaWrapperService *parameterService` as `parameter`.
- Bind local declarations typed as `OtherService *fieldService` as `local`.
- Use stripped Objective-C pointer types for `receiverType`, `receiverQualifiedType`, `calleeOwner`, and `calleeQualifiedName`.

Preserve selector construction and line/column metadata already emitted by the extractor.

- [ ] **Step 6: Run Swift and Objective-C tests**

Run:

```bash
cd understand-anything-plugin/packages/core
pnpm test src/plugins/extractors/__tests__/swift-extractor.test.ts src/plugins/extractors/__tests__/objc-extractor.test.ts
pnpm build
```

Expected: both commands pass.

- [ ] **Step 7: Commit**

```bash
git add understand-anything-plugin/packages/core/src/plugins/extractors/swift-extractor.ts \
  understand-anything-plugin/packages/core/src/plugins/extractors/__tests__/swift-extractor.test.ts \
  understand-anything-plugin/packages/core/src/plugins/extractors/objc-extractor.ts \
  understand-anything-plugin/packages/core/src/plugins/extractors/__tests__/objc-extractor.test.ts
git commit -m "feat: resolve mobile callgraph callee owners"
```

---

### Task 6: Docs and Reextract Guidance

**Files:**
- Modify: `understand-anything-plugin/skills/understand-query/SKILL.md`
- Modify: `understand-anything-plugin/agents/understand-query-worker.md`

- [ ] **Step 1: Update query skill docs**

In `SKILL.md`, update the callgraph section to state:

```md
- `--exact --callee FQN#method` first matches AST-resolved `calleeQualifiedName` when the structure index was generated after the AST resolver change.
- `--exact --callee Class#method` matches resolved `calleeOwner`/qualified owner first, then falls back to the legacy lower-camel receiver heuristic for old indexes.
- `--exact --callee methodName` remains useful for quick method-name lookup across all owners.
- Use `--argc N` with exact callee queries to split overloads by argument count. Same-arity overloads are not separated by this MVP.
- For existing projects, run `node scripts/daily-update.mjs /path/to/project --mode reextract --force` to regenerate structure indexes with resolved callee metadata. Upper KG/wiki data does not need to be regenerated for callgraph exact matching.
```

- [ ] **Step 2: Update worker guidance**

In `understand-query-worker.md`, add a callgraph lookup rule:

```md
When the user provides an IDE-style reference such as `com.example.UserService#queryUserExtend`, pass it directly as `--callee` with `--exact`. Do not manually convert it to a receiver name. If the query returns no rows, retry with `Class#method`, then method-only plus `--argc` when the user gave argument count.
```

- [ ] **Step 3: Commit**

```bash
git add understand-anything-plugin/skills/understand-query/SKILL.md \
  understand-anything-plugin/agents/understand-query-worker.md
git commit -m "docs: document resolved callgraph exact matching"
```

---

### Task 7: Full Verification and Structure Reextract Dry Run

**Files:**
- No source files expected beyond previous tasks.

- [ ] **Step 1: Run focused dashboard tests**

```bash
cd understand-anything-plugin/packages/dashboard
pnpm test src/api/handlers/__tests__/structure-callgraph-matching.test.ts src/api/handlers/__tests__/structure-callgraph.test.ts
```

Expected: pass.

- [ ] **Step 2: Run focused core extractor tests**

```bash
cd understand-anything-plugin/packages/core
pnpm test src/plugins/extractors/__tests__/callgraph-resolution.test.ts \
  src/plugins/extractors/__tests__/java-extractor.test.ts \
  src/plugins/extractors/__tests__/kotlin-extractor.test.ts \
  src/plugins/extractors/__tests__/swift-extractor.test.ts \
  src/plugins/extractors/__tests__/objc-extractor.test.ts
```

Expected: pass.

- [ ] **Step 3: Run package builds**

```bash
cd understand-anything-plugin
pnpm --filter @understand-anything/core build
pnpm --filter @understand-anything/dashboard typecheck
```

Expected: both commands pass.

- [ ] **Step 4: Verify full structure reextract entrypoint**

```bash
cd understand-anything-plugin
node scripts/daily-update.mjs /path/to/project --mode reextract --force --dry-run
```

Expected: command lists deterministic reextract work without mutating project structure indexes.

- [ ] **Step 5: Inspect working tree**

```bash
git status --short
```

Expected: only intentional source/doc changes are present. The pre-existing `understand-anything-plugin/pnpm-workspace.yaml` environment diff may still be present and should not be included unless the implementer deliberately fixed dependency installation separately.

- [ ] **Step 6: Final commit if verification required formatting/doc adjustments**

If Step 5 shows only intentional changes from this task, commit them:

```bash
git add understand-anything-plugin/packages/core/src/plugins/extractors \
  understand-anything-plugin/packages/core/src/types.ts \
  understand-anything-plugin/packages/dashboard/src/api/handlers \
  understand-anything-plugin/skills/understand-query/SKILL.md \
  understand-anything-plugin/agents/understand-query-worker.md
git commit -m "test: verify callgraph ast resolver mvp"
```

If there are no remaining intentional changes, skip this commit.

---

## Execution Notes

- Existing generated structure data does not need upper KG/wiki regeneration. Running structure reextract is enough because the dashboard callgraph endpoint reads `structure.json` callGraph entries.
- The resolver must preserve old callGraph fields so older UI/query rendering continues to work.
- `resolutionKind: "unresolved"` is useful for explaining why an exact owner query missed, but the entry still participates in method-only and receiver-method matching.
- `--argc` remains the overload separator for this MVP. Same-arity overloads will need a later argument-type signature field.

## Self-Review Checklist

- Spec coverage: Java, Kotlin, Swift, Objective-C, FQN exact matching, old-index fallback, overload `argc`, docs, and reextract guidance are covered.
- Placeholder scan: this plan contains concrete files, test inputs, expected assertions, implementation fields, verification commands, and commit commands.
- Type consistency: `receiverType`, `receiverQualifiedType`, `calleeOwner`, `calleeQualifiedName`, and `resolutionKind` are used consistently across core, dashboard, and extractor tasks.
