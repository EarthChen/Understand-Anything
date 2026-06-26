# PRD Knowledge System and Query Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make PRD/testcase LLM wiki artifacts discoverable in the system dashboard and queryable through a general `ua_query.py knowledge` command backed by MiniSearch.

**Architecture:** Keep PRD content in standard knowledge graph artifacts and register PRD wikis as `knowledge` facets in the parent system graph. Reuse existing dashboard service routing, `/api/search`, `KgIndex`, and `/api/graph-query` instead of introducing a PRD-specific API path.

**Tech Stack:** Python 3 stdlib `unittest`/`pytest`, TypeScript, Vitest, React Testing Library, MiniSearch, existing Understand-Anything dashboard API.

---

## File Structure

**Modify:**
- `understand-anything-plugin/skills/understand-knowledge/parse-knowledge-base.py` — ensure PRD profile writes standard `.understand-anything/knowledge-graph.json` after merge output exists.
- `understand-anything-plugin/skills/understand-knowledge/tests/test_prd_wiki_parser.py` — add coverage for final artifact publication.
- `understand-anything-plugin/packages/core/src/system-graph.ts` — add `knowledge` facet metadata to system graph types.
- `understand-anything-plugin/packages/core/src/__tests__/system-graph.test.ts` — prove knowledge facets validate.
- `understand-anything-plugin/skills/understand-wiki/build-system-graph.py` — discover PRD knowledge artifacts and register them in `serviceIndex`.
- `understand-anything-plugin/skills/understand-wiki/tests/test_build_system_graph.py` — create fixture-style tests for knowledge facet discovery.
- `understand-anything-plugin/packages/dashboard/src/api/handlers/kg-index.ts` — index `knowledgeMeta` fields through MiniSearch and return metadata in results.
- `understand-anything-plugin/packages/dashboard/src/api/handlers/__tests__/kg-index.test.ts` — prove PRD metadata search works.
- `understand-anything-plugin/packages/dashboard/src/api/handlers/search.ts` — inspect all-service search loading; change only if the existing service resolver does not include knowledge facets.
- `understand-anything-plugin/packages/dashboard/src/api/handlers/__tests__/search-core.test.ts` — prove `/api/search` returns PRD requirement/testcase results.
- `understand-anything-plugin/packages/dashboard/src/components/SearchBar.tsx` — add requirement/testcase badges by reusing existing badge colors.
- `understand-anything-plugin/packages/dashboard/src/components/NodeInfo.tsx` — show PRD metadata, cited sources, and tested-by coverage.
- `understand-anything-plugin/packages/dashboard/src/components/KnowledgeGraphView.tsx` — style `tested_by` edges.
- `understand-anything-plugin/packages/dashboard/src/__tests__/knowledge-node-types.test.ts` — add assertions for PRD UI behavior.
- `understand-anything-plugin/skills/understand-query/ua_query.py` — add `knowledge` subcommand parser and handler registration.
- `understand-anything-plugin/skills/understand-query/_commands.py` — add `cmd_knowledge`.
- `understand-anything-plugin/skills/understand-query/_helpers.py` — add knowledge facet discovery helpers.
- `understand-anything-plugin/skills/understand-query/_utils.py` — add markdown formatting for knowledge search and coverage results.
- `understand-anything-plugin/skills/understand-query/tests/test_knowledge_command.py` — unit tests for the new CLI command.
- `understand-anything-plugin/skills/understand-query/SKILL.md` — document `knowledge` command usage.

**Do not modify:**
- Raw `amar-prd` source/wiki content.
- Existing `ua_query.py ask` default behavior.
- Existing backend/mobile/frontend system graph semantics except allowing the new `knowledge` facet value.

---

### Task 1: Publish PRD Knowledge Graph to the Standard Artifact Path

**Files:**
- Modify: `understand-anything-plugin/skills/understand-knowledge/parse-knowledge-base.py`
- Modify: `understand-anything-plugin/skills/understand-knowledge/tests/test_prd_wiki_parser.py`

- [ ] **Step 1: Add a failing test for final artifact publication**

Append this test to `understand-anything-plugin/skills/understand-knowledge/tests/test_prd_wiki_parser.py`:

```python
    def test_parse_writes_standard_knowledge_graph_artifact(self):
        """Dashboard/query integration depends on the standard knowledge-graph.json path."""
        fixture = self.fixture_root / "prd-wiki"
        output_dir = fixture / ".understand-anything"
        final_graph = output_dir / "knowledge-graph.json"
        if final_graph.exists():
            final_graph.unlink()

        result = self.run_parser(fixture, "--profile", "prd-wiki")

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(final_graph.is_file())
        graph = json.loads(final_graph.read_text(encoding="utf-8"))
        node_types = {node["type"] for node in graph["nodes"]}
        self.assertIn("requirement", node_types)
        self.assertIn("testcase", node_types)
        self.assertIn("prd-wiki", graph["project"].get("frameworks", []))
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
cd /Users/earthchen/.understand-anything/repo
python3 -m unittest understand-anything-plugin/skills/understand-knowledge/tests/test_prd_wiki_parser.py -v
```

Expected: FAIL in `test_parse_writes_standard_knowledge_graph_artifact` because the final artifact is not written to `.understand-anything/knowledge-graph.json`.

- [ ] **Step 3: Write the final artifact after successful parse/merge**

In `understand-anything-plugin/skills/understand-knowledge/parse-knowledge-base.py`, find the code path that writes `.understand-anything/intermediate/assembled-graph.json`. Immediately after that write succeeds, add:

```python
    final_graph_path = output_dir / "knowledge-graph.json"
    final_graph_path.write_text(
        json.dumps(assembled_graph, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
```

Use the local variable names already present in the file. If the assembled graph variable is named differently, assign it once before the intermediate write and reuse that same variable for both output files.

- [ ] **Step 4: Run the parser tests**

Run:

