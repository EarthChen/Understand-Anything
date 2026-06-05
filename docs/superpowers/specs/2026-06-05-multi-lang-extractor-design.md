# Multi-Language Extractor Design: Kotlin, Dart/Flutter, Objective-C

**Date:** 2026-06-05
**Status:** Proposed
**Author:** AI Assistant (brainstorming session)

## 1. Background & Motivation

The `extract-structure` pipeline uses tree-sitter to deterministically extract structural metadata from source files. The Java extractor was recently enhanced to capture annotations, inheritance (superclass/interfaces), and typed properties — enabling the `cross-service-matcher` to discover RPC relationships without relying solely on LLM inference.

Three additional languages are needed for complete coverage of the user's codebase:

| Language | Use Case |
|----------|----------|
| **Kotlin** | Spring Boot / Android services (shares JVM ecosystem with Java) |
| **Dart/Flutter** | Mobile applications built with Flutter |
| **Objective-C** | iOS/macOS legacy applications |

All three must extract the **same enhanced metadata** as Java: annotations/decorators, superclass, implemented interfaces/protocols, and typed field properties.

## 2. Current State

| Component | Java | Kotlin | Dart | Objective-C |
|-----------|------|--------|------|-------------|
| Language config (`languages/configs/`) | `java.ts` with `treeSitter` | `kotlin.ts` (no `treeSitter` field) | Missing | Missing |
| Extractor (`plugins/extractors/`) | `java-extractor.ts` (enhanced) | Missing | Missing | Missing |
| WASM grammar (npm) | `tree-sitter-java` | `@tree-sitter-grammars/tree-sitter-kotlin` | Needs compilation | `tree-sitter-objc` |
| Tests | 39 tests (14 enhanced) | Missing | Missing | Missing |

## 3. Design

### 3.1. Approach

**Independent extractors per language** (following existing codebase pattern).

Each language gets its own `*-extractor.ts` file implementing the `LanguageExtractor` interface. All extractors reuse `base-extractor.ts` utility functions (`findChild`, `findChildren`, `traverse`) and the shared types `AnnotationInfo` / `PropertyInfo` from `types.ts`.

No new abstractions, base classes, or architecture changes. This is the same pattern used by all 9 existing extractors.

### 3.2. Kotlin Extractor

**WASM Package:** `@tree-sitter-grammars/tree-sitter-kotlin` (v1.1.0, pre-built `.wasm`)

**Language Config Changes** (`languages/configs/kotlin.ts`):

Add `treeSitter` field:
```typescript
treeSitter: {
  wasmPackage: "@tree-sitter-grammars/tree-sitter-kotlin",
  wasmFile: "tree-sitter-kotlin.wasm",
}
```

**AST Mapping:**

| Kotlin AST Node | StructuralAnalysis Field | Notes |
|-----------------|-------------------------|-------|
| `class_declaration` | `classes[]` | Includes data/sealed/enum classes |
| `object_declaration` | `classes[]` | Singletons and companion objects |
| `function_declaration` | `functions[]` | Top-level and member functions |
| `property_declaration` | `properties[]` + `typedProperties[]` | `val`/`var` fields |
| `import_header` | `imports[]` | Inside `import_list` |
| Visibility modifiers | `exports[]` | `public`/`internal` = exported |

**Enhanced Metadata Extraction:**

- **Annotations:** Kotlin annotations are in `modifiers` → `annotation` nodes. Extract `@Component`, `@Service`, `@RequestMapping`, etc.
- **Superclass:** From delegation specifiers — the first `user_type` after `:` that is not in `super_interfaces`.
- **Interfaces:** From delegation specifiers — listed after `class Name :` (separated from superclass by position).
- **Typed Properties:** From `property_declaration` with type annotations: `val name: String` → `{ name: "name", type: "String" }`.

**Kotlin-Specific Subtleties:**

1. **Primary constructor parameters:** `data class User(val name: String)` — the constructor params ARE the class properties. Extract them both as `typedProperties[]` and as constructor function params.
2. **Companion objects:** `companion object { }` contents should be extracted as class members.
3. **Extension functions:** `fun String.foo()` — extract as a regular function; the receiver type is part of the name context but not the standard function schema.

### 3.3. Dart/Flutter Extractor

**WASM Package:** Compiled from `UserNobody14/tree-sitter-dart` using `tree-sitter-cli`

