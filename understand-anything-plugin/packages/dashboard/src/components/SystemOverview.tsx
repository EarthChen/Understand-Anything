import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  useNodesState,
  useEdgesState,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
} from "@xyflow/react";
import type { Edge, Node } from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import type { SystemGraph, SystemGraphNode } from "@understand-anything/core";
import { useDashboardStore } from "../store";
import { useI18n } from "../contexts/I18nContext";
import { useTheme } from "../themes/index.ts";
import ServiceNode from "./ServiceNode";
import type { ServiceFlowNode } from "./ServiceNode";

const nodeTypes = {
  service: ServiceNode,
};

const EDGE_COLORS: Record<string, string> = {
  rpc_call: "#3b82f6",
  http_call: "#8b5cf6",
  event: "#22c55e",
  shared_db: "#f59e0b",
  contains: "#94a3b8",
};

function serviceKeyFromNodeId(nodeId: string): string {
  return nodeId.replace(/^microservice:/, "");
}

function SystemOverviewInner() {
  const systemGraph = useDashboardStore((s) => s.systemGraph);
  const setActiveService = useDashboardStore((s) => s.setActiveService);
  const { t } = useI18n();
  const { preset } = useTheme();
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  const { svcNodes, svcEdges, project, serviceIndex, facetNodes, facetContains, crossFacetEdges } = useMemo(() => {
    if (!systemGraph) {
      return {
        svcNodes: [] as SystemGraphNode[],
        svcEdges: [] as SystemGraph["edges"],
        project: null,
        serviceIndex: undefined as SystemGraph["serviceIndex"] | undefined,
        facetNodes: [] as SystemGraphNode[],
        facetContains: new Map<string, string[]>(),
        crossFacetEdges: [] as SystemGraph["edges"],
      };
    }
    const nodes = systemGraph.nodes.filter((n) => n.type === "microservice");
    const svcIds = new Set(nodes.map((n) => n.id));
    const edges = systemGraph.edges.filter(
      (e) => svcIds.has(e.source) && svcIds.has(e.target),
    );
    const facets = systemGraph.nodes.filter((n) => n.type === "facet");
    const contains = new Map<string, string[]>();
    const svcToFacet = new Map<string, string>();
    for (const e of systemGraph.edges) {
      if (e.type === "contains" && facets.some(f => f.id === e.source) && svcIds.has(e.target)) {
        if (!contains.has(e.source)) contains.set(e.source, []);
        contains.get(e.source)!.push(e.target);
        svcToFacet.set(e.target, e.source);
      }
    }
    // Cross-facet edges (different facet or no-facet)
    const crossEdges = edges.filter(e => {
      const sf = svcToFacet.get(e.source);
      const tf = svcToFacet.get(e.target);
      return sf !== tf;
    });
    return {
      svcNodes: nodes,
      svcEdges: edges,
      project: systemGraph.project,
      serviceIndex: systemGraph.serviceIndex,
      facetNodes: facets,
      facetContains: contains,
      crossFacetEdges: crossEdges,
    };
  }, [systemGraph]);

  const neighborIds = useMemo(() => {
    if (!selectedNodeId) return new Set<string>();
    const ids = new Set<string>();
    for (const edge of svcEdges) {
      if (edge.source === selectedNodeId) ids.add(edge.target);
      if (edge.target === selectedNodeId) ids.add(edge.source);
    }
    return ids;
  }, [selectedNodeId, svcEdges]);

  const computedNodes = useMemo((): Node[] => {
    const result: Node[] = [];

    if (facetNodes.length > 0) {
      // Layout by facet groups — group nodes must be added BEFORE children
      let groupX = 0;
      for (const facet of facetNodes) {
        const memberIds = facetContains.get(facet.id) ?? [];
        const members = svcNodes.filter(n => memberIds.includes(n.id));
        if (members.length === 0) continue;

        const cols = Math.min(members.length, 2);
        const rows = Math.ceil(members.length / 2);

        // Parent group node must come first
        result.push({
          id: facet.id,
          type: "group",
          position: { x: groupX, y: 0 },
          style: {
            width: cols * 280 + 40,
            height: rows * 180 + 80,
            backgroundColor: "rgba(100, 116, 139, 0.08)",
            borderRadius: "12px",
            border: "1px dashed rgba(148, 163, 184, 0.3)",
            padding: "10px",
          },
          data: { label: facet.name ?? facet.id },
        });

        // Child service nodes with positions relative to parent
        for (let i = 0; i < members.length; i++) {
          const node = members[i];
          const svcName = serviceKeyFromNodeId(node.id);
          const idx = serviceIndex?.[svcName];
          const isSelected = selectedNodeId === node.id;
          const hasSelection = !!selectedNodeId;
          const isNeighbor = neighborIds.has(node.id);
          const isFaded = hasSelection && !isSelected && !isNeighbor;

          result.push({
            id: node.id,
            type: "service",
            position: { x: 20 + (i % 2) * 280, y: 40 + Math.floor(i / 2) * 180 },
            parentId: facet.id,
            extent: "parent" as const,
            style: isFaded ? { opacity: 0.35 } : undefined,
            data: {
              label: node.name,
              summary: node.summary,
              languages: node.languages ?? [],
              frameworks: node.frameworks ?? [],
              stats: node.stats ?? { nodes: 0, edges: 0, files: 0 },
              hasKg: idx?.hasKg ?? false,
              hasWiki: idx?.hasWiki ?? false,
              hasDomain: idx?.hasDomain ?? false,
              isSelected,
              onNodeClick: () => {},
            },
          } as ServiceFlowNode);
        }

        groupX += cols * 280 + 120;
      }

      // Handle orphan services (not in any facet)
      const assignedIds = new Set([...facetContains.values()].flat());
      const orphans = svcNodes.filter(n => !assignedIds.has(n.id));
      for (let i = 0; i < orphans.length; i++) {
        const node = orphans[i];
        const svcName = serviceKeyFromNodeId(node.id);
        const idx = serviceIndex?.[svcName];
        const isSelected = selectedNodeId === node.id;
        const hasSelection = !!selectedNodeId;
        const isNeighbor = neighborIds.has(node.id);
        const isFaded = hasSelection && !isSelected && !isNeighbor;

        result.push({
          id: node.id,
          type: "service",
          position: { x: groupX + (i % 2) * 280, y: Math.floor(i / 2) * 180 },
          style: isFaded ? { opacity: 0.35 } : undefined,
          data: {
            label: node.name,
            summary: node.summary,
            languages: node.languages ?? [],
            frameworks: node.frameworks ?? [],
            stats: node.stats ?? { nodes: 0, edges: 0, files: 0 },
            hasKg: idx?.hasKg ?? false,
            hasWiki: idx?.hasWiki ?? false,
            hasDomain: idx?.hasDomain ?? false,
            isSelected,
            onNodeClick: () => {},
          },
        } as ServiceFlowNode);
      }
    } else {
      // Fallback flat layout
      for (let i = 0; i < svcNodes.length; i++) {
        const node = svcNodes[i];
        const svcName = serviceKeyFromNodeId(node.id);
        const idx = serviceIndex?.[svcName];
        const isSelected = selectedNodeId === node.id;
        const hasSelection = !!selectedNodeId;
        const isNeighbor = neighborIds.has(node.id);
        const isFaded = hasSelection && !isSelected && !isNeighbor;

        result.push({
          id: node.id,
          type: "service",
          position: { x: (i % 4) * 280, y: Math.floor(i / 4) * 180 },
          style: isFaded ? { opacity: 0.35 } : undefined,
          data: {
            label: node.name,
            summary: node.summary,
            languages: node.languages ?? [],
            frameworks: node.frameworks ?? [],
            stats: node.stats ?? { nodes: 0, edges: 0, files: 0 },
            hasKg: idx?.hasKg ?? false,
            hasWiki: idx?.hasWiki ?? false,
            hasDomain: idx?.hasDomain ?? false,
            isSelected,
            onNodeClick: () => {},
          },
        } as ServiceFlowNode);
      }
    }

    return result;
  }, [svcNodes, serviceIndex, selectedNodeId, neighborIds, facetNodes, facetContains]);

  const computedEdges = useMemo((): Edge[] => {
    return svcEdges.map((edge, i) => {
      const color = EDGE_COLORS[edge.type] ?? EDGE_COLORS.contains;
      const isConnected =
        !!selectedNodeId &&
        (edge.source === selectedNodeId || edge.target === selectedNodeId);

      return {
        id: `${edge.source}-${edge.target}-${i}`,
        source: edge.source,
        target: edge.target,
        style: {
          stroke: color,
          strokeWidth: isConnected ? 2.5 : 1.5,
          opacity: selectedNodeId ? (isConnected ? 1 : 0.15) : 0.8,
        },
        animated: edge.type === "event" && isConnected,
      };
    });
  }, [svcEdges, selectedNodeId]);

  const [nodes, setNodes, onNodesChange] = useNodesState(computedNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(computedEdges);

  useEffect(() => {
    setNodes(computedNodes);
    setEdges(computedEdges);
  }, [computedNodes, computedEdges, setNodes, setEdges]);

  const handleServiceNavigate = useCallback(
    (node: SystemGraphNode) => {
      setActiveService(serviceKeyFromNodeId(node.id));
    },
    [setActiveService],
  );

  const onNodeClick = useCallback((_event: React.MouseEvent, node: Node) => {
    setSelectedNodeId(node.id);
  }, []);

  const onNodeDoubleClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      setActiveService(serviceKeyFromNodeId(node.id));
    },
    [setActiveService],
  );

  const onPaneClick = useCallback(() => {
    setSelectedNodeId(null);
  }, []);

  if (!systemGraph) {
    return (
      <div className="flex items-center justify-center h-full text-text-muted">
        <p className="text-sm">{t.systemNoGraph}</p>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0">
      <div className="w-64 shrink-0 border-r border-border-subtle overflow-y-auto p-4 bg-surface">
        <h2 className="text-lg font-semibold text-text-primary mb-1">
          {project?.name ?? t.systemOverview}
        </h2>
        {project?.description && (
          <p className="text-xs text-text-secondary mb-3 leading-relaxed">
            {project.description}
          </p>
        )}
        <div className="grid grid-cols-2 gap-2 mb-4 text-xs">
          <div className="bg-elevated rounded-lg p-2 border border-border-subtle">
            <div className="font-mono text-accent text-lg">
              {project?.serviceCount ?? svcNodes.length}
            </div>
            <div className="text-text-muted uppercase tracking-wider">
              {t.systemServiceCount}
            </div>
          </div>
          <div className="bg-elevated rounded-lg p-2 border border-border-subtle">
            <div className="font-mono text-accent text-lg">
              {project?.totalNodes ?? 0}
            </div>
            <div className="text-text-muted uppercase tracking-wider">
              {t.systemTotalNodes}
            </div>
          </div>
        </div>

        <div className="mb-4">
          <div className="text-[10px] text-text-muted uppercase tracking-wider mb-2">
            Edge Types
          </div>
          <div className="space-y-1 text-xs">
            <div className="flex items-center gap-2">
              <span
                className="w-4 h-0.5 rounded"
                style={{ backgroundColor: EDGE_COLORS.rpc_call }}
              />
              <span className="text-text-secondary">RPC</span>
            </div>
            <div className="flex items-center gap-2">
              <span
                className="w-4 h-0.5 rounded"
                style={{ backgroundColor: EDGE_COLORS.http_call }}
              />
              <span className="text-text-secondary">HTTP</span>
            </div>
            <div className="flex items-center gap-2">
              <span
                className="w-4 h-0.5 rounded"
                style={{ backgroundColor: EDGE_COLORS.event }}
              />
              <span className="text-text-secondary">Event</span>
            </div>
            <div className="flex items-center gap-2">
              <span
                className="w-4 h-0.5 rounded"
                style={{ backgroundColor: EDGE_COLORS.shared_db }}
              />
              <span className="text-text-secondary">SharedDB</span>
            </div>
          </div>
        </div>

        {/* Facet-grouped service list */}
        {facetNodes.length > 0 ? (
          <div className="space-y-3 mb-4">
            {facetNodes.map((facet) => {
              const memberIds = facetContains.get(facet.id) ?? [];
              const members = svcNodes.filter(n => memberIds.includes(n.id));
              return (
                <div key={facet.id}>
                  <div className="text-[10px] text-text-muted uppercase tracking-wider mb-1.5 px-1">
                    {facet.name}
                  </div>
                  <ul className="space-y-1">
                    {members.map((node) => {
                      const svcName = serviceKeyFromNodeId(node.id);
                      const idx = serviceIndex?.[svcName];
                      const isSelected = selectedNodeId === node.id;
                      return (
                        <li key={node.id}>
                          <button
                            type="button"
                            className={`w-full text-left p-2 rounded-lg transition-colors ${
                              isSelected
                                ? "bg-elevated border border-gold/30"
                                : "hover:bg-elevated"
                            }`}
                            onClick={() => handleServiceNavigate(node)}
                          >
                            <div className="font-medium text-sm text-text-primary">
                              {node.name}
                            </div>
                            <div className="text-xs text-text-muted mt-0.5">
                              {node.languages?.join(", ")}
                              {idx?.hasKg && " · KG"}
                              {idx?.hasWiki && " · Wiki"}
                              {idx?.hasDomain && " · Domain"}
                            </div>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })}
          </div>
        ) : (
          <>
            <p className="text-[11px] text-text-muted mb-3">{t.systemDrillDown}</p>
            <ul className="space-y-2">
              {svcNodes.map((node) => {
                const svcName = serviceKeyFromNodeId(node.id);
                const idx = serviceIndex?.[svcName];
                const isSelected = selectedNodeId === node.id;
                return (
                  <li key={node.id}>
                    <button
                      type="button"
                      className={`w-full text-left p-2 rounded-lg transition-colors ${
                        isSelected
                          ? "bg-elevated border border-gold/30"
                          : "hover:bg-elevated"
                      }`}
                      onClick={() => handleServiceNavigate(node)}
                    >
                      <div className="font-medium text-sm text-text-primary">
                        {node.name}
                      </div>
                      <div className="text-xs text-text-muted mt-0.5">
                        {node.languages?.join(", ")}
                        {idx?.hasKg && " · KG"}
                        {idx?.hasWiki && " · Wiki"}
                        {idx?.hasDomain && " · Domain"}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
        )}

        {/* Cross-platform business flows summary */}
        {crossFacetEdges.length > 0 && (
          <div className="mt-4 pt-3 border-t border-border-subtle">
            <div className="text-[10px] text-text-muted uppercase tracking-wider mb-2">
              跨端通信
            </div>
            <div className="space-y-1.5 text-xs">
              {crossFacetEdges.map((edge, i) => {
                const fromName = svcNodes.find(n => n.id === edge.source)?.name ?? edge.source;
                const toName = svcNodes.find(n => n.id === edge.target)?.name ?? edge.target;
                return (
                  <div key={i} className="flex items-center gap-1.5 text-text-secondary">
                    <span className="font-medium text-text-primary">{fromName}</span>
                    <span className="text-accent">→</span>
                    <span className="font-medium text-text-primary">{toName}</span>
                    <span className="text-text-muted ml-auto">({edge.type.replace("_", " ")})</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <div className="flex-1 min-w-0 relative bg-canvas">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeClick={onNodeClick}
          onNodeDoubleClick={onNodeDoubleClick}
          onPaneClick={onPaneClick}
          nodeTypes={nodeTypes}
          nodesDraggable={false}
          nodesConnectable={false}
          fitView
          fitViewOptions={{ padding: 0.15 }}
          minZoom={0.1}
          maxZoom={2}
          proOptions={{ hideAttribution: true }}
          colorMode={preset.isDark ? "dark" : "light"}
        >
          <Background
            variant={BackgroundVariant.Dots}
            color="var(--color-edge-dot)"
            gap={20}
            size={1}
          />
          <Controls />
          <MiniMap
            nodeColor="var(--color-elevated)"
            maskColor="var(--glass-bg)"
            className="!bg-surface !border !border-border-subtle"
          />
        </ReactFlow>
      </div>
    </div>
  );
}

export default function SystemOverview() {
  return (
    <ReactFlowProvider>
      <SystemOverviewInner />
    </ReactFlowProvider>
  );
}
