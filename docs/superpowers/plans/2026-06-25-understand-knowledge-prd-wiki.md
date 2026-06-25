# Understand Knowledge PRD Wiki Profile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a PRD/testcase wiki profile to `/understand-knowledge` while preserving generic LLM wiki behavior.

**Architecture:** Extend the existing knowledge pipeline instead of creating a new skill. Core schema gains `requirement` and `testcase` node types; the Python parser gains profile detection, Markdown link resolution, frontmatter provenance, deterministic citation/category edges, and conservative requirement-to-testcase coverage edges.

**Tech Stack:** TypeScript, Zod, Vitest, Python 3 stdlib `unittest`, existing Understand-Anything skill scripts.

---

## File Structure

**Modify:**
- `understand-anything-plugin/packages/core/src/types.ts` — add `requirement` and `testcase` to `NodeType`, expand `KnowledgeMeta`.
- `understand-anything-plugin/packages/core/src/schema.ts` — allow new node types in `GraphNodeSchema`, keep passthrough metadata.
- `understand-anything-plugin/packages/core/src/__tests__/schema.test.ts` — prove schema accepts new node types.
- `understand-anything-plugin/packages/core/src/types.test.ts` — update compile-time/runtime node-type coverage.
- `understand-anything-plugin/packages/dashboard/src/store.ts` — include new node types in dashboard filters.
- `understand-anything-plugin/packages/dashboard/src/components/CustomNode.tsx` — color/text maps for new node types.
- `understand-anything-plugin/packages/dashboard/src/index.css` — CSS variables for new node colors.
- `understand-anything-plugin/skills/understand-knowledge/SKILL.md` — document `--profile` and PRD-wiki behavior.
- `understand-anything-plugin/skills/understand-knowledge/parse-knowledge-base.py` — profile detection, frontmatter parsing, Markdown link parsing, PRD/testcase node mapping, deterministic edges.
- `understand-anything-plugin/skills/understand-knowledge/merge-knowledge-graph.py` — accept new node types, preserve profile stats in output metadata.

**Create:**
- `understand-anything-plugin/skills/understand-knowledge/tests/test_prd_wiki_parser.py` — stdlib unit/integration tests for parser behavior.
- `understand-anything-plugin/skills/understand-knowledge/tests/fixtures/prd-wiki/CLAUDE.md`
- `understand-anything-plugin/skills/understand-knowledge/tests/fixtures/prd-wiki/wiki/index.md`
- `understand-anything-plugin/skills/understand-knowledge/tests/fixtures/prd-wiki/wiki/concepts/房间.md`
- `understand-anything-plugin/skills/understand-knowledge/tests/fixtures/prd-wiki/wiki/summaries/房间-2025-10-v2.25.0-跨房间PK.md`
- `understand-anything-plugin/skills/understand-knowledge/tests/fixtures/prd-wiki/wiki/testcases/房间-PK优化.md`
- `understand-anything-plugin/skills/understand-knowledge/tests/fixtures/prd-wiki/raw/prd/房间/2025-10-v2.25.0-跨房间PK.md`
- `understand-anything-plugin/skills/understand-knowledge/tests/fixtures/prd-wiki/raw/testcase/房间/PK优化.md`
- `understand-anything-plugin/skills/understand-knowledge/tests/fixtures/generic-wiki/wiki/index.md`
- `understand-anything-plugin/skills/understand-knowledge/tests/fixtures/generic-wiki/wiki/concepts/Topic.md`

---

### Task 1: Core Schema and Dashboard Node Type Support

**Files:**
- Modify: `understand-anything-plugin/packages/core/src/types.ts`
- Modify: `understand-anything-plugin/packages/core/src/schema.ts`
- Modify: `understand-anything-plugin/packages/core/src/__tests__/schema.test.ts`
- Modify: `understand-anything-plugin/packages/core/src/types.test.ts`
- Modify: `understand-anything-plugin/packages/dashboard/src/store.ts`
- Modify: `understand-anything-plugin/packages/dashboard/src/components/CustomNode.tsx`
- Modify: `understand-anything-plugin/packages/dashboard/src/index.css`

- [ ] **Step 1: Add schema tests for requirement/testcase nodes**

Append this test block to `understand-anything-plugin/packages/core/src/__tests__/schema.test.ts` inside the existing `describe("schema validation", ...)` block:

```ts
  it("accepts requirement and testcase knowledge nodes", () => {
    const graph = structuredClone(validGraph);
    graph.nodes = [
      {
        id: "requirement:summaries/房间-2025-10-v2.25.0-跨房间PK",
        type: "requirement" as any,
        name: "跨房间 PK",
        filePath: "summaries/房间-2025-10-v2.25.0-跨房间PK.md",
        summary: "PRD summary for cross-room PK.",
        tags: ["prd", "房间"],
        complexity: "moderate",
        knowledgeMeta: {
          profile: "prd-wiki",
          subtype: "prd_summary",
          sourceType: "prd",
          sourcePath: "raw/prd/房间/2025-10-v2.25.0-跨房间PK.md",
          business: "房间",
          month: "2025-10",
          version: "v2.25.0",
          detail: "跨房间PK",
        },
      },
      {
        id: "testcase:testcases/房间-PK优化",
        type: "testcase" as any,
        name: "PK优化 测试用例",
        filePath: "testcases/房间-PK优化.md",
        summary: "QA coverage for PK optimization.",
        tags: ["testcase", "房间"],
        complexity: "moderate",
        knowledgeMeta: {
          profile: "prd-wiki",
          subtype: "testcase_summary",
          sourceType: "testcase",
          sourcePath: "raw/testcase/房间/PK优化.md",
          business: "房间",
        },
      },
    ];
    graph.edges = [
      {
        source: graph.nodes[0].id,
        target: graph.nodes[1].id,
        type: "tested_by",
        direction: "forward",
        weight: 0.9,
      },
    ];
    graph.layers = [{ id: "layer-prd", name: "PRD", description: "PRD", nodeIds: graph.nodes.map((n) => n.id) }];
    graph.tour = [{ order: 1, title: "PRD", description: "PRD", nodeIds: [graph.nodes[0].id] }];

    const result = validateGraph(graph);
    expect(result.success).toBe(true);
    expect(result.data!.nodes.map((node) => node.type)).toEqual(["requirement", "testcase"]);
  });
```