**Compilation Steps:**
```bash
pnpm add -D tree-sitter-cli
git clone https://github.com/UserNobody14/tree-sitter-dart /tmp/tree-sitter-dart
npx tree-sitter build --wasm /tmp/tree-sitter-dart
# Copy tree-sitter-dart.wasm to packages/core/grammars/ or vendor/
```

**New Language Config** (`languages/configs/dart.ts`):
```typescript
export const dartConfig = {
  id: "dart",
  displayName: "Dart",
  extensions: [".dart"],
  treeSitter: {
    wasmPackage: "<local-path-or-vendored>",
    wasmFile: "tree-sitter-dart.wasm",
  },
  concepts: [
    "null safety", "mixins", "extensions", "async/await",
    "isolates", "streams", "generics", "factory constructors",
    "named constructors", "cascades", "records", "patterns",
  ],
  filePatterns: {
    entryPoints: ["lib/main.dart", "bin/main.dart"],
    barrels: ["lib/src/exports.dart"],
    tests: ["*_test.dart", "test/**/*.dart"],
    config: ["pubspec.yaml", "analysis_options.yaml"],
  },
} satisfies LanguageConfig;
```

**AST Mapping:**

| Dart AST Node | StructuralAnalysis Field | Notes |
|---------------|-------------------------|-------|
| `class_definition` | `classes[]` | Standard classes |
| `mixin_declaration` | `classes[]` | Dart mixins |
| `extension_declaration` | `classes[]` | Extension methods |
| `enum_declaration` | `classes[]` | Enhanced enums |
| `function_signature` | `functions[]` | Top-level functions |
| `method_signature` | `functions[]` | Class methods |
| `declaration` (variable) | `properties[]` + `typedProperties[]` | Class fields |
| `import_specification` | `imports[]` | `import 'package:...'` |
| `export_specification` | `exports[]` | `export 'package:...'` |

**Enhanced Metadata Extraction:**

- **Annotations (metadata):** Dart's `@annotation` are `metadata` nodes. Extract `@override`, `@Deprecated`, `@JsonSerializable`, Flutter annotations like `@immutable`.
- **Superclass:** From `superclass` clause in `class_definition`.
- **Interfaces:** From `interfaces` clause (`implements`).
- **Mixins:** From `mixins` clause (`with`). Store in `interfaces[]` with the other implemented types.
- **Typed Properties:** From field declarations with type annotations.

**Dart-Specific Subtleties:**

1. **Privacy by naming:** Members starting with `_` are private. Don't include in `exports[]`.
2. **Import system:** Dart imports entire libraries, not individual classes. `import 'package:flutter/material.dart'` → source = `package:flutter/material.dart`, specifiers = `["*"]` (or use `show`/`hide` if present).
3. **Named constructors:** `ClassName.named()` — extract as function with name `ClassName.named`.
4. **Factory constructors:** `factory ClassName()` — extract as function.

### 3.4. Objective-C Extractor

**WASM Package:** `tree-sitter-objc` (npm, pre-built `.wasm`)

**New Language Config** (`languages/configs/objc.ts`):
```typescript
export const objcConfig = {
  id: "objc",
  displayName: "Objective-C",
  extensions: [".m", ".mm", ".h"],
  treeSitter: {
    wasmPackage: "tree-sitter-objc",
    wasmFile: "tree-sitter-objc.wasm",
  },
  concepts: [
    "protocols", "categories", "message passing",
    "properties", "memory management", "blocks",
    "KVC/KVO", "runtime", "delegation", "notifications",
  ],
  filePatterns: {
    entryPoints: ["main.m", "AppDelegate.m"],
    barrels: [],
    tests: ["*Tests.m", "Tests/**/*.m"],
    config: ["Podfile", "*.xcodeproj/project.pbxproj"],
  },
} satisfies LanguageConfig;
```

**AST Mapping:**

| ObjC AST Node | StructuralAnalysis Field | Notes |
|---------------|-------------------------|-------|
| `class_interface` | `classes[]` | `@interface Foo : Bar <Proto>` |
| `class_implementation` | `classes[]` | `@implementation Foo` |
| `protocol_declaration` | `classes[]` | `@protocol` (like Java interface) |
| `category_interface` | `classes[]` | `@interface NSString (MyCategory)` |
| `method_declaration` | `functions[]` | `- (void)doThing:(id)arg` |
| `property_declaration` | `typedProperties[]` | `@property (nonatomic) NSString *name` |
| `preproc_import` | `imports[]` | `#import <...>` and `#import "..."` |

**Enhanced Metadata Extraction:**

