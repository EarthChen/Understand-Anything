# Proposal: Knowledge Content Optimization + Dashboard Preview (P2)

**Created**: 2026-06-25  
**Branch**: `feat/understand-prd-system-query`  
**Status**: `[AwaitingApproval]`

## Background

The `understand-knowledge` skill generates a Knowledge Graph (KG) from LLM wiki projects (e.g., `amar-prd`). Current limitations:

1. `knowledgeMeta.content` is truncated to 3000 chars, causing search misses.
2. KG search results lack content preview — only `summary` (~100-200 chars) returned.
3. `filePath` uses wiki-relative paths (e.g., `concepts/VIP.md`), but `source` command expects project-relative paths (e.g., `wiki/concepts/VIP.md`).
4. No `knowledge read` subcommand for batch-reading node content.
5. Dashboard cannot preview LLM wiki markdown files — WikiView requires `wiki/index.json` which LLM wiki projects don't have.

### Key Insight

LLM wiki files are **already structured markdown with internal links** — they can be directly rendered without JSON conversion. The KG serves as the navigation index, wiki files serve as content.

## Goals

1. **Full-text search** — Remove 3000-char truncation. KG JSON +425 KB only.
2. **Content snippets** — Search results include `contentSnippet` (first 500 chars).
3. **Batch reading** — `knowledge read --node id1,id2,...` reads content from KG.
4. **Fix filePath** — Wiki node paths resolve correctly for file access.
5. **Dashboard preview** — LLM wiki markdown files browsable and renderable in Dashboard.

---

## Design

### Phase A: Data + Query Layer

#### A1. `parse-knowledge-base.py` — Remove truncation

```python
# Line 385 — Before:
"content": text[:3000],

# After:
"content": text,
```

Impact: KG JSON 2.6 MB → ~3.0 MB (+425 KB). Only wiki files, not raw files.

#### A2. `parse-knowledge-base.py` — Fix filePath prefix

```python
# Before:
"filePath": str(rel),          # "concepts/VIP.md"

# After:
"filePath": f"wiki/{rel}",    # "wiki/concepts/VIP.md"
```

This ensures `source --file wiki/concepts/VIP.md` resolves correctly.

Note: `source` nodes already use `raw/...` paths which are project-relative. Only wiki nodes need the prefix.

#### A3. `kg-index.ts` — Add contentSnippet

```typescript
// KgDoc — new field
contentSnippet: string   // content.slice(0, 500)

// MINI_SEARCH_OPTIONS.storeFields — add
storeFields: [...existing, "contentSnippet"]

// buildDocs — compute
const contentSnippet = metaString("content").slice(0, 500)

// KgSearchResult — new field
contentSnippet?: string

// search() — map
contentSnippet: r.contentSnippet as string | undefined,
```

#### A4. Graph handler — Support `?nodes=id1,id2` query

Modify `/api/graph` handler to filter nodes by ID when `nodes` parameter is present.

```
GET /api/graph?service=amar-prd&file=knowledge-graph.json&nodes=id1,id2
→ Returns only matching nodes with full knowledgeMeta.content
```

#### A5. CLI `_commands.py` — `knowledge read` subcommand

```python
if action == "read":
    node_ids = [n.strip() for n in args.node.split(",") if n.strip()]
    data = _helpers.fetch_json(args.server, "/api/graph", {
        "service": service,
        "file": "knowledge-graph.json",
        "nodes": ",".join(node_ids),
    })
    return {"kind": "knowledge-read", "service": service,
            "nodes": data.get("nodes", []), "total": len(data.get("nodes", []))}
```

#### A6. CLI `ua_query.py` — Register `read` subparser

Add `knowledge read` with `--node` argument (comma-separated IDs).

#### A7. CLI `_utils.py` — Format output

- `knowledge-search`: Show `contentSnippet` per result.
- `knowledge-read`: Render full content per node with `sourcePath` link.

---

### Phase B: Dashboard Knowledge Wiki Preview

#### B1. API — Knowledge tree endpoint

New endpoint or parameter: `/api/wiki/knowledge-tree?service=<name>`

Builds a tree from KG nodes:

```json
{
  "service": "amar-prd",
  "tree": [
    {
      "category": "concepts",
      "items": [
        {"id": "article:VIP", "name": "VIP", "type": "article", "filePath": "wiki/concepts/VIP.md"}
      ]
    },
    {
      "category": "summaries",
      "items": [
        {"id": "req:VIP-2025-01-...", "name": "VIP2.0体系", "type": "requirement", "filePath": "wiki/summaries/VIP-...md"}
      ]
    },
    {
      "category": "testcases",
      "items": [...]
    }
  ]
}
```

Implementation: Read KG, group nodes by `filePath` prefix (`wiki/concepts/`, `wiki/summaries/`, etc.), return as tree.

#### B2. API — Markdown content endpoint

Reuse existing `/api/source?service=amar-prd&file=wiki/concepts/VIP.md` (after A2 filePath fix).

Returns raw file content. No JSON conversion needed.

#### B3. Dashboard — Detect LLM wiki projects

In `WikiView`, detect when a service has a KG with `knowledgeMeta` nodes but no `wiki/index.json`:

```typescript
// Fallback: if no wiki index but has KG knowledge nodes → show KnowledgeWikiView
if (!wikiIndex?.entries?.length && hasKnowledgeNodes) {
  return <KnowledgeWikiView service={serviceName} />;
}
```

#### B4. Dashboard — `KnowledgeWikiView` component

New component with:

1. **Sidebar**: File tree from B1 API, grouped by category (concepts/summaries/testcases).
2. **Content area**: Renders markdown from B2 API using existing `ReactMarkdown` + `remarkGfm` + `MermaidDiagram`.
3. **Link navigation**: Intercept relative markdown links (e.g., `[VIP](../concepts/VIP.md)`) and navigate within the view.
4. **Search**: Reuse KgIndex search with `contentSnippet` display.

Key reusable components:
- `ReactMarkdown` + `remarkGfm` + `rehypeRaw` (from WikiView)
- `MermaidDiagram` (from WikiView)
- `WikiSourcePanel` (from WikiView, for viewing raw source files)

#### B5. Dashboard — Source link support

When markdown contains links to raw files (e.g., `../../raw/prd/VIP/...md`), clicking opens `WikiSourcePanel` to show the raw file content via `/api/source`.

---

## Workflow Examples

### CLI: Search → Read → Source

```bash
# 1. Search wiki content
python3 ua_query.py knowledge search --server :3001 "VIP金币奖励"
# → Returns results with 500-char snippets

# 2. Read full wiki article
python3 ua_query.py knowledge read --server :3001 --node "req:VIP-2025-07-...,req:VIP-2025-08-..."
# → Returns full wiki content for both nodes + raw source paths

# 3. Read raw PRD for full details
python3 ua_query.py source --server :3001 --service amar-prd \
  --file "raw/prd/VIP/2025-07-v2.8.0-VIP奖励金币相关权益优化.md"
```

### Dashboard: Browse → Read → Navigate

```
1. Switch to "Wiki" view → detects LLM wiki → shows KnowledgeWikiView
2. Sidebar tree: concepts/ summaries/ testcases/
3. Click "VIP" → renders VIP.md with links and Mermaid diagrams
4. Click "[2025-07 · VIP奖励金币...](../summaries/VIP-2025-07-...md)" → navigates to summary page
5. Click "[raw/prd/VIP/2025-07-...md](...)" → opens source panel with raw PRD
```

---

## Test Plan

### Phase A Tests

- [ ] `parse-knowledge-base.py`: content field stores full text (no truncation)
- [ ] `parse-knowledge-base.py`: filePath has `wiki/` prefix for wiki nodes
- [ ] `parse-knowledge-base.py`: filePath unchanged for `source`/`raw/` nodes
- [ ] `kg-index.ts`: search results include `contentSnippet` field
- [ ] `_commands.py`: `knowledge read` returns node content via API
- [ ] `_commands.py`: `knowledge read` supports comma-separated IDs
- [ ] `_utils.py`: `knowledge-search` markdown includes snippet
- [ ] `_utils.py`: `knowledge-read` markdown renders content + source path
- [ ] E2E: `knowledge search "VIP"` returns results with `contentSnippet`
- [ ] E2E: `knowledge read --node <id>` returns full wiki content
- [ ] E2E: `source --file wiki/concepts/VIP.md` resolves correctly

