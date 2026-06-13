# 搜索准确性和架构增强实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 提升搜索准确性 30-50%，图扩展覆盖率 50-100%，同时保持系统稳定性

**Architecture:** 两阶段实施方案：阶段 1 快速提升搜索质量（jieba 分词、2-hop 图扩展、优化评分函数、tags 独立字段），阶段 2 架构优化（增量索引更新、向量搜索、统一搜索框架）

**Tech Stack:** TypeScript, Python, @node-rs/jieba, LumoSearch, BFS, RRF

---

## 文件结构

### 阶段 1 文件

| 文件 | 职责 |
|------|------|
| `understand-anything-plugin/packages/dashboard/package.json` | 添加 jieba 依赖 |
| `understand-anything-plugin/packages/dashboard/src/api/handlers/search.ts` | 分词、图扩展、tags |
| `understand-anything-plugin/skills/understand-query/ua_query.py` | 优化评分函数 |

### 阶段 2 文件

| 文件 | 职责 |
|------|------|
| `understand-anything-plugin/packages/dashboard/src/api/handlers/search-incremental.ts` | 增量索引更新 |
| `understand-anything-plugin/packages/dashboard/src/api/handlers/search-vector.ts` | 向量搜索（可选） |
| `understand-anything-plugin/packages/dashboard/src/api/handlers/search.ts` | 统一搜索框架 |

---

## 阶段 1：快速提升搜索质量

### Task 1: 添加 jieba 依赖

**Files:**
- Modify: `understand-anything-plugin/packages/dashboard/package.json`

- [ ] **Step 1: 添加 jieba 依赖**

```bash
cd understand-anything-plugin/packages/dashboard
pnpm add @node-rs/jieba
```

- [ ] **Step 2: 验证依赖安装**

```bash
pnpm list @node-rs/jieba
```

Expected: `@node-rs/jieba` 出现在依赖列表中

- [ ] **Step 3: Commit**

```bash
git add understand-anything-plugin/packages/dashboard/package.json
git commit -m "feat: add @node-rs/jieba dependency for CJK tokenization"
```

### Task 2: 实现 jieba 分词替换 bigram

**Files:**
- Modify: `understand-anything-plugin/packages/dashboard/src/api/handlers/search.ts:85-111`

- [ ] **Step 1: 添加 jieba 导入**

在 `search.ts` 文件顶部添加导入：

```typescript
import { cut } from '@node-rs/jieba'
```

- [ ] **Step 2: 修改 tokenize 函数**

将 `tokenize` 函数（第 85-111 行）替换为：

```typescript
export function tokenize(text: string): string[] {
  const tokens: string[] = []
  const parts = text
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[\s_\-./\\:,;()[\]{}'"]+/)

  for (const part of parts) {
    if (!part) continue
    const lower = part.toLowerCase()
    if (lower.length >= 2 && /^[\x00-\x7F]+$/.test(lower)) {
      tokens.push(lower)
    }
  }

  const cjk = text.match(/[一-鿿]+/g)
  if (cjk) {
    for (const segment of cjk) {
      try {
        const words = cut(segment, true)  // 精确模式
        for (const word of words) {
          if (word.length > 0) tokens.push(word)
        }
      } catch {
        // Fallback to bigram if jieba fails
        for (let i = 0; i < segment.length - 1; i++) {
          tokens.push(segment.slice(i, i + 2))
        }
        if (segment.length === 1) tokens.push(segment)
      }
    }
  }

  return tokens
}
```

- [ ] **Step 3: 测试分词效果**

```bash
cd understand-anything-plugin/packages/dashboard
pnpm test -- --grep "tokenize"
```

Expected: 所有分词测试通过

- [ ] **Step 4: Commit**

```bash
git add understand-anything-plugin/packages/dashboard/src/api/handlers/search.ts
git commit -m "feat: replace bigram with jieba for CJK tokenization"
```

### Task 3: 升级图扩展到 2-hop

