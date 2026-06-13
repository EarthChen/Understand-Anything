import type { EdgeType } from "../types.js";

// --- Type definitions ---

export interface EdgeMapping {
  edge: EdgeType;
  weight: number;
  role?: "source" | "target";
  extractPath?: string;
}

export interface FrameworkRule {
  id: string;
  displayName: string;
  detectionKeywords: string[];
  annotations: Record<string, EdgeMapping>;
  metaAnnotations?: Record<string, string[]>;
}

export interface RuleConfig {
  version: number;
  rules: {
    annotations: Record<string, EdgeMapping>;
    metaAnnotations?: Record<string, string[]>;
  };
}

// --- Known EdgeType set (for validation) ---
const KNOWN_EDGE_TYPES = new Set<string>([
  "imports", "exports", "contains", "inherits", "implements",
  "calls", "subscribes", "publishes", "middleware",
  "provides_rpc", "consumes_rpc",
  "provides_route", "consumes_route",
  "consumes_api", "injects",
  "reads_from", "writes_to", "transforms", "validates",
  "depends_on", "tested_by", "configures",
  "related", "similar_to",
  "deploys", "serves", "provisions", "triggers",
  "migrates", "documents", "routes", "defines_schema",
  "contains_flow", "flow_step", "cross_domain",
  "cites", "contradicts", "builds_on", "exemplifies", "categorized_under", "authored_by",
]);

// --- Built-in framework rules ---
export const BUILTIN_RULES: FrameworkRule[] = [
  {
    id: "spring",
    displayName: "Spring Framework",
    detectionKeywords: ["spring-boot-starter", "spring-context", "springframework"],
    annotations: {
      "Autowired": { edge: "injects", weight: 0.9, role: "target" },
      "Resource": { edge: "injects", weight: 0.9, role: "target" },
      "Inject": { edge: "injects", weight: 0.9, role: "target" },
      "Component": { edge: "related", weight: 0.5 },
      "Service": { edge: "related", weight: 0.5 },
      "Repository": { edge: "related", weight: 0.5 },
      "Controller": { edge: "provides_route", weight: 0.8 },
      "RestController": { edge: "provides_route", weight: 0.8 },
    },
    metaAnnotations: {
      "Service": ["Component"],
      "Repository": ["Component"],
      "Controller": ["Component"],
      "RestController": ["Controller", "Component"],
    },
  },
  {
    id: "dubbo",
    displayName: "Apache Dubbo",
    detectionKeywords: ["dubbo-spring-boot-starter", "org.apache.dubbo"],
    annotations: {
      "DubboService": { edge: "provides_rpc", weight: 0.9 },
      "DubboReference": { edge: "consumes_rpc", weight: 0.9 },
    },
  },
  {
    id: "moa",
    displayName: "MOA RPC",
    detectionKeywords: ["moa-spring-boot-starter"],
    annotations: {
      "MoaProvider": { edge: "provides_rpc", weight: 0.9, extractPath: "uri" },
      "MoaConsumer": { edge: "consumes_rpc", weight: 0.9, extractPath: "serviceUri" },
    },
  },
  {
    id: "feign",
    displayName: "OpenFeign",
    detectionKeywords: ["spring-cloud-starter-openfeign", "feign-core"],
    annotations: {
      "FeignClient": { edge: "consumes_rpc", weight: 0.9, extractPath: "name" },
    },
  },
  {
    id: "grpc",
    displayName: "gRPC",
    detectionKeywords: ["grpc-spring-boot-starter", "io.grpc"],
    annotations: {
      "GrpcService": { edge: "provides_rpc", weight: 0.9 },
      "GrpcClient": { edge: "consumes_rpc", weight: 0.9 },
    },
  },
  {
    id: "kafka",
    displayName: "Apache Kafka",
    detectionKeywords: ["spring-kafka", "kafka-clients"],
    annotations: {
      "KafkaListener": { edge: "subscribes", weight: 0.9 },
      "KafkaTemplate": { edge: "publishes", weight: 0.9 },
    },
  },
  {
    id: "retrofit",
    displayName: "Retrofit",
    detectionKeywords: ["retrofit", "com.squareup.retrofit2"],
    annotations: {
      "GET": { edge: "consumes_api", weight: 0.8 },
      "POST": { edge: "consumes_api", weight: 0.8 },
      "PUT": { edge: "consumes_api", weight: 0.8 },
      "DELETE": { edge: "consumes_api", weight: 0.8 },
    },
  },
  {
    id: "react",
    displayName: "React",
    detectionKeywords: ["react", "react-dom"],
    annotations: {},
  },
  {
    id: "nestjs",
    displayName: "NestJS",
    detectionKeywords: ["@nestjs/core", "@nestjs/common"],
    annotations: {
      "Injectable": { edge: "injects", weight: 0.9 },
      "Controller": { edge: "provides_route", weight: 0.8 },
    },
  },
];

// --- Annotation-to-edge mapping ---

export interface ExtractionResult {
  path: string;
  classes: Array<{
    name: string;
    lineRange: [number, number];
    methods: string[];
    properties: string[];
    annotations?: Array<{ name: string; arguments?: Record<string, string> }>;
    superclass?: string;
    interfaces?: string[];
    typedProperties?: Array<{
      name: string;
      type?: string;
      annotations?: Array<{ name: string; arguments?: Record<string, string> }>;
    }>;
  }>;
  functions: Array<{ name: string; lineRange: [number, number] }>;
  imports: Array<{ source: string; specifiers: string[] }>;
  exports: Array<{ name: string }>;
}

