# Batch Source Queries + POST Transport — Design Spec

**Date:** 2026-06-18
**Status:** Approved — both features built and shipped together as one release (no phased rollout).
**Skill:** understand-query (`understand-anything-plugin/skills/understand-query/`)

## Goal

Let an agent gather source-code evidence from **multiple files / symbols in a single tool call** instead of one query at a time, and make the CLI↔server transport robust against **large requests and special-character encoding** by adding POST support.

Two independent but related changes:
1. **Batch reads** — `source --file` reads many files at once; `structure --symbol` reads many symbols at once.
2. **POST transport** — server accepts POST on all routes (GET retained); CLI sends POST for the calls that carry free-text or batch lists.

## Motivation / Evidence

- Today the agent reads one file per call (`source --file PATH`), so gathering evidence across N files = N tool calls.
- `build_url` already percent-encodes (`urlencode`), so **basic Chinese encoding works today** (`source --search "结算"` succeeds). POST is therefore justified by **(a) unbounded request size** (batch lists/long content can exceed URL limits — 8 Java paths ≈ 1 KB and grows) and **(b) special-character robustness** (`& # + %`, newlines in query strings), **not** by basic encoding.
- Cross-file keyword grep already exists (`source --search [--path]`). The gap is reading **specific known** files/symbols together.

## Scope

**In scope**
- Multi-file read on `source --file` (comma-separated, optional per-file line range).
- Symbol batch on `structure --symbol` (comma-separated names, with/without `--source`).
- Two new `_format_markdown` branches for the batch result shapes.
- Universal server-side POST support (one central middleware change; handlers untouched).
- **All** CLI requests via POST — every call site, not just free-text/batch (chosen for stability + to drop URL encoding entirely + future structured-body extensibility).
- Enforced **100% line coverage** for the four understand-query modules via a `coverage --fail-under=100` gate.

**Out of scope (YAGNI)**
- Dedicated server batch endpoint (`/api/source/batch`) — saves HTTP round-trips only, not tool calls. Future option.
- Multi-file on `kg --file` / `structure --file` — `source --file` is the canonical batch reader.
- Nested/structured POST bodies — the dict→JSON transport supports them, but no current feature needs nesting; `mergePostBody` stringifies flat values for now (per-endpoint `req.body` reads can be added later when a nested body is actually needed).
- Search scoped to a specific file set (`source --search --file a,b`) — not requested.

## Design

### Component A — Multi-file read (`cmd_source`, `_commands.py`)

CLI:
```bash
ua_query.py --format md source --service S \
  --file "GuildDomainRepo.java:1-60,ProfitProcessor.java,GuildProfitSettlementStaticsService.java:20-80"
```

- Split `--file` on commas → list of specs. Each spec = `path` or `path:start-end`.
- Range parse is robust to colons in paths: match a **trailing** `:(\d+)-(\d+)$` only; everything before is the path. (Repo Java paths contain no colons, but the trailing-only rule is safe regardless.)
- **No comma** → single spec → **unchanged**: existing single-file call to `/api/source`, returns `{file, content, lineCount}` (same shape, same exit codes — zero regression).
- **Comma present** → loop each spec, call `/api/source` per file:
  - line range precedence: inline `:start-end` > global `--start/--end` > none (whole file).
  - aggregate → `{files: [{file, lineRange, content, lineCount, error?}]}`.
- **Per-file failure isolation**: catch `RuntimeError` per file, record `{file, error}`, continue; do not abort the batch. Exit code 0 even on partial failure (agent sees which succeeded + which path was wrong).

### Component B — Symbol batch (`_cmd_structure_symbol`, `_helpers.py`)

CLI:
```bash
ua_query.py --format md structure --service S \
  --symbol "GuildProfitSettlementStaticsService,ProfitProcessor,GuildDomainRepo" --source
```

- Split `args.symbol` on commas → list of names.
- **Single name** → **unchanged** `{symbol, matches}`.
- **Multiple names** → loop each name through existing logic (symbol-source when `--source`, else `/api/structure/search`), aggregate → `{symbols: [{symbol, matches}]}` (per-name grouping preserves provenance).
- `--limit` follows the prior fix: unset → omit the param so each name uses the server default (5, cap 20) on `symbol-source`; explicit value applies per name.
- Per-name failure isolation, same as Component A.

### Component C — Markdown rendering (`_format_markdown`, `_utils.py`)

Two new branches (both render in `--format json` automatically as raw dumps):
- `{files: [...]}` → `# Source Files (N)`, then per file `## Source: <file> (lines a-b)` + fenced code block; inline `> error: …` when an entry has `error`.
- `{symbols: [...]}` → `# Symbols (N)`, then reuse the existing single-symbol section rendering per group.

Single-item shapes (`{file, content, lineCount}`, `{symbol, matches}`) keep their existing branches.

### Component D — Universal server POST (`server.ts`)

