# Knowledge Content Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable full-text search of LLM wiki content, add content snippets to search results, provide `knowledge read` for batch reading, and add Dashboard preview for LLM wiki projects.

**Architecture:** Remove the 3000-char content truncation in the KG generation script so MiniSearch indexes full wiki text. Add `contentSnippet` to search results for preview. Add `knowledge read` CLI command that fetches node content from the KG API. Add `KnowledgeWikiView` component to Dashboard for browsing and rendering LLM wiki markdown files.

**Tech Stack:** Python (parse-knowledge-base.py), TypeScript/Node.js (dashboard API + React frontend), MiniSearch (inverted index), ReactMarkdown + remarkGfm (rendering)

---

## File Structure

### Phase A: Data + Query Layer

| File | Responsibility |
|------|---------------|
| `understand-anything-plugin/skills/understand-knowledge/parse-knowledge-base.py` | KG generation: remove content truncation, fix filePath prefix |
| `understand-anything-plugin/packages/dashboard/src/api/handlers/kg-index.ts` | Search index: add contentSnippet storeField |
| `understand-anything-plugin/packages/dashboard/src/api/handlers/graph.ts` | Graph API: support `?nodes=id1,id2` node filter |
| `understand-anything-plugin/skills/understand-query/_commands.py` | CLI: add `knowledge read` action |
| `understand-anything-plugin/skills/understand-query/ua_query.py` | CLI: register `read` subparser |
| `understand-anything-plugin/skills/understand-query/_utils.py` | CLI: format knowledge-read and search snippet output |
| `understand-anything-plugin/skills/understand-query/tests/test_knowledge_read.py` | Tests: knowledge read unit tests |
| `understand-anything-plugin/skills/understand-query/SKILL.md` | Docs: document knowledge read command |
| `understand-anything-plugin/agents/understand-query-worker.md` | Docs: add knowledge read to worker cheat-sheet |

### Phase B: Dashboard Preview

| File | Responsibility |
|------|---------------|
| `understand-anything-plugin/packages/dashboard/src/api/handlers/wiki.ts` | API: add `/api/wiki/knowledge-tree` endpoint |
| `understand-anything-plugin/packages/dashboard/src/components/KnowledgeWikiView.tsx` | New: file tree sidebar + markdown content viewer |
| `understand-anything-plugin/packages/dashboard/src/components/WikiView.tsx` | Modify: fallback to KnowledgeWikiView for LLM wiki projects |
| `understand-anything-plugin/packages/dashboard/src/store.ts` | State: knowledge wiki state (tree, active page, content) |

---

## Working Directory

All paths below are relative to the worktree root:
```
/Users/earthchen/.understand-anything/repo/.worktrees/understand-prd-system-query/understand-anything-plugin
```

Test KB path for E2E validation:
```
/Users/earthchen/ai-work/kb-test
```

---

## Task 1: Remove content truncation in parse-knowledge-base.py

**Files:**
- Modify: `skills/understand-knowledge/parse-knowledge-base.py:385`

- [ ] **Step 1: Locate and modify the truncation line**

In `skills/understand-knowledge/parse-knowledge-base.py`, line 385, change:

```python
"content": text[:3000],  # First 3000 chars for LLM analysis
```

to:

```python
"content": text,
```

- [ ] **Step 2: Verify no other truncation points exist**

Run: `rg "text\[:3000\]" skills/understand-knowledge/parse-knowledge-base.py`
Expected: No matches (the only occurrence has been removed)

- [ ] **Step 3: Commit**

```bash
git add skills/understand-knowledge/parse-knowledge-base.py
git commit -m "feat(knowledge): remove 3000-char content truncation for full-text search"
```

---

## Task 2: Fix filePath prefix for wiki nodes

**Files:**
- Modify: `skills/understand-knowledge/parse-knowledge-base.py:378`

The script generates `filePath` relative to the wiki root (e.g., `concepts/VIP.md`). The dashboard's `source` handler expects project-relative paths (e.g., `wiki/concepts/VIP.md`). Add `wiki/` prefix.

- [ ] **Step 1: Locate the filePath assignment for article nodes**

In `skills/understand-knowledge/parse-knowledge-base.py`, find the line (around line 378):

```python
"filePath": str(rel),
```

Change to:

```python
"filePath": f"wiki/{rel}",
```

- [ ] **Step 2: Check if other node types (requirement, testcase, entity) also need the prefix**