- **Annotations/Attributes:** ObjC uses compiler attributes (`__attribute__((deprecated))`) and common macros (`IBOutlet`, `IBAction`, `NS_DESIGNATED_INITIALIZER`). Extract these as annotations.
- **Superclass:** From `superclass_reference` in `class_interface`: `@interface Dog : Animal`.
- **Protocols:** From `protocol_qualifiers` in `class_interface`: `@interface Foo : NSObject <MyProtocol, AnotherProtocol>`. Map to `interfaces[]`.
- **Typed Properties:** From `@property` declarations with type info and attributes.

**ObjC-Specific Subtleties:**

1. **Method naming (selectors):** `- (void)insertObject:(id)obj atIndex:(NSUInteger)idx` → function name = `insertObject:atIndex:`. The colons are part of the selector and must be preserved.
2. **`@interface` vs `@implementation`:** Both exist for the same class. Do NOT merge — extract what's available per-file. `.h` files give declarations (superclass, protocols), `.m` files give implementations (method bodies for call graph).
3. **Categories:** `@interface NSString (MyCategory)` — extract as a class entry with name `NSString(MyCategory)`.
4. **No visibility modifiers:** Everything in a `.h` file is public by convention. For exports: all declarations from `class_interface` and `protocol_declaration` are exports.

## 4. File Changes

### New Files (9)

| File | Description |
|------|-------------|
| `packages/core/src/plugins/extractors/kotlin-extractor.ts` | Kotlin structural extractor |
| `packages/core/src/plugins/extractors/dart-extractor.ts` | Dart structural extractor |
| `packages/core/src/plugins/extractors/objc-extractor.ts` | Objective-C structural extractor |
| `packages/core/src/plugins/extractors/__tests__/kotlin-extractor.test.ts` | Kotlin extractor tests |
| `packages/core/src/plugins/extractors/__tests__/dart-extractor.test.ts` | Dart extractor tests |
| `packages/core/src/plugins/extractors/__tests__/objc-extractor.test.ts` | Objective-C extractor tests |
| `packages/core/src/languages/configs/dart.ts` | Dart language config |
| `packages/core/src/languages/configs/objc.ts` | Objective-C language config |
| `packages/core/grammars/tree-sitter-dart.wasm` | Compiled Dart WASM grammar |

### Modified Files (4)

| File | Change |
|------|--------|
| `packages/core/src/plugins/extractors/index.ts` | Register 3 new extractors |
| `packages/core/src/languages/configs/index.ts` | Register dart + objc configs |
| `packages/core/src/languages/configs/kotlin.ts` | Add `treeSitter` field |
| `packages/core/package.json` | Add `@tree-sitter-grammars/tree-sitter-kotlin`, `tree-sitter-objc` deps |

## 5. Risk Matrix

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Dart WASM compilation fails | High (blocks Dart) | Medium | Fallback: use `@sengac/tree-sitter-dart` or defer Dart |
| tree-sitter-objc WASM depends on tree-sitter-c | Medium (blocks ObjC) | Low | The npm package bundles C grammar inline |
| Kotlin AST structure differs from expected | Low | Low | Verify with AST debugging (same approach used for Java) |
| New WASM packages increase install size by ~13 MB | Low | Certain | Acceptable for dev tool; document in CLAUDE.md |

## 6. Acceptance Criteria

- [ ] Kotlin extractor passes 20+ tests covering: functions, classes, annotations, inheritance, imports, exports, call graph, typed properties, data classes, companion objects
- [ ] Dart extractor passes 20+ tests covering: functions, classes, metadata/annotations, inheritance, mixins, imports, exports, call graph, typed properties, privacy convention
- [ ] ObjC extractor passes 20+ tests covering: method declarations, class interfaces, protocols, properties, imports, superclass, protocol conformance, call graph, categories, selectors
- [ ] All new extractors registered in `index.ts` and language configs registered in `configs/index.ts`
- [ ] `pnpm --filter @understand-anything/core build` succeeds with no TypeScript errors
- [ ] `pnpm --filter @understand-anything/core test` passes (all existing + new tests)
- [ ] `extract-structure.mjs` correctly passes through enhanced fields for Kotlin/Dart/ObjC files

## 7. Out of Scope

- Updating `file-analyzer.md` agent prompt with language-specific annotation tables (follow-up task)
- Enhancing existing extractors (TypeScript, Python, Go, etc.) with annotations/inheritance (separate effort)
- Swift extractor (language config exists but no tree-sitter or extractor — future work)
- IDE-specific integration testing
