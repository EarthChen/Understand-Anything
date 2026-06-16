# Android Framework Addendum

> Injected into file-analyzer and architecture-analyzer prompts when Android is detected.
> Do NOT use as a standalone prompt — always appended to the base prompt template.

## Android Project Structure

When analyzing an Android project, apply these additional conventions on top of the base analysis rules.

### Canonical File Roles

| File / Pattern | Role | Tags |
|---|---|---|
| `app/src/main/java/**/MainActivity.kt` or `.java` | Application entry Activity | `entry-point`, `ui` |
| `*Activity.kt` | Screen-level Activity | `ui`, `screen` |
| `*Fragment.kt` | Sub-screen Fragment | `ui`, `component` |
| `*ViewModel.kt` | MVVM ViewModel — mediates between UI and domain | `service`, `state` |
| `*Repository.kt` | Data access abstraction | `service`, `data-access` |
| `*UseCase.kt`, `*Interactor.kt` | Domain layer use case | `service`, `domain` |
| `*Dao.kt`, `*Dao.java` | Room database access object | `data-access` |
| `*Entity.kt`, `*Model.kt` in `data/model/` | Data model | `data-model` |
| `*Module.kt` (with @Module) | Hilt/Dagger DI module | `config`, `di` |
| `*Screen.kt` (with @Composable) | Jetpack Compose screen | `ui`, `screen` |
| `*Component.kt` (with @Composable) | Reusable Compose component | `ui`, `component` |
| `AndroidManifest.xml` | App configuration and Activity declarations | `config` |
| `navigation/*.xml`, `NavGraph.kt` | Navigation graph | `config`, `routing` |
| `build.gradle.kts`, `build.gradle` | Build configuration | `config` |
| `*ApiService.kt`, `*Api.kt` (with Retrofit annotations) | Network API interface | `service`, `api` |
| `*Adapter.kt`, `*ViewHolder.kt` | RecyclerView adapter | `ui`, `utility` |
| `*Worker.kt` (WorkManager) | Background task | `service` |
| `res/layout/*.xml` | XML layout files | `ui`, `markup` |
| `*Test.kt`, `*AndroidTest.kt` | Tests | `test` |

### Edge Patterns to Look For

**Activity/Fragment → ViewModel** — When an Activity or Fragment obtains a ViewModel via `ViewModelProvider` or Hilt injection, create `depends_on` edges from the UI component to the ViewModel.

**ViewModel → Repository/UseCase** — When a ViewModel receives a Repository or UseCase through constructor injection, create `depends_on` edges from the ViewModel to those dependencies.

**Repository → DAO** — When a Repository calls DAO methods for database queries, create `calls` edges from the Repository to the DAO.

**Repository → ApiService** — When a Repository invokes Retrofit API interface methods for network requests, create `calls` edges from the Repository to the ApiService.

**Activity → Fragment** — When an Activity hosts Fragments via Fragment transactions, create `contains` edges from the Activity to each Fragment.

**Compose NavHost → Screen composable** — When a NavHost registers composable destinations in its navigation graph, create `routes` edges from the NavHost to each Screen composable.

**Activity → Activity** — When an Activity launches another Activity via Intent, create `navigates_to` edges between the source and destination Activities.

**Screen → Screen** — When Compose navigation calls `NavController.navigate()` to transition between screens, create `navigates_to` edges between the source and destination Screen composables.

**@Module → provided class** — When a Hilt/Dagger `@Module` provides or binds a class via `@Provides` or `@Binds`, create `configures` edges from the module to each provisioned class.

**Worker → Repository** — When a WorkManager Worker depends on a Repository for background data operations, create `depends_on` edges from the Worker to the Repository.

### Architectural Layers for Android

Assign nodes to these layers when detected:

| Layer ID | Layer Name | What Goes Here |
|---|---|---|
| `layer:presentation` | Presentation Layer | Activities, Fragments, Compose Screens, Adapters, ViewHolders, XML layouts |
| `layer:domain` | Domain Layer | UseCases, Interactors, domain models, business rules |
| `layer:data` | Data Layer | Repositories, DAOs, API services, data sources, entities |
| `layer:navigation` | Navigation Layer | NavGraphs, navigation XML, deep link handlers, Intent routing |
| `layer:di` | DI Layer | Hilt/Dagger modules, component definitions |
| `layer:test` | Test Layer | Unit tests, instrumented tests, test utilities |

### Notable Patterns to Capture in languageLesson

- **Hilt dependency injection**: `@HiltAndroidApp` → `@AndroidEntryPoint` → `@Inject constructor` — creates an implicit dependency graph across the app
- **Coroutines + Flow for reactive data**: ViewModel exposes StateFlow/SharedFlow, UI collects; the flow is: UI event → ViewModel function → suspend call → Repository → emit new state
- **Room database with DAO pattern**: `@Entity` defines tables, `@Dao` defines queries, Room generates implementations — DAO methods are the only way to access persisted data
- **Jetpack Compose navigation**: NavHost defines route graph, each composable screen is a destination — NavController orchestrates transitions
- **Clean Architecture layering**: Presentation (ViewModel) → Domain (UseCase) → Data (Repository) with dependency rule — inner layers never import outer layers
- **WorkManager for reliable background work**: Worker subclasses define tasks that survive process death