Search for all `"filePath":` assignments in the file. For each one:
- If the path is relative to wiki root (concepts/, summaries/, testcases/, entities/) → add `wiki/` prefix
- If the path is already project-relative (raw/...) → leave unchanged

Run: `rg '"filePath":' skills/understand-knowledge/parse-knowledge-base.py`

Apply the `wiki/` prefix to ALL wiki-relative paths.

- [ ] **Step 3: Verify source node filePaths are unchanged**

Source nodes use paths like `raw/prd/VIP/...`. Confirm these are NOT modified.

- [ ] **Step 4: Commit**

```bash
git add skills/understand-knowledge/parse-knowledge-base.py
git commit -m "fix(knowledge): add wiki/ prefix to filePath for correct source resolution"
```

---

## Task 3: Add contentSnippet to KgIndex

**Files:**
- Modify: `packages/dashboard/src/api/handlers/kg-index.ts`
- Test: `packages/dashboard/src/api/handlers/__tests__/kg-index-snippet.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/dashboard/src/api/handlers/__tests__/kg-index-snippet.test.ts`:

```typescript
import { describe, it, expect } from "vitest"

// Use the same interface/class imports as existing kg-index tests
import { KgIndex } from "../kg-index"
import type { KnowledgeGraph } from "@understand-anything/core"

function makeGraph(nodes: KnowledgeGraph["nodes"]): KnowledgeGraph {
  return { nodes, edges: [], layers: [] } as unknown as KnowledgeGraph
}

describe("KgIndex contentSnippet", () => {
  it("includes contentSnippet in search results", () => {
    const graph = makeGraph([
      {
        id: "article:VIP",
        name: "VIP",
        type: "article",
        filePath: "wiki/concepts/VIP.md",
        summary: "VIP business domain",
        tags: ["prd-domain"],
        knowledgeMeta: {
          content: "---\ntitle: VIP\ntype: concept\n---\n\n# VIP\n\nVIP is a business domain covering 5 PRD documents.",
        },
      },
    ] as KnowledgeGraph["nodes"])

    const index = KgIndex.create(graph, "amar-prd")
    const result = index.search({ q: "VIP" })
    expect(result.results).toHaveLength(1)
    expect(result.results[0].contentSnippet).toBeDefined()
    expect(result.results[0].contentSnippet).not.toContain("---\ntitle:")
    expect(result.results[0].contentSnippet).toContain("VIP")
  })

  it("skips YAML front matter in contentSnippet", () => {
    const frontMatter = "---\ntitle: Test\ntype: concept\ntags: [a, b]\n---\n\n"
    const body = "# Test Concept\n\nThis is the actual content that should appear in the snippet."
    const graph = makeGraph([
      {
        id: "article:test",
        name: "Test",
        type: "article",
        filePath: "wiki/concepts/test.md",
        summary: "Test concept",
        tags: [],
        knowledgeMeta: { content: frontMatter + body },
      },
    ] as KnowledgeGraph["nodes"])

    const index = KgIndex.create(graph, "test-svc")
    const result = index.search({ q: "Test" })
    expect(result.results[0].contentSnippet).toStartWith("# Test Concept")
  })

  it("truncates contentSnippet to 500 chars", () => {
    const longContent = "# Title\n\n" + "A".repeat(1000)
    const graph = makeGraph([
      {
        id: "article:long",
        name: "Long",
        type: "article",
        filePath: "wiki/concepts/long.md",
        summary: "Long article",
        tags: [],
        knowledgeMeta: { content: longContent },
      },
    ] as KnowledgeGraph["nodes"])

    const index = KgIndex.create(graph, "test-svc")
    const result = index.search({ q: "Long" })
    expect(result.results[0].contentSnippet!.length).toBeLessThanOrEqual(500)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/dashboard && npx vitest run src/api/handlers/__tests__/kg-index-snippet.test.ts`
Expected: FAIL — `contentSnippet` is undefined in results

- [ ] **Step 3: Implement contentSnippet in KgIndex**

In `packages/dashboard/src/api/handlers/kg-index.ts`:

1. Add `contentSnippet` to `KgDoc` interface:

```typescript
interface KgDoc {
  // ...existing fields...
  contentSnippet: string
}
```

2. Add `contentSnippet` to `KgSearchResult` interface:

```typescript
export interface KgSearchResult {
  // ...existing fields...
  contentSnippet?: string
}
```

