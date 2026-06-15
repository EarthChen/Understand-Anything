import crypto from "crypto"
import fs from "fs"
import path from "path"
import type { BusinessFeature, BusinessFeaturesDocument } from "@understand-anything/core"
import type { ApiRequest, ApiContext, ApiResponse } from "../types"
import { businessLandscapeDir, readJsonFile, resolveProjectRoot } from "../utils"
import { getOrBuildBusinessIndex } from "./business-index"

interface DomainsIndex {
  domains: Array<{ id: string; name: string; summary: string; detailRef: string }>
  stats: Record<string, number>
}

function readBusinessFeatures(blDir: string): BusinessFeaturesDocument | null {
  return readJsonFile<BusinessFeaturesDocument>(path.join(blDir, "business-features.json"))
}

function featureNameToSlug(name: string): string {
  let slug = name.toLowerCase().trim()
  slug = slug.replace(/[\s_]+/g, "-")
  slug = slug.replace(/[^a-z0-9-]/g, "")
  slug = slug.replace(/-+/g, "-").replace(/^-|-$/g, "")
  if (!slug) {
    slug = crypto.createHash("md5").update(name).digest("hex").slice(0, 8)
  }
  return slug
}

function adaptFeaturesToDomainsList(data: BusinessFeaturesDocument) {
  return {
    _source: "business-features" as const,
    domains: data.features.map((feature) => ({
      id: feature.id,
      name: feature.name,
      summary: feature.clientLayer.summary,
      facets: feature.clientLayer.deliveryPlatforms,
      matchType: "feature-association",
      detailRef: null,
    })),
    stats: data.stats,
  }
}

function findFeatureBySlug(data: BusinessFeaturesDocument, slug: string): BusinessFeature | undefined {
  return data.features.find(
    (f) =>
      f.id === slug
      || f.name === slug
      || f.id === `feature:${slug}`
      || featureNameToSlug(f.name) === slug,
  )
}

function resolveRepoFromStandardPlatform(
  data: BusinessFeaturesDocument,
  feature: BusinessFeature,
  standardPlatform: string,
): string | null {
  const repoFromMapping = data.platformMapping?.[standardPlatform]
  if (repoFromMapping && feature.clientLayer.platforms[repoFromMapping]) {
    return repoFromMapping
  }
  for (const [repo, entry] of Object.entries(feature.clientLayer.platforms)) {
    if (entry.standardPlatform === standardPlatform) {
      return repo
    }
  }
  return null
}

function readWikiFromRef(projectRoot: string, wikiRef: string): unknown | null {
  if (!wikiRef || wikiRef.includes("..") || path.isAbsolute(wikiRef)) {
    return null
  }
  return readJsonFile(path.join(projectRoot, wikiRef))
}

interface WikiFlow {
  name?: string
  steps?: Array<{ description?: string }>
}

interface NormalizedFlow {
  name: string
  steps: Array<{ action: string; platform?: string }>
}

function extractInteractionFlows(doc: unknown): NormalizedFlow[] {
  const data = doc as {
    flows?: NormalizedFlow[]
    generated?: { interactions?: Array<{ name?: string; steps?: Array<{ action?: string; description?: string; platform?: string; service?: string }> }> }
    interactions?: NormalizedFlow[]
  }
  if (Array.isArray(data?.flows)) return data.flows
  if (Array.isArray(data?.generated?.interactions)) {
    return data.generated.interactions.map((flow) => ({
      name: flow.name ?? "",
      steps: (flow.steps ?? []).map((s) => ({
        action: s.action ?? s.description ?? "",
        platform: s.platform ?? s.service ?? undefined,
      })),
    }))
  }
  if (Array.isArray(data?.interactions)) return data.interactions
  return []
}

function stepMatchesPlatform(stepPlatform: string | null | undefined, platformFilterLower: string): boolean {
  if (!stepPlatform) return false
  const stepPlatformLower = stepPlatform.toLowerCase()
  if (stepPlatformLower === platformFilterLower) return true
  return stepPlatformLower.includes(platformFilterLower)
}

type BusinessSearchMatchType = "feature" | "domain" | "flow" | "step" | "interaction"

interface BusinessSearchMatch {
  featureName: string
  featureId: string
  matchType: BusinessSearchMatchType
  matchedIn: {
    platform: string | null
    domain: string | null
    flow: string | null
    step: string | null
  }
  context: string
}

