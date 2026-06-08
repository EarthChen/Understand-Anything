# Kotlin Language Prompt Snippet

## Key Concepts

- **Annotations**: Metadata markers (`@DubboService`, `@RestController`, `@Autowired`, `@KafkaListener`) identical to Java annotations — Kotlin uses the same JVM annotation model
- **Coroutines and Flow**: Structured concurrency with suspending functions; Flow for reactive streams
- **Data Classes**: Auto-generated `equals`, `hashCode`, `toString`, `copy`, and destructuring; primary constructor properties are typed fields
- **Sealed Classes/Interfaces**: Restricted hierarchies enabling exhaustive `when` expressions
- **Extension Functions**: Add methods to existing classes without inheritance or wrappers
- **Null Safety**: `?.` safe call, `!!` non-null assertion, `?:` Elvis operator for default values
- **Delegation (by keyword)**: Delegate interface implementation or property access to another object
- **DSL Builders**: Lambda-with-receiver syntax enabling type-safe builder patterns
- **Inline Functions and Reified Types**: Inline for zero-overhead lambdas; reified for runtime type access
- **Companion Objects**: Named or anonymous singleton associated with a class (replaces static members)
- **Object Declarations**: Singleton pattern built into the language (`object Foo { ... }`)
- **Scope Functions**: `let`, `run`, `apply`, `also`, `with` for concise object configuration and transformation

## Import Patterns

- `import package.ClassName` — import a specific class
- `import package.*` — wildcard import of all declarations in a package
- `import package.function as alias` — import with alias to resolve naming conflicts

## File Patterns

- `build.gradle.kts` — Gradle build script using Kotlin DSL
- `Application.kt` — application entry point (Spring Boot or Ktor)
- `src/main/kotlin/` — main source root following Gradle conventions
- `src/test/kotlin/` — test source root with matching package structure
- `settings.gradle.kts` — multi-module project configuration

## Common Frameworks

- **Spring Boot (Kotlin)** — Kotlin-first support with coroutines and DSL extensions; same RPC annotations as Java (`@DubboService`, `@DubboReference`, `@FeignClient`, `@KafkaListener`)
- **Ktor** — Kotlin-native async web framework from JetBrains
- **Jetpack Compose** — Declarative UI toolkit for Android using composable functions
- **Exposed** — Lightweight SQL framework with type-safe DSL and DAO patterns
- **Koin** — Pragmatic dependency injection framework using Kotlin DSL

## API Call Detection

When analyzing mobile/client code, identify HTTP API calls and create `consumes_api` edges with `{ method, path }` metadata:

- **Retrofit interfaces**: `@GET("/api/orders")`, `@POST("/api/orders/{id}")` → Create `endpoint` node for the API path, `consumes_api` edge from the interface method to the endpoint. Metadata: `{ "method": "GET", "path": "/api/orders" }`
- **OkHttp direct calls**: `Request.Builder().url("https://...").post(body).build()` → Extract URL path and HTTP method
- **Ktor client**: `client.get("https://...") {}`, `client.post("https://...") {}` → Extract path and method from function name
- **Dynamic URL construction**: If URL is built from variables/constants, extract the static path template; use `{param}` for path parameters (e.g., `/api/orders/{orderId}`)

For each unique API path discovered, create an `endpoint` node and a `consumes_api` edge from the calling function/class to that endpoint.

## Example Language Notes

> Uses sealed class hierarchy with `when` exhaustive matching to handle all possible
> API response states. The compiler enforces that every variant is covered, eliminating
> the need for a fallback `else` branch and catching missing cases at compile time.
>
> Extension functions allow adding utilities like `String.toSlug()` without modifying
> the original class — keeping the extension discoverable through IDE auto-complete.
