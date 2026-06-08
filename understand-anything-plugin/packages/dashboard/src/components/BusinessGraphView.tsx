import { useEffect, useMemo, useCallback } from "react"
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
