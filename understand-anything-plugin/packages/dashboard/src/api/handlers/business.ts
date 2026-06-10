import fs from "fs"
import path from "path"
import type { ApiRequest, ApiContext, ApiResponse } from "../types"
import { businessLandscapeDir, readJsonFile, resolveProjectRoot } from "../utils"
import { handleUnifiedSearch } from "./search"

interface DomainsIndex {
  domains: Array<{ id: string; name: string; summary: string; detailRef: string }>
  stats: Record<string, number>
}

export async function handleBusinessRequest(req: ApiRequest, _ctx: ApiContext): Promise<ApiResponse | null> {
  const { pathname, searchParams } = req
  if (!pathname.startsWith("/api/business")) return null

  const blDir = businessLandscapeDir(resolveProjectRoot())
  if (!fs.existsSync(blDir)) {
    return { statusCode: 404, body: { error: "business-landscape not found. Run /understand-business first.", code: "BUSINESS_LANDSCAPE_NOT_FOUND" } }
  }

  if (pathname === "/api/business/domains") {
    const data = readJsonFile<DomainsIndex>(path.join(blDir, "domains.json"))
    if (!data) return { statusCode: 404, body: { error: "domains.json not found" } }
    return { statusCode: 200, body: data }
  }

  if (pathname === "/api/business/cross-facet-links") {
    const data = readJsonFile<{ links: Array<{ domain: string }>; unmatchedEndpoints: unknown }>(
      path.join(blDir, "cross-facet-links.json"),
    )
    if (!data) return { statusCode: 404, body: { error: "cross-facet-links.json not found" } }
    const domain = searchParams.get("domain")
    if (domain) {
      return {
        statusCode: 200,
        body: { ...data, links: data.links.filter((link) => link.domain === domain || link.domain === `domain:${domain}`) },
      }
    }
    return { statusCode: 200, body: data }
  }

  if (pathname === "/api/business/overview") {
    const data = readJsonFile<DomainsIndex>(path.join(blDir, "domains.json"))
    if (!data) return { statusCode: 404, body: { error: "domains.json not found" } }
    return {
      statusCode: 200,
      body: {
        domainCount: data.domains.length,
        stats: data.stats,
        facets: [...new Set(data.domains.flatMap((d) => (d as { facets?: string[] }).facets ?? []))],
      },
    }
  }

  if (pathname === "/api/business/search") {
    const q = searchParams.get("q") ?? ""
    if (!q.trim()) return { statusCode: 400, body: { error: "q parameter required" } }
    const response = handleUnifiedSearch(q, "business", undefined, 50)
    const body = response.body as { results?: Array<{ id: string; name: string; summary: string }> }
    const results = (body.results ?? []).map((r) => ({
      id: r.id.replace(/^business:/, ""),
      name: r.name,
      match: q,
    }))
    return { statusCode: 200, body: { results } }
  }

  if (pathname === "/api/business/meta") {
    const data = readJsonFile<{
      contentHash: string
      sourceHashes: Record<string, string>
      generatedAt: string
      version: string
      status: "complete" | "degraded"
    }>(path.join(blDir, "meta.json"))
    if (!data) return { statusCode: 404, body: { error: "meta.json not found" } }
    return { statusCode: 200, body: data }
  }

  if (pathname === "/api/business/panorama") {
    const panoramaPath = path.join(resolveProjectRoot(), ".understand-anything/wiki/domains/business.json")
    const data = readJsonFile(panoramaPath)
    if (!data) return { statusCode: 404, body: { error: "business.json panorama not found" } }
    return { statusCode: 200, body: data }
  }

  const slugMatch = pathname.match(/^\/api\/business\/domains\/([^/]+)$/)
  if (slugMatch) {
    const slug = decodeURIComponent(slugMatch[1])
    if (slug.includes("..") || slug.includes("/") || slug.includes("\\")) {
      return { statusCode: 400, body: { error: "Invalid slug: path traversal detected", code: "PATH_TRAVERSAL" } }
    }
    const domainsDir = path.join(blDir, "domains")
    const detailPath = path.join(domainsDir, `${slug}.json`)
    let detail = readJsonFile(detailPath)
    if (!detail && !slug.startsWith("domain-")) {
      detail = readJsonFile(path.join(domainsDir, `domain-${slug}.json`))
    }
    if (!detail) {
      const indexData = readJsonFile<DomainsIndex>(path.join(blDir, "domains.json"))
      const matched = indexData?.domains.find(
        (d) => d.name === slug || d.id === slug || d.id === `domain:${slug}`,
      )
      if (matched?.detailRef) {
        const filename = path.basename(matched.detailRef)
        if (!filename.includes("..") && !filename.includes("/") && !filename.includes("\\")) {
          detail = readJsonFile(path.join(domainsDir, filename))
        }
      }
    }
    if (!detail) return { statusCode: 404, body: { error: `Domain not found: ${slug}` } }
    return { statusCode: 200, body: detail }
  }

  return { statusCode: 404, body: { error: `Unknown business API endpoint: ${pathname}` } }
}
