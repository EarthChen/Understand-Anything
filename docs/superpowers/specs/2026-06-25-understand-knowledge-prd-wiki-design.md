# Understand Knowledge PRD Wiki Profile Design

**Goal:** Extend `/understand-knowledge` so it continues to support generic LLM/Karpathy-style wikis while adding a first-class PRD/testcase wiki profile for repositories such as `amar-prd`.

**Primary target:** `amar-prd`, an LLM wiki containing Amar PRDs and QA test cases.

**Implementation repository:** `/Users/earthchen/.understand-anything/repo`

---

## Problem

`amar-prd` is already a compiled LLM wiki:

- `raw/prd/` contains immutable PRD source documents.
- `raw/testcase/` contains immutable testcase source documents.
- `wiki/concepts/` contains business-domain concept pages.
- `wiki/summaries/` contains PRD summary pages.
- `wiki/testcases/` contains testcase summary pages.
- `wiki/index.md` is the canonical catalog.
- `CLAUDE.md` defines provenance and evidence rules.

The existing `/understand-knowledge` skill can detect Karpathy-style markdown wikis, but its deterministic parser is optimized around Obsidian-style `[[wikilink]]` references. `amar-prd` deliberately uses standard Markdown links and frontmatter provenance. Running the existing parser as-is would produce a graph, but it would lose important edges:

1. Markdown links such as `[房间](concepts/房间.md)` are not resolved into graph edges.
2. `wiki/index.md` category membership is mostly invisible because categories are derived only from wikilinks.
3. Frontmatter fields such as `source_type`, `source_path`, `filename_business`, `filename_month`, and `filename_version` are not preserved as structured metadata.
4. Raw PRD/testcase source nodes are generated, but summary/testcase pages are not deterministically connected back to them.
5. PRD summaries and testcase pages are flattened into generic `article` nodes, which makes later dashboard/query integration weaker.

---

## Goals

- Preserve generic `/understand-knowledge` behavior for non-PRD wikis.
- Add a `prd-wiki` profile that understands PRD/testcase LLM wiki conventions.
- Support both wikilinks and standard Markdown links.
- Preserve PRD/testcase provenance from frontmatter and raw paths.
- Generate first-class `requirement` and `testcase` nodes.
- Create deterministic citation and category edges before any LLM analysis runs.
- Produce a valid `knowledge-graph.json` for `amar-prd`.
- Record follow-up TODOs for dashboard, system graph, and `understand-query` integration.

## Non-Goals

- Do not create a separate `/understand-prd` skill.
- Do not rewrite or mutate `amar-prd` raw/wiki content.
- Do not implement dashboard UI changes in the first phase.
- Do not implement `understand-query` PRD commands in the first phase.
- Do not add broad new edge taxonomy until query/dashboard consumption proves the need.
- Do not treat testcase evidence as product-rule truth. Testcases prove QA coverage and regression scope, not current product validity.

---

## Recommended Approach

Add profile support to `/understand-knowledge`.

```bash
/understand-knowledge amar-prd
/understand-knowledge amar-prd --profile auto
/understand-knowledge amar-prd --profile prd-wiki
/understand-knowledge some-research-wiki --profile generic
```

`auto` remains the default. It chooses `prd-wiki` when PRD/testcase signals are present, otherwise it uses `generic`.

This is preferred over a new skill because `amar-prd` is still a valid LLM wiki. The PRD behavior is an adapter/profile over the same knowledge graph pipeline, not a separate product.

---

## Architecture

The skill keeps the existing five-phase pipeline:

```text
detect -> scan -> analyze -> merge -> save
```

Changes are concentrated in deterministic scan and merge:

- `SKILL.md`
  - Document `--profile auto|generic|prd-wiki`.
  - Report selected profile in progress output.
- `parse-knowledge-base.py`
  - Detect profiles.
  - Parse Markdown links.
  - Preserve frontmatter provenance.
  - Emit `requirement` and `testcase` nodes in `prd-wiki`.
  - Emit deterministic `cites`, `related`, `categorized_under`, and conservative `tested_by` edges.
