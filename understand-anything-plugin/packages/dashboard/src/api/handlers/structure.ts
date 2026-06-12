import fs from "fs"
import path from "path"
import type { ApiRequest, ApiContext, ApiResponse } from "../types"
import {
  resolveServiceDataPath,
  validateServiceNameRequired,
  resolveServiceBasePath,
} from "../service-resolver"
import { readSource } from "../../../source-reader"

interface FunctionEntry {
  name: string
  startLine: number
  endLine: number
  params?: Array<{ name: string; type: string }>
  returnType?: string
  annotations?: Array<{ name: string; arguments?: Record<string, string> }>
}

interface ClassEntry {
  name: string
  startLine: number
  endLine: number
  methods?: string[]
  properties?: string[]
  annotations?: Array<{ name: string; arguments?: Record<string, string> }>
  interfaces?: string[]
  superclasses?: string[]
  typedProperties?: Array<{ name: string; type: string }>
}

interface FileStructure {
  language: string
  fileCategory?: string
  totalLines: number
  functions: FunctionEntry[]
  classes: ClassEntry[]
  imports: Array<{ name: string; line?: number }>
  exports: Array<{ name: string; line?: number; isDefault?: boolean }>
}

type StructuralAnalysis = Record<string, FileStructure>

interface StructureCache {
  data: StructuralAnalysis
  mtime: number
}

const cache = new Map<string, StructureCache>()

function loadStructuralAnalysis(serviceName: string): StructuralAnalysis | null {
  const filePath = resolveServiceDataPath(
    serviceName,
    "intermediate/extraction/structural-analysis.json",
  )
  if (!filePath) return null

  try {
    const mtime = fs.statSync(filePath).mtimeMs
    const cached = cache.get(serviceName)
    if (cached && cached.mtime === mtime) return cached.data

    const data = JSON.parse(fs.readFileSync(filePath, "utf-8")) as StructuralAnalysis
    cache.set(serviceName, { data, mtime })
    return data
  } catch {
    return null
  }
}

function handleFiles(service: string): ApiResponse {
  const data = loadStructuralAnalysis(service)
  if (!data) {
    return {
      statusCode: 404,
      body: { error: `structural-analysis.json not found for service "${service}"` },
    }
  }
  const files = Object.keys(data).sort()
  return { statusCode: 200, body: { files, total: files.length } }
}

function handleFile(service: string, filePath: string): ApiResponse {
  const data = loadStructuralAnalysis(service)
  if (!data) {
    return {
      statusCode: 404,
      body: { error: `structural-analysis.json not found for service "${service}"` },
    }
  }

  if (data[filePath]) {
    return { statusCode: 200, body: { filePath, ...data[filePath] } }
  }

  const lowerPath = filePath.toLowerCase()
  const matches = Object.keys(data).filter((p) => p.toLowerCase().endsWith(lowerPath))
  if (matches.length === 1) {
    return { statusCode: 200, body: { filePath: matches[0], ...data[matches[0]] } }
  }
  if (matches.length > 1) {
    return {
      statusCode: 300,
      body: {
        error: `Multiple files match "${filePath}". Specify a more precise path.`,
        candidates: matches.slice(0, 10),
      },
    }
  }

  const suggestions = Object.keys(data)
    .filter((p) => p.toLowerCase().includes(lowerPath))
    .slice(0, 5)
    .map((p) => ({ path: p }))

  return {
    statusCode: 404,
    body: {
      error: `File "${filePath}" not found in structural analysis`,
      ...(suggestions.length > 0 ? { suggestions } : {}),
    },
  }
}

interface TypeRef {
  name: string
  filePath: string
  lineRange?: [number, number]
}

interface SearchResult {
  filePath: string
  name: string
  kind: "class" | "function"
  lineRange: [number, number]
  match: Record<string, string>
  typeRef?: TypeRef
}

function buildClassIndex(data: StructuralAnalysis): Map<string, TypeRef> {
  const index = new Map<string, TypeRef>()
  for (const [fp, fileData] of Object.entries(data)) {
    const classes = Array.isArray(fileData.classes) ? fileData.classes : []
    for (const cls of classes) {
      if (!index.has(cls.name)) {
        index.set(cls.name, {
          name: cls.name,
          filePath: fp,
          lineRange: [cls.startLine, cls.endLine],
        })
      }
    }
  }
  return index
}

interface ClassIndexCache {
  index: Map<string, TypeRef>
  mtime: number
}

const classIndexCache = new Map<string, ClassIndexCache>()