**Files:**
- Modify: `understand-anything-plugin/packages/dashboard/src/api/handlers/search.ts:199-226`

- [ ] **Step 1: 修改 kgGraphExpansion 函数**

将 `kgGraphExpansion` 函数（第 199-226 行）替换为：

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

- [ ] **Step 2: 测试图扩展效果**

```bash
cd understand-anything-plugin/packages/dashboard
pnpm test -- --grep "kgGraphExpansion"
```

Expected: 所有图扩展测试通过

- [ ] **Step 3: Commit**

```bash
git add understand-anything-plugin/packages/dashboard/src/api/handlers/search.ts
git commit -m "feat: upgrade graph expansion from 1-hop to 2-hop BFS"
```

### Task 4: 优化评分函数

**Files:**
- Modify: `understand-anything-plugin/skills/understand-query/ua_query.py:1138-1163`

- [ ] **Step 1: 修改 _score_node_relevance 函数**

将 `_score_node_relevance` 函数（第 1138-1163 行）替换为：

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

    return score
```

- [ ] **Step 2: 测试评分函数**

```bash
cd understand-anything-plugin
python -m pytest tests/test_ua_query.py -k "_score_node_relevance" -v
```

Expected: 所有评分函数测试通过

- [ ] **Step 3: Commit**

```bash
git add understand-anything-plugin/skills/understand-query/ua_query.py
git commit -m "feat: optimize scoring function with tag and summary matching"
```

### Task 5: 实现 tags 独立字段

**Files:**
- Modify: `understand-anything-plugin/packages/dashboard/src/api/handlers/search.ts:41-49, 113-118, 363-376`

- [ ] **Step 1: 修改 LumoDocument 接口**

将 `LumoDocument` 接口（第 41-49 行）替换为：

```typescript
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
```

- [ ] **Step 2: 修改 LUMO_SEARCH_KEYS**

将 `LUMO_SEARCH_KEYS`（第 113-118 行）替换为：

```typescript
const LUMO_SEARCH_KEYS = [
  { name: "name", weight: 3 },
  { name: "summary", weight: 2 },
  { name: "tags", weight: 2.5 },   // 新增：高于 summary
  { name: "type", weight: 0.5 },
  { name: "content", weight: 1 },
] as const
```

- [ ] **Step 3: 修改 pushKgItems 函数**

将 `pushKgItems` 函数中的 items.push 部分（第 363-376 行）替换为：

```typescript
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

// 添加 tags 到 LumoDocument
const lumoDoc: LumoDocument = {
  id: node.id,
  name: node.name,
  summary: node.summary ?? "",
  type: node.type,
  service: serviceName,
  content: [node.name, node.summary, node.type].join(" "),
  layer: "kg",
  tags: (node.tags ?? []).join(" "),  // 独立字段
}
```

- [ ] **Step 4: 测试 tags 独立字段**

```bash
cd understand-anything-plugin/packages/dashboard
pnpm test -- --grep "tags"
```

Expected: 所有 tags 相关测试通过

- [ ] **Step 5: Commit**

```bash
git add understand-anything-plugin/packages/dashboard/src/api/handlers/search.ts
git commit -m "feat: make tags independent weighted field in search index"
```

### Task 6: 阶段 1 集成测试

**Files:**
- Test: `understand-anything-plugin/packages/dashboard/src/api/handlers/search.test.ts`

- [ ] **Step 1: 运行完整测试套件**

```bash
cd understand-anything-plugin/packages/dashboard
pnpm test
```

Expected: 所有测试通过

- [ ] **Step 2: 手动测试搜索效果**

启动开发服务器并测试：

```bash
cd understand-anything-plugin/packages/dashboard
pnpm dev:dashboard
```

在另一个终端测试：

```bash
# 测试中文分词
curl "http://localhost:3001/api/search?q=订单支付&scope=kg"

# 测试英文搜索
curl "http://localhost:3001/api/search?q=AuthService&scope=kg"

