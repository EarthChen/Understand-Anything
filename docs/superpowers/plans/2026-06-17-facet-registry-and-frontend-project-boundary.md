# Facet/Platform Registry + Frontend Project Boundary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify the scattered facet/platform definitions in `understand-business` into one source of truth, and make frontend multi-project aggregation treat each project as a merge boundary (no name-based auto-merge; explicit config only), end-to-end.

**Architecture:** Phase 1 adds `facets.py` (a single registry) and rewires 6 consumers to it, fixing the `web`-facet graph bug and schema mismatches while keeping `backend` compatible via normalize-before-validate. Phase 2 changes `build-frontend-graph.py` to stop merging features across projects by name (per-project identity + optional explicit `frontendMergeGroups`), and threads `(project, name)` identity through `client_facets`, `association_discovery`, and `assemble_business_features`, with the Option-A collision rule (frontend↔mobile same-name still merges unless 2+ frontend projects collide).

**Tech Stack:** Python 3 (stdlib only), pytest. Two skill dirs: `understand-anything-plugin/skills/understand-business/` and `understand-anything-plugin/skills/understand-wiki/`. JSON config in `.understand-anything/system.json`.

**Spec:** `docs/superpowers/specs/2026-06-17-facet-registry-and-frontend-project-boundary-design.md`