- [ ] **Step 2: Run the schema test and verify it fails**

Run:

```bash
cd /Users/earthchen/.understand-anything/repo
pnpm vitest run understand-anything-plugin/packages/core/src/__tests__/schema.test.ts -t "accepts requirement and testcase knowledge nodes"
```

Expected: FAIL with a Zod invalid enum value for `requirement` or `testcase`.

- [ ] **Step 3: Add node types and metadata fields**

In `understand-anything-plugin/packages/core/src/types.ts`, change the top comment and `NodeType` union to include the new values:

```ts
// Node types (23 total: 5 code + 8 non-code + 3 domain + 7 knowledge)
export type NodeType =
  | "file" | "function" | "class" | "module" | "concept"
  | "config" | "document" | "service" | "table" | "endpoint"
  | "pipeline" | "schema" | "resource"
  | "domain" | "flow" | "step"
  | "article" | "entity" | "topic" | "claim" | "source"
  | "requirement" | "testcase";
```

Replace `KnowledgeMeta` with:

```ts
export interface KnowledgeMeta {
  wikilinks?: string[];
  backlinks?: string[];
  category?: string;
  content?: string;
  service?: string;
  profile?: "generic" | "prd-wiki" | string;
  subtype?: string;
  sourceType?: "prd" | "testcase" | string;
  sourcePath?: string;
  sourceSubtype?: "raw_prd" | "raw_testcase" | string;
  business?: string;
  month?: string;
  version?: string;
  detail?: string;
  markdownLinks?: Array<{
    label: string;
    target: string;
    resolvedId?: string;
    fragment?: string | null;
  }>;
  externalLinks?: string[];
  testcaseCandidates?: Array<{ id: string; reason: string; score: number }>;
}
```

In `understand-anything-plugin/packages/core/src/schema.ts`, add aliases:

```ts
  req: "requirement",
  prd: "requirement",
  requirement_summary: "requirement",
  test_case: "testcase",
  qa_case: "testcase",
```

to `NODE_TYPE_ALIASES` near the knowledge aliases.

In `GraphNodeSchema`, extend the enum tail:

```ts
    "article", "entity", "topic", "claim", "source",
    "requirement", "testcase",
```

The existing `KnowledgeMetaSchema.passthrough()` can remain; no Zod field-level expansion is required for this task.

- [ ] **Step 4: Update dashboard node type lists and colors**

In `understand-anything-plugin/packages/dashboard/src/store.ts`, update:

```ts
export type NodeType = "file" | "function" | "class" | "module" | "concept" | "config" | "document" | "service" | "table" | "endpoint" | "pipeline" | "schema" | "resource" | "domain" | "flow" | "step" | "article" | "entity" | "topic" | "claim" | "source" | "requirement" | "testcase";
```

and:

```ts
export const ALL_NODE_TYPES: NodeType[] = ["file", "function", "class", "module", "concept", "config", "document", "service", "table", "endpoint", "pipeline", "schema", "resource", "domain", "flow", "step", "article", "entity", "topic", "claim", "source", "requirement", "testcase"];
```

In `understand-anything-plugin/packages/dashboard/src/components/CustomNode.tsx`, add entries to both `typeColors` and `typeTextColors`:

```ts
  requirement: "var(--color-node-requirement)",
  testcase: "var(--color-node-testcase)",
```

and:

```ts
  requirement: "text-node-requirement",
  testcase: "text-node-testcase",
```

In `understand-anything-plugin/packages/dashboard/src/index.css`, add variables next to the existing knowledge colors:

```css
  --color-node-requirement: #d99058;
  --color-node-testcase: #8dbf73;
```

- [ ] **Step 5: Run focused tests**

Run:

```bash
cd /Users/earthchen/.understand-anything/repo
pnpm vitest run understand-anything-plugin/packages/core/src/__tests__/schema.test.ts -t "accepts requirement and testcase knowledge nodes"
pnpm vitest run understand-anything-plugin/packages/core/src/types.test.ts
```

Expected: both commands PASS. If `types.test.ts` has a hard-coded node count assertion, update the assertion text and list to include `requirement` and `testcase`, then rerun.

- [ ] **Step 6: Commit Task 1**

```bash
git add understand-anything-plugin/packages/core/src/types.ts \
  understand-anything-plugin/packages/core/src/schema.ts \
  understand-anything-plugin/packages/core/src/__tests__/schema.test.ts \
  understand-anything-plugin/packages/core/src/types.test.ts \
  understand-anything-plugin/packages/dashboard/src/store.ts \
  understand-anything-plugin/packages/dashboard/src/components/CustomNode.tsx \
  understand-anything-plugin/packages/dashboard/src/index.css
git commit -m "feat: add requirement and testcase graph node types"
```