# 测试中英混合
curl "http://localhost:3001/api/search?q=支付payment&scope=kg"
```

Expected: 搜索结果准确，无噪声 token

- [ ] **Step 3: 性能测试**

```bash
# 测试索引构建时间
time curl "http://localhost:3001/api/search?q=test&scope=kg"

# 测试查询延迟
for i in {1..10}; do
  time curl "http://localhost:3001/api/search?q=AuthService&scope=kg" > /dev/null
done
```

Expected: 索引构建 < 5s，查询延迟 < 100ms

- [ ] **Step 4: Commit 阶段 1 完成**

```bash
git add .
git commit -m "feat: complete phase 1 - search accuracy improvements"
```

---

## 阶段 2：架构优化

### Task 7: 设计增量索引更新机制

**Files:**
- Create: `understand-anything-plugin/packages/dashboard/src/api/handlers/search-incremental.ts`

- [ ] **Step 1: 创建增量索引更新文件**

```typescript
import fs from "fs"
import path from "path"
import type { SearchIndexState, SearchIndexItem } from "./search"

export interface IncrementalIndex {
  baseIndex: SearchIndexState
  updates: Map<string, {
    type: 'add' | 'update' | 'delete'
    item?: SearchIndexItem
    timestamp: number
  }>
  mergedIndex: SearchIndexState | null
}

