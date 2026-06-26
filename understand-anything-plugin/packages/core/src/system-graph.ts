// System Graph types — for multi-service topology visualization

export type SystemGraphFacetType = "server" | "mobile" | "frontend" | "knowledge";

export interface SystemGraphProject {
  name: string;
  description?: string;
  serviceCount: number;
  totalNodes: number;
  totalEdges: number;
}

export interface SystemGraphServiceStats {
  nodes: number;
  edges: number;
  files: number;
}

export interface SystemGraphNode {
  id: string;
  type: "microservice" | "endpoint" | "facet";
  name: string;
  summary: string;
  // Facet-specific fields
  facetType?: SystemGraphFacetType;
  // Microservice-specific fields
  languages?: string[];
  frameworks?: string[];
  stats?: SystemGraphServiceStats;
  kgPath?: string;
  wikiPath?: string;
  domainPath?: string;
  // Endpoint-specific fields
  service?: string;
  method?: string;
  path?: string;
}

export interface SystemGraphEdgeDetail {
  interface?: string;
  method?: string;
  rpcType?: string;
  evidence?: "kg-matched" | "wiki-enriched";
}

export interface SystemGraphEdge {
  source: string;
  target: string;
  type: "rpc_call" | "http_call" | "event" | "shared_db" | "contains";
  weight: number;
  detail?: SystemGraphEdgeDetail;
}

export interface SystemGraphServiceIndex {
  hasKg: boolean;
  hasWiki: boolean;
  hasDomain: boolean;
  kgCommit?: string;
  wikiCommit?: string;
  /** Relative path from project root to this service directory (for nested facet layouts). */
  basePath?: string;
  /** Which facet this service belongs to. */
  facet?: SystemGraphFacetType;
  /** Knowledge graph profile, for non-code facets such as PRD wikis. */
  profile?: "generic" | "prd-wiki" | string;
}

export interface SystemGraph {
  version: string;
  generatedAt: string;
  project: SystemGraphProject;
  nodes: SystemGraphNode[];
  edges: SystemGraphEdge[];
  serviceIndex: Record<string, SystemGraphServiceIndex>;
}

export interface SystemGraphValidationResult {
  valid: boolean;
  data: SystemGraph | null;
  issues: string[];
}

export function validateSystemGraph(data: unknown): SystemGraphValidationResult {
  const issues: string[] = [];

  if (!data || typeof data !== "object") {
    return { valid: false, data: null, issues: ["Input is not an object"] };
  }

  const obj = data as Record<string, unknown>;

  // Check required top-level fields
  if (!obj.version || typeof obj.version !== "string") {
    issues.push("Missing or invalid 'version' field");
  }

  if (!obj.project || typeof obj.project !== "object") {
    issues.push("Missing or invalid 'project' field");
  } else {
    const proj = obj.project as Record<string, unknown>;
    if (typeof proj.serviceCount !== "number") {
      issues.push("project.serviceCount must be a number");
    }
  }

  if (!Array.isArray(obj.nodes)) {
    issues.push("'nodes' must be an array");
  } else {
    const nodeIds = new Set<string>();
    for (const [i, node] of (obj.nodes as unknown[]).entries()) {
      const n = node as Record<string, unknown>;
      if (!n.id) issues.push(`nodes[${i}] missing 'id'`);
      if (!n.type) issues.push(`nodes[${i}] missing 'type'`);
      if (!n.name) issues.push(`nodes[${i}] missing 'name'`);
      if (n.id) {
        if (nodeIds.has(n.id as string)) issues.push(`Duplicate node id '${n.id}'`);
        nodeIds.add(n.id as string);
      }
    }

    // Check edges reference valid nodes
    if (Array.isArray(obj.edges)) {
      for (const [i, edge] of (obj.edges as unknown[]).entries()) {
        const e = edge as Record<string, unknown>;
        if (!nodeIds.has(e.source as string)) {
          issues.push(`edges[${i}] source '${e.source}' not found`);
        }
        if (!nodeIds.has(e.target as string)) {
          issues.push(`edges[${i}] target '${e.target}' not found`);
        }
      }
    }
  }

  if (!Array.isArray(obj.edges)) {
    issues.push("'edges' must be an array");
  }

  if (issues.length > 0) {
    return { valid: false, data: null, issues };
  }

  return { valid: true, data: data as SystemGraph, issues: [] };
}