function resolveStandardPlatform(
  data: BusinessFeaturesDocument,
  repoName: string,
  platformEntry: { standardPlatform?: string },
): string {
  if (platformEntry.standardPlatform) return platformEntry.standardPlatform
  for (const [standard, mappedRepo] of Object.entries(data.platformMapping ?? {})) {
    if (mappedRepo === repoName) return standard
  }
  return repoName
}

function searchFeatureInteractions(
  blDir: string,
  keywords: string[],
  platformFilterLower: string | null,
): BusinessSearchMatch[] {
  const results: BusinessSearchMatch[] = []
  const interactionsDir = path.join(blDir, "feature-interactions")
  if (!fs.existsSync(interactionsDir)) return results

  let files: string[]
  try {
    files = fs.readdirSync(interactionsDir)
  } catch {
    return results
  }

  function matchesKeyword(text: string): boolean {
    const lower = text.toLowerCase()
    return keywords.some((kw) => lower.includes(kw))
  }

  for (const filename of files) {
    if (!filename.startsWith("feature-") || !filename.endsWith(".json")) continue
    if (filename.includes("..")) continue

    const interactionData = readJsonFile<{
      featureId?: string
      featureName?: string
    }>(path.join(interactionsDir, filename))
    const flows = extractInteractionFlows(interactionData)
    if (flows.length === 0) continue

    const featureId = interactionData?.featureId ?? ""
    const featureName = interactionData?.featureName ?? ""

    for (const flow of flows) {
      const flowName = flow.name ?? ""
      if (matchesKeyword(flowName)) {
        if (platformFilterLower) {
          const hasMatchingPlatform = flow.steps?.some(
            (step) => stepMatchesPlatform(step.platform, platformFilterLower),
          )
          if (!hasMatchingPlatform) continue
        }

        const stepCount = flow.steps?.length ?? 0
        results.push({
          featureName,
          featureId,
          matchType: "interaction",
          matchedIn: { platform: null, domain: null, flow: flowName, step: null },
          context: `${flowName} (${stepCount} steps)`,
        })
        continue
      }

      for (const step of flow.steps ?? []) {
        const action = step.action ?? ""
        const stepPlatform = step.platform ?? null
        if (platformFilterLower && !stepMatchesPlatform(stepPlatform, platformFilterLower)) {
          continue
        }

        if (matchesKeyword(action)) {
          results.push({
            featureName,
            featureId,
            matchType: "interaction",
            matchedIn: {
              platform: stepPlatform,
              domain: null,
              flow: flowName || null,
              step: action,
            },
            context: flowName ? `${flowName} > ${action}` : action,
          })
        }
      }
    }
  }

  return results
}

