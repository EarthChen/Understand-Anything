# Batch Source Queries + Universal POST Transport Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an agent read multiple source files / symbols in one CLI call, and route **every** CLI request over HTTP POST (JSON body, no URL encoding) backed by universal server-side POST support.

**Architecture:** Server gains universal POST via one central middleware shim (JSON body merged into `searchParams`; handlers untouched). The CLI's shared `fetch_json` is changed to `(server, path, params)` and POSTs the dict as JSON — dropping URL encoding entirely and supporting future structured bodies; the function name is kept so existing `patch("_helpers.fetch_json")` sites are unaffected. Batching is CLI-side aggregation (one tool call → N internal POST reads, per-item error isolation).

**Tech Stack:** Python 3.10+ stdlib (`urllib`, `argparse`, `re`, `json`), `coverage` (dev), Express 5 + TypeScript, Vitest, pytest.

## Global Constraints

- Python CLI is **stdlib-only** at runtime — `coverage` is dev-only.
- TypeScript strict mode; ESM modules.
- Single-item shapes/exit codes must remain **unchanged** (backward compatibility).
- Server must keep accepting **GET** on all routes after adding POST.
- **Implement the server POST shim first** — the CLI will POST every request; an old GET-only server would 404/405.
- **100% line coverage** for `ua_query, _commands, _helpers, _utils`, enforced by `coverage report --fail-under=100`.
- Spec: `docs/superpowers/specs/2026-06-18-batch-source-queries-and-post-transport-design.md`.

## File Structure

- `understand-anything-plugin/packages/dashboard/src/api/utils.ts` — `mergePostBody`.
- `understand-anything-plugin/packages/dashboard/server.ts` — `express.json()` + POST shim.
- `understand-anything-plugin/skills/understand-query/_utils.py` — `fetch_json` signature→POST, `_read_json_response`; two new `_format_markdown` branches.
- `understand-anything-plugin/skills/understand-query/_helpers.py` — migrate 10 call sites; `_parse_file_specs`; `_cmd_structure_symbol` multi-symbol.
- `understand-anything-plugin/skills/understand-query/_commands.py` — migrate 53 call sites; `cmd_source` multi-file.
- `understand-anything-plugin/skills/understand-query/ua_query.py` — update `from _utils import` list.
- `.coveragerc` (repo root) — coverage config.
- Tests: `tests/understand-query/*.py`; `packages/dashboard/src/__tests__/api-merge-post-body.test.ts`.

**Run commands** (from repo root):
- Python + coverage: `python3 -m coverage run -m pytest tests/understand-query/ && python3 -m coverage report --fail-under=100`
- TS: `pnpm --filter @understand-anything/dashboard test`

---

### Task 1: Universal server-side POST support

**Files:**
- Modify: `understand-anything-plugin/packages/dashboard/src/api/utils.ts` (add `mergePostBody`)
- Modify: `understand-anything-plugin/packages/dashboard/server.ts`
- Test: `understand-anything-plugin/packages/dashboard/src/__tests__/api-merge-post-body.test.ts` (new)

**Interfaces:**
- Produces: `mergePostBody(searchParams: URLSearchParams, body: unknown): void` — sets each own key of a plain-object `body` onto `searchParams` as a string; skips null/undefined; no-op for non-objects.

- [ ] **Step 1: Write failing test**

Create `understand-anything-plugin/packages/dashboard/src/__tests__/api-merge-post-body.test.ts`:
```typescript
import { describe, it, expect } from "vitest"
import { mergePostBody } from "../api/utils"

describe("mergePostBody", () => {
  it("merges body keys into searchParams as strings", () => {
    const sp = new URLSearchParams()
    mergePostBody(sp, { file: "A.java", start: 10 })
    expect(sp.get("file")).toBe("A.java")
    expect(sp.get("start")).toBe("10")
  })
  it("body overrides existing query keys", () => {
    const sp = new URLSearchParams("q=old")
    mergePostBody(sp, { q: "new" })
    expect(sp.get("q")).toBe("new")
  })
  it("skips null/undefined and ignores non-object body", () => {
    const sp = new URLSearchParams("q=keep")
    mergePostBody(sp, { a: null, b: undefined })
    mergePostBody(sp, "not-an-object")
    expect(sp.get("a")).toBeNull()
    expect(sp.get("q")).toBe("keep")
  })
})
```

- [ ] **Step 2: Run — verify failure**

Run: `pnpm --filter @understand-anything/dashboard test -- api-merge-post-body`
Expected: FAIL — `mergePostBody` not exported from `../api/utils`.

