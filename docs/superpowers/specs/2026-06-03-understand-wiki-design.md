# /understand-wiki Design Spec

## Overview

新增 `/understand-wiki` 技能，为微服务项目生成可查询的知识库 Wiki。覆盖范围：M1（agent 定义）+ M2（主流程编排）+ M3（跨服务聚合）。

## Components

| 组件 | 类型 | 文件位置 | 职责 |
|---|---|---|---|
| `/understand-wiki` | Skill | `skills/understand-wiki/SKILL.md` | 用户入口，参数解析，编排 Phase 0~3，派发 agent，进度报告 |
| `wiki-worker` | Agent | `agents/wiki-worker.md` | 单服务 Wiki 生成（扩写 domain-graph + 关联源码） |
| `wiki-reviewer` | Agent | `agents/wiki-reviewer.md` | Wiki 质量审查（准确性/完整性/可读性） |

## Execution Modes

| 执行方式 | 模式 | 说明 |
|---|---|---|
| 在服务目录下执行 `/understand-wiki` | 单服务模式 | 生成该服务 Wiki → 触发父级增量更新 |
| 在父目录 `/understand-wiki --service=xxx` | 单服务模式 | 同上 |
| 在父目录 `/understand-wiki`（无参数） | 批量模式 | 扫描所有未接入/已变更服务，并行生成 |

设计原则：**渐进式接入**。团队按需逐个接入服务，批量模式仅作便利工具。

## Processing Pipeline

```
Phase 0: 检测与前置补全
    ↓
Phase 1: 服务 Wiki 生成（wiki-worker agent）
    ↓
Quality Gate: 自动校验 + 可选深度审查（wiki-reviewer agent）
    ↓
Phase 2: 跨服务关系识别 + 父级编排页生成（主流程）
    ↓
Phase 3: 构建索引
```

---

## Phase 0 — 检测与前置补全

**单服务模式：**
- 确定目标服务（通过 `--service` 参数或当前工作目录）
- 检查前置条件：
  - `knowledge-graph.json` 不存在 → 自动触发 `/understand`
  - `domain-graph.json` 不存在 → 自动触发 `/understand-domain`
- 检查 Wiki 状态（`{service}/.understand-anything/wiki/meta.json`）：
  - 存在且 `gitCommitHash` 一致 → 跳过
  - 存在但 hash 不一致 → 增量更新
  - 不存在 → 全量生成

**批量模式：**
- 扫描父目录下所有子目录（检测 `.understand-anything/` 或 `package.json`/`pom.xml`/`go.mod`）
- 对每个服务执行同上检测逻辑
- 输出：需要生成的服务列表

---

## Phase 1 — 服务 Wiki 生成（wiki-worker agent）

### wiki-worker 输入

- 该服务的 `knowledge-graph.json`
- 该服务的 `domain-graph.json`
- 源代码（通过 KG 节点定位关键文件）
- `outputLanguage` 配置

### wiki-worker 扩写策略（混合模式）

采用"先骨架后扩写"两轮处理：

**第一轮 — 基于图谱生成骨架：**
- 读取 domain-graph 中的 domain/flow/step 节点
- 读取 knowledge-graph 中对应的结构信息（函数签名、类关系、边）
- 生成每个 domain 的文档骨架（目录结构、流程步骤、关键实体）

**第二轮 — 通过 KG edge 定位源码扩写：**
- 对骨架中的每个 business step，通过 KG 的 `exemplifies`/`categorized_under` 边定位关联的 function/class 节点
- 读取这些节点对应的源码片段（文件路径 + 行号范围）
- LLM 结合源码生成详细描述（业务规则、边界条件、代码入口）

### 大服务分批处理

- domain 节点 ≤ 5：单次处理
- domain 节点 > 5：每批 2-3 个域，多次调用后合并

### wiki-worker 输出

