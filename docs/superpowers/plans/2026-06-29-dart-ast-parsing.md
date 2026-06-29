# Dart AST Parsing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enhance Dart structural AST extraction so `structural-analysis.json` contains resolved Dart callgraph metadata usable by `understand-query structure --callee`.

**Architecture:** Keep the implementation inside the existing `DartExtractor`, using the same `CallGraphEntry` schema and `TypeScopeStack` helpers already used by Java/Kotlin/Swift. The first increment resolves class owner, receiver, method name, argument count, field/parameter/local/static receiver type, and `calleeQualifiedName` for method calls without touching KG/DG/wiki generation or query skill defaults.

**Tech Stack:** TypeScript, Vitest, web-tree-sitter, tree-sitter-dart, existing `extract-structure.mjs` CLI.

---

## Assumptions And Boundaries

- Do not modify `understand-query` skill docs or server defaults.
- Do not rebuild KG/DG/wiki as part of this feature; AST/structure reindex remains the caller's responsibility after code lands.
- Dart does not have Java-style packages in source files. For local/same-file types, use `ClassName#method`. For imported `show` specifiers, allow URI-derived qualified owners such as `package:app/api/user_api.dart.UserApi#fetch`. For wildcard imports where the exact source type cannot be proven, keep the simple owner `UserApi#fetch`.
- Keep constructor call extraction modest: record constructor-like calls as `new TypeName` with `methodName: "TypeName"` and static resolution when the target starts with uppercase. Do not attempt full Dart analyzer inference.

## File Structure

- Modify `understand-anything-plugin/packages/core/src/plugins/extractors/dart-extractor.ts`
  - Add type-scope based receiver resolution.
  - Replace expression-statement-only call extraction with structured call parsing.
  - Preserve existing structure extraction behavior.
- Modify `understand-anything-plugin/packages/core/src/plugins/extractors/__tests__/dart-extractor.test.ts`
  - Add failing tests for field, `this.field`, parameter, local, static, implicit owner, argument count, caller owner, and constructor-like calls.
- Modify `understand-anything-plugin/src/__tests__/extract-structure.test.mjs`
  - Add a CLI integration test proving Dart callgraph metadata survives `extract-structure.mjs` output serialization.

## Success Criteria

- Dart callgraph entries include `columnNumber`, `receiver`, `methodName`, `argumentCount`, `callText`, `callerOwner`, `callerQualifiedName`, `receiverType`, `receiverQualifiedType`, `calleeOwner`, `calleeQualifiedName`, and `resolutionKind` when those fields are deterministically known.
- Existing Dart structure tests still pass.
- Existing Java/Kotlin/Swift callgraph behavior is unchanged.
- `extract-structure.mjs` writes Dart callgraph metadata into `structural-analysis.json` style output.

### Task 1: Add Dart Extractor Callgraph Tests

**Files:**
- Modify: `understand-anything-plugin/packages/core/src/plugins/extractors/__tests__/dart-extractor.test.ts`
- Test: `understand-anything-plugin/packages/core/src/plugins/extractors/__tests__/dart-extractor.test.ts`

- [ ] **Step 1: Add failing tests for resolved receiver metadata**

Append these tests inside the existing `describe("extractCallGraph", () => { ... })` block:

```ts
    it("resolves Dart field, this.field, parameter, local, static, and implicit owner calls", () => {
      const { tree, parser, root } = parse(`class UserApi {
  Future<String> fetch(String id) async => id;
  static void warmup() {}
}

class UserRepo {
  void save() {}
}

class UserController {
  final UserApi api;
  UserController(this.api);

  void load(UserRepo repo) {
    final UserApi localApi = UserApi();
    api.fetch("field");
    this.api.fetch("this-field");
    repo.save();
    localApi.fetch("local");
    UserApi.warmup();
    notify();
  }

