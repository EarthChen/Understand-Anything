# Understand-Anything 企业级跨端知识库


> **核心问题**：如何解决跨端、跨平台、跨仓库的企业级知识库构建

---

## 一、体系全景

Understand-Anything 是一套**分层递进式代码知识库体系**，由 5 个核心技能组成，从底层源码到顶层业务全景形成完整的知识金字塔：

```
L6  源码 (Ground Truth)
 L5  AST 结构 (确定性)
  L4  知识图谱 KG (结构+语义)
   L3  领域图谱 Domain Graph (业务流程)
    L2  Wiki 知识库 (团队文档)
     L1  Business Landscape (跨端全景)
      → Query CLI (统一查询入口)
```

### 技能定位总览

| 技能 | 层级 | 核心产物 | 一句话定位 |
|------|------|----------|-----------|
| `/understand` | L4–L5 | `knowledge-graph.json` | 从源码构建结构化知识图谱 |
| `/understand-domain` | L3 | `domain-graph.json` | 提取业务域/流程/步骤三层模型 |
| `/understand-wiki` | L2 | `wiki/*.json` + 聚合图 | 生成团队可读的结构化 Wiki |
| `/understand-business` | L1 | `business-features.json` | 聚合跨端业务全景 |
| `/understand-query` | 全层 | CLI + API Server | 分层递进式统一查询入口 |

### 依赖链

```
/understand (KG + 结构分析 + 源码索引)
     │
     ├──→ /understand-domain (业务域/流程/步骤)
     │         │
     │         ├──→ /understand-wiki (团队 Wiki + 跨服务图)
     │         │         │
     │         │         └──→ /understand-business (跨端业务全景)
     │         │
     │         └──→ /understand-query (domain 层查询)
     │
     ├──→ /understand-query (KG/结构/源码层查询)
     │
     └──→ /understand-dashboard (可视化)
```

---

## 二、用户群体与解决的问题

Understand-Anything 知识库体系面向企业中**所有需要理解代码和业务的角色**：

| 角色 | 解决的核心问题 |
|------|--------------|
| **产品经理 / 运营** | 无需开发介入即可了解技术实现细节、评估需求影响范围 |
| **QA / 测试** | 基于源码验证的业务规则设计测试用例，发现隐藏边界条件 |
| **新入职开发** | 结构化 Onboarding（Tour + Wiki + 架构图），替代「读 500 个文件」 |
| **资深开发** | 秒级跨服务影响分析、RPC 调用链追踪、源码级验证 |
| **架构师** | 全局视角做技术决策：耦合度分析、热点识别、跨端全景 |
| **AI Agent** | 作为 Cursor / Claude Code / Codex 的知识后端，精确上下文供给 |

**与传统文档（Confluence/飞书）的本质差异**：自动从代码生成、Git 增量更新不过期、源码验证协议保证准确性、从业务功能到代码行号的全层穿透。

---

## 三、核心设计哲学

### 3.1 确定性 + LLM 混合流水线

整个体系的核心设计原则是**确定性先行、LLM 聚焦语义**：

| 职责 | 确定性脚本 | LLM Agent |
|------|-----------|-----------|
| 文件扫描/AST 解析 | Tree-sitter WASM | — |
| Import 图/分批 | Louvain 社区算法 | — |
| Schema 校验 | Zod + auto-fix | — |
| 注解→边推导 | Rule Engine | — |
| 跨服务匹配 | API 路径/CJK 模糊 | LLM 验证补充 |
| 搜索排序 | MiniSearch + RRF | — |
| 语义摘要/标签 | — | file-analyzer |
| 架构分层 | — | architecture-analyzer |
| 业务域发现 | — | domain-discoverer |
| 文档撰写 | — | wiki-worker |
| 跨端关联 | — | association-discovery |

### 3.2 增量更新策略

| 机制 | 适用层 | 原理 |
|------|--------|------|
| **结构指纹** | KG | SHA-256 + AST 签名区分 cosmetic vs structural 变更 |
| **Git diff 增量** | KG | 仅对 structural 变更文件重跑 LLM 分析 |
| **Domain diff** | Wiki | DG snapshot 对比，仅重生成 dirty domains |
| **Hash 跳过** | 跨服务 | `service-hashes.json` 判断 Phase 3 是否需要更新 |
| **Prompt hash** | Business | `_promptHash` SHA-256 前 16 位，相同则复用 |

### 3.3 质量保障体系

| 层级 | 机制 | 阈值 |
|------|------|------|
| Batch 输出 | 节点覆盖率 | ≥80% |
| Batch 输出 | 边比率 | ≥30% |
| 分批质量 | intra-edge ratio | ≥60% HIGH / ≥40% MODERATE |
| Wiki | sourceRef 覆盖率 | quality gate 检查 |
| 图谱 | Zod Schema | 4 层校验（sanitize → autoFix → drop → fatal）|
| 全局 | 降级标记 | `provenance.degraded` 显式标记质量状态 |