```
{service}/.understand-anything/wiki/
├── meta.json           ← gitCommitHash, generatedAt, version, outputLanguage
├── index.json          ← 服务内索引（轻量，不含 content）
├── service.json        ← 服务概览（职责、内部架构、关键模块）
└── domains/
    └── {domain}.json   ← 业务域详情（含 flows 和 steps）
```

---

## Quality Gate

位于 Phase 1 和 Phase 2 之间。

### Layer 1 — 自动校验（必做，零 LLM 开销）

主流程对生成的 Wiki 进行结构化检查：
1. **Schema 校验**：产出文件是否符合 JSON schema
2. **覆盖率校验**：domain-graph 节点与 wiki 页面一一对应
3. **引用存在性校验**：wiki 中引用的源码文件/行号实际存在
4. **内容非空校验**：content 字段有实质内容

校验失败 → 报告错误，建议重新生成，不进入 Phase 2。

### Layer 2 — wiki-reviewer agent（通过 `--review` 开启）

独立 reviewer agent：
- **输入**：生成的 wiki 页面 + 对应源码片段
- **审查维度**：准确性、完整性、可读性
- **输出**：pass/warn/fail + 问题列表 + 修改建议
- **失败处理**：fail 的页面将 reviewer 反馈回传 wiki-worker 重试（最多 1 次）

---

## Phase 2 — 跨服务关系识别 + 父级编排页生成

### 跨服务关系识别（接口级别）

核心目的：**业务流程梳理** + **Wiki 导航跳转**，不是简单的服务拓扑图。

#### 识别粒度

不是"服务A → 服务B"，而是：
> `OrderService.createOrder()` → `PaymentFacade.createPayment()` (payment-service)

#### 两层识别机制

**Layer 1 — 脚本确定性提取（必做）：**

针对 MOA RPC 为主的交互模式：
- 扫描各服务 KG 中 @MoaProvider 标注的 service 节点（提供者）
- 扫描各服务 KG 中 @MoaConsumer 注入的依赖（消费者）
- 匹配：consumer 注入的接口名 → provider 实现的接口名
- 进一步匹配到方法级：`.createPayment()` → `Impl.createPayment()`
- 同时支持：Kafka topic publishes/subscribes、数据库 table 共享、HTTP endpoint 匹配

产出：候选关系列表（带匹配依据）

**Layer 2 — LLM 审查 + 补充 + 编排（始终执行）：**

LLM 三个职责：
1. **审查（Verify）**：确认脚本匹配是否正确，剔除误报
2. **补充（Discover）**：识别脚本未发现的接口级调用关系（非标准 RPC、动态调用等）
3. **编排（Organize）**：将接口调用关系组织为跨服务业务流程

输入：
- 各已接入服务的 endpoint/service/function 节点摘要
- 各服务的 domain 信息（名称、实体、流程）
- 脚本产出的候选关系
- 关键源码片段（通过 KG 定位）

**Layer 3 — 用户配置覆盖（可选，仅用于纠错）：**
- 用户可在 config 中声明遗漏/错误的关系
- 优先级最高，覆盖脚本/LLM 结果

#### 跨服务调用关系数据结构

```json
{
  "caller": {
    "service": "order-service",
    "node": "function:create-order",
    "file": "src/services/OrderService.java:42",
    "method": "OrderService.createOrder()"
  },
  "callee": {
    "service": "payment-service",
    "node": "service:payment-facade",
    "interface": "PaymentFacade",
    "method": "createPayment()"
  },
  "type": "moa_rpc",
  "evidence": "script-matched",
  "detail": "@MoaConsumer PaymentFacade injected in OrderService, matched to @MoaProvider PaymentFacadeImpl in payment-service"
}
```

### 父级编排页生成

基于"当前已接入服务集"全量重算（因为新服务加入可能改变已有关系拓扑）。

读取：
- 各已接入服务的 `wiki/index.json`（轻量摘要）
- 各服务 KG 中的 endpoint/service/publishes/subscribes 节点（仅节点和边）
- 跨服务调用关系识别结果