function getClassIndex(service: string, data: StructuralAnalysis): Map<string, TypeRef> {
  const cached = cache.get(service)
  const mtime = cached?.mtime ?? 0
  const idxCached = classIndexCache.get(service)
  if (idxCached && idxCached.mtime === mtime) return idxCached.index

  const index = buildClassIndex(data)
  classIndexCache.set(service, { index, mtime })
  return index
}

function stripGenericWrapper(typeName: string): string {
  const match = typeName.match(/^(?:List|Set|Map|Collection|Optional|Iterable)<(.+)>$/)
  if (match) {
    const inner = match[1].includes(",") ? match[1].split(",")[1].trim() : match[1].trim()
    return stripGenericWrapper(inner)
  }
  return typeName
}

function handleSearch(
  service: string,
  searchParams: URLSearchParams,
): ApiResponse {
  const data = loadStructuralAnalysis(service)
  if (!data) {
    return {
      statusCode: 404,
      body: { error: `structural-analysis.json not found for service "${service}"` },
    }
  }

  const annotation = searchParams.get("annotation")
  const paramType = searchParams.get("paramType")
  const returnType = searchParams.get("returnType")
  const iface = searchParams.get("interface")
  const propertyType = searchParams.get("propertyType")
  const symbol = searchParams.get("symbol")
  const pathPattern = searchParams.get("pathPattern")
  const limitStr = searchParams.get("limit")
  const limit = limitStr === null ? 50 : Number.parseInt(limitStr, 10)
  if (!Number.isFinite(limit) || limit < 1 || limit > 500) {
    return { statusCode: 400, body: { error: "limit must be between 1 and 500" } }
  }

  if (!annotation && !paramType && !returnType && !iface && !propertyType && !symbol) {
    return {
      statusCode: 400,
      body: {
        error: "At least one search filter required: annotation, paramType, returnType, interface, propertyType, symbol",
      },
    }
  }

  const results: SearchResult[] = []
  const query: Record<string, string> = {}
  if (annotation) query.annotation = annotation
  if (paramType) query.paramType = paramType
  if (returnType) query.returnType = returnType
  if (iface) query.interface = iface
  if (propertyType) query.propertyType = propertyType
  if (symbol) query.symbol = symbol

  for (const [filePath, fileData] of Object.entries(data)) {
    if (pathPattern && !filePath.toLowerCase().includes(pathPattern.toLowerCase())) {
      continue
    }

    const classes = Array.isArray(fileData.classes) ? fileData.classes : []
    const functions = Array.isArray(fileData.functions) ? fileData.functions : []

    if (annotation) {
      for (const cls of classes) {
        if (cls.annotations?.some((a) => a.name === annotation)) {
          results.push({
            filePath,
            name: cls.name,
            kind: "class",
            lineRange: [cls.startLine, cls.endLine],
            match: { annotation },
          })
        }
      }
      for (const fn of functions) {
        if (fn.annotations?.some((a) => a.name === annotation)) {
          results.push({
            filePath,
            name: fn.name,
            kind: "function",
            lineRange: [fn.startLine, fn.endLine],
            match: { annotation },
          })
        }
      }
    }

    if (paramType) {
      for (const fn of functions) {
        if (fn.params?.some((p) => p.type === paramType)) {
          results.push({
            filePath,
            name: fn.name,
            kind: "function",
            lineRange: [fn.startLine, fn.endLine],
            match: { paramType },
          })
        }
      }
    }

    if (returnType) {
      for (const fn of functions) {
        if (fn.returnType === returnType) {
          results.push({
            filePath,
            name: fn.name,
            kind: "function",
            lineRange: [fn.startLine, fn.endLine],
            match: { returnType },
          })
        }
      }
    }

    if (iface) {
      for (const cls of classes) {
        if (cls.interfaces?.includes(iface)) {
          results.push({
            filePath,
            name: cls.name,
            kind: "class",
            lineRange: [cls.startLine, cls.endLine],
            match: { interface: iface },
          })
        }
      }
    }

    if (propertyType) {
      for (const cls of classes) {
        if (cls.typedProperties?.some((p) => p.type === propertyType)) {
          results.push({
            filePath,
            name: cls.name,
            kind: "class",
            lineRange: [cls.startLine, cls.endLine],
            match: { propertyType },
          })
        }
      }
    }

    if (symbol) {
      const symbolLower = symbol.toLowerCase()
      for (const cls of classes) {
        if (cls.name.toLowerCase().includes(symbolLower)) {
          results.push({
            filePath,
            name: cls.name,
            kind: "class",
            lineRange: [cls.startLine, cls.endLine],
            match: { symbol: cls.name },
          })
        }
      }
      for (const fn of functions) {
        if (fn.name.toLowerCase().includes(symbolLower)) {
          results.push({
            filePath,
            name: fn.name,
            kind: "function",
            lineRange: [fn.startLine, fn.endLine],
            match: { symbol: fn.name },
          })
        }
      }
    }
  }

  const seen = new Set<string>()
  const deduped = results.filter((r) => {
    const key = `${r.filePath}::${r.name}::${r.kind}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  const resolveTypes = searchParams.get("resolveTypes") !== "false"
  if (resolveTypes && (paramType || returnType || propertyType || iface)) {
    const classIndex = getClassIndex(service, data)
    for (const r of deduped) {
      const typeToResolve =
        r.match.paramType || r.match.returnType || r.match.propertyType || r.match.interface
      if (!typeToResolve) continue
      const coreName = stripGenericWrapper(typeToResolve)
      const ref = classIndex.get(coreName)
      if (ref && ref.filePath !== r.filePath) {
        r.typeRef = ref
      }
    }
  }

  const total = deduped.length
  const hasMore = total > limit
  return {
    statusCode: 200,
    body: { results: deduped.slice(0, limit), total, hasMore, query },
  }
}

interface ChainNode {
  name: string
  filePath: string
  lineRange?: [number, number]
  interfaces?: string[]
  superclass?: string
}

function handleChain(service: string, className: string, direction: string): ApiResponse {
  const data = loadStructuralAnalysis(service)
  if (!data) {
    return {
      statusCode: 404,
      body: { error: `structural-analysis.json not found for service "${service}"` },
    }
  }

  const classMap = new Map<string, ChainNode>()
  for (const [fp, fileData] of Object.entries(data)) {
    const classes = Array.isArray(fileData.classes) ? fileData.classes : []
    for (const cls of classes) {
      const superclass =
        Array.isArray(cls.superclasses) && cls.superclasses.length > 0
          ? cls.superclasses[0]
          : undefined
      classMap.set(cls.name, {
        name: cls.name,
        filePath: fp,
        lineRange: [cls.startLine, cls.endLine],
        interfaces: cls.interfaces,
        superclass,
      })
    }
  }

  const chain: ChainNode[] = []
  const visited = new Set<string>()

  if (direction === "up") {
    let current = classMap.get(className)
    while (current && !visited.has(current.name)) {
      chain.push(current)
      visited.add(current.name)
      if (!current.superclass) break
      current = classMap.get(current.superclass)
    }
  } else {
    const childrenMap = new Map<string, string[]>()
    for (const [name, node] of classMap) {
      if (node.superclass) {
        const children = childrenMap.get(node.superclass) || []
        children.push(name)
        childrenMap.set(node.superclass, children)
      }
    }
    const queue = [className]
    while (queue.length > 0) {
      const name = queue.shift()!
      if (visited.has(name)) continue
      visited.add(name)
      const node = classMap.get(name)
      if (node) chain.push(node)
      const children = childrenMap.get(name) || []
      queue.push(...children)
    }
  }

  if (chain.length === 0) {
    return { statusCode: 404, body: { error: `Class "${className}" not found` } }
  }

  return {
    statusCode: 200,
    body: { className, direction, chain, depth: chain.length },
  }
}

function handleImplementors(service: string, interfaceName: string): ApiResponse {
  const data = loadStructuralAnalysis(service)
  if (!data) {
    return {
      statusCode: 404,
      body: { error: `structural-analysis.json not found for service "${service}"` },
    }
  }

  const implementors: Array<{
    name: string
    filePath: string
    lineRange: [number, number]
    interfaces: string[]
  }> = []

  for (const [fp, fileData] of Object.entries(data)) {
    const classes = Array.isArray(fileData.classes) ? fileData.classes : []
    for (const cls of classes) {
      if (cls.interfaces?.includes(interfaceName)) {
        implementors.push({
          name: cls.name,
          filePath: fp,
          lineRange: [cls.startLine, cls.endLine],
          interfaces: cls.interfaces,
        })
      }
    }
  }

  return {
    statusCode: 200,
    body: { interface: interfaceName, implementors, total: implementors.length },
  }
}

function handleSymbolSource(
  service: string,
  searchParams: URLSearchParams,
): ApiResponse {
  const symbol = searchParams.get("symbol")
  if (!symbol) {
    return { statusCode: 400, body: { error: "symbol parameter required" } }
  }

  const data = loadStructuralAnalysis(service)
  if (!data) {
    return {
      statusCode: 404,
      body: { error: `structural-analysis.json not found for service "${service}"` },
    }
  }

  const limitStr = searchParams.get("limit")
  const limit = limitStr === null ? 5 : Number.parseInt(limitStr, 10)
  if (!Number.isFinite(limit) || limit < 1 || limit > 20) {
    return { statusCode: 400, body: { error: "limit must be between 1 and 20" } }
  }

  const pathPattern = searchParams.get("pathPattern")
  const symbolLower = symbol.toLowerCase()

  interface SymbolMatch {
    name: string
    kind: "class" | "function"
    filePath: string
    lineRange: [number, number]
  }

  const matches: SymbolMatch[] = []

  for (const [filePath, fileData] of Object.entries(data)) {
    if (pathPattern && !filePath.toLowerCase().includes(pathPattern.toLowerCase())) {
      continue
    }
    const classes = Array.isArray(fileData.classes) ? fileData.classes : []
    const functions = Array.isArray(fileData.functions) ? fileData.functions : []

    for (const cls of classes) {
      if (cls.name.toLowerCase().includes(symbolLower)) {
        matches.push({
          name: cls.name,
          kind: "class",
          filePath,
          lineRange: [cls.startLine, cls.endLine],
        })
      }
    }
    for (const fn of functions) {
      if (fn.name.toLowerCase().includes(symbolLower)) {
        matches.push({
          name: fn.name,
          kind: "function",
          filePath,
          lineRange: [fn.startLine, fn.endLine],
        })
      }
    }
    if (matches.length >= limit * 3) break
  }

  const seen = new Set<string>()
  const deduped = matches.filter((m) => {
    const key = `${m.filePath}::${m.name}::${m.kind}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  }).slice(0, limit)

  const graphDir = process.env.GRAPH_DIR
  const basePath = resolveServiceBasePath(service)
  let projectRoot: string
  if (basePath) {
    projectRoot = graphDir
      ? path.resolve(graphDir, basePath)
      : path.resolve(process.cwd(), basePath)
  } else {
    projectRoot = graphDir
      ? path.resolve(graphDir, service)
      : path.resolve(process.cwd(), service)
  }

  const results = deduped.map((m) => {
    let source: string | null = null
    const startLine = Math.max(1, m.lineRange[0] - 2)
    const endLine = Math.min(m.lineRange[1] + 2, m.lineRange[0] + 497)

    const srcResult = readSource({
      projectRoot,
      filePath: m.filePath,
      startLine: String(startLine),
      endLine: String(endLine),
    })
    if (srcResult.statusCode === 200 && "content" in srcResult.payload) {
      source = srcResult.payload.content
    }

    return {
      name: m.name,
      kind: m.kind,
      filePath: m.filePath,
      lineRange: m.lineRange,
      source,
    }
  })

  return {
    statusCode: 200,
    body: { symbol, results, total: results.length },
  }
}

