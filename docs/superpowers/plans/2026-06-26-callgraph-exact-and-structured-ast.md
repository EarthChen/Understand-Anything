# Callgraph Exact Matching and Structured AST Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement normalized exact callgraph search, structured callGraph metadata for Java/Kotlin/Swift/Objective-C, and deterministic full-service structure reextract.

**Architecture:** Put exact matching in a small dashboard helper so it can be tested without filesystem fixtures, then wire it into `/api/structure/callgraph`. Extend core `CallGraphEntry` with optional structured fields and update four extractors to emit them while preserving old fields. Keep migration deterministic through existing `daily-update.mjs --mode reextract`, adding `--force` for all services.

**Tech Stack:** TypeScript, Vitest, Python argparse/pytest, tree-sitter extractors, Node scripts.

---

## File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `understand-anything-plugin/packages/dashboard/src/api/handlers/structure-callgraph.ts` | Pure parsing, fallback extraction, exact/substr matching, result projection |
| Create | `understand-anything-plugin/packages/dashboard/src/api/handlers/__tests__/structure-callgraph-matching.test.ts` | Unit tests for matching semantics independent of filesystem data |
| Modify | `understand-anything-plugin/packages/dashboard/src/api/handlers/structure.ts` | Use helper, add `argc`, return structured result fields |
| Modify | `understand-anything-plugin/packages/dashboard/src/api/handlers/__tests__/structure-callgraph.test.ts` | Add handler validation tests for `argc` and query metadata |
| Modify | `understand-anything-plugin/skills/understand-query/ua_query.py` | Add `--argc` argument |
| Modify | `understand-anything-plugin/skills/understand-query/_commands.py` | Forward `argc` to `/api/structure/callgraph` |
| Modify | `understand-anything-plugin/skills/understand-query/_utils.py` | Render match mode, args, and call text |
| Create | `understand-anything-plugin/skills/understand-query/tests/test_callgraph_format.py` | Python tests for markdown rendering |
| Modify | `understand-anything-plugin/packages/core/src/types.ts` | Add optional fields to `CallGraphEntry` |
| Modify | Java/Kotlin/Swift/ObjC extractor files and tests | Emit structured callGraph metadata |
| Modify | `understand-anything-plugin/scripts/daily-update.mjs` | Add `--force` service selection |
| Modify | Query docs/agent docs | Document exact, FQN heuristic, `--argc`, and reextract force |

---

### Task 1: Dashboard Matching Helper

**Files:**
- Create: `understand-anything-plugin/packages/dashboard/src/api/handlers/structure-callgraph.ts`
- Create: `understand-anything-plugin/packages/dashboard/src/api/handlers/__tests__/structure-callgraph-matching.test.ts`

- [ ] **Step 1: Write failing pure matching tests**

