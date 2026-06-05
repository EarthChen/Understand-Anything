# Flutter Framework Addendum

## Widget Architecture

- **StatelessWidget**: Immutable UI component; `build()` is the single composition point
- **StatefulWidget + State**: Mutable widget with lifecycle (`initState`, `dispose`, `didUpdateWidget`)
- **InheritedWidget**: Dependency injection via widget tree; foundation of `Provider`, `Riverpod`
- **Widget Tree**: Declarative composition — parent widgets pass data down, children emit events up

## Navigation Patterns

- **Navigator 2.0 (Router API)**: `GoRouter`, `AutoRoute` for declarative, URL-based navigation
- **Navigator 1.0 (imperative)**: `Navigator.push()` / `Navigator.pop()` for simple stack-based routing
- **Named Routes**: `MaterialApp.routes` or `onGenerateRoute` for route-to-widget mapping

## State Management

- **Provider / Riverpod**: Reactive state with `ChangeNotifier`, `StateNotifier`, or `AsyncNotifier`
- **Bloc / Cubit**: Event-driven pattern separating UI events from business logic
- **GetX**: Lightweight reactive state + dependency injection + routing

## Code Generation Patterns

- **`build_runner`**: Code generation tool triggered by `dart run build_runner build`
- **`*.g.dart`**: Generated files (JSON serialization, Freezed, Hive adapters) — should NOT be analyzed for structural intent
- **`part` / `part of`**: File-level inclusion for generated code; treated as same library

## Key Annotations

- `@override` — method override marker (structural: `inherits` edge)
- `@JsonSerializable()` — JSON codec via `json_serializable` package
- `@immutable` — enforces immutability on widget classes
- `@freezed` / `@unfreezed` — Freezed data class generation
- `@riverpod` — Riverpod provider code generation
- `@HiveType()` / `@HiveField()` — Hive local database schema

## File Conventions

- `lib/main.dart` — application entry point (`runApp()`)
- `lib/src/` — private implementation (not directly importable by consumers)
- `lib/widgets/` or `lib/components/` — reusable UI widgets
- `lib/models/` or `lib/entities/` — data models / domain entities
- `lib/services/` — business logic and API clients
- `lib/providers/` or `lib/blocs/` — state management
- `test/*_test.dart` — unit and widget tests
- `integration_test/` — integration tests running on device/emulator

## Example Language Notes

> Flutter widget tree follows a strictly declarative composition model. The
> `build()` method return type determines what renders — composition happens
> through nesting widgets, not inheritance. `const` constructors on stateless
> widgets enable the framework's rebuild optimization (skip subtrees that
> haven't changed).
