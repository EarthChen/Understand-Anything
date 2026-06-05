# Cross-Repo Graph Linking Implementation Plan

> **Spec:** `docs/superpowers/specs/2026-06-05-cross-repo-graph-linking-design.md`
> **Author:** AI Agent
> **Date:** 2026-06-05

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `understand-anything-plugin/skills/understand-wiki/build-system-graph.py` | Modify | Add system.json support + glob filtering |
| `understand-anything-plugin/skills/understand/merge-batch-graphs.py` | Modify | Add manifest.json generation at end of main() |
| `understand-anything-plugin/packages/dashboard/src/components/SystemOverview.tsx` | Modify | Display system name from config |
| `tests/skill/understand-wiki/test_build_system_graph.py` | Modify | Add system.json filtering tests |
| `tests/skill/understand/test_merge_batch_graphs.py` | Modify | Add manifest generation tests |

---

## Task 1: system.json support in build-system-graph.py (TDD)

### Step 1.1 — Write failing tests

**File:** `tests/skill/understand-wiki/test_build_system_graph.py`

Add to existing test class:

```python
def test_system_json_exclude_glob(self):
    """Services matching exclude glob patterns are filtered out."""
    # Create 3 services: order-service, payment-service, deprecated-auth
    # Create system.json with exclude: ["deprecated-*"]
    # Verify only order-service and payment-service appear in graph

def test_system_json_include_whitelist(self):
    """When include is non-empty, only listed services are included."""
    # Create 3 services
    # Create system.json with include: ["order-service"]
    # Verify only order-service appears

def test_no_system_json_backward_compat(self):
    """Missing system.json = all services included (existing behavior)."""
    # Create 3 services, no system.json
    # Verify all 3 appear

def test_system_name_in_graph(self):
    """system.json name appears in output graph metadata."""
    # Create system.json with name: "test-platform"
    # Verify graph output has systemName: "test-platform"
```

### Step 1.2 — Run tests (expect fail)

```bash
python3 -m unittest tests/skill/understand-wiki/test_build_system_graph.py -v
```

### Step 1.3 — Implement system.json support

**File:** `understand-anything-plugin/skills/understand-wiki/build-system-graph.py`

Modify `discover_services()`:
1. Read `.understand-anything/system.json` (in addition to existing `config.json`)
2. Parse `discovery.include` and `discovery.exclude` arrays
3. Use `fnmatch.fnmatch()` for glob pattern matching (not just exact match)
4. When `include` is non-empty, filter to only included services (ignore exclude)

Modify `build_system_graph()` (or main/output):
1. Include `systemName` and `systemDescription` from system.json in output
2. Add `excludedServices` list for transparency

### Step 1.4 — Run tests (expect pass)

```bash
python3 -m unittest tests/skill/understand-wiki/test_build_system_graph.py -v
```

### Step 1.5 — Commit

```
feat: add system.json config support to build-system-graph.py
```

---

## Task 2: manifest.json generation in merge-batch-graphs.py (TDD)

### Step 2.1 — Write failing tests

**File:** `tests/skill/understand/test_merge_batch_graphs.py`

Add to existing test class:

```python
def test_manifest_generation_basic(self):
    """Manifest contains correct service metadata from KG."""
    # Create a minimal assembled graph with projectName, nodes, edges
    # Call generate_manifest(kg, output_path)
    # Verify manifest has version, service, metadata.nodeCount, etc.

def test_manifest_exports_providers(self):
    """Manifest exports providers from provides_rpc edges."""
    # Create KG with provides_rpc edges + endpoint:__synthetic__ nodes
    # Verify manifest.exports.providers has correct entries

def test_manifest_imports_consumers(self):
    """Manifest imports consumers from consumes_rpc edges."""
    # Create KG with consumes_rpc edges
    # Verify manifest.imports.consumers has correct entries

def test_manifest_kafka_topics(self):
    """Manifest captures kafka topics from subscribes edges."""
    # Create KG with subscribes edges to topic:__synthetic__ nodes
    # Verify manifest.kafkaTopics has correct entries

def test_manifest_empty_kg(self):
    """Empty KG produces minimal but valid manifest."""
```

### Step 2.2 — Run tests (expect fail)

```bash
python3 -m unittest tests/skill/understand/test_merge_batch_graphs.py -k manifest -v
```

### Step 2.3 — Implement manifest generation

**File:** `understand-anything-plugin/skills/understand/merge-batch-graphs.py`

Add function `generate_manifest(kg: dict, output_path: str) -> dict`:
1. Extract metadata: projectName, languages, frameworks, node/edge counts
2. Extract exports: scan `provides_rpc` edges → provider entries
3. Extract imports: scan `consumes_rpc` edges → consumer entries
4. Extract kafka: scan `subscribes` edges → kafka topic entries
5. Extract synthetic endpoints: all `endpoint:__synthetic__:*` node IDs
6. Try git info: `git rev-parse HEAD` and `git rev-parse --abbrev-ref HEAD`
7. Write to output_path

Call `generate_manifest()` at end of `main()` after writing assembled-graph.json:
```python
manifest_path = project_root / ".understand-anything" / "manifest.json"
generate_manifest(assembled, str(manifest_path))
```

### Step 2.4 — Run tests (expect pass)

```bash
python3 -m unittest tests/skill/understand/test_merge_batch_graphs.py -k manifest -v
```

### Step 2.5 — Commit

```
feat: auto-generate manifest.json after graph assembly
```

---

## Task 3: Dashboard system name display

### Step 3.1 — Modify SystemOverview

**File:** `understand-anything-plugin/packages/dashboard/src/components/SystemOverview.tsx`

In the sidebar header area, display `systemGraph.systemName` if available:
```tsx
{systemGraph?.systemName && (
  <h2 className="text-lg font-semibold text-text-primary mb-1">
    {systemGraph.systemName}
  </h2>
)}
```

### Step 3.2 — Verify dashboard build

```bash
pnpm --filter @understand-anything/dashboard build
```

### Step 3.3 — Commit

```
feat(dashboard): display system name in SystemOverview
```

---

## Task 4: PRD + spec status update

### Step 4.1 — Update PRD milestone 8

Set M8 status from `pending` to `✅ done`.

### Step 4.2 — Update spec status

Set spec status from `DRAFT` to `IMPLEMENTED`.

### Step 4.3 — Run full test suite

```bash
pnpm --filter @understand-anything/core test
python3 -m unittest discover -s tests/skill/understand
python3 -m unittest discover -s tests/skill/understand-wiki
pnpm --filter @understand-anything/dashboard build
```

### Step 4.4 — Commit

```
docs: mark M8 cross-repo graph linking as implemented
```
