import MiniSearch from "minisearch"
import { codeTokenize } from "./code-tokenizer"
import type { KnowledgeGraph } from "@understand-anything/core"

interface KgDoc {
  id: string
  name: string
  summary: string
  tags: string
  type: string
  service: string
  filePath: string
  startLine: number
  endLine: number
  layer: string
}

export interface KgSearchResult {
  id: string
  name: string
  type: string
  layer: string
  summary: string
  score: number
  service?: string
  filePath?: string
  lineRange?: [number, number]
  tags?: string
}

export interface KgSearchOptions {
  q?: string
  scope?: string
  type?: string
  tag?: string
  service?: string
  limit?: number
  offset?: number
}

export interface KgSearchResponse {
  results: KgSearchResult[]
  total: number
  limit: number
  offset: number
  hasMore: boolean
  facets?: Record<string, Record<string, number>>
}

const MINI_SEARCH_OPTIONS = {
  fields: ["name", "summary", "tags", "type"],
  storeFields: ["name", "type", "service", "filePath", "startLine", "endLine", "summary", "tags", "layer"],
  tokenize: codeTokenize,
}

const SEARCH_BOOST = {
  name: 3,
  tags: 2.5,
  summary: 2,
  type: 0.5,
}

export class KgIndex {
  private miniSearch: MiniSearch
  private docs: KgDoc[]

  constructor(graph: KnowledgeGraph, serviceName: string) {
    this.docs = this.buildDocs(graph, serviceName)
    this.miniSearch = new MiniSearch(MINI_SEARCH_OPTIONS)
    if (this.docs.length > 0) {
      this.miniSearch.addAll(this.docs)
    }
  }

  private buildDocs(graph: KnowledgeGraph, serviceName: string): KgDoc[] {
    if (!Array.isArray(graph?.nodes)) return []
    return graph.nodes.map((node) => ({
      id: node.id,
      name: node.name,
      summary: node.summary ?? "",
      tags: (node.tags ?? []).join(" "),
      type: node.type,
      service: serviceName,
      filePath: node.filePath ?? "",
      startLine: node.lineRange?.[0] ?? 0,
      endLine: node.lineRange?.[1] ?? 0,
      layer: (node.tags ?? []).includes("business") ? "business"
        : (node.tags ?? []).includes("domain") ? "domain"
        : "kg",
    }))
  }

  isEmpty(): boolean { return this.docs.length === 0 }
  docCount(): number { return this.docs.length }

  search(opts: KgSearchOptions): KgSearchResponse {
    const limit = opts.limit ?? 20
    const offset = opts.offset ?? 0

    const filter = (doc: Record<string, unknown>): boolean => {
      if (opts.scope && opts.scope !== "all" && doc.layer !== opts.scope) return false
      if (opts.type && doc.type !== opts.type) return false
      if (opts.tag && !(doc.tags as string ?? "").includes(opts.tag)) return false
      if (opts.service && doc.service !== opts.service) return false
      return true
    }

    let miniResults: Array<{ id: string; score: number; [key: string]: unknown }>

    if (opts.q) {
      miniResults = this.miniSearch.search(opts.q, {
        filter,
        boost: SEARCH_BOOST,
        prefix: true,
        fuzzy: 0.2,
      })
    } else {
      miniResults = this.docs
        .filter((doc) => filter(doc as Record<string, unknown>))
        .map((doc) => ({ id: doc.id, score: 0, ...doc }))
    }

    const total = miniResults.length
    const paged = miniResults.slice(offset, offset + limit)

    const results: KgSearchResult[] = paged.map((r) => ({
      id: r.id,
      name: r.name as string,
      type: r.type as string,
      layer: r.layer as string,
      summary: r.summary as string,
      score: r.score,
      service: r.service as string | undefined,
      filePath: r.filePath as string | undefined,
      lineRange: r.startLine ? [r.startLine as number, r.endLine as number] : undefined,
      tags: r.tags as string | undefined,
    }))

    return {
      results,
      total,
      limit,
      offset,
      hasMore: offset + limit < total,
      facets: this.computeFacets(miniResults),
    }
  }

  private computeFacets(results: Array<Record<string, unknown>>): Record<string, Record<string, number>> {
    const facets: Record<string, Record<string, number>> = {}
    for (const r of results) {
      for (const key of ["type", "service", "layer"]) {
        const val = r[key] as string
        if (!val) continue
        facets[key] ??= {}
        facets[key][val] = (facets[key][val] ?? 0) + 1
      }
    }
    return facets
  }
}