- [ ] **Step 3: Implement `mergePostBody`**

Append to `understand-anything-plugin/packages/dashboard/src/api/utils.ts`:
```typescript
/**
 * Merge a parsed JSON POST body into a URLSearchParams so handlers (which read
 * from searchParams) transparently support POST. Body values override query
 * params on key conflict; null/undefined are skipped; non-object bodies no-op.
 */
export function mergePostBody(searchParams: URLSearchParams, body: unknown): void {
  if (!body || typeof body !== "object") return
  for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
    if (value !== null && value !== undefined) {
      searchParams.set(key, String(value))
    }
  }
}
```

- [ ] **Step 4: Run — verify pass**

Run: `pnpm --filter @understand-anything/dashboard test -- api-merge-post-body`
Expected: PASS (3 tests)

- [ ] **Step 5: Wire into `server.ts`**

Change the utils import to include `mergePostBody`:
```typescript
import { resolveProjectRoot, mergePostBody } from "./src/api/utils"
```
After `const app = express()` (~line 21), add the JSON body parser:
```typescript
  app.use(express.json({ limit: "5mb" }))
```
In the dispatch middleware (~lines 38-44), merge POST bodies before routing:
```typescript
  app.use(async (req, res, next) => {
    try {
      const url = new URL(req.url, `http://127.0.0.1`)
      const searchParams = url.searchParams
      if (req.method === "POST") mergePostBody(searchParams, req.body)
      const apiRes = await router.handle(
        { pathname: url.pathname, searchParams },
        { getWikiService },
      )
```

- [ ] **Step 6: Build + full dashboard test suite**

Run: `pnpm --filter @understand-anything/dashboard build && pnpm --filter @understand-anything/dashboard test`
Expected: build succeeds (strict TS); all tests green.

- [ ] **Step 7: Commit**

```bash
git add understand-anything-plugin/packages/dashboard/src/api/utils.ts \
        understand-anything-plugin/packages/dashboard/server.ts \
        understand-anything-plugin/packages/dashboard/src/__tests__/api-merge-post-body.test.ts