---

### Task 2: Parser Profile, Frontmatter, and Link Helpers

**Files:**
- Modify: `understand-anything-plugin/skills/understand-knowledge/parse-knowledge-base.py`
- Create: `understand-anything-plugin/skills/understand-knowledge/tests/test_prd_wiki_parser.py`
- Create fixture files under `understand-anything-plugin/skills/understand-knowledge/tests/fixtures/`

- [ ] **Step 1: Create parser tests for profile/frontmatter/link helpers**

Create `understand-anything-plugin/skills/understand-knowledge/tests/test_prd_wiki_parser.py` with:

```python
import importlib.util
import json
import shutil
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).resolve().parents[1] / "parse-knowledge-base.py"
spec = importlib.util.spec_from_file_location("parse_knowledge_base", SCRIPT)
parser = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(parser)


class ParserHelperTests(unittest.TestCase):
    def test_frontmatter_parser_handles_inline_arrays_and_quotes(self):
        text = """---
title: "跨房间 PK"
type: summary
source_type: prd
source_path: "raw/prd/房间/2025-10-v2.25.0-跨房间PK.md"
tags: ["prd", "房间"]
sources: [raw/prd/房间/2025-10-v2.25.0-跨房间PK.md]
---
# Body
"""
        fm = parser.extract_frontmatter(text)
        self.assertEqual(fm["title"], "跨房间 PK")
        self.assertEqual(fm["source_type"], "prd")
        self.assertEqual(fm["tags"], ["prd", "房间"])
        self.assertEqual(fm["sources"], ["raw/prd/房间/2025-10-v2.25.0-跨房间PK.md"])

    def test_markdown_links_ignore_images_and_keep_external_links(self):
        text = """
[房间](concepts/房间.md)
[Raw](../raw/prd/房间/a.md#section)
[External](https://example.com/doc)
![Image](images/a.png)
"""
        links = parser.extract_markdown_links(text)
        self.assertEqual([link["label"] for link in links["internal"]], ["房间", "Raw"])
        self.assertEqual(links["internal"][1]["fragment"], "section")
        self.assertEqual(links["external"], ["https://example.com/doc"])

    def test_profile_auto_detects_prd_wiki_signals(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "wiki" / "testcases").mkdir(parents=True)
            (root / "wiki" / "index.md").write_text("# Index\n", encoding="utf-8")
            (root / "wiki" / "testcases" / "case.md").write_text("# Case\n", encoding="utf-8")
            detection = parser.detect_format(root)
            self.assertEqual(detection["profile"], "prd-wiki")


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run helper tests and verify they fail**

Run:

```bash
cd /Users/earthchen/.understand-anything/repo
python3 -m unittest understand-anything-plugin/skills/understand-knowledge/tests/test_prd_wiki_parser.py -v
```

Expected: FAIL because `extract_markdown_links` and profile metadata do not exist yet.

- [ ] **Step 3: Add profile constants and frontmatter parser**

In `parse-knowledge-base.py`, add after the regex constants:

```python
MARKDOWN_LINK_RE = re.compile(r"(?<!!)\[([^\]]+)\]\(([^)]+)\)")
PROFILE_GENERIC = "generic"
PROFILE_PRD_WIKI = "prd-wiki"
PROFILE_AUTO = "auto"
```

Replace `extract_frontmatter` with:

```python
def _parse_inline_array(value: str) -> list[str]:
    inner = value.strip()[1:-1].strip()
    if not inner:
        return []
    parts = []
    current = []
    quote = None
    for ch in inner:
        if ch in ("'", '"'):
            if quote == ch:
                quote = None
            elif quote is None:
                quote = ch
            current.append(ch)
        elif ch == "," and quote is None:
            raw = "".join(current).strip().strip('"').strip("'")
            if raw:
                parts.append(raw)
            current = []
        else:
            current.append(ch)
    raw = "".join(current).strip().strip('"').strip("'")
    if raw:
        parts.append(raw)
    return parts


def extract_frontmatter(text: str) -> dict:
    """Extract YAML-ish frontmatter without requiring PyYAML."""
    m = FRONTMATTER_RE.match(text)
    if not m:
        return {}
    fm = {}
    for line in m.group(1).split("\n"):
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or ":" not in stripped:
            continue
        key, _, val = stripped.partition(":")
        raw = val.strip()
        if raw.startswith("[") and raw.endswith("]"):
            fm[key.strip()] = _parse_inline_array(raw)
        else:
            fm[key.strip()] = raw.strip('"').strip("'")
    return fm
```

- [ ] **Step 4: Add Markdown link extraction and profile detection**

Add these functions near the existing link helpers:

```python
def extract_markdown_links(text: str) -> dict:
    """Extract standard Markdown links, excluding image links."""
    internal = []
    external = []
    for m in MARKDOWN_LINK_RE.finditer(text):
        label = m.group(1).strip()
        target_raw = m.group(2).strip()
        if target_raw.startswith(("http://", "https://")):
            external.append(target_raw)
            continue
        target, fragment = split_link_fragment(target_raw)
        internal.append({
            "label": label,
            "target": target,
            "fragment": fragment,
        })
    return {"internal": internal, "external": external}


def split_link_fragment(target: str) -> tuple[str, str | None]:
    if "#" not in target:
        return target, None
    path_part, _, fragment = target.partition("#")
    return path_part, fragment or None