function searchBusinessFeatures(
  projectRoot: string,
  blDir: string,
  data: BusinessFeaturesDocument,
  query: string,
  platformFilter?: string | null,
): BusinessSearchMatch[] {
  const keywords = query.split(",").map((k) => k.trim().toLowerCase()).filter(Boolean)
  const results: BusinessSearchMatch[] = []
  const seen = new Set<string>()
  const platformFilterLower = platformFilter?.toLowerCase() ?? null
  const wikiCache = new Map<string, { name?: string; flows?: WikiFlow[] } | null>()

  function addResult(match: BusinessSearchMatch) {
    const key = `${match.matchType}:${match.featureId}:${match.matchedIn.flow ?? ""}:${match.matchedIn.step ?? ""}:${match.matchedIn.platform ?? ""}`
    if (!seen.has(key)) {
      seen.add(key)
      results.push(match)
    }
  }

  function matchesKeyword(text: string): boolean {
    const lower = text.toLowerCase()
    return keywords.some((kw) => lower.includes(kw))
  }

  for (const feature of data.features) {
    if (matchesKeyword(feature.name)) {
      addResult({
        featureName: feature.name,
        featureId: feature.id,
        matchType: "feature",
        matchedIn: { platform: null, domain: null, flow: null, step: null },
        context: feature.name,
      })
    }

    const primaryDomain = feature.serverLayer.primaryDomain
    if (matchesKeyword(primaryDomain?.name ?? "")) {
      addResult({
        featureName: feature.name,
        featureId: feature.id,
        matchType: "domain",
        matchedIn: { platform: null, domain: primaryDomain!.name, flow: null, step: null },
        context: primaryDomain!.name,
      })
    }
    for (const supporting of feature.serverLayer.supportingDomains ?? []) {
      if (matchesKeyword(supporting.name ?? "")) {
        addResult({
          featureName: feature.name,
          featureId: feature.id,
          matchType: "domain",
          matchedIn: { platform: null, domain: supporting.name!, flow: null, step: null },
          context: supporting.name!,
        })
      }
    }

    for (const [repoName, platformEntry] of Object.entries(feature.clientLayer.platforms)) {
      const standardPlatform = resolveStandardPlatform(data, repoName, platformEntry)
      if (platformFilterLower && standardPlatform.toLowerCase() !== platformFilterLower) {
        continue
      }

      const domainName = platformEntry.domainName ?? null
      if (matchesKeyword(domainName ?? "")) {
        addResult({
          featureName: feature.name,
          featureId: feature.id,
          matchType: "domain",
          matchedIn: {
            platform: standardPlatform,
            domain: domainName,
            flow: null,
            step: null,
          },
          context: domainName!,
        })
      }

      const wikiRef = platformEntry.wikiRef
      if (!wikiRef) continue

      if (!wikiCache.has(wikiRef)) wikiCache.set(wikiRef, readWikiFromRef(projectRoot, wikiRef) as { name?: string; flows?: WikiFlow[] } | null)
      const wiki = wikiCache.get(wikiRef)!
      if (!wiki?.flows) continue

      const resolvedDomain = domainName ?? wiki.name ?? null
      for (const flow of wiki.flows) {
        const flowName = flow.name ?? ""
        if (matchesKeyword(flowName)) {
          const stepCount = flow.steps?.length ?? 0
          addResult({
            featureName: feature.name,
            featureId: feature.id,
            matchType: "flow",
            matchedIn: {
              platform: standardPlatform,
              domain: resolvedDomain,
              flow: flowName,
              step: null,
            },
            context: `${flowName} (${stepCount} steps)`,
          })
          continue
        }

        for (const step of flow.steps ?? []) {
          const description = step.description ?? ""
          if (matchesKeyword(description)) {
            addResult({
              featureName: feature.name,
              featureId: feature.id,
              matchType: "step",
              matchedIn: {
                platform: standardPlatform,
                domain: resolvedDomain,
                flow: flowName || null,
                step: description,
              },
              context: flowName ? `${flowName} > ${description}` : description,
            })
          }
        }
      }
    }
  }

  results.push(...searchFeatureInteractions(blDir, keywords, platformFilterLower))

  return results
}

function applyFlowFilter(platformDetail: unknown, flowFilter: string): unknown {
  if (!platformDetail || typeof platformDetail !== "object") return platformDetail
  const detail = platformDetail as { flows?: WikiFlow[] }
  if (!detail.flows) return platformDetail

  const keyword = flowFilter.toLowerCase()
  const totalFlows = detail.flows.length
  const filtered = detail.flows.filter((flow) => {
    if (flow.name?.toLowerCase().includes(keyword)) return true
    return flow.steps?.some((step) => step.description?.toLowerCase().includes(keyword))
  })

  return {
    ...detail,
    flows: filtered,
    filteredBy: "keyword",
    totalFlows,
  }
}

function basicFeatureInfo(feature: BusinessFeature) {
  return {
    id: feature.id,
    name: feature.name,
    summary: feature.clientLayer.summary,
    deliveryPlatforms: feature.clientLayer.deliveryPlatforms,
  }
}

function resolveFeaturePlatformDetail(
  projectRoot: string,
  data: BusinessFeaturesDocument,
  feature: BusinessFeature,
  standardPlatform: string,
): { feature: ReturnType<typeof basicFeatureInfo>; platformDetail: unknown; repoName: string } | null {
  const repoName = resolveRepoFromStandardPlatform(data, feature, standardPlatform)
  if (!repoName) return null

  const platformEntry = feature.clientLayer.platforms[repoName]
  const wikiRef = platformEntry?.wikiRef
  if (!wikiRef) return null

  const platformDetail = readWikiFromRef(projectRoot, wikiRef)
  if (!platformDetail) return null

  return {
    feature: basicFeatureInfo(feature),
    platformDetail,
    repoName,
  }
}

function readFeatureInteractions(blDir: string, feature: BusinessFeature): unknown[] {
  const slug = featureNameToSlug(feature.name)
  const interactionFile = path.join(blDir, "feature-interactions", `feature-${slug}.json`)
  const interactionData = readJsonFile(interactionFile)
  if (!interactionData) return []
  const flows = extractInteractionFlows(interactionData)
  if (flows.length > 0) return flows
  const data = interactionData as { skeleton?: unknown }
  if (data.skeleton) return [data.skeleton]
  return []
}