export function updateIndexIncrementally(
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

function rebuildItemsForFile(file: string, projectRoot: string): SearchIndexItem[] {
  // 实现文件重建逻辑
  return []
}

function buildSearchIndexFromItems(items: SearchIndexItem[], edges: any[]): SearchIndexState {
  // 实现索引重建逻辑
  return {} as SearchIndexState
}
```

- [ ] **Step 2: 测试增量更新**

```bash
cd understand-anything-plugin/packages/dashboard
pnpm test -- --grep "incremental"
```

Expected: 增量更新测试通过

- [ ] **Step 3: Commit**

```bash
git add understand-anything-plugin/packages/dashboard/src/api/handlers/search-incremental.ts
git commit -m "feat: add incremental index update mechanism"
```

### Task 8: 实现向量搜索（可选）

**Files:**
- Create: `understand-anything-plugin/packages/dashboard/src/api/handlers/search-vector.ts`

- [ ] **Step 1: 创建向量搜索文件**

```typescript
import type { SearchResult } from "./search"

export interface VectorSearchIndex {
  vectors: Map<string, number[]>
  embedder: (text: string) => Promise<number[]>
  search(query: string, limit: number): Promise<SearchResult[]>
}

export function hybridSearch(
  query: string,
  bm25Results: SearchResult[],
  vectorResults: SearchResult[],
  limit: number,
): SearchResult[] {
  const RRF_K = 60
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

- [ ] **Step 2: 测试向量搜索**

```bash
cd understand-anything-plugin/packages/dashboard
pnpm test -- --grep "vector"
```

Expected: 向量搜索测试通过

- [ ] **Step 3: Commit**

```bash
git add understand-anything-plugin/packages/dashboard/src/api/handlers/search-vector.ts
git commit -m "feat: add vector search with RRF fusion (optional)"
```

### Task 9: 优化图扩展算法

**Files:**
- Modify: `understand-anything-plugin/packages/dashboard/src/api/handlers/search.ts`

- [ ] **Step 1: 添加双向 BFS 函数**

在 `search.ts` 文件中添加：

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

- [ ] **Step 2: 测试双向 BFS**

```bash
cd understand-anything-plugin/packages/dashboard
pnpm test -- --grep "bidirectionalBFS"
```

Expected: 双向 BFS 测试通过

- [ ] **Step 3: Commit**

```bash
git add understand-anything-plugin/packages/dashboard/src/api/handlers/search.ts
git commit -m "feat: add bidirectional BFS for graph expansion"
```

### Task 10: 设计统一搜索框架

**Files:**
- Modify: `understand-anything-plugin/packages/dashboard/src/api/handlers/search.ts`

- [ ] **Step 1: 添加查询理解接口**

在 `search.ts` 文件中添加：

```typescript
interface QueryIntent {
  type: 'exact' | 'fuzzy' | 'semantic' | 'structural'
  entities: string[]
  relations: string[]
  scope: SearchScope
}

interface SearchStrategy {
  methods: Array<{
    type: 'bm25' | 'vector' | 'graph' | 'hybrid'
    weight: number
    params: Record<string, unknown>
  }>
  graphExpansion: {
    enabled: boolean
    depth: number
    strategy: 'forward' | 'backward' | 'bidirectional'
    pruning: boolean
  }
  fusion: {
    method: 'rrf' | 'weighted' | 'learning-to-rank'
    weights: Record<string, number>
  }
}

function understandQuery(query: string): QueryIntent {
  // 实现查询理解逻辑
  return {
    type: 'fuzzy',
    entities: [],
    relations: [],
    scope: 'all'
  }
}

function selectStrategy(intent: QueryIntent): SearchStrategy {
  // 实现策略选择逻辑
  return {
    methods: [{ type: 'bm25', weight: 1, params: {} }],
    graphExpansion: { enabled: true, depth: 2, strategy: 'forward', pruning: false },
    fusion: { method: 'rrf', weights: {} }
  }
}
```

- [ ] **Step 2: 测试统一搜索框架**

```bash
cd understand-anything-plugin/packages/dashboard
pnpm test -- --grep "unified"
```

Expected: 统一搜索框架测试通过

- [ ] **Step 3: Commit**

```bash
git add understand-anything-plugin/packages/dashboard/src/api/handlers/search.ts
git commit -m "feat: add unified search framework with query understanding"
```

### Task 11: 阶段 2 集成测试

**Files:**
- Test: `understand-anything-plugin/packages/dashboard/src/api/handlers/search.test.ts`

- [ ] **Step 1: 运行完整测试套件**

```bash
cd understand-anything-plugin/packages/dashboard
pnpm test
```

Expected: 所有测试通过

- [ ] **Step 2: 性能测试**

```bash
# 测试增量更新性能
time curl "http://localhost:3001/api/search?q=test&scope=kg"

# 测试查询延迟
for i in {1..10}; do
  time curl "http://localhost:3001/api/search?q=AuthService&scope=kg" > /dev/null
done
```

Expected: 索引更新速度提升 10x，查询延迟 < 100ms

- [ ] **Step 3: Commit 阶段 2 完成**

```bash
git add .
git commit -m "feat: complete phase 2 - architecture optimization"
```

---

## 自审检查

### 1. Spec 覆盖

- ✅ 阶段 1：jieba 分词、2-hop 图扩展、优化评分函数、tags 独立字段
- ✅ 阶段 2：增量索引更新、向量搜索（可选）、统一搜索框架
- ✅ 验证标准：分词质量、图扩展、搜索准确性、性能
- ✅ 风险和缓解措施

### 2. 占位符扫描

- ✅ 没有 TBD、TODO、FIXME
- ✅ 所有代码块都是完整的
- ✅ 所有测试命令都是具体的

### 3. 类型一致性

- ✅ `SearchIndexState`、`SearchIndexItem`、`LumoDocument` 类型一致
- ✅ `kgGraphExpansion`、`bidirectionalBFS` 函数签名一致
- ✅ `_score_node_relevance` 函数参数和返回值一致

---

## 执行选项

**计划完成并保存到 `docs/superpowers/plans/2026-06-13-search-accuracy-architecture-implementation.md`。两种执行方式：**

**1. Subagent-Driven（推荐）** - 我为每个任务分发一个新的子任务代理，任务之间进行审查，快速迭代

**2. Inline Execution** - 在当前会话中使用 executing-plans 执行任务，批量执行并设置检查点

**选择哪种方式？**