**Conventions:**
- All paths below are relative to repo root `/Users/amar2/.understand-anything/repo`.
- `UB` = `understand-anything-plugin/skills/understand-business`
- `UW` = `understand-anything-plugin/skills/understand-wiki`
- Run business tests: `cd <repo>/understand-anything-plugin/skills/understand-business && python3 -m pytest tests/<file> -v`
- Run wiki tests: `cd <repo>/understand-anything-plugin/skills/understand-wiki && python3 -m pytest tests/<file> -v`
- (Memory: never run both pytest dirs at once — always scope to one skill's `tests/`.)
- Already on branch `feat/facet-registry-and-frontend-project-boundary`.

---

## Phase 1 — facet/platform single source of truth

### Task 1.1: Create the `facets.py` registry

**Files:**
- Create: `understand-anything-plugin/skills/understand-business/facets.py`
- Test: `understand-anything-plugin/skills/understand-business/tests/test_facets.py`

- [ ] **Step 1: Write the failing test**

Create `UB/tests/test_facets.py`:

```python
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from facets import (
    FACET_REGISTRY,
    canonical_facet,
    graph_file_for,
    is_supported_facet,
    CLIENT_FACET_TYPES,
    SERVER_FACET_TYPES,
    FRONTEND_FACET_TYPES,
    CLIENT_PLATFORMS,
    FRONTEND_PLATFORMS,
    SERVER_PLATFORMS,
    ALL_PLATFORMS,
)


def test_canonical_facet_normalizes_aliases():
    assert canonical_facet("backend") == "server"
    assert canonical_facet("web") == "frontend"
    assert canonical_facet("frontend") == "frontend"
    assert canonical_facet("mobile") == "mobile"
    assert canonical_facet("unknown-thing") == "unknown-thing"


def test_graph_file_for_resolves_aliases():
    assert graph_file_for("server") == "system-graph.json"
    assert graph_file_for("backend") == "system-graph.json"
    assert graph_file_for("mobile") == "client-graph.json"
    assert graph_file_for("frontend") == "frontend-graph.json"
    assert graph_file_for("web") == "frontend-graph.json"  # the old check_facets bug
    assert graph_file_for("shared") is None
    assert graph_file_for("test") is None


def test_role_sets_are_canonical():
    assert CLIENT_FACET_TYPES == frozenset({"mobile", "frontend", "desktop"})
    assert SERVER_FACET_TYPES == frozenset({"server"})
    assert FRONTEND_FACET_TYPES == frozenset({"frontend"})


def test_supported_flags():
    assert is_supported_facet("server") is True
    assert is_supported_facet("mobile") is True
    assert is_supported_facet("frontend") is True
    assert is_supported_facet("web") is True       # alias resolves
    assert is_supported_facet("desktop") is False
    assert is_supported_facet("shared") is False


def test_platform_sets():
    assert FRONTEND_PLATFORMS == frozenset({"web"})
    assert "web" in CLIENT_PLATFORMS
    assert "java-spring" in SERVER_PLATFORMS
    assert "web" not in SERVER_PLATFORMS
    assert "unknown" in ALL_PLATFORMS
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd <repo>/understand-anything-plugin/skills/understand-business && python3 -m pytest tests/test_facets.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'facets'`

- [ ] **Step 3: Write `facets.py`**

Create `UB/facets.py`:

```python
#!/usr/bin/env python3
"""Single source of truth for facet types and platform vocabularies.

Every facet-type / platform set in understand-business derives from here so the
definitions can never drift apart again. Aliases are normalized to one canonical
name on input — internal code only ever sees canonical names.
"""

# Canonical facet types and their metadata.
#   role:       'client' | 'server' | 'shared' | 'test'
#   graph_file: aggregation graph a facet of this type produces (None = none)
#   supported:  whether the business pipeline has a strategy for this type
FACET_REGISTRY = {
    "server":   {"role": "server", "graph_file": "system-graph.json",   "supported": True},
    "mobile":   {"role": "client", "graph_file": "client-graph.json",   "supported": True},
    "frontend": {"role": "client", "graph_file": "frontend-graph.json", "supported": True},
    "shared":   {"role": "shared", "graph_file": None,                  "supported": False},
    "desktop":  {"role": "client", "graph_file": None,                  "supported": False},
    "test":     {"role": "test",   "graph_file": None,                  "supported": False},
}

# Input aliases → canonical name. Internal code never emits these.
#   backend: has historical data; must stay compatible (silent normalization).
#   web:     no historical data; canonical name is 'frontend'.
_INPUT_ALIASES = {"backend": "server", "web": "frontend"}


def canonical_facet(facet_type: str) -> str:
    """Normalize an alias to its canonical facet type. Unknown types pass through."""
    if facet_type in FACET_REGISTRY:
        return facet_type
    return _INPUT_ALIASES.get(facet_type, facet_type)


def graph_file_for(facet_type: str):
    """Aggregation graph filename for a facet type (alias-normalized), or None."""
    meta = FACET_REGISTRY.get(canonical_facet(facet_type))
    return meta["graph_file"] if meta else None


def is_supported_facet(facet_type: str) -> bool:
    meta = FACET_REGISTRY.get(canonical_facet(facet_type))
    return bool(meta and meta["supported"])


CLIENT_FACET_TYPES = frozenset(
    t for t, m in FACET_REGISTRY.items() if m["role"] == "client"
)
SERVER_FACET_TYPES = frozenset(
    t for t, m in FACET_REGISTRY.items() if m["role"] == "server"
)
FRONTEND_FACET_TYPES = frozenset({"frontend"})  # canonical; 'web' normalizes in

# Platform vocabularies (decoupled from facet types).
CLIENT_PLATFORMS = frozenset({
    "ios", "android", "flutter", "react-native", "kotlin-multiplatform", "web",
})
FRONTEND_PLATFORMS = frozenset({"web"})
SERVER_PLATFORMS = frozenset({
    "java", "java-spring", "kotlin", "go", "python", "node", "dotnet", "rust",
})
ALL_PLATFORMS = CLIENT_PLATFORMS | SERVER_PLATFORMS | {"unknown"}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd <repo>/understand-anything-plugin/skills/understand-business && python3 -m pytest tests/test_facets.py -v`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
cd <repo>
git add understand-anything-plugin/skills/understand-business/facets.py \
        understand-anything-plugin/skills/understand-business/tests/test_facets.py
git commit -m "feat(business): add facets.py single source of truth for facet/platform

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 1.2: Wire `scenario_detector.py` to the registry

**Files:**
- Modify: `understand-anything-plugin/skills/understand-business/scenario_detector.py:16-17,57-63`
- Test: `understand-anything-plugin/skills/understand-business/tests/test_scenario_detector_aliases.py`

- [ ] **Step 1: Write the failing test**

Create `UB/tests/test_scenario_detector_aliases.py`:

```python
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from scenario_detector import detect_scenario, CLIENT_FACET_TYPES, SERVER_FACET_TYPES


def _write_system(tmp_path, facets):
    ua = tmp_path / ".understand-anything"
    ua.mkdir(parents=True)
    (ua / "system.json").write_text(json.dumps({"facets": facets}), encoding="utf-8")


def test_backend_alias_classified_as_server(tmp_path):
    _write_system(tmp_path, [
        {"type": "backend", "name": "svc", "path": "server"},
        {"type": "mobile", "name": "app", "path": "mobile"},
    ])
    result = detect_scenario(str(tmp_path))
    assert result["scenario"] == "client_server"
    assert result["server_facet"]["type"] == "backend"


def test_web_alias_classified_as_client(tmp_path):
    _write_system(tmp_path, [
        {"type": "server", "name": "svc", "path": "server"},
        {"type": "web", "name": "portal", "path": "web"},
    ])
    result = detect_scenario(str(tmp_path))
    assert result["scenario"] == "client_server"
    assert len(result["client_facets"]) == 1


def test_role_sets_come_from_registry():
    assert "mobile" in CLIENT_FACET_TYPES and "frontend" in CLIENT_FACET_TYPES
    assert SERVER_FACET_TYPES == frozenset({"server"})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd <repo>/understand-anything-plugin/skills/understand-business && python3 -m pytest tests/test_scenario_detector_aliases.py -v`
Expected: FAIL — `test_web_alias_classified_as_client` fails (today `web` IS in the local set so this passes, but `test_role_sets_come_from_registry` fails because `SERVER_FACET_TYPES` is currently `{'server','backend'}`).

- [ ] **Step 3: Edit `scenario_detector.py`**

Replace lines 16-17:

```python
CLIENT_FACET_TYPES = {'mobile', 'frontend', 'web', 'desktop'}
SERVER_FACET_TYPES = {'server', 'backend'}
```

with:

```python
from facets import canonical_facet, CLIENT_FACET_TYPES, SERVER_FACET_TYPES
```

Then in `detect_scenario`, replace the classification loop (lines 57-63):

```python
    for facet in facets:
        facet_type = facet.get('type', '')
        if facet_type in SERVER_FACET_TYPES:
            if server_facet is None:
                server_facet = facet
        elif facet_type in CLIENT_FACET_TYPES:
            client_facets.append(facet)
```

with (canonicalize the alias before membership test):

```python
    for facet in facets:
        facet_type = canonical_facet(facet.get('type', ''))
        if facet_type in SERVER_FACET_TYPES:
            if server_facet is None:
                server_facet = facet
        elif facet_type in CLIENT_FACET_TYPES:
            client_facets.append(facet)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd <repo>/understand-anything-plugin/skills/understand-business && python3 -m pytest tests/test_scenario_detector_aliases.py -v`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
cd <repo>
git add understand-anything-plugin/skills/understand-business/scenario_detector.py \
        understand-anything-plugin/skills/understand-business/tests/test_scenario_detector_aliases.py
git commit -m "refactor(business): scenario_detector uses facets registry + alias normalize

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 1.3: Wire `check_facets.py` to the registry (fixes the `web` graph bug)

**Files:**
- Modify: `understand-anything-plugin/skills/understand-business/check_facets.py:18-24,49`
- Test: `understand-anything-plugin/skills/understand-business/tests/test_check_facets_web.py`

- [ ] **Step 1: Write the failing test**

Create `UB/tests/test_check_facets_web.py`:

```python
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from check_facets import check_facets


def test_web_facet_resolves_to_frontend_graph(tmp_path):
    # Project root with a 'web' facet whose dir has frontend-graph.json + wiki meta.
    ua = tmp_path / ".understand-anything"
    ua.mkdir(parents=True)
    web_dir = tmp_path / "web" / ".understand-anything"
    web_dir.mkdir(parents=True)
    (web_dir / "frontend-graph.json").write_text("{}", encoding="utf-8")
    (web_dir / "wiki").mkdir()
    (web_dir / "wiki" / "meta.json").write_text("{}", encoding="utf-8")
    (ua / "system.json").write_text(json.dumps({
        "facets": [{"id": "f1", "type": "web", "name": "portal", "path": "web"}]
    }), encoding="utf-8")

    result = check_facets(str(tmp_path))
    facet = result["facets"][0]
    # Before the fix this was status 'degraded' (no graph file mapped for 'web').
    assert facet["hasGraph"] is True
    assert facet["status"] == "available"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd <repo>/understand-anything-plugin/skills/understand-business && python3 -m pytest tests/test_check_facets_web.py -v`
Expected: FAIL — `hasGraph` is `False` / status `degraded` (GRAPH_FILE_MAP has no `web` key).

- [ ] **Step 3: Edit `check_facets.py`**

Replace lines 18-24:

```python
GRAPH_FILE_MAP = {
    'backend': 'system-graph.json',
    'server': 'system-graph.json',
    'mobile': 'client-graph.json',
    'frontend': 'frontend-graph.json',
    'test': None,
}
```

with:

```python
from facets import graph_file_for
```

Then replace line 49:

```python
        graph_file = GRAPH_FILE_MAP.get(facet_type)
```

with:

```python
        graph_file = graph_file_for(facet_type)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd <repo>/understand-anything-plugin/skills/understand-business && python3 -m pytest tests/test_check_facets_web.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd <repo>
git add understand-anything-plugin/skills/understand-business/check_facets.py \
        understand-anything-plugin/skills/understand-business/tests/test_check_facets_web.py
git commit -m "fix(business): check_facets resolves web facet to frontend-graph via registry

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 1.4: Wire `client_facets.py` strategy registry

**Files:**
- Modify: `understand-anything-plugin/skills/understand-business/client_facets.py:156-171`
- Test: `understand-anything-plugin/skills/understand-business/tests/test_client_facets_alias.py`

- [ ] **Step 1: Write the failing test**

Create `UB/tests/test_client_facets_alias.py`:

```python
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from client_facets import load_client_features


def test_web_alias_uses_frontend_strategy(tmp_path):
    # A 'web' facet should be handled by the frontend strategy (not unsupported).
    web_dir = tmp_path / "web" / ".understand-anything"
    web_dir.mkdir(parents=True)
    (web_dir / "frontend-graph.json").write_text(json.dumps({
        "project": {"frameworks": ["react"]},
        "features": [{"name": "Orders", "sourceRepos": ["web"], "routes": [], "apiCalls": []}],
    }), encoding="utf-8")

    result = load_client_features(str(tmp_path), {"type": "web", "name": "portal", "path": "web"})
    assert result is not None
    assert [f["name"] for f in result["consolidated"]] == ["Orders"]


def test_desktop_is_unsupported(tmp_path):
    result = load_client_features(str(tmp_path), {"type": "desktop", "name": "d", "path": "d"})
    assert result is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd <repo>/understand-anything-plugin/skills/understand-business && python3 -m pytest tests/test_client_facets_alias.py -v`
Expected: PASS today for `test_web_alias_uses_frontend_strategy` (web is a key now) but the goal is to keep it passing after we remove the `web` key and canonicalize. Run to establish the baseline; both should pass after Step 3.

- [ ] **Step 3: Edit `client_facets.py`**

Replace lines 156-171:

```python
# NOTE: keep this in sync with scenario_detector.CLIENT_FACET_TYPES. Any type
# recognized there but NOT registered here (currently 'desktop') is treated as
# unsupported — load_client_features returns None and association_discovery
# surfaces it via `unsupportedFacets`. 'web' is registered as an alias for the
# frontend strategy: a web facet IS a frontend facet.
CLIENT_STRATEGIES = {
    'mobile': consolidate_mobile,
    'frontend': consolidate_frontend,
    'web': consolidate_frontend,
}


def load_client_features(project_root: str, facet: dict) -> dict | None:
    """Return {consolidated, standalone, infrastructure}, or None if unsupported."""
    strategy = CLIENT_STRATEGIES.get(facet.get('type'))
    return strategy(project_root, facet) if strategy else None
```

with (strategies keyed by canonical type; lookup canonicalizes — `web` resolves to `frontend`, `desktop` stays unsupported):

```python
# Strategies are keyed by CANONICAL facet type (see facets.canonical_facet).
# 'web' resolves to 'frontend'; 'desktop' has no strategy and is therefore
# unsupported — load_client_features returns None and association_discovery
# surfaces it via `unsupportedFacets`.
CLIENT_STRATEGIES = {
    'mobile': consolidate_mobile,
    'frontend': consolidate_frontend,
}


def load_client_features(project_root: str, facet: dict) -> dict | None:
    """Return {consolidated, standalone, infrastructure}, or None if unsupported."""
    strategy = CLIENT_STRATEGIES.get(canonical_facet(facet.get('type', '')))
    return strategy(project_root, facet) if strategy else None
```

Add the import near the top of the file (after the existing `from domain_matcher import _consolidate_mobile_domains` on line 13):

```python
from facets import canonical_facet
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd <repo>/understand-anything-plugin/skills/understand-business && python3 -m pytest tests/test_client_facets_alias.py -v`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
cd <repo>
git add understand-anything-plugin/skills/understand-business/client_facets.py \
        understand-anything-plugin/skills/understand-business/tests/test_client_facets_alias.py
git commit -m "refactor(business): client_facets keys strategies by canonical facet type

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 1.5: Wire `detect_platforms.py` + normalize-before-validate (backend compat)

**Files:**
- Modify: `understand-anything-plugin/skills/understand-business/detect_platforms.py:21-41,470-540`
- Modify: `understand-anything-plugin/skills/understand-business/schemas/system.schema.json:17`
- Test: `understand-anything-plugin/skills/understand-business/tests/test_detect_platforms_compat.py`

- [ ] **Step 1: Write the failing test**

Create `UB/tests/test_detect_platforms_compat.py`:

```python
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from detect_platforms import validate_system_json


def test_backend_alias_passes_validation(tmp_path):
    ua = tmp_path / ".understand-anything"
    ua.mkdir(parents=True)
    (ua / "system.json").write_text(json.dumps({
        "facets": [{"type": "backend", "name": "svc", "path": "server"}]
    }), encoding="utf-8")
    result = validate_system_json(str(tmp_path))
    assert result["valid"] is True, result["errors"]


def test_unknown_facet_type_still_fails(tmp_path):
    ua = tmp_path / ".understand-anything"
    ua.mkdir(parents=True)
    (ua / "system.json").write_text(json.dumps({
        "facets": [{"type": "banana", "name": "svc", "path": "server"}]
    }), encoding="utf-8")
    result = validate_system_json(str(tmp_path))
    assert result["valid"] is False
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd <repo>/understand-anything-plugin/skills/understand-business && python3 -m pytest tests/test_detect_platforms_compat.py -v`
Expected: FAIL — `test_backend_alias_passes_validation` fails because schema enum lacks `backend` and there is no pre-normalization.

- [ ] **Step 3a: Edit platform constants in `detect_platforms.py`**

Replace lines 21-41:

```python
MOBILE_PLATFORMS = (
    "ios",
    "android",
    "flutter",
    "react-native",
    "kotlin-multiplatform",
    "web",
    "unknown",
)

SERVER_PLATFORMS = (
    "java",
    "java-spring",
    "kotlin",
    "go",
    "python",
    "node",
    "dotnet",
    "rust",
    "unknown",
)
```

with (import from the registry; `CLIENT_PLATFORMS` keeps `web` as a client target):

```python
from facets import (
    canonical_facet,
    CLIENT_PLATFORMS as _CLIENT_PLATFORMS,
    SERVER_PLATFORMS as _SERVER_PLATFORMS,
)

# Kept as tuples for backward compatibility with any positional consumers.
MOBILE_PLATFORMS = tuple(sorted(_CLIENT_PLATFORMS)) + ("unknown",)
SERVER_PLATFORMS = tuple(sorted(_SERVER_PLATFORMS)) + ("unknown",)
```

- [ ] **Step 3b: Add the normalization helper and use it in validation**

In `detect_platforms.py`, replace the `_basic_validate` facet_types line (line 482):

```python
    facet_types = {"server", "mobile", "frontend", "shared"}
```

with (derive from the registry):

```python
    from facets import FACET_REGISTRY
    facet_types = set(FACET_REGISTRY.keys())
```

Then add this helper just above `validate_system_json` (before line 515):

```python
def _normalized_for_validation(data: dict) -> dict:
    """Return a copy of system.json data with facet types canonicalized.

    Lets historical aliases (backend→server, web→frontend) pass schema
    validation without polluting the canonical schema enum.
    """
    out = json.loads(json.dumps(data))
    for facet in out.get("facets", []):
        if isinstance(facet, dict) and "type" in facet:
            facet["type"] = canonical_facet(facet["type"])
    return out
```

Then inside `validate_system_json`, replace the data load + validate body. Replace lines 522-540:

```python
    with open(system_path, encoding="utf-8") as f:
        data = json.load(f)

    schema = _load_schema()

    try:
        import jsonschema

        validator = jsonschema.Draft7Validator(schema)
        errors = sorted(validator.iter_errors(data), key=lambda e: list(e.path))
        if errors:
            return {
                "valid": False,
                "errors": [f"{'.'.join(str(p) for p in err.path)}: {err.message}" for err in errors],
            }
        return {"valid": True, "errors": []}
    except ImportError:
        errors = _basic_validate(data, schema)
        return {"valid": len(errors) == 0, "errors": errors}
```

with (validate the normalized copy):

```python
    with open(system_path, encoding="utf-8") as f:
        data = json.load(f)

    data = _normalized_for_validation(data)
    schema = _load_schema()

    try:
        import jsonschema

        validator = jsonschema.Draft7Validator(schema)
        errors = sorted(validator.iter_errors(data), key=lambda e: list(e.path))
        if errors:
            return {
                "valid": False,
                "errors": [f"{'.'.join(str(p) for p in err.path)}: {err.message}" for err in errors],
            }
        return {"valid": True, "errors": []}
    except ImportError:
        errors = _basic_validate(data, schema)
        return {"valid": len(errors) == 0, "errors": errors}
```

- [ ] **Step 3c: Edit the schema enum**

In `UB/schemas/system.schema.json`, replace line 17:

```json
        "type": { "enum": ["server", "mobile", "frontend", "shared"] },
```

with:

```json
        "type": { "enum": ["server", "mobile", "frontend", "shared", "desktop", "test"] },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd <repo>/understand-anything-plugin/skills/understand-business && python3 -m pytest tests/test_detect_platforms_compat.py tests/test_platform_detection.py -v`
Expected: PASS (new compat tests + the existing platform_detection suite still green)

- [ ] **Step 5: Commit**

```bash
cd <repo>
git add understand-anything-plugin/skills/understand-business/detect_platforms.py \
        understand-anything-plugin/skills/understand-business/schemas/system.schema.json \
        understand-anything-plugin/skills/understand-business/tests/test_detect_platforms_compat.py
git commit -m "refactor(business): detect_platforms uses registry; backend compat via normalize-before-validate

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 1.6: Wire `assemble_business_features._FRONTEND_FACETS` to the registry

**Files:**
- Modify: `understand-anything-plugin/skills/understand-business/assemble_business_features.py:22-25`

- [ ] **Step 1: Write the failing test**

Append to a new file `UB/tests/test_assemble_frontend_facets_const.py`:

```python
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
import assemble_business_features as abf
from facets import FRONTEND_FACET_TYPES


def test_frontend_facets_constant_comes_from_registry():
    assert abf._FRONTEND_FACETS == FRONTEND_FACET_TYPES
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd <repo>/understand-anything-plugin/skills/understand-business && python3 -m pytest tests/test_assemble_frontend_facets_const.py -v`
Expected: FAIL — `_FRONTEND_FACETS` is currently `frozenset({'frontend','web'})`, not equal to `FRONTEND_FACET_TYPES` (`{'frontend'}`).

- [ ] **Step 3: Edit `assemble_business_features.py`**

Replace lines 22-25:

```python
# Facet types that use the non-lossy per-repo frontend aggregation. Mirrors the
# alias set in client_facets.CLIENT_STRATEGIES ('web' aliases the frontend
# strategy) so the document builder and the registry agree on what is "frontend".
_FRONTEND_FACETS = frozenset({'frontend', 'web'})
```

with:

```python
from facets import FRONTEND_FACET_TYPES as _FRONTEND_FACETS
```

> Note: existing call sites compare `facet_type in _FRONTEND_FACETS` where `facet_type` comes from `clientLayers`/consolidation, which after Task 1.4 is always canonical (`frontend`). No other change needed here.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd <repo>/understand-anything-plugin/skills/understand-business && python3 -m pytest tests/test_assemble_frontend_facets_const.py tests/test_feature_assembler.py -v`
Expected: PASS (new test + existing assembler suite still green)

- [ ] **Step 5: Commit**

```bash
cd <repo>
git add understand-anything-plugin/skills/understand-business/assemble_business_features.py \
        understand-anything-plugin/skills/understand-business/tests/test_assemble_frontend_facets_const.py
git commit -m "refactor(business): _FRONTEND_FACETS sourced from facets registry

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 1.7: Anti-drift consistency test

**Files:**
- Test: `understand-anything-plugin/skills/understand-business/tests/test_facets_consistency.py`

- [ ] **Step 1: Write the test**

Create `UB/tests/test_facets_consistency.py`:

```python
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
import facets
import scenario_detector
import client_facets
import assemble_business_features as abf


def test_role_sets_are_the_registry_objects():
    # Consumers import the registry's sets, not private copies.
    assert scenario_detector.CLIENT_FACET_TYPES is facets.CLIENT_FACET_TYPES
    assert scenario_detector.SERVER_FACET_TYPES is facets.SERVER_FACET_TYPES
    assert abf._FRONTEND_FACETS is facets.FRONTEND_FACET_TYPES


def test_every_supported_client_type_has_a_strategy():
    for ftype, meta in facets.FACET_REGISTRY.items():
        if meta["role"] == "client" and meta["supported"]:
            assert ftype in client_facets.CLIENT_STRATEGIES, ftype
        if meta["role"] == "client" and not meta["supported"]:
            assert ftype not in client_facets.CLIENT_STRATEGIES, ftype


def test_every_supported_type_has_graph_file():
    for ftype, meta in facets.FACET_REGISTRY.items():
        if meta["supported"]:
            assert meta["graph_file"], ftype


def test_platform_union_matches_schema_enum():
    schema = json.loads(
        (Path(__file__).parent.parent / "schemas" / "system.schema.json").read_text()
    )
    enum = set(schema["definitions"]["service"]["properties"]["platform"]["enum"])
    assert facets.ALL_PLATFORMS == enum
```

- [ ] **Step 2: Run test to verify it passes**

Run: `cd <repo>/understand-anything-plugin/skills/understand-business && python3 -m pytest tests/test_facets_consistency.py -v`
Expected: PASS. If `test_platform_union_matches_schema_enum` fails, reconcile `facets.ALL_PLATFORMS` with the schema `service.platform.enum` (both must list the same platform values).

- [ ] **Step 3: Run the full business suite (regression gate)**

Run: `cd <repo>/understand-anything-plugin/skills/understand-business && python3 -m pytest tests/ -v`
Expected: PASS, except the 4 known-stale failures in `test_association_discovery.py` documented as non-regressions. If anything else is red, fix before committing.

- [ ] **Step 4: Commit**

```bash
cd <repo>
git add understand-anything-plugin/skills/understand-business/tests/test_facets_consistency.py
git commit -m "test(business): anti-drift consistency test for facets registry

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Phase 2 — frontend project is the merge boundary

### Task 2.1: `build-frontend-graph.py` — no name-merge by default + explicit groups

**Files:**
- Modify: `understand-anything-plugin/skills/understand-wiki/build-frontend-graph.py:339-362,438-488,584`
- Test: `understand-anything-plugin/skills/understand-wiki/tests/test_frontend_project_boundary.py`

- [ ] **Step 1: Write the failing test**

Create `UW/tests/test_frontend_project_boundary.py`:

```python
import importlib.util
import sys
from pathlib import Path

SKILL_DIR = Path(__file__).resolve().parent.parent
if str(SKILL_DIR) not in sys.path:
    sys.path.insert(0, str(SKILL_DIR))


def _import_skill_module(filename: str):
    path = SKILL_DIR / filename
    module_name = filename.replace("-", "_").removesuffix(".py")
    spec = importlib.util.spec_from_file_location(module_name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


bfg = _import_skill_module("build-frontend-graph.py")


def _repo(name, feats):
    return {"name": name, "features": feats}


def _feat(fid, name, **kw):
    base = {"id": fid, "name": name, "sourceDomain": fid.replace("feature:", "domain:"),
            "routes": [], "pages": [], "components": [], "stateStores": [],
            "apiCalls": [], "uiRules": [], "interactionRules": [],
            "stateTransitions": [], "apiSequence": []}
    base.update(kw)
    return base


def test_same_name_across_projects_not_merged():
    per_repo = [
        _repo("seller-portal", [_feat("feature:订单", "订单", routes=["/s/orders"])]),
        _repo("buyer-web", [_feat("feature:订单", "订单", routes=["/b/orders"])]),
    ]
    features, domain_links = bfg._aggregate_features(per_repo, merge_groups=[])
    names_projects = sorted((f["name"], f["project"]) for f in features)
    assert names_projects == [("订单", "buyer-web"), ("订单", "seller-portal")]
    assert all(len(f["sourceRepos"]) == 1 for f in features)
    assert domain_links == []
    ids = [f["id"] for f in features]
    assert "feature:buyer-web:订单" in ids
    assert "feature:seller-portal:订单" in ids


def test_explicit_merge_group_merges():
    per_repo = [
        _repo("seller-portal", [_feat("feature:订单", "订单", routes=["/s/orders"])]),
        _repo("ops-web", [_feat("feature:订单管理", "订单管理", routes=["/ops/orders"])]),
    ]
    groups = [{"canonicalName": "订单", "members": [
        {"project": "seller-portal", "feature": "订单"},
        {"project": "ops-web", "feature": "订单管理"},
    ]}]
    features, domain_links = bfg._aggregate_features(per_repo, merge_groups=groups)
    merged = [f for f in features if f["name"] == "订单"]
    assert len(merged) == 1
    assert sorted(merged[0]["sourceRepos"]) == ["ops-web", "seller-portal"]
    assert sorted(merged[0]["routes"]) == ["/ops/orders", "/s/orders"]
    assert len(domain_links) == 1
    assert domain_links[0]["canonicalFeature"] == "订单"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd <repo>/understand-anything-plugin/skills/understand-wiki && python3 -m pytest tests/test_frontend_project_boundary.py -v`
Expected: FAIL — `_aggregate_features()` takes 1 positional arg (no `merge_groups`), and today it merges by name (no `project` field).

- [ ] **Step 3a: Add a merge-groups reader**

In `build-frontend-graph.py`, just below `_frontend_subpaths` (after line 362), add:

```python
def _frontend_merge_groups(root: Path) -> list[dict]:
    """Return the frontend facet's frontendMergeGroups from a discoverable system.json.

    Same lookup order as _frontend_subpaths (root then root.parent). Missing or
    unreadable config yields []. Each group is {canonicalName, members:[{project, feature}]}.
    """
    bases = [root]
    if root.parent != root:
        bases.append(root.parent)
    for base in bases:
        sys_path = base / ".understand-anything" / "system.json"
        if not sys_path.is_file():
            continue
        try:
            cfg = json.loads(sys_path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            return []
        for facet in cfg.get("facets", []):
            if facet.get("type") in ("frontend", "web"):
                return facet.get("frontendMergeGroups", []) or []
    return []
```

- [ ] **Step 3b: Rewrite `_aggregate_features`**

Replace the whole function (lines 438-488):

```python
def _aggregate_features(per_repo: list[dict]) -> tuple[list[dict], list[dict]]:
    """Group features across repos by normalized name.

    Returns (features, domainLinks). Unique features pass through with
    sourceRepos=[repo]; features sharing a normalized name merge into one entry
    (deduped-union list fields, sourceRepos = every repo). Each shared (>=2 repo)
    group yields one domainLink mapping repo -> that repo's feature id.
    """
    groups: dict[str, list[tuple[str, dict]]] = {}
    order: list[str] = []  # preserve first-seen order for deterministic grouping
    for repo in per_repo:
        for feat in repo["features"]:
            key = _normalize_feature_name(feat.get("name", ""))
            if key not in groups:
                groups[key] = []
                order.append(key)
            groups[key].append((repo["name"], feat))

    features: list[dict] = []
    domain_links: list[dict] = []
    for key in order:
        members = groups[key]
        repos_in_group = sorted({name for name, _ in members})
        _, first_feat = members[0]
        features.append({
            "id": first_feat["id"],
            "name": first_feat["name"],
            "sourceDomain": first_feat.get("sourceDomain", ""),
            "sourceRepos": repos_in_group,
            "routes": _union([f.get("routes", []) for _, f in members]),
            "pages": _union([f.get("pages", []) for _, f in members]),
            "components": _union([f.get("components", []) for _, f in members]),
            "stateStores": _union([f.get("stateStores", []) for _, f in members]),
            "apiCalls": _union_api_calls([f.get("apiCalls", []) for _, f in members]),
            "uiRules": [],
            "interactionRules": [],
            "stateTransitions": [],
            "apiSequence": [],
        })
        if len(repos_in_group) >= 2:
            mappings: dict[str, str] = {}
            for name, f in members:
                mappings.setdefault(name, f["id"])  # first occurrence per repo
            domain_links.append({
                "canonicalFeature": first_feat["name"],
                "mappings": mappings,
            })

    features.sort(key=lambda f: f["id"])
    domain_links.sort(key=lambda d: d["canonicalFeature"])
    return features, domain_links
```

with:

```python
def _aggregate_features(
    per_repo: list[dict], merge_groups: list[dict] | None = None
) -> tuple[list[dict], list[dict]]:
    """Aggregate per-repo features. Each project is a merge boundary.

    Default: features are NOT merged across projects by name; every (repo, feature)
    becomes its own entry with a project-scoped id, project=<repo>, sourceRepos=[repo].
    Only members listed in merge_groups (from system.json frontendMergeGroups) are
    merged into one entry (deduped-union fields, sourceRepos=all listed repos, one
    domainLink). Returns (features, domainLinks).
    """
    merge_groups = merge_groups or []

    # Index every (repo, normalized-name) -> (repo, feature) once.
    by_key: dict[tuple[str, str], tuple[str, dict]] = {}
    order: list[tuple[str, str]] = []
    for repo in per_repo:
        for feat in repo["features"]:
            key = (repo["name"], _normalize_feature_name(feat.get("name", "")))
            if key not in by_key:
                order.append(key)
            by_key[key] = (repo["name"], feat)

    features: list[dict] = []
    domain_links: list[dict] = []
    consumed: set[tuple[str, str]] = set()

    # 1) Explicit merge groups.
    for group in merge_groups:
        members: list[tuple[str, dict]] = []
        for m in group.get("members", []):
            k = (m.get("project", ""), _normalize_feature_name(m.get("feature", "")))
            if k in by_key:
                members.append(by_key[k])
                consumed.add(k)
        if not members:
            continue
        repos_in_group = sorted({name for name, _ in members})
        _, first_feat = members[0]
        canonical = group.get("canonicalName") or first_feat["name"]
        features.append({
            "id": f"feature:{canonical}",
            "name": canonical,
            "project": None,  # spans multiple projects
            "sourceDomain": first_feat.get("sourceDomain", ""),
            "sourceRepos": repos_in_group,
            "routes": _union([f.get("routes", []) for _, f in members]),
            "pages": _union([f.get("pages", []) for _, f in members]),
            "components": _union([f.get("components", []) for _, f in members]),
            "stateStores": _union([f.get("stateStores", []) for _, f in members]),
            "apiCalls": _union_api_calls([f.get("apiCalls", []) for _, f in members]),
            "uiRules": [],
            "interactionRules": [],
            "stateTransitions": [],
            "apiSequence": [],
        })
        mappings: dict[str, str] = {}
        for name, f in members:
            mappings.setdefault(name, f["id"])
        domain_links.append({"canonicalFeature": canonical, "mappings": mappings})

    # 2) Everything else: per-project, no name-based merge.
    for key in order:
        if key in consumed:
            continue
        repo_name, feat = by_key[key]
        suffix = feat["id"].split(":", 1)[1] if ":" in feat["id"] else feat["id"]
        features.append({
            "id": f"feature:{repo_name}:{suffix}",
            "name": feat["name"],
            "project": repo_name,
            "sourceDomain": feat.get("sourceDomain", ""),
            "sourceRepos": [repo_name],
            "routes": feat.get("routes", []),
            "pages": feat.get("pages", []),
            "components": feat.get("components", []),
            "stateStores": feat.get("stateStores", []),
            "apiCalls": feat.get("apiCalls", []),
            "uiRules": [],
            "interactionRules": [],
            "stateTransitions": [],
            "apiSequence": [],
        })

    features.sort(key=lambda f: f["id"])
    domain_links.sort(key=lambda d: d["canonicalFeature"])
    return features, domain_links
```

- [ ] **Step 3c: Pass merge groups in `build_frontend_graph`**

In `build_frontend_graph`, replace line 584:

```python
    features, domain_links = _aggregate_features(per_repo)
```

with:

```python
    features, domain_links = _aggregate_features(per_repo, _frontend_merge_groups(root))
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd <repo>/understand-anything-plugin/skills/understand-wiki && python3 -m pytest tests/test_frontend_project_boundary.py -v`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
cd <repo>
git add understand-anything-plugin/skills/understand-wiki/build-frontend-graph.py \
        understand-anything-plugin/skills/understand-wiki/tests/test_frontend_project_boundary.py
git commit -m "feat(wiki): frontend aggregation treats each project as merge boundary

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2.2: `client_facets.consolidate_frontend` carries `project`

**Files:**
- Modify: `understand-anything-plugin/skills/understand-business/client_facets.py:136-148`
- Test: `understand-anything-plugin/skills/understand-business/tests/test_consolidate_frontend_project.py`

- [ ] **Step 1: Write the failing test**

Create `UB/tests/test_consolidate_frontend_project.py`:

```python
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from client_facets import consolidate_frontend


def test_consolidated_entry_carries_project(tmp_path):
    web_dir = tmp_path / "web" / ".understand-anything"
    web_dir.mkdir(parents=True)
    (web_dir / "frontend-graph.json").write_text(json.dumps({
        "project": {"frameworks": ["react"]},
        "features": [
            {"name": "订单", "project": "seller-portal", "sourceRepos": ["seller-portal"],
             "routes": ["/s/orders"], "apiCalls": []},
            {"name": "订单", "project": "buyer-web", "sourceRepos": ["buyer-web"],
             "routes": ["/b/orders"], "apiCalls": []},
        ],
    }), encoding="utf-8")

    result = consolidate_frontend(str(tmp_path), {"type": "frontend", "name": "p", "path": "web"})
    projects = sorted(c["project"] for c in result["consolidated"])
    assert projects == ["buyer-web", "seller-portal"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd <repo>/understand-anything-plugin/skills/understand-business && python3 -m pytest tests/test_consolidate_frontend_project.py -v`
Expected: FAIL with `KeyError: 'project'` — consolidated entries don't carry `project` yet.

- [ ] **Step 3: Edit `consolidate_frontend`**

Replace lines 136-148:

```python
        source_repos = feat.get('sourceRepos', [])
        consolidated.append({
            'name': name,
            'implType': 'frontend-web',
            'platforms': ['web'],
            'deliveryPlatforms': frameworks,
            'implementations': [
                {'platform': 'web', 'repo': r} for r in source_repos
            ],
            'mergedSummary': _summarize(feat),
            'facetType': 'frontend',
            'sourceRepos': source_repos,
        })
```

with (carry `project` straight from the frontend-graph feature):

```python
        source_repos = feat.get('sourceRepos', [])
        consolidated.append({
            'name': name,
            'implType': 'frontend-web',
            'platforms': ['web'],
            'deliveryPlatforms': frameworks,
            'implementations': [
                {'platform': 'web', 'repo': r} for r in source_repos
            ],
            'mergedSummary': _summarize(feat),
            'facetType': 'frontend',
            'sourceRepos': source_repos,
            'project': feat.get('project'),
        })
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd <repo>/understand-anything-plugin/skills/understand-business && python3 -m pytest tests/test_consolidate_frontend_project.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd <repo>
git add understand-anything-plugin/skills/understand-business/client_facets.py \
        understand-anything-plugin/skills/understand-business/tests/test_consolidate_frontend_project.py
git commit -m "feat(business): consolidate_frontend carries per-project identity

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2.3: `association_discovery` keys cache/results by `(facet, project, name)`

**Files:**
- Modify: `understand-anything-plugin/skills/understand-business/association_discovery.py:187-231`
- Test: `understand-anything-plugin/skills/understand-business/tests/test_association_project_key.py`

- [ ] **Step 1: Write the failing test**

Create `UB/tests/test_association_project_key.py`:

```python
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
import association_discovery as ad


def test_same_name_two_projects_do_not_share_cache(monkeypatch):
    server_domains = {"orders": {"data": {"summary": "orders"}, "endpoints": [], "service": "svc"}}
    features = [
        {"name": "订单", "facetType": "frontend", "project": "seller-portal",
         "implType": "frontend-web", "deliveryPlatforms": ["web"], "mergedSummary": "seller"},
        {"name": "订单", "facetType": "frontend", "project": "buyer-web",
         "implType": "frontend-web", "deliveryPlatforms": ["web"], "mergedSummary": "buyer"},
    ]
    # Previous run only cached seller-portal's result.
    previous = [{
        "featureName": "订单", "facetType": "frontend", "project": "seller-portal",
        "primaryServer": {"domain": "orders", "service": "svc", "confidence": 0.9},
        "supportingServers": [], "error": None,
        "_promptHash": ad.compute_prompt_hash(features[0], server_domains),
    }]

    calls = {"n": 0}

    def fake_llm(prompt):
        calls["n"] += 1
        return '{"primaryServer": {"domain": "orders", "service": "svc", "confidence": 0.8}, "supportingServers": []}'

    monkeypatch.setattr(ad, "_call_llm", fake_llm)
    results, llm_calls, reused = ad.discover_associations(features, server_domains, previous_results=previous)

    # seller-portal reused from cache; buyer-web must NOT reuse seller's cache → 1 live call.
    assert reused == 1
    assert llm_calls == 1
    projects = sorted(r["project"] for r in results)
    assert projects == ["buyer-web", "seller-portal"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd <repo>/understand-anything-plugin/skills/understand-business && python3 -m pytest tests/test_association_project_key.py -v`
Expected: FAIL — today `prev_by_name` is keyed by featureName only, so buyer-web wrongly reuses seller's cache (`reused == 2`), and results lack `project`.

- [ ] **Step 3: Edit `discover_associations`**

Replace lines 187-231:

```python
    prev_by_name: dict[str, dict] = {}
    if previous_results:
        for r in previous_results:
            fname = r.get('featureName', '')
            if fname and r.get('_promptHash') and not r.get('error'):
                prev_by_name[fname] = r

    llm_calls = 0
    reused = 0

    for feature in features:
        feature_name = feature.get('name', 'unknown')
        prompt_hash = compute_prompt_hash(feature, server_domains)

        prev = prev_by_name.get(feature_name)
        if prev and prev.get('_promptHash') == prompt_hash:
            # Shallow copy so the reused record reflects the CURRENT feature's
            # facet, not the stale facet from the previous run.
            r = dict(prev)
            r['facetType'] = feature.get('facetType', prev.get('facetType', ''))
            results.append(r)
            reused += 1
            continue

        prompt = build_discovery_prompt(feature, server_domains)
        try:
            response = _call_llm(prompt)
            llm_calls += 1
        except (NotImplementedError, RuntimeError, OSError) as e:
            results.append({
                'featureName': feature_name,
                'primaryServer': None,
                'supportingServers': [],
                'error': str(e),
                '_promptHash': prompt_hash,
                'facetType': feature.get('facetType', ''),
            })
            continue

        result = parse_discovery_response(
            response, feature_name, min_confidence, valid_domain_names
        )
        result['_promptHash'] = prompt_hash
        result['facetType'] = feature.get('facetType', '')
        results.append(result)

    return results, llm_calls, reused
```

with (composite cache key + project on every result):

```python
    from facets import canonical_facet

    def _key(facet_type, project, name):
        return (canonical_facet(facet_type or ''), project or '', name)

    prev_by_key: dict[tuple, dict] = {}
    if previous_results:
        for r in previous_results:
            fname = r.get('featureName', '')
            if fname and r.get('_promptHash') and not r.get('error'):
                prev_by_key[_key(r.get('facetType'), r.get('project'), fname)] = r

    llm_calls = 0
    reused = 0

    for feature in features:
        feature_name = feature.get('name', 'unknown')
        project = feature.get('project')
        fkey = _key(feature.get('facetType'), project, feature_name)
        prompt_hash = compute_prompt_hash(feature, server_domains)

        prev = prev_by_key.get(fkey)
        if prev and prev.get('_promptHash') == prompt_hash:
            # Shallow copy so the reused record reflects the CURRENT feature's
            # facet/project, not the stale values from the previous run.
            r = dict(prev)
            r['facetType'] = feature.get('facetType', prev.get('facetType', ''))
            r['project'] = project
            results.append(r)
            reused += 1
            continue

        prompt = build_discovery_prompt(feature, server_domains)
        try:
            response = _call_llm(prompt)
            llm_calls += 1
        except (NotImplementedError, RuntimeError, OSError) as e:
            results.append({
                'featureName': feature_name,
                'primaryServer': None,
                'supportingServers': [],
                'error': str(e),
                '_promptHash': prompt_hash,
                'facetType': feature.get('facetType', ''),
                'project': project,
            })
            continue

        result = parse_discovery_response(
            response, feature_name, min_confidence, valid_domain_names
        )
        result['_promptHash'] = prompt_hash
        result['facetType'] = feature.get('facetType', '')
        result['project'] = project
        results.append(result)

    return results, llm_calls, reused
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd <repo>/understand-anything-plugin/skills/understand-business && python3 -m pytest tests/test_association_project_key.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd <repo>
git add understand-anything-plugin/skills/understand-business/association_discovery.py \
        understand-anything-plugin/skills/understand-business/tests/test_association_project_key.py
git commit -m "feat(business): association cache/results keyed by (facet, project, name)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2.4: `assemble_business_features` — collision rule (Option A) + project touchpoints

**Files:**
- Modify: `understand-anything-plugin/skills/understand-business/assemble_business_features.py:100-106,109-168,196-258`
- Test: `understand-anything-plugin/skills/understand-business/tests/test_assemble_collision.py`

- [ ] **Step 1: Write the failing test**

Create `UB/tests/test_assemble_collision.py`:

```python
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from assemble_business_features import assemble_features


def _fe(name, project):
    return {"name": name, "implType": "frontend-web", "platforms": ["web"],
            "deliveryPlatforms": ["react"],
            "implementations": [{"platform": "web", "repo": project}],
            "mergedSummary": "", "facetType": "frontend", "project": project,
            "sourceRepos": [project]}


def _mob(name):
    return {"name": name, "implType": "native", "platforms": ["ios"],
            "deliveryPlatforms": ["ios"],
            "implementations": [{"platform": "ios", "repo": "app-ios"}],
            "mergedSummary": "", "facetType": "mobile", "project": None}


def _assoc(name, facet, project, domain):
    return {"featureName": name, "facetType": facet, "project": project,
            "primaryServer": {"domain": domain, "service": "svc", "confidence": 0.9},
            "supportingServers": [], "error": None}


def test_no_collision_frontend_and_mobile_merge():
    consolidation = {"consolidated": [_fe("订单", "seller-portal"), _mob("订单")],
                     "standalone": [], "infrastructure": []}
    associations = [_assoc("订单", "frontend", "seller-portal", "orders"),
                    _assoc("订单", "mobile", None, "orders")]
    result = assemble_features(associations, consolidation)
    feats = result["features"]
    assert len(feats) == 1
    facet_types = sorted(cl["facetType"] for cl in feats[0]["clientLayers"])
    assert facet_types == ["frontend", "mobile"]


def test_two_frontend_projects_split():
    consolidation = {"consolidated": [_fe("订单", "seller-portal"), _fe("订单", "buyer-web")],
                     "standalone": [], "infrastructure": []}
    associations = [_assoc("订单", "frontend", "seller-portal", "seller-orders"),
                    _assoc("订单", "frontend", "buyer-web", "buyer-orders")]
    result = assemble_features(associations, consolidation)
    feats = result["features"]
    assert len(feats) == 2
    assert {f["project"] for f in feats} == {"seller-portal", "buyer-web"}
    assert {f["id"] for f in feats} == {"feature:订单@seller-portal", "feature:订单@buyer-web"}


def test_three_way_collision_splits_to_three():
    consolidation = {"consolidated": [_fe("订单", "seller-portal"), _fe("订单", "buyer-web"), _mob("订单")],
                     "standalone": [], "infrastructure": []}
    associations = [_assoc("订单", "frontend", "seller-portal", "seller-orders"),
                    _assoc("订单", "frontend", "buyer-web", "buyer-orders"),
                    _assoc("订单", "mobile", None, "orders")]
    result = assemble_features(associations, consolidation)
    feats = result["features"]
    assert len(feats) == 3
    mobile_docs = [f for f in feats if any(cl["facetType"] == "mobile" for cl in f["clientLayers"])]
    assert len(mobile_docs) == 1


def test_serverindex_touchpoints_carry_project():
    consolidation = {"consolidated": [_fe("订单", "seller-portal"), _fe("订单", "buyer-web")],
                     "standalone": [], "infrastructure": []}
    associations = [_assoc("订单", "frontend", "seller-portal", "seller-orders"),
                    _assoc("订单", "frontend", "buyer-web", "buyer-orders")]
    result = assemble_features(associations, consolidation)
    tps = result["serverIndex"]["seller-orders"]["touchpoints"]
    assert tps[0]["project"] == "seller-portal"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd <repo>/understand-anything-plugin/skills/understand-business && python3 -m pytest tests/test_assemble_collision.py -v`
Expected: FAIL — today `test_two_frontend_projects_split` returns 1 feature (merged by name), ids lack `@project`, and touchpoints lack `project`.

- [ ] **Step 3a: Add `project: None` default to `_build_feature_document` return**

In `assemble_business_features.py`, replace the return block (lines 100-106):

```python
    return {
        'id': f'feature:{name}',
        'name': name,
        'clientLayers': client_layers,
        'clientLayer': client_layers[0] if client_layers else {},  # backward-compat
        'serverLayer': server_layer,
    }
```

with:

```python
    return {
        'id': f'feature:{name}',
        'name': name,
        'project': None,
        'clientLayers': client_layers,
        'clientLayer': client_layers[0] if client_layers else {},  # backward-compat
        'serverLayer': server_layer,
    }
```

- [ ] **Step 3b: Add `project` to serverIndex touchpoints**

In `_merge_server_associations`, replace the loop body (lines 129-166):

```python
    for assoc in associations:
        if assoc.get('error'):
            continue
        feature_name = assoc.get('featureName', '')
        # Prefer the association's own facet (each facet contributes its own
        # correctly-labeled touchpoints); fall back to facet_map for old phase2
        # files that predate the additive facetType key.
        facet = assoc.get('facetType') or facet_map.get(feature_name, 'unknown')

        primary = assoc.get('primaryServer')
        if primary and isinstance(primary, dict):
            domain = primary.get('domain', '')
            if domain:
                entry = _ensure(domain, primary.get('service', ''))
                # Dedup features/refCount: one feature NAME may have a primary
                # association per facet (mobile + frontend) pointing at the same
                # domain, but it is still ONE feature. The touchpoint append below
                # stays UNCONDITIONAL so each facet's primary touchpoint is recorded
                # (capability_review's >=2-facet gate depends on it).
                if feature_name not in entry['features']:
                    entry['features'].append(feature_name)
                    entry['refCount'] += 1
                entry['touchpoints'].append(
                    {'feature': feature_name, 'facet': facet, 'role': 'primary'}
                )

        for s in (assoc.get('supportingServers') or []):
            if not isinstance(s, dict):
                continue
            domain = s.get('domain', '')
            if domain:
                entry = _ensure(domain, s.get('service', ''))
                if feature_name not in entry['features']:
                    entry['features'].append(feature_name)
                    entry['refCount'] += 1
                entry['touchpoints'].append(
                    {'feature': feature_name, 'facet': facet, 'role': 'supporting'}
                )

    return index
```

with (canonicalize facet + record project on each touchpoint):

```python
    from facets import canonical_facet

    for assoc in associations:
        if assoc.get('error'):
            continue
        feature_name = assoc.get('featureName', '')
        # Prefer the association's own facet (each facet contributes its own
        # correctly-labeled touchpoints); fall back to facet_map for old phase2
        # files that predate the additive facetType key.
        facet = canonical_facet(assoc.get('facetType') or facet_map.get(feature_name, 'unknown'))
        project = assoc.get('project')

        primary = assoc.get('primaryServer')
        if primary and isinstance(primary, dict):
            domain = primary.get('domain', '')
            if domain:
                entry = _ensure(domain, primary.get('service', ''))
                if feature_name not in entry['features']:
                    entry['features'].append(feature_name)
                    entry['refCount'] += 1
                entry['touchpoints'].append(
                    {'feature': feature_name, 'facet': facet, 'project': project, 'role': 'primary'}
                )

        for s in (assoc.get('supportingServers') or []):
            if not isinstance(s, dict):
                continue
            domain = s.get('domain', '')
            if domain:
                entry = _ensure(domain, s.get('service', ''))
                if feature_name not in entry['features']:
                    entry['features'].append(feature_name)
                    entry['refCount'] += 1
                entry['touchpoints'].append(
                    {'feature': feature_name, 'facet': facet, 'project': project, 'role': 'supporting'}
                )

    return index
```

- [ ] **Step 3c: Rewrite `assemble_features` with the Option-A collision rule**

Replace the whole `assemble_features` function (lines 196-258):

```python
def assemble_features(associations: list, consolidation: dict) -> dict:
    """Assemble feature-centric documents from associations and consolidation data."""
    # Build name→[feature_data] lookup; list supports multiple facets per feature name.
    feature_lookup: dict = {}
    facet_map: dict = {}
    for f in consolidation.get('consolidated', []):
        feature_lookup.setdefault(f['name'], []).append(f)
        facet_map.setdefault(f['name'], f.get('facetType', 'unknown'))
    for f in consolidation.get('standalone', []):
        feature_lookup.setdefault(f['name'], []).append({
            'name': f['name'],
            'implType': f.get('implType', 'native-specific'),
            'platforms': [f.get('platform', '')],
            'deliveryPlatforms': f.get('deliveryPlatforms', []),
            'implementations': [],
            'mergedSummary': '',
            'facetType': f.get('facetType', 'mobile'),
        })
        facet_map.setdefault(f['name'], f.get('facetType', 'mobile'))

    # Group associations by feature name (a name may have one association per facet).
    assoc_by_name: dict = {}
    for assoc in associations:
        assoc_by_name.setdefault(assoc.get('featureName', ''), []).append(assoc)

    # Ordered unique feature names: consolidation order first (insertion-ordered
    # feature_lookup), then any association-only names not in consolidation.
    ordered_names = list(feature_lookup.keys())
    for name in assoc_by_name:
        if name not in feature_lookup:
            ordered_names.append(name)

    # Build feature documents — ONE per unique feature name.
    features = []
    with_association = 0
    for name in ordered_names:
        feature_data_list = feature_lookup.get(name) or [{
            'name': name,
            'implType': 'unknown',
            'platforms': [],
            'deliveryPlatforms': [],
            'implementations': [],
            'mergedSummary': '',
            'facetType': 'unknown',
        }]
        assocs = assoc_by_name.get(name) or [{}]
        merged = _merge_feature_associations(assocs)
        doc = _build_feature_document(feature_data_list, merged)
        features.append(doc)
        if doc['serverLayer']['primaryDomain'] is not None:
            with_association += 1

    server_index = _merge_server_associations(associations, facet_map)

    return {
        'features': features,
        'serverIndex': server_index,
        'stats': {
            'totalFeatures': len(features),
            'withServerAssociation': with_association,
            'serverDomainsReferenced': len(server_index),
        },
    }
```

with:

```python
def assemble_features(associations: list, consolidation: dict) -> dict:
    """Assemble feature-centric documents from associations and consolidation data.

    Frontend projects are merge boundaries: a name shared by 2+ distinct frontend
    projects splits into one business feature per project (id=feature:<name>@<project>),
    and any non-frontend (e.g. mobile) member with that name becomes its own feature.
    A name with <=1 distinct frontend project keeps today's behavior — all facets
    combine into one business feature (preserves frontend↔mobile same-name merge).
    """
    from facets import canonical_facet, FRONTEND_FACET_TYPES

    def _is_frontend(fd):
        return canonical_facet(fd.get('facetType', '')) in FRONTEND_FACET_TYPES

    # Build name→[feature_data] lookup; list supports multiple facets/projects per name.
    feature_lookup: dict = {}
    facet_map: dict = {}
    for f in consolidation.get('consolidated', []):
        feature_lookup.setdefault(f['name'], []).append(f)
        facet_map.setdefault(f['name'], f.get('facetType', 'unknown'))
    for f in consolidation.get('standalone', []):
        feature_lookup.setdefault(f['name'], []).append({
            'name': f['name'],
            'implType': f.get('implType', 'native-specific'),
            'platforms': [f.get('platform', '')],
            'deliveryPlatforms': f.get('deliveryPlatforms', []),
            'implementations': [],
            'mergedSummary': '',
            'facetType': f.get('facetType', 'mobile'),
            'project': f.get('project'),
        })
        facet_map.setdefault(f['name'], f.get('facetType', 'mobile'))

    # Index associations: by name (merge case) and by precise (facet, project, name).
    assoc_by_name: dict = {}
    assoc_by_key: dict = {}
    for assoc in associations:
        nm = assoc.get('featureName', '')
        assoc_by_name.setdefault(nm, []).append(assoc)
        key = (canonical_facet(assoc.get('facetType', '')), assoc.get('project') or '', nm)
        assoc_by_key[key] = assoc

    ordered_names = list(feature_lookup.keys())
    for name in assoc_by_name:
        if name not in feature_lookup:
            ordered_names.append(name)

    features = []
    with_association = 0

    def _count(doc):
        nonlocal with_association
        if doc['serverLayer']['primaryDomain'] is not None:
            with_association += 1

    for name in ordered_names:
        data_list = feature_lookup.get(name) or [{
            'name': name, 'implType': 'unknown', 'platforms': [],
            'deliveryPlatforms': [], 'implementations': [],
            'mergedSummary': '', 'facetType': 'unknown', 'project': None,
        }]
        frontend_data = [fd for fd in data_list if _is_frontend(fd)]
        other_data = [fd for fd in data_list if not _is_frontend(fd)]
        distinct_projects = sorted({
            fd.get('project') for fd in frontend_data if fd.get('project')
        })

        if len(distinct_projects) <= 1:
            # No cross-project collision: combine all facets into one feature (today's behavior).
            merged = _merge_feature_associations(assoc_by_name.get(name) or [{}])
            doc = _build_feature_document(data_list, merged)
            doc['project'] = distinct_projects[0] if distinct_projects else None
            features.append(doc)
            _count(doc)
            continue

        # Collision: split each frontend project into its own business feature.
        for p in distinct_projects:
            p_data = [fd for fd in frontend_data if fd.get('project') == p]
            assoc = assoc_by_key.get(('frontend', p, name)) or {}
            doc = _build_feature_document(p_data, assoc)
            doc['id'] = f'feature:{name}@{p}'
            doc['project'] = p
            features.append(doc)
            _count(doc)
        # Non-frontend members (e.g. mobile) become their own business feature.
        if other_data:
            other_assocs = [
                assoc_by_key.get((canonical_facet(fd.get('facetType', '')),
                                  fd.get('project') or '', name))
                for fd in other_data
            ]
            merged = _merge_feature_associations([a for a in other_assocs if a] or [{}])
            doc = _build_feature_document(other_data, merged)
            features.append(doc)
            _count(doc)

    server_index = _merge_server_associations(associations, facet_map)

    return {
        'features': features,
        'serverIndex': server_index,
        'stats': {
            'totalFeatures': len(features),
            'withServerAssociation': with_association,
            'serverDomainsReferenced': len(server_index),
        },
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd <repo>/understand-anything-plugin/skills/understand-business && python3 -m pytest tests/test_assemble_collision.py tests/test_feature_assembler.py -v`
Expected: PASS (new collision suite + existing assembler suite still green)

- [ ] **Step 5: Commit**

```bash
cd <repo>
git add understand-anything-plugin/skills/understand-business/assemble_business_features.py \
        understand-anything-plugin/skills/understand-business/tests/test_assemble_collision.py
git commit -m "feat(business): project-boundary collision rule + project touchpoints in assembly

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2.5: Add `frontendMergeGroups` to the system.json schema

**Files:**
- Modify: `understand-anything-plugin/skills/understand-business/schemas/system.schema.json:13-23`
- Test: `understand-anything-plugin/skills/understand-business/tests/test_schema_merge_groups.py`

- [ ] **Step 1: Write the failing test**

Create `UB/tests/test_schema_merge_groups.py`:

```python
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from detect_platforms import validate_system_json


def test_frontend_merge_groups_validate(tmp_path):
    ua = tmp_path / ".understand-anything"
    ua.mkdir(parents=True)
    (ua / "system.json").write_text(json.dumps({
        "facets": [{
            "type": "frontend", "name": "web", "path": "web",
            "subPaths": ["seller-portal", "ops-web"],
            "frontendMergeGroups": [
                {"canonicalName": "订单", "members": [
                    {"project": "seller-portal", "feature": "订单"},
                    {"project": "ops-web", "feature": "订单管理"}]}
            ],
        }]
    }, ensure_ascii=False), encoding="utf-8")
    result = validate_system_json(str(tmp_path))
    assert result["valid"] is True, result["errors"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd <repo>/understand-anything-plugin/skills/understand-business && python3 -m pytest tests/test_schema_merge_groups.py -v`
Expected: PASS if `jsonschema` permits extra properties (Draft7 allows unknown props by default). If `jsonschema` is not installed, `_basic_validate` ignores the field and it also passes. Either way, this test pins the behavior. If it FAILS (a stricter schema rejects it), proceed to Step 3.

- [ ] **Step 3: Add the property to the facet definition**

In `UB/schemas/system.schema.json`, inside the `facet` definition `properties` (after the `platformMapping` line 22), add:

```json
        "platformMapping": { "type": "object" },
        "frontendMergeGroups": {
          "type": "array",
          "items": {
            "type": "object",
            "required": ["canonicalName", "members"],
            "properties": {
              "canonicalName": { "type": "string" },
              "members": {
                "type": "array",
                "items": {
                  "type": "object",
                  "required": ["project", "feature"],
                  "properties": {
                    "project": { "type": "string" },
                    "feature": { "type": "string" }
                  }
                }
              }
            }
          }
        }
```

(Replace the existing `"platformMapping": { "type": "object" }` line with the block above so the new key sits alongside it.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd <repo>/understand-anything-plugin/skills/understand-business && python3 -m pytest tests/test_schema_merge_groups.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd <repo>
git add understand-anything-plugin/skills/understand-business/schemas/system.schema.json \
        understand-anything-plugin/skills/understand-business/tests/test_schema_merge_groups.py
git commit -m "feat(business): schema for frontendMergeGroups in system.json frontend facet

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2.6: Full regression + SKILL.md docs

**Files:**
- Modify: `understand-anything-plugin/skills/understand-business/SKILL.md` (document `frontendMergeGroups` + project-boundary behavior)
- Modify: `understand-anything-plugin/skills/understand-wiki/SKILL.md` (note per-project frontend features)

- [ ] **Step 1: Run both skill suites**

Run:
```
cd <repo>/understand-anything-plugin/skills/understand-business && python3 -m pytest tests/ -v
cd <repo>/understand-anything-plugin/skills/understand-wiki && python3 -m pytest tests/ -v
```
Expected: PASS, except the 4 known-stale `test_association_discovery.py` failures (non-regressions per memory). Fix any NEW failures.

- [ ] **Step 2: Document the config in `understand-business/SKILL.md`**

Find the section describing `system.json` facets (around the frontend facet description) and add this subsection verbatim:

```markdown
#### Frontend project boundary

Each frontend project (sub-repo) is a business boundary. Features are NOT merged
across projects by name — two projects that both have a feature named "订单" produce
two independent business features. To merge specific cross-project features into one
business, declare them explicitly in the frontend facet:

​```json
{
  "type": "frontend",
  "name": "web",
  "path": "web",
  "subPaths": ["seller-portal", "ops-web"],
  "frontendMergeGroups": [
    { "canonicalName": "订单",
      "members": [
        { "project": "seller-portal", "feature": "订单" },
        { "project": "ops-web", "feature": "订单管理" }
      ] }
  ]
}
​```

A frontend feature and a same-named mobile feature still merge into one business
feature (web+app), unless 2+ frontend projects collide on that name — then each
frontend project splits out and the mobile feature stands alone.
```

- [ ] **Step 3: Note per-project features in `understand-wiki/SKILL.md`**

Find the `build-frontend-graph` description and add this line verbatim:

```markdown
- Features are emitted per project (id `feature:<repo>:<domain>`, `project` field, `sourceRepos=[repo]`). Cross-project merges happen only via the frontend facet's `frontendMergeGroups` in system.json; `domainLinks` are emitted only for those explicit groups.
```

- [ ] **Step 4: Commit**

```bash
cd <repo>
git add understand-anything-plugin/skills/understand-business/SKILL.md \
        understand-anything-plugin/skills/understand-wiki/SKILL.md
git commit -m "docs: document frontend project boundary + frontendMergeGroups

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review Checklist (completed by plan author)

- **Spec coverage:** Phase 1 covers registry (1.1), all 6 consumers (1.2 scenario_detector, 1.3 check_facets, 1.4 client_facets, 1.5 detect_platforms + schema + backend compat, 1.6 assemble `_FRONTEND_FACETS`), anti-drift test (1.7). Phase 2 covers frontend aggregation no-merge + explicit groups (2.1), consolidate_frontend project (2.2), association keying (2.3), assemble collision rule + touchpoints (2.4), schema for merge groups (2.5), regression + docs (2.6). All spec sections map to a task.
- **Out-of-scope honored:** Web↔Mobile semantic alignment untouched; collision rule preserves frontend↔mobile same-name merge for the ≤1-project case.
- **Type consistency:** `canonical_facet`, `graph_file_for`, `CLIENT_FACET_TYPES`, `SERVER_FACET_TYPES`, `FRONTEND_FACET_TYPES`, `CLIENT_PLATFORMS`, `SERVER_PLATFORMS`, `ALL_PLATFORMS` defined in Task 1.1 and used consistently in later tasks. Feature id forms: frontend-graph `feature:<repo>:<domain>` (Task 2.1), business split `feature:<name>@<project>` (Task 2.4) — intentionally distinct layers. `project` field threaded through 2.1→2.2→2.3→2.4.
- **Known stale tests:** `test_association_discovery.py` has 4 pre-existing failures (memory) — not introduced here; do not block on them, but do not add new failures.
