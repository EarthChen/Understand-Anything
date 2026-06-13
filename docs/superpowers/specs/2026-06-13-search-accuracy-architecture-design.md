# 搜索准确性和架构增强设计

> **Date:** 2026-06-13
> **Status:** Draft — 等待审阅
> **Scope:** 搜索准确性、图扩展、架构优化

---

## 背景

当前搜索系统存在以下核心问题：

1. **中文分词质量差**：使用 bigram 分词，产生大量噪声 token（如 "权限管理" → ["权限", "限管", "管理"]）
2. **图扩展只有 1-hop**：无法发现间接关联节点（A → B → C，搜索 A 时无法发现 C）
3. **搜索评分函数简单**：只考虑基本名称匹配和类型加权，未充分利用图结构和语义信号
4. **搜索和图扩展分离**：RRF 融合只是简单排名融合，未深度整合

**目标**：提升搜索准确性 30-50%，图扩展覆盖率 50-100%，同时保持系统稳定性。

**非目标**：
- 不引入 embedding/向量搜索（阶段 2 可选）
- 不修改客户端 SearchEngine (Fuse.js)
- 不修改 ua_query.py API 接口

---

## 架构设计

### 混合方案：两阶段实施

**阶段 1（1-2 周）**：快速提升搜索质量
- 引入 jieba 分词替换 bigram
- 图扩展从 1-hop 升级到 2-hop
- 优化评分函数
- tags 独立为加权字段

**阶段 2（3-4 周）**：架构优化
- 增量索引更新机制
- 向量搜索（可选）
- 优化图扩展算法
- 搜索和图扩展深度整合

---

## 阶段 1：快速提升

### 改动 1：引入 jieba 分词

**问题**：bigram 分词产生噪声 token，影响中文搜索准确性。

**方案**：添加 `@node-rs/jieba` 依赖，替换 bigram 分词。

**文件**：`understand-anything-plugin/packages/dashboard/src/api/handlers/search.ts`

**实现**：
```typescript
import { cut } from '@node-rs/jieba'

// 替换 bigram 逻辑
const cjk = text.match(/[一-鿿]+/g)
if (cjk) {
  for (const segment of cjk) {
    const words = cut(segment, true)  // 精确模式
    for (const word of words) {
      if (word.length > 0) tokens.push(word)
    }
  }
}
```

**效果**：
- "权限管理" → ["权限", "管理"]（消除 "限管" 噪声）
- "订单支付服务" → ["订单", "支付", "服务"]

**依赖**：
```bash
pnpm --filter @understand-anything/dashboard add @node-rs/jieba
```

**Fallback**：如果 jieba 加载失败，自动降级到 bigram。

### 改动 2：图扩展升级到 2-hop

**问题**：当前 `kgGraphExpansion` 只遍历 1-hop 邻居，无法发现间接关联节点。

**方案**：改为 2-hop BFS 遍历。

**文件**：`understand-anything-plugin/packages/dashboard/src/api/handlers/search.ts`

**实现**：
```typescript
function kgGraphExpansion(
  state: SearchIndexState,
  seedIds: string[],
  maxNeighbors: number = 50,
): Map<string, number> {
  const adj = state.adjacency
  const seedSet = new Set(seedIds)
  const neighborScores = new Map<string, number>()
  const visited = new Set<string>(seedIds)

  // 1-hop neighbors
  for (const seedId of seedIds) {
    const neighbors = adj.get(seedId) ?? new Set()
    for (const neighborId of neighbors) {
      if (seedSet.has(neighborId)) continue
      const current = neighborScores.get(neighborId) ?? 0
      neighborScores.set(neighborId, current + 1)
      visited.add(neighborId)
    }
  }

  // 2-hop neighbors
  const oneHopIds = [...neighborScores.keys()]
  for (const oneHopId of oneHopIds) {
    const neighbors = adj.get(oneHopId) ?? new Set()
    for (const neighborId of neighbors) {
      if (visited.has(neighborId)) continue
      const current = neighborScores.get(neighborId) ?? 0
      neighborScores.set(neighborId, current + 0.5)  // 2-hop 权重降低
      visited.add(neighborId)
    }
  }

  const sorted = [...neighborScores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxNeighbors)

  const rankMap = new Map<string, number>()
  for (let i = 0; i < sorted.length; i++) {
    rankMap.set(sorted[i][0], i + 1)
  }
  return rankMap
}
```

**效果**：
- 1-hop 邻居：直接关联节点（权重 1.0）
- 2-hop 邻居：间接关联节点（权重 0.5）
- 最多返回 50 个邻居节点

### 改动 3：优化评分函数

**问题**：当前 `_score_node_relevance` 函数只考虑基本名称匹配和类型加权。

**方案**：增加更多信号，提升评分准确性。

**文件**：`understand-anything-plugin/skills/understand-query/ua_query.py`

