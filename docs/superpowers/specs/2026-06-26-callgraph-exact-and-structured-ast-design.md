# Callgraph Exact Matching and Structured AST Design

**Date:** 2026-06-26
**Status:** Approved for planning
**Scope:** Callgraph query semantics, structured callGraph AST fields, deterministic reextract migration, docs, and tests.

## Context

The current `/api/structure/callgraph` endpoint searches `structural-analysis.json` callGraph entries. Existing entries are mostly shaped like:

```json
{
  "caller": "getQuickMessage",
  "callee": "userProfileMoaWrapperService.queryUserExtend",
  "lineNumber": 318
}
```

This works for substring lookup, but current `--exact` is strict string equality. That makes `--callee queryUserExtend --exact` miss `userProfileMoaWrapperService.queryUserExtend`. It also cannot express owner-style IDE references such as `com.example.UserProfileMoaWrapperService#queryUserExtend`, and it cannot distinguish overloads beyond returned line locations.

The design proceeds in two layers:

1. **Early query compatibility layer:** improve exact matching and input normalization without requiring any index rebuild.
2. **Mid-term structured AST layer:** enrich newly generated callGraph entries for Java, Kotlin, Swift, and Objective-C, then use deterministic reextract to rebuild structure/source indexes only.

## Goals

- Support exact method-name matching for callee queries without substring noise.
- Support stored callee strings such as `receiver.method`.
- Support IDE-style `Class#method` and FQN `package.Class#method` inputs for callee queries through deterministic normalization.
- Add structured callGraph fields for better matching, output, and overload triage.
- Add caller owner support in the structured AST layer so `--caller Class#method --exact` can disambiguate common method names.
- Keep old `structural-analysis.json` files compatible.
- Rebuild only deterministic structure/source indexes; do not require KG/wiki/domain/business regeneration.

## Non-Goals

- No full Java/Kotlin/Swift/Objective-C type resolver in this phase.
- No exact overload signature matching by parameter types.
- No KG edge regeneration requirement.
- No new replacement script for deterministic reextract; use existing `daily-update.mjs --mode reextract`.

## Early Layer: Query Normalization

The structure callgraph endpoint should parse user input into normalized query forms.

```ts
type ParsedCallQuery =
  | { kind: "method"; methodName: string }
  | { kind: "receiverMethod"; receiver: string; methodName: string }
  | { kind: "ownerMethod"; ownerClass: string; methodName: string }
```

Input mapping:

| Input | Parsed form |
|-------|-------------|
| `queryUserExtend` | `{ kind: "method", methodName: "queryUserExtend" }` |
| `userProfileMoaWrapperService.queryUserExtend` | `{ kind: "receiverMethod", receiver: "userProfileMoaWrapperService", methodName: "queryUserExtend" }` |
| `UserProfileMoaWrapperService#queryUserExtend` | `{ kind: "ownerMethod", ownerClass: "UserProfileMoaWrapperService", methodName: "queryUserExtend" }` |
| `com.example.UserProfileMoaWrapperService#queryUserExtend` | `{ kind: "ownerMethod", ownerClass: "UserProfileMoaWrapperService", methodName: "queryUserExtend" }` |

When `--exact=false`, preserve current substring behavior against the stored `caller` or `callee` string.

When `--exact=true`, callee matching should use:

- `method`: `entry.methodName === methodName`, falling back to `terminalMethod(entry.callee) === methodName`.
- `receiverMethod`: `entry.receiver === receiver && entry.methodName === methodName`, falling back to `entry.callee === receiver + "." + methodName`.
- `ownerMethod`: `entry.receiver === lowerCamel(ownerClass) && entry.methodName === methodName`, falling back to `entry.callee === lowerCamel(ownerClass) + "." + methodName`.

The owner/FQN rule is an owner-name heuristic, not type resolution. If a field is named `profileService` but its type is `UserProfileMoaWrapperService`, `UserProfileMoaWrapperService#queryUserExtend --exact` may return no results. The worker should then fall back to `queryUserExtend --exact`.