Create `understand-anything-plugin/packages/dashboard/src/api/handlers/__tests__/structure-callgraph-matching.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import {
  getCallgraphMatchMode,
  matchesCallgraphEntry,
  parseCallQuery,
  projectCallgraphResult,
} from "../structure-callgraph"

describe("callgraph query parsing", () => {
  it("parses method, receiver.method, Class#method, and FQN#method", () => {
    expect(parseCallQuery("queryUserExtend")).toEqual({ kind: "method", methodName: "queryUserExtend" })
    expect(parseCallQuery("wrapper.queryUserExtend")).toEqual({
      kind: "receiverMethod",
      receiver: "wrapper",
      methodName: "queryUserExtend",
    })
    expect(parseCallQuery("UserProfileMoaWrapperService#queryUserExtend")).toEqual({
      kind: "ownerMethod",
      ownerClass: "UserProfileMoaWrapperService",
      methodName: "queryUserExtend",
    })
    expect(parseCallQuery("com.example.UserProfileMoaWrapperService#queryUserExtend")).toEqual({
      kind: "ownerMethod",
      ownerClass: "UserProfileMoaWrapperService",
      methodName: "queryUserExtend",
    })
  })
})

describe("callgraph exact matching", () => {
  it("matches a plain method name exactly against receiver.method fallback", () => {
    expect(matchesCallgraphEntry(
      { caller: "getQuickMessage", callee: "userProfileMoaWrapperService.queryUserExtend", lineNumber: 318 },
      { callee: "queryUserExtend", exact: true },
    )).toBe(true)
  })

  it("does not match longer method names in exact mode", () => {
    expect(matchesCallgraphEntry(
      { caller: "getQuickMessage", callee: "userProfileMoaWrapperService.queryUserExtendList", lineNumber: 318 },
      { callee: "queryUserExtend", exact: true },
    )).toBe(false)
  })

  it("matches receiver.method exactly", () => {
    expect(matchesCallgraphEntry(
      { caller: "getQuickMessage", callee: "userProfileMoaWrapperService.queryUserExtend", lineNumber: 318 },
      { callee: "userProfileMoaWrapperService.queryUserExtend", exact: true },
    )).toBe(true)
  })

  it("matches Class#method through lower-camel receiver heuristic", () => {
    expect(matchesCallgraphEntry(
      { caller: "getQuickMessage", callee: "userProfileMoaWrapperService.queryUserExtend", lineNumber: 318 },
      { callee: "com.example.UserProfileMoaWrapperService#queryUserExtend", exact: true },
    )).toBe(true)
  })

  it("matches caller owner only when structured callerQualifiedName exists", () => {
    expect(matchesCallgraphEntry(
      {
        caller: "process",
        callerOwner: "OrderService",
        callerQualifiedName: "OrderService#process",
        callee: "repo.save",
        lineNumber: 42,
      },
      { caller: "OrderService#process", exact: true },
    )).toBe(true)
    expect(matchesCallgraphEntry(
      { caller: "process", callee: "repo.save", lineNumber: 42 },
      { caller: "OrderService#process", exact: true },
    )).toBe(false)
  })

  it("filters by argument count only when structured count exists", () => {
    expect(matchesCallgraphEntry(
      { caller: "process", callee: "repo.save", methodName: "save", argumentCount: 1, lineNumber: 42 },
      { callee: "save", exact: true, argc: 1 },
    )).toBe(true)
    expect(matchesCallgraphEntry(
      { caller: "process", callee: "repo.save", methodName: "save", lineNumber: 42 },
      { callee: "save", exact: true, argc: 1 },
    )).toBe(false)
  })

  it("keeps substring behavior when exact is false", () => {
    expect(matchesCallgraphEntry(
      { caller: "processOrder", callee: "repo.queryUserExtendList", lineNumber: 42 },
      { callee: "queryUserExtend", exact: false },
    )).toBe(true)
  })
})

describe("callgraph result projection", () => {
  it("preserves structured optional fields", () => {
    expect(projectCallgraphResult("src/OrderService.java", {
      caller: "process",
      callerOwner: "OrderService",
      callerQualifiedName: "OrderService#process",
      callee: "repo.save",
      receiver: "repo",
      methodName: "save",
      argumentCount: 1,
      callText: "repo.save(order)",
      lineNumber: 42,
      columnNumber: 12,
    })).toEqual({
      filePath: "src/OrderService.java",
      caller: "process",
      callerOwner: "OrderService",
      callerQualifiedName: "OrderService#process",
      callee: "repo.save",
      receiver: "repo",
      methodName: "save",
      argumentCount: 1,
      callText: "repo.save(order)",
      lineNumber: 42,
      columnNumber: 12,
    })
  })
})

describe("callgraph match mode", () => {
  it("reports match mode for caller and callee query forms", () => {
    expect(getCallgraphMatchMode({ callee: "queryUserExtend", exact: true })).toBe("exact-method")
    expect(getCallgraphMatchMode({ callee: "wrapper.queryUserExtend", exact: true })).toBe("exact-receiver")
    expect(getCallgraphMatchMode({ callee: "UserProfileMoaWrapperService#queryUserExtend", exact: true })).toBe("exact-owner-heuristic")
    expect(getCallgraphMatchMode({ caller: "OrderService#process", exact: true })).toBe("exact-caller-owner")
    expect(getCallgraphMatchMode({ caller: "process", exact: true })).toBe("exact-caller")
    expect(getCallgraphMatchMode({ callee: "query", exact: false })).toBe("substring")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd understand-anything-plugin/packages/dashboard
pnpm test src/api/handlers/__tests__/structure-callgraph-matching.test.ts
```

Expected: fail because `../structure-callgraph` does not exist.

- [ ] **Step 3: Implement the helper**

Create `understand-anything-plugin/packages/dashboard/src/api/handlers/structure-callgraph.ts`:

```ts
export interface CallGraphEntry {
  caller: string
  callee: string
  lineNumber: number
  columnNumber?: number
  receiver?: string
  methodName?: string
  argumentCount?: number
  callText?: string
  callerOwner?: string
  callerQualifiedName?: string
}

export interface CallgraphQuery {
  callee?: string
  caller?: string
  exact: boolean
  argc?: number
}

export type MatchMode =
  | "substring"
  | "exact-method"
  | "exact-receiver"
  | "exact-owner-heuristic"
  | "exact-caller"
  | "exact-caller-owner"

export type ParsedCallQuery =
  | { kind: "method"; methodName: string }
  | { kind: "receiverMethod"; receiver: string; methodName: string }
  | { kind: "ownerMethod"; ownerClass: string; methodName: string }

export interface CallgraphResult extends CallGraphEntry {
  filePath: string
}

export function parseCallQuery(input: string): ParsedCallQuery {
  const value = input.trim()
  const hashIndex = value.lastIndexOf("#")
  if (hashIndex >= 0) {
    const owner = value.slice(0, hashIndex)
    const methodName = value.slice(hashIndex + 1)
    const ownerClass = owner.split(".").filter(Boolean).at(-1) ?? owner
    return { kind: "ownerMethod", ownerClass, methodName }
  }

  const dotIndex = value.lastIndexOf(".")
  if (dotIndex > 0 && dotIndex < value.length - 1) {
    return {
      kind: "receiverMethod",
      receiver: value.slice(0, dotIndex),
      methodName: value.slice(dotIndex + 1),
    }
  }

  return { kind: "method", methodName: value }
}

export function lowerCamel(name: string): string {
  if (!name) return name
  return name[0].toLowerCase() + name.slice(1)
}

export function terminalMethod(callee: string): string {
  const trimmed = callee.trim()
  for (const separator of ["#", ".", "::", "->"]) {
    const index = trimmed.lastIndexOf(separator)
    if (index >= 0 && index < trimmed.length - separator.length) {
      return trimmed.slice(index + separator.length)
    }
  }
  return trimmed
}

function fallbackReceiver(callee: string): string | undefined {
  const index = callee.lastIndexOf(".")
  if (index <= 0) return undefined
  return callee.slice(0, index)
}

function entryMethodName(entry: CallGraphEntry): string {
  return entry.methodName ?? terminalMethod(entry.callee)
}

function entryReceiver(entry: CallGraphEntry): string | undefined {
  return entry.receiver ?? fallbackReceiver(entry.callee)
}

function matchesCallee(entry: CallGraphEntry, raw: string, exact: boolean): boolean {
  if (!exact) return entry.callee.toLowerCase().includes(raw.toLowerCase())

  const parsed = parseCallQuery(raw)
  if (parsed.kind === "method") {
    return entryMethodName(entry) === parsed.methodName
  }
  if (parsed.kind === "receiverMethod") {
    return entryReceiver(entry) === parsed.receiver && entryMethodName(entry) === parsed.methodName
  }
  const expectedReceiver = lowerCamel(parsed.ownerClass)
  return entryReceiver(entry) === expectedReceiver && entryMethodName(entry) === parsed.methodName
}

function matchesCaller(entry: CallGraphEntry, raw: string, exact: boolean): boolean {
  if (!exact) return entry.caller.toLowerCase().includes(raw.toLowerCase())
  if (raw.includes("#")) return entry.callerQualifiedName === normalizeOwnerMethod(raw)
  return entry.caller === raw
}

function normalizeOwnerMethod(raw: string): string {
  const parsed = parseCallQuery(raw)
  if (parsed.kind !== "ownerMethod") return raw
  return `${parsed.ownerClass}#${parsed.methodName}`
}

export function matchesCallgraphEntry(entry: CallGraphEntry, query: CallgraphQuery): boolean {
  if (query.argc !== undefined && entry.argumentCount !== query.argc) return false
  if (query.callee && !matchesCallee(entry, query.callee, query.exact)) return false
  if (query.caller && !matchesCaller(entry, query.caller, query.exact)) return false
  return true
}

export function getCallgraphMatchMode(query: CallgraphQuery): MatchMode {
  if (!query.exact) return "substring"
  if (query.callee) {
    const parsed = parseCallQuery(query.callee)
    if (parsed.kind === "method") return "exact-method"
    if (parsed.kind === "receiverMethod") return "exact-receiver"
    return "exact-owner-heuristic"
  }
  if (query.caller?.includes("#")) return "exact-caller-owner"
  return "exact-caller"
}