  void notify() {}
}
`);
      const result = extractor.extractCallGraph(root);

      expect(result.find((entry) => entry.callText === 'api.fetch("field")')).toEqual(
        expect.objectContaining({
          caller: "load",
          callee: "api.fetch",
          lineNumber: 16,
          columnNumber: 5,
          receiver: "api",
          methodName: "fetch",
          argumentCount: 1,
          callText: 'api.fetch("field")',
          callerOwner: "UserController",
          callerQualifiedName: "UserController#load",
          receiverType: "UserApi",
          receiverQualifiedType: "UserApi",
          calleeOwner: "UserApi",
          calleeQualifiedName: "UserApi#fetch",
          resolutionKind: "field",
        }),
      );

      expect(result.find((entry) => entry.callText === 'this.api.fetch("this-field")')).toEqual(
        expect.objectContaining({
          receiver: "this.api",
          methodName: "fetch",
          receiverType: "UserApi",
          receiverQualifiedType: "UserApi",
          calleeOwner: "UserApi",
          calleeQualifiedName: "UserApi#fetch",
          resolutionKind: "field",
        }),
      );

      expect(result.find((entry) => entry.callText === "repo.save()")).toEqual(
        expect.objectContaining({
          receiver: "repo",
          methodName: "save",
          receiverType: "UserRepo",
          receiverQualifiedType: "UserRepo",
          calleeOwner: "UserRepo",
          calleeQualifiedName: "UserRepo#save",
          resolutionKind: "parameter",
        }),
      );

      expect(result.find((entry) => entry.callText === 'localApi.fetch("local")')).toEqual(
        expect.objectContaining({
          receiver: "localApi",
          methodName: "fetch",
          receiverType: "UserApi",
          receiverQualifiedType: "UserApi",
          calleeOwner: "UserApi",
          calleeQualifiedName: "UserApi#fetch",
          resolutionKind: "local",
        }),
      );

      expect(result.find((entry) => entry.callText === "UserApi.warmup()")).toEqual(
        expect.objectContaining({
          receiver: "UserApi",
          methodName: "warmup",
          receiverType: "UserApi",
          receiverQualifiedType: "UserApi",
          calleeOwner: "UserApi",
          calleeQualifiedName: "UserApi#warmup",
          resolutionKind: "static",
        }),
      );

      expect(result.find((entry) => entry.callText === "notify()")).toEqual(
        expect.objectContaining({
          callerOwner: "UserController",
          callerQualifiedName: "UserController#load",
          methodName: "notify",
          calleeOwner: "UserController",
          calleeQualifiedName: "UserController#notify",
          resolutionKind: "implicit-owner",
        }),
      );

      tree.delete();
      parser.delete();
    });

    it("records constructor-like Dart calls with argument counts", () => {
      const { tree, parser, root } = parse(`class User {}

class UserFactory {
  void create() {
    User();
  }
}
`);
      const result = extractor.extractCallGraph(root);

      expect(result.find((entry) => entry.callText === "User()")).toEqual(
        expect.objectContaining({
          caller: "create",
          callee: "new User",
          lineNumber: 5,
          columnNumber: 5,
          methodName: "User",
          argumentCount: 0,
          callText: "User()",
          callerOwner: "UserFactory",
          callerQualifiedName: "UserFactory#create",
          receiverType: "User",
          receiverQualifiedType: "User",
          calleeOwner: "User",
          calleeQualifiedName: "User#User",
          resolutionKind: "static",
        }),
      );

      tree.delete();
      parser.delete();
    });
```

- [ ] **Step 2: Run the focused test and verify failure**

Run:

```bash
pnpm --filter @understand-anything/core test -- src/plugins/extractors/__tests__/dart-extractor.test.ts
```

Expected: FAIL because current `DartExtractor.extractCallGraph()` only emits `caller`, `callee`, and `lineNumber`, and does not populate resolved receiver metadata.

- [ ] **Step 3: Commit failing tests**

```bash
git add understand-anything-plugin/packages/core/src/plugins/extractors/__tests__/dart-extractor.test.ts
git commit -m "test: cover resolved dart callgraph metadata"
```

### Task 2: Implement Resolved Dart Callgraph Extraction

**Files:**
- Modify: `understand-anything-plugin/packages/core/src/plugins/extractors/dart-extractor.ts`
- Test: `understand-anything-plugin/packages/core/src/plugins/extractors/__tests__/dart-extractor.test.ts`