```bash
cd /Users/earthchen/.understand-anything/repo
python3 -m unittest understand-anything-plugin/skills/understand-knowledge/tests/test_prd_wiki_parser.py -v
```

Expected: PASS, including the new artifact publication test.

- [ ] **Step 5: Commit**

```bash
cd /Users/earthchen/.understand-anything/repo/.worktrees/understand-prd-system-query
git add understand-anything-plugin/skills/understand-knowledge/parse-knowledge-base.py understand-anything-plugin/skills/understand-knowledge/tests/test_prd_wiki_parser.py
git commit -m "feat: publish PRD knowledge graph artifact"
```

---

### Task 2: Add Knowledge Facets to System Graph Discovery

**Files:**
- Modify: `understand-anything-plugin/packages/core/src/system-graph.ts`
- Modify: `understand-anything-plugin/packages/core/src/__tests__/system-graph.test.ts`
- Modify: `understand-anything-plugin/skills/understand-wiki/build-system-graph.py`
- Create: `understand-anything-plugin/skills/understand-wiki/tests/test_build_system_graph.py`

- [ ] **Step 1: Add a core schema test for knowledge facets**

Append this test to `understand-anything-plugin/packages/core/src/__tests__/system-graph.test.ts` inside `describe("validateSystemGraph", ...)`:

```ts
  it("accepts a knowledge facet with a PRD wiki service index entry", () => {
    const graph: SystemGraph = {
      ...validGraph,
      nodes: [
        ...validGraph.nodes,
        {
          id: "facet:knowledge",
          type: "facet",
          name: "Knowledge",
          summary: "Product knowledge artifacts",
          facetType: "knowledge",
        },
        {
          id: "microservice:amar-prd",
          type: "microservice",
          name: "amar-prd",
          summary: "PRD and testcase knowledge wiki",
          languages: [],
          frameworks: ["prd-wiki"],
          stats: { nodes: 10, edges: 5, files: 0 },
          kgPath: "amar-prd/.understand-anything/knowledge-graph.json",
        },
      ],
      edges: [
        ...validGraph.edges,
        { source: "facet:knowledge", target: "microservice:amar-prd", type: "contains", weight: 1 },
      ],
      serviceIndex: {
        ...validGraph.serviceIndex,
        "amar-prd": {
          hasKg: true,
          hasWiki: false,
          hasDomain: false,
          basePath: "amar-prd",
          facet: "knowledge",
          profile: "prd-wiki",
        },
      },
    };

    const result = validateSystemGraph(graph);
    expect(result.valid).toBe(true);
    expect(result.data?.serviceIndex["amar-prd"].facet).toBe("knowledge");
  });
```

- [ ] **Step 2: Run the core system graph test and verify it fails at type-check or test compile**

Run:

```bash
cd /Users/earthchen/.understand-anything/repo/understand-anything-plugin/packages/core
./node_modules/.bin/vitest run src/__tests__/system-graph.test.ts
```

Expected: FAIL because `facetType`, `facet`, and `profile` do not yet allow `knowledge`/`prd-wiki`.

- [ ] **Step 3: Extend system graph TypeScript types**

In `understand-anything-plugin/packages/core/src/system-graph.ts`, add a reusable facet type near the top:

```ts
export type SystemGraphFacetType = "server" | "mobile" | "frontend" | "knowledge";
```

Update `SystemGraphNode`:

```ts
  facetType?: SystemGraphFacetType;
```

Update `SystemGraphServiceIndex`:

```ts
  facet?: SystemGraphFacetType;
  /** Knowledge graph profile, for non-code facets such as PRD wikis. */
  profile?: "generic" | "prd-wiki" | string;
```

- [ ] **Step 4: Add Python test for PRD knowledge discovery**

Create `understand-anything-plugin/skills/understand-wiki/tests/test_build_system_graph.py`:

```python
import json
import tempfile
import unittest
from pathlib import Path

import sys

SKILL_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SKILL_DIR))

from build_system_graph import build_system_graph


class BuildSystemGraphKnowledgeFacetTests(unittest.TestCase):
    def test_discovers_prd_wiki_as_knowledge_facet(self):
        """PRD wikis must be routable by dashboard/query through serviceIndex."""
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            prd = root / "amar-prd" / ".understand-anything"
            prd.mkdir(parents=True)
            (prd / "knowledge-graph.json").write_text(json.dumps({
                "version": "1.0.0",
                "project": {"name": "amar-prd", "frameworks": ["prd-wiki"], "languages": []},
                "nodes": [
                    {"id": "requirement:room", "name": "跨房间 PK", "type": "requirement"},
                    {"id": "testcase:room", "name": "PK 测试", "type": "testcase"},
                    {"id": "source:raw", "name": "原始 PRD", "type": "source"},
                ],
                "edges": [
                    {"source": "requirement:room", "target": "testcase:room", "type": "tested_by"}
                ],
                "layers": [],
                "tour": [],
            }), encoding="utf-8")

            graph = build_system_graph(str(root))

            self.assertEqual(graph["serviceIndex"]["amar-prd"]["facet"], "knowledge")
            self.assertEqual(graph["serviceIndex"]["amar-prd"]["profile"], "prd-wiki")
            self.assertEqual(graph["serviceIndex"]["amar-prd"]["basePath"], "amar-prd")
            self.assertTrue(any(node["id"] == "facet:knowledge" for node in graph["nodes"]))
            self.assertTrue(any(edge["source"] == "facet:knowledge" and edge["target"] == "microservice:amar-prd" for edge in graph["edges"]))


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 5: Run the Python test and verify it fails**

Run:

```bash
cd /Users/earthchen/.understand-anything/repo
python3 -m unittest understand-anything-plugin/skills/understand-wiki/tests/test_build_system_graph.py -v
```

Expected: FAIL because `amar-prd` is not assigned `facet: knowledge` and the knowledge facet node is missing.

- [ ] **Step 6: Implement knowledge facet detection**

In `understand-anything-plugin/skills/understand-wiki/build-system-graph.py`, add:

```python
def _is_knowledge_artifact(kg: dict[str, Any]) -> bool:
    project = kg.get("project", {})
    frameworks = project.get("frameworks", [])
    if "prd-wiki" in frameworks:
        return True
    nodes = kg.get("nodes", [])
    return any(node.get("type") in {"requirement", "testcase"} for node in nodes)