def detect_profile(root: Path, wiki_root: Path) -> str:
    if (root / "raw" / "prd").is_dir():
        return PROFILE_PRD_WIKI
    if (root / "raw" / "testcase").is_dir():
        return PROFILE_PRD_WIKI
    if (wiki_root / "testcases").is_dir():
        return PROFILE_PRD_WIKI
    for schema_name in ("CLAUDE.md", "AGENTS.md"):
        schema_path = root / schema_name
        if schema_path.is_file():
            text = schema_path.read_text(encoding="utf-8", errors="replace").lower()
            if "prd" in text or "testcase" in text or "测试用例" in text:
                return PROFILE_PRD_WIKI
    for md_file in wiki_root.rglob("*.md"):
        text = md_file.read_text(encoding="utf-8", errors="replace")
        fm = extract_frontmatter(text)
        if fm.get("source_type") == "prd":
            return PROFILE_PRD_WIKI
    return PROFILE_GENERIC
```

In `detect_format`, after `signals["wiki_root"] = str(wiki_root)`, add:

```python
    signals["profile"] = detect_profile(root, wiki_root)
```

- [ ] **Step 5: Run helper tests**

Run:

```bash
cd /Users/earthchen/.understand-anything/repo
python3 -m unittest understand-anything-plugin/skills/understand-knowledge/tests/test_prd_wiki_parser.py -v
```

Expected: PASS for the three helper tests.

- [ ] **Step 6: Commit Task 2**

```bash
git add understand-anything-plugin/skills/understand-knowledge/parse-knowledge-base.py \
  understand-anything-plugin/skills/understand-knowledge/tests/test_prd_wiki_parser.py
git commit -m "feat: add PRD wiki profile parser helpers"
```

---

### Task 3: PRD Wiki Fixture and Deterministic Graph Scan

**Files:**
- Modify: `understand-anything-plugin/skills/understand-knowledge/parse-knowledge-base.py`
- Modify: `understand-anything-plugin/skills/understand-knowledge/tests/test_prd_wiki_parser.py`
- Create fixture files under `understand-anything-plugin/skills/understand-knowledge/tests/fixtures/prd-wiki/`
- Create fixture files under `understand-anything-plugin/skills/understand-knowledge/tests/fixtures/generic-wiki/`

- [ ] **Step 1: Create PRD wiki fixture files**

Create `understand-anything-plugin/skills/understand-knowledge/tests/fixtures/prd-wiki/CLAUDE.md`:

```markdown
# Amar PRD Knowledge Base

This wiki covers PRD and testcase material.
```

Create `understand-anything-plugin/skills/understand-knowledge/tests/fixtures/prd-wiki/wiki/index.md`:

```markdown
# Index — Amar PRD

## Concepts

- [房间](concepts/房间.md)

## Summaries

- [跨房间 PK](summaries/房间-2025-10-v2.25.0-跨房间PK.md)

## Test Cases

- [PK优化 测试用例](testcases/房间-PK优化.md)
```

Create `understand-anything-plugin/skills/understand-knowledge/tests/fixtures/prd-wiki/wiki/concepts/房间.md`:

```markdown
---
title: 房间
type: concept
tags: ["房间"]
---

# 房间

房间业务域包含 [跨房间 PK](../summaries/房间-2025-10-v2.25.0-跨房间PK.md)。
```

Create `understand-anything-plugin/skills/understand-knowledge/tests/fixtures/prd-wiki/wiki/summaries/房间-2025-10-v2.25.0-跨房间PK.md`:

```markdown
---
title: 跨房间 PK
type: summary
source_type: prd
source_path: "raw/prd/房间/2025-10-v2.25.0-跨房间PK.md"
filename_business: "房间"
filename_month: "2025-10"
filename_version: "v2.25.0"
filename_detail: "跨房间PK"
tags: ["prd", "房间"]
---

# 跨房间 PK

PRD 要求支持跨房 PK 发起、邀请、进行中状态。

## Concepts introduced / referenced

- [房间](../concepts/房间.md)
- [PK优化 测试用例](../testcases/房间-PK优化.md)

## Source map

- Raw path: [raw/prd/房间/2025-10-v2.25.0-跨房间PK.md](../../raw/prd/房间/2025-10-v2.25.0-跨房间PK.md)
```

Create `understand-anything-plugin/skills/understand-knowledge/tests/fixtures/prd-wiki/wiki/testcases/房间-PK优化.md`:

```markdown
---
title: PK优化 测试用例
type: testcase
source_type: testcase
source_path: "raw/testcase/房间/PK优化.md"
tags: ["testcase", "房间"]
---

# PK优化 测试用例

覆盖 [跨房间 PK](../summaries/房间-2025-10-v2.25.0-跨房间PK.md) 的回归范围。

Source: [raw/testcase/房间/PK优化.md](../../raw/testcase/房间/PK优化.md)
```

Create raw files:

```markdown
# 跨房间 PK 原始 PRD

房主、管理员、在麦主持人可以开启跨房 PK。
```

at `understand-anything-plugin/skills/understand-knowledge/tests/fixtures/prd-wiki/raw/prd/房间/2025-10-v2.25.0-跨房间PK.md`.

```markdown
# PK优化 原始测试用例

验证跨房 PK 发起、邀请、结束流程。
```

at `understand-anything-plugin/skills/understand-knowledge/tests/fixtures/prd-wiki/raw/testcase/房间/PK优化.md`.

- [ ] **Step 2: Create generic wiki fixture**

Create `understand-anything-plugin/skills/understand-knowledge/tests/fixtures/generic-wiki/wiki/index.md`:

```markdown
# Generic Wiki

