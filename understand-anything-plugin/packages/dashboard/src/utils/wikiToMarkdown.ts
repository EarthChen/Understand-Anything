import type { WikiDomainPage, WikiFlow, WikiFlowStep, WikiServiceOverview, CrossServiceCall, WikiOverview, WikiArchitecture, WikiCrossDomain, WikiEntity, WikiGlossaryEntry, WikiBusinessRule, WikiIntegrationPoints, ServiceEndpointDoc } from "@understand-anything/core";
import type { Locale } from "../locales";
import { en } from "../locales/en";

type WikiLabels = Locale["wiki"];

const defaultLabels: WikiLabels = en.wiki;

export function serviceOverviewToMarkdown(overview: WikiServiceOverview, labels: WikiLabels = defaultLabels): string {
  const lines: string[] = [];

  lines.push(`# ${overview?.name ?? "Service"}`);
  lines.push("");
  lines.push(overview?.description ?? "");
  lines.push("");

  const techStack = Array.isArray(overview?.techStack) ? overview.techStack : [];
  if (techStack.length > 0) {
    lines.push(`## ${labels.techStack}`);
    lines.push("");
    for (const tech of techStack) {
      lines.push(`- ${tech}`);
    }
    lines.push("");
  }

  const modules = Array.isArray(overview?.modules) ? overview.modules : [];
  if (modules.length > 0) {
    lines.push(`## ${labels.modules}`);
    lines.push("");
    for (const mod of modules) {
      lines.push(`- ${mod}`);
    }
    lines.push("");
  }

  const entryPoints = Array.isArray(overview?.entryPoints) ? overview.entryPoints : [];
  if (entryPoints.length > 0) {
    lines.push(`## ${labels.entryPoints}`);
    lines.push("");
    for (const ep of entryPoints) {
      lines.push(`- \`${ep}\``);
    }
    lines.push("");
  }

  return lines.join("\n");
}

function flowStepToMarkdown(step: WikiFlowStep): string {
  let line = `${step.order}. **${step.name}** — ${step.description}`;
  if (step.sourceRef) {
    const hash = step.sourceRef.lineRange
      ? `#L${step.sourceRef.lineRange[0]}-L${step.sourceRef.lineRange[1]}`
      : "";
    const label = step.sourceRef.lineRange
      ? `${step.sourceRef.file}:${step.sourceRef.lineRange[0]}-${step.sourceRef.lineRange[1]}`
      : step.sourceRef.file;
    line += `\n   📎 [${label}](source://${step.sourceRef.file}${hash})`;
  }
  return line;
}

