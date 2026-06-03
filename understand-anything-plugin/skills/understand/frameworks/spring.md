# Spring Boot Framework Addendum

> Injected into file-analyzer and architecture-analyzer prompts when Spring Boot is detected.
> Do NOT use as a standalone prompt — always appended to the base prompt template.

## Spring Boot Project Structure

When analyzing a Spring Boot project, apply these additional conventions on top of the base analysis rules.

### Canonical File Roles

| File / Pattern | Role | Tags |
|---|---|---|
| `*Application.java`, `*Application.kt` | Application entry point — `@SpringBootApplication` class with `main()` method | `entry-point`, `config` |
| `*Controller.java`, `*RestController.java` | REST controllers — handle HTTP requests, delegate to services | `api-handler` |
| `*Service.java` | Service interfaces — define business operation contracts | `service` |
| `*ServiceImpl.java` | Service implementations — contain business logic | `service` |
| `*Repository.java` | Spring Data repositories — data access interfaces extending JpaRepository/CrudRepository | `data-model` |
| `*Entity.java` | JPA entities — map to database tables via `@Entity` annotation | `data-model` |
| `*DTO.java`, `*Request.java`, `*Response.java` | Data transfer objects — request/response payloads | `type-definition` |
| `*Config.java`, `*Configuration.java` | Configuration classes — `@Configuration` beans, security config, web config | `config` |
| `*Filter.java` | Servlet filters — intercept requests before they reach controllers | `middleware` |
| `*Interceptor.java` | Handler interceptors — pre/post processing around controller methods | `middleware` |
| `*Advice.java`, `*ExceptionHandler.java` | Controller advice — global exception handling and response wrapping | `middleware` |
| `*Mapper.java` | Object mappers — convert between entities and DTOs (MapStruct, ModelMapper) | `utility` |
| `application.yml`, `application.properties` | Application configuration — profiles, datasource, server settings | `config` |
| `*Test.java`, `*Tests.java`, `*IT.java` | Unit tests, integration tests | `test` |

### Edge Patterns to Look For

**@Autowired injection** — When a class injects a dependency via `@Autowired`, constructor injection, or `@Inject`, create `depends_on` edges from the consumer to the injected bean. Constructor injection is preferred and most common in modern Spring.

**Controller-Service-Repository chain** — The canonical call chain is `@RestController` -> `@Service` -> `@Repository`. Create `depends_on` edges along this chain to show the layered architecture.

**@Entity relationships** — When entities define `@OneToMany`, `@ManyToOne`, `@OneToOne`, or `@ManyToMany` annotations, create `depends_on` edges between entity classes with descriptions indicating the relationship type and direction.

**@Configuration bean definitions** — When a `@Configuration` class defines `@Bean` methods, create `configures` edges from the configuration class to the types it produces. These beans become available for injection throughout the application.

### RPC Annotation Patterns (MOA / Dubbo)

When the project config contains `rpcAnnotations`, apply these additional rules to recognize RPC service boundaries:

**MOA framework (`@MoaProvider` / `@MoaConsumer`):**

| Annotation | Role | Node Handling | Edge |
|---|---|---|---|
| `@MoaProvider` on a class implementing an interface | RPC service provider | Classify node as `service` type, add tags `rpc-provider`, `moa`; summary MUST list the interface name and exposed methods | `provides_rpc` edge: provider class → interface node (weight: 0.9) |
| `@MoaConsumer` on an injected field/parameter | RPC service consumer | Keep the containing class's normal type; add tag `rpc-consumer` | `consumes_rpc` edge: consumer class → interface node (weight: 0.8) |

**Dubbo framework (`@DubboService` / `@DubboReference`):**

| Annotation | Role | Node Handling | Edge |
|---|---|---|---|
| `@DubboService` on a class implementing an interface | RPC service provider | Same as `@MoaProvider` above, with tag `dubbo` | `provides_rpc` edge (weight: 0.9) |
| `@DubboReference` on an injected field | RPC service consumer | Same as `@MoaConsumer` above | `consumes_rpc` edge (weight: 0.8) |

**Edge weight conventions for RPC:**
- `provides_rpc`: 0.9 (strong structural relationship, same as `inherits`)
- `consumes_rpc`: 0.8 (runtime dependency, same as `calls`)

**Important behavioral rules:**
1. When a class annotated with `@MoaProvider` or `@DubboService` implements an interface, create a `service` node for that class (not a `file` or `class` node), with the interface name in the summary.
2. For `@MoaConsumer` / `@DubboReference` fields, create `consumes_rpc` edges from the class containing the injection to the interface being consumed. Do NOT create a plain `depends_on` edge for these — use `consumes_rpc` exclusively.
3. The interface node (target of both `provides_rpc` and `consumes_rpc`) uses the ID format `class:<path>:<InterfaceName>`. If the interface definition file is not in this batch, emit the edge anyway — the merge script will resolve or drop it.
4. In the provider node's summary, explicitly list all methods declared in the RPC interface (e.g., "Implements PaymentFacade RPC interface: createPayment(), queryPayment(), refund()"). This enables downstream cross-service matching at method level.

**Detection logic:** Only apply RPC annotation rules when the dispatch prompt includes `rpcAnnotations` configuration. If `rpcAnnotations` is absent or empty, treat `@MoaProvider`/`@MoaConsumer`/`@DubboService`/`@DubboReference` as ordinary annotations (plain `depends_on` edges).

### Architectural Layers for Spring Boot

Assign nodes to these layers when detected:

| Layer ID | Layer Name | What Goes Here |
|---|---|---|
| `layer:api` | API Layer | `*Controller.java`, REST endpoints, API documentation |
| `layer:service` | Service Layer | `*Service.java`, `*ServiceImpl.java`, business logic |
| `layer:data` | Data Layer | `*Repository.java`, `*Entity.java`, JPA mappings, database migrations |
| `layer:types` | Types Layer | `*DTO.java`, `*Request.java`, `*Response.java`, shared value objects |
| `layer:config` | Config Layer | `*Configuration.java`, `application.yml`, security config, `*Application.java` |
| `layer:middleware` | Middleware Layer | `*Filter.java`, `*Interceptor.java`, `*Advice.java`, security filters |
| `layer:test` | Test Layer | `*Test.java`, `*Tests.java`, `*IT.java`, test configuration |

### Notable Patterns to Capture in languageLesson

- **Dependency injection via constructor injection**: Spring favors constructor injection over field injection (`@Autowired` on fields) — it makes dependencies explicit, supports immutability, and simplifies testing
- **Layered architecture (Controller -> Service -> Repository)**: Spring Boot applications follow a strict layered pattern where controllers handle HTTP, services contain business logic, and repositories manage persistence
- **Spring Security filter chain**: Security is implemented as a chain of servlet filters — `SecurityFilterChain` beans configure authentication, authorization, CORS, and CSRF protection
- **JPA entity lifecycle**: Entities transition through states (transient, managed, detached, removed) — understanding this lifecycle is essential for tracing data flow through the persistence layer
- **AOP for cross-cutting concerns**: `@Aspect` classes with `@Before`, `@After`, and `@Around` advice inject behavior at join points — used for logging, transactions (`@Transactional`), and caching (`@Cacheable`)