生成：
- `overview.json`：系统总览（服务列表、技术栈、业务域地图）
- `architecture.json`：跨服务架构（接口级调用关系图、共享模块、数据流）
- `domains/{domain}.json`：跨服务业务域编排页

编排页展示效果：
```
「订单创建」完整流程：
1. [order-service] OrderController 接收订单请求 → [详情]
2. [order-service] OrderService.createOrder() 调用 PaymentFacade.createPayment() → [详情]
3. [payment-service] PaymentFacadeImpl.createPayment() 处理支付 → [详情]
4. [payment-service] 发送 payment.completed 事件
5. [inventory-service] 监听事件，InventoryService.deductStock() → [详情]
```

每步可点击跳转到对应服务的 Wiki 详情页。

---

## Phase 3 — 构建索引

- 父级 `index.json`：所有已接入服务概要 + 所有业务域概要
- 各服务 `index.json`：该服务内所有页面概要

---

## Storage Architecture

```
order-service/.understand-anything/wiki/       ← 服务级 Wiki
├── meta.json
├── index.json
├── service.json
└── domains/
    └── order-mgmt.json

payment-service/.understand-anything/wiki/     ← 服务级 Wiki
├── meta.json
├── index.json
├── service.json
└── domains/
    └── payment-for-order.json

.understand-anything/wiki/                     ← 父级 Wiki（编排层）
├── index.json
├── overview.json
├── architecture.json
└── domains/
    ├── order-mgmt.json                        ← 跨服务编排页
    └── payment.json
```

**服务自治原则：**
- 每个服务的 Wiki 跟着服务代码走
- 父级只存导航、串联信息和跳转链接，不复制服务内容
- "已接入"判断：服务目录下存在 `.understand-anything/wiki/meta.json`

---

## Wiki Data Schema

复用现有 `KnowledgeGraph` schema（`kind: "knowledge"`），节点类型为 `article`：
- `knowledgeMeta.content`：完整 Markdown 文本
- `knowledgeMeta.category`：页面类型（overview / architecture / domain / flow / step / service）
- `knowledgeMeta.service`：所属服务
- `edges`：页面间关联（`categorized_under`）和源码关联（`exemplifies`）

---

## Multi-language Support

读取 `.understand-anything/config.json` 的 `outputLanguage` 配置，所有 LLM 生成的 Wiki 内容使用配置的语言输出。

---

## Error Handling

- Phase 0 前置触发失败 → 报告具体错误，跳过该服务
- Phase 1 wiki-worker 失败 → 报告错误，该服务不进入 Quality Gate
- Quality Gate Layer 1 失败 → 建议重新生成，不进入 Phase 2
- Quality Gate Layer 2 fail → 重试一次（带 reviewer 反馈），仍 fail 则跳过
- Phase 2 父级生成 → 基于可用的已接入服务生成（部分服务失败不阻断全局）

---

## Decisions Made

| 决策 | 选择 | 理由 |
|---|---|---|
| 执行模式 | 渐进式接入为主，批量为辅 | 降低单次成本，更早获得反馈 |
| 扩写策略 | 混合（图谱骨架 + 源码扩写） | 平衡质量和上下文开销 |
| 跨服务关系识别 | 脚本提取 + LLM 审查补充（始终执行） | 脚本有限，LLM 保证充分性 |
| 关系粒度 | 接口/方法级（非服务级） | 支持业务流程梳理和 Wiki 导航 |
| 父级更新策略 | 每次基于已接入服务集全量重算 | 新服务加入改变关系拓扑，开销小 |
| Phase 2 执行者 | 主流程自己完成 | 只读轻量数据，不需独立 agent |
| 质量审查 | 双层 Quality Gate | 自动校验保底 + reviewer 深度审查可选 |
| RPC 注解识别 | 增强 file-analyzer + 新增边类型 | 让脚本层能精确匹配 MOA/Dubbo 等 RPC 调用关系 |
| 注解配置方式 | config.json 中 `rpcAnnotations` 字段 | 支持多种 RPC 框架，可扩展 |