## Concepts

- [[Topic]]
```

Create `understand-anything-plugin/skills/understand-knowledge/tests/fixtures/generic-wiki/wiki/concepts/Topic.md`:

```markdown
# Topic

This is a generic wiki page.
```

- [ ] **Step 3: Add fixture integration tests**

Append to `test_prd_wiki_parser.py`:

```python
class ParseWikiFixtureTests(unittest.TestCase):
    def setUp(self):
        self.fixtures = Path(__file__).resolve().parent / "fixtures"

    def test_prd_wiki_scan_emits_requirement_testcase_sources_and_edges(self):
        manifest = parser.parse_wiki(self.fixtures / "prd-wiki")
        self.assertEqual(manifest["profile"], "prd-wiki")

        nodes = {node["id"]: node for node in manifest["nodes"]}
        edges = {(edge["source"], edge["target"], edge["type"]) for edge in manifest["edges"]}

        requirement_id = "requirement:summaries/房间-2025-10-v2.25.0-跨房间PK"
        testcase_id = "testcase:testcases/房间-PK优化"
        raw_prd_id = "source:prd/房间/2025-10-v2.25.0-跨房间PK"
        raw_testcase_id = "source:testcase/房间/PK优化"

        self.assertIn(requirement_id, nodes)
        self.assertIn(testcase_id, nodes)
        self.assertIn(raw_prd_id, nodes)
        self.assertIn(raw_testcase_id, nodes)
        self.assertEqual(nodes[requirement_id]["type"], "requirement")
        self.assertEqual(nodes[testcase_id]["type"], "testcase")
        self.assertEqual(nodes[requirement_id]["knowledgeMeta"]["business"], "房间")
        self.assertEqual(nodes[requirement_id]["knowledgeMeta"]["version"], "v2.25.0")
        self.assertIn((requirement_id, raw_prd_id, "cites"), edges)
        self.assertIn((testcase_id, raw_testcase_id, "cites"), edges)
        self.assertIn((requirement_id, testcase_id, "tested_by"), edges)

    def test_generic_wiki_does_not_emit_prd_node_types(self):
        manifest = parser.parse_wiki(self.fixtures / "generic-wiki")
        self.assertEqual(manifest["profile"], "generic")
        node_types = {node["type"] for node in manifest["nodes"]}
        self.assertIn("article", node_types)
        self.assertNotIn("requirement", node_types)
        self.assertNotIn("testcase", node_types)
```

- [ ] **Step 4: Run fixture tests and verify they fail**

Run:

```bash
cd /Users/earthchen/.understand-anything/repo
python3 -m unittest understand-anything-plugin/skills/understand-knowledge/tests/test_prd_wiki_parser.py -v
```

Expected: FAIL because `parse_wiki` does not yet emit `profile`, `requirement`, `testcase`, Markdown-link edges, raw citations, or `tested_by`.

- [ ] **Step 5: Implement source ID helpers and node type mapping**

In `parse-knowledge-base.py`, add helpers before `parse_wiki`:

```python
def make_article_like_id(stem: str, frontmatter: dict, rel: Path, profile: str) -> tuple[str, str, str]:
    if profile == PROFILE_PRD_WIKI:
        source_type = frontmatter.get("source_type")
        page_type = frontmatter.get("type")
        rel_posix = rel.as_posix()
        if source_type == "prd" or (rel_posix.startswith("summaries/") and page_type == "summary"):
            return f"requirement:{stem}", "requirement", "prd_summary"
        if source_type == "testcase" or page_type == "testcase" or rel_posix.startswith("testcases/"):
            return f"testcase:{stem}", "testcase", "testcase_summary"
        if rel_posix.startswith("entities/"):
            return f"article:{stem}", "article", "entity_page"
        if rel_posix.startswith("concepts/"):
            return f"article:{stem}", "article", "concept"
    return f"article:{stem}", "article", "article"


def make_source_id(raw_root: Path, raw_file: Path) -> str:
    return f"source:{raw_file.relative_to(raw_root).with_suffix('').as_posix()}"


def source_subtype_for_raw(raw_root: Path, raw_file: Path) -> str:
    rel = raw_file.relative_to(raw_root).as_posix()
    if rel.startswith("prd/"):
        return "raw_prd"
    if rel.startswith("testcase/"):
        return "raw_testcase"
    return "raw"
```

In `parse_wiki`, set:

```python
    profile = detection.get("profile", PROFILE_GENERIC)
```

Build `article_ids` by calling `make_article_like_id(...)` for each content page instead of assuming `article:{stem}`.

When creating a wiki page node, use:

```python
        node_id, node_type, subtype = make_article_like_id(stem, frontmatter, rel, profile)
```

and set:

```python
            "type": node_type,
```

Set `knowledgeMeta` to include:

```python
                "profile": profile,
                "subtype": subtype,
                "wikilinks": [wl["target"] for wl in wikilinks],
                "markdownLinks": [],
                "externalLinks": markdown_links["external"],
                **({"sourceType": frontmatter.get("source_type")} if frontmatter.get("source_type") else {}),
                **({"sourcePath": frontmatter.get("source_path")} if frontmatter.get("source_path") else {}),
                **({"business": frontmatter.get("filename_business")} if frontmatter.get("filename_business") else {}),
                **({"month": frontmatter.get("filename_month")} if frontmatter.get("filename_month") else {}),
                **({"version": frontmatter.get("filename_version")} if frontmatter.get("filename_version") else {}),
                **({"detail": frontmatter.get("filename_detail")} if frontmatter.get("filename_detail") else {}),