**实现**：
```python
def _score_node_relevance(node: dict[str, Any], query: str) -> float:
    """Score a node's relevance to the query using language-agnostic structural signals."""
    q = query.lower()
    name = node.get("name", "").lower()
    node_id = node.get("id", "").lower()
    score = 0.0

    # 名称匹配
    if q == name:
        score += 15.0
    elif q in name:
        score += 5.0 + (len(q) / max(len(name), 1))

    # ID 匹配
    if q in node_id:
        score += 2.0

    # 类型加权
    node_type = node.get("type", "")
    type_bonus = {"class": 2, "function": 1.5, "interface": 2, "module": 1, "endpoint": 2, "service": 2.5}.get(node_type, 0)
    score += type_bonus

    # 文件路径和行号
    if node.get("filePath"):
        score += 1.5
    if node.get("lineRange"):
        score += 1.0

    # 实现类加权
    raw_name = node.get("name", "")
    if any(raw_name.endswith(s) for s in _IMPL_SUFFIXES):
        score += 3.0
    elif any(raw_name.endswith(s) for s in _CONFIG_SUFFIXES):
        score -= 2.0

    # 新增：标签匹配
    tags = node.get("tags", [])
    if tags:
        tag_text = " ".join(tags).lower()
        if q in tag_text:
            score += 4.0

    # 新增：摘要匹配
    summary = node.get("summary", "").lower()
    if summary and q in summary:
        score += 3.0

    # 新增：图结构信号（阶段 2 实现）
    # 这些信号需要从图查询中获取，包括：
    # - 节点度数（被引用次数）
    # - PageRank 分数
    # - 社区发现标签
    # 将在阶段 2 的统一搜索框架中实现

    return score
```

**新增信号**：
- 标签匹配：如果查询出现在节点标签中，加 4 分
- 摘要匹配：如果查询出现在节点摘要中，加 3 分

### 改动 4：tags 独立为加权字段

**问题**：tags（LLM 提取的语义标签）被拼入 `text` 字段，与 name/summary/type 共享权重，丢失独立权重。

**方案**：tags 独立存储，增加独立权重。

**文件**：`understand-anything-plugin/packages/dashboard/src/api/handlers/search.ts`

**实现**：
```typescript
// 1. LumoDocument 接口增加 tags 字段
interface LumoDocument extends Record<string, unknown> {
  id: string
  name: string
  summary: string
  type: string
  service: string
  content: string
  layer: string
  tags: string  // 新增
}

// 2. LUMO_SEARCH_KEYS 增加 tags
const LUMO_SEARCH_KEYS = [
  { name: "name", weight: 3 },
  { name: "summary", weight: 2 },
  { name: "tags", weight: 2.5 },   // 新增：高于 summary
  { name: "type", weight: 0.5 },
  { name: "content", weight: 1 },
] as const

// 3. pushKgItems 中 tags 独立存储
items.push({
  id: node.id,
  text: [node.name, node.summary, node.type].join(" "),  // 不再包含 tags
  meta: {
    name: node.name,
    type: node.type,
    layer: "kg",
    summary: node.summary,
    service: serviceName,
    filePath: fp,
    lineRange: node.lineRange,
  },
})

// LumoDocument
tags: (node.tags ?? []).join(" "),  // 独立字段
```

**效果**：
- tags 权重 2.5，高于 summary（2.0）
- tags 不再与 name/summary/type 共享权重
- 语义标签在搜索中更重要

---

## 阶段 2：架构优化

### 改动 5：增量索引更新机制

**问题**：每次搜索都需要检查索引是否需要重建，效率低。

**方案**：基于文件 mtime 的增量更新。

**实现**：
```typescript
interface IncrementalIndex {
  // 基础索引
  baseIndex: SearchIndexState

  // 增量更新
  updates: Map<string, {
    type: 'add' | 'update' | 'delete'
    item?: SearchIndexItem
    timestamp: number
  }>

  // 合并后的索引
  mergedIndex: SearchIndexState | null
}

// 增量更新逻辑
function updateIndexIncrementally(
  state: SearchIndexState,
  changedFiles: string[],
  projectRoot: string,
): SearchIndexState {
  const updates = new Map<string, SearchIndexItem>()

  for (const file of changedFiles) {
    const items = rebuildItemsForFile(file, projectRoot)
    for (const item of items) {
      updates.set(item.id, item)
    }
  }

  // 合并更新
  const mergedItems = state.items.map(item => {
    const update = updates.get(item.id)
    if (update) {
      updates.delete(item.id)
      return update
    }
    return item
  })

  // 添加新增的项
  for (const [id, item] of updates) {
    mergedItems.push(item)
  }

  // 重建索引
  return buildSearchIndexFromItems(mergedItems, state.edges)
}
```