def _knowledge_profile(kg: dict[str, Any]) -> str:
    project = kg.get("project", {})
    frameworks = project.get("frameworks", [])
    if "prd-wiki" in frameworks:
        return "prd-wiki"
    return "generic"
```

In the service loading loop inside `build_system_graph`, after reading `kg`, compute:

```python
        info = extract_service_info(svc["name"], kg)
        if _is_knowledge_artifact(kg):
            info["facet"] = "knowledge"
            info["profile"] = _knowledge_profile(kg)
        service_infos.append(info)
```

Preserve existing metadata from `svc_meta`; if either `info["facet"]` or `meta["facet"]` is present, prefer `info["facet"] == "knowledge"` for PRD wiki artifacts.

When creating facet group nodes, allow `knowledge`:

```python
                "facetType": facet_type if facet_type in ("server", "mobile", "frontend", "knowledge") else "server",
```

Before generating service nodes, ensure a knowledge facet exists when any `service_infos` entry has `facet == "knowledge"`:

```python
    if any(info.get("facet") == "knowledge" for info in service_infos) and "knowledge" not in facet_ids:
        facet_ids["knowledge"] = "facet:knowledge"
        nodes.append({
            "id": "facet:knowledge",
            "type": "facet",
            "name": "Knowledge",
            "summary": "Product and document knowledge artifacts",
            "facetType": "knowledge",
            "path": "",
        })
```

When computing `svc_facet`, use:

```python
        svc_facet = info.get("facet") or meta.get("facet", "")
```

When writing `idx_entry`, include:

```python
        if svc_facet:
            idx_entry["facet"] = svc_facet
        if info.get("profile"):
            idx_entry["profile"] = info["profile"]
```

- [ ] **Step 7: Run system graph tests**

Run:

```bash
cd /Users/earthchen/.understand-anything/repo/understand-anything-plugin/packages/core
./node_modules/.bin/vitest run src/__tests__/system-graph.test.ts
cd /Users/earthchen/.understand-anything/repo
python3 -m unittest understand-anything-plugin/skills/understand-wiki/tests/test_build_system_graph.py -v
```

Expected: both commands PASS.

- [ ] **Step 8: Commit**

```bash
cd /Users/earthchen/.understand-anything/repo/.worktrees/understand-prd-system-query
git add understand-anything-plugin/packages/core/src/system-graph.ts understand-anything-plugin/packages/core/src/__tests__/system-graph.test.ts understand-anything-plugin/skills/understand-wiki/build-system-graph.py understand-anything-plugin/skills/understand-wiki/tests/test_build_system_graph.py
git commit -m "feat: discover knowledge facets in system graph"
```

---

### Task 3: Index PRD Metadata Through MiniSearch

**Files:**
- Modify: `understand-anything-plugin/packages/dashboard/src/api/handlers/kg-index.ts`
- Modify: `understand-anything-plugin/packages/dashboard/src/api/handlers/__tests__/kg-index.test.ts`
- Modify: `understand-anything-plugin/packages/dashboard/src/api/handlers/search.ts`
- Modify: `understand-anything-plugin/packages/dashboard/src/api/handlers/__tests__/search-core.test.ts`

- [ ] **Step 1: Add a failing KgIndex test for PRD metadata search**

Append to `understand-anything-plugin/packages/dashboard/src/api/handlers/__tests__/kg-index.test.ts`:

```ts
  describe("knowledge metadata indexing", () => {
    it("finds requirements by PRD detail text that is not in the node name", () => {
      const prdGraph = {
        nodes: [
          {
            id: "requirement:room-pk",
            name: "房间玩法",
            type: "requirement",
            summary: "房间相关需求",
            tags: ["prd"],
            knowledgeMeta: {
              profile: "prd-wiki",
              sourceType: "prd",
              business: "房间",
              version: "v2.25.0",
              detail: "跨房间 PK 断线重连",
              sourcePath: "raw/prd/房间/2025-10-v2.25.0-跨房间PK.md",
              content: "观众重新进入后需要恢复 PK 进度。",
            },
          },
        ],
        edges: [],
      } as unknown as KnowledgeGraph

      const index = KgIndex.create(prdGraph, "amar-prd")
      const results = index.search({ q: "断线重连", type: "requirement" })

      expect(results.results).toHaveLength(1)
      expect(results.results[0].id).toBe("requirement:room-pk")
      expect(results.results[0].service).toBe("amar-prd")
      expect(results.results[0].business).toBe("房间")
      expect(results.results[0].sourcePath).toContain("raw/prd")
    })
  })
```

- [ ] **Step 2: Run the KgIndex test and verify it fails**

Run:

```bash
cd /Users/earthchen/.understand-anything/repo/understand-anything-plugin/packages/dashboard
./node_modules/.bin/vitest run src/api/handlers/__tests__/kg-index.test.ts -t "finds requirements by PRD detail text"
```

Expected: FAIL because `knowledgeMeta.detail/content` is not indexed and metadata fields are not returned.

- [ ] **Step 3: Extend KgDoc and result metadata**

In `understand-anything-plugin/packages/dashboard/src/api/handlers/kg-index.ts`, update `KgDoc`:

```ts
interface KgDoc {
  id: string
  name: string
  summary: string
  tags: string
  type: string
  service: string
  filePath: string
  startLine: number
  endLine: number
  layer: string
  knowledgeText: string
  business: string
  version: string
  detail: string
  sourcePath: string
  sourceType: string
  profile: string
}
```

Update `KgSearchResult` with optional fields:

```ts
  business?: string
  version?: string
  detail?: string
  sourcePath?: string
  sourceType?: string
  profile?: string