3. Add `"contentSnippet"` to `MINI_SEARCH_OPTIONS.storeFields` array.

4. Add helper function to skip front matter:

```typescript
function stripFrontMatter(text: string): string {
  const match = text.match(/^---[\s\S]*?---\s*/)
  return match ? text.slice(match[0].length) : text
}
```

5. In `buildDocs`, compute contentSnippet:

```typescript
const rawContent = metaString("content")
const contentSnippet = stripFrontMatter(rawContent).slice(0, 500)
```

Add `contentSnippet` to the returned doc object.

6. In `search()` result mapping, add:

```typescript
contentSnippet: r.contentSnippet as string | undefined,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/dashboard && npx vitest run src/api/handlers/__tests__/kg-index-snippet.test.ts`
Expected: PASS (all 3 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/dashboard/src/api/handlers/kg-index.ts packages/dashboard/src/api/handlers/__tests__/kg-index-snippet.test.ts
git commit -m "feat(dashboard): add contentSnippet to KG search results"
```

---

## Task 4: Add node filter to Graph API

**Files:**
- Modify: `packages/dashboard/src/api/handlers/graph.ts:39-75`

- [ ] **Step 1: Modify handleGraphRequest to support `?nodes=` parameter**

In `packages/dashboard/src/api/handlers/graph.ts`, after the line that reads the KG JSON (around line 70), add node filtering:

```typescript
// Inside the /api/graph handler, after reading the file:
// line ~70: return { statusCode: 200, body: JSON.parse(fs.readFileSync(candidate, "utf-8")) }

// Replace that return with:
const raw = JSON.parse(fs.readFileSync(candidate, "utf-8")) as Record<string, unknown>
const nodesParam = searchParams.get("nodes")
if (nodesParam && Array.isArray(raw.nodes)) {
  const requestedIds = new Set(nodesParam.split(",").map(id => id.trim()).filter(Boolean))
  raw.nodes = (raw.nodes as Array<Record<string, unknown>>).filter(
    (n) => requestedIds.has(n.id as string)
  )
  raw.edges = [] // Don't return edges for filtered queries
}
return { statusCode: 200, body: raw }
```

- [ ] **Step 2: Verify with curl**

Start the dev server and test:
```bash
curl "http://localhost:3001/api/graph?service=amar-prd&file=knowledge-graph.json&nodes=article:VIP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d.get('nodes',[])), 'nodes')"
```
Expected: `1 nodes`

- [ ] **Step 3: Commit**

```bash
git add packages/dashboard/src/api/handlers/graph.ts
git commit -m "feat(dashboard): support ?nodes= filter in /api/graph endpoint"
```

---

## Task 5: Add `knowledge read` CLI command

**Files:**
- Modify: `skills/understand-query/_commands.py:171-234`
- Modify: `skills/understand-query/ua_query.py:58-81`
- Test: `skills/understand-query/tests/test_knowledge_read.py`

- [ ] **Step 1: Write the failing test**

Create `skills/understand-query/tests/test_knowledge_read.py`:

```python
"""Tests for knowledge read subcommand."""
from __future__ import annotations
import argparse
from unittest.mock import patch
from _commands import cmd_knowledge


def _make_args(**overrides):
    defaults = {
        "server": "http://localhost:3001",
        "service": None,
        "knowledge_action": "read",
        "node": "article:VIP",
    }
    defaults.update(overrides)
    return argparse.Namespace(**defaults)


@patch("_helpers._resolve_knowledge_service", return_value="amar-prd")
@patch("_helpers.fetch_json")
def test_knowledge_read_single_node(mock_fetch, mock_resolve):
    mock_fetch.return_value = {
        "nodes": [
            {
                "id": "article:VIP",
                "name": "VIP",
                "type": "article",
                "knowledgeMeta": {
                    "content": "# VIP\n\nVIP is a business domain.",
                    "sourcePath": "raw/prd/VIP/2025-01.md",
                },
            }
        ]
    }
    result = cmd_knowledge(_make_args())
    assert result["kind"] == "knowledge-read"
    assert result["total"] == 1
    assert result["nodes"][0]["id"] == "article:VIP"


@patch("_helpers._resolve_knowledge_service", return_value="amar-prd")
@patch("_helpers.fetch_json")
def test_knowledge_read_multiple_nodes(mock_fetch, mock_resolve):
    mock_fetch.return_value = {
        "nodes": [
            {"id": "article:VIP", "name": "VIP", "type": "article", "knowledgeMeta": {"content": "VIP content"}},
            {"id": "article:Game", "name": "Game", "type": "article", "knowledgeMeta": {"content": "Game content"}},
        ]
    }
    result = cmd_knowledge(_make_args(node="article:VIP,article:Game"))
    assert result["kind"] == "knowledge-read"
    assert result["total"] == 2


@patch("_helpers._resolve_knowledge_service", return_value="amar-prd")
@patch("_helpers.fetch_json")
def test_knowledge_read_caps_at_10(mock_fetch, mock_resolve):
    ids = ",".join(f"article:n{i}" for i in range(15))
    mock_fetch.return_value = {"nodes": []}
    cmd_knowledge(_make_args(node=ids))
    call_args = mock_fetch.call_args
    nodes_param = call_args[0][2]["nodes"]
    assert len(nodes_param.split(",")) <= 10
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd skills/understand-query && uv run --with pytest pytest tests/test_knowledge_read.py -v`
Expected: FAIL — `knowledge read` action not handled

- [ ] **Step 3: Implement knowledge read in _commands.py**

In `skills/understand-query/_commands.py`, inside `cmd_knowledge()`, after the `if action == "coverage":` block (around line 232), add:

```python
    if action == "read":
        node_ids = [n.strip() for n in args.node.split(",") if n.strip()]
        node_ids = node_ids[:10]  # Cap at 10 nodes
        data = _helpers.fetch_json(args.server, "/api/graph", {
            "service": service,
            "file": "knowledge-graph.json",
            "nodes": ",".join(node_ids),
        })
        nodes = data.get("nodes", [])
        return {
            "kind": "knowledge-read",
            "service": service,
            "nodes": nodes,
            "total": len(nodes),
        }
```

- [ ] **Step 4: Register `read` subparser in ua_query.py**

In `skills/understand-query/ua_query.py`, after the `knowledge_coverage` block (around line 81), add:

```python
    knowledge_read = knowledge_sub.add_parser("read", help="Read full content of knowledge nodes")
    knowledge_read.add_argument("--node", required=True, help="Node ID(s), comma-separated")
    knowledge_read.add_argument("--service")
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd skills/understand-query && uv run --with pytest pytest tests/test_knowledge_read.py -v`
Expected: PASS (all 3 tests)

- [ ] **Step 6: Commit**

```bash
git add skills/understand-query/_commands.py skills/understand-query/ua_query.py skills/understand-query/tests/test_knowledge_read.py
git commit -m "feat(query): add knowledge read subcommand for batch node content reading"
```

---

## Task 6: Format knowledge-read and search snippet output

**Files:**
- Modify: `skills/understand-query/_utils.py`
- Test: `skills/understand-query/tests/test_knowledge_read_format.py`

- [ ] **Step 1: Write the failing test for knowledge-read formatting**

Create `skills/understand-query/tests/test_knowledge_read_format.py`:

```python
"""Tests for knowledge-read and knowledge-search markdown formatting."""
from _utils import _format_markdown


def test_knowledge_read_format():
    data = {
        "kind": "knowledge-read",
        "service": "amar-prd",
        "total": 1,
        "nodes": [
            {
                "id": "article:VIP",
                "name": "VIP",
                "type": "article",
                "knowledgeMeta": {
                    "content": "# VIP\n\nVIP is a business domain.",
                    "sourcePath": "raw/prd/VIP/2025-01.md",
                },
            }
        ],
    }
    md = _format_markdown(data)
    assert "### VIP" in md
    assert "raw/prd/VIP/2025-01.md" in md
    assert "# VIP" in md
    assert "VIP is a business domain" in md


def test_knowledge_search_with_snippet():
    data = {
        "kind": "knowledge-search",
        "service": "amar-prd",
        "query": "VIP",
        "results": [
            {
                "id": "article:VIP",
                "name": "VIP",
                "type": "article",
                "summary": "VIP business domain",
                "score": 5.0,
                "contentSnippet": "# VIP\n\nVIP is a domain covering 5 PRD documents.",
            }
        ],
    }
    md = _format_markdown(data)
    assert "VIP" in md
    assert "VIP is a domain" in md
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd skills/understand-query && uv run --with pytest pytest tests/test_knowledge_read_format.py -v`
Expected: FAIL — `knowledge-read` kind not handled

- [ ] **Step 3: Implement formatting in _utils.py**

In `skills/understand-query/_utils.py`, inside `_format_markdown()`, add handler for `knowledge-read`:

```python
    if kind == "knowledge-read":
        nodes = data.get("nodes", [])
        lines.append(f"# Knowledge Read ({len(nodes)} nodes)")
        lines.append("")
        for node in nodes:
            meta = node.get("knowledgeMeta", {})
            content = meta.get("content", "")
            source_path = meta.get("sourcePath", "")
            lines.append(f"### {node.get('name', node.get('id', '?'))}")
            if source_path:
                lines.append(f"**Raw source**: `{source_path}`")
                lines.append("")
            if content:
                lines.append(content)
            lines.append("")
        return "\n".join(lines)
```

Also, update the `knowledge-search` handler to show `contentSnippet`:

```python
    if kind == "knowledge-search":
        results = data.get("results", [])
        lines.append(f"# Knowledge Search: \"{data.get('query', '')}\" ({len(results)} results)")
        lines.append("")
        for r in results:
            rtype = _short_type_name(r.get("type", "?"))
            lines.append(f"- [{rtype}] **{r.get('name', r.get('id', '?'))}**")
            if r.get("summary"):
                lines.append(f"  {r['summary'][:150]}")
            snippet = r.get("contentSnippet", "")
            if snippet:
                first_line = snippet.split("\n")[0][:120]
                lines.append(f"  > {first_line}")
        lines.append("")
        return "\n".join(lines)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd skills/understand-query && uv run --with pytest pytest tests/test_knowledge_read_format.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add skills/understand-query/_utils.py skills/understand-query/tests/test_knowledge_read_format.py
git commit -m "feat(query): format knowledge-read and search snippet markdown output"
```

---

## Task 7: Update worker agent and SKILL.md documentation

**Files:**
- Modify: `agents/understand-query-worker.md`
- Modify: `skills/understand-query/SKILL.md`
- Modify: `skills/understand-query/docs/reference.md`

- [ ] **Step 1: Add knowledge read to worker agent cheat-sheet**

In `agents/understand-query-worker.md`, find the knowledge command section and add:

```markdown
knowledge read --node <id1>,<id2>,...   # Read full wiki content for 1-10 nodes
```

Add to the "Query Workflow" section:
```markdown
- After identifying relevant nodes via `knowledge search`, use `knowledge read --node <id>` to retrieve full wiki content
- Wiki content includes `sourcePath` pointing to raw documents; use `source --file <sourcePath>` for raw PRD details
```

- [ ] **Step 2: Add knowledge read to SKILL.md**

In `skills/understand-query/SKILL.md`, add a `knowledge read` section with example:

```markdown
### `knowledge read` — Read full wiki content

```bash
python3 ua_query.py knowledge read --server :3001 --node "article:VIP,req:VIP-2025-01-v2.4.0-VIP2.0体系"
```

Returns full wiki markdown content for specified nodes (max 10). Each result includes `sourcePath` for accessing the original raw document.
```

- [ ] **Step 3: Add to docs/reference.md**

Add `knowledge read` entry with parameters and output format.

- [ ] **Step 4: Commit**

```bash
git add agents/understand-query-worker.md skills/understand-query/SKILL.md skills/understand-query/docs/reference.md
git commit -m "docs(query): document knowledge read command in worker agent and SKILL.md"
```

---

## Task 8: Dashboard API — Knowledge tree endpoint

**Files:**
- Modify: `packages/dashboard/src/api/handlers/wiki.ts`

- [ ] **Step 1: Add `/api/wiki/knowledge-tree` handler**

In `packages/dashboard/src/api/handlers/wiki.ts`, before the `return null` at the end of `handleWikiRequest`, add a new route:

```typescript
  if (pathname === "/api/wiki/knowledge-tree") {
    const serviceName = searchParams.get("service")
    if (!serviceName) {
      return { statusCode: 400, body: { error: "service parameter required" } }
    }

    // Read the KG for this service
    const graphDir = process.env.GRAPH_DIR
    const resolvedBasePath = resolveServiceBasePath(serviceName)
    const candidates: string[] = []
    if (resolvedBasePath) {
      if (graphDir) candidates.push(path.resolve(graphDir, resolvedBasePath, ".understand-anything", "knowledge-graph.json"))
      candidates.push(path.resolve(process.cwd(), resolvedBasePath, ".understand-anything", "knowledge-graph.json"))
    }
    if (!serviceName.includes("/")) {
      if (graphDir) candidates.push(path.resolve(graphDir, serviceName, ".understand-anything", "knowledge-graph.json"))
      candidates.push(path.resolve(process.cwd(), serviceName, ".understand-anything", "knowledge-graph.json"))
    }

    for (const candidate of candidates) {
      if (!fs.existsSync(candidate)) continue
      try {
        const kg = JSON.parse(fs.readFileSync(candidate, "utf-8"))
        const nodes = (kg.nodes ?? []) as Array<Record<string, unknown>>
        const knowledgeTypes = new Set(["article", "requirement", "testcase", "entity", "topic"])
        const knowledgeNodes = nodes.filter((n) => knowledgeTypes.has(n.type as string))

        // Group by category (first path segment of filePath)
        const groups: Record<string, Array<{ id: string; name: string; type: string; filePath: string }>> = {}
        for (const n of knowledgeNodes) {
          const fp = (n.filePath as string) ?? ""
          // Extract category: "wiki/concepts/VIP.md" → "concepts"
          const parts = fp.replace(/^wiki\//, "").split("/")
          const category = parts.length > 1 ? parts[0] : "other"
          groups[category] ??= []
          groups[category].push({
            id: n.id as string,
            name: (n.name as string) ?? "",
            type: (n.type as string) ?? "",
            filePath: fp,
          })
        }

        const tree = Object.entries(groups)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([category, items]) => ({
            category,
            items: items.sort((a, b) => a.name.localeCompare(b.name)),
          }))

        return { statusCode: 200, body: { service: serviceName, tree, totalNodes: knowledgeNodes.length } }
      } catch {
        return { statusCode: 500, body: { error: "Failed to read knowledge graph" } }
      }
    }
    return { statusCode: 404, body: { error: `Knowledge graph not found for service ${serviceName}` } }
  }
```

Add required imports at top of file:
```typescript
import { resolveServiceBasePath } from "../service-resolver"
```

- [ ] **Step 2: Test with curl**

```bash
curl "http://localhost:3001/api/wiki/knowledge-tree?service=amar-prd" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('totalNodes'), 'nodes in', len(d.get('tree',[])), 'categories')"
```
Expected: `418 nodes in 4 categories`

- [ ] **Step 3: Commit**

```bash
git add packages/dashboard/src/api/handlers/wiki.ts
git commit -m "feat(dashboard): add /api/wiki/knowledge-tree endpoint for LLM wiki navigation"
```

---

## Task 9: Dashboard — KnowledgeWikiView component (B-v1)

**Files:**
- Create: `packages/dashboard/src/components/KnowledgeWikiView.tsx`
- Modify: `packages/dashboard/src/store.ts`
- Modify: `packages/dashboard/src/components/WikiView.tsx`

This is a larger task. The v1 scope is: **file tree sidebar + markdown preview**. Link navigation and search integration are B-v2 (follow-up).

- [ ] **Step 1: Add knowledge wiki state to store**

In `packages/dashboard/src/store.ts`, add state fields and actions:

```typescript
// In the store interface, add:
knowledgeTree: Array<{ category: string; items: Array<{ id: string; name: string; type: string; filePath: string }> }> | null
knowledgeActivePage: { id: string; filePath: string; service: string } | null
knowledgePageContent: string | null
knowledgeLoading: boolean
setKnowledgeTree: (tree: typeof state.knowledgeTree) => void
setKnowledgeActivePage: (page: typeof state.knowledgeActivePage) => void
setKnowledgePageContent: (content: string | null) => void
setKnowledgeLoading: (loading: boolean) => void
```

And in the store creation, add defaults and setters.

- [ ] **Step 2: Create KnowledgeWikiView component**

Create `packages/dashboard/src/components/KnowledgeWikiView.tsx`:

The component has:
1. Left sidebar: collapsible category groups, each listing wiki files
2. Main area: renders markdown content from `/api/source`
3. Uses existing `ReactMarkdown` + `remarkGfm` + `rehypeRaw` + `MermaidDiagram`

Key implementation details:
- On mount, fetch `/api/wiki/knowledge-tree?service=<service>` to populate sidebar
- On file click, fetch `/api/source?service=<service>&file=<filePath>` to get markdown
- Render markdown with `ReactMarkdown`, handling relative links as navigation targets
- Intercept `.md` link clicks: resolve relative path, find matching node, navigate to it

- [ ] **Step 3: Integrate into WikiView fallback**

In `packages/dashboard/src/components/WikiView.tsx`, at the top of the `WikiView` component, add fallback logic:

```typescript
// If no traditional wiki index exists, check for knowledge nodes
const knowledgeTree = useDashboardStore((s) => s.knowledgeTree);
const services = useDashboardStore((s) => s.services); // or get from API