### 3.4 源码验证协议

> **Wiki/Domain 可能过期，源码是 Ground Truth。**

- `/understand-query` 面向用户回答必须 `--depth full` 含源码验证
- Wiki 与源码矛盾时，以源码为准并显式报告差异
- 分层回退链：KG → Structure → Source Search → 判定不存在

---

## 四、`/understand` — 结构化知识图谱引擎

### 4.1 核心流程（7 Phase）

```
Phase 0   环境解析 + Worktree 重定向 + 增量决策
Phase 0.5 Ignore 配置确认
Phase 1   SCAN（文件枚举 + import 图）
Phase 1.5 BATCH（Louvain 社区分批）
Phase 2   ANALYZE（结构提取 + LLM 语义分析 + 合并）
Phase 3   ASSEMBLE REVIEW
Phase 4   ARCHITECTURE（分层）
Phase 5   TOUR（导览）
Phase 6   REVIEW（校验）
Phase 7   SAVE（写入 + 指纹 + 索引）
```

### 4.2 Louvain 分批算法

**核心**：在无向 import 图上运行 `graphology-communities-louvain`（`randomWalk: false` 保证确定性），最大化模块度。

**后处理流水线**（6 步顺序执行）：

1. **Hub 排除**：度数 ≥ N 的节点单独处理
2. **社区大小 enforcement**：超 `maxCommunitySize`(50) 则字母序拆分
3. **非代码分批**：Dockerfile/CI/SQL 等按类型和目录分组
4. **小 batch 合并**：`< minBatchSize`(8) 且 `mergeable=true` 的合并
5. **弱 batch 吸收**：≤5 文件 + intra-edge < 0.2 的吸收到最强邻居
6. **混合目录拆分**：二级目录数 > maxDirs 时拆分

**关键参数**：

| 参数 | 默认 | 作用 |
|------|------|------|
| `--resolution` | 1.0 | 越大社区越小 |
| `--max-community-size` | 50 | Louvain 社区上限 |
| `--min-batch-size` | 8 | 小 batch 合并阈值 |
| `--max-merge-target` | 40 | misc batch 容量 |
| `--exclude-hubs` | null | hub 度数阈值 |
| `MAX_NEIGHBORS` | 50 | neighborMap 截断 |

### 4.3 Tree-sitter 结构提取

- **13 种语言** WASM grammar：TS/JS/Python/Go/Rust/Java/Kotlin/Ruby/PHP/C/C++/C#/Dart/ObjC/Swift
- 提取内容：函数签名、类结构、调用图、注解、exports
- 非代码文件：内置 parsers（YAML/Dockerfile/GraphQL/Protobuf/Shell）

### 4.4 规则引擎（注解→边推导）

**四步流水线**：
1. Framework 检测（package.json 依赖分析）
2. 注解→边映射（`@Autowired` → `injects`，`@DubboService` → `provides_rpc` 等）
3. 元注解展开（JVM `@Service` → `@Component`）
4. Call graph → `calls` 边

**内置框架规则**：spring, dubbo, moa, feign, grpc, kafka, retrofit, hilt, nestjs 等。

### 4.5 合并归一化（merge-batch-graphs.py）

**六步**：合并 → ID 归一化 → 复杂度归一化 → edge 重写 → 节点去重 → 边去重

**边恢复层**（merge 后叠加，补偿 LLM 遗漏）：
- importMap 恢复（置信度 0.95）
- RPC/MQ 注解恢复
- DI 注入恢复
- C/ObjC header-impl 配对
- 全局 basename 索引解析 unresolved imports（0.80）

### 4.6 Schema 定义

- **19 种节点类型**：file, function, class, module, concept, config, document, service, table, endpoint, pipeline, schema, resource, domain, flow, step, article, entity, topic, claim, source
- **43 种边类型**：涵盖 Structural(5), Behavioral(4), RPC(2), Routing(2), HTTP(2), DI(2), Data Flow(4), Dependency(3), Semantic(2), Infrastructure(4), Schema/Data(4), Domain(3), Knowledge(6)

### 4.7 指纹算法

**变更分级**：
1. `contentHash` 相同 → **NONE**
2. 无 tree-sitter 支持 → **STRUCTURAL**（保守）
3. 函数/类签名变化 → **STRUCTURAL**
4. 仅函数体/实现变化 → **COSMETIC**（不触发重分析）

---

## 五、`/understand-domain` — 业务域提取引擎