```

Update MiniSearch options:

```ts
const MINI_SEARCH_OPTIONS = {
  fields: ["name", "summary", "tags", "type", "knowledgeText"],
  storeFields: [
    "name", "type", "service", "filePath", "startLine", "endLine",
    "summary", "tags", "layer", "business", "version", "detail",
    "sourcePath", "sourceType", "profile",
  ],
  tokenize: codeTokenize,
}
```

Update `SEARCH_BOOST`:

```ts
const SEARCH_BOOST = {
  name: 3,
  tags: 2.5,
  summary: 2,
  knowledgeText: 1.8,
  type: 0.5,
}
```

In `buildDocs`, derive meta and knowledge text:

```ts
      .map((node) => {
        const meta = node.knowledgeMeta ?? {}
        const knowledgeText = [
          meta.content,
          meta.detail,
          meta.business,
          meta.month,
          meta.version,
          meta.sourcePath,
          meta.sourceType,
        ].filter((value): value is string => typeof value === "string" && value.length > 0).join(" ")
        return {
          id: node.id,
          name: node.name ?? "",
          summary: node.summary ?? "",
          tags: (node.tags ?? []).join(" "),
          type: node.type ?? "",
          service: serviceName,
          filePath: node.filePath ?? "",
          startLine: node.lineRange?.[0] ?? 0,
          endLine: node.lineRange?.[1] ?? 0,
          layer: (node.tags ?? []).includes("business") ? "business"
            : (node.tags ?? []).includes("domain") ? "domain"
            : "kg",
          knowledgeText,
          business: typeof meta.business === "string" ? meta.business : "",
          version: typeof meta.version === "string" ? meta.version : "",
          detail: typeof meta.detail === "string" ? meta.detail : "",
          sourcePath: typeof meta.sourcePath === "string" ? meta.sourcePath : "",
          sourceType: typeof meta.sourceType === "string" ? meta.sourceType : "",
          profile: typeof meta.profile === "string" ? meta.profile : "",
        }
      })
```

Update result mapping:

```ts
      business: r.business as string | undefined,
      version: r.version as string | undefined,
      detail: r.detail as string | undefined,
      sourcePath: r.sourcePath as string | undefined,
      sourceType: r.sourceType as string | undefined,
      profile: r.profile as string | undefined,
```

- [ ] **Step 4: Add a failing `/api/search` test for discoverable knowledge services**

Append to `understand-anything-plugin/packages/dashboard/src/api/handlers/__tests__/search-core.test.ts`:

```ts
  it("searches PRD knowledge facets through the KG index", () => {
    const state: SearchIndexState = {
      kgIndex: KgIndex.create({
        nodes: [
          {
            id: "requirement:room-pk",
            name: "房间玩法",
            type: "requirement",
            summary: "房间相关需求",
            tags: ["prd"],
            knowledgeMeta: {
              profile: "prd-wiki",
              detail: "跨房间 PK 断线重连",
              business: "房间",
              sourcePath: "raw/prd/房间/pk.md",
            },
          },
        ],
        edges: [],
      } as unknown as KnowledgeGraph, "amar-prd"),
      wikiIndex: new WikiIndex({ entries: [] }),
      edges: [],
      adjacency: new Map(),
      mtimes: {},
    }

    const result = unifiedSearch(state, "断线重连", 10, "kg", "none", "requirement", null, "amar-prd")

    expect(result.results).toHaveLength(1)
    expect(result.results[0].service).toBe("amar-prd")
    expect(result.facets.type.requirement).toBe(1)
  })
```

Add imports if missing:

```ts
import { KgIndex, type SearchIndexState } from "../kg-index"
import { WikiIndex } from "../wiki-index"
import type { KnowledgeGraph } from "@understand-anything/core"
```

- [ ] **Step 5: Run search tests**

Run:

```bash
cd /Users/earthchen/.understand-anything/repo/understand-anything-plugin/packages/dashboard
./node_modules/.bin/vitest run src/api/handlers/__tests__/kg-index.test.ts src/api/handlers/__tests__/search-core.test.ts
```

Expected: PASS.

- [ ] **Step 6: Confirm `search.ts` does not need a separate PRD branch**

Inspect `buildSearchIndex()` in `understand-anything-plugin/packages/dashboard/src/api/handlers/search.ts`. If `listServiceNames(null)` reads `amar-prd` from `serviceIndex`, no new branch is required. If tests reveal `collectIndexMtimes()` ignores the knowledge service because the graph only exists at the registered `basePath`, keep the existing `resolveServiceDataPath(serviceName, "knowledge-graph.json")` call and add no PRD-specific path handling.

The only allowed change in `search.ts` for this task is preserving PRD metadata when normalizing file paths:

```ts
          kgGraph.nodes.push({ ...node, filePath: fp })
```

must remain unchanged. Do not rewrite it into a PRD-specific mapper because `KgIndex` owns search document construction.

- [ ] **Step 7: Commit**

```bash
cd /Users/earthchen/.understand-anything/repo/.worktrees/understand-prd-system-query
git add understand-anything-plugin/packages/dashboard/src/api/handlers/kg-index.ts understand-anything-plugin/packages/dashboard/src/api/handlers/__tests__/kg-index.test.ts understand-anything-plugin/packages/dashboard/src/api/handlers/search.ts understand-anything-plugin/packages/dashboard/src/api/handlers/__tests__/search-core.test.ts
git commit -m "feat: index PRD knowledge metadata in search"
```

---

### Task 4: Add Dashboard PRD Knowledge Details

**Files:**
- Modify: `understand-anything-plugin/packages/dashboard/src/components/SearchBar.tsx`
- Modify: `understand-anything-plugin/packages/dashboard/src/components/NodeInfo.tsx`
- Modify: `understand-anything-plugin/packages/dashboard/src/components/KnowledgeGraphView.tsx`
- Modify: `understand-anything-plugin/packages/dashboard/src/__tests__/knowledge-node-types.test.ts`

- [ ] **Step 1: Add UI tests for requirement/testcase display**

Append to `understand-anything-plugin/packages/dashboard/src/__tests__/knowledge-node-types.test.ts`:

```ts
import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { typeBadgeColors } from "../components/NodeInfo"

