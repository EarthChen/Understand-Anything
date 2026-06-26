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

const CALL_SEPARATORS = ["#", ".", "::", "->"] as const

function findLastCallSeparator(
  value: string,
  separators: readonly string[] = CALL_SEPARATORS,
): { index: number; separator: string } | undefined {
  let match: { index: number; separator: string } | undefined
  for (const separator of separators) {
    const index = value.lastIndexOf(separator)
    if (
      index > 0 &&
      index < value.length - separator.length &&
      (match === undefined || index > match.index)
    ) {
      match = { index, separator }
    }
  }
  return match
}

export function parseCallQuery(input: string): ParsedCallQuery {
  const value = input.trim()
  const firstHashIndex = value.indexOf("#")
  const hashIndex = value.lastIndexOf("#")
  if (hashIndex >= 0 && firstHashIndex === hashIndex) {
    const owner = value.slice(0, hashIndex)
    const methodName = value.slice(hashIndex + 1)
    const ownerParts = owner.split(".").filter(Boolean)
    const ownerClass = ownerParts[ownerParts.length - 1] ?? owner
    if (owner && methodName && owner.endsWith(ownerClass)) {
      return { kind: "ownerMethod", ownerClass, methodName }
    }
  }

  const receiverSeparator = findLastCallSeparator(value, [".", "::", "->"])
  if (receiverSeparator) {
    return {
      kind: "receiverMethod",
      receiver: value.slice(0, receiverSeparator.index),
      methodName: value.slice(receiverSeparator.index + receiverSeparator.separator.length),
    }
  }

  return { kind: "method", methodName: value }
}

function lowerCamel(name: string): string {
  if (!name) return name
  return name[0].toLowerCase() + name.slice(1)
}

function terminalMethod(callee: string): string {
  const trimmed = callee.trim()
  const separator = findLastCallSeparator(trimmed)
  return separator ? trimmed.slice(separator.index + separator.separator.length) : trimmed
}

function fallbackReceiver(callee: string): string | undefined {
  const separator = findLastCallSeparator(callee)
  return separator ? callee.slice(0, separator.index) : undefined
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
