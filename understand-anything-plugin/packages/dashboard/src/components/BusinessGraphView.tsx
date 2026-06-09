import { useEffect, useMemo, useCallback, useState } from "react"
import { ReactFlow, ReactFlowProvider, Background, Controls, type Node, type Edge } from "@xyflow/react"
import "@xyflow/react/dist/style.css"
import { useBusinessStore } from "../stores/businessStore"
import BusinessDomainNode from "./BusinessDomainNode"
import CrossFacetEdge from "./CrossFacetEdge"
import BusinessModeHeader from "./BusinessModeHeader"
import BusinessDomainPanel from "./BusinessDomainPanel"

const nodeTypes = { "business-domain": BusinessDomainNode }
const edgeTypes = { "cross-facet": CrossFacetEdge }

function slugFromId(id: string): string {
  return id.replace(/^domain:/, "")
}

interface UnmappedDomain {
  facet: string;
  domain: string;
  reason: string;
}

function BusinessEmptyState() {
  const [unmapped, setUnmapped] = useState<UnmappedDomain[]>([])
  const [stats, setStats] = useState<Record<string, number>>({})
  const links = useBusinessStore((s) => s.crossFacetLinks)

  useEffect(() => {
    fetch("/api/business/domains")
      .then(r => r.json())
      .then((data: { unmapped?: UnmappedDomain[]; stats?: Record<string, number> }) => {
        setUnmapped(data.unmapped ?? [])
        setStats(data.stats ?? {})
      })
      .catch(() => {})
  }, [])

  const byFacet = useMemo(() => {
    const map: Record<string, UnmappedDomain[]> = {}
    for (const d of unmapped) {
      const key = d.facet || "unknown"
      if (!map[key]) map[key] = []
      map[key].push(d)
    }
    return map
  }, [unmapped])

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-3xl mx-auto space-y-6">
        <div>
          <h2 className="text-lg font-semibold text-text-primary mb-2">业务域概览</h2>
          <div className="grid grid-cols-3 gap-3 text-sm">
            <div className="bg-elevated rounded-lg p-3 border border-border-subtle">
              <div className="font-mono text-accent text-xl">{stats.totalDomains ?? 0}</div>
              <div className="text-text-muted text-xs">总业务域</div>
            </div>
            <div className="bg-elevated rounded-lg p-3 border border-border-subtle">
              <div className="font-mono text-accent text-xl">{stats.mappedDomains ?? 0}</div>
              <div className="text-text-muted text-xs">已匹配</div>
            </div>
            <div className="bg-elevated rounded-lg p-3 border border-border-subtle">
              <div className="font-mono text-accent text-xl">{stats.unmappedDomains ?? 0}</div>
              <div className="text-text-muted text-xs">待匹配</div>
            </div>
          </div>
        </div>

        {links.length > 0 && (
          <div>
            <h3 className="text-sm font-semibold text-text-primary mb-2">跨端链路</h3>
            <div className="space-y-1.5">
              {links.map((link, i) => (
                <div key={i} className="flex items-center gap-2 text-xs bg-elevated rounded px-3 py-2 border border-border-subtle">
                  <span className="font-medium text-text-primary">{link.source}</span>
                  <span className="text-accent">→</span>
                  <span className="font-medium text-text-primary">{link.target}</span>
                  {link.label && <span className="text-text-muted ml-auto">{link.label}</span>}
                </div>
              ))}
            </div>
          </div>
        )}

        {Object.keys(byFacet).length > 0 && (
          <div>
            <h3 className="text-sm font-semibold text-text-primary mb-2">已发现业务域（按端分组）</h3>
            {Object.entries(byFacet).map(([facet, domains]) => (
              <div key={facet} className="mb-3">
                <div className="text-[10px] text-text-muted uppercase tracking-wider mb-1">{facet}</div>
                <div className="space-y-1">
                  {domains.map((d, i) => (
                    <div key={i} className="text-xs bg-surface rounded px-3 py-2 border border-border-subtle">
                      <div className="font-medium text-text-primary">{d.domain}</div>
                      <div className="text-text-muted mt-0.5">{d.reason}</div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        <p className="text-xs text-text-muted">
          业务域自动匹配覆盖率: {((stats.coverageRate ?? 0) * 100).toFixed(0)}%。
          未匹配的域表示客户端与服务端存在同名业务但尚未建立自动关联。
        </p>
      </div>
    </div>
  )
}

function BusinessGraphViewInner() {
  const domains = useBusinessStore((s) => s.domains)
  const links = useBusinessStore((s) => s.crossFacetLinks)
  const selectedDomainId = useBusinessStore((s) => s.selectedDomainId)
  const selectDomain = useBusinessStore((s) => s.selectDomain)
  const fetchCrossFacetLinks = useBusinessStore((s) => s.fetchCrossFacetLinks)
  const facetFilter = useBusinessStore((s) => s.facetFilter)
  const searchQuery = useBusinessStore((s) => s.searchQuery)

  useEffect(() => { void fetchCrossFacetLinks() }, [fetchCrossFacetLinks])

  const filteredDomains = useMemo(() => {
    let filtered = domains
    if (facetFilter) {
      filtered = filtered.filter((d) => Object.keys(d.facets).includes(facetFilter))
    }
    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      filtered = filtered.filter((d) =>
        d.name.toLowerCase().includes(q) || d.summary.toLowerCase().includes(q)
      )
    }
    return filtered
  }, [domains, facetFilter, searchQuery])

  // Show empty state when no mapped domains
  if (domains.length === 0) {
    return (
      <div className="flex h-full w-full" data-testid="business-graph-view">
        <div className="flex-1 flex flex-col min-w-0">
          <BusinessModeHeader />
          <BusinessEmptyState />
        </div>
      </div>
    )
  }

  const { nodes, edges } = useMemo(() => {
    const COLS = 3
    const COL_WIDTH = 350
    const ROW_HEIGHT = 200

    const rfNodes: Node[] = filteredDomains.map((d, i) => ({
      id: d.id,
      type: "business-domain",
      position: { x: (i % COLS) * COL_WIDTH, y: Math.floor(i / COLS) * ROW_HEIGHT },
      data: {
        label: d.name,
        summary: d.summary,
        facets: Object.keys(d.facets),
        domainId: d.id,
      },
    }))

    const domainIdSet = new Set(filteredDomains.map((d) => d.id))
    const rfEdges: Edge[] = links
      .filter((l) => domainIdSet.has(l.source) || domainIdSet.has(`domain:${l.source}`))
      .map((l, i) => ({
        id: `cfe-${i}`,
        source: l.source.startsWith("domain:") ? l.source : `domain:${l.source}`,
        target: l.target.startsWith("domain:") ? l.target : `domain:${l.target}`,
        type: "cross-facet",
        data: { apiPath: l.label, method: "HTTP" },
      }))
      .filter((e) => domainIdSet.has(e.source) && domainIdSet.has(e.target))

    return { nodes: rfNodes, edges: rfEdges }
  }, [filteredDomains, links])

  const onNodeClick = useCallback((_e: React.MouseEvent, node: Node) => {
    void selectDomain(slugFromId(node.id))
  }, [selectDomain])

  return (
    <div className="flex h-full w-full" data-testid="business-graph-view">
      <div className="flex-1 flex flex-col min-w-0">
        <BusinessModeHeader />
        <div className="flex-1">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onNodeClick={onNodeClick}
            fitView
            proOptions={{ hideAttribution: true }}
          >
            <Background />
            <Controls />
          </ReactFlow>
        </div>
      </div>
      {selectedDomainId && <BusinessDomainPanel domainId={selectedDomainId} />}
    </div>
  )
}

export default function BusinessGraphView() {
  return (
    <ReactFlowProvider>
      <BusinessGraphViewInner />
    </ReactFlowProvider>
  )
}