export interface AnnotationEdge {
  source: string;
  target: string;
  type: string;
  weight: number;
  direction: string;
  description: string;
  ruleEngineSource: true;
  properties?: Record<string, unknown>;
}

export interface UnresolvedAnnotation {
  file: string;
  className: string;
  annotation: string;
  level: "class" | "property" | "method";
}

export function mapAnnotationsToEdges(
  extractionResults: ExtractionResult[],
  options: { frameworks: string[]; userRules?: RuleConfig },
): { edges: AnnotationEdge[]; unresolved: UnresolvedAnnotation[] } {
  // Get applicable rules based on detected frameworks
  const activeRules = BUILTIN_RULES.filter((r) => options.frameworks.includes(r.id));

  // Build annotation→EdgeMapping lookup from active rules + user rules
  const annotationMap = new Map<string, EdgeMapping>();
  for (const rule of activeRules) {
    for (const [ann, mapping] of Object.entries(rule.annotations)) {
      annotationMap.set(ann, mapping);
    }
  }
  if (options.userRules?.rules.annotations) {
    for (const [ann, mapping] of Object.entries(options.userRules.rules.annotations)) {
      annotationMap.set(ann, mapping);
    }
  }

  const edges: AnnotationEdge[] = [];
  const unresolved: UnresolvedAnnotation[] = [];

  for (const file of extractionResults) {
    for (const cls of file.classes) {
      const classNodeId = `class:${file.path}:${cls.name}`;

      // Class-level annotations
      for (const ann of cls.annotations ?? []) {
        const mapping = annotationMap.get(ann.name);
        if (!mapping) {
          unresolved.push({ file: file.path, className: cls.name, annotation: ann.name, level: "class" });
          continue;
        }

        // For RPC providers: target from interfaces[]
        if (mapping.edge === "provides_rpc" && cls.interfaces?.length) {
          for (const iface of cls.interfaces) {
            edges.push(makeEdge(classNodeId, `endpoint:${iface}`, mapping, ann));
          }
        } else if (mapping.edge === "provides_route" && ann.arguments) {
          // Route providers: target from annotation path argument
          const path = ann.arguments.path || ann.arguments.value;
          if (path) {
            edges.push(makeEdge(classNodeId, `route:${path}`, mapping, ann));
          }
        } else {
          edges.push(makeEdge(classNodeId, `domain:${mapping.edge}`, mapping, ann));
        }
      }

      // Property-level annotations (DI, RPC consumers)
      for (const prop of cls.typedProperties ?? []) {
        for (const ann of prop.annotations ?? []) {
          const mapping = annotationMap.get(ann.name);
          if (!mapping) {
            unresolved.push({ file: file.path, className: cls.name, annotation: ann.name, level: "property" });
            continue;
          }

          // For injects: target from property type
          if (mapping.edge === "injects" && prop.type) {
            edges.push(makeEdge(classNodeId, `class:${prop.type}`, mapping, ann));
          }
          // For consumes_rpc: target from property type (interface FQN)
          else if (mapping.edge === "consumes_rpc" && prop.type) {
            edges.push(makeEdge(classNodeId, `endpoint:${prop.type}`, mapping, ann));
          }
          else {
            edges.push(makeEdge(classNodeId, `domain:${mapping.edge}`, mapping, ann));
          }
        }
      }
    }
  }

  return { edges, unresolved };
}

function makeEdge(
  source: string,
  target: string,
  mapping: EdgeMapping,
  ann: { name: string; arguments?: Record<string, string> },
): AnnotationEdge {
  return {
    source,
    target,
    type: mapping.edge,
    weight: mapping.weight,
    direction: mapping.role === "target" ? "reverse" : "forward",
    description: JSON.stringify({ annotation: ann.name, arguments: ann.arguments }),
    ruleEngineSource: true,
  };
}

// --- Validation ---

export function validateRuleConfig(config: unknown): asserts config is RuleConfig {
  if (typeof config !== "object" || config === null) {
    throw new Error("Config must be an object");
  }
  const c = config as Record<string, unknown>;
  if (typeof c.version !== "number" || c.version < 1) {
    throw new Error("Config must have a 'version' field (number >= 1)");
  }
  if (typeof c.rules !== "object" || c.rules === null) {
    throw new Error("Config must have a 'rules' field");
  }
  const rules = c.rules as Record<string, unknown>;
  if (typeof rules.annotations !== "object" || rules.annotations === null) {
    throw new Error("Config.rules must have an 'annotations' field");
  }
  for (const [name, mapping] of Object.entries(rules.annotations as Record<string, unknown>)) {
    if (typeof mapping !== "object" || mapping === null) {
      throw new Error(`Annotation '${name}' must be an object`);
    }
    const m = mapping as Record<string, unknown>;
    if (typeof m.edge !== "string" || !KNOWN_EDGE_TYPES.has(m.edge)) {
      throw new Error(`Annotation '${name}' has invalid EdgeType: '${m.edge}'`);
    }
    if (m.weight !== undefined && (typeof m.weight !== "number" || m.weight < 0 || m.weight > 1)) {
      throw new Error(`Annotation '${name}' weight must be in [0, 1]`);
    }
  }
}

// --- Framework detection ---

export function detectFrameworks(dependencies: string[]): string[] {
  const depSet = new Set(dependencies);
  const detected: string[] = [];
  for (const rule of BUILTIN_RULES) {
    if (rule.detectionKeywords.some((kw) => depSet.has(kw))) {
      detected.push(rule.id);
    }
  }
  return detected;
}