describe("PRD knowledge node presentation", () => {
  it("has dedicated badge colors for requirement and testcase nodes", () => {
    expect(typeBadgeColors.requirement).toContain("text-node-requirement")
    expect(typeBadgeColors.testcase).toContain("text-node-testcase")
  })

  it("renders PRD metadata labels in node details", () => {
    const meta = {
      business: "房间",
      version: "v2.25.0",
      detail: "跨房间 PK",
      sourcePath: "raw/prd/房间/pk.md",
      sourceType: "prd",
    }
    render(
      <div>
        <span>{meta.business}</span>
        <span>{meta.version}</span>
        <span>{meta.detail}</span>
        <span>{meta.sourcePath}</span>
        <span>{meta.sourceType}</span>
      </div>,
    )
    expect(screen.getByText("房间")).toBeInTheDocument()
    expect(screen.getByText("v2.25.0")).toBeInTheDocument()
    expect(screen.getByText("跨房间 PK")).toBeInTheDocument()
    expect(screen.getByText("raw/prd/房间/pk.md")).toBeInTheDocument()
    expect(screen.getByText("prd")).toBeInTheDocument()
  })
})
```

If this file already imports `describe`, `expect`, or `it`, merge imports rather than duplicating them.

- [ ] **Step 2: Run the UI test and verify existing gaps**

Run:

```bash
cd /Users/earthchen/.understand-anything/repo/understand-anything-plugin/packages/dashboard
./node_modules/.bin/vitest run src/__tests__/knowledge-node-types.test.ts
```

Expected: existing badge assertions pass if Task 1 from the first PR already added colors; this step primarily locks the intended PRD metadata contract.

- [ ] **Step 3: Add requirement/testcase badges to SearchBar**

In `understand-anything-plugin/packages/dashboard/src/components/SearchBar.tsx`, extend `typeBadgeColors`:

```ts
  article: "text-node-article border border-node-article/30 bg-node-article/10",
  entity: "text-node-entity border border-node-entity/30 bg-node-entity/10",
  topic: "text-node-topic border border-node-topic/30 bg-node-topic/10",
  claim: "text-node-claim border border-node-claim/30 bg-node-claim/10",
  source: "text-node-source border border-node-source/30 bg-node-source/10",
  requirement: "text-node-requirement border border-node-requirement/30 bg-node-requirement/10",
  testcase: "text-node-testcase border border-node-testcase/30 bg-node-testcase/10",
```

- [ ] **Step 4: Add PRD metadata and coverage sections to NodeInfo**

In `KnowledgeNodeDetails` in `understand-anything-plugin/packages/dashboard/src/components/NodeInfo.tsx`, after the category block and before wikilinks, add:

```tsx
      {(meta?.business || meta?.version || meta?.detail || meta?.sourcePath || meta?.sourceType) && (
        <div>
          <h4 className="text-[10px] uppercase tracking-wider text-text-muted mb-1">PRD Metadata</h4>
          <div className="grid grid-cols-[72px_1fr] gap-x-2 gap-y-1 text-[11px]">
            {meta.business && <><span className="text-text-muted">Business</span><span className="text-text-secondary">{meta.business}</span></>}
            {meta.version && <><span className="text-text-muted">Version</span><span className="text-text-secondary">{meta.version}</span></>}
            {meta.detail && <><span className="text-text-muted">Detail</span><span className="text-text-secondary">{meta.detail}</span></>}
            {meta.sourceType && <><span className="text-text-muted">Source</span><span className="text-text-secondary">{meta.sourceType}</span></>}
            {meta.sourcePath && <><span className="text-text-muted">Path</span><span className="text-text-secondary break-all">{meta.sourcePath}</span></>}
          </div>
        </div>
      )}
```

Then derive cited sources and coverage near existing `wikilinks`/`backlinks` variables:

```tsx
  const citedSources = graph.edges
    .filter((e) => e.type === "cites" && e.source === node.id)
    .map((e) => graph.nodes.find((n) => n.id === e.target))
    .filter((n): n is GraphNode => n !== undefined);

  const testedBy = graph.edges
    .filter((e) => e.type === "tested_by" && e.source === node.id)
    .map((e) => graph.nodes.find((n) => n.id === e.target))
    .filter((n): n is GraphNode => n !== undefined);
```

Render sections before content preview:

```tsx
      {testedBy.length > 0 && (
        <div>
          <h4 className="text-[10px] uppercase tracking-wider text-text-muted mb-1">
            Test Coverage ({testedBy.length})
          </h4>
          <div className="space-y-1 max-h-[200px] overflow-auto">
            {testedBy.map((n) => (
              <button key={n.id} type="button" onClick={() => navigateToNode(n.id)} className="block w-full text-left px-2 py-1.5 rounded bg-elevated hover:bg-accent/10 text-[11px] text-text-secondary hover:text-accent transition-colors truncate">
                {n.name}
              </button>
            ))}
          </div>
        </div>
      )}
      {citedSources.length > 0 && (
        <div>
          <h4 className="text-[10px] uppercase tracking-wider text-text-muted mb-1">
            Cited Sources ({citedSources.length})
          </h4>
          <div className="space-y-1 max-h-[200px] overflow-auto">
            {citedSources.map((n) => (
              <button key={n.id} type="button" onClick={() => navigateToNode(n.id)} className="block w-full text-left px-2 py-1.5 rounded bg-elevated hover:bg-accent/10 text-[11px] text-text-secondary hover:text-accent transition-colors truncate">
                {n.name}
              </button>
            ))}
          </div>
        </div>
      )}
