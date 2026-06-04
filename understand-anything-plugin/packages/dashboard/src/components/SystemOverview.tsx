import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCenter,
  forceCollide,
  type SimulationNodeDatum,
  type SimulationLinkDatum,
} from "d3-force";
import type { SystemGraph, SystemGraphNode } from "@understand-anything/core";
import { useDashboardStore } from "../store";
import { useI18n } from "../contexts/I18nContext";

interface SystemNode extends SimulationNodeDatum, SystemGraphNode {}

interface SystemLink extends SimulationLinkDatum<SystemNode> {
  type: SystemGraph["edges"][number]["type"];
  detail?: SystemGraph["edges"][number]["detail"];
}

const EDGE_COLORS: Record<string, string> = {
  rpc_call: "#3b82f6",
  event: "#22c55e",
  shared_db: "#f59e0b",
  contains: "#94a3b8",
};

const NODE_RADIUS = 30;

function serviceKeyFromNodeId(nodeId: string): string {
  return nodeId.replace(/^microservice:/, "");
}

export default function SystemOverview() {
  const systemGraph = useDashboardStore((s) => s.systemGraph);
  const setActiveService = useDashboardStore((s) => s.setActiveService);
  const { t } = useI18n();
  const svgRef = useRef<SVGSVGElement>(null);
  const [layoutNodes, setLayoutNodes] = useState<SystemNode[]>([]);
  const [layoutLinks, setLayoutLinks] = useState<SystemLink[]>([]);

  const { nodes, edges, project, serviceIndex } = useMemo(() => {
    if (!systemGraph) {
      return {
        nodes: [] as SystemNode[],
        edges: [] as SystemLink[],
        project: null,
        serviceIndex: undefined as SystemGraph["serviceIndex"] | undefined,
      };
    }
    const svcNodes: SystemNode[] = systemGraph.nodes
      .filter((n) => n.type === "microservice")
      .map((n) => ({ ...n }));
    const svcIds = new Set(svcNodes.map((n) => n.id));
    const svcEdges: SystemLink[] = systemGraph.edges
      .filter((e) => svcIds.has(e.source) && svcIds.has(e.target))
      .map((e) => ({ ...e, source: e.source, target: e.target }));
    return {
      nodes: svcNodes,
      edges: svcEdges,
      project: systemGraph.project,
      serviceIndex: systemGraph.serviceIndex,
    };
  }, [systemGraph]);

  useEffect(() => {
    if (!svgRef.current || nodes.length === 0) {
      setLayoutNodes([]);
      setLayoutLinks([]);
      return;
    }

    const svg = svgRef.current;
    const width = svg.clientWidth || 800;
    const height = svg.clientHeight || 600;

    const simNodes: SystemNode[] = nodes.map((n, i) => ({
      ...n,
      x: width / 2 + (i - nodes.length / 2) * 40,
      y: height / 2,
    }));
    const simLinks: SystemLink[] = edges.map((e) => ({ ...e }));

    const sim = forceSimulation<SystemNode>(simNodes)
      .force(
        "link",
        forceLink<SystemNode, SystemLink>(simLinks)
          .id((d) => d.id)
          .distance(200)
          .strength(0.3),
      )
      .force("charge", forceManyBody().strength(-500))
      .force("center", forceCenter(width / 2, height / 2))
      .force("collide", forceCollide(NODE_RADIUS + 8));

    sim.on("tick", () => {
      setLayoutNodes([...simNodes]);
      setLayoutLinks([...simLinks]);
    });

    return () => {
      sim.stop();
    };
  }, [nodes, edges]);

  const handleNodeClick = useCallback(
    (node: SystemNode) => {
      const serviceName = node.id.replace("microservice:", "");
      setActiveService(serviceName);
    },
    [setActiveService],
  );

  if (!systemGraph) {
    return (
      <div className="flex items-center justify-center h-full text-text-muted">
        <p className="text-sm">{t.systemNoGraph}</p>
      </div>
    );
  }

  const displayNodes = layoutNodes.length > 0 ? layoutNodes : nodes;
  const displayLinks = layoutLinks.length > 0 ? layoutLinks : edges;

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
              {project?.serviceCount ?? nodes.length}
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
        <p className="text-[11px] text-text-muted mb-3">{t.systemDrillDown}</p>
        <ul className="space-y-2">
          {nodes.map((node) => {
            const svcName = serviceKeyFromNodeId(node.id);
            const idx = serviceIndex?.[svcName];
            return (
              <li key={node.id}>
                <button
                  type="button"
                  className="w-full text-left p-2 rounded-lg hover:bg-elevated transition-colors"
                  onClick={() => handleNodeClick(node)}
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

      <div className="flex-1 min-w-0 relative bg-canvas">
        <svg ref={svgRef} className="w-full h-full" role="img" aria-label={t.systemOverview}>
          <defs>
            <marker
              id="sys-arrow"
              viewBox="0 0 10 10"
              refX={NODE_RADIUS + 6}
              refY={5}
              markerWidth={6}
              markerHeight={6}
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill="#94a3b8" />
            </marker>
          </defs>
          {displayLinks.map((edge, i) => {
            const src = edge.source as SystemNode;
            const tgt = edge.target as SystemNode;
            const x1 = src.x ?? 0;
            const y1 = src.y ?? 0;
            const x2 = tgt.x ?? 0;
            const y2 = tgt.y ?? 0;
            return (
              <line
                key={`${String(src.id)}-${String(tgt.id)}-${i}`}
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                stroke={EDGE_COLORS[edge.type] ?? EDGE_COLORS.contains}
                strokeWidth={2}
                markerEnd="url(#sys-arrow)"
              />
            );
          })}
          {displayNodes.map((node) => (
            <g
              key={node.id}
              className="cursor-pointer"
              transform={`translate(${node.x ?? 0},${node.y ?? 0})`}
              onClick={() => handleNodeClick(node)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  handleNodeClick(node);
                }
              }}
              role="button"
              tabIndex={0}
              aria-label={node.name}
            >
              <circle r={NODE_RADIUS} fill="#3b82f6" opacity={0.85} />
              <text
                textAnchor="middle"
                dy={4}
                fill="white"
                fontSize={10}
                fontWeight="bold"
                pointerEvents="none"
              >
                {node.name.length > 12 ? `${node.name.slice(0, 12)}…` : node.name}
              </text>
              <text
                textAnchor="middle"
                dy={NODE_RADIUS + 16}
                fill="var(--color-text-muted, #6b7280)"
                fontSize={9}
                pointerEvents="none"
              >
                {node.stats?.nodes ?? 0} nodes
              </text>
            </g>
          ))}
        </svg>
      </div>
    </div>
  );
}