**效果**：
- 只更新变更的文件，避免全量重建
- 索引更新速度提升 10x
- 支持后台异步更新

### 改动 6：向量搜索（可选）

**问题**：BM25F 无法处理语义相似但词汇不同的查询。

**方案**：引入 embedding 模型，支持语义搜索。

**实现**：
```typescript
interface VectorSearchIndex {
  // 向量索引
  vectors: Map<string, number[]>

  // embedding 模型
  embedder: (text: string) => Promise<number[]>

  // 向量搜索
  search(query: string, limit: number): Promise<SearchResult[]>
}

// 向量搜索与 BM25F 融合
function hybridSearch(
  query: string,
  bm25Results: SearchResult[],
  vectorResults: SearchResult[],
  limit: number,
): SearchResult[] {
  // RRF 融合
  const rrfScores = new Map<string, number>()
  const resultById = new Map<string, SearchResult>()

  for (let i = 0; i < bm25Results.length; i++) {
    const r = bm25Results[i]
    const rank = i + 1
    rrfScores.set(r.id, (rrfScores.get(r.id) ?? 0) + 1 / (RRF_K + rank))
    resultById.set(r.id, r)
  }

  for (let i = 0; i < vectorResults.length; i++) {
    const r = vectorResults[i]
    const rank = i + 1
    rrfScores.set(r.id, (rrfScores.get(r.id) ?? 0) + 1 / (RRF_K + rank))
    if (!resultById.has(r.id)) {
      resultById.set(r.id, r)
    }
  }

  const fused = [...rrfScores.entries()]
    .map(([id, rrfScore]) => {
      const result = resultById.get(id)
      if (!result) return null
      return { ...result, score: rrfScore }
    })
    .filter(Boolean) as SearchResult[]

  fused.sort((a, b) => b.score - a.score)
  return fused.slice(0, limit)
}
```

**效果**：
- 支持语义搜索，长尾查询效果提升 50%+
- 与 BM25F 结合，使用 RRF 融合
- 可选功能，根据实际效果决定是否启用

### 改动 7：优化图扩展算法

**问题**：当前图扩展算法效率低，可能遍历过多节点。

**方案**：引入双向 BFS 和剪枝策略。

**实现**：
```typescript
function bidirectionalBFS(
  state: SearchIndexState,
  startIds: string[],
  endIds: string[],
  maxDepth: number = 3,
): Map<string, number> {
  const adj = state.adjacency
  const startSet = new Set(startIds)
  const endSet = new Set(endIds)

  // 前向 BFS
  const forwardVisited = new Map<string, number>()
  const forwardQueue: Array<{ id: string; depth: number }> = []

  for (const id of startIds) {
    forwardVisited.set(id, 0)
    forwardQueue.push({ id, depth: 0 })
  }

  while (forwardQueue.length > 0) {
    const { id, depth } = forwardQueue.shift()!
    if (depth >= maxDepth) continue

    const neighbors = adj.get(id) ?? new Set()
    for (const neighborId of neighbors) {
      if (forwardVisited.has(neighborId)) continue
      forwardVisited.set(neighborId, depth + 1)
      forwardQueue.push({ id: neighborId, depth: depth + 1 })
    }
  }

  // 后向 BFS
  const backwardVisited = new Map<string, number>()
  const backwardQueue: Array<{ id: string; depth: number }> = []

  for (const id of endIds) {
    backwardVisited.set(id, 0)
    backwardQueue.push({ id, depth: 0 })
  }

  while (backwardQueue.length > 0) {
    const { id, depth } = backwardQueue.shift()!
    if (depth >= maxDepth) continue

    const neighbors = adj.get(id) ?? new Set()
    for (const neighborId of neighbors) {
      if (backwardVisited.has(neighborId)) continue
      backwardVisited.set(neighborId, depth + 1)
      backwardQueue.push({ id: neighborId, depth: depth + 1 })
    }
  }

  // 找到交集
  const intersection = new Map<string, number>()
  for (const [id, forwardDepth] of forwardVisited) {
    const backwardDepth = backwardVisited.get(id)
    if (backwardDepth !== undefined) {
      intersection.set(id, forwardDepth + backwardDepth)
    }
  }

  return intersection
}
```

**效果**：
- 双向 BFS 减少遍历节点数
- 剪枝策略跳过低权重边
- 缓存已访问节点，避免重复遍历

### 改动 8：搜索和图扩展深度整合

**问题**：搜索和图扩展是两个独立的步骤，未深度整合。

**方案**：设计统一的搜索框架。