export function projectCallgraphResult(filePath: string, entry: CallGraphEntry): CallgraphResult {
  return {
    filePath,
    caller: entry.caller,
    callee: entry.callee,
    lineNumber: entry.lineNumber,
    ...(entry.columnNumber !== undefined ? { columnNumber: entry.columnNumber } : {}),
    ...(entry.receiver !== undefined ? { receiver: entry.receiver } : {}),
    ...(entry.methodName !== undefined ? { methodName: entry.methodName } : {}),
    ...(entry.argumentCount !== undefined ? { argumentCount: entry.argumentCount } : {}),
    ...(entry.callText !== undefined ? { callText: entry.callText } : {}),
    ...(entry.callerOwner !== undefined ? { callerOwner: entry.callerOwner } : {}),
    ...(entry.callerQualifiedName !== undefined ? { callerQualifiedName: entry.callerQualifiedName } : {}),
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
cd understand-anything-plugin/packages/dashboard
pnpm test src/api/handlers/__tests__/structure-callgraph-matching.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add understand-anything-plugin/packages/dashboard/src/api/handlers/structure-callgraph.ts \
  understand-anything-plugin/packages/dashboard/src/api/handlers/__tests__/structure-callgraph-matching.test.ts
git commit -m "feat: add callgraph exact matching helper"
```

---

### Task 2: Wire API Handler

**Files:**
- Modify: `understand-anything-plugin/packages/dashboard/src/api/handlers/structure.ts`
- Modify: `understand-anything-plugin/packages/dashboard/src/api/handlers/__tests__/structure-callgraph.test.ts`

- [ ] **Step 1: Add failing handler tests for `argc` validation**

Append to `describe("structure callgraph handler", ...)` in `structure-callgraph.test.ts`:

```ts
  it("returns 400 for invalid argc", async () => {
    const req = makeCallgraphRequest({ service: "test-service", callee: "getUser", argc: "-1" })
    const res = await handleStructureRequest(req, mockCtx)
    expect(res?.statusCode).toBe(400)
  })
```

- [ ] **Step 2: Run handler test to verify it fails**

Run:

```bash
cd understand-anything-plugin/packages/dashboard
pnpm test src/api/handlers/__tests__/structure-callgraph.test.ts
```

Expected: fail because `argc` is ignored.

- [ ] **Step 3: Update `structure.ts` imports and types**

In `structure.ts`, add:

```ts
import {
  getCallgraphMatchMode,
  matchesCallgraphEntry,
  projectCallgraphResult,
  type CallGraphEntry,
  type CallgraphQuery,
} from "./structure-callgraph"
```

Remove the local `interface CallGraphEntry` block at lines 34-38.

- [ ] **Step 4: Parse `argc` and use helper matching**

Replace the body of `handleCallgraphSearch` with:

```ts
function handleCallgraphSearch(
  service: string,
  searchParams: URLSearchParams,
): ApiResponse {
  const callee = searchParams.get("callee")?.trim() || undefined
  const caller = searchParams.get("caller")?.trim() || undefined
  const exact = searchParams.get("exact") === "true"

  if (!callee && !caller) {
    return {
      statusCode: 400,
      body: { error: "At least one of 'callee' or 'caller' is required" },
    }
  }

  const limitStr = searchParams.get("limit")
  const limit = limitStr === null ? 50 : Number.parseInt(limitStr, 10)
  if (!Number.isFinite(limit) || limit < 1 || limit > 500) {
    return { statusCode: 400, body: { error: "limit must be between 1 and 500" } }
  }

  const offsetStr = searchParams.get("offset")
  const offset = offsetStr === null ? 0 : Number.parseInt(offsetStr, 10)
  if (!Number.isFinite(offset) || offset < 0) {
    return { statusCode: 400, body: { error: "offset must be >= 0" } }
  }

  const argcStr = searchParams.get("argc")
  const argc = argcStr === null ? undefined : Number.parseInt(argcStr, 10)
  if (argcStr !== null && (!Number.isFinite(argc) || argc < 0)) {
    return { statusCode: 400, body: { error: "argc must be >= 0" } }
  }

  const query: CallgraphQuery = { exact, ...(callee ? { callee } : {}), ...(caller ? { caller } : {}), ...(argc !== undefined ? { argc } : {}) }
  const pathPattern = searchParams.get("pathPattern") || undefined

  const data = loadStructuralAnalysis(service)
  if (!data) {
    return {
      statusCode: 404,
      body: { error: `structural-analysis.json not found for service "${service}"` },
    }
  }

  const results = []
  for (const [filePath, fileData] of Object.entries(data)) {
    if (pathPattern && !filePath.toLowerCase().includes(pathPattern.toLowerCase())) continue
    const callGraph = fileData.callGraph
    if (!Array.isArray(callGraph)) continue

    for (const entry of callGraph) {
      if (matchesCallgraphEntry(entry, query)) {
        results.push(projectCallgraphResult(filePath, entry))
      }
    }
  }

  const total = results.length
  const paged = results.slice(offset, offset + limit)

  return {
    statusCode: 200,
    body: {
      results: paged,
      total,
      limit,
      offset,
      hasMore: offset + limit < total,
      query: { callee: callee ?? null, caller: caller ?? null, exact, argc: argc ?? null, matchMode: getCallgraphMatchMode(query) },
    },
  }
}
```

- [ ] **Step 5: Run dashboard tests**

Run:

```bash
cd understand-anything-plugin/packages/dashboard
pnpm test src/api/handlers/__tests__/structure-callgraph.test.ts src/api/handlers/__tests__/structure-callgraph-matching.test.ts
```

Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add understand-anything-plugin/packages/dashboard/src/api/handlers/structure.ts \
  understand-anything-plugin/packages/dashboard/src/api/handlers/__tests__/structure-callgraph.test.ts
git commit -m "feat: normalize structure callgraph exact search"
```

---

### Task 3: CLI and Markdown Output

**Files:**
- Modify: `understand-anything-plugin/skills/understand-query/ua_query.py`
- Modify: `understand-anything-plugin/skills/understand-query/_commands.py`
- Modify: `understand-anything-plugin/skills/understand-query/_utils.py`
- Create: `understand-anything-plugin/skills/understand-query/tests/test_callgraph_format.py`

- [ ] **Step 1: Write markdown formatting test**

Create `test_callgraph_format.py`:

```python
from understand_query._utils import _format_markdown


def test_callgraph_markdown_renders_match_mode_and_call_text():
    data = {
        "query": {"callee": "queryUserExtend", "caller": None, "exact": True, "matchMode": "exact-method"},
        "results": [
            {
                "filePath": "src/OrderService.java",
                "caller": "process",
                "callerQualifiedName": "OrderService#process",
                "callee": "repo.save",
                "argumentCount": 1,
                "lineNumber": 42,
                "callText": "repo.save(order)",
            }
        ],
        "total": 1,
    }

    md = _format_markdown(data)

    assert '# Callgraph Search: callee="queryUserExtend" (exact-method)' in md
    assert "| File | Caller | Callee | Args | Line | Call |" in md
    assert "| OrderService.java | OrderService#process | repo.save | 1 | 42 | repo.save(order) |" in md
```

- [ ] **Step 2: Run Python test to verify it fails**

Run:

```bash
cd understand-anything-plugin
python3 -m pytest skills/understand-query/tests/test_callgraph_format.py
```

Expected: fail because current markdown does not render match mode/columns.

- [ ] **Step 3: Add CLI `--argc`**

In `ua_query.py`, after `--exact`:

```python
    struct.add_argument("--argc", type=int, help="Filter callgraph results by argument count (requires structured callgraph data)")
```

In `_commands.py`, inside the `callee/caller` branch after limit handling:

```python
        if getattr(args, "argc", None) is not None:
            params["argc"] = str(args.argc)
```

- [ ] **Step 4: Update markdown formatter**

In `_utils.py`, replace the callgraph markdown block with a version that uses `matchMode`, optional `callerQualifiedName`, `argumentCount`, and `callText`:

```python
        match_mode = query.get("matchMode") or ("exact" if exact else "substring")
        if callee_q and caller_q:
            title = f'callee="{callee_q}" AND caller="{caller_q}" ({match_mode})'
        elif callee_q:
            title = f'callee="{callee_q}" ({match_mode})'
        else:
            title = f'caller="{caller_q}" ({match_mode})'
        lines = [f"# Callgraph Search: {title}", ""]
        results = data.get("results", [])
        if results:
            has_structured = any("callText" in r or "argumentCount" in r or "callerQualifiedName" in r for r in results)
            if has_structured:
                lines.append("| File | Caller | Callee | Args | Line | Call |")
                lines.append("|------|--------|--------|------|------|------|")
                for r in results:
                    fp = r.get("filePath", "?")
                    parts = fp.replace("\\", "/").split("/")
                    short = "/".join(parts[-2:]) if len(parts) > 2 else fp
                    caller = r.get("callerQualifiedName") or r.get("caller", "?")
                    args = r.get("argumentCount", "")
                    call = r.get("callText") or r.get("callee", "?")
                    lines.append(f"| {short} | {caller} | {r.get('callee', '?')} | {args} | {r.get('lineNumber', '?')} | {call} |")
            else:
                lines.append("| File | Caller | Callee | Line |")
                lines.append("|------|--------|--------|------|")
                for r in results:
                    fp = r.get("filePath", "?")
                    parts = fp.replace("\\", "/").split("/")
                    short = "/".join(parts[-2:]) if len(parts) > 2 else fp
                    lines.append(f"| {short} | {r.get('caller', '?')} | {r.get('callee', '?')} | {r.get('lineNumber', '?')} |")
            lines.append("")
```

- [ ] **Step 5: Run Python tests**

Run:

```bash
cd understand-anything-plugin
python3 -m pytest skills/understand-query/tests/test_callgraph_format.py
```

Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add understand-anything-plugin/skills/understand-query/ua_query.py \
  understand-anything-plugin/skills/understand-query/_commands.py \
  understand-anything-plugin/skills/understand-query/_utils.py \
  understand-anything-plugin/skills/understand-query/tests/test_callgraph_format.py
git commit -m "feat: expose callgraph argc and structured markdown"
```

---

### Task 4: Shared Type and Java Extractor

**Files:**
- Modify: `understand-anything-plugin/packages/core/src/types.ts`
- Modify: `understand-anything-plugin/packages/core/src/plugins/extractors/java-extractor.ts`
- Modify: `understand-anything-plugin/packages/core/src/plugins/extractors/__tests__/java-extractor.test.ts`

- [ ] **Step 1: Extend `CallGraphEntry` type**

In `types.ts`, replace `CallGraphEntry` with:

```ts
export interface CallGraphEntry {
  caller: string;
  callee: string;
  lineNumber: number;
  columnNumber?: number;
  receiver?: string;
  methodName?: string;
  argumentCount?: number;
  callText?: string;
  callerOwner?: string;
  callerQualifiedName?: string;
}
```

- [ ] **Step 2: Add Java failing test**

In `java-extractor.test.ts`, add a test under `describe("extractCallGraph", ...)`:

```ts
  it("adds structured call metadata and caller owner", () => {
    const code = `
class OrderService {
  void process() {
    repo.save(order);
  }
}`
    const { tree, parser, root } = parse(code)
    const result = extractor.extractCallGraph(root)
    expect(result).toContainEqual(expect.objectContaining({
      caller: "process",
      callerOwner: "OrderService",
      callerQualifiedName: "OrderService#process",
      callee: "repo.save",
      receiver: "repo",
      methodName: "save",
      argumentCount: 1,
      callText: "repo.save(order)",
      lineNumber: 4,
    }))
    expect(result.find((e) => e.callee === "repo.save")?.columnNumber).toBeGreaterThanOrEqual(0)
    tree.delete()
    parser.delete()
  })
```

- [ ] **Step 3: Run Java extractor test to verify it fails**

Run:

```bash
cd understand-anything-plugin/packages/core
pnpm test src/plugins/extractors/__tests__/java-extractor.test.ts
```

Expected: fail because structured fields are missing.

- [ ] **Step 4: Implement Java structured entries**

In `java-extractor.ts`, maintain a class stack and use it when pushing entries:

```ts
    const classStack: string[] = [];
```

Inside `walkForCalls`, push class names for `class_declaration`, `interface_declaration`, `enum_declaration`, and `record_declaration`:

```ts
      let pushedClass = false;
      if (["class_declaration", "interface_declaration", "enum_declaration", "record_declaration"].includes(node.type)) {
        const className = node.childForFieldName("name");
        if (className) {
          classStack.push(className.text);
          pushedClass = true;
        }
      }
```

For `method_invocation`, replace the current push with:

```ts
            const objectNode = node.childForFieldName("object");
            const nameNode = node.childForFieldName("name");
            const argsNode = node.childForFieldName("arguments");
            const caller = functionStack[functionStack.length - 1];
            const callerOwner = classStack[classStack.length - 1];
            entries.push({
              caller,
              callee,
              lineNumber: node.startPosition.row + 1,
              columnNumber: node.startPosition.column,
              receiver: objectNode?.text,
              methodName: nameNode?.text ?? callee,
              argumentCount: countNamedArguments(argsNode),
              callText: node.text,
              ...(callerOwner ? { callerOwner, callerQualifiedName: `${callerOwner}#${caller}` } : {}),
            });
```

Add helper near private helpers:

```ts
function countNamedArguments(argsNode: TreeSitterNode | null): number {
  if (!argsNode) return 0;
  let count = 0;
  for (let i = 0; i < argsNode.namedChildCount; i++) count++;
  return count;
}
```

Before leaving `walkForCalls`, pop `classStack`:

```ts
      if (pushedClass) {
        classStack.pop();
      }
```

- [ ] **Step 5: Run Java extractor test**

Run:

```bash
cd understand-anything-plugin/packages/core
pnpm test src/plugins/extractors/__tests__/java-extractor.test.ts
```

Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add understand-anything-plugin/packages/core/src/types.ts \
  understand-anything-plugin/packages/core/src/plugins/extractors/java-extractor.ts \
  understand-anything-plugin/packages/core/src/plugins/extractors/__tests__/java-extractor.test.ts
git commit -m "feat: add structured Java callgraph metadata"
```

---

### Task 5: Kotlin, Swift, and Objective-C Extractors

**Files:**
- Modify: `understand-anything-plugin/packages/core/src/plugins/extractors/kotlin-extractor.ts`
- Modify: `understand-anything-plugin/packages/core/src/plugins/extractors/swift-extractor.ts`
- Modify: `understand-anything-plugin/packages/core/src/plugins/extractors/objc-extractor.ts`
- Modify tests under `understand-anything-plugin/packages/core/src/plugins/extractors/__tests__/`

- [ ] **Step 1: Add Kotlin structured metadata test**

In `kotlin-extractor.test.ts`, add under `describe("extractCallGraph", ...)`:

```ts
  it("adds structured call metadata and caller owner", () => {
    const code = `
class OrderService {
  fun process() {
    repo.save(order)
  }
}`
    const { tree, parser, root } = parse(code)
    const result = extractor.extractCallGraph(root)
    expect(result).toContainEqual(expect.objectContaining({
      caller: "process",
      callerOwner: "OrderService",
      callerQualifiedName: "OrderService#process",
      callee: "repo.save",
      receiver: "repo",
      methodName: "save",
      argumentCount: 1,
      callText: "repo.save(order)",
      lineNumber: 4,
    }))
    tree.delete()
    parser.delete()
  })
```

- [ ] **Step 2: Add Swift structured metadata test**

In `swift-extractor.test.ts`, add:

```ts
  it("adds structured call metadata and caller owner", () => {
    const code = `
class OrderService {
  func process() {
    repo.save(order)
  }
}`
    const { tree, parser, root } = parse(code)
    const result = extractor.extractCallGraph(root)
    expect(result).toContainEqual(expect.objectContaining({
      caller: "process",
      callerOwner: "OrderService",
      callerQualifiedName: "OrderService#process",
      callee: "repo.save",
      receiver: "repo",
      methodName: "save",
      argumentCount: 1,
      callText: "repo.save(order)",
      lineNumber: 4,
    }))
    tree.delete()
    parser.delete()
  })
```

- [ ] **Step 3: Add Objective-C structured metadata test**

In `objc-extractor.test.ts`, add:

```ts
  it("adds structured message metadata and caller owner", () => {
    const code = `
@implementation OrderService
- (void)process {
  [repo save:order];
}
@end`
    const { tree, parser, root } = parse(code)
    const result = extractor.extractCallGraph(root)
    expect(result).toContainEqual(expect.objectContaining({
      caller: "process",
      callerOwner: "OrderService",
      callerQualifiedName: "OrderService#process",
      callee: "repo.save:",
      receiver: "repo",
      methodName: "save:",
      argumentCount: 1,
      callText: "[repo save:order]",
      lineNumber: 4,
    }))
    tree.delete()
    parser.delete()
  })
```

- [ ] **Step 4: Run tests to verify failures**

Run:

```bash
cd understand-anything-plugin/packages/core
pnpm test src/plugins/extractors/__tests__/kotlin-extractor.test.ts \
  src/plugins/extractors/__tests__/swift-extractor.test.ts \
  src/plugins/extractors/__tests__/objc-extractor.test.ts
```

Expected: fail because structured fields are missing.

- [ ] **Step 5: Implement Kotlin and Swift using existing call-expression parsing**

For Kotlin and Swift:

- Add `classStack: string[]`.
- Push class/object/struct/extension names where those node types exist in the extractor.
- When pushing call entries, include:

```ts
const caller = functionStack[functionStack.length - 1];
const callerOwner = classStack[classStack.length - 1];
const parts = splitReceiverMethod(callee);
entries.push({
  caller,
  callee,
  lineNumber: node.startPosition.row + 1,
  columnNumber: node.startPosition.column,
  receiver: parts.receiver,
  methodName: parts.methodName,
  argumentCount: countCallArguments(node),
  callText: node.text,
  ...(callerOwner ? { callerOwner, callerQualifiedName: `${callerOwner}#${caller}` } : {}),
});
```

Add local helpers in each file:

```ts
function splitReceiverMethod(callee: string): { receiver?: string; methodName: string } {
  const index = callee.lastIndexOf(".");
  if (index <= 0) return { methodName: callee };
  return { receiver: callee.slice(0, index), methodName: callee.slice(index + 1) };
}