Caller matching in the early layer remains:

- `--caller method --exact`: `entry.caller === method`.
- `--caller Class#method --exact`: not reliably supported on old data.

## Mid-Term Layer: Structured callGraph Schema

Extend the shared `CallGraphEntry` type with optional fields:

```ts
interface CallGraphEntry {
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
```

The original `caller`, `callee`, and `lineNumber` fields remain required for compatibility. New fields are optional so old indexes and languages not yet enhanced continue to work.

### Callee Fields

- `receiver`: syntactic receiver or target where present, such as `userProfileMoaWrapperService`, `repo`, `self`, or Objective-C message target.
- `methodName`: syntactic method/function/selector name.
- `argumentCount`: number of call arguments or selector segments. This is overload triage, not type signature resolution.
- `callText`: source text for the full call expression.
- `columnNumber`: 0-based tree-sitter `startPosition.column`. `lineNumber` remains 1-based to preserve the existing API contract.

### Caller Owner Fields

- `callerOwner`: enclosing type name, such as `OrderService`.
- `callerQualifiedName`: owner-qualified caller name, such as `OrderService#process`.

These fields allow `--caller OrderService#process --exact` to avoid mixing all methods named `process`.

## Language Coverage

The first structured AST pass must cover:

- Java
- Kotlin
- Swift
- Objective-C

Other languages keep existing callGraph behavior. Adding the optional fields to additional languages is out of scope for this spec.

Language notes:

- **Java:** Use `method_invocation`; extract receiver/object, method name, arguments, call text, column, and class stack for caller owner.
- **Kotlin:** Use `call_expression` and `navigation_expression`; extract navigation target, suffix/simple identifier, arguments, call text, column, and class/object stack.
- **Swift:** Use `call_expression` and `navigation_expression`; extract target, method/simple identifier, argument count from argument nodes, call text, column, and class/struct/extension stack.
- **Objective-C:** Use `message_expression`; extract message receiver, selector as `methodName`, selector/argument count, call text, column, and implementation/class context for caller owner.

## API Design

Keep the endpoint:

```text
GET /api/structure/callgraph
```

Existing parameters remain:

| Parameter | Purpose |
|-----------|---------|
| `service` | Service name |
| `callee` | Search by called method/expression |
| `caller` | Search by caller method |
| `exact` | Use normalized exact matching |
| `limit` | Page size |
| `offset` | Page offset |
| `pathPattern` | Path substring filter |

Add:

| Parameter | Purpose |
|-----------|---------|
| `argc` | Optional exact argument-count filter |

If `argc` is supplied, match only entries with `entry.argumentCount === argc`. Old entries without `argumentCount` do not match the argc filter.

Result entries should preserve old fields and include any new fields when present:

```json
{
  "filePath": "src/OrderService.java",
  "caller": "process",
  "callerOwner": "OrderService",
  "callerQualifiedName": "OrderService#process",
  "callee": "repo.save",
  "receiver": "repo",
  "methodName": "save",
  "argumentCount": 1,
  "callText": "repo.save(order)",
  "lineNumber": 42,
  "columnNumber": 12
}
```

The response `query` object should include:

```json
{
  "callee": "queryUserExtend",
  "caller": null,
  "exact": true,
  "argc": 1,
  "matchMode": "exact-method"
}
```

Possible match modes:

- `substring`
- `exact-method`
- `exact-receiver`
- `exact-owner-heuristic`
- `exact-caller`
- `exact-caller-owner`

## CLI Design

Keep existing flags:

```bash
--callee TEXT
--caller TEXT
--exact
```

Add:

```bash
--argc N
```

Examples:

```bash
python3 ua_query.py structure --service S --callee queryUserExtend --exact
python3 ua_query.py structure --service S --callee userProfileMoaWrapperService.queryUserExtend --exact
python3 ua_query.py structure --service S --callee UserProfileMoaWrapperService#queryUserExtend --exact
python3 ua_query.py structure --service S --callee queryUserExtend --exact --argc 2
python3 ua_query.py structure --service S --caller OrderService#process --exact
```