```

- [ ] **Step 5: Style tested_by edges**

In `understand-anything-plugin/packages/dashboard/src/components/KnowledgeGraphView.tsx`, add to `EDGE_STYLES`:

```ts
  tested_by: { stroke: "var(--color-node-testcase)", strokeWidth: 2, strokeDasharray: "2 4" },
```

- [ ] **Step 6: Run dashboard UI tests**

Run:

```bash
cd /Users/earthchen/.understand-anything/repo/understand-anything-plugin/packages/dashboard
./node_modules/.bin/vitest run src/__tests__/knowledge-node-types.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
cd /Users/earthchen/.understand-anything/repo/.worktrees/understand-prd-system-query
git add understand-anything-plugin/packages/dashboard/src/components/SearchBar.tsx understand-anything-plugin/packages/dashboard/src/components/NodeInfo.tsx understand-anything-plugin/packages/dashboard/src/components/KnowledgeGraphView.tsx understand-anything-plugin/packages/dashboard/src/__tests__/knowledge-node-types.test.ts
git commit -m "feat: show PRD knowledge details in dashboard"
```

---

### Task 5: Add `ua_query.py knowledge` Command Group

**Files:**
- Modify: `understand-anything-plugin/skills/understand-query/ua_query.py`
- Modify: `understand-anything-plugin/skills/understand-query/_commands.py`
- Modify: `understand-anything-plugin/skills/understand-query/_helpers.py`
- Modify: `understand-anything-plugin/skills/understand-query/_utils.py`
- Create: `understand-anything-plugin/skills/understand-query/tests/test_knowledge_command.py`
- Modify: `understand-anything-plugin/skills/understand-query/SKILL.md`

- [ ] **Step 1: Add CLI tests for knowledge search and coverage**

Create `understand-anything-plugin/skills/understand-query/tests/test_knowledge_command.py`:

```python
import argparse
from pathlib import Path
from unittest.mock import patch

import sys

sys.path.insert(0, str(Path(__file__).parent.parent))

from _commands import cmd_knowledge
from ua_query import parse_args


def _args(**overrides):
    defaults = {
        "server": "http://localhost:3001",
        "service": "amar-prd",
        "search": None,
        "node": None,
        "neighbors": None,
        "coverage": None,
        "knowledge_action": "search",
        "type": None,
        "edge_type": None,
        "limit": 20,
        "offset": 0,
        "format": "json",
    }
    defaults.update(overrides)
    return argparse.Namespace(**defaults)


def test_parse_knowledge_search_command():
    args = parse_args(["knowledge", "search", "跨房间 PK", "--type", "requirement", "--service", "amar-prd"])
    assert args.command == "knowledge"
    assert args.knowledge_action == "search"
    assert args.query == "跨房间 PK"
    assert args.type == "requirement"
    assert args.service == "amar-prd"


@patch("_commands._search_api")
def test_knowledge_search_uses_unified_search(mock_search):
    mock_search.return_value = [{"id": "requirement:room", "name": "跨房间 PK", "type": "requirement"}]

    result = cmd_knowledge(_args(search="跨房间 PK", type="requirement"))

    mock_search.assert_called_once_with(
        "http://localhost:3001",
        "跨房间 PK",
        service="amar-prd",
        scope="kg",
        limit=20,
        type="requirement",
        offset=0,
    )
    assert result["results"][0]["id"] == "requirement:room"


@patch("_commands._resolve_knowledge_service")
@patch("_commands._search_api")
def test_knowledge_search_auto_resolves_single_knowledge_service(mock_search, mock_resolve):
    mock_resolve.return_value = "amar-prd"
    mock_search.return_value = [{"id": "requirement:room", "name": "跨房间 PK", "type": "requirement"}]

    result = cmd_knowledge(_args(service=None, search="跨房间 PK", type="requirement"))

    mock_resolve.assert_called_once_with("http://localhost:3001", None)
    assert result["service"] == "amar-prd"
    assert result["results"][0]["type"] == "requirement"


@patch("_commands._helpers.fetch_json")
def test_knowledge_coverage_fetches_tested_by_neighbors(mock_fetch):
    mock_fetch.return_value = {
        "center": {"id": "requirement:room", "name": "跨房间 PK", "type": "requirement"},
        "neighbors": [
            {
                "node": {"id": "testcase:room", "name": "PK 测试", "type": "testcase"},
                "edge": {"type": "tested_by"},
                "direction": "outbound",
                "depth": 1,
            }
        ],
    }

    result = cmd_knowledge(_args(knowledge_action="coverage", coverage="requirement:room"))

    mock_fetch.assert_called_once_with(
        "http://localhost:3001",
        "/api/graph-query/neighbors",
        {
            "service": "amar-prd",
            "graph": "kg",
            "node": "requirement:room",
            "direction": "outbound",
            "depth": "1",
            "edgeType": "tested_by",
        },
    )
    assert result["coverage"][0]["id"] == "testcase:room"
```

- [ ] **Step 2: Run the new tests and verify they fail**

Run:

```bash
cd /Users/earthchen/.understand-anything/repo
python3 -m pytest understand-anything-plugin/skills/understand-query/tests/test_knowledge_command.py -q
```

Expected: FAIL because `cmd_knowledge` and the `knowledge` parser do not exist.

- [ ] **Step 3: Add parser for the `knowledge` command group**

In `understand-anything-plugin/skills/understand-query/ua_query.py`, import `cmd_knowledge`:

```python
    cmd_affected, cmd_structure, cmd_source, cmd_knowledge,