- Add `app.use(express.json({ limit: "5mb" }))` before the dispatch middleware (Express 5 has built-in body parsing).
- In the dispatch middleware (currently `server.ts:38-55`), build a merged `URLSearchParams`:
  ```ts
  const url = new URL(req.url, `http://127.0.0.1`)
  const searchParams = url.searchParams
  if (req.method === "POST" && req.body && typeof req.body === "object") {
    for (const [k, v] of Object.entries(req.body)) {
      if (v != null) searchParams.set(k, String(v))
    }
  }
  const apiRes = await router.handle({ pathname: url.pathname, searchParams }, { getWikiService })
  ```
- Handlers are untouched — they keep reading `searchParams.get(...)`. GET still works (backward compatible). Body keys override query keys on conflict.

### Component E — CLI POST transport (ALL requests)

Strategy (Option Y, name-preserving): change `fetch_json`'s **signature** to `(server, path, params)` and POST `params` directly as a JSON body. This drops URL encoding entirely (no `build_url` round-trip) and natively supports future structured bodies. The function **name is kept** so the 212 existing `patch("_helpers.fetch_json")` sites and all return-value-only tests are unaffected.

- New signature:
  ```python
  def fetch_json(server: str, path: str, params: dict | None = None, timeout: int = DEFAULT_TIMEOUT) -> Any:
      url = f"{server.rstrip('/')}{path}"
      req = urllib.request.Request(
          url,
          data=json.dumps(params or {}).encode("utf-8"),
          headers={"Accept": "application/json", "Content-Type": "application/json"},
          method="POST",
      )
      return _read_json_response(req, url, timeout)
  ```
- The existing inline HTTPError / timeout / `ServerUnavailableError` handling is kept as-is (single caller — no helper extraction needed).
- Migrate **all 63 call sites**: `fetch_json(build_url(server, path, params))` → `fetch_json(server, path, params)` (and `_helpers.fetch_json(build_url(...))` likewise). Paths built with f-strings stay as-is in the `path` argument.
- `build_url` is **retained** (still unit-tested) but no longer used to issue requests.
- The server shim (Component D) merges the JSON body into `searchParams`, so handlers are unchanged.
- Rewrite the **~168 tests** that assert on the URL string (`mock.call_args[0][0]` / `"x=y" in url`) to assert on the call args: `server, path, params = mock.call_args[0][:3]; assert path == "/api/…"; assert params["x"] == "y"`.

### Component F — Coverage gate (100%)

- Add `coverage` as a dev dependency (pip-installable; pure Python).
- Gate: `coverage run -m pytest tests/understand-query/ && coverage report --fail-under=100` over `ua_query, _commands, _helpers, _utils`.
- Config via `.coveragerc` (or `pyproject.toml [tool.coverage]`) scoping `source` to the four modules and `fail_under = 100`.

## Data Flow

```
agent ──1 tool call──▶ ua_query.py source --file a,b,c
                         │  split specs
                         ├─POST /api/source {file:a,...}
                         ├─POST /api/source {file:b,...}   (internal, sequential)
                         └─POST /api/source {file:c,...}
                         ▼ aggregate {files:[...]}
                       1 md/json blob ──▶ agent
```

## Error Handling

- Per-item isolation (files and symbols): one failure → `{…, error}` entry, batch continues, exit 0.
- Single-item path keeps current behavior (RuntimeError → exit 1).
- POST request failures reuse existing `ServerUnavailableError` (exit 2) / `RuntimeError` (exit 1) handling.
- Server POST shim: non-object / missing body is ignored (falls back to query params).

## Backward Compatibility

- `source --file PATH` (single) and `structure --symbol NAME` (single) unchanged in shape and exit code.
- Server accepts both GET and POST; existing GET clients unaffected.
- CLI GET call sites that aren't migrated are unchanged.

## Testing Plan (TDD)

Python (`tests/understand-query/`):
- Multi-file: two-file aggregate → `{files:[…]}`; inline `:start-end` parsed; global `--start/--end` fallback; one missing file → `error` entry + others ok; single file → unchanged shape.
- Symbol batch: multi-name → `{symbols:[…]}`; single name unchanged; multi-name unset `--limit` omits limit per call.
- Markdown: `{files}` and `{symbols}` render branches (incl. error inline).
- POST transport: `fetch_json(server, path, params)` issues a POST with the JSON body + correct headers/method (mock `urlopen`); empty/None params → `{}` body.
- Migrated call sites: assert on `(server, path, params)` call args instead of URL strings (~168 tests rewritten).
- Regression: full `tests/understand-query/` suite green at **100% line coverage** (`coverage report --fail-under=100`).

TypeScript (`packages/dashboard/src/__tests__/` or handler tests):
- POST with JSON body reaches a handler with merged `searchParams` (e.g. `source/search`, `structure/symbol-source`).
- GET still works (existing tests unchanged).
- Body key overrides query key.

## Deployment Notes

This now includes a **server change**, so shipping requires:
- `pnpm --filter @understand-anything/dashboard build`
- rebuild/redeploy the API server (`pnpm run serve`)
- version bump in the **five** files listed in CLAUDE.md (Versioning).
- optional plugin-cache re-sync for local testing.
- dev tool: `pip install coverage` (for the 100% gate).

**Hard ordering:** the CLI now POSTs **every** request, so the POST-capable server (Component D) must be deployed **before/with** the CLI. An old GET-only server would reject the CLI with 404/405. Since both ship in one release, implement the server POST shim first.

## Open Question (non-blocking)

If a *specific* character/command is what breaks today, capturing that repro would confirm POST fixes it (vs. a shell-quoting issue, which POST does not address since data still enters via argv).