The CLI should forward parameters to the API and avoid duplicating matching logic.

## Markdown Output

Callgraph markdown output should show the match mode in the title:

```text
# Callgraph Search: callee="queryUserExtend" (exact-method)
```

The results table should include optional detail when available:

```text
| File | Caller | Callee | Args | Line | Call |
|------|--------|--------|------|------|------|
| OrderService.java | OrderService#process | repo.save | 1 | 42 | repo.save(order) |
```

When optional fields are absent, fall back to the existing concise display.

## Reextract and Migration

Existing deterministic reextract entry:

```bash
node understand-anything-plugin/scripts/daily-update.mjs <project_root> --mode reextract
```

This already runs structure/source-index extraction without LLM work. Add a small `--force` flag:

```bash
node understand-anything-plugin/scripts/daily-update.mjs <project_root> --mode reextract --force
```

`--force` should ignore changed-service detection and set the reextract target list to all services from `.understand-anything/system.json`.

Migration behavior:

- Existing indexes continue to work through fallback parsing.
- New fields appear only after `reextract-structure.mjs` runs with updated extractors.
- No KG/wiki/domain/business rebuild is required.
- If the dashboard/API server caches structure data, restart or clear the structure cache after reextract.

## Documentation Updates

Update:

- `understand-anything-plugin/skills/understand-query/SKILL.md`
- `understand-anything-plugin/skills/understand-query/docs/structure-commands.md`
- `understand-anything-plugin/agents/understand-query-worker.md`

Docs must state:

- `--exact` is exact name matching, not exact type-signature matching.
- `Class#method` and FQN inputs use owner/receiver heuristics unless structured caller owner fields exist.
- `--argc` filters by argument count only.
- Same-name overloads with the same argument count still require reading `callText` or source lines.
- `--mode reextract --force` refreshes deterministic structure/source indexes only.

## Testing Strategy

### API Tests

Add or extend dashboard handler tests for:

- Old data fallback: `--callee queryUserExtend --exact` matches `receiver.queryUserExtend`.
- Exact method does not match `queryUserExtendList`.
- Exact receiver matches only the requested receiver.
- `Class#method` and FQN normalize to owner heuristic.
- `--caller method --exact` still works.
- `--caller Class#method --exact` works when `callerQualifiedName` exists.
- `--argc` filters entries with matching `argumentCount`.
- `--exact=false` substring behavior remains unchanged.

### CLI Tests

Add tests or command-level coverage for:

- `--argc` parsing and forwarding.
- Existing conflict checks for `--callee/--caller` with search filters.
- Markdown renders match mode and optional fields.

### Extractor Tests

For Java, Kotlin, Swift, and Objective-C:

- Extract `receiver`, `methodName`, `argumentCount`, `callText`, and `columnNumber`.
- Extract `callerOwner` and `callerQualifiedName`.
- Preserve existing `caller`, `callee`, and `lineNumber` expectations.
- Cover receiver method calls and plain function calls.

### Reextract Tests

Add dry-run coverage for:

```bash
node scripts/daily-update.mjs <fixture_project> --mode reextract --force --dry-run
```

Expected: logs list all services from `system.json`, not only changed services.

## Risks and Tradeoffs

- FQN callee matching is heuristic until real type resolution exists.
- Objective-C selector semantics differ from Java-style method names; docs and tests should use selector examples.
- `argumentCount` is useful for overload triage but cannot distinguish same-arity overloads.
- Adding fields to four extractors increases test surface, but optional fields keep old indexes and other languages safe.

## Success Criteria

- Existing callgraph queries continue to work.
- `--callee queryUserExtend --exact` matches `receiver.queryUserExtend` and excludes `queryUserExtendList`.
- `--callee Class#method --exact` works for conventional lower-camel receiver names.
- `--caller Class#method --exact` works after structured reextract for supported languages.
- Java, Kotlin, Swift, and Objective-C callGraph entries include structured optional fields after reextract.
- `daily-update.mjs --mode reextract --force` can refresh all services' structure/source indexes without running LLM phases.
