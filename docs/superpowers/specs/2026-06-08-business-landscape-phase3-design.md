# Spec 3 Design: CLI Query + Dashboard Adaptation

**PRD**: `cross-facet-domain-map.prd.md` — Milestones 3 & 4
**Status**: Approved
**Date**: 2026-06-08

## Scope

| Milestone | Outcome |
|-----------|---------|
| M3 — CLI Query | `/understand-query` skill + `ua_query.py` 通过 API Server 查询所有数据层 |
| M4 — Dashboard Adaptation | Business 模式 + 分层域图 + 跨切面边可视化 + 跨模式导航 |

## Design Decisions

| Aspect | Decision | Rationale |
|--------|----------|-----------|
| API Server Tech | Node.js (Express) | 复用现有 TS API 代码（wiki-api.ts, source-reader.ts），迁移成本最低 |
| Handler Architecture | 共享 handler 层，双部署（Vite embed + standalone Express） | Dashboard dev 单进程 DX + CLI/生产独立部署 |
| CLI Language | Python（仅标准库） | 零依赖，与现有管道脚本风格一致 |
| CLI 数据访问 | HTTP 调用 API Server（PRD 范围升级） | 面向未来中心化知识库架构，Dashboard 和 CLI 共用 server |
| CLI Output | JSON 默认，`--format=md` 可选 | Agent 消费 JSON 最自然，人类偶尔用 markdown |
| CLI Skill | `/understand-query`，手动启动 server | server 未运行时报错提示 |
| Dashboard Mode | 新增第四模式 "Business"，隐式检测 | 检测到 business-landscape/ 数据时激活 |
| Business View Layout | 分层布局（域分组 + 展开详情 + 跨切面连线） | 层次清晰，支持渐进式信息披露 |
| Dashboard Scope | Business View + Domain Detail + Cross-facet Edge | 完整 M4 |

## Architecture

### Layer 1: Shared API Handlers

从 `vite.config.ts` 的 ~400 行 middleware 中抽取业务逻辑为独立模块。

```
packages/dashboard/
├── src/api/
│   ├── handlers/
│   │   ├── graph.ts              ← 从 vite.config.ts 抽取
│   │   ├── wiki.ts               ← 复用 WikiDataService
│   │   ├── source.ts             ← 从 vite.config.ts 抽取
│   │   ├── business.ts           ← 新增：business-landscape API
│   │   └── auth.ts               ← token 校验逻辑
│   ├── types.ts                  ← API request/response 类型
│   ├── utils.ts                  ← 共享工具（findGraphFile, projectRoot 等）
│   └── index.ts                  ← 统一导出 + 路由注册
├── server.ts                     ← 新增：独立 Express 入口
├── vite.config.ts                ← 重构：调用 src/api/ handler
├── wiki-api.ts                   ← 保留（被 handlers/wiki.ts 引用）
└── source-reader.ts              ← 保留（被 handlers/source.ts 引用）
```

**Handler 接口**（框架无关）：

```typescript
interface ApiRequest {
  pathname: string;
  searchParams: URLSearchParams;
}

interface ApiResponse {
  statusCode: number;
  body: unknown;
}

type ApiHandler = (req: ApiRequest) => Promise<ApiResponse> | ApiResponse;

// router: pathname pattern → handler
interface ApiRouter {
  handle(req: ApiRequest): Promise<ApiResponse | null>;
}
```

### Layer 2a: Vite Middleware Adapter

重构后的 `vite.config.ts`：
- `configureServer` 仅做 HTTP 解析 → `ApiRequest` 转换 → 调用 router → 写响应
- token 校验逻辑移入 `auth.ts`
- 代码量从 ~400 行降到 ~50 行

### Layer 2b: Standalone Express Server

`server.ts`：
- 导入共享 handler（相同 `ApiRouter`）
- Express route → `ApiRequest` 转换 → 调用 router → 写响应
- CORS 配置（支持 CLI 跨域）
- 启动命令：`pnpm run serve`
- 默认端口：`3001`（`PORT` 环境变量可配）
- 启动时打印 access token URL

