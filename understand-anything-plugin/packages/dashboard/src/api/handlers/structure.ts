import fs from "fs"
import path from "path"
import type { ApiRequest, ApiContext, ApiResponse } from "../types"
import {
  resolveServiceDataPath,
  validateServiceNameRequired,
} from "../service-resolver"

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

interface SearchResult {
  filePath: string
  name: string
  kind: "class" | "function"
  lineRange: [number, number]
  match: Record<string, string>
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
  const pathPattern = searchParams.get("pathPattern")
  const limitStr = searchParams.get("limit")
  const limit = limitStr === null ? 50 : Number.parseInt(limitStr, 10)
  if (!Number.isFinite(limit) || limit < 1 || limit > 500) {
    return { statusCode: 400, body: { error: "limit must be between 1 and 500" } }
  }

  if (!annotation && !paramType && !returnType && !iface && !propertyType) {
    return {
      statusCode: 400,
      body: {
        error: "At least one search filter required: annotation, paramType, returnType, interface, propertyType",
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
  }

  const seen = new Set<string>()
  const deduped = results.filter((r) => {
    const key = `${r.filePath}::${r.name}::${r.kind}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  const total = deduped.length
  const hasMore = total > limit
  return {
    statusCode: 200,
    body: { results: deduped.slice(0, limit), total, hasMore, query },
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

  return null
}