- [ ] **Step 1: Import the shared callgraph resolution helpers**

At the top of `dart-extractor.ts`, add this import below the existing extractor imports:

```ts
import {
  TypeScopeStack,
  type TypeBinding,
  buildQualifiedMethodName,
  qualifyTypeName,
  simpleTypeName,
} from "./callgraph-resolution.js";
```

- [ ] **Step 2: Add structured Dart call parsing helpers**

Replace the current `extractCalleeFromExpressionStatement()` helper with these helpers:

```ts
interface DartCallParts {
  callee: string;
  receiver?: string;
  methodName: string;
  constructorType?: string;
  argumentCount: number;
  callText: string;
}

function countArguments(argsNode: TreeSitterNode | null): number {
  if (!argsNode) return 0;
  let count = 0;
  for (let i = 0; i < argsNode.childCount; i++) {
    const child = argsNode.child(i);
    if (!child) continue;
    if (child.type !== "(" && child.type !== ")" && child.type !== ",") {
      count++;
    }
  }
  return count;
}

function extractCallPartsFromExpressionStatement(node: TreeSitterNode): DartCallParts | null {
  if (node.type !== "expression_statement") return null;

  const parts: string[] = [];
  let argsNode: TreeSitterNode | null = null;

  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (!child || child.type === ";") continue;

    if (child.type === "identifier" || child.type === "type_identifier") {
      parts.push(child.text);
      continue;
    }

    if (child.type === "this" || child.type === "super") {
      parts.push(child.text);
      continue;
    }

    if (child.type === "selector") {
      const assignable = findChild(child, "unconditional_assignable_selector");
      if (assignable) {
        const id = findChild(assignable, "identifier");
        if (id) parts.push(id.text);
        continue;
      }

      const argumentPart = findChild(child, "argument_part");
      if (argumentPart) {
        argsNode = findChild(argumentPart, "arguments");
      }
    }
  }

  if (!argsNode || parts.length === 0) return null;

  if (parts.length === 1 && /^[A-Z]/.test(parts[0])) {
    return {
      callee: `new ${parts[0]}`,
      methodName: parts[0],
      constructorType: parts[0],
      argumentCount: countArguments(argsNode),
      callText: node.text.replace(/;$/, ""),
    };
  }

  const methodName = parts[parts.length - 1];
  const receiverParts = parts.slice(0, -1);
  const receiver = receiverParts.length > 0 ? receiverParts.join(".") : undefined;

  return {
    callee: receiver ? `${receiver}.${methodName}` : methodName,
    receiver,
    methodName,
    argumentCount: countArguments(argsNode),
    callText: node.text.replace(/;$/, ""),
  };
}
```

- [ ] **Step 3: Add owner, type, and binding helpers to `DartExtractor`**

Add these private methods inside the `DartExtractor` class before `extractFunctionNameFromBody()`:

```ts
  private isOwnerDeclaration(node: TreeSitterNode): boolean {
    return (
      node.type === "class_definition" ||
      node.type === "mixin_declaration" ||
      node.type === "extension_declaration" ||
      node.type === "enum_declaration"
    );
  }

  private extractOwnerName(node: TreeSitterNode): string | null {
    return findChild(node, "identifier")?.text ?? null;
  }

  private extractKnownTypes(rootNode: TreeSitterNode): Map<string, string> {
    const knownTypes = new Map<string, string>();

    for (let i = 0; i < rootNode.childCount; i++) {
      const child = rootNode.child(i);
      if (!child) continue;

      if (this.isOwnerDeclaration(child)) {
        const name = this.extractOwnerName(child);
        if (name) knownTypes.set(name, name);
      }

      if (child.type === "import_or_export") {
        const libraryImport = findChild(child, "library_import");
        const spec = libraryImport ? findChild(libraryImport, "import_specification") : null;
        const uriNode = spec ? findDescendant(spec, "string_literal") : null;
        const combinator = spec ? findChild(spec, "combinator") : null;
        const specifiers = extractCombinatorSpecifiers(combinator);
        if (uriNode && specifiers) {
          const uri = extractUriString(uriNode);
          for (const specifier of specifiers) {
            knownTypes.set(specifier, `${uri}.${specifier}`);
          }
        }
      }
    }

    return knownTypes;
  }

  private bindClassFields(
    ownerNode: TreeSitterNode,
    typeScopes: TypeScopeStack,
    typeContext: { knownTypes: Map<string, string> },
  ): Map<string, TypeBinding> {
    const fields = new Map<string, TypeBinding>();
    const body = findChild(ownerNode, "class_body");
    if (!body) return fields;

    for (let i = 0; i < body.childCount; i++) {
      const child = body.child(i);
      if (!child) continue;
      const fieldInfo = extractFieldInfo(child);
      if (!fieldInfo?.type) continue;
      const binding = this.bindNamedType(fieldInfo.name, fieldInfo.type, "field", typeScopes, typeContext);
      fields.set(fieldInfo.name, binding);
    }

    return fields;
  }

  private bindFunctionParameters(
    signatureNode: TreeSitterNode,
    typeScopes: TypeScopeStack,
    typeContext: { knownTypes: Map<string, string> },
  ): void {
    const paramsNode = findChild(signatureNode, "formal_parameter_list");
    if (!paramsNode) return;

    for (const param of findChildren(paramsNode, "formal_parameter")) {
      const identifiers = findChildren(param, "identifier");
      const nameNode = identifiers[identifiers.length - 1];
      if (!nameNode) continue;

      const typeNode = findChild(param, "type_identifier");
      if (!typeNode) continue;

      this.bindNamedType(nameNode.text, typeNode.text, "parameter", typeScopes, typeContext);
    }
  }

  private bindLocalVariable(
    node: TreeSitterNode,
    typeScopes: TypeScopeStack,
    typeContext: { knownTypes: Map<string, string> },
  ): void {
    const fieldInfo = extractFieldInfo(node);
    if (fieldInfo?.type) {
      this.bindNamedType(fieldInfo.name, fieldInfo.type, "local", typeScopes, typeContext);
      return;
    }

    const typeNode = findChild(node, "type_identifier");
    const identifiers = findChildren(node, "identifier");
    const nameNode = identifiers[identifiers.length - 1];
    if (!typeNode || !nameNode) return;

    this.bindNamedType(nameNode.text, typeNode.text, "local", typeScopes, typeContext);
  }

  private bindNamedType(
    name: string,
    type: string,
    kind: "field" | "parameter" | "local",
    typeScopes: TypeScopeStack,
    typeContext: { knownTypes: Map<string, string> },
  ): TypeBinding {
    const qualificationContext = {
      imports: new Map<string, string>(),
      knownTypes: typeContext.knownTypes,
    };
    const binding: TypeBinding = {
      type: simpleTypeName(type),
      qualifiedType: qualifyTypeName(type, qualificationContext),
      kind,
    };
    typeScopes.set(name, binding);
    return binding;
  }

  private resolveCall(
    call: DartCallParts,
    ownerName: string | undefined,
    typeScopes: TypeScopeStack,
    fieldScopes: Array<Map<string, TypeBinding>>,
    typeContext: { knownTypes: Map<string, string> },
  ): Partial<CallGraphEntry> {
    if (call.constructorType) {
      const receiverType = simpleTypeName(call.constructorType);
      const receiverQualifiedType = typeContext.knownTypes.get(receiverType) ?? receiverType;
      return {
        receiverType,
        receiverQualifiedType,
        calleeOwner: receiverType,
        calleeQualifiedName: buildQualifiedMethodName(receiverQualifiedType, call.methodName),
        resolutionKind: "static",
      };
    }

    if (!call.receiver) {
      return ownerName
        ? {
          calleeOwner: ownerName,
          calleeQualifiedName: buildQualifiedMethodName(ownerName, call.methodName),
          resolutionKind: "implicit-owner",
        }
        : { resolutionKind: "unresolved" };
    }

    if (call.receiver.startsWith("this.")) {
      const fieldName = call.receiver.slice("this.".length).split(".")[0];
      const binding = fieldScopes[fieldScopes.length - 1]?.get(fieldName);
      return binding
        ? this.buildResolvedReceiver(binding, call.methodName)
        : { resolutionKind: "unresolved" };
    }

    const binding = typeScopes.resolve(call.receiver);
    if (binding) {
      return this.buildResolvedReceiver(binding, call.methodName);
    }

    if (/^[A-Z]/.test(call.receiver)) {
      const receiverType = simpleTypeName(call.receiver);
      const receiverQualifiedType = typeContext.knownTypes.get(receiverType) ?? receiverType;
      return {
        receiverType,
        receiverQualifiedType,
        calleeOwner: receiverType,
        calleeQualifiedName: buildQualifiedMethodName(receiverQualifiedType, call.methodName),
        resolutionKind: "static",
      };
    }

    return { resolutionKind: "unresolved" };
  }

  private buildResolvedReceiver(
    binding: TypeBinding,
    methodName: string,
  ): Partial<CallGraphEntry> {
    return {
      receiverType: binding.type,
      ...(binding.qualifiedType ? { receiverQualifiedType: binding.qualifiedType } : {}),
      calleeOwner: binding.type,
      ...(binding.qualifiedType
        ? { calleeQualifiedName: buildQualifiedMethodName(binding.qualifiedType, methodName) }
        : {}),
      resolutionKind: binding.kind,
    };
  }

  private extractSignatureFromBody(body: TreeSitterNode): TreeSitterNode | null {
    const parent = body.parent;
    if (!parent) return null;

    for (let i = 0; i < parent.childCount; i++) {
      const child = parent.child(i);
      if (!child || child.id !== body.id) continue;

      for (let j = i - 1; j >= 0; j--) {
        const sibling = parent.child(j);
        if (!sibling) continue;
        if (
          sibling.type === "method_signature" ||
          sibling.type === "function_signature" ||
          sibling.type === "constructor_signature"
        ) {
          return sibling;
        }
        if (sibling.type !== "annotation") break;
      }
    }

    return null;
  }

  private extractFunctionNameFromSignature(signature: TreeSitterNode): string | null {
    if (signature.type === "method_signature") {
      return extractMethodName(signature);
    }
    if (signature.type === "function_signature") {
      return extractFunctionSignatureName(signature);
    }
    if (signature.type === "constructor_signature") {
      const identifiers = findChildren(signature, "identifier");
      if (identifiers.length >= 2) {
        return `${identifiers[0].text}.${identifiers[1].text}`;
      }
      if (identifiers.length === 1) {
        return identifiers[0].text;
      }
    }

    return null;
  }
```

