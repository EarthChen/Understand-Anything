# Electron Framework Addendum

> Injected into file-analyzer and architecture-analyzer prompts when Electron is detected.
> Do NOT use as a standalone prompt — always appended to the base prompt template.

## Electron Project Structure

When analyzing an Electron project, apply these additional conventions on top of the base analysis rules.

### Canonical File Roles

| File / Pattern | Role | Tags |
|---|---|---|
| `main.js`, `main.ts`, `src/main/*.ts` | Main process entry — creates BrowserWindow, manages app lifecycle | `entry-point`, `config` |
| `preload.js`, `preload.ts`, `src/preload/*.ts` | Preload script — bridges main and renderer via `contextBridge` | `config`, `bridge` |
| `renderer/`, `src/renderer/` | Renderer process code (React/Vue/Vanilla) | `ui` |
| `renderer/App.tsx`, `renderer/App.vue` | Root renderer component | `ui`, `entry-point` |
| `ipc/*.ts`, `ipc-handlers/*.ts` | IPC handler definitions (main process side) | `service`, `ipc` |
| `services/*.ts` (in main) | Main process services (file system, native APIs) | `service` |
| `store/*.ts`, `store/*.ts` (in renderer) | Renderer-side state management | `service`, `state` |
| `components/*.tsx`, `components/*.vue` | Renderer UI components | `ui`, `component` |
| `pages/*.tsx`, `pages/*.vue` | Renderer page components | `ui`, `screen` |
| `utils/*.ts` | Shared utilities (used by both main and renderer) | `utility` |
| `native/*.ts`, `native/*.node` | Native Node.js addons | `service`, `native` |
| `electron-builder.yml`, `electron-builder.json` | Build and packaging configuration | `config` |
| `forge.config.js`, `forge.config.ts` | Electron Forge configuration | `config` |
| `package.json` | Main entry point declaration (`main` field) | `config` |
| `tests/*.test.ts`, `tests/*.spec.ts` | Tests | `test` |

### Edge Patterns to Look For

**Main → BrowserWindow** — When main process creates a BrowserWindow with a `preload` script and `loadURL`/`loadFile`, create `configures` edges from main to the preload and renderer entry.

**IPC invoke/handle** — When renderer calls `ipcRenderer.invoke('channel')` and main handles via `ipcMain.handle('channel')`, create `calls` edges from the renderer caller to the main handler.

**IPC send/on** — When renderer sends via `ipcRenderer.send()` and main listens via `ipcMain.on()`, create `publishes`/`subscribes` edges.

**Preload → contextBridge** — When preload exposes APIs via `contextBridge.exposeInMainWorld()`, create `provides_api` edges from the preload to the exposed API surface.

**Renderer → preload API** — When renderer code uses `window.electronAPI.*` methods exposed by preload, create `depends_on` edges from the renderer to the preload API.

**Main → native service** — When main process invokes native Node.js APIs or system dialogs, create `calls` edges from main to the service.

**Menu/Tray → main handler** — When menu items or tray icons trigger IPC messages, create `navigates_to` or `calls` edges to the handler.

### Architectural Layers for Electron

Assign nodes to these layers when detected:

| Layer ID | Layer Name | What Goes Here |
|---|---|---|
| `layer:main` | Main Process | Main entry, IPC handlers, native services, app lifecycle |
| `layer:bridge` | Bridge Layer | Preload scripts, contextBridge definitions |
| `layer:ui` | Renderer UI Layer | Components, pages, layouts in renderer process |
| `layer:state` | State Layer | Renderer-side stores (Redux, Zustand, Pinia) |
| `layer:service` | Service Layer | API clients, shared services |
| `layer:config` | Config Layer | Build config, forge config, package.json |
| `layer:utility` | Utility Layer | Shared utils, types |
| `layer:native` | Native Layer | Native modules, .node addons |
| `layer:test` | Test Layer | Tests, Spectron/Playwright E2E tests |

### Notable Patterns to Capture in languageLesson

- **Process isolation**: Main and renderer are separate processes — communication only via IPC channels defined in preload
- **contextBridge security**: `contextBridge.exposeInMainWorld()` is the secure way to expose main-process APIs to renderer — never use `nodeIntegration: true`
- **IPC channel contracts**: Channel names (strings) form the API contract between main and renderer — these should be traced as edges
- **BrowserWindow configuration**: `webPreferences` controls security settings (contextIsolation, nodeIntegration, sandbox)
- **Electron Forge / electron-builder**: Build tooling for packaging, signing, and auto-updates — affects deployment but not runtime analysis
- **Shared code**: `utils/` and `types/` directories may be imported by both main and renderer — track which process uses which utility
- **Tauri alternative**: If the project uses Tauri instead of Electron, the pattern is similar but with Rust backend instead of Node.js main process
