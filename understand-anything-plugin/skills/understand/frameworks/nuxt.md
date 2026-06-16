# Nuxt Framework Addendum

> Injected into file-analyzer and architecture-analyzer prompts when Nuxt is detected.
> Do NOT use as a standalone prompt — always appended to the base prompt template.

## Nuxt Project Structure

When analyzing a Nuxt project, apply these additional conventions on top of the base analysis rules.

### Canonical File Roles

| File / Pattern | Role | Tags |
|---|---|---|
| `app.vue` | Root application component | `entry-point`, `ui` |
| `nuxt.config.ts` | Nuxt configuration — modules, plugins, runtime config | `config` |
| `pages/*.vue`, `pages/**/*.vue` | File-based route pages (auto-routed) | `ui`, `screen` |
| `layouts/*.vue` | Layout components wrapping pages | `ui`, `layout` |
| `components/*.vue`, `components/**/*.vue` | Auto-imported components | `ui`, `component` |
| `composables/*.ts`, `composables/*.js` | Auto-imported composable functions | `service`, `utility` |
| `server/api/*.ts`, `server/api/**/*.ts` | Nitro server API routes | `service`, `endpoint` |
| `server/middleware/*.ts` | Server middleware | `service`, `middleware` |
| `server/utils/*.ts` | Server-side utility functions | `utility` |
| `middleware/*.ts`, `middleware/*.js` | Route middleware (client/server) | `config`, `middleware` |
| `plugins/*.ts`, `plugins/*.js` | Nuxt plugins — extend app on initialization | `config` |
| `stores/*.ts`, `store/*.ts` | Pinia stores (with `@pinia/nuxt`) | `service`, `state` |
| `utils/*.ts`, `helpers/*.ts` | Client-side utility functions | `utility` |
| `public/*` | Static assets served at root | `asset` |
| `assets/*` | Build-processed assets (CSS, images) | `asset` |
| `.nuxt/types/*.d.ts` | Auto-generated type definitions | `type-definition` |
| `tests/*.spec.ts`, `tests/*.test.ts` | Tests | `test` |

### Edge Patterns to Look For

**Page → layout** — When a page sets `definePageMeta({ layout: 'custom' })`, create `contains` edges from the layout to the page.

**Page → composable** — When a page or component imports and calls a composable (`useAuth()`, `useApi()`), create `depends_on` edges from the consumer to the composable.

**Page → component** — When a page uses auto-imported components in its template, create `contains` edges from the page to each component.

**Middleware → page** — When `definePageMeta({ middleware: 'auth' })` is set, create `middleware` edges from the middleware to the page.

**Server API → server utils** — When a server API route imports server utilities, create `calls` edges from the API handler to the utility.

**Plugin → composable/store** — When a plugin provides a composable or store globally, create `configures` edges from the plugin.

**Composable → store** — When a composable uses a Pinia store, create `depends_on` edges from the composable to the store.

### Architectural Layers for Nuxt

Assign nodes to these layers when detected:

| Layer ID | Layer Name | What Goes Here |
|---|---|---|
| `layer:ui` | UI Layer | Pages, layouts, components |
| `layer:service` | Service Layer | Composables, stores, API clients |
| `layer:server` | Server Layer | Server API routes, server middleware, server utils |
| `layer:middleware` | Middleware Layer | Route middleware (auth, logging) |
| `layer:config` | Config Layer | nuxt.config, plugins, module configurations |
| `layer:utility` | Utility Layer | Utils, helpers, constants |
| `layer:test` | Test Layer | Tests, test utilities |

### Notable Patterns to Capture in languageLesson

- **File-based routing**: Pages in `pages/` directory are automatically registered as routes — `pages/users/[id].vue` becomes `/users/:id`
- **Auto-imports**: Components in `components/`, composables in `composables/`, and utils in `utils/` are auto-imported — no explicit import statements needed
- **Nitro server engine**: `server/` directory provides full-stack capabilities — API routes, middleware, and utils run server-side via Nitro
- **`useFetch` / `useAsyncData`**: SSR-compatible data fetching composables that handle hydration, caching, and deduplication
- **Route middleware**: `definePageMeta({ middleware })` applies middleware to specific pages — runs on both client and server navigation
- **Nuxt modules**: Extend Nuxt capabilities via `modules` in config — each module can add composables, components, plugins, and server routes
- **Runtime config**: `useRuntimeConfig()` provides environment-specific configuration accessible on both client and server