```

Also include `profile` in the returned manifest:

```python
        "profile": profile,
```

- [ ] **Step 6: Implement Markdown link resolution and citation edges**

Add helper:

```python
def resolve_markdown_target(current_rel: Path, target: str, wiki_root: Path, root: Path, name_map: dict[str, str], node_ids: set[str]) -> str | None:
    if not target.endswith(".md"):
        return None
    base_dir = wiki_root / current_rel.parent
    abs_target = (base_dir / target).resolve()
    try:
        wiki_target = abs_target.relative_to(wiki_root.resolve())
        stem = wiki_target.with_suffix("").as_posix()
        for prefix in ("requirement", "testcase", "article"):
            candidate = f"{prefix}:{stem}"
            if candidate in node_ids:
                return candidate
    except ValueError:
        pass
    raw_root = root / "raw"
    try:
        raw_target = abs_target.relative_to(raw_root.resolve())
        candidate = f"source:{raw_target.with_suffix('').as_posix()}"
        if candidate in node_ids:
            return candidate
    except ValueError:
        pass
    return resolve_wikilink(Path(target).with_suffix("").as_posix(), name_map, node_ids)
```

In the page loop, compute:

```python
        markdown_links = extract_markdown_links(text)
```

After wikilink edge generation, add:

```python
        for ml in markdown_links["internal"]:
            target_id = resolve_markdown_target(rel, ml["target"], wiki_root, root, name_map, article_ids)
            link_meta = {**ml, "resolvedId": target_id}
            nodes[-1]["knowledgeMeta"]["markdownLinks"].append(link_meta)
            if not target_id or target_id == node_id:
                if not target_id:
                    warnings.append(f"Unresolved markdown link: [{ml['label']}]({ml['target']}) in {rel}")
                    stats["unresolved"] += 1
                continue
            edge_type = "cites" if target_id.startswith("source:") else "related"
            edges.append({
                "source": node_id,
                "target": target_id,
                "type": edge_type,
                "direction": "forward",
                "weight": 0.8 if edge_type == "cites" else 0.7,
            })
```

Before the page loop, build source IDs first so Markdown raw links can resolve:

```python
    source_nodes = []
    source_ids: set[str] = set()
    if raw_root.is_dir():
        for raw_file in sorted(raw_root.rglob("*")):
            if raw_file.is_file() and not raw_file.name.startswith("."):
                rel_raw = raw_file.relative_to(root)
                ext = raw_file.suffix.lower()
                size_kb = raw_file.stat().st_size / 1024
                source_id = make_source_id(raw_root, raw_file)
                source_ids.add(source_id)
                source_nodes.append({
                    "id": source_id,
                    "type": "source",
                    "name": raw_file.name,
                    "filePath": str(rel_raw),
                    "summary": f"Raw source ({ext or 'unknown'}, {size_kb:.0f} KB)",
                    "tags": ["raw", ext.lstrip(".") or "unknown"],
                    "complexity": "simple",
                    "knowledgeMeta": {
                        "profile": profile,
                        "subtype": source_subtype_for_raw(raw_root, raw_file),
                        "sourceSubtype": source_subtype_for_raw(raw_root, raw_file),
                    },
                })
```

Then include `source_ids` in `article_ids`:

```python
    node_ids_for_resolution = set(article_ids) | source_ids
```

Use `node_ids_for_resolution` for Markdown resolution.

At the end of raw source handling, append `source_nodes` instead of rebuilding raw nodes:

```python
    nodes.extend(source_nodes)
    stats["sources"] = len(source_nodes)
```

- [ ] **Step 7: Implement source_path cites and tested_by edges**

Add helper:

```python
def source_id_from_source_path(raw_root: Path, source_path: str) -> str:
    raw_prefix = "raw/"
    normalized = source_path.replace("\\", "/")
    if normalized.startswith(raw_prefix):
        normalized = normalized[len(raw_prefix):]
    return f"source:{Path(normalized).with_suffix('').as_posix()}"


def normalize_match_text(value: str) -> str:
    return re.sub(r"[\s_\-（）()【】\\[\\]、，,。.:：]+", "", value.lower())
```

In the page loop after node creation:

```python
        source_path = frontmatter.get("source_path")
        if isinstance(source_path, str) and source_path:
            source_id = source_id_from_source_path(raw_root, source_path)
            if source_id in source_ids:
                edges.append({
                    "source": node_id,
                    "target": source_id,
                    "type": "cites",
                    "direction": "forward",
                    "weight": 0.95,
                })
            elif node_type in ("requirement", "testcase"):
                warnings.append(f"Missing raw source for source_path {source_path} in {rel}")
```

After all page nodes and related/cites edges are built, add conservative `tested_by` edges:

```python
    requirements = [n for n in nodes if n.get("type") == "requirement"]
    testcases = [n for n in nodes if n.get("type") == "testcase"]
    existing_edge_keys = {(e["source"], e["target"], e["type"]) for e in edges}
    for req in requirements:
        req_meta = req.get("knowledgeMeta", {})
        req_business = req_meta.get("business", "")
        req_detail = normalize_match_text(str(req_meta.get("detail", req.get("name", ""))))
        for tc in testcases:
            tc_meta = tc.get("knowledgeMeta", {})
            tc_business = tc_meta.get("business", "") or (tc.get("tags") or [""])[0]
            linked = (req["id"], tc["id"], "related") in existing_edge_keys or (tc["id"], req["id"], "related") in existing_edge_keys
            same_business = bool(req_business and tc_business and req_business == tc_business)
            name_match = req_detail and req_detail in normalize_match_text(str(tc.get("name", "")))
            if linked or (same_business and name_match):
                key = (req["id"], tc["id"], "tested_by")
                if key not in existing_edge_keys:
                    edges.append({
                        "source": req["id"],
                        "target": tc["id"],
                        "type": "tested_by",
                        "direction": "forward",
                        "weight": 0.9 if linked else 0.75,
                    })
                    existing_edge_keys.add(key)