### 5.1 双路径设计

| 路径 | 条件 | 成本 | 质量 |
|------|------|------|------|
| Path 1 (standalone) | 无 KG 或 `--standalone` | ~10-20% of /understand | 中 |
| Path 2 (KG 派生) | 有完整 KG | 更低（复用 KG） | 高 |

### 5.2 Path 2 拆分流水线（大规模场景）

```
condense_kg_for_domain.py → kg-summary.json (~15k tokens)
  → domain-discoverer Agent → domain-discovery.json (3-8 个域)
    → audit_domain_discovery.py (过度合并检测)
      → split_kg_by_domain.py → domain-*.json
        → domain-flow-extractor × N (≤10 并发)
          → merge_domain_results.py → domain-graph.json
```

### 5.3 平台感知 Flow 提取

| 平台 | 入口点 | 主要追踪边 |
|------|--------|-----------|
| backend | endpoint, service | `calls`（深度 2-3） |
| frontend | page/screen 路由 | `routes`, `depends_on`, `consumes_api`, `contains` |
| mobile | Activity/Fragment/ViewController | `navigates_to`, `depends_on`, `calls`, `consumes_api` |

### 5.4 三层业务模型

| 层级 | 含义 | 数量 |
|------|------|------|
| **Domain** | 高层业务区域 | 3-8 |
| **Flow** | 域内具体流程 | 每域 3-10 |
| **Step** | 流程中原子动作 | 每 flow ≥4（强制） |

---

## 六、`/understand-wiki` — 团队知识库生成器

### 6.1 双模式编排

| 模式 | 触发 | 编排者 | 适用场景 |
|------|------|--------|---------|
| Manual | 默认 | 主 Agent 按 SKILL.md | 交互式、单服务 |
| Workflow | `--workflow` | `workflow.js` | 3+ 服务批量、CI |

### 6.2 确定性装配流水线（Phase 2，不可跳过）

```
extract-endpoints.py → enrich-endpoint-descriptions.py
  → validate-wiki-schema.mjs → build-wiki-index.py → assemble-wiki.py
```

### 6.3 跨服务聚合（Phase 3）

**Backend**：`cross-service-matcher.py`
- RPC 匹配：`provides_rpc.target == consumes_rpc.target` 且不同服务
- Event 匹配：`publishes.topic == subscribes.topic`
- DB 共享：同一 table 被 ≥2 服务访问
- Wrapper RPC：通过 DI 注入的跨服务 wrapper 类

**Mobile**：`feature-parity-matcher.py`
- 三级匹配（exact → fuzzy → semantic）
- Union-Find 合并跨平台特性
- 8 个预定义 semantic family

### 6.4 图产物

| repo-type | 产物 | 用途 |
|-----------|------|------|
| backend | `system-graph.json` | 微服务拓扑 |
| mobile | `client-graph.json` | 跨平台特性图 |
| frontend | `frontend-graph.json` | Web 组件/路由/API 图 |

---

## 七、`/understand-business` — 跨端业务全景引擎

### 7.1 核心创新：Feature-centric M:N 关联

**旧模型**（已废弃）：1:1 domain 匹配 → `domains.json`
**新模型**：Feature-centric → `business-features.json` + `feature-interactions/`

每个 business feature 可关联 M 个客户端功能和 N 个服务端域。

### 7.2 四层确定性匹配（domain_matcher.py）

| 层 | 策略 | confidence |
|----|------|-----------|
| 0 | Manual mapping (`domain-mapping.json`) | 1.0 |
| 1a | API 路径精确匹配 | 1.0 |
| 1b | 域名精确匹配（归一化） | 1.0 |
| 1c | CJK 模糊匹配 | 0.6-0.9 |

**CJK 模糊匹配三子策略**：
- 子串包含（≥2 字符）→ 0.9
- 公共前缀（≥50%）→ 0.8
- 字符 Bigram Jaccard（≥0.4）→ 0.6 + jaccard × 0.3

### 7.3 O(N) Association Discovery

**核心思想**：取代 O(N×M) 成对匹配，对每个客户端 feature 一次性问「依赖哪些 server domain？」

**输出结构**：
```json
{
  "featureName": "...",
  "primaryServer": {"domain", "service", "confidence": 0.0-1.0},
  "supportingServers": [{"domain", "service", "relationship": "calls|depends_on|displays", "confidence"}]
}
```

**增量缓存**：`_promptHash` SHA-256 前 16 位，相同则复用。

### 7.4 场景路由

| 场景 | 条件 | Phase 2 策略 |
|------|------|-------------|
| `server_only` | 仅有 server facet | pairwise |
| `client_server` | 1 server + 1 client | association_discovery |
| `multi_client` | 1 server + 多 client | association_discovery |
| `client_only` | 无 server | skip |