- `merge-knowledge-graph.py`
  - Accept new node types.
  - Preserve profile-specific metadata.
  - Include profile and stats in final graph/meta.
- `packages/core/src/schema.ts` and `packages/core/src/types.ts`
  - Add `requirement` and `testcase` node types.
- Dashboard type lists
  - Add `requirement` and `testcase` as known node types so existing views do not reject them.

The profile should be implemented as a parsing strategy. It must not fork the full graph schema or duplicate the skill.

---

## Profile Detection

`--profile auto` uses deterministic signals:

| Signal | Selected profile |
|---|---|
| `raw/prd/` exists | `prd-wiki` |
| `raw/testcase/` exists | `prd-wiki` |
| `wiki/testcases/` exists | `prd-wiki` |
| Any frontmatter has `source_type: prd` | `prd-wiki` |
| `CLAUDE.md` or `AGENTS.md` declares PRD/testcase scope | `prd-wiki` |
| None of the above | `generic` |

If a user explicitly selects `--profile prd-wiki` but no PRD/testcase signal exists, the command should warn but continue. This lets users test partially migrated wikis.

---

## Schema Extension

Add two node types:

```ts
"requirement" | "testcase"
```

Semantics:

| Type | Meaning | Example |
|---|---|---|
| `requirement` | A product requirement derived from a PRD summary page | `wiki/summaries/房间-2025-10-v2.25.0-跨房间PK.md` |
| `testcase` | A QA coverage artifact derived from a testcase wiki page | `wiki/testcases/房间-PK优化.md` |

Keep existing knowledge node types:

- `article` for concept pages, index-like pages, and general wiki content.
- `source` for immutable `raw/` source files.
- `topic` for index categories.
- `entity` and `claim` for LLM-inferred additions.

### Edge Types

Do not add new edge types in phase one. Reuse existing types:

| Edge | Meaning |
|---|---|
| `requirement -> source` / `cites` | PRD summary cites raw PRD |
| `testcase -> source` / `cites` | Testcase page cites raw testcase |
| `requirement -> article` / `related` | Requirement references a business concept/entity |
| `testcase -> article` / `related` | Testcase references a business concept/entity |
| `requirement -> topic` / `categorized_under` | Requirement belongs to an index/category topic |
| `testcase -> topic` / `categorized_under` | Testcase belongs to an index/category topic |
| `requirement -> testcase` / `tested_by` | Requirement has deterministic testcase coverage |
| `requirement(old) -> requirement(new)` / `builds_on` | Optional future version-chain relation |
| `requirement -> requirement` / `contradicts` | Optional future conflict relation |

The first phase should only generate `tested_by` when there is explicit or high-confidence deterministic evidence, such as direct Markdown links or same-business exact-title matching. Low-confidence candidates should be stored in metadata, not emitted as graph edges.

---

## Node Metadata

PRD/testcase-specific fields should live in `knowledgeMeta`:

```json
{
  "profile": "prd-wiki",
  "subtype": "prd_summary",
  "sourceType": "prd",
  "sourcePath": "raw/prd/房间/2025-10-v2.25.0-跨房间PK.md",
  "business": "房间",
  "month": "2025-10",
  "version": "v2.25.0",
  "detail": "跨房间PK",
  "markdownLinks": [
    {
      "label": "房间",
      "target": "../concepts/房间.md",
      "resolvedId": "article:concepts/房间",
      "fragment": null
    }
  ],
  "externalLinks": [
    "https://alidocs.dingtalk.com/..."
  ]
}
```

Recommended subtype values:

- `concept`
- `entity_page`
- `prd_summary`
- `testcase_summary`
- `raw_prd`
- `raw_testcase`
- `index`
- `query_output`

The graph should remain valid even if these fields are absent. Consumers must treat them as optional enhancement metadata.

---

## Markdown Link Parsing

The parser should support:

- Wikilinks: `[[房间]]`, `[[房间|房间域]]`
- Standard Markdown links: `[房间](concepts/房间.md)`
- Relative links: `../concepts/房间.md`
- Raw source links: `../../raw/prd/房间/a.md`
- Anchored links: `concepts/房间.md#PK`
- External links: `https://...`