function countCallArguments(node: TreeSitterNode): number {
  const args = findChild(node, "call_suffix") ?? findChild(node, "arguments") ?? findChild(node, "value_arguments");
  if (!args) return 0;
  let count = 0;
  for (let i = 0; i < args.namedChildCount; i++) {
    const child = args.namedChild(i);
    if (child && !["(", ")", ","].includes(child.type)) count++;
  }
  return count;
}
```

- [ ] **Step 6: Implement Objective-C message metadata**

In `objc-extractor.ts`:

- Maintain `classStack` when entering implementation/interface nodes.
- Reuse `extractMessageSelector(node)` for `methodName`.
- Set `receiver` from `node.childForFieldName("receiver")`.
- Set `argumentCount` to selector segment count:

```ts
function countObjcSelectorArguments(selector: string): number {
  return (selector.match(/:/g) ?? []).length;
}
```

Push entries with:

```ts
const caller = functionStack[functionStack.length - 1];
const callerOwner = classStack[classStack.length - 1];
entries.push({
  caller,
  callee,
  lineNumber: node.startPosition.row + 1,
  columnNumber: node.startPosition.column,
  receiver: receiver?.text,
  methodName: selector,
  argumentCount: countObjcSelectorArguments(selector),
  callText: node.text,
  ...(callerOwner ? { callerOwner, callerQualifiedName: `${callerOwner}#${caller}` } : {}),
});
```

- [ ] **Step 7: Run extractor tests**

Run:

```bash
cd understand-anything-plugin/packages/core
pnpm test src/plugins/extractors/__tests__/kotlin-extractor.test.ts \
  src/plugins/extractors/__tests__/swift-extractor.test.ts \
  src/plugins/extractors/__tests__/objc-extractor.test.ts
