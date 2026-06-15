import MiniSearch from "minisearch"
import fs from "fs"
import path from "path"
import type { BusinessFeaturesDocument } from "@understand-anything/core"
import { codeTokenize } from "./code-tokenizer"
import { readJsonFile } from "../utils"

interface BusinessDoc {
  id: string
  featureId: string
  featureName: string
  matchType: "feature" | "domain" | "flow" | "step" | "interaction"
  platform: string
  domain: string
  flow: string
  step: string
  content: string
  context: string
}

export interface BusinessSearchResult {
  featureName: string
  featureId: string
  matchType: BusinessDoc["matchType"]
  matchedIn: {
    platform: string | null
    domain: string | null
    flow: string | null
    step: string | null
  }
  context: string
  score: number
}

const MINI_SEARCH_OPTIONS = {
  fields: ["content", "featureName", "domain", "flow"],
  storeFields: ["featureId", "featureName", "matchType", "platform", "domain", "flow", "step", "context"],
  tokenize: codeTokenize,
}

const SEARCH_BOOST = {
  content: 2,
  featureName: 3,
  domain: 2,
  flow: 1.5,
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
    return data.generated.interactions.map((f) => ({
      name: f.name ?? "",
      steps: (f.steps ?? []).map((s) => ({
        action: s.action ?? s.description ?? "",
        platform: s.platform ?? s.service ?? undefined,
      })),
    }))
  }
  if (Array.isArray(data?.interactions)) return data.interactions
  return []
}

export class BusinessIndex {
  private miniSearch: MiniSearch
  private platformMap: Map<string, string[]>

  constructor(
    private data: BusinessFeaturesDocument,
    private blDir: string,
    private projectRoot: string,
  ) {
    this.platformMap = new Map()
    const docs = this.buildDocs()
    this.miniSearch = new MiniSearch(MINI_SEARCH_OPTIONS)
    if (docs.length > 0) {
      this.miniSearch.addAll(docs)
    }
  }

  private buildDocs(): BusinessDoc[] {
    const docs: BusinessDoc[] = []
    let docId = 0

    for (const feature of this.data.features) {
      docs.push({
        id: `biz-${docId++}`,
        featureId: feature.id,
        featureName: feature.name,
        matchType: "feature",
        platform: "",
        domain: "",
        flow: "",
        step: "",
        content: feature.name + " " + (feature.clientLayer.summary ?? ""),
        context: feature.name,
      })

      const primaryDomain = feature.serverLayer.primaryDomain
      if (primaryDomain?.name) {
        docs.push({
          id: `biz-${docId++}`,
          featureId: feature.id,
          featureName: feature.name,
          matchType: "domain",
          platform: "",
          domain: primaryDomain.name,
          flow: "",
          step: "",
          content: primaryDomain.name,
          context: primaryDomain.name,
        })
      }

      for (const supporting of feature.serverLayer.supportingDomains ?? []) {
        if (supporting.name) {
          docs.push({
            id: `biz-${docId++}`,
            featureId: feature.id,
            featureName: feature.name,
            matchType: "domain",
            platform: "",
            domain: supporting.name,
            flow: "",
            step: "",
            content: supporting.name,
            context: supporting.name,
          })
        }
      }

      for (const [repoName, platformEntry] of Object.entries(feature.clientLayer.platforms)) {
        const standardPlatform = this.resolveStandardPlatform(repoName, platformEntry)
        const domainName = platformEntry.domainName ?? ""

        if (domainName) {
          docs.push({
            id: `biz-${docId++}`,
            featureId: feature.id,
            featureName: feature.name,
            matchType: "domain",
            platform: standardPlatform,
            domain: domainName,
            flow: "",
            step: "",
            content: domainName,
            context: domainName,
          })
        }

        const wikiRef = platformEntry.wikiRef
        if (!wikiRef) continue

        const wiki = this.readWiki(wikiRef)
        if (!wiki?.flows) continue

        const resolvedDomain = domainName || wiki.name || ""
        for (const flow of wiki.flows) {
          const flowName = flow.name ?? ""
          if (flowName) {
            docs.push({
              id: `biz-${docId++}`,
              featureId: feature.id,
              featureName: feature.name,
              matchType: "flow",
              platform: standardPlatform,
              domain: resolvedDomain,
              flow: flowName,
              step: "",
              content: flowName,
              context: `${flowName} (${flow.steps?.length ?? 0} steps)`,
            })
          }

          for (const step of flow.steps ?? []) {
            const description = step.description ?? ""
            if (description) {
              docs.push({
                id: `biz-${docId++}`,
                featureId: feature.id,
                featureName: feature.name,
                matchType: "step",
                platform: standardPlatform,
                domain: resolvedDomain,
                flow: flowName,
                step: description,
                content: description,
                context: flowName ? `${flowName} > ${description}` : description,
              })
            }
          }
        }
      }

    }

    this.indexAllInteractions(docs)

    return docs
  }

