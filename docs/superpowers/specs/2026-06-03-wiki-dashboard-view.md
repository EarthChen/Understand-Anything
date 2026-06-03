# Wiki Dashboard View — Design Proposal

## Overview

在 Dashboard 中新增 `wiki` 视图模式，提供文档浏览器式的 Wiki 预览体验。与现有的图谱视图（structural / domain / knowledge）互补：前三者适合代码关系探索，Wiki 视图适合文档阅读和业务流程理解。

## 触发条件

Dashboard 启动时检测 `.understand-anything/wiki/meta.json` 是否存在：
- 存在 → 顶部 Tab 栏显示 `[Wiki]` tab
- 不存在 → 隐藏 Wiki tab（不影响其他视图）

## UI 布局

```
┌──────────────────────────────────────────────────────┐
│  [Structural] [Domain] [Knowledge] [Wiki]            │
├──────────────┬───────────────────────────────────────┤
│  导航树       │  面包屑: System > order-service > 订单管理  │
│              ├───────────────────────────────────────┤
│ ▼ System     │                                       │
│   ▼ order    │  ## 订单管理                           │
│     ● 概览    │                                       │
│     ▼ 域     │  负责订单全生命周期管理，包括创建、查询...     │
│       订单管理│                                       │
│       用户认证│  **核心实体**: Order, OrderItem, Status  │
│   ▼ payment  │                                       │
│     ● 概览    │  ### 创建订单                          │
│     ▼ 域     │  ┌─────────────────────────────────┐   │
│       支付处理│  │ 1. 验证输入  [src/xxx.java:42] │   │
│              │  │ 2. 检查库存                      │   │
│ ▼ Cross-Svc  │  │ 3. 调用 PaymentFacade → [pay]  │   │
│   订单创建E2E│  │ 4. 持久化订单                   │   │
│              │  └─────────────────────────────────┘   │
└──────────────┴───────────────────────────────────────┘
```

### 左侧导航树

层级结构：
1. **System Overview**（父级概览，仅多服务时显示）
2. **Service**（服务名）
   - Service Overview（服务概览）
   - Domains（按域分组）
     - Domain A
     - Domain B
3. **Cross-Service Flows**（跨服务流程，仅多服务时显示）

### 右侧内容区

根据选中的导航节点渲染不同内容：

| 导航节点类型 | 渲染内容 |
|---|---|
| System Overview | `overview.json` — 系统概览、服务列表 |
| Service Overview | `service.json` — 服务描述、技术栈、模块、入口点 |
| Domain | `domains/<slug>.json` — 域描述、实体、流程列表 |
| Cross-Service Flow | `domains/<cross-domain>.json` — 跨服务步骤列表 |

### 流程步骤渲染

每个 Flow 内的步骤渲染为有序列表，带交互元素：

```
┌─ Step 1: 验证输入参数 ──────────────────────────┐
│  校验订单项数量、金额范围、收货地址格式...        │
│  📎 src/services/OrderService.java:42-58  [点击] │
└─────────────────────────────────────────────────┘
```

**交互能力：**
- `[点击源码]` → 打开 CodeViewer 组件定位到对应行
- `[跨服务链接]` → 切换到目标服务的对应 Wiki 页面
- `[搜索]` → 复用 SearchBar，结果包含 Wiki 页面

## 技术实现

### 组件结构

```
components/
├── WikiView.tsx          ← 主容器（左右布局）
├── WikiNavTree.tsx       ← 导航树（可折叠，带图标）
├── WikiContent.tsx       ← 内容渲染（根据类型分发）
├── WikiFlowSteps.tsx     ← 流程步骤列表（带源码链接）
├── WikiServiceCard.tsx   ← 服务概览卡片
└── WikiBreadcrumb.tsx    ← 面包屑导航
```

### Store 扩展

```typescript
// store.ts 新增
export type ViewMode = "structural" | "domain" | "knowledge" | "wiki";

interface WikiState {
  wikiServices: WikiServiceSummary[];    // 已集成服务列表
  wikiActiveService: string | null;      // 当前选中服务
  wikiActivePage: string | null;         // 当前选中页面 ID
  wikiPageData: WikiPageData | null;     // 当前页面数据
  wikiNavExpanded: Record<string, boolean>; // 导航树展开状态
}

interface WikiActions {
  loadWikiServices: () => Promise<void>;
  navigateToWikiPage: (service: string, pageId: string) => Promise<void>;
  toggleWikiNavNode: (nodeId: string) => void;
}
```

### Server API 扩展

新增 Wiki 相关 API 端点：

```
GET /api/wiki/services           → 已集成服务列表
GET /api/wiki/:service/index     → 服务索引
GET /api/wiki/:service/service   → 服务概览
GET /api/wiki/:service/domains/:slug → 域详情
GET /api/wiki/parent/overview    → 系统概览
GET /api/wiki/parent/architecture → 跨服务架构
GET /api/wiki/parent/domains/:slug → 跨服务流程
GET /api/wiki/search?q=keyword   → Wiki 全文搜索
```

Server 实现：直接读取 `.understand-anything/wiki/` 目录下的 JSON 文件。

### 数据加载策略

- **启动时**：仅检测 `wiki/meta.json` 是否存在（决定 Tab 显示）
- **首次点击 Wiki Tab**：加载服务列表 + 导航树结构（轻量）
- **点击具体页面**：按需加载页面数据（单个 JSON 文件）
- **缓存**：已加载的页面数据缓存在 store 中，除非手动刷新

## 分阶段实施

| 阶段 | 范围 | 工作量 |
|---|---|---|
| M1 | WikiView 基础框架 + 导航树 + 内容渲染 + Server API | Medium |
| M2 | 源码跳转（CodeViewer 集成）+ 跨服务导航链接 | Small |
| M3 | Wiki 搜索集成（复用 SearchBar + Fuse.js） | Small |

## 依赖关系

```
Wiki 生成管道 (已完成)
    ↓
Server API 扩展
    ↓
WikiView 组件实现
    ↓
Store/路由集成
```

## 父/子目录检测策略（已更新至 SKILL.md）

检测优先级：
1. `--service=xxx` 明确指定 → 单服务模式
2. 当前目录有 `.understand-anything/knowledge-graph.json` → 服务目录（单服务模式）
3. 子目录中有 1+ 个 `knowledge-graph.json` → 父目录（批量模式）
4. 当前目录有 `pom.xml`/`package.json`/`go.mod` 但无 KG → 服务目录（会触发前置补全）
5. 以上都不满足 → 假定为父目录

核心原则：**`.understand-anything/knowledge-graph.json` 的存在是服务已被分析的确定性信号**。

## Open Questions

- [ ] Wiki 视图是否需要支持移动端布局（MobileLayout）？
- [ ] Wiki 内容是否需要支持 Markdown 渲染（目前是纯 JSON）？还是由前端将 JSON 结构化渲染？
- [ ] 是否需要 Wiki 页面的"编辑建议"按钮（触发 wiki-reviewer）？

---

*Status: PROPOSAL — awaiting approval.*