### 7.5 Facet 模型（`facets.py`）

| type | role | graph_file |
|------|------|-----------|
| `server` | server | `system-graph.json` |
| `mobile` | client | `client-graph.json` |
| `frontend` | client | `frontend-graph.json` |

**别名归一**：`backend` → `server`，`web` → `frontend`

**Feature 唯一标识**：`feature_key(facetType, project, name)` 三元组防碰撞

### 7.6 客户端功能合并策略

**Mobile**：从 `client-graph.json` 的 `domainLinks/featureParity/nativeBridge` 推导跨平台合并

**Frontend**：从 `frontend-graph.json` 读取，跨项目合并需 `frontendMergeGroups` 显式声明

---

## 八、`/understand-query` — 统一查询层

### 8.1 架构：Thin Client + Shared API Server

- **CLI**：Python 3.10+ stdlib only（零外部依赖），15 个子命令
- **Server**：Express.js，与 Dashboard 共享 API
- **传输**：全部 POST + JSON body

### 8.2 `cmd_ask --depth full` 完整链路

```
Step 1: 服务自动发现（4 策略投票）
Step 2: Business 上下文搜索
Step 3: cmd_trace（多关键词 KG 搜索 + RRF + 源码）
Step 3b: Structure 回退（AST 符号搜索）
Step 3c: Source 回退（全文搜索）
Step 4: 跨服务 RPC Follow
```

### 8.3 服务自动发现评分

| 策略 | 投票 | 早退条件 |
|------|------|---------|
| 精确类名（Impl +20，其他 +15） | 最高 | ≥15 分立即返回 |
| Wiki 搜索（+2/条） | — | — |
| Business 搜索（+3/服务） | — | — |
| Business features API（+2） | — | — |
| 跨服务 KG（+int(best_score)） | — | — |

### 8.4 RRF 融合算法

**Server 端**：
1. KgIndex + WikiIndex 分别 MiniSearch 搜索
2. Top 10 seed → `kgGraphExpansion`（1-hop +1, 2-hop +0.5）
3. `rrfFuse`：每个 ranked list 中 rank r 的贡献 = `1/(60+r)`，跨 list 累加

**CLI 端**：`_score_node_relevance` 重排（精确名 +15，Impl +3，tags +4 等）

### 8.5 Domain-Flow 回退

当 KG 文本搜索失败时：
1. 搜索 domain graph 找匹配 flow
2. 从 flow 名提取 PascalCase 代码关键词
3. 用代码关键词重搜 KG

解决「业务概念名 ≠ 类名」的 gap。

### 8.6 跨服务 RPC Follow

1. 检测 neighbors 中的 `consumes_rpc` outbound 边
2. 遍历所有服务搜索 provider（target interface 匹配 + Impl 偏好）
3. 在 provider 服务执行完整 trace（含源码）

---

## 九、跨端/跨平台/跨仓库设计

### 9.1 多 Agent 平台兼容

支持 7+ 种安装路径候选：
- `CLAUDE_PLUGIN_ROOT`（Claude Code）
- `~/.understand-anything-plugin`（通用 symlink）
- `~/.agents/skills/`（Cursor/Copilot）
- `~/.codex/`、`~/.opencode/`、`~/.pi/`

Sub-Agent 委派适配：Cursor Task / Claude Agent / Codex Native

### 9.2 Git Worktree 安全

检测 `git-common-dir ≠ git-dir` 时，产物自动重定向到主仓库根，避免 ephemeral worktree 销毁分析结果。

### 9.3 多服务/多仓库布局

```
businessRoot/
├── backend/          ← server facet
│   ├── user-service/.understand-anything/
│   └── order-service/.understand-anything/
├── mobile/           ← mobile facet
│   ├── Amar/         (iOS)
│   ├── ddoversea/    (Android)
│   └── ddoversea_flutter/
└── frontend/         ← frontend facet
    ├── seller-portal/
    └── ops-web/
```

**`system.json`** 是跨端配置的唯一真相源：
- 声明 facets、services、subPaths
- `platformMapping`：标准平台名 → 仓库名
- `frontendMergeGroups`：跨项目显式合并声明

### 9.4 三层穿透下钻

```
business-features.json (L1: 跨端功能)
  → wikiRef → wiki/domains/*.json (L2: 域文档)
    → sourceRef → 源码文件:行号 (L6: Ground Truth)
```

---

## 十、技术栈总览