- [ ] **Step 4: Replace `extractCallGraph()` with scoped traversal**

Replace the current `extractCallGraph(rootNode: TreeSitterNode): CallGraphEntry[]` method with:

```ts
  extractCallGraph(rootNode: TreeSitterNode): CallGraphEntry[] {
    const entries: CallGraphEntry[] = [];
    const functionStack: string[] = [];
    const ownerStack: string[] = [];
    const typeContext = { knownTypes: this.extractKnownTypes(rootNode) };
    const typeScopes = new TypeScopeStack();
    const fieldScopes: Array<Map<string, TypeBinding>> = [];

    const walkForCalls = (node: TreeSitterNode) => {
      let pushedName = false;
      let pushedOwner = false;
      let pushedTypeScope = false;
      let pushedFieldScope = false;
      let savedOwnerTypeScopes: Array<Map<string, TypeBinding>> | undefined;
      const savedFunctionStack = functionStack.slice();
      const isolatesFunctionScope = this.isOwnerDeclaration(node);

      if (isolatesFunctionScope) {
        functionStack.length = 0;
      }

      if (this.isOwnerDeclaration(node)) {
        const ownerName = this.extractOwnerName(node);
        if (ownerName) {
          ownerStack.push(ownerName);
          pushedOwner = true;
        }

        savedOwnerTypeScopes = typeScopes.snapshot();
        typeScopes.reset();
        typeScopes.pushScope();
        pushedTypeScope = true;
        fieldScopes.push(this.bindClassFields(node, typeScopes, typeContext));
        pushedFieldScope = true;
      }

      if (node.type === "function_body") {
        const signature = this.extractSignatureFromBody(node);
        const name = signature ? this.extractFunctionNameFromSignature(signature) : this.extractFunctionNameFromBody(node);
        if (name) {
          functionStack.push(name);
          pushedName = true;
        }
        typeScopes.pushScope();
        pushedTypeScope = true;
        if (signature) {
          this.bindFunctionParameters(signature, typeScopes, typeContext);
        }
      }

      if (node.type === "local_variable_declaration" || node.type === "initialized_variable_definition") {
        this.bindLocalVariable(node, typeScopes, typeContext);
      }

      if (node.type === "expression_statement" && functionStack.length > 0) {
        const call = extractCallPartsFromExpressionStatement(node);
        if (call) {
          const caller = functionStack[functionStack.length - 1];
          const callerOwner = ownerStack[ownerStack.length - 1];
          entries.push({
            caller,
            callee: call.callee,
            lineNumber: node.startPosition.row + 1,
            columnNumber: node.startPosition.column + 1,
            ...(call.receiver ? { receiver: call.receiver } : {}),
            methodName: call.methodName,
            argumentCount: call.argumentCount,
            callText: call.callText,
            ...(callerOwner ? { callerOwner } : {}),
            ...(callerOwner ? { callerQualifiedName: `${callerOwner}#${caller}` } : {}),
            ...this.resolveCall(call, callerOwner, typeScopes, fieldScopes, typeContext),
          });
        }
      }

      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child) walkForCalls(child);
      }

      if (pushedName) functionStack.pop();
      if (pushedOwner) ownerStack.pop();
      if (pushedFieldScope) fieldScopes.pop();
      if (pushedTypeScope) typeScopes.popScope();
      if (savedOwnerTypeScopes) typeScopes.restore(savedOwnerTypeScopes);
      if (isolatesFunctionScope) {
        functionStack.length = 0;
        functionStack.push(...savedFunctionStack);
      }
    };

    walkForCalls(rootNode);
    return entries;
  }