### Phase B Tests

- [ ] API: `/api/wiki/knowledge-tree?service=amar-prd` returns tree structure
- [ ] API: `/api/source?service=amar-prd&file=wiki/concepts/VIP.md` returns markdown
- [ ] Dashboard: LLM wiki project shows `KnowledgeWikiView`
- [ ] Dashboard: file tree renders grouped by category
- [ ] Dashboard: markdown renders with Mermaid and GFM tables
- [ ] Dashboard: relative links navigate between wiki pages
- [ ] Dashboard: raw source links open source panel

---

## Files Modified

### Phase A

| File | Change |
|------|--------|
| `skills/understand-knowledge/parse-knowledge-base.py` | Remove `[:3000]` truncation; add `wiki/` prefix to filePath |
| `packages/dashboard/src/api/handlers/kg-index.ts` | Add `contentSnippet` to KgDoc/storeFields/results |
| `packages/dashboard/src/api/handlers/graph.ts` | Support `?nodes=id1,id2` query |
| `skills/understand-query/_commands.py` | Add `knowledge read` action |
| `skills/understand-query/_utils.py` | Format `knowledge-read` and snippet in `knowledge-search` |
| `skills/understand-query/ua_query.py` | Register `read` subparser |
| `skills/understand-query/SKILL.md` | Document `knowledge read` command |
| `skills/understand-query/docs/reference.md` | Document `knowledge read` command |
| `agents/understand-query-worker.md` | Add `knowledge read` to cheat-sheet |

### Phase B

| File | Change |
|------|--------|
| `packages/dashboard/src/api/handlers/wiki.ts` | Add `/api/wiki/knowledge-tree` endpoint |
| `packages/dashboard/src/components/KnowledgeWikiView.tsx` | New: file tree + markdown browser |
| `packages/dashboard/src/components/WikiView.tsx` | Fallback to KnowledgeWikiView for LLM wiki |
| `packages/dashboard/src/store.ts` | Add knowledge wiki state (activeKnowledgePage, tree, etc.) |

---

## Review Findings (Sequential Thinking)

### Additions Required

1. **Worker agent update** — `agents/understand-query-worker.md` must include `knowledge read` in its cheat-sheet. Added to Phase A files.

2. **Migration step** — After modifying `parse-knowledge-base.py`, existing KG JSON must be regenerated. This is a deterministic re-run of the script, not requiring LLM.

3. **contentSnippet optimization** — Wiki files start with YAML front matter (~200 chars). Snippet should skip front matter to show actual content. Implementation: match `/^---[\s\S]*?---/`, skip, then take 500 chars.

4. **knowledge read node limit** — Cap at 10 nodes per request to prevent oversized responses.

5. **LLM wiki detection** — Dashboard detects LLM wiki by checking if KG nodes include `type=article|requirement|testcase` (knowledge node types) and no `wiki/index.json` exists.

6. **Phase B scope control** — Link navigation path resolution is complex. Recommend B-v1 (file tree + markdown preview) first, B-v2 (link navigation + search integration) as follow-up.

### Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|-----------|
| MiniSearch memory with full content | Low | 418 nodes × ~2KB avg = ~836KB text, index ~2MB | 
| Phase B KnowledgeWikiView complexity | Medium | Split into B-v1 (basic) + B-v2 (enhanced) |
| Backward compat (filePath change) | Low | Require KG re-generation after script update |

---

## Implementation Order

1. **A1-A2**: `parse-knowledge-base.py` (2 line changes) → regenerate KG
2. **A3**: `kg-index.ts` contentSnippet (with front-matter skip)
3. **A4**: Graph handler nodes filter
4. **A5-A7**: CLI knowledge read + formatting
5. **A-doc**: Worker agent + SKILL.md update
6. **B1-B2**: API knowledge tree + source reading (B-v1)
7. **B3-B4**: Dashboard KnowledgeWikiView basic (file tree + markdown preview)
8. **B5**: Link navigation + search integration (B-v2, follow-up)