git commit -m "feat(dashboard): accept POST on all API routes via central body→searchParams shim"
```

---

### Task 2: Switch CLI transport to POST (all requests) + coverage gate

This is one atomic change: `fetch_json`'s signature changes, so all 63 call sites and the ~168 URL-asserting tests move together in a single green commit.

**Files:**
- Create: `.coveragerc` (repo root)
- Modify: `understand-anything-plugin/skills/understand-query/_utils.py` (`fetch_json`, `_read_json_response`)
- Modify: `understand-anything-plugin/skills/understand-query/ua_query.py`, `_helpers.py`, `_commands.py` (call sites + imports)
- Test: all of `tests/understand-query/*.py`

**Interfaces:**
- Produces: `fetch_json(server: str, path: str, params: dict | None = None, timeout: int = DEFAULT_TIMEOUT) -> Any` — issues HTTP **POST** with `json.dumps(params or {})` body; same return value + `ServerUnavailableError`/`RuntimeError` semantics as before.

- [ ] **Step 1: Add coverage config + confirm current 100%**

Install dev tool and create `.coveragerc` at repo root:
```ini
[run]
source =
    understand-anything-plugin/skills/understand-query
omit =
    */__pycache__/*

[report]
fail_under = 100
show_missing = True
```
Run: `python3 -m pip install coverage && python3 -m coverage run -m pytest tests/understand-query/ -q && python3 -m coverage report`
Expected: tests green; report shows the 4 modules at (or near) 100% — this is the baseline to preserve.

- [ ] **Step 2: Write failing test for the POST transport**

In `tests/understand-query/test_ua_query.py` `TestHttpClient`, add:
```python
    def test_fetch_json_posts_json_body(self):
        captured = {}

        class _Resp:
            def read(self): return b'{"ok": true}'
            def __enter__(self): return self
            def __exit__(self, *a): return False

        def fake_urlopen(req, timeout=None):
            captured["method"] = req.get_method()
            captured["url"] = req.full_url
            captured["ctype"] = req.headers.get("Content-type")
            captured["data"] = req.data
            return _Resp()

        with patch("urllib.request.urlopen", fake_urlopen):
            data = ua_query.fetch_json("http://s", "/api/source", {"file": "A.java"})
        assert data == {"ok": True}
        assert captured["method"] == "POST"
        assert captured["url"] == "http://s/api/source"
        assert captured["ctype"] == "application/json"
        assert json.loads(captured["data"]) == {"file": "A.java"}

    def test_fetch_json_empty_params_posts_empty_object(self):
        class _Resp:
            def read(self): return b'{}'
            def __enter__(self): return self
            def __exit__(self, *a): return False
        captured = {}
        def fake_urlopen(req, timeout=None):
            captured["data"] = req.data
            return _Resp()
        with patch("urllib.request.urlopen", fake_urlopen):
            ua_query.fetch_json("http://s", "/api/services")
        assert json.loads(captured["data"]) == {}
```

- [ ] **Step 3: Run — verify failure**

Run: `python3 -m pytest tests/understand-query/test_ua_query.py::TestHttpClient -k posts -v`
Expected: FAIL — current `fetch_json(url)` signature: positional `(server, path, params)` is mis-parsed; no POST.

- [ ] **Step 4: Reimplement `fetch_json` as POST**

In `_utils.py`, replace `fetch_json` (keep the existing inline error handling; only the request construction changes from GET-on-a-URL to POST-with-a-body):
```python
def fetch_json(server: str, path: str, params: dict | None = None, timeout: int = DEFAULT_TIMEOUT) -> Any:
    """POST `params` as a JSON body to `server + path` and return parsed JSON.

    POST (not GET) so large/batch requests have no URL-length ceiling and free-text
    values never pass through query-string encoding.
    """
    url = f"{server.rstrip('/')}{path}"
    req = urllib.request.Request(
        url,
        data=json.dumps(params or {}).encode("utf-8"),
        headers={"Accept": "application/json", "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        try:
            err = json.loads(body)
        except json.JSONDecodeError:
            err = {"error": body}
        suggestions = err.get("suggestions", [])
        msg = f"HTTP {e.code}: {err.get('error', body)}"
        if suggestions:
            msg += "\n\nDid you mean:\n" + "\n".join(
                f"  - {s.get('name', s.get('id', '?'))} ({s.get('type', '?')})" for s in suggestions[:8]
            )
        raise RuntimeError(msg) from e
    except (TimeoutError, OSError) as e:
        if "timed out" in str(e).lower() or isinstance(e, TimeoutError):
            raise RuntimeError(f"Request timed out ({timeout}s): {url}") from e
        raise ServerUnavailableError(
            f"API Server unavailable at {url}. "
            f"Start it with: cd understand-anything-plugin/packages/dashboard && pnpm run serve\n"
            f"Detail: {e}"
        ) from e
```
`build_url` stays in the file (still imported by tests); it is simply no longer used to issue requests.

- [ ] **Step 5: Migrate all 63 call sites (mechanical rule)**

Find every site:
```bash
grep -rn "fetch_json(build_url(" understand-anything-plugin/skills/understand-query/_helpers.py \
                                  understand-anything-plugin/skills/understand-query/_commands.py
```
Apply the rule to each — unwrap `build_url`:
- `fetch_json(build_url(SERVER, PATH, PARAMS))` → `fetch_json(SERVER, PATH, PARAMS)`
- `_helpers.fetch_json(build_url(SERVER, PATH, PARAMS))` → `_helpers.fetch_json(SERVER, PATH, PARAMS)`
- no-params form `fetch_json(build_url(SERVER, PATH))` → `fetch_json(SERVER, PATH)`

Examples (verify against real lines):
```python
# _helpers.py _search_api
data = fetch_json(server, "/api/search", params)
# _commands.py cmd_kg neighbors
return _helpers.fetch_json(args.server, "/api/graph-query/neighbors", params)
# _commands.py cmd_wiki f-string path (unchanged path arg)
return _helpers.fetch_json(args.server, f"/api/wiki/domain/{cross_domain}", {})
```
There must be **zero** remaining `fetch_json(build_url(` matches after this step (re-run the grep).

- [ ] **Step 6: Update `from _utils import` lists**

`fetch_json` keeps its name, so import lists in `ua_query.py` and `_helpers.py` need no name change. Confirm `build_url` is still imported where any test or remaining code references it (it is in `ua_query.py` and `_helpers.py`). No edit unless a grep shows an unused-import lint error.

- [ ] **Step 7: Rewrite the ~168 URL-asserting tests (mechanical rule)**

Find them:
```bash
grep -rn "call_args\[0\]\[0\]\| in url\b" tests/understand-query/
```
`fetch_json` is now called positionally as `(server, path, params)`, so `call_args[0]` is `(server, path, params)`. Apply:
- `url = mock.call_args[0][0]` → `path_arg = mock.call_args[0][1]; params_arg = mock.call_args[0][2]`
- `assert "/api/x" in url` → `assert path_arg == "/api/x"` (or `.startswith` for f-string paths with ids)
- `assert "k=v" in url` → `assert params_arg["k"] == "v"`
- `assert "k=" not in url` → `assert "k" not in params_arg`  (covers the prior limit-fix tests: `test_source_mode_omits_limit_when_unset`, `test_structure_symbol_source_omits_limit_when_unset`)
- multi-call: `mock.call_args_list[i][0][1]` / `[i][0][2]`

For f-string-path endpoints (e.g. `/api/wiki/service/<svc>/domain/<d>`) assert with `.startswith("/api/wiki/service/")` or full expected path. Work module by module: `test_subcommands.py`, `test_ua_query.py`, `test_commands_cov.py`, `test_helpers_cov.py`, `test_utils_cov.py`.

- [ ] **Step 8: Run full suite + coverage gate**

Run: `python3 -m coverage run -m pytest tests/understand-query/ -q && python3 -m coverage report --fail-under=100`
Expected: all tests PASS; coverage report exits 0 (100%). If `report` lists missing lines (e.g. an untouched branch in the new `fetch_json`/`_read_json_response`), add a targeted test and re-run.

- [ ] **Step 9: Commit**

```bash
git add .coveragerc understand-anything-plugin/skills/understand-query/ tests/understand-query/
git commit -m "feat(understand-query): POST all CLI requests as JSON body; enforce 100% coverage"
```

---

### Task 3: Multi-file source read (`source --file a,b,c` with per-file ranges)

**Files:**
- Modify: `understand-anything-plugin/skills/understand-query/_helpers.py` (add `_parse_file_specs`)
- Modify: `understand-anything-plugin/skills/understand-query/_commands.py` (`cmd_source` `--file` branch)
- Modify: `understand-anything-plugin/skills/understand-query/_utils.py` (`_format_markdown`, add `{files:[…]}` branch before the generic dict fallback)
- Test: `tests/understand-query/test_helpers_cov.py`, `test_ua_query.py`, `test_utils_cov.py`

**Interfaces:**
- Consumes: `fetch_json(server, path, params)` (Task 2).
- Produces: `_helpers._parse_file_specs(raw: str) -> list[tuple[str, int | None, int | None]]`
- Produces (result shape): multi → `{"files": [{"file","lineRange","content","lineCount"} | {"file","error"}]}`; single → unchanged `{file, content, lineCount}`.

- [ ] **Step 1: Failing test — spec parser**

In `tests/understand-query/test_helpers_cov.py` add:
```python
class TestParseFileSpecs:
    def test_plain_paths(self):
        assert _helpers._parse_file_specs("a.java,b.java") == [
            ("a.java", None, None), ("b.java", None, None)]
    def test_inline_ranges_and_mixed(self):
        assert _helpers._parse_file_specs("a.java:1-60,b.java,c.java:20-80") == [
            ("a.java", 1, 60), ("b.java", None, None), ("c.java", 20, 80)]
    def test_strips_and_skips_empty(self):
        assert _helpers._parse_file_specs(" a.java , ,b.java ") == [
            ("a.java", None, None), ("b.java", None, None)]
```

- [ ] **Step 2: Run — verify fail**

Run: `python3 -m pytest tests/understand-query/test_helpers_cov.py::TestParseFileSpecs -v`
Expected: FAIL — `_parse_file_specs` missing.

- [ ] **Step 3: Implement `_parse_file_specs`**

In `_helpers.py` (`re` already imported):
```python
_FILE_RANGE_RE = re.compile(r":(\d+)-(\d+)$")


def _parse_file_specs(raw: str) -> list[tuple[str, int | None, int | None]]:
    """Split a comma-separated --file value into (path, start, end) specs.
    Only a trailing ':<start>-<end>' is treated as a line range; empty parts skipped."""
    specs: list[tuple[str, int | None, int | None]] = []
    for part in raw.split(","):
        part = part.strip()
        if not part:
            continue
        m = _FILE_RANGE_RE.search(part)
        if m:
            specs.append((part[: m.start()], int(m.group(1)), int(m.group(2))))
        else:
            specs.append((part, None, None))
    return specs
```

- [ ] **Step 4: Run — verify pass**

Run: `python3 -m pytest tests/understand-query/test_helpers_cov.py::TestParseFileSpecs -v`
Expected: PASS (3)

- [ ] **Step 5: Failing tests — multi-file `cmd_source`**

In `tests/understand-query/test_ua_query.py` add:
```python
class TestSourceMultiFile:
    @patch("_helpers.fetch_json")
    def test_multi_file_aggregates(self, mock_fetch):
        mock_fetch.side_effect = [
            {"file": "A.java", "content": "AAA", "lineCount": 3},
            {"file": "B.java", "content": "BBB", "lineCount": 3}]
        out = ua_query.cmd_source(ua_query.parse_args(
            ["source", "--service", "svc", "--file", "A.java,B.java"]))
        assert [f["file"] for f in out["files"]] == ["A.java", "B.java"]
        assert out["files"][0]["content"] == "AAA"

    @patch("_helpers.fetch_json")
    def test_inline_range_sent_as_params(self, mock_fetch):
        mock_fetch.side_effect = [
            {"file": "A.java", "content": "x", "lineCount": 1},
            {"file": "B.java", "content": "y", "lineCount": 1}]
        ua_query.cmd_source(ua_query.parse_args(
            ["source", "--service", "svc", "--file", "A.java:10-20,B.java"]))
        server, path, params = mock_fetch.call_args_list[0][0][:3]
        assert path == "/api/source"
        assert params["start"] == "10" and params["end"] == "20"

    @patch("_helpers.fetch_json")
    def test_per_file_error_isolated(self, mock_fetch):
        mock_fetch.side_effect = [RuntimeError("HTTP 404: nope"),
                                  {"file": "B.java", "content": "ok", "lineCount": 1}]
        out = ua_query.cmd_source(ua_query.parse_args(
            ["source", "--service", "svc", "--file", "A.java,B.java"]))
        assert out["files"][0]["error"].startswith("HTTP 404")
        assert out["files"][1]["content"] == "ok"

    @patch("_helpers.fetch_json")
    def test_single_file_shape_unchanged(self, mock_fetch):
        mock_fetch.return_value = {"file": "A.java", "content": "x", "lineCount": 1}
        out = ua_query.cmd_source(ua_query.parse_args(
            ["source", "--service", "svc", "--file", "A.java"]))
        assert out == {"file": "A.java", "content": "x", "lineCount": 1}
```

- [ ] **Step 6: Run — verify fail**

Run: `python3 -m pytest tests/understand-query/test_ua_query.py::TestSourceMultiFile -v`
Expected: FAIL — multi-file returns single shape; `out["files"]` KeyError.

- [ ] **Step 7: Implement multi-file `cmd_source`**

In `_commands.py`, replace the `if getattr(args, "file", None):` block in `cmd_source` with:
```python
    if getattr(args, "file", None):
        specs = _helpers._parse_file_specs(args.file)

        def _read_one(path: str, start: int | None, end: int | None) -> Any:
            params = {"file": path, "service": args.service, "mode": "graph"}
            s = start if start is not None else args.start
            e = end if end is not None else args.end
            if s:
                params["start"] = str(s)
            if e:
                params["end"] = str(e)
            return _helpers.fetch_json(args.server, "/api/source", params)

        if len(specs) <= 1:
            path, start, end = specs[0] if specs else (args.file, None, None)
            return _read_one(path, start, end)

        files_out: list[dict[str, Any]] = []
        for path, start, end in specs:
            try:
                data = _read_one(path, start, end)
                files_out.append({
                    "file": data.get("file", path),
                    "lineRange": data.get("lineRange"),
                    "content": data.get("content", data.get("source", "")),
                    "lineCount": data.get("lineCount", data.get("totalLines", 0)),
                })
            except RuntimeError as exc:
                files_out.append({"file": path, "error": str(exc)})
        return {"files": files_out}
```

- [ ] **Step 8: Run — verify pass**

Run: `python3 -m pytest tests/understand-query/test_ua_query.py -k "Source or source" -v`
Expected: PASS (new + existing source tests).

- [ ] **Step 9: Failing test — `{files:[…]}` markdown**

In `tests/understand-query/test_utils_cov.py` add:
```python
def test_format_markdown_source_files_batch():
    from _utils import _format_markdown
    md = _format_markdown({"files": [
        {"file": "A.java", "lineRange": [1, 3], "content": "AAA", "lineCount": 3},
        {"file": "B.java", "error": "HTTP 404: nope"}]})
    assert "# Source Files (2)" in md
    assert "## Source: A.java (lines 1-3)" in md
    assert "AAA" in md
    assert "> error: HTTP 404: nope" in md
```

- [ ] **Step 10: Run — verify fail**

Run: `python3 -m pytest tests/understand-query/test_utils_cov.py::test_format_markdown_source_files_batch -v`
Expected: FAIL.

- [ ] **Step 11: Implement `{files:[…]}` branch**

In `_utils.py` `_format_markdown`, immediately **before** the `# Generic dict fallback` block, add:
```python
    if (
        isinstance(data, dict)
        and isinstance(data.get("files"), list)
        and data["files"]
        and isinstance(data["files"][0], dict)
        and ("content" in data["files"][0] or "error" in data["files"][0])
    ):
        flines = [f"# Source Files ({len(data['files'])})", ""]
        for f in data["files"]:
            fp = f.get("file", "?")
            if f.get("error"):
                flines.append(f"## {fp}")
                flines.append(f"> error: {f['error']}")
                flines.append("")
                continue
            lr = f.get("lineRange")
            lr_str = f" (lines {lr[0]}-{lr[1]})" if isinstance(lr, list) and len(lr) == 2 else ""
            ext = fp.rsplit(".", 1)[-1] if "." in fp else "java"
            flines.append(f"## Source: {fp}{lr_str}")
            flines.append(f"```{_lang_for_ext(ext)}\n{f.get('content', '')[:6000]}\n```")
            flines.append("")
        return "\n".join(flines)
```

- [ ] **Step 12: Run — verify pass + coverage gate**

Run: `python3 -m coverage run -m pytest tests/understand-query/ -q && python3 -m coverage report --fail-under=100`
Expected: all green; coverage 100%.

- [ ] **Step 13: Commit**

```bash
git add understand-anything-plugin/skills/understand-query/ tests/understand-query/
git commit -m "feat(understand-query): batch multi-file source read with per-file line ranges"
```

---

### Task 4: Symbol batch (`structure --symbol a,b,c`)

**Files:**
- Modify: `understand-anything-plugin/skills/understand-query/_helpers.py` (`_cmd_structure_symbol`)
- Modify: `understand-anything-plugin/skills/understand-query/_utils.py` (`_format_markdown`, add `{symbols:[…]}` branch after the single `{symbol, matches}` branch)
- Test: `tests/understand-query/test_helpers_cov.py`, `test_utils_cov.py`

**Interfaces:**
- Consumes: `fetch_json(server, path, params)` (Task 2).
- Produces: single name → unchanged `{symbol, matches}`; multiple → `{"symbols": [{"symbol","matches"} | {"symbol","matches":[],"error"}]}`.

- [ ] **Step 1: Failing tests — multi-symbol dispatch**

In `tests/understand-query/test_helpers_cov.py` `TestCmdStructureSymbol` add:
```python
    @patch("_helpers.fetch_json")
    def test_multi_symbol_returns_groups(self, mock_fetch):
        mock_fetch.side_effect = [
            {"results": [{"name": "Foo", "source": "f"}]},
            {"results": [{"name": "Bar", "source": "b"}]}]
        args = argparse.Namespace(server=SERVER, service="svc", symbol="Foo,Bar",
                                  limit=None, path=None, source=True)
        out = _helpers._cmd_structure_symbol(args)
        assert [g["symbol"] for g in out["symbols"]] == ["Foo", "Bar"]
        assert out["symbols"][0]["matches"][0]["name"] == "Foo"

    @patch("_helpers.fetch_json")
    def test_multi_symbol_error_isolated(self, mock_fetch):
        mock_fetch.side_effect = [RuntimeError("HTTP 400: limit"), {"results": []}]
        args = argparse.Namespace(server=SERVER, service="svc", symbol="Foo,Bar",
                                  limit=None, path=None, source=True)
        out = _helpers._cmd_structure_symbol(args)
        assert out["symbols"][0]["error"].startswith("HTTP 400")
        assert out["symbols"][1] == {"symbol": "Bar", "matches": []}

    @patch("_helpers.fetch_json")
    def test_single_symbol_shape_unchanged(self, mock_fetch):
        mock_fetch.return_value = {"results": [{"name": "Foo", "source": "f"}]}
        args = argparse.Namespace(server=SERVER, service="svc", symbol="Foo",
                                  limit=None, path=None, source=True)
        out = _helpers._cmd_structure_symbol(args)
        assert out == {"symbol": "Foo", "matches": [{"name": "Foo", "source": "f"}]}
```

- [ ] **Step 2: Run — verify fail**

Run: `python3 -m pytest tests/understand-query/test_helpers_cov.py::TestCmdStructureSymbol -k multi_symbol -v`
Expected: FAIL — `"Foo,Bar"` treated as one name; no `out["symbols"]`.

- [ ] **Step 3: Refactor to single-helper + multi dispatch**

In `_helpers.py`, split `_cmd_structure_symbol` into `_structure_symbol_one(args, symbol)` (current body, but POST call sites from Task 2) + a dispatcher. Copy the non-source `matches` mapping verbatim from the current function:
```python
def _structure_symbol_one(args: argparse.Namespace, symbol: str) -> Any:
    include_source = getattr(args, "source", False)
    if include_source:
        params: dict[str, str] = {"service": args.service, "symbol": symbol}
        if args.limit is not None:
            params["limit"] = str(max(args.limit, 1))
        if args.path:
            params["pathPattern"] = args.path
        data = fetch_json(args.server, "/api/structure/symbol-source", params)
        return {"symbol": symbol, "matches": data.get("results", [])}
    limit = max(args.limit if args.limit is not None else 50, 1)
    params = {"service": args.service, "symbol": symbol, "limit": str(limit)}
    if args.path:
        params["pathPattern"] = args.path
    data = fetch_json(args.server, "/api/structure/search", params)
    results = data.get("results", [])
    matches = [
        {"name": r.get("name", ""), "kind": r.get("kind", ""),
         "filePath": r.get("filePath", ""), "lineRange": r.get("lineRange", []),
         "match": r.get("match", {})}
        for r in results
    ]
    return {"symbol": symbol, "matches": matches}


def _cmd_structure_symbol(args: argparse.Namespace) -> Any:
    names = [s.strip() for s in args.symbol.split(",") if s.strip()]
    if len(names) <= 1:
        return _structure_symbol_one(args, names[0] if names else args.symbol)
    groups: list[dict[str, Any]] = []
    for n in names:
        try:
            groups.append(_structure_symbol_one(args, n))
        except RuntimeError as exc:
            groups.append({"symbol": n, "matches": [], "error": str(exc)})
    return {"symbols": groups}
```
(Verify the non-source mapping matches the current source before committing.)

- [ ] **Step 4: Run — verify pass**

Run: `python3 -m pytest tests/understand-query/test_helpers_cov.py::TestCmdStructureSymbol -v`
Expected: PASS — multi + all existing single-symbol tests.

- [ ] **Step 5: Failing test — `{symbols:[…]}` markdown**

In `tests/understand-query/test_utils_cov.py` add:
```python
def test_format_markdown_symbols_batch():
    from _utils import _format_markdown
    md = _format_markdown({"symbols": [
        {"symbol": "Foo", "matches": [
            {"kind": "class", "name": "Foo", "filePath": "F.java", "lineRange": [1, 9], "source": "class Foo {}"}]},
        {"symbol": "Bar", "matches": [], "error": "HTTP 400: limit"}]})
    assert "# Symbols (2)" in md
    assert "## Foo" in md
    assert "class Foo {}" in md
    assert "> error: HTTP 400: limit" in md
```

- [ ] **Step 6: Run — verify fail**

Run: `python3 -m pytest tests/understand-query/test_utils_cov.py::test_format_markdown_symbols_batch -v`
Expected: FAIL.

- [ ] **Step 7: Implement `{symbols:[…]}` branch**

In `_utils.py` `_format_markdown`, immediately **after** the single-symbol branch, add:
```python
    if isinstance(data, dict) and isinstance(data.get("symbols"), list):
        slines = [f"# Symbols ({len(data['symbols'])})", ""]
        for g in data["symbols"]:
            slines.append(f"## {g.get('symbol', '?')}")
            if g.get("error"):
                slines.append(f"> error: {g['error']}")
                slines.append("")
                continue
            for m in g.get("matches", []):
                lr = m.get("lineRange", [])
                lr_str = f"L{lr[0]}-{lr[1]}" if lr and len(lr) == 2 else ""
                slines.append(f"### {m.get('kind', '?')} `{m.get('name', '?')}` — `{m.get('filePath', '?')}:{lr_str}`")
                source = m.get("source")
                if source:
                    ext = m.get("filePath", "").rsplit(".", 1)[-1] if "." in m.get("filePath", "") else "java"
                    slines.append(f"```{_lang_for_ext(ext)}\n{source}\n```")
            slines.append("")
        return "\n".join(slines)
```

- [ ] **Step 8: Run — verify pass + coverage gate**

Run: `python3 -m coverage run -m pytest tests/understand-query/ -q && python3 -m coverage report --fail-under=100`
Expected: all green; coverage 100%.

- [ ] **Step 9: Commit**

```bash
git add understand-anything-plugin/skills/understand-query/ tests/understand-query/
git commit -m "feat(understand-query): batch multi-symbol structure --symbol queries"
```

---

### Task 5: Docs, end-to-end verification, version bump, release

**Files:**
- Modify: `understand-anything-plugin/skills/understand-query/SKILL.md`, `docs/source-code.md`, `docs/structure-commands.md`
- Modify (version bump, per CLAUDE.md): `understand-anything-plugin/package.json`, `understand-anything-plugin/.claude-plugin/plugin.json`, `.claude-plugin/plugin.json`, `.cursor-plugin/plugin.json`, `.copilot-plugin/plugin.json`

- [ ] **Step 1: Document batch reads + POST**

In `docs/source-code.md` (source `--file` section):
```markdown
### Batch file read (one call, fewer tool calls)

Read several files at once — comma-separated, optional per-file line range:

```bash
python ua_query.py source --service S --file "A.java:1-60,B.java,C.java:20-80"
```
Returns `{files: [{file, lineRange, content, lineCount, error?}]}`. A single `--file` keeps the original single-file shape. A bad path is reported as a per-file `error` without failing the others.
```
In `docs/structure-commands.md` (symbol section): note `--symbol` accepts comma-separated names → `{symbols: [{symbol, matches}]}`.
In `SKILL.md` "Server Configuration":
```markdown
- The CLI sends **all** requests via HTTP POST (JSON body); the server accepts both GET and POST on every route. This removes URL-length limits and query-string encoding edge cases.
```

- [ ] **Step 2: End-to-end verification against a running server**

```bash
cd understand-anything-plugin/packages/dashboard && pnpm run serve &
cd understand-anything-plugin/skills/understand-query
# substitute real paths from: structure --service ultron-guild --files
python3 ua_query.py --format md source --service ultron-guild --file "<pathA>:1-40,<pathB>"
python3 ua_query.py --format md structure --service ultron-guild --symbol "GuildProfitSettlementStaticsService,GuildDomainRepo" --source
python3 ua_query.py --format md source --service ultron-guild --search "结算"
```
Confirm: `# Source Files (2)`; `# Symbols (2)`; Chinese search returns results — all now over POST. Verify the server log shows POST requests.

- [ ] **Step 3: Bump version in all five files**

Read current version (`grep '"version"' understand-anything-plugin/package.json`) and increment the patch in all five files (keep identical).

- [ ] **Step 4: Build all packages**

```bash
pnpm --filter @understand-anything/core build
pnpm --filter @understand-anything/skill build
pnpm --filter @understand-anything/dashboard build
```
Expected: all succeed.

- [ ] **Step 5: Final full verification (Python coverage gate + TS)**

```bash
python3 -m coverage run -m pytest tests/understand-query/ -q && python3 -m coverage report --fail-under=100
pnpm --filter @understand-anything/dashboard test
```
Expected: 100% coverage, all green.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "docs+chore(understand-query): document batch reads + universal POST; bump version"
```

---

## Self-Review

**Spec coverage:**
- Component A (multi-file) → Task 3. ✓
- Component B (symbol batch) → Task 4. ✓
- Component C (markdown branches) → Tasks 3 & 4. ✓
- Component D (server POST shim) → Task 1. ✓
- Component E (CLI POST for ALL requests, name-preserving `fetch_json` signature change, 63 sites, 168 tests) → Task 2. ✓
- Component F (100% coverage gate) → Task 2 (`.coveragerc`) + run in Tasks 2-5. ✓
- Error handling (per-item isolation, exit 0) → Task 3 Step 7, Task 4 Step 3. ✓
- Backward compatibility (single-item unchanged) → Task 3 (single-file test), Task 4 (single-symbol test). ✓
- Deployment ordering (server first) → Task 1 before Task 2. ✓
- Deployment notes (build, version bump ×5) → Task 5. ✓

**Placeholder scan:** No TBD/TODO. Task 2 Steps 5/7 are mechanical mass-edits governed by an explicit rule + grep enumeration + the 100%-coverage/green-suite gate as the completion check (not placeholders). `<pathA>/<pathB>` in Task 5 Step 2 are explicit substitution instructions.

**Type consistency:** `fetch_json(server, path, params)` (Task 2) is the signature used by all migrated sites and by Tasks 3/4 new calls, and asserted via `call_args[0][1]`/`[0][2]` in Task 2 Step 7 and Task 3 Step 5. `_parse_file_specs -> list[tuple[str,int|None,int|None]]` (Task 3) matches its unpacking in `cmd_source`. `mergePostBody(searchParams, body)` (Task 1) matches the server.ts call. Result shapes `{files:[…]}`/`{symbols:[…]}` produced in Tasks 3/4 match the markdown branches and the Task 5 e2e expectations.