| 层面 | 技术选型 |
|------|---------|
| AST 解析 | web-tree-sitter + WASM（13 种语言） |
| 图算法 | graphology + Louvain 社区发现 |
| 搜索引擎 | MiniSearch (BM25) + jieba CJK 分词 + RRF 融合 |
| Schema 校验 | Zod (TypeScript) |
| 确定性脚本 | Python 3 (stdlib) + Node.js |
| 可视化 | React + @xyflow/react + ELK + Vite |
| API 层 | Express.js (POST JSON) |
| CLI | Python argparse (零依赖) |
| 构建 | pnpm monorepo |
| 国际化 | `--language` + `locales/*.md` |
| 指纹 | SHA-256 + AST 签名 |
| 增量 | Git diff + fingerprint + prompt hash |

---

## 十一、创新亮点总结

1. **工程化的 Agent 编排**：非简单的「让 LLM 读代码」，而是确定性先行 + LLM 聚焦语义，控制成本与质量下限

2. **O(N) Association Discovery**：取代 O(N×M) 成对匹配，显著降低跨端关联的 LLM 调用成本

3. **Feature-centric M:N 模型**：超越 1:1 域匹配，真实反映微服务架构的多对多关系

4. **分层 RRF 搜索**：文本搜索 + KG 图扩展的 Reciprocal Rank Fusion，解决「语义相关但文本未直接命中」

5. **Domain-Flow 桥接**：业务流程名 → PascalCase 代码关键词，解决自然语言到代码符号的 gap

6. **结构指纹增量**：区分 cosmetic vs structural 变更，仅对结构变更触发 LLM 分析

7. **三层源码穿透**：business feature → wiki domain → source code，一键从业务概念直达代码行

8. **渐进式接入**：单服务起步，逐步扩展到全企业全端覆盖

9. **Checkpoint 可恢复**：任何阶段中断都可从断点继续

10. **平台无关设计**：支持 Claude Code / Cursor / Copilot / Codex / OpenCode 等 7+ 种 Agent 宿主

---

## 十二、独立 Agent 体系

### 12.1 Agent 架构模型

整个体系采用 **Orchestrator + Leaf Agent** 模式：
- **Orchestrator**（编排型）：由各技能的 SKILL.md 主会话承担，负责 Phase 调度、脚本调用与并发控制
- **Leaf Agent**（执行型）：接收精确上下文，产出约定结构的中间文件，**禁止再派发子 Agent**
- **咨询型**：面向用户的交互式 Agent，不参与 pipeline

所有 Agent 定义集中在 `understand-anything-plugin/agents/`（共 13 个 `.md` 文件）。

### 12.2 Pipeline Agent 完整列表

| Agent | 调度者 | 并发 | 职责 |
|-------|--------|------|------|
| **project-scanner** | `/understand` Phase 1 | 1 | 扫描代码库，产出文件清单、语言/框架、importMap |
| **file-analyzer** | `/understand` Phase 2 | ≤10 | 基于结构提取 + LLM 语义分析，生成 KG 节点/边 |
| **assemble-reviewer** | `/understand` Phase 3 | 1 | 审查合并结果，修复跨批次语义问题 |
| **architecture-analyzer** | `/understand` Phase 4 | 1 | 识别 3-10 个架构层，分配文件节点 |
| **tour-builder** | `/understand` Phase 5 | 1 | 设计 5-15 步引导式代码导览 |
| **graph-reviewer** | `/understand` Phase 6 | 1 | Schema/完整性/质量审查（仅 `--review`） |
| **domain-discoverer** | `/understand-domain` Phase 4a | 1 | 从压缩 KG 摘要识别 3-8 个业务域 |
| **domain-flow-extractor** | `/understand-domain` Phase 4c | ≤10 | 为单个域从 KG 子集提取 flow/step |
| **domain-analyzer** | `/understand-domain` Path 1 | 1 | 遗留单体域分析（无 KG 时使用） |
| **wiki-worker** | `/understand-wiki` Phase 1 | ≤5 | 生成单个微服务的 Bounded Context Wiki |
| **wiki-reviewer** | `/understand-wiki` Quality Gate | 1 | 审查 Wiki 准确性（仅 `--review`） |
| **article-analyzer** | `/understand-knowledge` Phase 3 | ≤3 | 从 Wiki 文章提取 entity/claim/关系 |
| **knowledge-graph-guide** | 用户直接选用 | 1 | KG 导航助手（咨询型，非 pipeline） |

### 12.3 关键 Agent 详解

#### project-scanner

**输入**：`$PROJECT_ROOT`，可选 README/manifest 片段  
**输出**：`intermediate/scan-result.json`（files[], importMap, totalFiles, estimatedComplexity）  
**关键约束**：
- 必须跑 `scan-project.mjs` + `extract-import-map.mjs`，禁止自行遍历文件树
- `totalFiles` 须与 `files` 数组长度一致
- 路径不得虚构