### Layer 3a: Dashboard React Frontend

**新增 ViewMode**: `"business"` 加入 `store.ts` 的 `ViewMode` union

**模式检测**（对齐 PRD §938-949）：
```
GET /api/business/domains 返回有效数据 → Business 模式可用
```

Business 模式与 Service/System/Wiki 并列，用户可在顶栏切换。

### Layer 3b: CLI Client

`skills/understand-query/ua_query.py`

通过 HTTP 调用 API Server，四个子命令映射到 API 端点。

## API Endpoints

### Existing (refactored, no behavior change)

| Endpoint | Source |
|----------|--------|
| `GET /knowledge-graph.json` | graph handler |
| `GET /domain-graph.json` | graph handler |
| `GET /system-graph.json` | graph handler |
| `GET /diff-overlay.json` | graph handler |
| `GET /meta.json` | graph handler |
| `GET /config.json` | graph handler |
| `GET /api/graph?service=X&file=Y` | graph handler |
| `GET /api/source?file=X` | source handler |
| `GET /api/wiki/*` | wiki handler |
| `GET /wiki/*` (legacy) | wiki handler |

### New (business-landscape)

| Endpoint | Data Source | Description |
|----------|-----------|-------------|
| `GET /api/business/domains` | `business-landscape/domains.json` | 业务域索引列表 |
| `GET /api/business/domains/:slug` | `business-landscape/domains/:slug.json` | 域详情（interactions, rules, facets） |
| `GET /api/business/cross-facet-links` | `business-landscape/cross-facet-links.json` | 跨切面关联关系 |
| `GET /api/business/overview` | 聚合 domains.json stats | 概览统计 |
| `GET /api/business/search?q=X` | 遍历 domains/*.json | 跨域搜索（子串匹配） |

## CLI Design

### Subcommands (aligned with PRD §790-832)

**`ua_query.py kg`** — 代码级查询：
```
python3 ua_query.py kg --service order-service --type node
python3 ua_query.py kg --service order-service --node "OrderController"
python3 ua_query.py kg --service order-service --type endpoint
python3 ua_query.py kg --service order-service --search "createOrder"
python3 ua_query.py kg --service order-service --file "src/order/OrderService.java"
```

**`ua_query.py domain`** — 业务域查询：
```
python3 ua_query.py domain --service order-service
python3 ua_query.py domain --service order-service --domain order-mgmt
python3 ua_query.py domain --service order-service --search "支付"
```

**`ua_query.py wiki`** — 文档级查询：
```
python3 ua_query.py wiki --service order-service --type domain
python3 ua_query.py wiki --service order-service --domain order-mgmt
python3 ua_query.py wiki --service order-service --type endpoint
python3 ua_query.py wiki --service order-service --type structure
python3 ua_query.py wiki --service order-service --type flow
python3 ua_query.py wiki --service order-service --search "支付"
```

**`ua_query.py business`** — 跨切面查询：
```
python3 ua_query.py business --domain order-management
python3 ua_query.py business --domain order-management --type interactions
python3 ua_query.py business --domain order-management --type rules
python3 ua_query.py business --list
python3 ua_query.py business --search "下单"
python3 ua_query.py business --facet server
```

**通用参数**：
```
--server URL          # API Server 地址（默认 http://localhost:3001）
--token TOKEN         # 访问令牌
--format json|md      # 输出格式（默认 json）
--verbose             # 包含完整详情
```

### /understand-query SKILL.md

- 指导 Agent 根据用户问题选择合适的子命令
- 包含四层下钻模型（Domain → Interaction → Wiki → KG）
- 检测 API Server 可用性，不可用时报错提示启动
- 示例查询场景和推荐子命令

## Dashboard Business Mode

### Mode Detection

扩展现有模式检测逻辑，在 app 初始化时检查 `/api/business/domains` 端点。

现有 ViewMode union: `"structural" | "domain" | "knowledge" | "wiki" | "system"`
新增: `"business"`

### State Management

新增 `useBusinessStore` (Zustand):

```typescript
interface BusinessState {
  domains: BusinessDomain[];
  crossFacetLinks: CrossFacetLink[];
  selectedDomainId: string | null;
  domainDetail: Record<string, BusinessDomainDetail>;
  loading: boolean;
  error: string | null;
  fetchDomains: () => Promise<void>;
  fetchDomainDetail: (slug: string) => Promise<void>;
  fetchCrossFacetLinks: () => Promise<void>;
  selectDomain: (id: string | null) => void;
}
```

### Components

| Component | Responsibility |
|-----------|---------------|
| `BusinessGraphView.tsx` | 主视图，xyflow 分层布局，dagre 算法 |
| `BusinessDomainNode.tsx` | 域分组节点（名称 + implType 标签 + 切面指示器） |
| `CrossFacetEdge.tsx` | 跨切面边（hover 显示 API path/method，置信度） |
| `BusinessDomainPanel.tsx` | 侧边栏域详情（interactions DAG + rules + links） |
| `BusinessModeHeader.tsx` | 模式顶栏（切面过滤 + 搜索框） |
| `InteractionDagView.tsx` | DAG 可视化（steps 分色渲染，branches/parallel/terminal） |

### Hierarchical Layout

```
Top Level: Business Domain Groups (large rectangles)
  ├── Each group shows: name, implType badge, facet coverage
  ├── Internal: server services (blue) | client features (green)
  └── Between groups: cross-facet edges

Click domain group → expand detail panel on right side
  ├── Interactions (DAG visualization per flow)
  ├── Business Rules (list with enforcement info)
  └── Cross-Facet Links (API path mapping details)
```

**Interaction DAG rendering:**
- Each step node colored by facet (server=blue, client=green, frontend=orange)
- `branches` → conditional fork with labeled edges
- `parallel` → parallel lanes
- `terminal: true` → terminal node marker (success/failure/timeout)
- `relatedRules` → clickable links to rules section

### Cross-Mode Navigation (aligned with PRD §986-993)

```
Business → System  : click server facet entity → System mode, locate service
Business → Service : click client/frontend entity → Service mode, load repo KG
System   → Service : click service node → Service mode for that service
Any      → Business : top bar switch (if business-landscape data available)
Breadcrumb trail records full navigation path
```

## Task Dependency Graph

```
T1 (extract API handlers)
  └→ T2 (refactor Vite middleware)
       └→ T3 (standalone Express server)
            └→ T4 (business API handler)
                 ├→ T5 (CLI ua_query.py) → T7 (SKILL.md) → T9 (CLI tests)
                 └→ T6 (Business mode detection) → T8 (BusinessStore)
                      └→ T10 (BusinessGraphView)
                           ├→ T11 (BusinessDomainPanel)
                           └→ T12 (CrossFacetEdge)
                                └→ T13 (Cross-mode navigation)
                                     └→ T14 (Dashboard tests)
                                          └→ T15 (Full regression)
```

**Parallel: T5-T9 (CLI) ∥ T6-T14 (Dashboard) after T4.**

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|-----------|
| API handler extraction breaks existing Dashboard | High | T2 regression tests before adding new features |
| xyflow grouped node layout complexity | Medium | Prototype with mock data first; dagre already in codebase |
| Business-landscape test data unavailable | Medium | Generate mock data from benchmark repos |
| CLI depends on server running | Low | Clear error messages + SKILL.md documents startup |
| Large cross-facet graph performance | Medium | Lazy loading domain details; pagination for search |

## PRD Deviation

| PRD Original | Spec 3 Change | Reason |
|-------------|---------------|--------|
| CLI reads local JSON directly | CLI calls API Server via HTTP | 面向未来中心化知识库架构 |
| Zero runtime dependencies | Requires API Server running | Dashboard 和 CLI 共用 server |
| `--path <dir>` parameter | `--server URL` + `--token` | API-based access model |