function sanitizeMermaidLabel(text: string): string {
  return text.replace(/["\[\](){}|<>#&]/g, " ").trim();
}

function sanitizeSequenceLabel(text: string): string {
  return text.replace(/[;\n\r]/g, " ").replace(/-->/g, "→").replace(/->>|->>/g, "→").trim();
}

function truncateText(text: string, maxLen: number): string {
  if (!text || text.length <= maxLen) return text || "";
  const delimiters = /[，。；,;！!？?]/;
  const firstBreak = text.search(delimiters);
  if (firstBreak > 0 && firstBreak <= maxLen) return text.slice(0, firstBreak);
  return text.slice(0, maxLen) + "…";
}

function flowToMermaidDiagram(flow: WikiFlow, labels: WikiLabels = defaultLabels): string {
  const steps = Array.isArray(flow.steps) ? flow.steps : [];
  if (steps.length === 0) return "";

  const lines: string[] = ["```mermaid", "flowchart TD"];
  lines.push(`    Start(["${sanitizeMermaidLabel(labels.diagramStart ?? "Start")}"])`);
  for (let i = 0; i < steps.length; i++) {
    const nodeId = `S${i}`;
    const name = sanitizeMermaidLabel(steps[i].name || `Step ${i + 1}`);
    const desc = truncateText(steps[i].description || "", 35);
    const descLine = desc ? `<br/><small>${sanitizeMermaidLabel(desc)}</small>` : "";
    if (steps[i].sourceRef) {
      lines.push(`    ${nodeId}(["${i + 1}. ${name}${descLine}"])`);
    } else {
      lines.push(`    ${nodeId}["${i + 1}. ${name}${descLine}"]`);
    }
  }
  lines.push(`    End_(["${sanitizeMermaidLabel(labels.diagramEnd ?? "End")}"])`);
  lines.push(`    Start --> S0`);
  for (let i = 0; i < steps.length - 1; i++) {
    lines.push(`    S${i} --> S${i + 1}`);
  }
  lines.push(`    S${steps.length - 1} --> End_`);
  lines.push("```");
  return lines.join("\n");
}

function crossDomainToSequenceDiagram(services: string[], steps: Array<{ order: number; service: string; description: string; crossServiceCall?: { interface?: string; method: string; type: string } }>): string {
  if (steps.length === 0) return "";

  const allServices = services.length > 0 ? [...services] : [...new Set(steps.map(s => s.service))];
  if (allServices.length === 0) return "";

  const lines: string[] = ["```mermaid", "sequenceDiagram"];
  for (const svc of allServices) {
    const pid = svc.replace(/[^a-zA-Z0-9_]/g, "_");
    lines.push(`    participant ${pid} as ${sanitizeSequenceLabel(svc)}`);
  }
  lines.push("");

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const fromSvc = step.service.replace(/[^a-zA-Z0-9_]/g, "_");
    const nextSvc = (i + 1 < steps.length) ? steps[i + 1].service.replace(/[^a-zA-Z0-9_]/g, "_") : fromSvc;
    const desc = sanitizeSequenceLabel(truncateText(step.description, 60));
    const label = `${step.order}. ${desc}`;

    if (step.crossServiceCall) {
      const typeTag = step.crossServiceCall.type || "rpc";
      lines.push(`    ${fromSvc}->>+${nextSvc}: ${label} [${typeTag}]`);
    } else if (fromSvc === nextSvc || i === steps.length - 1) {
      lines.push(`    ${fromSvc}->>+${fromSvc}: ${label}`);
    } else {
      lines.push(`    ${fromSvc}->>+${nextSvc}: ${label}`);
    }
  }

  lines.push("```");
  return lines.join("\n");
}

function architectureToMermaidDiagram(data: WikiArchitecture): string {
  const calls = Array.isArray(data?.crossServiceCalls) ? data.crossServiceCalls : [];
  const events = Array.isArray(data?.eventFlows) ? data.eventFlows : [];
  const resources = Array.isArray(data?.sharedResources) ? data.sharedResources : [];
  const facets = Array.isArray(data?.facets) ? data.facets : [];
  if (calls.length === 0 && events.length === 0 && resources.length === 0) return "";

  const svcId = (s: string) => `svc_${s.replace(/[^a-zA-Z0-9]/g, "_")}`;
  const serviceSet = new Set<string>();
  const edgeMap = new Map<string, Set<string>>();

  // Build service → facet lookup for cross-facet filtering
  const svcToFacet = new Map<string, string>();
  for (const f of facets) {
    for (const svc of f.services) svcToFacet.set(svc, f.name);
  }

  for (const c of calls) {
    const from = c.caller?.service;
    const to = c.callee?.service;
    if (!from || !to || from === to) continue;
    // If facets exist, only show cross-facet edges at top level
    if (facets.length > 0 && svcToFacet.get(from) === svcToFacet.get(to)) continue;
    serviceSet.add(from);
    serviceSet.add(to);
    const key = `${from}|||${to}`;
    if (!edgeMap.has(key)) edgeMap.set(key, new Set());
    edgeMap.get(key)!.add(c.type || "rpc");
  }

  const lines: string[] = ["```mermaid", "flowchart LR"];

  if (facets.length > 0) {
    // Render services grouped by facet subgraphs
    for (const f of facets) {
      lines.push(`    subgraph ${f.name}["${sanitizeMermaidLabel(f.label)}"]`);
      for (const svc of f.services) {
        lines.push(`        ${svcId(svc)}["${sanitizeMermaidLabel(svc)}"]`);
        serviceSet.add(svc);
      }
      lines.push("    end");
    }
    // Any services not in a facet
    for (const svc of serviceSet) {
      if (!svcToFacet.has(svc)) {
        lines.push(`    ${svcId(svc)}["${sanitizeMermaidLabel(svc)}"]`);
      }
    }
  } else {
    for (const svc of serviceSet) {
      lines.push(`    ${svcId(svc)}["${sanitizeMermaidLabel(svc)}"]`);
    }
  }

  for (const [key, types] of edgeMap) {
    const [from, to] = key.split("|||");
    const label = [...types].join("/");
    lines.push(`    ${svcId(from)} -->|"${sanitizeMermaidLabel(label)}"| ${svcId(to)}`);
  }

  const resTypeShape: Record<string, [string, string]> = {
    database: ["[(", ")]"],
    cache: ["{{", "}}"],
    queue: [">", "]"],
    storage: ["([", "])"],
  };

  for (const res of resources) {
    if (!res.name) continue;
    const rid = `res_${res.name.replace(/[^a-zA-Z0-9]/g, "_")}`;
    const shape = resTypeShape[res.type || ""] || ["[", "]"];
    lines.push(`    ${rid}${shape[0]}"${sanitizeMermaidLabel(res.name)}"${shape[1]}`);
    for (const svc of (res.services || [])) {
      serviceSet.add(svc);
      if (!lines.some(l => l.includes(`${svcId(svc)}[`))) {
        lines.push(`    ${svcId(svc)}["${sanitizeMermaidLabel(svc)}"]`);
      }
      lines.push(`    ${svcId(svc)} -.- ${rid}`);
    }
  }

  for (const ev of events) {
    if (!ev.topic) continue;
    const tid = `topic_${ev.topic.replace(/[^a-zA-Z0-9]/g, "_")}`;
    lines.push(`    ${tid}{{"${sanitizeMermaidLabel(ev.topic)}"}}`);
    if (ev.publisher) {
      if (!serviceSet.has(ev.publisher)) {
        lines.push(`    ${svcId(ev.publisher)}["${sanitizeMermaidLabel(ev.publisher)}"]`);
      }
      lines.push(`    ${svcId(ev.publisher)} -->|"publish"| ${tid}`);
    }
    for (const sub of (ev.subscribers || [])) {
      if (!serviceSet.has(sub)) {
        lines.push(`    ${svcId(sub)}["${sanitizeMermaidLabel(sub)}"]`);
      }
      lines.push(`    ${tid} -->|"subscribe"| ${svcId(sub)}`);
    }
  }

  lines.push("```");
  return lines.join("\n");
}

function entityLifecycleDiagram(entity: WikiEntity): string {
  const states = Array.isArray(entity.lifecycleStates) ? entity.lifecycleStates : [];
  if (states.length < 2) return "";

  const stateId = (i: number) => `state_${i}`;
  const lines: string[] = ["```mermaid", "stateDiagram-v2"];
  for (let i = 0; i < states.length; i++) {
    lines.push(`    state "${sanitizeMermaidLabel(states[i])}" as ${stateId(i)}`);
  }
  lines.push(`    [*] --> ${stateId(0)}`);
  for (let i = 0; i < states.length - 1; i++) {
    lines.push(`    ${stateId(i)} --> ${stateId(i + 1)}`);
  }
  lines.push(`    ${stateId(states.length - 1)} --> [*]`);
  lines.push("```");
  return lines.join("\n");
}

function integrationPointsDiagram(domain: string, integration: WikiIntegrationPoints): string {
  const inbound = Array.isArray(integration?.inbound) ? integration.inbound : [];
  const outbound = Array.isArray(integration?.outbound) ? integration.outbound : [];
  if (inbound.length === 0 && outbound.length === 0) return "";

  const lines: string[] = ["```mermaid", "flowchart LR"];
  const domId = "ThisDomain";
  lines.push(`    ${domId}(["${sanitizeMermaidLabel(domain)}"])`);

  for (let i = 0; i < inbound.length; i++) {
    const p = inbound[i];
    const nid = `in_${i}`;
    lines.push(`    ${nid}["${sanitizeMermaidLabel(p?.source || "external")}"]`);
    const label = `${p?.type || "?"}: ${sanitizeMermaidLabel(truncateText(p?.endpoint || "", 25))}`;
    lines.push(`    ${nid} -->|"${label}"| ${domId}`);
  }

  for (let i = 0; i < outbound.length; i++) {
    const p = outbound[i];
    const nid = `out_${i}`;
    lines.push(`    ${nid}["${sanitizeMermaidLabel(p?.target || "external")}"]`);
    const label = `${p?.type || "?"}: ${sanitizeMermaidLabel(truncateText(p?.endpoint || "", 25))}`;
    lines.push(`    ${domId} -->|"${label}"| ${nid}`);
  }

  lines.push("```");
  return lines.join("\n");
}

function overviewToMermaidMap(data: WikiOverview): string {
  const services = Array.isArray(data?.services) ? data.services : [];
  if (services.length === 0) return "";

  const lines: string[] = ["```mermaid", "graph TD"];
  const sysId = "System";
  lines.push(`    ${sysId}(["${sanitizeMermaidLabel(data?.name || "System")}"])`);

  for (const svc of services) {
    const sid = `svc_${(svc.name || "unknown").replace(/[^a-zA-Z0-9]/g, "_")}`;
    lines.push(`    ${sid}["${sanitizeMermaidLabel(svc.name || "?")}"]`);
    lines.push(`    ${sysId} --> ${sid}`);
    const domains = Array.isArray(svc.domains) ? svc.domains : [];
    for (const d of domains) {
      const did = `dom_${d.replace(/[^a-zA-Z0-9]/g, "_")}`;
      lines.push(`    ${did}(("${sanitizeMermaidLabel(d)}"))`);
      lines.push(`    ${sid} --> ${did}`);
    }
  }

  lines.push("```");
  return lines.join("\n");
}

function flowToMarkdown(flow: WikiFlow, labels: WikiLabels = defaultLabels): string {
  const lines: string[] = [];
  const anchorId = flow.id ?? flow.name?.toLowerCase().replace(/\s+/g, "-") ?? "";
  if (anchorId) {
    lines.push(`<a id="${anchorId}"></a>`);
    lines.push("");
  }
  lines.push(`### ${flow.name}`);
  lines.push("");
  lines.push(flow.summary);
  lines.push("");

  const steps = Array.isArray(flow.steps) ? flow.steps : [];
  if (steps.length > 0) {
    lines.push(flowToMermaidDiagram(flow, labels));
    lines.push("");
    lines.push(`#### ${labels.steps}`);
    lines.push("");
    for (const step of steps) {
      lines.push(flowStepToMarkdown(step));
    }
    lines.push("");
  }

  return lines.join("\n");
}

function crossServiceCallsToTable(
  calls: CrossServiceCall[],
  labels: WikiLabels = defaultLabels,
  withLinks = false,
): string {
  const lines: string[] = [];
  lines.push(`## ${labels.crossServiceCalls}`);
  lines.push("");

  const link = (name: string) => (withLinks ? svcLink(name) : `\`${name}\``);

  lines.push(`| ${labels.callerHeader} | ${labels.calleeHeader} | ${labels.typeHeader} | ${labels.detailHeader} |`);
  lines.push("|---|---|---|---|");
  for (const call of calls) {
    const callerSvc = call.caller?.service ?? "?";
    const calleeSvc = call.callee?.service ?? "?";
    const callerMethod = call.caller?.method ? `.${call.caller.method}` : "";
    const caller = `${link(callerSvc)}${callerMethod}`;
    const calleeMethod = call.callee?.method ? `.${call.callee.method}` : "";
    const callee = call.callee?.interface
      ? `${link(calleeSvc)}#${call.callee.interface}${calleeMethod}`
      : `${link(calleeSvc)}${calleeMethod}`;
    const type = escapeTableCell(call.type ?? "");
    const detail = escapeTableCell(call.detail ?? "");
    lines.push(`| ${caller} | ${callee} | ${type} | ${detail} |`);
  }
  lines.push("");

  return lines.join("\n");
}

function escapeTableCell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function svcLink(name: string): string {
  return `[${name}](wiki://${name}/service.json)`;
}

export function overviewToMarkdown(data: WikiOverview, labels: WikiLabels = defaultLabels): string {
  const lines: string[] = [];
  lines.push(`# ${data?.name ?? "System Overview"}`);
  lines.push("");
  lines.push(data?.description ?? "");
  lines.push("");

  const overviewDiagram = overviewToMermaidMap(data);
  if (overviewDiagram) {
    lines.push(overviewDiagram);
    lines.push("");
  }

  // Normalize a service entry: handles both string ("svc-name") and object ({ name, description, domains }) formats
  const normalizeSvc = (svc: unknown): { name: string; description: string; domains: string[] } => {
    if (typeof svc === "string") return { name: svc, description: "", domains: [] };
    const obj = svc as Record<string, unknown> | null;
    return {
      name: (obj?.name as string) ?? "",
      description: (obj?.description as string) ?? "",
      domains: Array.isArray(obj?.domains) ? (obj.domains as string[]) : [],
    };
  };

  // Handle both flat services[] and facets[].services[] structures
  const facets = Array.isArray((data as Record<string, unknown>).facets) ? (data as Record<string, unknown>).facets as Array<{ type?: string; name: string; label?: string; path?: string; services?: unknown[]; techStack?: string[] }> : null;
  const services = Array.isArray(data?.services) ? data.services : [];

  if (facets && facets.length > 0) {
    for (const facet of facets) {
      const icon = facet.type === "server" || facet.name === "server" ? "🖥️" : facet.type === "mobile" || facet.name === "mobile" ? "📱" : "🌐";
      lines.push(`## ${icon} ${facet.label ?? facet.name}`);
      lines.push("");
      const fSvcs = Array.isArray(facet.services) ? facet.services.map(normalizeSvc) : [];
      if (fSvcs.length > 0) {
        lines.push("| Service | Description | Domains |");
        lines.push("|---|---|---|");
        for (const svc of fSvcs) {
          const name = svc.name ? svcLink(svc.name) : "";
          lines.push(`| ${name} | ${svc.description} | ${svc.domains.join(", ")} |`);
        }
        lines.push("");
      }
      const fTech = Array.isArray(facet.techStack) ? facet.techStack : [];
      if (fTech.length > 0) {
        lines.push(`**${labels.techStack}:** ${fTech.join(", ")}`);
        lines.push("");
      }
    }
  } else if (services.length > 0) {
    lines.push(`## ${labels.services}`);
    lines.push("");
    lines.push("| Service | Description | Domains |");
    lines.push("|---|---|---|");
    for (const raw of services) {
      const svc = normalizeSvc(raw);
      const name = svc.name ? svcLink(svc.name) : "";
      lines.push(`| ${name} | ${svc.description} | ${svc.domains.join(", ")} |`);
    }
    lines.push("");
  }

  // Embedded architecture diagram (from facet wiki)
  const arch = (data as Record<string, unknown>)._architecture as WikiArchitecture | undefined;
  if (arch) {
    const archDiagram = architectureToMermaidDiagram(arch);
    if (archDiagram) {
      lines.push(`## ${labels.systemArchitecture}`);
      lines.push("");
      lines.push(archDiagram);
      lines.push("");
      const crossServiceCalls = Array.isArray(arch.crossServiceCalls) ? arch.crossServiceCalls : [];
      if (crossServiceCalls.length > 0) {
        lines.push(crossServiceCallsToTable(crossServiceCalls, labels, true));
      }
    }
  }

  // Embedded cross-domain flows (from facet wiki)
  const crossDomains = (data as Record<string, unknown>)._crossDomains as WikiCrossDomain[] | undefined;
  if (crossDomains && crossDomains.length > 0) {
    lines.push(`## ${labels.crossDomainFlows ?? "跨域业务流程"}`);
    lines.push("");
    for (const domain of crossDomains) {
      lines.push(`### ${domain.name}`);
      lines.push("");
      lines.push(domain.summary ?? "");
      lines.push("");
      const steps = Array.isArray(domain.steps) ? domain.steps : [];
      const domServices = Array.isArray(domain.services) ? domain.services : [];
      if (steps.length > 0) {
        const seqDiagram = crossDomainToSequenceDiagram(domServices, steps);
        if (seqDiagram) {
          lines.push(seqDiagram);
          lines.push("");
        }
      }
    }
  }

  const techStack = Array.isArray(data?.techStack) ? data.techStack : [];
  if (techStack.length > 0) {
    lines.push(`## ${labels.techStack}`);
    lines.push("");
    for (const tech of techStack) {
      lines.push(`- ${tech}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

export function architectureToMarkdown(data: WikiArchitecture, labels: WikiLabels = defaultLabels): string {
  const lines: string[] = [];
  lines.push(`# ${labels.systemArchitecture}`);
  lines.push("");

  const facets = Array.isArray(data?.facets) ? data.facets : [];

  // Facet-level service overview table
  if (facets.length > 0) {
    lines.push("## 服务总览");
    lines.push("");
    lines.push("| 端 | 服务 | 说明 |");
    lines.push("|---|---|---|");
    for (const f of facets) {
      const svcList = f.services.map(s => svcLink(s)).join(", ");
      lines.push(`| **${f.label}** | ${svcList} | ${f.description ?? ""} |`);
    }
    lines.push("");
  }

  const archDiagram = architectureToMermaidDiagram(data);
  if (archDiagram) {
    lines.push(archDiagram);
    lines.push("");
  }

  // Build facet lookup to filter cross-facet only calls
  const svcToFacet = new Map<string, string>();
  for (const f of facets) {
    for (const svc of f.services) svcToFacet.set(svc, f.name);
  }

  const crossServiceCalls = Array.isArray(data?.crossServiceCalls) ? data.crossServiceCalls : [];
  const filteredCalls = facets.length > 0
    ? crossServiceCalls.filter(c => {
        const from = c.caller?.service;
        const to = c.callee?.service;
        return from && to && svcToFacet.get(from) !== svcToFacet.get(to);
      })
    : crossServiceCalls;

  if (filteredCalls.length > 0) {
    lines.push(crossServiceCallsToTable(filteredCalls, labels, true));
  }

  const eventFlows = Array.isArray(data?.eventFlows)
    ? data.eventFlows.filter((ev) => ev?.topic)
    : [];
  if (eventFlows.length > 0) {
    lines.push(`## ${labels.eventFlows}`);
    lines.push("");
    for (const ev of eventFlows) {
      const pub = ev.publisher ? svcLink(ev.publisher) : "?";
      const subs = Array.isArray(ev.subscribers) ? ev.subscribers.map(s => svcLink(s)).join(", ") : "";
      lines.push(`- **${ev.topic}**: ${pub} → ${subs}`);
    }
    lines.push("");
  }

  const sharedResources = Array.isArray(data?.sharedResources)
    ? data.sharedResources.filter((res) => res?.name)
    : [];
  if (sharedResources.length > 0) {
    lines.push(`## ${labels.sharedResources}`);
    lines.push("");
    for (const res of sharedResources) {
      const svcList = Array.isArray(res.services) ? res.services.map(s => svcLink(s)).join(", ") : "";
      lines.push(`- [${res.type ?? "unknown"}] **${res.name}** — used by: ${svcList}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

export function crossDomainToMarkdown(data: WikiCrossDomain, labels: WikiLabels = defaultLabels): string {
  const lines: string[] = [];
  lines.push(`# ${data?.name ?? "Untitled"}`);
  lines.push("");
  lines.push(data?.summary ?? "");
  lines.push("");

  const services = Array.isArray(data?.services) ? data.services : [];
  if (services.length > 0) {
    lines.push(`**${labels.servicesInvolved}:** ${services.map(s => svcLink(s)).join(", ")}`);
    lines.push("");
  }

  // Cross-platform architecture diagram
  const archData = (data as Record<string, unknown>).architecture as { layers?: Array<{ name: string; services: string[]; description: string }>; communications?: Array<{ from: string; to: string; protocol: string; description: string }> } | undefined;
  if (archData?.communications && archData.communications.length > 0) {
    lines.push("## 跨端通信架构");
    lines.push("");
    lines.push("```mermaid");
    lines.push("flowchart TD");
    const seen = new Set<string>();
    for (const layer of archData.layers ?? []) {
      for (const svc of layer.services) {
        if (!seen.has(svc)) {
          const pid = svc.replace(/[^a-zA-Z0-9_]/g, "_");
          lines.push(`    ${pid}["${svc}"]`);
          seen.add(svc);
        }
      }
    }
    for (const comm of archData.communications) {
      const from = comm.from.replace(/[^a-zA-Z0-9_]/g, "_");
      const to = comm.to.replace(/[^a-zA-Z0-9_]/g, "_");
      lines.push(`    ${from} -->|"${comm.protocol}"| ${to}`);
    }
    lines.push("```");
    lines.push("");
    if (archData.layers && archData.layers.length > 0) {
      lines.push("| 层级 | 服务 | 说明 |");
      lines.push("|---|---|---|");
      for (const layer of archData.layers) {
        lines.push(`| ${layer.name} | ${layer.services.map(s => svcLink(s)).join(", ")} | ${layer.description} |`);
      }
      lines.push("");
    }
  }

  // Multi-flow aggregation (panorama page with embedded flows)
  const flows = Array.isArray((data as Record<string, unknown>).flows) ? (data as Record<string, unknown>).flows as Array<{ facet?: string; name: string; summary: string; services: string[]; steps: Array<{ order: number; service: string; description: string; wikiRef?: string; crossServiceCall?: { interface?: string; method: string; type: string } }> }> : null;
  if (flows && flows.length > 0) {
    for (const flow of flows) {
      const header = flow.facet ? `## [${flow.facet}] ${flow.name}` : `## ${flow.name}`;
      lines.push(header);
      lines.push("");
      lines.push(flow.summary ?? "");
      lines.push("");
      if (flow.steps.length > 0) {
        const seqDiagram = crossDomainToSequenceDiagram(flow.services, flow.steps);
        if (seqDiagram) {
          lines.push(seqDiagram);
          lines.push("");
        }
        for (const step of flow.steps) {
          let line = `${step.order}. **${svcLink(step.service)}** ${step.description}`;
          if (step.wikiRef) {
            line += `\n   → [View details](wiki://${step.wikiRef})`;
          }
          if (step.crossServiceCall) {
            line += `\n   🔗 ${step.crossServiceCall.interface}.${step.crossServiceCall.method} (${step.crossServiceCall.type})`;
          }
          lines.push(line);
        }
        lines.push("");
      }
    }
    return lines.join("\n");
  }

  // Single flow rendering
  const steps = Array.isArray(data?.steps) ? data.steps : [];
  if (steps.length > 0) {
    const seqDiagram = crossDomainToSequenceDiagram(services, steps);
    if (seqDiagram) {
      lines.push(seqDiagram);
      lines.push("");
    }

    lines.push(`## ${labels.flowSteps}`);
    lines.push("");
    for (const step of steps) {
      let line = `${step.order}. **${svcLink(step.service)}** ${step.description}`;
      if (step.wikiRef) {
        line += `\n   → [View details](wiki://${step.wikiRef})`;
      }
      if (step.crossServiceCall) {
        line += `\n   🔗 ${step.crossServiceCall.interface}.${step.crossServiceCall.method} (${step.crossServiceCall.type})`;
      }
      lines.push(line);
    }
    lines.push("");
  }

  return lines.join("\n");
}

export function domainPageToMarkdown(page: WikiDomainPage, labels: WikiLabels = defaultLabels): string {
  const lines: string[] = [];

  lines.push(`# ${page?.name ?? "Domain"}`);
  lines.push("");
  lines.push(page?.summary ?? "");
  lines.push("");

  const glossary = Array.isArray(page?.ubiquitousLanguage) ? page.ubiquitousLanguage : [];
  if (glossary.length > 0) {
    lines.push(`## ${labels.ubiquitousLanguage}`);
    lines.push("");
    lines.push(`| ${labels.termHeader} | ${labels.definitionHeader} |`);
    lines.push("|---|---|");
    for (const entry of glossary as WikiGlossaryEntry[]) {
      lines.push(`| **${entry?.term ?? "?"}** | ${entry?.definition ?? ""} |`);
    }
    lines.push("");
  }

  const rules = Array.isArray(page?.businessRules) ? page.businessRules : [];
  if (rules.length > 0) {
    lines.push(`## ${labels.businessRules}`);
    lines.push("");
    lines.push(`| ${labels.ruleIdHeader} | ${labels.ruleHeader} | ${labels.enforcedByHeader} |`);
    lines.push("|---|---|---|");
    for (const rule of rules as WikiBusinessRule[]) {
      lines.push(`| ${rule?.id ?? "?"} | ${rule?.rule ?? ""} | \`${rule?.enforcement ?? "—"}\` |`);
    }
    lines.push("");
  }

  const entities = Array.isArray(page?.entities) ? page.entities : [];
  if (entities.length > 0) {
    lines.push(`## ${labels.keyEntities}`);
    lines.push("");
    for (const entity of entities) {
      if (typeof entity === "string") {
        lines.push(`- ${entity}`);
      } else {
        const e = entity as WikiEntity;
        lines.push(`**${e.name}**`);
        lines.push("");
        if (e.description) lines.push(e.description);
        if (Array.isArray(e.keyFields) && e.keyFields.length > 0) {
          lines.push(`- ${labels.fieldsLabel}: \`${e.keyFields.join("`, `")}\``);
        }
        if (Array.isArray(e.lifecycleStates) && e.lifecycleStates.length > 0) {
          lines.push(`- ${labels.lifecycleLabel}: ${e.lifecycleStates.join(" → ")}`);
          const lcDiagram = entityLifecycleDiagram(e);
          if (lcDiagram) {
            lines.push("");
            lines.push(lcDiagram);
          }
        }
        if (Array.isArray(e.invariants) && e.invariants.length > 0) {
          for (const inv of e.invariants) {
            lines.push(`- ⚠️ ${inv}`);
          }
        }
        lines.push("");
      }
    }
    lines.push("");
  }

  const integration = page?.integrationPoints as WikiIntegrationPoints | undefined;
  const inbound = Array.isArray(integration?.inbound) ? integration!.inbound : [];
  const outbound = Array.isArray(integration?.outbound) ? integration!.outbound : [];
  if (inbound.length > 0 || outbound.length > 0) {
    lines.push(`## ${labels.integrationPoints}`);
    lines.push("");
    const ipDiagram = integrationPointsDiagram(page?.name || "Domain", integration!);
    if (ipDiagram) {
      lines.push(ipDiagram);
      lines.push("");
    }
    if (inbound.length > 0) {
      lines.push(`**${labels.inbound}:**`);
      lines.push("");
      for (const p of inbound) {
        lines.push(`- [${p?.type ?? "?"}] \`${p?.endpoint ?? "?"}\` from ${p?.source ?? "?"} — ${p?.description ?? ""}`);
      }
      lines.push("");
    }
    if (outbound.length > 0) {
      lines.push(`**${labels.outbound}:**`);
      lines.push("");
      for (const p of outbound) {
        lines.push(`- [${p?.type ?? "?"}] \`${p?.endpoint ?? "?"}\` to ${p?.target ?? "?"} — ${p?.description ?? ""}`);
      }
      lines.push("");
    }
  }

  const rawErrors = Array.isArray(page?.errorCatalog) ? page.errorCatalog : [];
  const errors = rawErrors.filter((e) => {
    const r = e as unknown as Record<string, unknown>;
    return r && (r.exception || r.code);
  });
  if (errors.length > 0) {
    lines.push(`## ${labels.errorScenarios}`);
    lines.push("");
    lines.push(`| ${labels.exceptionHeader} | ${labels.triggerHeader} | ${labels.handlingHeader} | ${labels.severityHeader} |`);
    lines.push("|---|---|---|---|");
    for (const raw of errors) {
      const e = raw as unknown as Record<string, unknown>;
      const exception = (e.exception ?? e.code ?? "") as string;
      const trigger = (e.trigger ?? "") as string;
      const handling = (e.handling ?? e.description ?? "") as string;
      const severity = (e.severity ?? "") as string;
      lines.push(`| \`${exception}\` | ${trigger} | ${handling} | ${severity} |`);
    }
    lines.push("");
  }

  const flows = Array.isArray(page?.flows) ? page.flows : [];
  if (flows.length > 0) {
    lines.push(`## ${labels.flows}`);
    lines.push("");
    for (const flow of flows) {
      lines.push(flowToMarkdown(flow, labels));
    }
  }

  if (Array.isArray(page?.crossServiceCalls) && page.crossServiceCalls.length > 0) {
    lines.push(crossServiceCallsToTable(page.crossServiceCalls, labels));
  }

  return lines.join("\n");
}

export function endpointDocToMarkdown(doc: ServiceEndpointDoc, labels: WikiLabels = defaultLabels): string {
  const lines: string[] = [];

  lines.push(`# ${doc.service} ${labels.endpoints ?? "Endpoints"}`);
  lines.push("");
  lines.push(doc.description ?? "");
  lines.push("");

  const providers = Array.isArray(doc.providers) ? doc.providers : [];
  if (providers.length > 0) {
    lines.push(`## ${labels.endpointProviders ?? "Providers"}`);
    lines.push("");
    lines.push(`| ${labels.endpointIdentifier ?? "Identifier"} | ${labels.endpointProtocol ?? "Protocol"} | ${labels.endpointFramework ?? "Framework"} | ${labels.endpointMethods ?? "Methods"} |`);
    lines.push("| --- | --- | --- | --- |");
    for (const p of providers) {
      const methodCount = Array.isArray(p.methods) ? p.methods.length : 0;
      const anchor = p.identifier.toLowerCase().replace(/[^a-z0-9]+/g, "-");
      lines.push(`| [${p.identifier}](#${anchor}) | ${p.protocol} | ${p.framework} | ${methodCount} |`);
    }
    lines.push("");

    for (const p of providers) {
      if (!Array.isArray(p.methods) || p.methods.length === 0) continue;
      lines.push(`### ${p.identifier}`);
      lines.push("");
      if (p.group || p.version) {
        const meta: string[] = [];
        if (p.group) meta.push(`group: \`${p.group}\``);
        if (p.version) meta.push(`version: \`${p.version}\``);
        lines.push(`> ${meta.join(" | ")}`);
        lines.push("");
      }
      const hasDescriptions = p.methods.some((m: { description?: string }) => m.description);
      if (hasDescriptions) {
        lines.push(`| ${labels.endpointMethodName ?? "Method"} | ${labels.endpointDescription ?? "Description"} | ${labels.endpointReturnType ?? "Return Type"} |`);
        lines.push("| --- | --- | --- |");
      } else {
        lines.push(`| ${labels.endpointMethodName ?? "Method"} | ${labels.endpointParams ?? "Params"} | ${labels.endpointReturnType ?? "Return Type"} |`);
        lines.push("| --- | --- | --- |");
      }
      for (const m of p.methods) {
        const lineRange = Array.isArray(m.lineRange) && m.lineRange[0] > 0 ? m.lineRange : null;
        const sourceFile = p.sourceRef?.file ?? "";
        const methodLink = sourceFile && lineRange
          ? `[${m.name}](source://${sourceFile}#L${lineRange[0]}-L${lineRange[1]})`
          : `\`${m.name}\``;
        if (hasDescriptions) {
          const desc = (m as { description?: string }).description ?? "";
          lines.push(`| ${methodLink} | ${desc} | \`${m.returnType || "void"}\` |`);
        } else {
          const params = Array.isArray(m.params)
            ? m.params.map((pp: { name: string; type: string }) => `${pp.name}: ${pp.type}`).join(", ")
            : "";
          lines.push(`| ${methodLink} | \`${params || "—"}\` | \`${m.returnType || "void"}\` |`);
        }
      }
      lines.push("");
      if (p.sourceRef?.file) {
        lines.push(`📄 [${p.sourceRef.file}](source://${p.sourceRef.file})`);
        lines.push("");
      }
    }
  }

  const consumers = Array.isArray(doc.consumers) ? doc.consumers : [];
  if (consumers.length > 0) {
    lines.push(`## ${labels.endpointConsumers ?? "Consumers"}`);
    lines.push("");
    lines.push(`| ${labels.endpointIdentifier ?? "Identifier"} | ${labels.endpointProtocol ?? "Protocol"} | ${labels.endpointFramework ?? "Framework"} | ${labels.endpointTargetInterface ?? "Target Interface"} |`);
    lines.push("| --- | --- | --- | --- |");
    for (const c of consumers) {
      const targetLink = c.targetService
        ? `[${c.targetInterface}](wiki://${c.targetService}/endpoints)`
        : `\`${c.targetInterface}\``;
      lines.push(`| \`${c.identifier}\` | ${c.protocol} | ${c.framework} | ${targetLink} |`);
    }
    lines.push("");
  }

  const kafkaTopics = Array.isArray(doc.kafkaTopics) ? doc.kafkaTopics : [];
  if (kafkaTopics.length > 0) {
    lines.push(`## ${labels.endpointKafkaTopics ?? "Kafka Topics"}`);
    lines.push("");
    lines.push(`| ${labels.endpointTopic ?? "Topic"} | ${labels.endpointRole ?? "Role"} | ${labels.endpointHandler ?? "Handler Method"} |`);
    lines.push("| --- | --- | --- |");
    for (const t of kafkaTopics) {
      lines.push(`| \`${t.topic}\` | ${t.role} | \`${t.handlerMethod ?? "—"}\` |`);
    }
    lines.push("");
  }

  const httpEndpoints = Array.isArray(doc.httpEndpoints) ? doc.httpEndpoints : [];
  if (httpEndpoints.length > 0) {
    lines.push(`## ${labels.httpEndpoints ?? "HTTP Endpoints"} (${httpEndpoints.length})`);
    lines.push("");

    const grouped = new Map<string, typeof httpEndpoints>();
    for (const ep of httpEndpoints) {
      const key = ep.sourceClass || "Unknown";
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(ep);
    }

    for (const [className, eps] of grouped) {
      const firstFile = eps[0]?.sourceRef?.file ?? "";
      const classLink = firstFile
        ? `[${className}](source://${firstFile})`
        : `\`${className}\``;
      lines.push(`### ${classLink}`);
      lines.push("");
      lines.push(`| Method | Path | Function |`);
      lines.push("| --- | --- | --- |");
      for (const ep of eps) {
        const lr = ep.sourceRef?.lineRange;
        const pathDisplay = lr && ep.sourceRef?.file
          ? `[${ep.path}](source://${ep.sourceRef.file}#L${lr[0]}-L${lr[1]})`
          : `\`${ep.path}\``;
        const fnDisplay = ep.functionName ? `\`${ep.functionName}\`` : "—";
        lines.push(`| **${ep.method}** | ${pathDisplay} | ${fnDisplay} |`);
      }
      lines.push("");
    }
  }

  return lines.join("\n");
}

export function endpointIndexToMarkdown(index: Record<string, unknown>, labels: WikiLabels = defaultLabels): string {
  const lines: string[] = [];

  lines.push(`# ${labels.endpointIndex ?? "Endpoint Index"}`);
  lines.push("");

  const totalProviders = (index as { totalProviders?: number }).totalProviders ?? 0;
  const totalConsumers = (index as { totalConsumers?: number }).totalConsumers ?? 0;
  const totalKafka = (index as { totalKafkaTopics?: number }).totalKafkaTopics ?? 0;
  lines.push(`> ${totalProviders} providers | ${totalConsumers} consumers | ${totalKafka} Kafka topics`);
  lines.push("");

  const byService = Array.isArray((index as { byService?: unknown[] }).byService)
    ? (index as { byService: Array<{ service: string; providerCount?: number; consumerCount?: number; kafkaTopicCount?: number; protocols?: string[] }> }).byService
    : [];
  if (byService.length > 0) {
    lines.push(`## ${labels.endpointByService ?? "By Service"}`);
    lines.push("");
    lines.push("| Service | Providers | Consumers | Kafka | Protocols |");
    lines.push("| --- | --- | --- | --- | --- |");
    for (const s of byService) {
      const protocols = Array.isArray(s.protocols) ? s.protocols.join(", ") : "";
      lines.push(`| [${s.service}](wiki://${s.service}/endpoints) | ${s.providerCount ?? 0} | ${s.consumerCount ?? 0} | ${s.kafkaTopicCount ?? 0} | ${protocols} |`);
    }
    lines.push("");
  }

  const byProtocol = (index as { byProtocol?: Record<string, Array<{ service: string; identifier: string; methodCount?: number }>> }).byProtocol ?? {};
  const protocols = Object.keys(byProtocol).sort();
  if (protocols.length > 0) {
    lines.push(`## ${labels.endpointByProtocol ?? "By Protocol"}`);
    lines.push("");
    for (const proto of protocols) {
      lines.push(`### ${proto.toUpperCase()}`);
      lines.push("");
      lines.push("| Service | Identifier | Methods |");
      lines.push("| --- | --- | --- |");
      for (const entry of byProtocol[proto]) {
        lines.push(`| [${entry.service}](wiki://${entry.service}/endpoints) | \`${entry.identifier}\` | ${entry.methodCount ?? 0} |`);
      }
      lines.push("");
    }
  }

  const byTopic = (index as { byTopic?: Record<string, { publishers?: string[]; subscribers?: string[] }> }).byTopic ?? {};
  const topics = Object.keys(byTopic).sort();
  if (topics.length > 0) {
    lines.push(`## ${labels.endpointByTopic ?? "By Topic"}`);
    lines.push("");
    lines.push("| Topic | Publishers | Subscribers |");
    lines.push("| --- | --- | --- |");
    for (const topic of topics) {
      const t = byTopic[topic];
      const pubs = (t.publishers ?? []).map((s: string) => `[${s}](wiki://${s}/endpoints)`).join(", ");
      const subs = (t.subscribers ?? []).map((s: string) => `[${s}](wiki://${s}/endpoints)`).join(", ");
      lines.push(`| \`${topic}\` | ${pubs || "—"} | ${subs || "—"} |`);
    }
    lines.push("");
  }

  return lines.join("\n");
}
