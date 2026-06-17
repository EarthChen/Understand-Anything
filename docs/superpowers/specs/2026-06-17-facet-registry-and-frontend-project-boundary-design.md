# 设计:facet/platform 单一真值源 + 前端「项目是合并边界」

- 日期:2026-06-17
- 范围:仅 `understand-anything-plugin/skills/understand-business`(+ 它消费的 `understand-wiki/build-frontend-graph.py` 前端聚合步)
- 状态:已通过 brainstorming 逐点确认,待用户复核

## 背景与动机

在评估四个技能(understand / understand-domain / understand-wiki / understand-business)对前端 Web、移动端、Java 微服务的支持时,定位到两个贯穿性问题,本设计只解决其中两项:

1. **facet/platform 真值表散落在 6 处且互相矛盾**,并已造成实际 bug。
2. **前端多项目聚合默认按名合并**,与用户实际架构(一个前端项目含多个业务;不同前端项目各管不同业务)不符,会把不同业务误并为一个。

### 用户架构(本设计的前提)

- **前端**:一个前端项目通常包含**多个**(可能相关的)业务;业务粒度是项目内的 feature/domain。不同前端项目各自负责不同业务。
- **移动端**:android/ios/flutter 作为独立平台。
- **后端**:**多个**微服务可能**共同**组成**一个**业务(M:N,现有 association/serverIndex 模型)。
- 一个业务 = 一部分前端 + 一部分客户端(移动) + 一组服务端。

### 明确不在本次范围

- 非 Java 微服务的 RPC 提取、Java 服务间 RPC/HTTP 调用链聚合
- harmony / 小程序(uni-app)/ Angular / 后端基础设施(网关、MQ、服务发现、追踪、Saga)
- 微前端 / SSR
- **Web↔Mobile 语义对齐(P2)**:本设计保留现有 frontend↔mobile「精确同名合并」行为,不改进、也尽量不回归它。

---

## 第 1 块:facet/platform 单一真值源

### 现状(散落 6 处,互相矛盾)

| 位置 | 定义 | 问题 |
|---|---|---|
| `schemas/system.schema.json:17` | facet enum = `server/mobile/frontend/shared` | 没有 web/backend/desktop/test |
| `scenario_detector.py:16` | client=`{mobile,frontend,web,desktop}`,server=`{server,backend}` | 引入 schema 没有的 web/desktop/backend |
| `check_facets.py:18` | facet→graph 映射 `{backend,server,mobile,frontend,test}` | **没有 web**→`web` facet 永远算 graph missing;多了 backend/test |
| `client_facets.py:161` | 策略表 `{mobile,frontend,web}` | web 别名到 frontend;desktop 不支持 |
| `detect_platforms.py:482` | `_basic_validate` facet=`{server,mobile,frontend,shared}` | 与上面三处都不一致 |
| `detect_platforms.py:21` | `MOBILE_PLATFORMS` 含 `web`,命名为 mobile | 命名误导(其实是「客户端」平台集);且该常量与 `SERVER_PLATFORMS` 当前**未被任何代码引用**(死常量,真正校验走 schema enum) |

**已确认 bug**:`type:"web"` 的 facet 能过 scenario_detector,但在 check_facets 拿不到 graph(永远 missing)、且过不了 schema 校验;`type:"backend"` 直接 fail schema。

### 设计目标

消除歧义:**一个概念只有一个规范名**,所有消费方从同一份登记表派生,新增防漂移测试。

### 新增模块 `understand-business/facets.py`

唯一真值源。每个 facet 类型登记一条元数据:

```python
# 规范 facet 类型(唯一,无双名制)
FACET_REGISTRY = {
    "server":   {"role": "server", "graph_file": "system-graph.json",   "supported": True},
    "mobile":   {"role": "client", "graph_file": "client-graph.json",   "supported": True},
    "frontend": {"role": "client", "graph_file": "frontend-graph.json", "supported": True},
    "shared":   {"role": "shared", "graph_file": None,                  "supported": False},
    "desktop":  {"role": "client", "graph_file": None,                  "supported": False},
    "test":     {"role": "test",   "graph_file": None,                  "supported": False},
}

# 输入别名 → 唯一规范名(内部只流转规范名;无双名制)
_INPUT_ALIASES = {"backend": "server", "web": "frontend"}
#   backend: 有历史数据,必须长期兼容(静默归一,不告警)
#   web:     无历史数据;仅为兼容刚合并的 web-facet 接受路径而保留归一,规范名一律用 frontend

def canonical_facet(t: str) -> str:
    """把别名归一到唯一规范名(内部只见规范名)。未知类型原样返回。"""
```