Rules:

- Ignore image links: `![alt](x.png)`.
- External links do not create graph edges; store them in `knowledgeMeta.externalLinks`.
- Internal `.md` links create `related` edges when the target resolves to an article-like node.
- Raw source links create `cites` edges when the target resolves to a `source` node.
- Unresolved internal links are warnings, not fatal errors.

---

## Frontmatter Parsing

The parser should preserve at least these fields:

- `title`
- `type`
- `source_type`
- `source_path`
- `filename_business`
- `filename_month`
- `filename_version`
- `filename_detail`
- `date`
- `tags`
- `sources`

Python has no standard-library YAML parser. Use a conservative fallback parser that handles:

- plain scalar values
- quoted scalar values
- inline arrays such as `["prd", "房间"]`
- simple bare arrays such as `[raw/testcase]`

If PyYAML is available in the environment, it may be used opportunistically, but the skill should not require it.

Malformed frontmatter should produce a warning and continue with an empty frontmatter object.

---

## Node Mapping

### Generic Profile

| Input | Node type |
|---|---|
| wiki markdown page | `article` |
| raw file | `source` |
| index section | `topic` |

### PRD Wiki Profile

| Input | Node type |
|---|---|
| `wiki/summaries/*` with `source_type: prd` | `requirement` |
| `wiki/testcases/*` or `type: testcase` | `testcase` |
| `wiki/concepts/*` | `article` |
| `wiki/entities/*` | `article` in phase one |
| `raw/prd/*` | `source` with `sourceSubtype: raw_prd` |
| `raw/testcase/*` | `source` with `sourceSubtype: raw_testcase` |

`wiki/entities/*` should remain `article` in phase one. This avoids conflating entity pages with LLM-inferred entity nodes and keeps merge-time entity deduplication predictable.

---

## Deterministic Edges

The scan phase should emit deterministic edges before LLM analysis:

1. `related` from internal Markdown/wikilinks between wiki pages.
2. `cites` from frontmatter `source_path` to raw source nodes.
3. `cites` from Markdown links pointing into `raw/`.
4. `categorized_under` from `wiki/index.md` sections.
5. Conservative `tested_by` from requirement to testcase only when deterministically supported.

For `tested_by`, phase one should use safe matches:

- Direct requirement-to-testcase link.
- Direct testcase-to-requirement link.
- Same business domain plus exact or near-exact normalized detail/title match.

If confidence is lower, write candidates to `knowledgeMeta.testcaseCandidates` and do not create an edge.

---

## Error Handling

Local data quality issues should not block graph generation:

| Issue | Behavior |
|---|---|
| Unresolved internal link | Warning; no edge |
| External link | Store metadata; no warning |
| Malformed frontmatter | Warning; continue with empty frontmatter |
| `source_path` missing | Warning for requirement/testcase nodes |
| `source_path` points to missing raw file | Warning; keep node |
| Duplicate node ID | Add stable hash suffix; warning |
| Invalid edge endpoint | Drop in merge; increment dropped count |
| Unknown node type | Fail validation with actionable schema error |

`meta.json` should include:

```json
{
  "status": "complete",
  "profile": "prd-wiki",
  "warnings": 12,
  "stats": {
    "requirements": 186,
    "testcases": 205,
    "rawPrdSources": 186,
    "rawTestcaseSources": 205,
    "sourceCitations": 391
  }
}
```

If validation drops edges or loses important metadata, set `status: "degraded"` and explain why.

---

## Testing Strategy

### Unit Tests

Add deterministic parser tests for:

- profile auto detection
- Markdown link resolution
- wikilink compatibility
- external link handling
- image link ignore behavior
- frontmatter scalar and array parsing
- node type mapping
- raw source citation edges
- conservative `tested_by` generation

### Fixture Integration Test

Add a small PRD wiki fixture:

```text
fixtures/prd-wiki/
├── CLAUDE.md
├── raw/
│   ├── prd/房间/2025-10-v2.25.0-跨房间PK.md
│   └── testcase/房间/PK优化.md
└── wiki/
    ├── index.md
    ├── concepts/房间.md
    ├── summaries/房间-2025-10-v2.25.0-跨房间PK.md
    └── testcases/房间-PK优化.md
```