// If wiki has no entries but knowledge tree has nodes, show KnowledgeWikiView
if (!wikiIndex?.entries?.length && knowledgeTree?.length) {
  return <KnowledgeWikiView />;
}
```

- [ ] **Step 4: Test manually in browser**

1. Start dashboard: `cd packages/dashboard && GRAPH_DIR=/Users/earthchen/ai-work/kb-test npx tsx ../../server.ts`
2. Open dashboard in browser
3. Switch to "Wiki" view
4. Verify: file tree shows amar-prd categories (concepts, summaries, testcases, entities)
5. Click a node → markdown renders correctly
6. Verify: Mermaid diagrams render

- [ ] **Step 5: Commit**

```bash
git add packages/dashboard/src/components/KnowledgeWikiView.tsx packages/dashboard/src/store.ts packages/dashboard/src/components/WikiView.tsx
git commit -m "feat(dashboard): add KnowledgeWikiView for LLM wiki markdown preview"
```

---

## Task 10: Regenerate KG and E2E validation

**Files:**
- No code changes — validation only

- [ ] **Step 1: Regenerate amar-prd KG with updated script**

```bash
cd /Users/earthchen/ai-work/kb-test/amar-prd
python3 /Users/earthchen/.understand-anything/repo/.worktrees/understand-prd-system-query/understand-anything-plugin/skills/understand-knowledge/parse-knowledge-base.py wiki/
```

Verify the new KG has:
- No content truncation: `python3 -c "import json; kg=json.load(open('.understand-anything/knowledge-graph.json')); print(max(len(n.get('knowledgeMeta',{}).get('content','')) for n in kg['nodes'] if n.get('knowledgeMeta',{}).get('content')))"` should be > 3000
- wiki/ prefix in filePaths: `python3 -c "import json; kg=json.load(open('.understand-anything/knowledge-graph.json')); print([n['filePath'] for n in kg['nodes'] if n.get('type')=='article'][:3])"` should show `wiki/concepts/...`

- [ ] **Step 2: Start server and run E2E tests**

```bash
cd /Users/earthchen/.understand-anything/repo/.worktrees/understand-prd-system-query/understand-anything-plugin
GRAPH_DIR=/Users/earthchen/ai-work/kb-test PORT=3002 npx tsx packages/dashboard/server.ts &