派生(全部从登记表导出,消费方不再各写一份):

- `CLIENT_FACET_TYPES` = role==client 的规范名集合
- `SERVER_FACET_TYPES` = role==server 的规范名集合
- `graph_file_for(facet_type)` = 先 `canonical_facet` 再查 `graph_file`(于是 `web`→`frontend`→`frontend-graph.json`,**修掉 check_facets 的 web bug**)
- 平台集合(与 facet 解耦;`MOBILE_PLATFORMS`/`SERVER_PLATFORMS` 当前是死常量,本次让登记表成为唯一来源并接入 `_basic_validate`):
  - `CLIENT_PLATFORMS = {ios, android, flutter, react-native, kotlin-multiplatform, web}` —— **由 `MOBILE_PLATFORMS` 改名而来,保留 web**。原因:client 检测(`detect_platform_type:166,226`)合法返回 `web`(client facet 下的 web 目标);问题在命名(应叫 client 而非 mobile),不是 web 不该在里面。
  - `FRONTEND_PLATFORMS = {web}`(facet 类型 `web` 消除;但**平台值 `web`** 是 frontend/client 服务的技术平台,与 ios/android 并列,保留)
  - `SERVER_PLATFORMS = {java, java-spring, kotlin, go, python, node, dotnet, rust}`
  - 各集合统一含 `unknown`
  - 约束:登记表所有平台集合的并集 == `system.schema.json` 的 `service.platform.enum`(由测试保证一致)

### 改造消费方(删除本地副本,import 登记表)

1. `scenario_detector.py` — `CLIENT_FACET_TYPES`/`SERVER_FACET_TYPES` 改 import;分类前先 `canonical_facet`。
2. `check_facets.py` — `GRAPH_FILE_MAP` 改用 `graph_file_for`(顺带修 web bug)。
3. `client_facets.py` — `CLIENT_STRATEGIES` 的键与 `_FRONTEND_FACETS` 从登记表派生;`web` 经归一走 frontend 策略。
4. `detect_platforms.py` — `MOBILE_PLATFORMS`/`SERVER_PLATFORMS` 改 import;`_basic_validate` 的 `facet_types` 改用登记表规范集合。
5. `assemble_business_features.py` — `_FRONTEND_FACETS` 改用登记表(规范名 `frontend`)。

### schema 修正

`system.schema.json` 的 facet `type` enum 改为规范全集:`["server","mobile","frontend","shared","desktop","test"]`(**不含 backend/web,保持 schema 无歧义**)。
service `platform` enum 已包含所需值,保持(`web` 作为平台值合法)。

**向后兼容(关键)**:`validate_system_json` 在校验前先对副本做 `canonical_facet` 归一(`backend→server`、`web→frontend`),于是历史含 `type:"backend"` 的 system.json **仍能通过校验**;内部流转与落盘一律规范名。`backend` 有历史数据需长期支持;`web` 无历史数据,仅兼容刚合并的接受路径。

### 防漂移测试 `tests/test_facets_registry.py`

- 断言:任一消费方引用的 facet 类型都在登记表中。
- 断言:每个 `supported==True` 的 client/server 类型都有 `graph_file` 且在 `CLIENT_STRATEGIES`/server 处理中可达;`supported==False` 的类型显式无策略(经 `unsupportedFacets` 暴露)。
- 断言:`canonical_facet("web")=="frontend"`、`canonical_facet("backend")=="server"`。
- 断言(兼容):含 `type:"backend"` 的历史 system.json 经 `validate_system_json` 仍判 valid。
- 断言:`FRONTEND_PLATFORMS=={web}`;`web` 在 `CLIENT_PLATFORMS` 中。
- 断言:所有平台集合并集 == `system.schema.json` 的 `service.platform.enum`。

---

## 第 2 块:前端「项目是合并边界」

### 现状与问题

`build-frontend-graph.py:_aggregate_features:438-488` 跨 repo 按 `_normalize_feature_name` **同名即合并**,并产出 domainLink。该语义假设「同一业务在多 repo 复刻」,与用户架构相反(不同前端项目=不同业务),会把不同业务误并。

且即便前端层不合并,业务层 `assemble_business_features.assemble_features:199-203` 仍按裸 `name` 聚合,会在业务层把不同业务又合回一个。

### 策略(已确认)