```

Expected: pass.

- [ ] **Step 8: Commit**

```bash
git add understand-anything-plugin/packages/core/src/plugins/extractors/kotlin-extractor.ts \
  understand-anything-plugin/packages/core/src/plugins/extractors/swift-extractor.ts \
  understand-anything-plugin/packages/core/src/plugins/extractors/objc-extractor.ts \
  understand-anything-plugin/packages/core/src/plugins/extractors/__tests__/kotlin-extractor.test.ts \
  understand-anything-plugin/packages/core/src/plugins/extractors/__tests__/swift-extractor.test.ts \
  understand-anything-plugin/packages/core/src/plugins/extractors/__tests__/objc-extractor.test.ts
git commit -m "feat: add structured mobile callgraph metadata"
```

---

### Task 6: Deterministic Reextract Force Mode

**Files:**
- Modify: `understand-anything-plugin/scripts/daily-update.mjs`

- [ ] **Step 1: Add `--force` parsing**

Near existing flags:

```js
const FORCE = args.includes('--force');
```

Log it in `runOnce`:

```js
  log(`Force:    ${FORCE}`);
```

- [ ] **Step 2: Replace changed-service selection**

Replace:

```js
  const changed = getChangedServices(allServices);
```

with:

```js
  const changed = FORCE ? allServices : getChangedServices(allServices);
  if (FORCE) {
    log('Force mode: reextract target set to all services.');
  }
