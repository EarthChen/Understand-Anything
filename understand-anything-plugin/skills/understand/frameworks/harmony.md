# HarmonyOS Framework Addendum

> Injected into file-analyzer and architecture-analyzer prompts when HarmonyOS is detected.
> Do NOT use as a standalone prompt — always appended to the base prompt template.

## HarmonyOS Project Structure

When analyzing a HarmonyOS (ArkTS/ArkUI) project, apply these additional conventions on top of the base analysis rules.

### Canonical File Roles

| File / Pattern | Role | Tags |
|---|---|---|
| `entry/src/main/ets/entryability/EntryAbility.ets` | Application entry ability | `entry-point` |
| `entry/src/main/ets/pages/*.ets` | Page-level UI components (ArkUI pages) | `ui`, `screen` |
| `entry/src/main/ets/components/*.ets` | Reusable ArkUI components | `ui`, `component` |
| `entry/src/main/ets/viewmodel/*.ets` | ViewModel — state management for pages | `service`, `state` |
| `entry/src/main/ets/model/*.ets` | Data models and entities | `data-model` |
| `entry/src/main/ets/service/*.ets` | Business logic and API services | `service`, `api` |
| `entry/src/main/ets/utils/*.ets` | Utility functions | `utility` |
| `entry/src/main/ets/common/*.ets` | Shared constants and configurations | `config` |
| `entry/src/main/resources/base/profile/main_pages.json` | Page route configuration | `config`, `routing` |
| `entry/src/main/module.json5` | Module configuration (abilities, permissions) | `config` |
| `AppScope/app.json5` | Application-level configuration | `config` |
| `library/src/main/ets/*.ets` | Library module code | `service` |
| `*Test.ets` | Tests | `test` |

### Edge Patterns to Look For

**Page routing** — When `main_pages.json` registers page paths, create `configures` edges from the route config to each page component.

**Navigation calls** — When a page calls `router.pushUrl()` or `router.replaceUrl()`, create `navigates_to` edges from the source page to the target page.

**Ability → Page** — When an Ability launches or navigates to a page, create `routes` edges from the Ability to the page.

**Component composition** — When a page or component uses `@Builder` or custom `@Component` structs in its `build()` method, create `contains` edges from parent to child.

**ViewModel observation** — When a page uses `@Observed` / `@ObjectLink` or `@State` / `@Link` to observe a ViewModel, create `depends_on` edges from the page to the ViewModel.

**Service calls** — When a ViewModel or page invokes a service function (HTTP requests via `http` module), create `calls` edges from the consumer to the service.

**Dependency injection** — When `@Inject` or `@Provide` decorators wire dependencies, create `injects` edges between provider and consumer.

### Architectural Layers for HarmonyOS

Assign nodes to these layers when detected:

| Layer ID | Layer Name | What Goes Here |
|---|---|---|
| `layer:presentation` | Presentation Layer | Pages, ArkUI Components, Abilities |
| `layer:domain` | Domain Layer | ViewModels, business logic, use cases |
| `layer:data` | Data Layer | Services, API clients, data models, persistence |
| `layer:navigation` | Navigation Layer | Router configuration, deep link handlers |
| `layer:utility` | Utility Layer | Utils, common modules, constants |
| `layer:test` | Test Layer | Unit tests, instrumented tests |

### Notable Patterns to Capture in languageLesson

- **ArkUI declarative UI**: `@Component` structs with `build()` methods define UI — `@State`, `@Link`, `@Prop` manage component state reactivity
- **Ability-based lifecycle**: `EntryAbility` extends `UIAbility` — lifecycle callbacks (`onCreate`, `onWindowStageCreate`, `onForeground`) control app state
- **Router-based navigation**: `router.pushUrl({ url: 'pages/Target' })` navigates between pages registered in `main_pages.json`
- **@Observed/@ObjectLink**: Deep observation pattern for nested object state changes — `@Observed` on class, `@ObjectLink` in component
- **PersistentStorage and AppStorage**: Global state management — `AppStorage` for in-memory shared state, `PersistentStorage` for persisted preferences
- **http module for networking**: `@ohos.net.http` provides HTTP client capabilities — requests are made through `http.createHttp().request()`
- **TaskPool for concurrency**: Heavy computation offloaded to `TaskPool` to avoid blocking the UI thread