#### file-analyzer

**输入**：批次文件列表、`ua-file-extract-results-<i>.json`（Tree-sitter 预提取）、`batchImportData`、`neighborMap`、`ruleEngineEdges`  
**输出**：`intermediate/batch-<i>.json`  
**关键约束**：
- 禁止重跑 `extract-structure.mjs`（结构已预计算）
- imports 边数须等于 `batchImportData` 中该 batch 的总边数
- 仅用 39 种合法边类型
- 禁止 `module:` / `concept:` 节点（已废弃）
- summary 禁止泛化模板句

#### architecture-analyzer

**输入**：文件节点、import 边、全量边；可选语言/框架/locale 上下文  
**输出**：`intermediate/layers.json`  
**关键约束**：
- 每个输入文件节点必须且仅出现在一层
- 层数 3–10
- 信任脚本图分析结果，不重读源码

#### domain-discoverer

**输入**：`kg-summary.json`（modules、keyNodes、crossModuleEdges、layers）  
**输出**：`intermediate/domain-discovery.json`  
**关键约束**：
- 按业务目的分组，非技术层
- 3–8 域
- 每模块尽量唯一归属
- 禁止读源码、禁止创建 flow/step
- 文档-only 模块不得成域
- prefer-split（宁多不少）

#### domain-flow-extractor

**输入**：`domain-<name>.json` + 平台策略（backend/frontend/mobile）  
**输出**：`intermediate/flows-<name>.json`  
**关键约束**：
- 必须沿 `calls` 边追踪（backend）/ `routes`/`depends_on`（frontend）/ `navigates_to`（mobile）
- 每 flow ≥4 步
- 禁止泛化步骤名（"Validate Input"、"Execute Business Logic" 等）
- `lineRange` 必须来自 KG 节点，不得虚构
- 只产 flow/step，不产 domain 节点

#### wiki-worker

**输入**：`$PROJECT_ROOT`、KG、DG、语言、可选 `$TARGET_DOMAIN`  
**输出**：`intermediate/wiki/service.json` + `domains/<slug>.json`  
**关键约束**：
- 两轮生成：骨架 → 源码扩写
- 禁止写 wiki 目录外
- 单文件读取 ≤200 行
- 内容必须可追溯到 KG/源码
- 无 DG 域节点则硬失败
- 支持 mobile/frontend 模式

### 12.4 调度关系全景图

```
/understand (Phase 1→6)
  ├── project-scanner ×1
  ├── file-analyzer ×N (≤10 并发)
  ├── assemble-reviewer ×1
  ├── architecture-analyzer ×1
  ├── tour-builder ×1
  └── graph-reviewer ×1 (可选)

/understand-domain
  ├── Path 1: domain-analyzer ×1
  └── Path 2:
      ├── domain-discoverer ×1
      └── domain-flow-extractor ×N (≤10 并发)

/understand-wiki
  ├── wiki-worker ×N (≤5 并发)
  └── wiki-reviewer ×1 (可选)

/understand-knowledge
  └── article-analyzer ×N (≤3 并发)
```

### 12.5 Agent 设计原则

1. **Leaf Only**：所有 pipeline Agent 均为 Leaf，禁止再派发子 Agent，避免 context 膨胀和不可控递归
2. **确定性前置**：Agent 收到的输入已经过脚本预处理（Tree-sitter、import 图、规则引擎边），LLM 只做语义层面补充
3. **约束优先**：每个 Agent prompt 中包含明确的禁止列表和必须遵守的数值约束
4. **输出契约**：输出文件名、JSON 结构、字段类型均有严格约定，由后续脚本/Schema 校验
5. **可选 vs 必须**：`graph-reviewer` 和 `wiki-reviewer` 仅在 `--review` 时启用，默认走零 LLM token 的确定性校验

---

## 十三、与 CodeGraph 的对比分析

### 13.1 CodeGraph 简介