export async function handleStructureRequest(
  req: ApiRequest,
  _ctx: ApiContext,
): Promise<ApiResponse | null> {
  const { pathname, searchParams } = req

  if (!pathname.startsWith("/api/structure")) return null

  if (pathname === "/api/structure/files") {
    const service = searchParams.get("service")
    const err = validateServiceNameRequired(service)
    if (err) return err
    return handleFiles(service!)
  }

  if (pathname === "/api/structure/file") {
    const service = searchParams.get("service")
    const filePath = searchParams.get("path")
    if (!service || !filePath) {
      return {
        statusCode: 400,
        body: { error: "service and path parameters required", code: "PARAMS_REQUIRED" },
      }
    }
    const err = validateServiceNameRequired(service)
    if (err) return err
    return handleFile(service, filePath)
  }

  if (pathname === "/api/structure/search") {
    const service = searchParams.get("service")
    const err = validateServiceNameRequired(service)
    if (err) return err
    return handleSearch(service!, searchParams)
  }

  if (pathname === "/api/structure/chain") {
    const service = searchParams.get("service")
    const className = searchParams.get("class")
    const direction = searchParams.get("direction") || "up"
    if (!service || !className) {
      return {
        statusCode: 400,
        body: { error: "service and class parameters required" },
      }
    }
    if (direction !== "up" && direction !== "down") {
      return {
        statusCode: 400,
        body: { error: 'direction must be "up" or "down"' },
      }
    }
    const err = validateServiceNameRequired(service)
    if (err) return err
    return handleChain(service, className, direction)
  }

  if (pathname === "/api/structure/symbol-source") {
    const service = searchParams.get("service")
    const err = validateServiceNameRequired(service)
    if (err) return err
    return handleSymbolSource(service!, searchParams)
  }

  if (pathname === "/api/structure/implementors") {
    const service = searchParams.get("service")
    const iface = searchParams.get("interface")
    if (!service || !iface) {
      return {
        statusCode: 400,
        body: { error: "service and interface parameters required" },
      }
    }
    const err = validateServiceNameRequired(service)
    if (err) return err
    return handleImplementors(service, iface)
  }

  return null
}