function adaptFeatureToDetail(blDir: string, feature: BusinessFeature) {
  const { primaryDomain, supportingDomains } = feature.serverLayer
  return {
    _source: "business-features" as const,
    id: feature.id,
    name: feature.name,
    summary: feature.clientLayer.summary,
    interactions: readFeatureInteractions(blDir, feature),
    serverDependencies: {
      primary: primaryDomain,
      supporting: supportingDomains,
    },
    clientLayer: feature.clientLayer,
  }
}

function buildFeaturePanorama(data: BusinessFeaturesDocument) {
  const topFeatures = [...data.features]
    .sort((a, b) => {
      const aHasServer = a.serverLayer.primaryDomain ? 1 : 0
      const bHasServer = b.serverLayer.primaryDomain ? 1 : 0
      return bHasServer - aHasServer
    })
    .slice(0, 10)
    .map((f) => ({
      id: f.id,
      name: f.name,
      summary: f.clientLayer.summary,
      hasServerAssociation: Boolean(f.serverLayer.primaryDomain),
    }))

  return {
    _source: "business-features" as const,
    serverIndex: data.serverIndex,
    stats: data.stats,
    topFeatures,
  }
}

export async function handleBusinessRequest(req: ApiRequest, _ctx: ApiContext): Promise<ApiResponse | null> {
  const { pathname, searchParams } = req
  if (!pathname.startsWith("/api/business")) return null

  const blDir = businessLandscapeDir(resolveProjectRoot())
  if (!fs.existsSync(blDir)) {
    return { statusCode: 404, body: { error: "business-landscape not found. Run /understand-business first.", code: "BUSINESS_LANDSCAPE_NOT_FOUND" } }
  }

  if (pathname === "/api/business/domains") {
    const featuresData = readBusinessFeatures(blDir)
    if (featuresData) {
      return { statusCode: 200, body: adaptFeaturesToDomainsList(featuresData) }
    }
    const data = readJsonFile<DomainsIndex>(path.join(blDir, "domains.json"))
    if (!data) return { statusCode: 404, body: { error: "domains.json not found" } }
    return { statusCode: 200, body: { ...data, _deprecated: true } }
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
    const featuresData = readBusinessFeatures(blDir)
    if (featuresData) {
      return {
        statusCode: 200,
        body: {
          primaryView: "features",
          featureCount: featuresData.stats.totalFeatures,
          withServerAssociation: featuresData.stats.withServerAssociation,
          serverDomainsReferenced: featuresData.stats.serverDomainsReferenced,
          stats: featuresData.stats,
        },
      }
    }
    const data = readJsonFile<DomainsIndex>(path.join(blDir, "domains.json"))
    if (!data) return { statusCode: 404, body: { error: "domains.json not found" } }
    return {
      statusCode: 200,
      body: {
        primaryView: "features",
        domainCount: data.domains.length,
        stats: data.stats,
        facets: [...new Set(data.domains.flatMap((d) => (d as { facets?: string[] }).facets ?? []))],
      },
    }
  }

  if (pathname === "/api/business/search") {
    const q = searchParams.get("q") ?? ""
    if (!q.trim()) return { statusCode: 400, body: { error: "q parameter required" } }
    if (q.length > 500) {
      return { statusCode: 400, body: { error: "query too long (max 500 characters)" } }
    }

    const platform = searchParams.get("platform")?.toLowerCase() ?? null
    const limitStr = searchParams.get("limit") ?? "50"
    const limit = Math.min(Math.max(Number.parseInt(limitStr, 10) || 50, 1), 100)
    const projectRoot = resolveProjectRoot()

    const index = getOrBuildBusinessIndex(blDir, projectRoot)
    if (!index) {
      return { statusCode: 404, body: { error: "business-features.json not found or invalid" } }
    }

    const results = index.search(q, { platform, limit })

    return {
      statusCode: 200,
      body: {
        query: q,
        ...(platform ? { platform } : {}),
        results,
        totalResults: results.length,
      },
    }
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
    const featuresData = readBusinessFeatures(blDir)
    if (featuresData) {
      return { statusCode: 200, body: buildFeaturePanorama(featuresData) }
    }
    const panoramaPath = path.join(resolveProjectRoot(), ".understand-anything/wiki/domains/business.json")
    const data = readJsonFile(panoramaPath)
    if (!data) return { statusCode: 404, body: { error: "business.json panorama not found" } }
    return { statusCode: 200, body: data }
  }

  if (pathname === "/api/business/features") {
    const data = readJsonFile<BusinessFeaturesDocument>(path.join(blDir, "business-features.json"))
    if (!data) return { statusCode: 404, body: { error: "business-features.json not found" } }
    return { statusCode: 200, body: data }
  }

  const platformMatch = pathname.match(/^\/api\/business\/features\/([^/]+)\/platform\/([^/]+)$/)
  if (platformMatch) {
    const featureId = decodeURIComponent(platformMatch[1])
    const standardPlatform = decodeURIComponent(platformMatch[2]).toLowerCase()
    if (
      featureId.includes("..") || featureId.includes("/") || featureId.includes("\\") || featureId.includes("\0")
      || standardPlatform.includes("..") || standardPlatform.includes("/") || standardPlatform.includes("\\") || standardPlatform.includes("\0")
    ) {
      return { statusCode: 400, body: { error: "Invalid path: path traversal detected", code: "PATH_TRAVERSAL" } }
    }

    const data = readBusinessFeatures(blDir)
    if (!data) return { statusCode: 404, body: { error: "business-features.json not found" } }

    const feature = findFeatureBySlug(data, featureId)
    if (!feature) return { statusCode: 404, body: { error: `Feature not found: ${featureId}` } }

    const projectRoot = resolveProjectRoot()
    const resolved = resolveFeaturePlatformDetail(projectRoot, data, feature, standardPlatform)
    if (!resolved) {
      return { statusCode: 404, body: { error: `Platform not found for feature: ${standardPlatform}`, code: "PLATFORM_NOT_FOUND" } }
    }

    const flowFilter = searchParams.get("flow")
    const platformDetail = flowFilter
      ? applyFlowFilter(resolved.platformDetail, flowFilter)
      : resolved.platformDetail

    return {
      statusCode: 200,
      body: {
        feature: resolved.feature,
        platform: standardPlatform,
        repoName: resolved.repoName,
        platformDetail,
      },
    }
  }

  const featureMatch = pathname.match(/^\/api\/business\/features\/([^/]+)$/)
  if (featureMatch) {
    const featureId = decodeURIComponent(featureMatch[1])
    if (featureId.includes("..") || featureId.includes("/") || featureId.includes("\\") || featureId.includes("\0")) {
      return { statusCode: 400, body: { error: "Invalid featureId: path traversal detected", code: "PATH_TRAVERSAL" } }
    }
    const data = readJsonFile<BusinessFeaturesDocument>(path.join(blDir, "business-features.json"))
    if (!data) return { statusCode: 404, body: { error: "business-features.json not found" } }
    const feature = findFeatureBySlug(data, featureId)
    if (!feature) return { statusCode: 404, body: { error: `Feature not found: ${featureId}` } }
    return { statusCode: 200, body: feature }
  }

  const slugMatch = pathname.match(/^\/api\/business\/domains\/([^/]+)$/)
  if (slugMatch) {
    const slug = decodeURIComponent(slugMatch[1])
    if (slug.includes("..") || slug.includes("/") || slug.includes("\\") || slug.includes("\0")) {
      return { statusCode: 400, body: { error: "Invalid slug: path traversal detected", code: "PATH_TRAVERSAL" } }
    }

    const featuresData = readBusinessFeatures(blDir)
    if (featuresData) {
      const feature = findFeatureBySlug(featuresData, slug)
      if (!feature) return { statusCode: 404, body: { error: `Domain not found: ${slug}` } }

      const standardPlatform = searchParams.get("platform")?.toLowerCase()
      if (standardPlatform) {
        const projectRoot = resolveProjectRoot()
        const resolved = resolveFeaturePlatformDetail(projectRoot, featuresData, feature, standardPlatform)
        if (!resolved) {
          return { statusCode: 404, body: { error: `Platform not found for feature: ${standardPlatform}`, code: "PLATFORM_NOT_FOUND" } }
        }

        const flowFilter = searchParams.get("flow")
        const platformDetail = flowFilter
          ? applyFlowFilter(resolved.platformDetail, flowFilter)
          : resolved.platformDetail

        return {
          statusCode: 200,
          body: {
            _source: "business-features" as const,
            feature: resolved.feature,
            platform: standardPlatform,
            repoName: resolved.repoName,
            platformDetail,
          },
        }
      }

      return { statusCode: 200, body: adaptFeatureToDetail(blDir, feature) }
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
        if (!filename.includes("..") && !filename.includes("/") && !filename.includes("\\") && !filename.includes("\0")) {
          detail = readJsonFile(path.join(domainsDir, filename))
        }
      }
    }
    if (!detail) return { statusCode: 404, body: { error: `Domain not found: ${slug}` } }
    return { statusCode: 200, body: detail }
  }

  return { statusCode: 404, body: { error: `Unknown business API endpoint: ${pathname}` } }
}