```

- [ ] **Step 5: Run focused Dart extractor tests**

Run:

```bash
pnpm --filter @understand-anything/core test -- src/plugins/extractors/__tests__/dart-extractor.test.ts
```

Expected: PASS for the full Dart extractor test file.

- [ ] **Step 6: Run neighboring extractor tests to catch shared helper regressions**

Run:

```bash
pnpm --filter @understand-anything/core test -- src/plugins/extractors/__tests__/java-extractor.test.ts src/plugins/extractors/__tests__/kotlin-extractor.test.ts src/plugins/extractors/__tests__/swift-extractor.test.ts src/plugins/extractors/__tests__/dart-extractor.test.ts
```

Expected: PASS. This verifies the shared `callgraph-resolution.ts` helpers still behave for JVM/Swift and the new Dart use does not require helper changes.

- [ ] **Step 7: Commit implementation**

```bash
git add understand-anything-plugin/packages/core/src/plugins/extractors/dart-extractor.ts
git commit -m "feat: resolve dart callgraph metadata"
```

### Task 3: Add `extract-structure.mjs` Dart Integration Coverage

**Files:**
- Modify: `understand-anything-plugin/src/__tests__/extract-structure.test.mjs`
- Test: `understand-anything-plugin/src/__tests__/extract-structure.test.mjs`

- [ ] **Step 1: Add integration test**

Append this test inside `describe("extract-structure CLI", () => { ... })`:

```js
  it("preserves resolved Dart call graph metadata in the output JSON", () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "ua-extract-structure-dart-"));

    try {
      const projectRoot = join(tempRoot, "project");
      mkdirSync(join(projectRoot, "lib"), { recursive: true });
      writeFileSync(
        join(projectRoot, "lib", "user_controller.dart"),
        `class UserApi {
  Future<String> fetch(String id) async => id;
}

class UserController {
  final UserApi api;
  UserController(this.api);

  void load() {
    api.fetch("field");
  }
}
`,
      );

      const inputPath = join(tempRoot, "input.json");
      const outputPath = join(tempRoot, "output.json");
      writeFileSync(
        inputPath,
        JSON.stringify({
          projectRoot,
          fileList: [{
            path: "lib/user_controller.dart",
            language: "dart",
            sizeLines: 12,
            fileCategory: "code",
          }],
          importData: {},
        }),
      );

      const scriptPath = join(process.cwd(), "understand-anything-plugin", "skills", "understand", "extract-structure.mjs");
      const result = spawnSync("node", [scriptPath, inputPath, outputPath], {
        cwd: process.cwd(),
        encoding: "utf-8",
      });

      expect(result.status, result.stderr).toBe(0);

      const output = JSON.parse(readFileSync(outputPath, "utf-8"));
      const fetchCall = output.results[0].callGraph.find((entry) => entry.callee === "api.fetch");

      expect(fetchCall).toEqual(expect.objectContaining({
        caller: "load",
        receiver: "api",
        methodName: "fetch",
        argumentCount: 1,
        receiverType: "UserApi",
        receiverQualifiedType: "UserApi",
        calleeOwner: "UserApi",
        calleeQualifiedName: "UserApi#fetch",
        resolutionKind: "field",
      }));
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
```

- [ ] **Step 2: Run integration test and verify pass**

Run:

```bash
pnpm test -- understand-anything-plugin/src/__tests__/extract-structure.test.mjs
```

Expected: PASS, including the existing Java metadata preservation test and the new Dart metadata preservation test.

- [ ] **Step 3: Commit integration coverage**

```bash
git add understand-anything-plugin/src/__tests__/extract-structure.test.mjs
git commit -m "test: preserve dart callgraph metadata in structure extraction"
```

### Task 4: Final Verification And Diff Review

**Files:**
- Verify: `understand-anything-plugin/packages/core/src/plugins/extractors/dart-extractor.ts`
- Verify: `understand-anything-plugin/packages/core/src/plugins/extractors/__tests__/dart-extractor.test.ts`
- Verify: `understand-anything-plugin/src/__tests__/extract-structure.test.mjs`

- [ ] **Step 1: Run TypeScript build for core**

Run:

```bash
pnpm --filter @understand-anything/core build
```

Expected: PASS with no TypeScript errors.

- [ ] **Step 2: Run full focused verification**

Run:

```bash
pnpm --filter @understand-anything/core test -- src/plugins/extractors/__tests__/dart-extractor.test.ts src/plugins/extractors/__tests__/java-extractor.test.ts src/plugins/extractors/__tests__/kotlin-extractor.test.ts src/plugins/extractors/__tests__/swift-extractor.test.ts
pnpm test -- understand-anything-plugin/src/__tests__/extract-structure.test.mjs
```

Expected: both commands PASS.

- [ ] **Step 3: Check whitespace and accidental edits**

Run:

```bash
git diff --check
git diff --stat
git diff -- understand-anything-plugin/packages/core/src/plugins/extractors/dart-extractor.ts understand-anything-plugin/packages/core/src/plugins/extractors/__tests__/dart-extractor.test.ts understand-anything-plugin/src/__tests__/extract-structure.test.mjs
```

Expected: `git diff --check` prints no errors. Diff should only touch the three planned files.

- [ ] **Step 4: Commit final verification marker if prior task commits were squashed manually**

If Tasks 1-3 were committed individually, skip this step. If implementation was done as one working-tree change, run:

```bash
git add understand-anything-plugin/packages/core/src/plugins/extractors/dart-extractor.ts understand-anything-plugin/packages/core/src/plugins/extractors/__tests__/dart-extractor.test.ts understand-anything-plugin/src/__tests__/extract-structure.test.mjs
git commit -m "feat: add resolved dart ast callgraph parsing"
```

Expected: one commit contains only Dart AST parser changes and related tests.

## Self-Review

- Spec coverage: The plan adds Dart AST callgraph metadata, keeps existing structure extraction, and verifies `extract-structure.mjs` output. It does not modify query skill, KG, DG, wiki, or server defaults.
- Placeholder scan: No deferred implementation markers are present in the task steps.
- Type consistency: All added fields match `CallGraphEntry` in `understand-anything-plugin/packages/core/src/types.ts`; helper types reuse `TypeScopeStack` and `TypeBinding` from `callgraph-resolution.ts`.