```

After the `source` command block, add:

```python
    knowledge = sub.add_parser("knowledge", help="Knowledge wiki queries, including PRD/testcase artifacts")
    knowledge_sub = knowledge.add_subparsers(dest="knowledge_action", required=True)

    knowledge_search = knowledge_sub.add_parser("search", help="Search knowledge graph nodes via MiniSearch")
    knowledge_search.add_argument("query")
    knowledge_search.add_argument("--service")
    knowledge_search.add_argument("--type", choices=["requirement", "testcase", "source", "article", "topic", "entity", "claim"])
    knowledge_search.add_argument("--limit", type=int, default=20)
    knowledge_search.add_argument("--offset", type=int, default=0)

    knowledge_node = knowledge_sub.add_parser("node", help="Find a knowledge node by id or name")
    knowledge_node.add_argument("node")
    knowledge_node.add_argument("--service")

    knowledge_neighbors = knowledge_sub.add_parser("neighbors", help="List knowledge node neighbors")
    knowledge_neighbors.add_argument("node")
    knowledge_neighbors.add_argument("--service")
    knowledge_neighbors.add_argument("--edge-type")
    knowledge_neighbors.add_argument("--direction", choices=["inbound", "outbound", "both"], default="both")
    knowledge_neighbors.add_argument("--depth", type=int, default=1)

    knowledge_coverage = knowledge_sub.add_parser("coverage", help="Show deterministic requirement testcase coverage")
    knowledge_coverage.add_argument("node")
    knowledge_coverage.add_argument("--service")
```

In the `handlers` dict, add:

```python
            "knowledge": cmd_knowledge,
```

- [ ] **Step 4: Add knowledge command handler**

In `understand-anything-plugin/skills/understand-query/_helpers.py`, add:

```python
def _discover_knowledge_services(server: str) -> list[str]:
    data = fetch_json(server, "/api/services", {})
    services = []
    for item in data.get("services", []):
        if item.get("facet") != "knowledge":
            continue
        kg_layer = item.get("dataLayers", {}).get("kg", {})
        if kg_layer.get("available") is True and item.get("name"):
            services.append(item["name"])
    return services


def _resolve_knowledge_service(server: str, service: str | None) -> str:
    if service:
        return service
    services = _discover_knowledge_services(server)
    if len(services) == 1:
        return services[0]
    if not services:
        raise SystemExit("No knowledge service found. Run system graph generation after /understand-knowledge.")
    raise SystemExit("Multiple knowledge services found. Pass --service. Candidates: " + ", ".join(services))
```

In `understand-anything-plugin/skills/understand-query/_commands.py`, import the resolver:

```python
    _is_test_path, _extract_symbol, _kg_file_toc, _cmd_structure_symbol,
    _resolve_knowledge_service,
)
```

Then add:

```python
def cmd_knowledge(args: argparse.Namespace) -> Any:
    service = _resolve_knowledge_service(args.server, args.service)
    action = getattr(args, "knowledge_action", None)

    if action == "search":
        results = _search_api(
            args.server,
            args.query,
            service=service,
            scope="kg",
            limit=args.limit,
            type=args.type,
            offset=args.offset,
        )
        return {"service": service, "query": args.query, "results": results}

    if action == "node":
        data = _helpers.fetch_json(args.server, "/api/graph", {"service": service, "file": "knowledge-graph.json"})
        node_ref = args.node.lower()
        matches = [
            node for node in data.get("nodes", [])
            if node.get("id", "").lower() == node_ref
            or node.get("name", "").lower() == node_ref
            or node_ref in node.get("id", "").lower()
            or node_ref in node.get("name", "").lower()
        ]
        return {"service": service, "nodes": matches, "total": len(matches)}

    if action == "neighbors":
        params: dict[str, str] = {
            "service": service,
            "graph": "kg",
            "node": args.node,
            "direction": args.direction,
            "depth": str(args.depth),
        }
        if args.edge_type:
            params["edgeType"] = args.edge_type
        return _helpers.fetch_json(args.server, "/api/graph-query/neighbors", params)

    if action == "coverage":
        data = _helpers.fetch_json(args.server, "/api/graph-query/neighbors", {
            "service": service,
            "graph": "kg",
            "node": args.node,
            "direction": "outbound",
            "depth": "1",
            "edgeType": "tested_by",
        })
        coverage = [
            entry.get("node", {})
            for entry in data.get("neighbors", [])
            if entry.get("edge", {}).get("type") == "tested_by"
        ]
        return {"service": service, "requirement": data.get("center"), "coverage": coverage, "total": len(coverage)}

    raise SystemExit("knowledge requires one of: search, node, neighbors, coverage")
```

- [ ] **Step 5: Add markdown formatting for knowledge results**

In `understand-anything-plugin/skills/understand-query/_utils.py`, near the top of `_format_markdown`, add:

```python
    if isinstance(data, dict) and "coverage" in data and "requirement" in data:
        req = data.get("requirement") or {}
        lines = [f"# Knowledge Coverage: {req.get('name', req.get('id', '?'))}", ""]
        coverage = data.get("coverage", [])
        if not coverage:
            lines.append("No deterministic testcase coverage found.")
            return "\n".join(lines)
        for item in coverage:
            lines.append(f"- **{item.get('name', item.get('id', '?'))}** ({item.get('type', '?')})")
        return "\n".join(lines)

    if isinstance(data, dict) and "results" in data and data.get("service") and data.get("query"):
        lines = [f"# Knowledge Search: {data.get('query')}", f"Service: {data.get('service')}", ""]
        for r in data.get("results", []):
            meta = []
            if r.get("business"):
                meta.append(str(r["business"]))
            if r.get("version"):
                meta.append(str(r["version"]))
            if r.get("sourcePath"):
                meta.append(str(r["sourcePath"]))
            suffix = f" — {' | '.join(meta)}" if meta else ""
            lines.append(f"- **{r.get('name', r.get('id', '?'))}** ({r.get('type', '?')}){suffix}")
            if r.get("summary"):
                lines.append(f"  {str(r['summary'])[:200]}")
        return "\n".join(lines)
