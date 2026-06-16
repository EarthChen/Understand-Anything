# Frontend Flow Extraction Strategy

Extract user journey flows from web frontend codebases (Vue, React, Next.js, Nuxt, Svelte) by tracing navigation, state, API, and render edges through the knowledge graph.

## Entry Points

Identify flow triggers from page-level KG nodes:

| Trigger | KG signals | Example |
|---------|------------|---------|
| Page routes | Vue Router `path` definitions, React Router `<Route>` elements, file-based routing `pages/` | `/login`, `/dashboard/orders` |
| Screen components | Top-level page/screen components registered with the router | `LoginPage.vue`, `OrderListPage.tsx` |
| User interactions | Modal flows, wizard steps, drawer panels that start a distinct journey | `CheckoutDrawer`, `OnboardingWizard` |

Each flow starts at one entry point. `domainMeta.entryPoint` is a human label (e.g., `LoginPage.vue` or `/login`); actual edge tracing uses KG node IDs from the edges list.

## Edge Tracing Strategy

For each entry point, trace four edge types in order:

### 1. TRACE NAVIGATION

Find `routes` edges from router/page nodes to discover where the user goes next.

```
LoginPage.vue → routes → HomePage.vue
```

### 2. TRACE STATE

Find `depends_on` edges from pages to stores (Pinia, Vuex, Redux, Zustand) to identify state mutations and reads.

```
LoginPage.vue → depends_on → stores/auth.ts
```

### 3. TRACE API CALLS

Find `consumes_api` or `calls` edges from hooks/composables/services to API endpoints.

```
composables/useAuth.ts → consumes_api → POST /api/login
api/auth.ts → calls → authService.login()
```

### 4. TRACE RENDER

Find `contains` edges from pages to child components to map UI composition.

```
LoginPage.vue → contains → LoginForm.vue
```

Follow each trace depth 2–3 to build a complete user journey. Every flow MUST have at least 4 distinct steps derived from actual KG edges.

## entryType Values

Use these values in `domainMeta.entryType`:

| Value | When to use |
|-------|-------------|
| `navigation` | Flow triggered by route change or programmatic navigation |
| `screen` | Flow starting at a page/screen component mount |
| `interaction` | Flow triggered by a user action (button click, form submit, modal open) |

## Domain Splitting Heuristic

Group frontend domains by **feature module** — each domain bundles:

- Pages / screens for the feature
- Feature-specific components (NOT shared `components/`)
- Feature-specific store slice
- API calls used exclusively by that feature

Shared `components/`, `utils/`, and `hooks/` are cross-cutting infrastructure — do NOT create separate domains for them.

Example groupings:

- `pages/orders/` + `components/orders/` + `stores/orderStore.ts` + `api/orders.ts` → **Order Management**
- `pages/auth/` + `components/auth/` + `stores/auth.ts` + `api/auth.ts` → **Authentication**

## Step Naming Rules

Use concrete UI/business action names derived from component names, hook summaries, and API purposes.

### BANNED Step Names

- "Validate Input" / "校验输入"
- "Execute Business Logic" / "执行业务逻辑"
- "Build Response" / "构建响应"
- "Render Component" / "渲染组件" (too generic — name the specific UI action)
- Any single-word generic name like "Process", "Handle", "Execute", "Submit"

Instead: "渲染登录表单", "校验用户凭证", "调用认证API", "存储认证令牌", "导航到首页".

### Additional Rules

- **ACCURATE lineRange**: Each step's `lineRange` MUST come from the target KG node's `lineRange` field. Fabricated ranges are FORBIDDEN.
- **sourceNode field**: Add `"sourceNode": "<KG node ID>"` to each step.
- **PREFER DISTINCT filePath**: Steps should reference different files when the journey crosses component/store/API boundaries.

## Worked Example — Vue Login Flow

```
Entry: LoginPage.vue (entryType: "screen")
Step 1: "渲染登录表单" → LoginForm.vue (contains edge)
Step 2: "校验用户凭证" → composables/useAuth.ts (depends_on edge)
Step 3: "调用认证API" → api/auth.ts → POST /api/login (consumes_api edge)
Step 4: "存储认证令牌" → stores/auth.ts (depends_on edge, state mutation)
Step 5: "导航到首页" → router → HomePage.vue (routes edge)
```

Corresponding JSON steps:

```json
[
  {"id": "step:login:render-form", "name": "渲染登录表单", "summary": "展示用户名和密码输入表单", "sourceNode": "component:...LoginForm.vue", "filePath": "...LoginForm.vue", "lineRange": [1, 85]},
  {"id": "step:login:validate-credentials", "name": "校验用户凭证", "summary": "验证用户名和密码格式及非空", "sourceNode": "function:...useAuth.ts:validateCredentials", "filePath": "...composables/useAuth.ts", "lineRange": [12, 34]},
  {"id": "step:login:call-auth-api", "name": "调用认证API", "summary": "向服务端发送登录请求", "sourceNode": "function:...auth.ts:login", "filePath": "...api/auth.ts", "lineRange": [5, 22]},
  {"id": "step:login:store-token", "name": "存储认证令牌", "summary": "将返回的 JWT 写入 auth store", "sourceNode": "function:...auth.ts:setToken", "filePath": "...stores/auth.ts", "lineRange": [18, 30]},
  {"id": "step:login:navigate-home", "name": "导航到首页", "summary": "登录成功后跳转到首页", "sourceNode": "component:...HomePage.vue", "filePath": "...pages/HomePage.vue", "lineRange": [1, 40]}
]
```

## Language Requirements

> If the dispatch contains a language directive (e.g., `--language en`), follow that directive instead. The defaults below apply to Chinese-language projects.

- `flow.name`: English Title Case (e.g., "User Login", "Checkout Flow")
- `flow.summary`: Chinese, one sentence describing the user journey (MUST contain ≥2 CJK characters)
- `step.name`: Chinese, specific UI/business action
- `step.summary`: Chinese, describing what this step accomplishes for the user