Expected output:

- 1 `requirement` node
- 1 `testcase` node
- 2 `source` nodes
- requirement -> raw PRD `cites`
- testcase -> raw testcase `cites`
- requirement -> testcase `tested_by`
- topic/layer membership for requirement and testcase
- valid graph schema

### Generic Regression Test

Existing generic wiki fixtures should remain valid:

- no PRD signals -> `generic`
- all pages remain `article`
- wikilink behavior unchanged
- no `requirement` or `testcase` nodes produced

---

## Amar PRD Acceptance Criteria

Running:

```bash
/understand-knowledge /Users/earthchen/ai-work/kb-test/amar-prd --profile prd-wiki --full
```

should produce:

- `amar-prd/.understand-anything/knowledge-graph.json`
- `amar-prd/.understand-anything/meta.json`
- graph `kind: "knowledge"`
- `project.frameworks` includes `karpathy-wiki` and `prd-wiki`
- approximately 186 `requirement` nodes
- approximately 205 `testcase` nodes
- approximately 391 raw `source` nodes
- source citation edges close to requirement + testcase count
- most wiki pages categorized into meaningful layers, not `Other`
- low unresolved internal Markdown link count
- schema validation passes

Dashboard should be able to open the generated graph and search terms such as:

- `跨房 PK`
- `充值风控`
- `测试用例`
- `房间`

---

## Query Impact

This work creates the data foundation for richer `understand-query` behavior.

Current query answers primarily use business/wiki/domain/KG/source layers. Adding PRD/testcase facts enables:

1. **Requirement lookup**
   - What did the PRD require?
   - Which version introduced this rule?
   - Which business domain owns it?

2. **Test coverage lookup**
   - Which testcases cover this requirement?
   - What regression scope should be considered?
   - Which requirements appear to lack testcase coverage?

3. **Requirement-to-implementation comparison**
   - PRD says X.
   - Source code implements Y.
   - Testcases cover Z.
   - Gaps and uncertainty are explicit.

4. **Better keyword discovery**
   - PRD titles, Chinese business terms, version names, and section headings provide search hints when code naming differs.

Future query answers should clearly separate fact sources:

- product intent: `requirement` and raw PRD
- QA coverage: `testcase` and raw testcase
- implementation fact: source code
- navigation/context: business/wiki/domain summaries

---

## Future Integration TODOs

These are intentionally out of scope for the first implementation.

### System Graph

- Add a `product` or `knowledge` facet.
- Register `amar-prd` in root `system-graph.json`.
- Add readiness flags for `hasRequirementGraph` or rely on `hasKg` plus project framework `prd-wiki`.

### Dashboard

- Add visual labels/icons for `requirement` and `testcase`.
- Add node filters for PRD/testcase types.
- Show PRD metadata fields in the node detail panel.
- Show source citation links prominently.
- Add a Requirements or Product Knowledge view after the graph data model stabilizes.
- Include PRD/testcase hits in unified search result labels.

### Understand Query

- Add `prd` or `requirements` subcommand:
  - `prd --search`
  - `prd --domain`
  - `prd --testcases`
  - `prd --timeline`
  - `prd --source`
- Add optional `ask --with-prd`.
- Teach answers to report product intent, QA coverage, and implementation fact separately.
- Use requirement/testcase terms as query expansion hints for KG/source search.

### Possible Future Edge Types

Only add these after dashboard/query consumption proves they are needed:

- `covers`
- `supersedes`
- `implements_requirement`

For phase one, reuse `tested_by`, `builds_on`, `related`, and `cites`.

---

## Open Questions Resolved

- **Should this be a new skill?** No. Use `/understand-knowledge` with profiles.
- **Should PRD/testcase be first-class schema types?** Yes. Add `requirement` and `testcase`.
- **Should dashboard/query be implemented now?** No. Record TODOs and first make the knowledge graph reliable.
- **Should raw PRD/testcase be treated as facts?** Yes, with distinct meanings: PRD is product intent, testcase is QA coverage, code remains implementation truth.

