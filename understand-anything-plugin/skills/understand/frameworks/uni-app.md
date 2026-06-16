# uni-app Framework Addendum

> Injected into file-analyzer and architecture-analyzer prompts when uni-app is detected.
> Do NOT use as a standalone prompt — always appended to the base prompt template.

## uni-app Project Structure

When analyzing a uni-app project, apply these additional conventions on top of the base analysis rules. uni-app supports WeChat/Alipay/Baidu/Douyin mini-programs, H5, and native App from a single codebase.

### Canonical File Roles

| File / Pattern | Role | Tags |
|---|---|---|
| `App.vue` | Root application component — global lifecycle hooks | `entry-point`, `ui` |
| `main.js`, `main.ts` | Application bootstrap — creates Vue app, registers plugins | `entry-point`, `config` |
| `manifest.json` | App configuration — appid, platform settings, permissions | `config` |
| `pages.json` | Route and window configuration — page paths, tab bar, navigation style | `config`, `routing` |
| `pages/*.vue`, `pages/**/*.vue` | Page components (auto-routed from `pages.json`) | `ui`, `screen` |
| `components/*.vue`, `components/**/*.vue` | Reusable components (easycom auto-import) | `ui`, `component` |
| `store/*.js`, `store/*.ts` | Vuex or Pinia state management | `service`, `state` |
| `api/*.js`, `api/*.ts` | Backend API client modules | `service`, `api` |
| `utils/*.js`, `utils/*.ts` | Utility functions | `utility` |
| `static/*` | Static assets (images, fonts) | `asset` |
| `unpackage/*` | Build output directory | `build-output` |
| `platforms/*.vue`, `platforms/**/*.vue` | Platform-specific page overrides | `ui`, `platform` |
| `nativeplugins/*` | Native plugin bridges | `service`, `native` |
| `wxcomponents/*.js`, `wxcomponents/*.vue` | WeChat native components | `ui`, `native` |
| `tests/*.spec.js` | Tests | `test` |

### Edge Patterns to Look For

**Page registration** — When `pages.json` defines page paths, create `configures` edges from the route config to each page component.

**Navigation calls** — When a page calls `uni.navigateTo()`, `uni.redirectTo()`, `uni.switchTab()`, or `uni.navigateBack()`, create `navigates_to` edges between source and destination pages.

**Tab bar routing** — When `pages.json` defines `tabBar.list`, create `routes` edges from the tab bar config to each tab page.

**Component usage** — When a page uses easycom-registered or explicit components, create `contains` edges from the page to each component.

**Store usage** — When a page imports and uses a Vuex/Pinia store, create `depends_on` edges from the page to the store.

**API client calls** — When a page or component calls an API module function (wrapping `uni.request`), create `calls` edges from the consumer to the API module.

**Conditional compilation** — Files or code blocks with `#ifdef MP-WEIXIN`, `#ifdef H5`, `#ifdef APP-PLUS` indicate platform-specific implementations — tag these with the target platform.

### Architectural Layers for uni-app

Assign nodes to these layers when detected:

| Layer ID | Layer Name | What Goes Here |
|---|---|---|
| `layer:ui` | UI Layer | Pages, components, platform-specific UI |
| `layer:state` | State Layer | Vuex/Pinia stores |
| `layer:service` | Service Layer | API clients, service modules |
| `layer:config` | Config Layer | pages.json, manifest.json, App.vue, main.js |
| `layer:utility` | Utility Layer | Utils, helpers, constants |
| `layer:native` | Native Layer | Native plugins, platform-specific components (wxcomponents) |
| `layer:test` | Test Layer | Tests |

### Notable Patterns to Capture in languageLesson

- **Conditional compilation**: `#ifdef MP-WEIXIN` / `#ifdef H5` / `#ifdef APP-PLUS` enables platform-specific code blocks — critical for understanding which code runs where
- **pages.json as single source of truth**: All page routes, navigation bar style, and tab bar configuration defined in one file
- **uni API**: `uni.request()`, `uni.navigateTo()`, `uni.getStorageSync()` — the framework's cross-platform API layer wrapping platform-specific implementations
- **easycom auto-registration**: Components in `components/` directory with naming convention `component-name.vue` are auto-imported without explicit registration
- **Vue 2 vs Vue 3 composition**: uni-app supports both — newer projects use `<script setup>` with Composition API
- **Mini-program component bridges**: `wxcomponents/` directory contains WeChat native components used directly in templates — these bypass Vue's virtual DOM
- **uni_modules**: Plugin marketplace modules with their own `package.json` — similar to npm packages but scoped to uni-app ecosystem