---

## Wiki Search

### 模糊搜索（本次 spec 范围）

复用现有 `SearchEngine`（Fuse.js），扩展搜索范围覆盖 Wiki 内容：

**搜索字段与权重：**
- `name`（0.3）— Wiki 页面标题（如"订单创建"）
- `knowledgeMeta.content`（0.3）— 完整 Markdown 内容（全文搜索）
- `tags`（0.2）— 标签
- `summary`（0.2）— 页面摘要

**实现方式：**
- Wiki 页面作为 `article` 类型节点加入搜索索引
- 扩展 `SearchEngine` 支持 `knowledgeMeta.content` 字段
- 搜索结果标注来源服务和页面类型（overview/domain/flow/service）

**搜索入口：**
- Dashboard Wiki tab 内的搜索栏（复用现有 SearchBar 组件模式）
- Agent Query API: `GET /api/wiki/search?q=关键词`（全文搜索跨所有服务）

### 语义搜索（后续增强，不在本次范围）

- 基于 embeddings 的语义匹配
- 利用现有 store 中预留的 `searchMode: "semantic"` 架构

---

## Prerequisite: file-analyzer RPC 注解增强

为支持跨服务接口级调用关系的确定性匹配，需要增强 file-analyzer 对 RPC 注解的识别能力。

### 新增边类型

| 边类型 | 语义 | 方向 | 示例 |
|---|---|---|---|
| `provides_rpc` | 类/接口通过注解暴露 RPC 服务 | provider 类 → 接口定义 | `@MoaProvider PaymentFacadeImpl` → `PaymentFacade` |
| `consumes_rpc` | 类通过注解消费远程 RPC 服务 | consumer 类 → 接口定义 | `OrderService` (有 `@MoaConsumer PaymentFacade`) → `PaymentFacade` |

### 注解识别配置

在 `.understand-anything/config.json` 中新增 `rpcAnnotations` 字段：

```json
{
  "rpcAnnotations": [
    {
      "provider": "@MoaProvider",
      "consumer": "@MoaConsumer",
      "type": "moa"
    },
    {
      "provider": "@DubboService",
      "consumer": "@DubboReference",
      "type": "dubbo"
    }
  ]
}
```

### file-analyzer 行为变更

当检测到配置中的 RPC 注解时：
1. 将 provider 类识别为 `service` 类型节点（而非普通 `class`），tags 增加 `rpc-provider`
2. 生成 `provides_rpc` 边：provider 实现类 → 接口节点
3. 当 consumer 类注入 RPC 接口时，生成 `consumes_rpc` 边（而非普通 `depends_on`）
4. 节点的 summary 中明确标注 RPC 接口名和方法列表

### 对跨服务关系识别的影响

有了结构化的 `provides_rpc` / `consumes_rpc` 边后：
- **脚本层**可以精确匹配：A 服务的 `consumes_rpc` 边指向接口 X → B 服务的 `provides_rpc` 边指向接口 X → 确认 A 调用 B
- **LLM 层**仍然始终执行：审查 + 识别非标准调用 + 组织为业务流程

### 无配置时的降级

如果 `rpcAnnotations` 配置为空或不存在：
- file-analyzer 行为不变（向后兼容）
- 跨服务关系识别完全依赖 LLM 层

---

## Known Limitations (MVP)

1. 前端服务的 fetch/axios 调用在图谱中不可见 → MVP 阶段前端服务独立生成 Wiki，跨服务关联仅限后端
2. 未配置 `rpcAnnotations` 的项目，跨服务关系识别完全依赖 LLM 层（无脚本匹配兜底）

---

## Open Questions

- [ ] 自定义注解配置格式：在 `config.json` 中新增 `rpcAnnotations` 字段？格式示例：`{ provider: "@MoaProvider", consumer: "@MoaConsumer", type: "rpc" }`
- [ ] Agent 写入知识库还是只读？（MVP 先只读）

---

*Status: DESIGN APPROVED — ready for implementation planning.*