```

- [ ] **Step 6: Document knowledge command usage**

In `understand-anything-plugin/skills/understand-query/SKILL.md`, add a concise section under the command list:

```md
### Knowledge Wiki Queries

Use `knowledge` for non-code knowledge graph artifacts such as PRD/testcase wikis.

```bash
python ua_query.py --format md knowledge search "跨房间 PK" --service amar-prd --type requirement
python ua_query.py knowledge search "PK 测试" --service amar-prd --type testcase
python ua_query.py knowledge node "requirement:summaries/房间-2025-10-v2.25.0-跨房间PK" --service amar-prd
python ua_query.py --format md knowledge coverage "requirement:summaries/房间-2025-10-v2.25.0-跨房间PK" --service amar-prd
```

PRD knowledge is product intent and QA coverage. It is not treated as code implementation proof by `ask` unless a future `--with-knowledge` mode explicitly opts in.
```

- [ ] **Step 7: Run query tests**

Run:

```bash
cd /Users/earthchen/.understand-anything/repo
python3 -m pytest understand-anything-plugin/skills/understand-query/tests/test_knowledge_command.py understand-anything-plugin/skills/understand-query/tests/test_ask_domain_flows.py -q
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
cd /Users/earthchen/.understand-anything/repo/.worktrees/understand-prd-system-query
git add understand-anything-plugin/skills/understand-query/ua_query.py understand-anything-plugin/skills/understand-query/_commands.py understand-anything-plugin/skills/understand-query/_helpers.py understand-anything-plugin/skills/understand-query/_utils.py understand-anything-plugin/skills/understand-query/tests/test_knowledge_command.py understand-anything-plugin/skills/understand-query/SKILL.md
git commit -m "feat: add knowledge query command"
```

---

### Task 6: End-to-End Validation With `amar-prd`

**Files:**
- No source changes expected.
- Use generated artifacts in `/Users/earthchen/ai-work/kb-test`.

- [ ] **Step 1: Regenerate the PRD knowledge graph**

Run:

```bash
cd /Users/earthchen/ai-work/kb-test/amar-prd
python3 /Users/earthchen/.understand-anything/repo/.worktrees/understand-prd-system-query/understand-anything-plugin/skills/understand-knowledge/parse-knowledge-base.py /Users/earthchen/ai-work/kb-test/amar-prd --profile auto
```

Expected:
- Exit code 0.
- `/Users/earthchen/ai-work/kb-test/amar-prd/.understand-anything/knowledge-graph.json` exists.
- Graph contains `requirement`, `testcase`, and `source` nodes.

- [ ] **Step 2: Rebuild the parent system graph**

Run:

```bash
cd /Users/earthchen/ai-work/kb-test
python3 /Users/earthchen/.understand-anything/repo/.worktrees/understand-prd-system-query/understand-anything-plugin/skills/understand-wiki/build-system-graph.py /Users/earthchen/ai-work/kb-test
```

Expected:
- Exit code 0.
- `/Users/earthchen/ai-work/kb-test/.understand-anything/system-graph.json` contains `serviceIndex["amar-prd"].facet == "knowledge"`.
- It also contains a node with `id == "facet:knowledge"`.

- [ ] **Step 3: Run focused test suites**

Run:

```bash
cd /Users/earthchen/.understand-anything/repo/understand-anything-plugin/packages/core
./node_modules/.bin/vitest run src/__tests__/system-graph.test.ts src/__tests__/schema.test.ts src/types.test.ts

cd /Users/earthchen/.understand-anything/repo/understand-anything-plugin/packages/dashboard
./node_modules/.bin/vitest run src/api/handlers/__tests__/kg-index.test.ts src/api/handlers/__tests__/search-core.test.ts src/__tests__/knowledge-node-types.test.ts

cd /Users/earthchen/.understand-anything/repo
python3 -m unittest understand-anything-plugin/skills/understand-knowledge/tests/test_prd_wiki_parser.py understand-anything-plugin/skills/understand-wiki/tests/test_build_system_graph.py -v
python3 -m pytest understand-anything-plugin/skills/understand-query/tests/test_knowledge_command.py understand-anything-plugin/skills/understand-query/tests/test_ask_domain_flows.py -q
```

Expected: all commands PASS.

- [ ] **Step 4: Run local API smoke check if dashboard server is available**

If the dashboard API server is already running, run:

```bash
cd /Users/earthchen/.understand-anything/repo/understand-anything-plugin/skills/understand-query
UNDERSTAND_SERVER=http://localhost:3001 python3 ua_query.py --format md knowledge search "跨房间 PK" --service amar-prd --type requirement
UNDERSTAND_SERVER=http://localhost:3001 python3 ua_query.py --format md knowledge search "PK 测试" --service amar-prd --type testcase
```

Expected:
- The first command prints at least one `requirement`.
- The second command prints at least one `testcase`.

If no server is running, do not start one in this task; record that API smoke was skipped because the server was unavailable. Unit tests already verify command routing.

- [ ] **Step 5: Review the final diff**

Run:

```bash
cd /Users/earthchen/.understand-anything/repo/.worktrees/understand-prd-system-query
git status --short
git log --oneline --decorate -8
git diff --stat
```

Expected:
- `git status --short` is clean after prior task commits.
- Recent commits show Task 1 through Task 5 commits.
- `git diff --stat` is empty.

---

## Deferred Integration Items

These are intentionally deferred from this implementation plan:

- Add `ua_query.py ask --with-knowledge` to use PRD nodes for query expansion while labeling PRD intent separately from code evidence.
- Add requirement-to-code traceability once product requirement nodes can be mapped to services/domains with reliable evidence.
- Add deterministic version-chain and contradiction views for PRD requirement evolution.
- Add a richer dashboard route for knowledge-facet landing pages if multiple knowledge artifacts become common.
- Add LLM-assisted testcase coverage suggestions as metadata only, not graph `tested_by` edges, until confidence can be audited.