[CodeGraph](https://github.com/colbymchenry/codegraph)（5000+ stars）是一个开源的代码知识图谱工具，通过 tree-sitter 预索引代码库，存入本地 SQLite，以 MCP Server 形式向 AI Agent 暴露查询接口，号称减少 ~58% tool calls、~16% 成本。

### 13.2 定位差异

| 维度 | CodeGraph | Understand-Anything |
|------|-----------|---------------------|
| **核心定位** | AI Agent 的代码查询加速器 | 企业级跨端知识库构建体系 |
| **目标** | 减少 Agent 的文件扫描开销 | 从源码到业务全景的完整知识栈 |
| **产物** | SQLite 图数据库（符号/调用/导入） | JSON 分层知识体系（KG → Domain → Wiki → Business） |
| **用户** | 单个开发者 + AI Agent | 团队 + 多端协作 |
| **场景** | 代码问答加速 | 团队知识管理 + 跨端业务理解 |

> **关键观察**：Understand-Anything 的 Structure 层（L5）在**功能上完全覆盖**了 CodeGraph 的全部核心能力，并在注解推导、跨语言解析等方面超越 CodeGraph。CodeGraph 本质上只是 UA 知识金字塔的最底层（代码结构图），而 UA 在此之上还构建了 4 层更高维度的知识。

### 13.3 架构对比

| 维度 | CodeGraph | Understand-Anything |
|------|-----------|---------------------|
| **解析技术** | tree-sitter（19+ 语言） | tree-sitter WASM（13 语言）+ 非代码 parsers |
| **存储** | SQLite 本地数据库 | JSON 文件（`.understand-anything/`） |
| **查询接口** | MCP Server（标准协议） | 自建 API Server + CLI（POST JSON） |
| **索引策略** | 文件级增量（OS file watcher + FNV-1a hash） | 结构指纹（SHA-256 + AST 签名区分 cosmetic/structural） |
| **LLM 参与** | **零**（纯确定性索引） | **混合**（确定性 + LLM 语义分析） |
| **图算法** | 基础遍历（callers/callees/影响分析） | Louvain 社区检测 + RRF 融合 + 图扩展 |

### 13.4 能力对比

> **核心结论**：UA 的 Structure 层完全覆盖 CodeGraph 的功能集，且在框架注解推导、跨语言 import 解析、非代码文件解析方面**超越** CodeGraph。

#### Structure 层功能覆盖对照

| CodeGraph 功能 | UA 对应实现 | UA 额外能力 |
|---------------|------------|-------------|
| tree-sitter 符号解析（19 语言） | `extract-structure.mjs`（13 语言 WASM） | + 非代码 parsers（YAML/Dockerfile/GraphQL/SQL/Protobuf/Shell） |
| 调用图（callers/callees） | Tree-sitter `extractCallGraph` + `/api/graph-query/neighbors` | + Rule Engine 从注解推导调用关系 |
| Import 链 | `extract-import-map.mjs`（13 语言专用 resolver） | + tsconfig paths 别名、Go mod、PHP PSR-4、Python 相对 import |
| 类继承/接口 | KG `inherits`/`implements` 边 | + DI 注入关系（`@Autowired`→`injects` 边） |
| 影响分析（blast radius） | `/api/graph-query/impact` + `affected` | + 架构层面的 blast radius |
| 全文搜索 | MiniSearch + jieba CJK 分词 + `/api/source/search` | + RRF 融合（文本+图扩展） |
| Web 路由 | KG `provides_api`/`consumes_api` 边 | + `provides_route`/`consumes_route` + endpoint 提取 |
| Symbol search | `/api/structure/search` | + `structure --chain`、`--implementors` |
| File reading | `/api/source --file` | + lineRange 精确定位 |
| — | — | + **RPC/MQ 关系**（`provides_rpc`/`consumes_rpc`/`subscribes`/`publishes`） |
| — | — | + **框架注解→边推导**（Spring/Dubbo/Kafka/gRPC/Feign/Hilt/NestJS） |
| — | — | + **跨服务符号解析**（自动 follow 到 provider 服务） |
| — | — | + **非代码结构**（配置/infra/数据库表/Pipeline 节点） |

#### 超越 Structure 层的更高维度（CodeGraph 完全不具备）

| UA 独有层 | 能力 | 解决的问题 |
|-----------|------|-----------|
| **L4 知识图谱** | 14 种节点 + 43 种边 + LLM 语义摘要 | 代码意图理解（不只是结构） |
| **L3 领域图谱** | domain/flow/step 三层业务模型 | 业务流程可视化 |
| **L2 Wiki** | 自动生成 Bounded Context 文档 | 团队知识共享 |
| **L1 Business** | Feature-centric M:N 跨端关联 | 跨端业务全景 |
| **跨服务拓扑** | system-graph / client-graph / frontend-graph | 微服务间调用关系 |
| **可视化** | React Flow + ELK 交互式 Dashboard | 非 Agent 用户也能使用 |

### 13.5 使用成本对比

| 维度 | CodeGraph | Understand-Anything |
|------|-----------|---------------------|
| 索引成本 | **零 LLM token**（纯 tree-sitter） | 混合（确定性 + LLM 分析，首次较高） |
| 查询成本 | 零 token（MCP 本地查询） | CLI 查询零 token；但 Wiki/Domain 生成需 LLM |
| 维护成本 | 文件 watcher 自动同步 | 指纹增量 + Git diff 触发 |
| 部署复杂度 | `npx codegraph`（开箱即用） | pnpm monorepo + multi-phase pipeline |
| 首次分析时间 | 秒级（~60 files/sec） | 分钟级（含 LLM 调用） |

### 13.6 适用场景对比

| 场景 | 推荐方案 | 原因 |
|------|----------|------|
| **日常代码问答加速** | CodeGraph | 零 LLM 成本，即时响应，减少 tool calls |
| **新人 Onboarding** | Understand-Anything | Wiki + Tour + 架构分层，可读性强 |
| **微服务架构理解** | Understand-Anything | 跨服务拓扑 + 业务域 + Wiki |
| **跨端业务梳理** | Understand-Anything | Feature-centric + Facet 体系 |
| **代码重构影响分析** | 两者互补 | CodeGraph 快速查 callers；UA 提供架构层面洞察 |
| **大规模 Monorepo 探索** | CodeGraph（查询）+ UA（全景理解） | 结合使用效果最佳 |
| **业务文档自动生成** | Understand-Anything | Wiki + Business Landscape |
| **CI/CD 中的知识更新** | Understand-Anything | workflow 模式 + checkpoint |

### 13.7 设计哲学差异

| CodeGraph | Understand-Anything |
|-----------|---------------------|
| **做减法**：减少 Agent 工具调用和 token 消耗 | **做加法**：构建从代码到业务的完整知识栈 |
| **纯确定性**：零 LLM 参与，可预测、可重复 | **混合智能**：确定性保底 + LLM 语义增强 |
| **单层图**：符号级代码图（AST 粒度） | **多层图**：代码→域→Wiki→业务四层渐进 |
| **查询优先**：为 Agent 提供即时上下文 | **理解优先**：为团队构建可持续知识资产 |
| **轻量接入**：一行命令开始使用 | **渐进接入**：单服务到全企业逐步扩展 |
| **工具定位**：AI Agent 的加速插件 | **平台定位**：企业知识管理基础设施 |

### 13.8 互补性分析

两者的关系更准确地说是**层级包含 + 运营差异**：

**功能层面**：UA 的 Structure 层（L5）**完全包含** CodeGraph 的功能集，且在注解推导、跨服务追踪等方面更强。CodeGraph ≈ UA 知识金字塔的底座部分。

**运营层面**：CodeGraph 在部署便捷性和实时性上有优势：

| 维度 | CodeGraph 运营优势 | UA 当前状态 |
|------|-------------------|-------------|
| 部署 | `npx codegraph` 一行命令 | pnpm monorepo + `pnpm run serve` |
| 实时性 | OS file watcher 自动同步 | Git diff + 手动/hook 触发 |
| 协议 | MCP 标准（自动集成所有兼容 Agent） | 自建 API（需要 CLI wrapper） |
| 成本 | 零 LLM token | Structure 层零 token，但上层需要 LLM |
| 启动时间 | 即时（SQLite 预加载） | 需要 API Server 运行中 |

**结论**：
- 如果只看「帮 Agent 查代码结构」这个单一需求，UA 在功能上已经覆盖了 CodeGraph 且更强大
- CodeGraph 的真正价值在于**极低的使用门槛**和**MCP 标准协议**带来的生态集成便利
- UA 的真正价值在于它**远超代码结构**，进入了业务语义、跨端关联、团队知识管理等 CodeGraph 根本触及不到的领域

可能的演进方向：
- UA 可考虑将 Structure 层独立为 MCP Server，获得 CodeGraph 的部署便捷性
- 或者直接让 CodeGraph 作为 UA 的底层加速器（替代 extract-structure.mjs 的部分职能）

### 13.9 Understand-Anything 独特优势

1. **业务语义层**：CodeGraph 止步于代码符号，UA 能回答「这段代码在业务上做什么」
2. **跨端/跨仓库**：Facet 体系 + Feature-centric M:N 关联是 CodeGraph 完全不具备的能力
3. **团队协作产物**：Wiki/Tour/Dashboard 面向团队共享，而非仅服务于 Agent
4. **注解驱动关系**：Rule Engine 能从 Spring/Dubbo/Kafka 等框架注解推导出 RPC/MQ/DI 边
5. **渐进式知识积累**：每次分析的结果持续积累，形成可维护的知识资产

### 13.10 CodeGraph 独特优势

1. **零成本运行**：无需 LLM API key，纯本地运行
2. **即时可用**：无需等待 LLM 分析，索引秒级完成
3. **MCP 标准协议**：自动集成所有 MCP 兼容 Agent
4. **实时同步**：OS 原生 file watcher，代码变更即时反映
5. **更广语言支持**：19+ 语言（UA 为 13 语言 + 非代码 parsers）
6. **简单部署**：单命令即可使用，无 monorepo 复杂度