```

- [ ] **Step 3: Keep no-change early return disabled in force mode**

Change:

```js
  if (changed.length === 0) {
```

to:

```js
  if (!FORCE && changed.length === 0) {
```

- [ ] **Step 4: Dry-run verify with a fixture project**

Create a deterministic fixture project:

```bash
rm -rf /private/tmp/ua-daily-update-fixture
mkdir -p /private/tmp/ua-daily-update-fixture/.understand-anything
mkdir -p /private/tmp/ua-daily-update-fixture/services/svc-a
mkdir -p /private/tmp/ua-daily-update-fixture/services/svc-b
printf '{"facets":[{"type":"backend","services":[{"path":"services/svc-a"},{"path":"services/svc-b"}]}]}' > /private/tmp/ua-daily-update-fixture/.understand-anything/system.json
node understand-anything-plugin/scripts/daily-update.mjs /private/tmp/ua-daily-update-fixture --mode reextract --force --dry-run
```

Expected log includes:

```text
Force:    true
Force mode: reextract target set to all services.
[DRY-RUN] node .../reextract-structure.mjs ...
```

- [ ] **Step 5: Commit**

```bash
git add understand-anything-plugin/scripts/daily-update.mjs
git commit -m "feat: force deterministic structure reextract"
```

---

### Task 7: Documentation

**Files:**
- Modify: `understand-anything-plugin/skills/understand-query/SKILL.md`
- Modify: `understand-anything-plugin/skills/understand-query/docs/structure-commands.md`
- Modify: `understand-anything-plugin/agents/understand-query-worker.md`

- [ ] **Step 1: Update `structure-commands.md` flags and examples**

Add `--argc` to the structure flags table:

```md
| `--argc N` | int | Filter callgraph results by argument count; requires structured callgraph data |
```

Add examples:

```bash
python3 ua_query.py structure --service S --callee queryUserExtend --exact
python3 ua_query.py structure --service S --callee UserProfileMoaWrapperService#queryUserExtend --exact
python3 ua_query.py structure --service S --callee queryUserExtend --exact --argc 2
python3 ua_query.py structure --service S --caller OrderService#process --exact
```

- [ ] **Step 2: Update worker exact rules**

In `understand-query-worker.md`, replace the current `--exact` rules with:

```md
**`--exact` decision rules for `--callee` / `--caller`:**

- `--callee queryUserExtend --exact` matches exact method name and excludes `queryUserExtendList`.
- `--callee userProfileMoaWrapperService.queryUserExtend --exact` matches exact receiver + method.
- `--callee UserProfileMoaWrapperService#queryUserExtend --exact` uses owner-to-lowerCamel receiver matching; if it returns 0, retry `--callee queryUserExtend --exact`.
- `--caller getQuickMessage --exact` matches the caller method name.
- `--caller OrderService#process --exact` requires a structured reextract with `callerQualifiedName`; old indexes cannot answer owner-qualified caller queries.
- `--argc N` only filters by argument count. It does not resolve parameter types.
```

- [ ] **Step 3: Update `SKILL.md` quick reference**

Adjust the callgraph rows to mention exact and argc:

```md
| "Who calls X?" / "谁调用了X？" | `structure --service S --callee "X" --exact` → parallel across services | AST callgraph search. `X` may be method, `receiver.method`, or `Class#method`; use `--argc N` only for overload triage |
| "What does X call?" / "X调用了谁？" | `structure --service S --caller "X" --exact` | Supports `Class#method` after structured reextract; old data supports method-name exact only |
```

- [ ] **Step 4: Commit docs**

```bash
git add understand-anything-plugin/skills/understand-query/SKILL.md \
  understand-anything-plugin/skills/understand-query/docs/structure-commands.md \
  understand-anything-plugin/agents/understand-query-worker.md
git commit -m "docs: clarify structured callgraph exact search"
```

---

### Task 8: Final Verification

**Files:** no code changes unless a verification failure requires a targeted fix.

- [ ] **Step 1: Run dashboard callgraph tests**

```bash
cd understand-anything-plugin/packages/dashboard
pnpm test src/api/handlers/__tests__/structure-callgraph.test.ts src/api/handlers/__tests__/structure-callgraph-matching.test.ts
```

Expected: pass.

- [ ] **Step 2: Run core extractor tests**

```bash
cd understand-anything-plugin/packages/core
pnpm test src/plugins/extractors/__tests__/java-extractor.test.ts \
  src/plugins/extractors/__tests__/kotlin-extractor.test.ts \
  src/plugins/extractors/__tests__/swift-extractor.test.ts \
  src/plugins/extractors/__tests__/objc-extractor.test.ts
```

Expected: pass.

- [ ] **Step 3: Run Python formatter test**

```bash
cd understand-anything-plugin
python3 -m pytest skills/understand-query/tests/test_callgraph_format.py
```

Expected: pass.

- [ ] **Step 4: Run typecheck/build where affected**

```bash
cd understand-anything-plugin
pnpm --filter @understand-anything/core build
pnpm --filter @understand-anything/dashboard typecheck
```

Expected: both pass.

- [ ] **Step 5: Check working tree and summarize**

```bash
git status --short
```

Expected: only intentional committed changes remain, or clean working tree if all task commits were made.