```

- [ ] **Step 8: Run parser tests**

Run:

```bash
cd /Users/earthchen/.understand-anything/repo
python3 -m unittest understand-anything-plugin/skills/understand-knowledge/tests/test_prd_wiki_parser.py -v
```

Expected: PASS.

- [ ] **Step 9: Commit Task 3**

```bash
git add understand-anything-plugin/skills/understand-knowledge/parse-knowledge-base.py \
  understand-anything-plugin/skills/understand-knowledge/tests/test_prd_wiki_parser.py \
  understand-anything-plugin/skills/understand-knowledge/tests/fixtures
git commit -m "feat: parse PRD wiki requirements and testcases"
```

---

### Task 4: Merge Support and Skill Documentation

**Files:**
- Modify: `understand-anything-plugin/skills/understand-knowledge/merge-knowledge-graph.py`
- Modify: `understand-anything-plugin/skills/understand-knowledge/SKILL.md`
- Modify: `understand-anything-plugin/skills/understand-knowledge/tests/test_prd_wiki_parser.py`

- [ ] **Step 1: Add merge integration test**

Append this test to `test_prd_wiki_parser.py`:

```python
class MergeFixtureTests(unittest.TestCase):
    def setUp(self):
        self.fixture = Path(__file__).resolve().parent / "fixtures" / "prd-wiki"
        merge_script = Path(__file__).resolve().parents[1] / "merge-knowledge-graph.py"
        merge_spec = importlib.util.spec_from_file_location("merge_knowledge_graph", merge_script)
        self.merge_module = importlib.util.module_from_spec(merge_spec)
        assert merge_spec.loader is not None
        merge_spec.loader.exec_module(self.merge_module)

    def test_merge_preserves_requirement_testcase_nodes(self):
        with tempfile.TemporaryDirectory() as tmp:
            work = Path(tmp) / "prd-wiki"
            shutil.copytree(self.fixture, work)
            parser.parse_wiki(work)
            graph = self.merge_module.merge(work)
            node_types = {node["type"] for node in graph["nodes"]}
            self.assertIn("requirement", node_types)
            self.assertIn("testcase", node_types)
            self.assertIn("prd-wiki", graph["project"]["frameworks"])
            self.assertEqual(graph["kind"], "knowledge")
```

- [ ] **Step 2: Run merge test and verify it fails**

Run:

```bash
cd /Users/earthchen/.understand-anything/repo
python3 -m unittest understand-anything-plugin/skills/understand-knowledge/tests/test_prd_wiki_parser.py -v
```

Expected: FAIL because `merge-knowledge-graph.py` does not yet accept `requirement` and `testcase`.

- [ ] **Step 3: Update merge valid node types and aliases**

In `merge-knowledge-graph.py`, extend `VALID_NODE_TYPES`:

```python
VALID_NODE_TYPES = {
    "article", "entity", "topic", "claim", "source", "requirement", "testcase",
    # Codebase types (for cross-compatibility)
    "file", "function", "class", "module", "concept",
    "config", "document", "service", "table", "endpoint",
    "pipeline", "schema", "resource", "domain", "flow", "step",
}
```

Extend `NODE_TYPE_ALIASES`:

```python
    "req": "requirement", "prd": "requirement", "requirement_summary": "requirement",
    "test_case": "testcase", "qa_case": "testcase",
```

When loading `manifest`, read:

```python
    profile = manifest.get("profile", "generic")
```

When assembling `graph["project"]["frameworks"]`, set:

```python
            "frameworks": ["karpathy-wiki"] + ([profile] if profile != "generic" else []),
```

Keep all existing fields unchanged.

- [ ] **Step 4: Update SKILL.md options and output description**

In `understand-knowledge/SKILL.md`, add to Options:

```markdown
  - `--profile auto|generic|prd-wiki` — Select the parser profile. `auto` is the default. `prd-wiki` preserves PRD/testcase provenance and emits `requirement` / `testcase` nodes.
```

In Phase 1, after the parse script instruction, add:

```markdown
   - The scan manifest includes `profile`. Report it as: "Profile: generic" or "Profile: prd-wiki".
```

In "What It Detects", add:

```markdown
- **PRD wiki profile** — LLM wiki repositories with `raw/prd/`, `raw/testcase/`, PRD summaries, testcase pages, standard Markdown links, and frontmatter provenance.
```

In Phase 5 report summary, add:

```markdown
   - "Profile: <profile>"
   - "Requirements: N, testcases: N, raw PRD sources: N, raw testcase sources: N" when `profile=prd-wiki`
```

- [ ] **Step 5: Run merge and parser tests**

Run:

```bash
cd /Users/earthchen/.understand-anything/repo
python3 -m unittest understand-anything-plugin/skills/understand-knowledge/tests/test_prd_wiki_parser.py -v
```

Expected: PASS.

- [ ] **Step 6: Commit Task 4**

```bash
git add understand-anything-plugin/skills/understand-knowledge/merge-knowledge-graph.py \
  understand-anything-plugin/skills/understand-knowledge/SKILL.md \
  understand-anything-plugin/skills/understand-knowledge/tests/test_prd_wiki_parser.py
