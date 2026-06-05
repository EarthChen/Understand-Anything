# Dart Language Prompt Snippet

## Key Concepts

- **Null Safety**: Sound null safety with `?` nullable types, `!` null assertion, `late` deferred initialization
- **Metadata Annotations**: `@override`, `@deprecated`, `@JsonSerializable`, `@immutable` for code generation and tooling
- **Mixins**: Reusable class bodies via `with` keyword enabling multiple inheritance of behavior
- **Extension Methods**: Add functionality to existing types without subclassing (`extension on Type`)
- **Async/Await and Futures**: Single-threaded concurrency with `Future`, `Stream`, and `async*` generators
- **Isolates**: True parallelism via message-passing between isolated memory heaps
- **Named and Factory Constructors**: `ClassName.named()` patterns and `factory` for controlled instantiation
- **Cascade Notation**: `..` operator for chaining method calls on the same object
- **Privacy by Convention**: Underscore prefix (`_name`) makes declarations library-private (no explicit access modifiers)
- **Generics**: Reified generics available at runtime (unlike Java's type erasure)

## Import Patterns

- `import 'package:name/path.dart'` — import a pub package
- `import 'relative/path.dart'` — relative import within the same package
- `import 'dart:core'` — import a Dart SDK library
- `export 'path.dart'` — re-export declarations from another file
- `import 'path.dart' show X, Y` — selective import
- `import 'path.dart' hide Z` — import everything except specific names

## File Patterns

- `lib/main.dart` — Flutter application entry point
- `lib/` — public library source (importable by other packages)
- `lib/src/` — private implementation (convention: not imported directly by consumers)
- `test/*_test.dart` — test files (matched by `dart test`)
- `pubspec.yaml` — package manifest with dependencies and metadata
- `analysis_options.yaml` — linter and analyzer configuration
- `build.yaml` — build_runner / code generation configuration

## Common Frameworks

- **Flutter** — Cross-platform UI toolkit with widget-based declarative rendering
- **Riverpod** — Reactive state management with compile-time safety and provider scoping
- **Bloc/Cubit** — Event-driven state management following the BLoC pattern
- **GetX** — Lightweight framework combining state management, routing, and dependency injection
- **Freezed** — Code generation for immutable data classes and union types
- **json_serializable** — JSON serialization/deserialization via code generation

## Example Language Notes

> Uses `@JsonSerializable()` annotation with `json_serializable` package for automated
> JSON encoding/decoding. The `part` directive and `*.g.dart` files indicate build_runner
> code generation — these generated files should not be analyzed for structural intent.
>
> Flutter widget hierarchy uses `StatelessWidget` / `StatefulWidget` base classes. The
> `build()` method return type (`Widget`) is the primary composition point where child
> widgets are assembled into the render tree.
