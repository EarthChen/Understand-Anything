#!/usr/bin/env python3
"""
build-system-graph.py — Generate a system-level graph from per-service KGs.

Scans child directories for knowledge-graph.json files, extracts service
metadata, endpoints, and RPC edges. Outputs system-graph.json.

Usage:
    python build-system-graph.py <project-root> [--services="svc1 svc2"] [--output=<path>]
"""

from __future__ import annotations

import fnmatch
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

SKIP_DIR_NAMES = frozenset({"node_modules", "dist", "build", "target"})
FILE_NODE_TYPES = frozenset({
    "file",
    "config",
    "document",
    "service",
    "pipeline",
    "table",
    "schema",
    "resource",
    "endpoint",
})


def _load_system_config(root: Path) -> dict[str, Any] | None:
    system_config_path = root / ".understand-anything" / "system.json"
    if not system_config_path.exists():
        return None
    try:
        return json.loads(system_config_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None


def _apply_system_metadata(
    graph: dict[str, Any],
    system_config: dict[str, Any] | None,
) -> dict[str, Any]:
    if system_config:
        if "project" not in graph:
            graph["project"] = {}
        if system_config.get("name"):
            graph["project"]["name"] = system_config["name"]
        if system_config.get("description"):
            graph["project"]["description"] = system_config["description"]
    return graph


def _discover_from_facets(
    root: Path,
    system_config: dict[str, Any],
) -> list[dict[str, Any]]:
    """Discover services from system.json facets (supports nested layouts like backend/svc1)."""
    services: list[dict[str, Any]] = []
    seen: set[str] = set()
    for facet in system_config.get("facets", []):
        facet_path = facet.get("path", "")
        facet_type = facet.get("type", "")
        facet_dir = root / facet_path
        if not facet_dir.is_dir():
            continue
        for sub in facet.get("subPaths", []):
            svc_dir = facet_dir / sub
            kg_path = svc_dir / ".understand-anything" / "knowledge-graph.json"
            if kg_path.is_file() and sub not in seen:
                seen.add(sub)
                services.append({
                    "name": sub,
                    "path": str(svc_dir),
                    "kg_path": str(kg_path),
                    "facet": facet_type,
                    "basePath": f"{facet_path}/{sub}",
                })
    return services


def discover_services(
    project_root: str,
    exclude: list[str] | None = None,
) -> list[dict[str, Any]]:
    """Discover child services that have a knowledge graph.

    Returns list of dicts: {name, path, kg_path, facet?, basePath?}
    Supports both flat layout (services as direct children) and faceted layout
    (services nested under facet directories defined in system.json).
    """
    root = Path(project_root)
    exclude_set = set(exclude or [])

    parent_config = root / ".understand-anything" / "config.json"
    if parent_config.exists():
        try:
            cfg = json.loads(parent_config.read_text(encoding="utf-8"))
            for svc in cfg.get("excludeServices", []):
                exclude_set.add(svc)
        except (json.JSONDecodeError, OSError):
            pass

    system_config = _load_system_config(root)

    # Faceted layout: discover from system.json facets first
    if system_config and system_config.get("facets"):
        facet_services = _discover_from_facets(root, system_config)
        if facet_services:
            return facet_services

    if system_config:
        discovery = system_config.get("discovery", {})
        for pattern in discovery.get("exclude", []):
            exclude_set.add(pattern)

    include_patterns: list[str] = []
    if system_config:
        include_patterns = system_config.get("discovery", {}).get("include", [])

    services: list[dict[str, Any]] = []
    for entry in sorted(root.iterdir()):
        if not entry.is_dir():
            continue
        name = entry.name
        if name.startswith(".") or name in SKIP_DIR_NAMES:
            continue
        if include_patterns:
            if not any(fnmatch.fnmatch(name, pattern) for pattern in include_patterns):
                continue
        elif any(fnmatch.fnmatch(name, pattern) for pattern in exclude_set):
            continue

        kg_path = entry / ".understand-anything" / "knowledge-graph.json"
        if kg_path.is_file():
            services.append({
                "name": name,
                "path": str(entry),
                "kg_path": str(kg_path),
            })

    return services


def _is_knowledge_artifact(kg: dict[str, Any]) -> bool:
    project = kg.get("project", {})
    frameworks = project.get("frameworks", [])
    if "prd-wiki" in frameworks:
        return True
    nodes = kg.get("nodes", [])
    return any(node.get("type") in {"requirement", "testcase"} for node in nodes)


def _knowledge_profile(kg: dict[str, Any]) -> str:
    project = kg.get("project", {})
    frameworks = project.get("frameworks", [])
    if "prd-wiki" in frameworks:
        return "prd-wiki"
    return "generic"


def extract_service_info(service_name: str, kg: dict[str, Any]) -> dict[str, Any]:
    """Extract high-level info from a service's knowledge graph."""
    project = kg.get("project", {})
    nodes = kg.get("nodes", [])
    edges = kg.get("edges", [])

    endpoints = [n for n in nodes if n.get("type") == "endpoint"]
    rpc_provides = [e for e in edges if e.get("type") == "provides_rpc"]
    rpc_consumes = [e for e in edges if e.get("type") == "consumes_rpc"]
    file_count = sum(1 for n in nodes if n.get("type") in FILE_NODE_TYPES)

    project_name = project.get("description") or project.get("name") or service_name
    if not project_name or project_name == "Unknown Project":
        project_name = service_name
    return {
        "name": service_name,
        "project_name": project_name,
        "languages": project.get("languages", []),
        "frameworks": project.get("frameworks", []),
        "stats": {
            "nodes": len(nodes),
            "edges": len(edges),
            "files": file_count,
        },
        "endpoints": endpoints,
        "rpc_provides": rpc_provides,
        "rpc_consumes": rpc_consumes,
        "kg_commit": project.get("gitCommitHash", ""),
    }


def _interface_from_detail(detail: str) -> str:
    return detail.split(".")[0].strip() if detail else ""


def _interface_from_rpc_edge(edge: dict[str, Any]) -> str:
    """Extract RPC interface name from edge target or legacy detail field."""
    target = edge.get("target", "")
    if isinstance(target, str) and target.startswith("endpoint:__synthetic__:"):
        return target[len("endpoint:__synthetic__:"):]

    detail = edge.get("detail", "")
    if isinstance(detail, str):
        return _interface_from_detail(detail)
    return ""


def _rpc_type_from_edge(edge: dict[str, Any]) -> str:
    detail = edge.get("detail", "")
    if isinstance(detail, str) and detail and "." not in detail:
        return detail
    return "rpc"


def _match_rpc_edges(service_infos: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Match consumes_rpc → provides_rpc across services to build cross-service edges."""
    providers: dict[str, str] = {}
    for info in service_infos:
        for edge in info["rpc_provides"]:
            iface = _interface_from_rpc_edge(edge)
            if iface:
                providers[iface] = info["name"]

    rpc_edges: list[dict[str, Any]] = []
    seen: set[tuple[str, str, str]] = set()
    for info in service_infos:
        for edge in info["rpc_consumes"]:
            detail = edge.get("detail", "")
            iface = _interface_from_rpc_edge(edge)
            target_svc = providers.get(iface)
            if target_svc and target_svc != info["name"]:
                key = (info["name"], target_svc, iface)
                if key not in seen:
                    seen.add(key)
                    method = detail if isinstance(detail, str) and "." in detail else ""
                    rpc_edges.append({
                        "source": f"microservice:{info['name']}",
                        "target": f"microservice:{target_svc}",
                        "type": "rpc_call",
                        "weight": 0.8,
                        "detail": {
                            "interface": iface,
                            "method": method,
                            "rpcType": _rpc_type_from_edge(edge),
                            "evidence": "kg-matched",
                        },
                    })

    return rpc_edges


def build_system_graph(
    project_root: str,
    services: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Build the system-level graph from per-service KGs."""
    system_config = _load_system_config(Path(project_root))

    if services is None:
        services = discover_services(project_root)

    if not services:
        return _apply_system_metadata({
            "version": "1.0.0",
            "generatedAt": datetime.now(timezone.utc).isoformat(),
            "project": {
                "name": Path(project_root).name,
                "serviceCount": 0,
                "totalNodes": 0,
                "totalEdges": 0,
            },
            "nodes": [],
            "edges": [],
            "serviceIndex": {},
        }, system_config)

    # Build svc_name → original service dict lookup for facet/basePath info
    svc_meta: dict[str, dict[str, Any]] = {svc["name"]: svc for svc in services}

    service_infos: list[dict[str, Any]] = []
    for svc in services:
        try:
            kg = json.loads(Path(svc["kg_path"]).read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            print(f"  Warning: skipping {svc['name']}: {exc}", file=sys.stderr)
            continue
        info = extract_service_info(svc["name"], kg)
        if _is_knowledge_artifact(kg):
            info["facet"] = "knowledge"
            info["profile"] = _knowledge_profile(kg)
        service_infos.append(info)

    nodes: list[dict[str, Any]] = []
    edges: list[dict[str, Any]] = []
    service_index: dict[str, dict[str, Any]] = {}
    total_nodes = 0
    total_edges = 0

    # Generate facet group nodes from system.json
    facet_ids: dict[str, str] = {}  # facet_type → facet node id
    if system_config:
        for facet in system_config.get("facets", []):
            facet_type = facet.get("type", "")
            facet_id = f"facet:{facet_type}"
            facet_ids[facet_type] = facet_id
            nodes.append({
                "id": facet_id,
                "type": "facet",
                "name": facet.get("name", facet_type),
                "summary": "",
                "facetType": facet_type if facet_type in ("server", "mobile", "frontend", "knowledge") else "server",
                "path": facet.get("path", ""),
            })

    if any(info.get("facet") == "knowledge" for info in service_infos) and "knowledge" not in facet_ids:
        facet_ids["knowledge"] = "facet:knowledge"
        nodes.append({
            "id": "facet:knowledge",
            "type": "facet",
            "name": "Knowledge",
            "summary": "Product and document knowledge artifacts",
            "facetType": "knowledge",
            "path": "",
        })

    for info in service_infos:
        svc_id = f"microservice:{info['name']}"
        meta = svc_meta.get(info["name"], {})
        base_path = meta.get("basePath", info["name"])
        svc_path = str(Path(project_root) / base_path)
        ua_path = os.path.join(svc_path, ".understand-anything")

        nodes.append({
            "id": svc_id,
            "type": "microservice",
            "name": info["project_name"],
            "summary": info["project_name"],
            "languages": info["languages"],
            "frameworks": info["frameworks"],
            "stats": info["stats"],
            "kgPath": f"{base_path}/.understand-anything/knowledge-graph.json",
            "wikiPath": f"{base_path}/.understand-anything/wiki/",
            "domainPath": f"{base_path}/.understand-anything/domain-graph.json",
        })

        # Add facet → service contains edge
        svc_facet = info.get("facet") or meta.get("facet", "")
        if svc_facet and svc_facet in facet_ids:
            edges.append({
                "source": facet_ids[svc_facet],
                "target": svc_id,
                "type": "contains",
                "weight": 1.0,
            })

        for ep in info["endpoints"][:5]:
            ep_id = f"endpoint:{info['name']}:{ep.get('name', ep['id'])}"
            nodes.append({
                "id": ep_id,
                "type": "endpoint",
                "name": ep.get("name", ""),
                "summary": ep.get("summary", ""),
                "service": info["name"],
            })
            edges.append({
                "source": svc_id,
                "target": ep_id,
                "type": "contains",
                "weight": 1.0,
            })

        total_nodes += info["stats"]["nodes"]
        total_edges += info["stats"]["edges"]

        idx_entry: dict[str, Any] = {
            "hasKg": True,
            "hasWiki": os.path.exists(os.path.join(ua_path, "wiki", "meta.json")),
            "hasDomain": os.path.exists(os.path.join(ua_path, "domain-graph.json")),
            "kgCommit": info["kg_commit"],
            "basePath": base_path,
        }
        svc_facet_val = info.get("facet") or meta.get("facet")
        if svc_facet_val:
            idx_entry["facet"] = svc_facet_val
        if info.get("profile"):
            idx_entry["profile"] = info["profile"]
        service_index[info["name"]] = idx_entry

    edges.extend(_match_rpc_edges(service_infos))

    return _apply_system_metadata({
        "version": "1.0.0",
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "project": {
            "name": Path(project_root).name,
            "serviceCount": len(service_infos),
            "totalNodes": total_nodes,
            "totalEdges": total_edges,
        },
        "nodes": nodes,
        "edges": edges,
        "serviceIndex": service_index,
    }, system_config)


def enrich_from_wiki(graph: dict[str, Any], project_root: str) -> dict[str, Any]:
    """Enrich system graph with cross-service data from wiki architecture.json."""
    arch_path = Path(project_root) / ".understand-anything" / "wiki" / "architecture.json"
    if arch_path.exists():
        try:
            arch = json.loads(arch_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            arch = None
        if arch is not None:
            node_ids = {n["id"] for n in graph.get("nodes", [])}
            existing_edges = {
                (e["source"], e["target"], e["type"]) for e in graph.get("edges", [])
            }

            for call in arch.get("crossServiceCalls", []):
                caller_svc = call.get("caller", {}).get("service", "")
                callee_svc = call.get("callee", {}).get("service", "")
                source_id = f"microservice:{caller_svc}"
                target_id = f"microservice:{callee_svc}"

                if source_id not in node_ids or target_id not in node_ids:
                    continue

                edge_key = (source_id, target_id, "rpc_call")
                if edge_key in existing_edges:
                    continue

                iface = call.get("callee", {}).get("interface", "")
                method = call.get("callee", {}).get("method", "")
                graph["edges"].append({
                    "source": source_id,
                    "target": target_id,
                    "type": "rpc_call",
                    "weight": 0.8,
                    "detail": {
                        "interface": iface,
                        "method": f"{iface}.{method}" if iface and method else method,
                        "rpcType": call.get("type", "rpc"),
                        "evidence": "wiki-enriched",
                    },
                })
                existing_edges.add(edge_key)

    ovw_path = Path(project_root) / ".understand-anything" / "wiki" / "overview.json"
    if ovw_path.exists():
        try:
            ovw = json.loads(ovw_path.read_text(encoding="utf-8"))
            if "project" not in graph:
                graph["project"] = {}
            if ovw.get("name"):
                graph["project"]["name"] = ovw["name"]
            if ovw.get("description") is not None:
                graph["project"]["description"] = ovw["description"]
        except (OSError, json.JSONDecodeError):
            pass

    return graph


def main() -> int:
    import argparse

    parser = argparse.ArgumentParser(description="Build system-graph.json from per-service KGs")
    parser.add_argument("project_root", help="Parent directory containing service subdirectories")
    parser.add_argument(
        "--services",
        default=None,
        help='Space-separated service names (default: auto-discover)',
    )
    parser.add_argument(
        "--output",
        default=None,
        help="Output path (default: <project_root>/.understand-anything/system-graph.json)",
    )
    args = parser.parse_args()

    project_root = os.path.abspath(args.project_root)
    if args.services:
        names = args.services.split()
        services = [
            {
                "name": name,
                "path": os.path.join(project_root, name),
                "kg_path": os.path.join(
                    project_root, name, ".understand-anything", "knowledge-graph.json"
                ),
            }
            for name in names
        ]
    else:
        services = None

    graph = build_system_graph(project_root, services)
    graph = enrich_from_wiki(graph, project_root)

    output = args.output or os.path.join(
        project_root, ".understand-anything", "system-graph.json"
    )
    os.makedirs(os.path.dirname(output), exist_ok=True)
    with open(output, "w", encoding="utf-8") as f:
        json.dump(graph, f, indent=2, ensure_ascii=False)
        f.write("\n")

    svc_count = graph["project"].get("serviceCount", 0)
    node_count = len(graph["nodes"])
    edge_count = len(graph["edges"])
    print(
        f"[system-graph] Generated: {svc_count} services, "
        f"{node_count} nodes, {edge_count} edges",
        file=sys.stderr,
    )
    print(f"[system-graph] Written to {output}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