git commit -m "feat: merge PRD wiki knowledge graphs"
```

---

### Task 5: End-to-End Validation Against Fixture and Amar PRD

**Files:**
- Modify only if validation reveals a defect in earlier task files.

- [ ] **Step 1: Run TypeScript focused tests**

Run:

```bash
cd /Users/earthchen/.understand-anything/repo
pnpm vitest run understand-anything-plugin/packages/core/src/__tests__/schema.test.ts understand-anything-plugin/packages/core/src/types.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run Python parser tests**

Run:

```bash
cd /Users/earthchen/.understand-anything/repo
python3 -m unittest understand-anything-plugin/skills/understand-knowledge/tests/test_prd_wiki_parser.py -v
```

Expected: PASS.

- [ ] **Step 3: Run parser on the PRD fixture**

Run:

```bash
cd /Users/earthchen/.understand-anything/repo
python3 understand-anything-plugin/skills/understand-knowledge/parse-knowledge-base.py understand-anything-plugin/skills/understand-knowledge/tests/fixtures/prd-wiki
python3 understand-anything-plugin/skills/understand-knowledge/merge-knowledge-graph.py understand-anything-plugin/skills/understand-knowledge/tests/fixtures/prd-wiki
node understand-anything-plugin/skills/understand/validate-artifact.mjs understand-anything-plugin/skills/understand-knowledge/tests/fixtures/prd-wiki/.understand-anything/intermediate/assembled-graph.json knowledge-graph:complete
```

Expected:

- parse output reports `profile prd-wiki` or manifest contains `"profile": "prd-wiki"`.
- merge output includes requirement/testcase nodes.
- validation exits 0.

- [ ] **Step 4: Run parser on real `amar-prd` without LLM analysis**

Run:

```bash
cd /Users/earthchen/.understand-anything/repo
python3 understand-anything-plugin/skills/understand-knowledge/parse-knowledge-base.py /Users/earthchen/ai-work/kb-test/amar-prd
python3 understand-anything-plugin/skills/understand-knowledge/merge-knowledge-graph.py /Users/earthchen/ai-work/kb-test/amar-prd
node understand-anything-plugin/skills/understand/validate-artifact.mjs /Users/earthchen/ai-work/kb-test/amar-prd/.understand-anything/intermediate/assembled-graph.json knowledge-graph:complete
```

Expected:

- `amar-prd/.understand-anything/intermediate/scan-manifest.json` exists.
- `amar-prd/.understand-anything/intermediate/assembled-graph.json` exists.
- validation exits 0.
- Node counts are plausible: roughly 186 requirements, 205 testcases, and 391 sources. Exact counts may vary if the wiki has changed.

- [ ] **Step 5: Inspect graph counts**

Run:

```bash
cd /Users/earthchen/.understand-anything/repo
node -e "const fs=require('fs'); const g=JSON.parse(fs.readFileSync('/Users/earthchen/ai-work/kb-test/amar-prd/.understand-anything/intermediate/assembled-graph.json','utf8')); const c={}; for (const n of g.nodes) c[n.type]=(c[n.type]||0)+1; const e={}; for (const edge of g.edges) e[edge.type]=(e[edge.type]||0)+1; console.log({frameworks:g.project.frameworks, nodes:c, edges:e, layers:g.layers.length, tour:g.tour.length});"
```

Expected: output includes `frameworks` containing `prd-wiki`, nonzero `requirement`, `testcase`, `source`, `cites`, `related`, and `categorized_under` counts.

- [ ] **Step 6: Clean generated fixture artifacts before commit**

Run:

```bash
cd /Users/earthchen/.understand-anything/repo
rm -rf understand-anything-plugin/skills/understand-knowledge/tests/fixtures/prd-wiki/.understand-anything
```

Expected: fixture `.understand-anything` artifacts removed from the worktree.

- [ ] **Step 7: Commit any validation fixes**

If Step 1-6 required code changes:

```bash
git add understand-anything-plugin/packages/core/src \
  understand-anything-plugin/packages/dashboard/src \
  understand-anything-plugin/skills/understand-knowledge
git commit -m "test: validate PRD wiki knowledge graph generation"
```

If no code changes were needed, do not create an empty commit.

---

### Task 6: Final Verification and Handoff

**Files:**
- No planned file edits.

- [ ] **Step 1: Run combined focused verification**

Run:

```bash
cd /Users/earthchen/.understand-anything/repo
pnpm vitest run understand-anything-plugin/packages/core/src/__tests__/schema.test.ts understand-anything-plugin/packages/core/src/types.test.ts
python3 -m unittest understand-anything-plugin/skills/understand-knowledge/tests/test_prd_wiki_parser.py -v
```

Expected: all tests PASS.

- [ ] **Step 2: Check git status**

Run:

```bash
cd /Users/earthchen/.understand-anything/repo
git status --short
```

Expected: only intentional changes are present. Do not stage unrelated pre-existing changes.

- [ ] **Step 3: Summarize implementation result**

Report:

- schema changes made
- parser profile behavior
- PRD fixture coverage
- real `amar-prd` validation result
- any warnings from real `amar-prd` parsing
- dashboard/query/system graph TODOs remain out of scope and are documented in the design spec