- 跨前端项目**默认永不自动合并**;同名→端到端按 `(项目, name)` 区分,呈现为各自独立业务。
- 仅**显式配置**可合并;**撤掉**名字自动合并与共享 API 自动合并(共享 API 信号不可靠:公共/配置 API 会误并,且跨项目共享 API 本就罕见)。
- 保留现有 **frontend↔mobile 精确同名合并**(P2 不动),仅在「2+ 前端项目撞名」时拆开。

### A) `build-frontend-graph.py:_aggregate_features`(前端聚合步)

- 默认不再跨 repo 按名分组,**每个 repo 的特性各自成条**。
- 项目内身份:feature `id` 改为项目限定 `feature:<repo>:<domain>`(今天两 repo 同域会撞 id);保留人读 `name`;新增 `project` 字段(= repo 名,已保证 repo 名唯一,见 `:554`);`sourceRepos=[该 repo]`。
- 显式合并:从 `system.json` 的 frontend facet 读 `frontendMergeGroups`(`build-frontend-graph` 已会读 system.json,见 `_frontend_subpaths:339`):

```json
{
  "type": "frontend",
  "subPaths": ["seller-portal", "buyer-web", "ops-web"],
  "frontendMergeGroups": [
    {
      "canonicalName": "订单",
      "members": [
        {"project": "seller-portal", "feature": "订单"},
        {"project": "ops-web",       "feature": "订单管理"}
      ]
    }
  ]
}
```

仅列出的成员并成一条(union 字段;`sourceRepos`=所列项目;产出一条 domainLink)。其余按项目独立。

- `domainLinks` 仅来自显式合并组(不再有名字派生 link)。
- `_normalize_feature_name` 保留,仅用于把配置成员匹配到特性(容错大小写/连字符)。
- 更新 frontend-graph 校验(`_validate` / `validate-wiki-schema.mjs`):允许同名跨项目的多条特性、新增 `project` 字段、domainLinks 可为空。

### B) `client_facets.consolidate_frontend`

前端图特性已按项目拆好,每条直接成独立 consolidated 条目,携带 `project`,身份 = `(项目, name)` 下传。它本就读 features + sourceRepos,改动小(补 `project`/项目限定 id)。

### C) `assemble_business_features.assemble_features`(端到端关键)

- frontend 特性聚合键从裸 `name` 改为 `(项目, name)`。
- **frontend↔mobile 撞名规则(选项 A)**:按 name 分组后——
  - 组内 **≤1 个**不同前端项目 → 维持今天行为(frontend + mobile 同名合为一个 business feature,跨 facet 多 clientLayer)。
  - 组内 **2+ 个**不同前端项目 → 各前端项目拆为独立 business feature;同名 mobile 单独成一条(无法判定配哪个前端业务)。
- `association_discovery` / phase2 的 `assoc_by_name`(`:219`)对 frontend 关联同步带 `project`,避免两项目关联互撞;`_merge_server_associations` 的 touchpoint 也携带 project 维度。
- 展示:business feature `name` 保持干净("订单");新增 `project`/`scope` 字段;`id` 带项目(`feature:订单@seller-portal`)。

### 测试

- 前端聚合:两 repo 同名,无合并组 → 2 条各带 project;有合并组 → 1 条合并 + 1 domainLink;repo 名唯一性仍校验。
- 业务装配(覆盖撞名表):
  - 前端`seller`「订单」+ 移动端「订单」(无撞名)→ **1 个**业务(前端+移动端)。
  - 前端`seller`「订单」+ 前端`buyer`「订单」(无移动端)→ **2 个**业务。
  - 前端`seller`「订单」+ 前端`buyer`「订单」+ 移动端「订单」→ **3 个**业务(两前端拆开 + 移动端单独)。
- association/phase2:两前端项目同名各自产生独立关联,不互撞。

---

## 影响面与风险

- 两块都局限在 understand-business(+ build-frontend-graph 前端聚合),不触碰 understand / understand-domain / 移动端与后端提取逻辑。
- frontend-graph.json 结构小幅演进(每特性加 `project`、id 变项目限定、domainLinks 仅显式)——需同步校验器与下游读取。
- business-features.json 新增 `project`/`scope`、id 变化——dashboard / wiki 若直接读 feature id 需兼容(待实现时排查)。
- 历史 system.json 用 `backend`(有历史数据)经校验前归一仍工作,长期兼容;`web` 无历史数据,规范统一为 `frontend`。

## 待实现时进一步确认的细节

- frontend-graph.json 与 business-features.json 的下游消费者(dashboard、wiki-index 等)对 id 变化的兼容点。
- `frontendMergeGroups` 是否需要 schema 校验(建议纳入 system.schema.json)。