  private indexAllInteractions(docs: BusinessDoc[]): void {
    const interactionsDir = path.join(this.blDir, "feature-interactions")
    if (!fs.existsSync(interactionsDir)) return

    let files: string[]
    try {
      files = fs.readdirSync(interactionsDir)
    } catch {
      return
    }

    let docId = docs.length

    for (const filename of files) {
      if (!filename.startsWith("feature-") || !filename.endsWith(".json")) continue
      if (filename.includes("..")) continue

      const interactionData = readJsonFile<{
        featureId?: string
        featureName?: string
      }>(path.join(interactionsDir, filename))
      if (!interactionData) continue

      const flows = extractInteractionFlows(interactionData)
      if (flows.length === 0) continue

      const featureId = interactionData.featureId ?? ""
      const featureName = interactionData.featureName ?? ""

      for (const flow of flows) {
        const flowName = flow.name ?? ""
        if (flowName) {
          docs.push({
            id: `biz-${docId++}`,
            featureId,
            featureName,
            matchType: "interaction",
            platform: "",
            domain: "",
            flow: flowName,
            step: "",
            content: flowName,
            context: `${flowName} (${flow.steps?.length ?? 0} steps)`,
          })
        }

        for (const step of flow.steps ?? []) {
          const action = step.action ?? ""
          if (action) {
            docs.push({
              id: `biz-${docId++}`,
              featureId,
              featureName,
              matchType: "interaction",
              platform: step.platform ?? "",
              domain: "",
              flow: flowName,
              step: action,
              content: action,
              context: flowName ? `${flowName} > ${action}` : action,
            })
          }
        }
      }
    }
  }

  private resolveStandardPlatform(
    repoName: string,
    platformEntry: { standardPlatform?: string },
  ): string {
    if (platformEntry.standardPlatform) return platformEntry.standardPlatform
    for (const [standard, mappedRepo] of Object.entries(this.data.platformMapping ?? {})) {
      if (mappedRepo === repoName) return standard
    }
    return repoName
  }

  private wikiCache = new Map<string, { name?: string; flows?: Array<{ name?: string; steps?: Array<{ description?: string }> }> } | null>()

  private readWiki(wikiRef: string): { name?: string; flows?: Array<{ name?: string; steps?: Array<{ description?: string }> }> } | null {
    if (this.wikiCache.has(wikiRef)) return this.wikiCache.get(wikiRef)!
    if (!wikiRef || wikiRef.includes("..") || path.isAbsolute(wikiRef)) {
      this.wikiCache.set(wikiRef, null)
      return null
    }
    const wiki = readJsonFile<{ name?: string; flows?: Array<{ name?: string; steps?: Array<{ description?: string }> }> }>(
      path.join(this.projectRoot, wikiRef),
    )
    this.wikiCache.set(wikiRef, wiki)
    return wiki
  }

  search(query: string, options?: { platform?: string | null; limit?: number }): BusinessSearchResult[] {
    const limit = options?.limit ?? 50
    const platformFilter = options?.platform?.toLowerCase() ?? null

    const raw = this.miniSearch.search(query, {
      boost: SEARCH_BOOST,
      prefix: true,
      fuzzy: 0.2,
    })

    const results: BusinessSearchResult[] = []
    const seen = new Set<string>()

    for (const hit of raw) {
      if (results.length >= limit) break

      const platform = (hit.platform as string) || null
      if (platformFilter && platform) {
        const pLower = platform.toLowerCase()
        if (pLower !== platformFilter && !pLower.includes(platformFilter)) {
          continue
        }
      }

      const key = `${hit.matchType}:${hit.featureId}:${hit.flow ?? ""}:${hit.step ?? ""}:${platform ?? ""}`
      if (seen.has(key)) continue
      seen.add(key)

      results.push({
        featureName: hit.featureName as string,
        featureId: hit.featureId as string,
        matchType: hit.matchType as BusinessDoc["matchType"],
        matchedIn: {
          platform,
          domain: (hit.domain as string) || null,
          flow: (hit.flow as string) || null,
          step: (hit.step as string) || null,
        },
        context: hit.context as string,
        score: hit.score,
      })
    }

    return results
  }
}

interface CachedIndex {
  mtime: number
  index: BusinessIndex
}

const indexCache = new Map<string, CachedIndex>()
const MAX_CACHE_ENTRIES = 3

function evictOldestCacheEntry(): void {
  if (indexCache.size <= MAX_CACHE_ENTRIES) return
  const oldest = [...indexCache.entries()].sort((a, b) => a[1].mtime - b[1].mtime)[0]
  if (oldest) indexCache.delete(oldest[0])
}

function getEffectiveMtime(blDir: string): number {
  let mtime = 0
  const featuresPath = path.join(blDir, "business-features.json")
  try {
    mtime = fs.statSync(featuresPath).mtimeMs
  } catch {
    return 0
  }
  const interactionsDir = path.join(blDir, "feature-interactions")
  try {
    const dirMtime = fs.statSync(interactionsDir).mtimeMs
    if (dirMtime > mtime) mtime = dirMtime
  } catch { /* no interactions dir is ok */ }
  return mtime
}

export function getOrBuildBusinessIndex(
  blDir: string,
  projectRoot: string,
): BusinessIndex | null {
  const featuresPath = path.join(blDir, "business-features.json")
  if (!fs.existsSync(featuresPath)) return null

  const mtime = getEffectiveMtime(blDir)
  if (mtime === 0) return null

  const cached = indexCache.get(blDir)
  if (cached && cached.mtime === mtime) return cached.index

  let data: BusinessFeaturesDocument | null
  try {
    data = JSON.parse(fs.readFileSync(featuresPath, "utf-8"))
  } catch {
    console.warn(`[business-index] Failed to parse ${featuresPath}`)
    return null
  }
  if (!data) return null

  const index = new BusinessIndex(data, blDir, projectRoot)
  indexCache.set(blDir, { mtime, index })
  evictOldestCacheEntry()
  return index
}