# Wait for server
sleep 3

# Test knowledge search returns contentSnippet
python3 skills/understand-query/ua_query.py knowledge search --server http://localhost:3002 "VIP" --format json | python3 -c "import sys,json; d=json.load(sys.stdin); r=d['results'][0]; print('snippet:', bool(r.get('contentSnippet')))"

# Test knowledge read
python3 skills/understand-query/ua_query.py knowledge read --server http://localhost:3002 --node "article:VIP" --format json | python3 -c "import sys,json; d=json.load(sys.stdin); print('nodes:', d['total'], 'content_len:', len(d['nodes'][0].get('knowledgeMeta',{}).get('content','')))"

# Test source --file with wiki/ prefix
python3 skills/understand-query/ua_query.py source --server http://localhost:3002 --service amar-prd --file "wiki/concepts/VIP.md" --format json | python3 -c "import sys,json; d=json.load(sys.stdin); print('file:', d.get('file','?'), 'lines:', d.get('totalLines',0))"
```

- [ ] **Step 3: Commit (if any test fixes needed)**

```bash
git add -A
git commit -m "test: E2E validation of knowledge content optimization"
```

---

## Self-Review Checklist

1. **Spec coverage**: All 9 items from the proposal (A1-A7, B1-B5) are covered by Tasks 1-9.
2. **Placeholder scan**: No TBDs, all steps have concrete code/commands.
3. **Type consistency**: `contentSnippet` used consistently in KgDoc → KgSearchResult → CLI formatting. `knowledge-read` kind used consistently in _commands.py → _utils.py.
4. **Front-matter skip**: Implemented in Task 3 via `stripFrontMatter()` helper.
5. **Node limit**: Implemented in Task 5 as `node_ids[:10]`.
6. **Worker agent**: Updated in Task 7.