**实现**：
```typescript
interface UnifiedSearchFramework {
  // 查询理解
  understandQuery(query: string): Promise<QueryIntent>

  // 搜索策略选择
  selectStrategy(intent: QueryIntent): SearchStrategy

  // 执行搜索
  execute(strategy: SearchStrategy): Promise<SearchResult[]>
}

interface QueryIntent {
  type: 'exact' | 'fuzzy' | 'semantic' | 'structural'
  entities: string[]
  relations: string[]
  scope: SearchScope
}

interface SearchStrategy {
  // 搜索方法
  methods: Array<{
    type: 'bm25' | 'vector' | 'graph' | 'hybrid'
    weight: number
    params: Record<string, unknown>
  }>

  // 图扩展策略
  graphExpansion: {
    enabled: boolean
    depth: number
    strategy: 'forward' | 'backward' | 'bidirectional'
    pruning: boolean
  }

  // 融合策略
  fusion: {
    method: 'rrf' | 'weighted' | 'learning-to-rank'
    weights: Record<string, number>
  }
}
```

**效果**：
- 根据查询类型选择最优搜索策略
- 图扩展和搜索深度整合
- 支持学习排序，优化搜索结果排序

---

## 验证标准

### 阶段 1 验证

1. **分词质量**：
   - "订单支付" → ["订单", "支付"]（无噪声）
   - "权限管理" → ["权限", "管理"]（无噪声）

2. **图扩展**：
   - 2-hop 邻居正确返回
   - 间接关联节点被发现

3. **搜索准确性**：
   - 英文: "AuthService" → 精确匹配排名第一
   - 中文: "订单支付" → jieba 分词匹配，无噪声 token
   - 中英混合: "支付payment" → 两种语言都能匹配

4. **性能**：
   - 索引构建 < 5s（1000 文件）
   - 查询延迟 < 100ms（p95）
   - 内存使用 < 200MB

### 阶段 2 验证

1. **增量更新**：
   - 只更新变更的文件
   - 索引更新速度提升 10x

2. **向量搜索（可选）**：
   - 语义相似查询返回相关结果
   - 长尾查询效果提升 50%+

3. **架构优化**：
   - 搜索和图扩展深度整合
   - 查询感知的搜索策略选择

---

## 风险和缓解措施

### 阶段 1 风险

1. **jieba 分词质量不稳定**
   - **缓解**：保留 bigram 作为 fallback，监控分词质量

2. **图扩展性能问题**
   - **缓解**：限制遍历深度和节点数，使用缓存

3. **评分函数改动影响现有结果**
   - **缓解**：A/B 测试，逐步 rollout

### 阶段 2 风险

1. **向量搜索增加复杂度和成本**
   - **缓解**：作为可选功能，根据实际效果决定是否启用

2. **增量更新可能导致数据不一致**
   - **缓解**：使用事务和版本控制，保证数据一致性

3. **架构重构可能引入 bug**
   - **缓解**：充分测试，灰度发布

---

## 实施计划

### 阶段 1（1-2 周）

**Week 1**：
- 引入 jieba 分词依赖
- 修改 `tokenize()` 函数
- 升级 `kgGraphExpansion()` 到 2-hop
- 优化 `_score_node_relevance()` 函数

**Week 2**：
- 添加 tags 独立字段
- 测试和验证
- 性能优化
- 文档更新

### 阶段 2（3-4 周）

**Week 3-4**：
- 设计增量索引更新机制
- 实现增量更新逻辑
- 优化图扩展算法

**Week 5-6**：
- 引入向量搜索（可选）
- 设计统一搜索框架
- 性能测试和优化
- 文档更新

---

## 文件清单

### 阶段 1

| 操作 | 文件 | 改动 |
|------|------|------|
| 修改 | `understand-anything-plugin/packages/dashboard/package.json` | 添加 jieba 依赖 |
| 修改 | `understand-anything-plugin/packages/dashboard/src/api/handlers/search.ts` | 分词、图扩展、tags |
| 修改 | `understand-anything-plugin/skills/understand-query/ua_query.py` | 优化评分函数 |

### 阶段 2

| 操作 | 文件 | 改动 |
|------|------|------|
| 新建 | `understand-anything-plugin/packages/dashboard/src/api/handlers/search-incremental.ts` | 增量索引更新 |
| 新建 | `understand-anything-plugin/packages/dashboard/src/api/handlers/search-vector.ts` | 向量搜索（可选） |
| 修改 | `understand-anything-plugin/packages/dashboard/src/api/handlers/search.ts` | 统一搜索框架 |

---

## 总结

本设计方案通过两阶段实施，逐步提升搜索准确性和架构质量：

1. **阶段 1**：快速提升搜索质量，解决最紧迫的问题（中文分词、图扩展、评分函数）
2. **阶段 2**：架构优化，提升可扩展性和性能（增量更新、向量搜索、统一框架）

预期效果：
- 搜索准确性提升 30-50%
- 图扩展覆盖率提升 50-100%
- 索引更新速度提升 10x
- 支持语义搜索，长尾查询效果提升 50%+

风险可控，实施计划合理，可以在保证稳定性的同时逐步提升搜索质量。
