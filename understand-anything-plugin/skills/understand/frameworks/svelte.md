# Svelte Framework Addendum

> Injected into file-analyzer and architecture-analyzer prompts when Svelte is detected.
> Do NOT use as a standalone prompt — always appended to the base prompt template.

## Svelte Project Structure

When analyzing a Svelte project, apply these additional conventions on top of the base analysis rules.

### Canonical File Roles

| File / Pattern | Role | Tags |
|---|---|---|
| `src/routes/+layout.svelte` | Root layout component — wraps all pages | `entry-point`, `ui`, `layout` |
| `src/routes/+page.svelte` | Home page component | `ui`, `screen` |
| `src/routes/**/+page.svelte` | File-based route pages (SvelteKit) | `ui`, `screen` |
| `src/routes/**/+page.server.ts` | Server-side load functions and form actions | `service`, `endpoint` |
| `src/routes/**/+layout.server.ts` | Server-side layout load functions | `service`, `endpoint` |
| `src/routes/**/+page.ts` | Universal (client+server) load functions | `service` |
| `src/lib/components/*.svelte` | Reusable components (`$lib` alias) | `ui`, `component` |
| `src/lib/stores/*.ts` | Svelte writable/readable stores | `service`, `state` |
| `src/lib/server/*.ts` | Server-only utilities (database, auth) | `service`, `data-access` |
| `src/lib/utils/*.ts` | Shared utility functions | `utility` |
| `src/lib/types/*.ts` | TypeScript type definitions | `type-definition` |
| `src/hooks.server.ts` | Server hooks — handle, handleError | `config`, `middleware` |
| `src/hooks.client.ts` | Client hooks | `config` |
| `src/service-worker.ts` | Service worker for offline/PWA | `service` |
| `src/app.html` | HTML shell template | `config` |
| `src/app.d.ts` | App-level type declarations | `type-definition` |
| `svelte.config.js` | SvelteKit configuration | `config` |
| `vite.config.ts` | Vite build configuration | `config` |
| `static/*` | Static assets served as-is | `asset` |
| `tests/*.test.ts`, `*.spec.ts` | Tests | `test` |

### Edge Patterns to Look For

**Page → layout** — Every page is wrapped by `+layout.svelte` in its parent directory — create `contains` edges from layout to page.

**Page → load function** — When `+page.svelte` has a corresponding `+page.server.ts` or `+page.ts`, create `depends_on` edges from the page to the load function.

**Load function → server util** — When a load function imports from `$lib/server/`, create `calls` edges from the load function to the server utility.

**Component usage** — When a `.svelte` file imports and uses a component, create `contains` edges from parent to child.

**Store subscription** — When a component uses `$storeName` reactive syntax or `get(store)`, create `depends_on` edges from the consumer to the store.

**Form actions** — When `+page.server.ts` exports `actions`, create `calls` edges from the form handler to the action function.

**Navigation** — When a component uses `<a href>`, `goto()`, or `invalidate()`, create `navigates_to` edges between pages.

### Architectural Layers for Svelte

Assign nodes to these layers when detected:

| Layer ID | Layer Name | What Goes Here |
|---|---|---|
| `layer:ui` | UI Layer | Pages, layouts, components |
| `layer:service` | Service Layer | Load functions, stores, API clients |
| `layer:server` | Server Layer | Server load functions, server utils, hooks |
| `layer:middleware` | Middleware Layer | Server hooks (handle, handleError) |
| `layer:config` | Config Layer | svelte.config, vite.config, app.html |
| `layer:utility` | Utility Layer | Utils, types, helpers |
| `layer:test` | Test Layer | Tests, test utilities |

### Notable Patterns to Capture in languageLesson

- **File-based routing (SvelteKit)**: `src/routes/` directory structure maps directly to URL paths — `+page.svelte` is the page, `+layout.svelte` is the wrapper
- **Load functions**: `+page.server.ts` runs only on server; `+page.ts` runs on both — they provide data to pages via the `data` prop
- **Form actions**: Server-side form handling via `actions` export in `+page.server.ts` — progressive enhancement for form submissions
- **Reactive stores**: `writable()`, `readable()`, `derived()` — the `$` prefix in templates creates auto-subscriptions
- **Svelte 5 runes (newer projects)**: `$state()`, `$derived()`, `$effect()` replace stores — check for `.svelte.ts` files
- **Server hooks**: `hooks.server.ts` with `handle` function wraps all requests — used for auth, logging, error handling
- **`$lib` alias**: `import { x } from '$lib/...'` maps to `src/lib/` — the standard way to import shared code
