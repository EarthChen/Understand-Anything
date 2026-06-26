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
    const ownerParts = owner.split(".").filter(Boolean)
    const ownerClass = ownerParts[ownerParts.length - 1] ?? owner
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

function lowerCamel(name: string): string {
  if (!name) return name
  return name[0].toLowerCase() + name.slice(1)
}

function terminalMethod(callee: string): string {
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
