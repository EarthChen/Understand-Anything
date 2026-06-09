import path from "path"
import type { ApiRequest, ApiContext, ApiResponse } from "../types"
import { findGraphFile, readJsonFile, resolveProjectRoot } from "../utils"
import type { SystemGraph } from "@understand-anything/core"

interface ServiceEntry {
  name: string
  basePath: string
  facet?: string
  dataLayers: {
    kg: { available: boolean; commit?: string; analyzedAt?: string }
    domain: { available: boolean; nodeCount?: number }
    wiki: { available: boolean; qualityGrade?: string; generatedAt?: string }
    business: { available: boolean; domainCount?: number }
  }
}

function buildServiceList(projectRoot: string): ServiceEntry[] {
  const sgPath = findGraphFile("system-graph.json")
  if (!sgPath) return []
  const sg = readJsonFile<SystemGraph>(sgPath)
  if (!sg?.serviceIndex) return []

  const blDir = path.join(projectRoot, ".understand-anything", "business-landscape")
  const blDomains = readJsonFile<{ domains?: unknown[] }>(path.join(blDir, "domains.json"))

  return Object.entries(sg.serviceIndex).map(([name, info]) => {
    const basePath = info.basePath ?? name
    const svcRoot = path.resolve(projectRoot, basePath, ".understand-anything")

    const kgMeta = readJsonFile<{ lastAnalyzedAt?: string; analyzedAt?: string; gitCommitHash?: string }>(
      path.join(svcRoot, "meta.json"),
    )
    const wikiMeta = readJsonFile<{ generatedAt?: string; qualityScore?: { overallGrade?: string } }>(
      path.join(svcRoot, "wiki", "meta.json"),
    )
    const domainGraph = readJsonFile<{ nodes?: unknown[] }>(path.join(svcRoot, "domain-graph.json"))

    return {
      name,
      basePath,
      facet: info.facet,
      dataLayers: {
        kg: {
          available: info.hasKg ?? false,
          commit: kgMeta?.gitCommitHash,
          analyzedAt: kgMeta?.lastAnalyzedAt ?? kgMeta?.analyzedAt,
        },
        domain: {
          available: info.hasDomain ?? false,
          nodeCount: domainGraph?.nodes?.length,
        },
        wiki: {
          available: info.hasWiki ?? false,
          qualityGrade: wikiMeta?.qualityScore?.overallGrade,
          generatedAt: wikiMeta?.generatedAt,
        },
        business: {
          available: blDomains != null,
          domainCount: blDomains?.domains?.length,
        },
      },
    }
  })
}

export async function handleServicesRequest(req: ApiRequest, _ctx: ApiContext): Promise<ApiResponse | null> {
  if (req.pathname !== "/api/services") return null

  const projectRoot = resolveProjectRoot()
  let services = buildServiceList(projectRoot)

  if (services.length === 0) {
    return { statusCode: 404, body: { error: "system-graph.json not found. Run /understand-wiki Phase 3+ first." } }
  }

  const nameFilter = req.searchParams.get("name")
  if (nameFilter) {
    services = services.filter((s) => s.name === nameFilter)
  }

  const hasFilter = req.searchParams.get("has")
  if (hasFilter) {
    const required = hasFilter.split(",").map((s) => s.trim())
    services = services.filter((s) =>
      required.every((layer) => {
        const dl = s.dataLayers[layer as keyof typeof s.dataLayers]
        return dl?.available === true
      }),
    )
  }

  return { statusCode: 200, body: { services, totalServices: services.length } }
}
