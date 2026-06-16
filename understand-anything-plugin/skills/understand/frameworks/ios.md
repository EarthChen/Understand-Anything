# iOS Framework Addendum

> Injected into file-analyzer and architecture-analyzer prompts when iOS (SwiftUI/UIKit) is detected.
> Do NOT use as a standalone prompt — always appended to the base prompt template.

## iOS Project Structure

When analyzing an iOS project, apply these additional conventions on top of the base analysis rules.

### Canonical File Roles

| File / Pattern | Role | Tags |
|---|---|---|
| `AppDelegate.swift` | UIKit app lifecycle entry point | `entry-point`, `config` |
| `*App.swift` (with @main) | SwiftUI app entry point | `entry-point`, `config` |
| `SceneDelegate.swift` | Scene lifecycle (multi-window) | `entry-point`, `config` |
| `*ViewController.swift` | UIKit screen controller | `ui`, `screen` |
| `*View.swift` (struct conforming to View) | SwiftUI view | `ui`, `screen` or `component` |
| `*ViewModel.swift`, `*VM.swift` | ViewModel (ObservableObject) | `service`, `state` |
| `*Coordinator.swift` | Navigation coordinator | `routing` |
| `*Repository.swift` | Data access abstraction | `service`, `data-access` |
| `*Service.swift`, `*Manager.swift` | Business logic service | `service` |
| `*UseCase.swift`, `*Interactor.swift` | Domain use case | `service`, `domain` |
| `*Model.swift`, `*Entity.swift` | Data model | `data-model` |
| `*.storyboard`, `*.xib` | Interface Builder layouts | `ui`, `config` |
| `*Router.swift`, `*Navigator.swift` | Navigation routing | `routing` |
| `*API.swift`, `*NetworkService.swift` | Network layer | `service`, `api` |
| `*Store.swift` | State store (Redux-like) | `service`, `state` |
| `Podfile`, `Package.swift` | Dependency configuration | `config` |
| `*Tests.swift`, `*Spec.swift` | Tests | `test` |
| `Info.plist` | App configuration | `config` |

### Edge Patterns to Look For

**ViewController → ChildViewController** — When a parent ViewController embeds a child via `addChild(_:)` or an embed segue, create `contains` edges from the parent to each child ViewController.

**View → ViewModel** — When a SwiftUI View declares a ViewModel via `@ObservedObject` or `@StateObject`, create `depends_on` edges from the View to the ViewModel.

**ViewModel → Service/Repository** — When a ViewModel receives a Service or Repository through constructor injection or direct construction, create `depends_on` edges from the ViewModel to those dependencies.

**Service → Repository** — When a Service delegates data access to a Repository, create `calls` edges from the Service to the Repository.

**Coordinator → ViewController/View** — When a Coordinator presents or pushes a ViewController or SwiftUI View onto the navigation stack, create `navigates_to` edges from the Coordinator to the destination.

**NavigationStack/NavigationLink → Destination View** — When a NavigationStack registers destinations or a NavigationLink targets a view, create `routes` edges from the navigation container to each destination View.

**Storyboard segue → destination VC** — When a storyboard segue connects one ViewController to another, create `navigates_to` edges from the source ViewController to the destination ViewController.

**View → Subview** — When a SwiftUI View composes child views in its `body`, create `contains` edges from the parent View to each subview. These edges represent the SwiftUI view hierarchy.

**@EnvironmentObject injection** — When a View reads shared state via `@EnvironmentObject`, create `depends_on` edges from the View to the environment-provided type. This captures implicit dependency injection through the SwiftUI environment.

**Store → Publisher** — When a Store exposes Combine publishers for state changes, create `publishes` edges from the Store to each publisher or downstream subscriber chain.

### Architectural Layers for iOS

Assign nodes to these layers when detected:

| Layer ID | Layer Name | What Goes Here |
|---|---|---|
| `layer:presentation` | Presentation Layer | ViewControllers, SwiftUI Views, Storyboards, XIBs |
| `layer:domain` | Domain Layer | UseCases, Services, Managers, domain models, business rules |
| `layer:data` | Data Layer | Repositories, Network services, Core Data stack, UserDefaults wrappers |
| `layer:navigation` | Navigation Layer | Coordinators, Routers, NavigationStack definitions |
| `layer:test` | Test Layer | Unit tests, UI tests, test utilities |

### Notable Patterns to Capture in languageLesson

- **SwiftUI reactive state**: `@State` for local, `@ObservedObject`/`@StateObject` for ViewModel, `@EnvironmentObject` for deep injection — property wrapper changes trigger view re-render
- **Coordinator pattern**: separates navigation logic from view controllers — each coordinator owns a navigation controller and child coordinators
- **Combine publishers for async data flow**: ViewModel subscribes to repository publishers, transforms data, exposes `@Published` properties to views
- **Protocol-oriented design**: define behavior contracts with protocols, provide defaults via extensions — enables testability through protocol mocking
- **Core Data stack**: `NSPersistentContainer` manages the object graph, `NSManagedObjectContext` for read/write — changes propagate via `NSFetchedResultsController` or Combine
- **Dependency injection via init**: constructor injection preferred over service locators — protocols define dependencies, concrete types injected at composition root
