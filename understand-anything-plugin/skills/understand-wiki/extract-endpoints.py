"""Deterministic endpoint extraction from ua-file-extract-results JSON.

Reads annotations + method signatures to produce ServiceEndpointDoc JSON.
Does NOT use LLM — pure structural extraction.

Annotation configuration is loaded from an external JSON file
(endpoint-annotations.json by default), making it easy to extend
for new frameworks without modifying this script.
"""
from __future__ import annotations

import json
import re
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any

# ---------------------------------------------------------------------------
# Config loading
# ---------------------------------------------------------------------------

_DEFAULT_CONFIG_PATH = Path(__file__).parent.parent / "understand" / "endpoint-annotations.json"


def load_annotation_config(config_path: Path | None = None) -> dict[str, Any]:
    """Load endpoint annotation configuration from JSON file.

    Falls back to built-in defaults if no config file is found.
    """
    path = config_path or _DEFAULT_CONFIG_PATH
    if path.is_file():
        try:
            cfg = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(cfg, dict):
                return cfg
        except (OSError, json.JSONDecodeError):
            pass

    # Built-in fallback defaults (same as the old hardcoded values)
    return {
        "rpcProviders": {
            "annotations": ["MoaProvider", "DubboService", "GrpcService"],
            "protocolMap": {
                "MoaProvider": "moa", "DubboService": "dubbo", "GrpcService": "grpc",
            },
        },
        "rpcConsumers": {
            "fieldAnnotations": ["MoaConsumer", "DubboReference", "GrpcClient"],
            "classAnnotations": ["FeignClient"],
            "protocolMap": {
                "MoaConsumer": "moa", "DubboReference": "dubbo",
                "GrpcClient": "grpc", "FeignClient": "http",
            },
        },
        "eventSubscribers": {
            "annotations": ["KafkaListener"],
            "protocolMap": {"KafkaListener": "kafka"},
        },
        "httpClient": {
            "frameworks": {
                "retrofit": {
                    "methodAnnotations": ["GET", "POST", "PUT", "DELETE", "PATCH", "HTTP"],
                    "pathArgument": "value",
                },
                "feign": {
                    "methodAnnotations": ["GetMapping", "PostMapping", "PutMapping", "DeleteMapping", "RequestMapping"],
                    "pathArgument": "value",
                },
            },
        },
        "kgEdgeTypes": {
            "rpc": ["provides_rpc", "consumes_rpc"],
            "events": ["publishes", "subscribes"],
            "http": ["consumes_api"],
        },
        "implicitConsumers": {
            "namePatterns": ["MoaService$", "WrapperService$", "WrapperMoaService$", "MoaWrapperService$"],
            "namePatternFlags": "IGNORECASE",
            "tags": ["rpc-consumer"],
        },
        "internalClassTags": {
            "tags": ["data-access", "redis", "configuration", "business-logic",
                     "event-handler", "callback", "ultron-composite"],
        },
    }


def _build_annotation_sets(config: dict) -> dict[str, set[str]]:
    """Pre-compute annotation sets from config for fast lookup."""
    rpc = config.get("rpcProviders", {})
    cons = config.get("rpcConsumers", {})
    evt = config.get("eventSubscribers", {})

    # Merge all protocol maps
    protocol_map: dict[str, str] = {}
    for section in (rpc, cons, evt):
        protocol_map.update(section.get("protocolMap", {}))

    return {
        "provider_annotations": set(rpc.get("annotations", [])),
        "consumer_field_annotations": set(cons.get("fieldAnnotations", [])),
        "consumer_class_annotations": set(cons.get("classAnnotations", [])),
        "subscriber_annotations": set(evt.get("annotations", [])),
        "protocol_map": protocol_map,
    }


def _build_http_annotation_sets(config: dict) -> dict[str, str]:
    """Build HTTP method annotation -> framework mapping from config."""
    mapping: dict[str, str] = {}
    for fw_name, fw_cfg in config.get("httpClient", {}).get("frameworks", {}).items():
        for ann in fw_cfg.get("methodAnnotations", []):
            mapping[ann] = fw_name
    return mapping


def _build_implicit_consumer_pattern(config: dict) -> re.Pattern[str]:
    """Compile implicit consumer name pattern from config."""
    cfg = config.get("implicitConsumers", {})
    patterns = cfg.get("namePatterns", [])
    if not patterns:
        # Match nothing
        return re.compile(r"(?!.*)")
    combined = "|".join(patterns)
    flags = re.IGNORECASE if cfg.get("namePatternFlags", "").upper() == "IGNORECASE" else 0
    return re.compile(combined, flags)


# ---------------------------------------------------------------------------
# Utility helpers (config-independent)
# ---------------------------------------------------------------------------

def _annotation_names(annotations: list[dict] | None) -> set[str]:
    if not annotations:
        return set()
    return {a.get("name", "") for a in annotations if isinstance(a, dict)}


def _annotation_args(annotations: list[dict] | None, name: str) -> dict:
    if not annotations:
        return {}
    for a in annotations:
        if isinstance(a, dict) and a.get("name") == name:
            args = a.get("arguments", {})
            return args if isinstance(args, dict) else {}
    return {}


def _extract_javadoc_above(lines: list[str], method_line_idx: int) -> str:
    """Extract the descriptive text from a Javadoc comment above a method declaration.

    Scans upwards from method_line_idx, skipping annotations (@Override etc.),
    looking for a ``*/`` then ``/**`` block.  Returns the description portion
    (lines before any @param / @return / @throws tags), joined into a single string.
    """
    end_idx: int | None = None
    start_idx: int | None = None

    scan_from = method_line_idx - 1
    for i in range(scan_from, max(scan_from - 30, -1), -1):
        stripped = lines[i].strip()
        if stripped == "*/":
            end_idx = i
        elif stripped.startswith("/**"):
            start_idx = i
            break
        elif end_idx is None and stripped and not stripped.startswith("@") and not stripped.startswith("*"):
            break

    if start_idx is None or end_idx is None:
        return ""

    desc_parts: list[str] = []
    for i in range(start_idx, end_idx + 1):
        stripped = lines[i].strip()
        if stripped.startswith("/**"):
            stripped = stripped[3:].strip()
        elif stripped == "*/":
            continue
        elif stripped.startswith("*"):
            stripped = stripped[1:].strip()

        if stripped.startswith("@"):
            break
        if stripped:
            desc_parts.append(stripped)

    return " ".join(desc_parts)


def _extract_javadocs_from_source(
    source_path: Path, method_names: list[str],
) -> dict[str, str]:
    """Read a Java source file and extract Javadoc descriptions for the given methods."""
    if not source_path.is_file():
        return {}

    try:
        lines = source_path.read_text(encoding="utf-8").splitlines()
    except OSError:
        return {}

    result: dict[str, str] = {}
    _method_re_cache: dict[str, re.Pattern[str]] = {}

    for name in method_names:
        if name not in _method_re_cache:
            _method_re_cache[name] = re.compile(
                rf"\b{re.escape(name)}\s*\(", re.IGNORECASE,
            )
        pat = _method_re_cache[name]

        for i, line in enumerate(lines):
            if pat.search(line):
                doc = _extract_javadoc_above(lines, i)
                if doc:
                    result[name] = doc
                break

    return result


def _match_methods_to_class(
    functions: list[dict], class_method_names: list[str],
) -> list[dict]:
    """Filter functions to only those whose name appears in the class's method list.

    Falls back to returning all functions if class_method_names is empty
    (tree-sitter may not always extract the methods list).
    """
    method_set = set(class_method_names) if class_method_names else None
    methods = []
    for fn in functions:
        if not isinstance(fn, dict):
            continue
        fn_name = fn.get("name")
        if method_set is not None and fn_name not in method_set:
            continue
        params = fn.get("params", [])
        typed_params = []
        for p in params:
            if isinstance(p, dict):
                typed_params.append({
                    "name": p.get("name", "?"),
                    "type": p.get("type", "unknown"),
                })
            elif isinstance(p, str):
                typed_params.append({"name": p, "type": "unknown"})

        methods.append({
            "name": fn_name or "?",
            "params": typed_params,
            "returnType": fn.get("returnType", "void"),
            "lineRange": [fn.get("startLine", 0), fn.get("endLine", 0)],
        })
    return methods


def _load_file_results(extraction_dir: Path) -> list[dict]:
    """Load structural extraction results from merged or batched files.

    Supports two formats:
    1. Merged single file: ``extraction/structural-analysis.json``
       — dict keyed by file path, values have classes/functions/imports.
    2. Legacy batched files: ``ua-file-extract-results-*.json``
       — each contains ``{"results": [{"path", "classes", "functions", ...}]}``.

    Search order:
    1. ``extraction_dir/../intermediate/extraction/structural-analysis.json``
       (primary — standard UA layout where tmp/ and intermediate/ are siblings)
    2. ``extraction_dir/extraction/structural-analysis.json`` (legacy path)
    3. ``extraction_dir/ua-file-extract-results-*.json`` (legacy batched)
    """
    merged_candidates = [
        extraction_dir.parent / "intermediate" / "extraction" / "structural-analysis.json",
        extraction_dir / "extraction" / "structural-analysis.json",
    ]

    for merged in merged_candidates:
        if merged.is_file():
            try:
                data = json.loads(merged.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                continue
            if isinstance(data, dict):
                return [
                    {"path": fp, **file_data}
                    for fp, file_data in data.items()
                    if isinstance(file_data, dict)
                ]

    results: list[dict] = []
    for ext_file in sorted(extraction_dir.glob("ua-file-extract-results-*.json")):
        try:
            batch = json.loads(ext_file.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        batch_results = batch.get("results")
        if isinstance(batch_results, list):
            results.extend(batch_results)
    return results


def _detect_protocol_from_tags(tags: list[str], config: dict | None = None) -> str:
    """Detect RPC protocol from node tags using config's protocol map."""
    tag_set = set(tags)
    # Check protocol map from config (provider + consumer maps merged)
    if config:
        for section in ("rpcProviders", "rpcConsumers", "eventSubscribers"):
            proto_map = config.get(section, {}).get("protocolMap", {})
            for ann, proto in proto_map.items():
                if ann.lower() in tag_set:
                    return proto
    # Fallback: check common tags directly
    for tag in tag_set:
        if tag in ("moa", "dubbo", "grpc", "kafka"):
            return tag
    return "unknown"


# ---------------------------------------------------------------------------
# Main extraction: from structural-analysis / ua-file-extract-results
# ---------------------------------------------------------------------------

def extract_endpoints_from_dir(
    extraction_dir: Path, service_name: str,
    project_root: Path | None = None,
    config: dict | None = None,
) -> dict[str, Any]:
    """Read extraction results and produce a ServiceEndpointDoc dict.

    When *project_root* is provided, the extractor reads actual Java source
    files to pull Javadoc descriptions for each provider method.
    """
    cfg = config or {}
    ann_sets = _build_annotation_sets(cfg)
    provider_anns = ann_sets["provider_annotations"]
    consumer_field_anns = ann_sets["consumer_field_annotations"]
    consumer_class_anns = ann_sets["consumer_class_annotations"]
    subscriber_anns = ann_sets["subscriber_annotations"]
    protocol_map = ann_sets["protocol_map"]

    providers: list[dict] = []
    consumers: list[dict] = []
    kafka_topics: list[dict] = []
    _class_file_map: dict[str, str] = {}

    file_results = _load_file_results(extraction_dir)

    for file_result in file_results:
        file_path = file_result.get("path", "")
        classes = file_result.get("classes", [])
        functions = file_result.get("functions", [])
        if not isinstance(classes, list):
            classes = []
        if not isinstance(functions, list):
            functions = []

        for cls in classes:
            if not isinstance(cls, dict):
                continue
            cls_name = cls.get("name", "")
            if not cls_name:
                continue

            _class_file_map[cls_name] = file_path

            ann_names = _annotation_names(cls.get("annotations"))
            interfaces = cls.get("interfaces", [])
            if not isinstance(interfaces, list):
                interfaces = []

            matched_providers = ann_names & provider_anns
            if matched_providers and interfaces:
                ann_name = next(iter(matched_providers))
                protocol = protocol_map.get(ann_name, "unknown")
                ann_args = _annotation_args(cls.get("annotations"), ann_name)
                methods = _match_methods_to_class(functions, cls.get("methods", []))

                for iface in interfaces:
                    if not isinstance(iface, str) or not iface:
                        continue
                    providers.append({
                        "identifier": iface,
                        "protocol": protocol,
                        "framework": ann_name,
                        "group": ann_args.get("group"),
                        "version": ann_args.get("version"),
                        "methods": methods,
                        "sourceRef": {"file": file_path},
                    })

            matched_class_consumers = ann_names & consumer_class_anns
            if matched_class_consumers:
                ann_name = next(iter(matched_class_consumers))
                protocol = protocol_map.get(ann_name, "unknown")
                ann_args = _annotation_args(cls.get("annotations"), ann_name)
                target = (
                    ann_args.get("value")
                    or ann_args.get("name")
                    or ann_args.get("url")
                    or cls_name
                )
                consumers.append({
                    "identifier": cls_name,
                    "protocol": protocol,
                    "framework": ann_name,
                    "targetInterface": target if isinstance(target, str) else cls_name,
                    "sourceRef": {"file": file_path},
                })

            typed_props = cls.get("typedProperties", [])
            if isinstance(typed_props, list):
                for prop in typed_props:
                    if not isinstance(prop, dict):
                        continue
                    prop_anns = _annotation_names(prop.get("annotations"))
                    matched_field_consumers = prop_anns & consumer_field_anns
                    if matched_field_consumers:
                        ann_name = next(iter(matched_field_consumers))
                        protocol = protocol_map.get(ann_name, "unknown")
                        iface_name = prop.get("type", prop.get("name", "?"))
                        consumers.append({
                            "identifier": iface_name,
                            "protocol": protocol,
                            "framework": ann_name,
                            "targetInterface": iface_name,
                            "sourceRef": {"file": file_path},
                        })

        for fn in functions:
            if not isinstance(fn, dict):
                continue
            fn_anns = _annotation_names(fn.get("annotations"))
            matched_subscribers = fn_anns & subscriber_anns
            if matched_subscribers:
                for ann_name in matched_subscribers:
                    ann_args = _annotation_args(fn.get("annotations"), ann_name)
                    topics = ann_args.get("topics", ann_args.get("value", ""))
                    if isinstance(topics, str):
                        topics = [topics] if topics else []
                    elif not isinstance(topics, list):
                        topics = []
                    for topic in topics:
                        if not topic:
                            continue
                        kafka_topics.append({
                            "topic": topic,
                            "role": "subscriber",
                            "handlerMethod": fn.get("name"),
                            "sourceRef": {"file": file_path},
                        })

    provider_ids = {p["identifier"] for p in providers}
    filtered_consumers = []
    dropped_self_refs = []
    for c in consumers:
        src = c.get("sourceRef", {}).get("file", "")
        is_wrapper_module = "-wrapper-starter/" in src or "-wrapper/" in src
        if is_wrapper_module and c.get("targetInterface") in provider_ids:
            dropped_self_refs.append(
                f"{c['targetInterface']} (from {src})"
            )
            continue
        filtered_consumers.append(c)
    if dropped_self_refs:
        print(
            f"[extract-endpoints] Dropped {len(dropped_self_refs)} "
            f"self-referencing wrapper consumer(s): "
            + ", ".join(dropped_self_refs),
            file=sys.stderr,
        )

    if project_root is not None:
        _enrich_provider_descriptions(providers, _class_file_map, project_root)

    return {
        "service": service_name,
        "description": f"RPC/MQ endpoints for {service_name}",
        "providers": providers,
        "consumers": filtered_consumers,
        "kafkaTopics": kafka_topics,
    }


def _enrich_provider_descriptions(
    providers: list[dict],
    class_file_map: dict[str, str],
    project_root: Path,
) -> None:
    """Enrich provider methods with Javadoc descriptions from interface source files.

    Tries the interface source first (where Javadoc is conventionally written),
    then falls back to the implementation source.
    """
    enriched_count = 0
    for prov in providers:
        methods = prov.get("methods", [])
        if not methods:
            continue
        method_names = [m["name"] for m in methods if m.get("name")]

        javadocs: dict[str, str] = {}

        iface_name = prov["identifier"]
        iface_rel = class_file_map.get(iface_name)
        if iface_rel:
            iface_path = project_root / iface_rel
            javadocs = _extract_javadocs_from_source(iface_path, method_names)

        missing = [n for n in method_names if n not in javadocs]
        if missing:
            impl_rel = prov.get("sourceRef", {}).get("file", "")
            if impl_rel and impl_rel != iface_rel:
                impl_javadocs = _extract_javadocs_from_source(
                    project_root / impl_rel, missing,
                )
                javadocs.update(impl_javadocs)

        for m in methods:
            desc = javadocs.get(m["name"], "")
            if desc:
                m["description"] = desc
                enriched_count += 1

    if enriched_count:
        print(
            f"[extract-endpoints] Enriched {enriched_count} method(s) "
            f"with Javadoc descriptions",
            file=sys.stderr,
        )


# ---------------------------------------------------------------------------
# HTTP endpoint extraction: from knowledge graph
# ---------------------------------------------------------------------------

def extract_http_endpoints_from_kg(kg_path: Path, config: dict | None = None) -> list[dict[str, Any]]:
    """Extract client-side HTTP endpoints from a knowledge graph file.

    Reads endpoint nodes and consumes_api edges to produce httpEndpoints array.
    Resolves functionName by matching KG function nodes via (filePath, lineRange).
    No source code scanning — all data comes from the KG.
    """
    cfg = config or {}
    http_edge_types = set(cfg.get("kgEdgeTypes", {}).get("http", ["consumes_api"]))
    http_ann_map = _build_http_annotation_sets(cfg)

    try:
        kg = json.loads(kg_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return []

    nodes = kg.get("nodes", [])
    edges = kg.get("edges", [])

    endpoint_nodes: dict[str, dict] = {}
    for n in nodes:
        if isinstance(n, dict) and n.get("type") == "endpoint":
            endpoint_nodes[n["id"]] = n

    if not endpoint_nodes:
        return []

    # Build lookup: (filePath, startLine) -> functionName from KG function nodes
    fn_lookup: dict[tuple[str, int], str] = {}
    for n in nodes:
        if isinstance(n, dict) and n.get("type") == "function":
            lr = n.get("lineRange")
            fp = n.get("filePath", "")
            if fp and isinstance(lr, list) and len(lr) >= 1:
                fn_lookup[(fp, lr[0])] = n.get("name", "")

    http_endpoints: list[dict] = []
    seen: set[str] = set()

    for edge in edges:
        if not isinstance(edge, dict) or edge.get("type") not in http_edge_types:
            continue
        target_id = edge.get("target", "")
        if target_id in seen:
            continue
        seen.add(target_id)

        node = endpoint_nodes.get(target_id)
        if not node:
            continue

        desc_raw = edge.get("description", "")
        method = ""
        path = ""
        framework = ""
        try:
            desc_obj = json.loads(desc_raw) if desc_raw.startswith("{") else {}
            method = desc_obj.get("method", "")
            path = desc_obj.get("path", "")
            framework = desc_obj.get("framework", "")
        except (json.JSONDecodeError, AttributeError):
            pass

        if not method:
            name = node.get("name", "")
            parts = name.split(" ", 1)
            if len(parts) == 2:
                method, path = parts
            else:
                for prefix in ("POST-", "GET-", "PUT-", "DELETE-", "PATCH-", "HEAD-"):
                    if name.upper().startswith(prefix):
                        method = prefix[:-1]
                        path = name[len(prefix):]
                        break

        source_id = edge.get("source", "")
        source_class = source_id.split(":")[-1] if ":" in source_id else ""

        line_range = node.get("lineRange")
        file_path = node.get("filePath", "")
        source_ref: dict[str, Any] = {"file": file_path}
        if isinstance(line_range, list) and len(line_range) == 2:
            source_ref["lineRange"] = line_range

        function_name = ""
        if file_path and isinstance(line_range, list) and len(line_range) >= 1:
            function_name = fn_lookup.get((file_path, line_range[0]), "")

        # Detect framework from endpoint name/path if not set
        if not framework:
            for fw_name, ann_set in http_ann_map.items():
                if method.upper() in ann_set:
                    framework = fw_name
                    break
            if not framework:
                framework = "retrofit"

        http_endpoints.append({
            "method": method.upper(),
            "path": path,
            "framework": framework,
            "functionName": function_name,
            "sourceClass": source_class,
            "sourceRef": source_ref,
        })

    http_endpoints.sort(key=lambda e: (e.get("sourceRef", {}).get("file", ""), e["path"]))
    return http_endpoints


# ---------------------------------------------------------------------------
# HTTP endpoint extraction: from structural-analysis.json (preferred)
# ---------------------------------------------------------------------------

def extract_http_endpoints_from_structural_analysis(
    sa_path: Path, config: dict | None = None,
) -> list[dict[str, Any]]:
    """Extract HTTP endpoints from structural-analysis.json.

    This is the preferred extraction method for mobile/frontend projects because
    structural-analysis.json is produced by deterministic code parsing (not LLM),
    so it has near-100% recall for Retrofit/@GET/@POST annotations.

    Reads the 'endpoints' and 'functions' fields from each file entry.
    HTTP method annotations are resolved from config (httpClient.frameworks.*.methodAnnotations).
    """
    cfg = config or {}
    http_ann_map = _build_http_annotation_sets(cfg)
    # Flatten: set of all known HTTP method annotation names
    known_http_anns: set[str] = set()
    for fw_cfg in cfg.get("httpClient", {}).get("frameworks", {}).values():
        known_http_anns.update(fw_cfg.get("methodAnnotations", []))
    # Fallback if config is empty
    if not known_http_anns:
        known_http_anns = {"GET", "POST", "PUT", "DELETE", "PATCH", "HTTP",
                           "GetMapping", "PostMapping", "PutMapping", "DeleteMapping"}

    # Build reverse lookup: annotation name -> framework name
    ann_to_framework: dict[str, str] = {}
    for fw_name, fw_cfg in cfg.get("httpClient", {}).get("frameworks", {}).items():
        for ann in fw_cfg.get("methodAnnotations", []):
            ann_to_framework[ann] = fw_name

    try:
        sa = json.loads(sa_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return []

    if not isinstance(sa, dict):
        return []

    http_endpoints: list[dict[str, Any]] = []

    for file_path, entry in sa.items():
        if not isinstance(entry, dict):
            continue

        endpoints = entry.get("endpoints", [])
        functions = entry.get("functions", [])

        # Build function lookup: startLine -> function info
        fn_by_line: dict[int, dict] = {}
        for func in functions:
            if isinstance(func, dict):
                fn_by_line[func.get("startLine", 0)] = func

        if endpoints:
            for ep in endpoints:
                if not isinstance(ep, dict):
                    continue
                method = ep.get("method", "").upper()
                path = ep.get("path", "")
                start_line = ep.get("startLine", 0)
                end_line = ep.get("endLine", start_line)

                if not method or not path:
                    continue

                func_name = ""
                description = ""
                func = fn_by_line.get(start_line)
                if func:
                    func_name = func.get("name", "")
                    for ann in func.get("annotations", []):
                        if isinstance(ann, dict) and ann.get("name") == "description":
                            description = ann.get("arguments", "")
                            break

                source_class = Path(file_path).stem
                framework = ann_to_framework.get(method, "retrofit")

                http_endpoints.append({
                    "method": method,
                    "path": path,
                    "framework": framework,
                    "functionName": func_name,
                    "sourceClass": source_class,
                    "description": description,
                    "sourceRef": {
                        "file": file_path,
                        "lineRange": [start_line, end_line],
                    },
                })
        else:
            # Fallback: extract from functions with HTTP method annotations
            for func in functions:
                if not isinstance(func, dict):
                    continue
                annotations = func.get("annotations", [])
                for ann in annotations:
                    if not isinstance(ann, dict):
                        continue
                    ann_name = ann.get("name", "")
                    if ann_name not in known_http_anns:
                        continue

                    path = ""
                    args = ann.get("arguments", {})
                    path_arg = ann_to_framework.get(ann_name, "retrofit")
                    # Look up the path argument name from config
                    fw_cfg = cfg.get("httpClient", {}).get("frameworks", {}).get(path_arg, {})
                    path_key = fw_cfg.get("pathArgument", "value")

                    if isinstance(args, dict):
                        path = args.get(path_key, args.get("value", ""))
                    elif isinstance(args, str):
                        path = args

                    if not path:
                        continue

                    source_class = Path(file_path).stem
                    http_endpoints.append({
                        "method": ann_name,
                        "path": path,
                        "framework": path_arg,
                        "functionName": func.get("name", ""),
                        "sourceClass": source_class,
                        "sourceRef": {
                            "file": file_path,
                            "lineRange": [func.get("startLine", 0), func.get("endLine", 0)],
                        },
                    })
                    break  # One HTTP annotation per function

    http_endpoints.sort(key=lambda e: (e.get("sourceRef", {}).get("file", ""), e["path"]))
    return http_endpoints


# ---------------------------------------------------------------------------
# RPC/Event extraction: from knowledge graph edges
# ---------------------------------------------------------------------------

def extract_rpc_endpoints_from_kg(kg_path: Path, config: dict | None = None) -> dict[str, Any]:
    """Extract RPC providers/consumers and Kafka topics from KG edges.

    Reads provides_rpc, consumes_rpc, publishes, and subscribes edges
    to build endpoint records directly from the knowledge graph,
    without requiring intermediate extraction files.  Also extracts
    method-level data from KG function nodes belonging to each provider.
    """
    cfg = config or {}
    rpc_edge_types = set(cfg.get("kgEdgeTypes", {}).get("rpc", ["provides_rpc", "consumes_rpc"]))
    event_edge_types = set(cfg.get("kgEdgeTypes", {}).get("events", ["publishes", "subscribes"]))

    try:
        kg = json.loads(kg_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {"providers": [], "consumers": [], "kafkaTopics": []}

    nodes_by_id: dict[str, dict] = {}
    for n in kg.get("nodes", []):
        if isinstance(n, dict) and n.get("id"):
            nodes_by_id[n["id"]] = n

    funcs_by_file: dict[str, list[dict]] = {}
    for n in kg.get("nodes", []):
        if isinstance(n, dict) and n.get("type") == "function" and n.get("filePath"):
            funcs_by_file.setdefault(n["filePath"], []).append(n)

    providers: list[dict] = []
    consumers: list[dict] = []
    kafka_topics: list[dict] = []
    seen_edges: set[tuple[str, str, str]] = set()

    for edge in kg.get("edges", []):
        if not isinstance(edge, dict):
            continue
        etype = edge.get("type", "")
        src_id = edge.get("source", "")
        tgt_id = edge.get("target", "")
        edge_key = (src_id, tgt_id, etype)
        if edge_key in seen_edges:
            continue
        seen_edges.add(edge_key)

        src_node = nodes_by_id.get(src_id, {})
        tgt_node = nodes_by_id.get(tgt_id, {})

        if etype == "provides_rpc" and etype in rpc_edge_types:
            tgt_name = tgt_node.get("name", tgt_id.split(":")[-1])
            src_name = src_node.get("name", src_id.split(":")[-1])
            src_file = src_node.get("filePath", "")
            methods = []
            for fn in funcs_by_file.get(src_file, []):
                fn_name = fn.get("name", "")
                if fn_name and not fn_name.startswith("_"):
                    lr = fn.get("lineRange")
                    methods.append({
                        "name": fn_name,
                        "description": fn.get("summary", ""),
                        "sourceRef": {"file": src_file, "lineRange": lr} if lr else {"file": src_file},
                    })
            methods.sort(key=lambda m: m.get("sourceRef", {}).get("lineRange", [0])[0] if m.get("sourceRef", {}).get("lineRange") else 0)
            providers.append({
                "interface": tgt_name,
                "identifier": tgt_name,
                "implementor": src_name,
                "protocol": _detect_protocol_from_tags(src_node.get("tags", []), cfg),
                "methods": methods,
                "sourceRef": {"file": src_file},
            })
        elif etype == "consumes_rpc" and etype in rpc_edge_types:
            tgt_name = tgt_node.get("name", tgt_id.split(":")[-1])
            src_name = src_node.get("name", src_id.split(":")[-1])
            consumers.append({
                "interface": tgt_name,
                "identifier": tgt_name,
                "callerClass": src_name,
                "protocol": _detect_protocol_from_tags(src_node.get("tags", []), cfg),
                "sourceRef": {"file": src_node.get("filePath", "")},
            })
        elif etype in event_edge_types:
            topic_name = tgt_node.get("name", "")
            if not topic_name and ":" in tgt_id:
                topic_name = tgt_id.split(":", 1)[-1]
            src_name = src_node.get("name", src_id.split(":")[-1])
            role = "publisher" if etype == "publishes" else "subscriber"
            kafka_topics.append({
                "topic": topic_name,
                "role": role,
                "sourceClass": src_name,
                "sourceRef": {"file": src_node.get("filePath", "")},
            })

    return {"providers": providers, "consumers": consumers, "kafkaTopics": kafka_topics}


# ---------------------------------------------------------------------------
# Implicit consumer detection: from knowledge graph injects edges
# ---------------------------------------------------------------------------

def _extract_methods_from_source(source_path: Path, class_name: str) -> list[dict]:
    """Extract public/protected method signatures from a Java source file.

    Fallback when KG has no function nodes for the class.
    Uses regex to find method declarations within the class body.
    """
    if not source_path.is_file():
        return []

    try:
        lines = source_path.read_text(encoding="utf-8").splitlines()
    except OSError:
        return []

    methods: list[dict] = []
    # Match Java method declarations (public/protected/private, with return type)
    method_re = re.compile(
        r"^\s*(?:public|protected|private)\s+"
        r"(?:static\s+)?(?:final\s+)?"
        r"(\S+(?:<[^>]+>)?)\s+"  # return type
        r"(\w+)\s*\("  # method name
        r"([^)]*)"  # parameters
        r"\)"
    )

    for i, line in enumerate(lines):
        m = method_re.match(line)
        if m:
            return_type = m.group(1)
            method_name = m.group(2)
            params_str = m.group(3).strip()

            # Skip constructors (return type == class name pattern)
            if return_type == class_name:
                continue

            # Parse parameters
            params = []
            if params_str:
                for param in params_str.split(","):
                    param = param.strip()
                    parts = param.split()
                    if len(parts) >= 2:
                        params.append({"name": parts[-1], "type": " ".join(parts[:-1])})
                    elif len(parts) == 1:
                        params.append({"name": parts[0], "type": "unknown"})

            methods.append({
                "name": method_name,
                "params": params,
                "returnType": return_type,
                "sourceRef": {"file": str(source_path), "lineRange": [i + 1, i + 1]},
            })

    return methods


def _resolve_remote_calls_from_sa(
    sa_data: dict[str, Any], wrapper_file: str, wrapper_class_name: str,
) -> dict[str, set[str]]:
    """Extract remote service method calls from structural-analysis.json callGraph.

    Returns a mapping: remote_interface_name -> set of method names called.
    """
    entry = sa_data.get(wrapper_file, {})
    if not entry:
        return {}

    call_graph = entry.get("callGraph", [])
    if not call_graph:
        return {}

    # Get class methods list to identify which fields are class methods vs remote calls
    class_methods: set[str] = set()
    for cls in entry.get("classes", []):
        if cls.get("name") == wrapper_class_name:
            for m in cls.get("methods", []):
                if isinstance(m, str):
                    class_methods.add(m)
                elif isinstance(m, dict):
                    class_methods.add(m.get("name", ""))

    # Get field types from class definition (typedProperties in SA format)
    field_types: dict[str, str] = {}
    for cls in entry.get("classes", []):
        if cls.get("name") == wrapper_class_name:
            for field in cls.get("typedProperties", cls.get("fields", [])):
                if isinstance(field, dict):
                    field_types[field.get("name", "")] = field.get("type", "")

    # Parse callGraph for field.method patterns
    remote_calls: dict[str, set[str]] = defaultdict(set)
    for item in call_graph:
        callee = item.get("callee", "")
        m = re.match(r"^(\w+)\.(\w+)$", callee)
        if not m:
            continue
        field_name, method_name = m.group(1), m.group(2)
        # Must be a field (not a local variable or this.method)
        if field_name not in field_types:
            continue
        # Skip if the callee method is actually a setter/getter/builder on a DTO
        if method_name.startswith(("set", "get", "is")) and field_name[0].islower():
            type_name = field_types[field_name]
            # Only include if the field type looks like a service interface
            if "Service" not in type_name and "Moa" not in type_name and "Wrapper" not in type_name:
                continue
        iface_name = field_types[field_name]
        remote_calls[iface_name].add(method_name)

    return dict(remote_calls)


def extract_implicit_consumers_from_kg(
    kg_path: Path,
    config: dict | None = None,
    project_root: Path | None = None,
    sa_path: Path | None = None,
) -> list[dict[str, Any]]:
    """Detect implicit RPC consumers from injects edges.

    Identifies cases where a class injects an external MOA/RPC service interface
    via @Resource/@Autowired (captured as 'injects' edges in the KG) rather than
    using explicit @MoaConsumer annotations.

    When structural-analysis.json is available, resolves actual remote interface
    method calls from callGraph — creating one consumer entry per remote interface
    with the specific methods called.

    Filtering rules (from config):
    - Target must match name pattern OR have configured tags
    - Target must NOT be a local provider (no provides_rpc edge pointing to it)
    - Source-target pair must NOT already have a consumes_rpc edge
    - Target must NOT have internal class tags
    """
    cfg = config or {}
    implicit_pattern = _build_implicit_consumer_pattern(cfg)
    implicit_tags = set(cfg.get("implicitConsumers", {}).get("tags", []))
    internal_tags = set(cfg.get("internalClassTags", {}).get("tags", []))
    rpc_edge_types = set(cfg.get("kgEdgeTypes", {}).get("rpc", ["provides_rpc", "consumes_rpc"]))

    try:
        kg = json.loads(kg_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return []

    # Load structural-analysis.json for callGraph-based method resolution
    sa_data: dict[str, Any] = {}
    if sa_path and sa_path.is_file():
        try:
            sa_data = json.loads(sa_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            pass

    nodes_by_id: dict[str, dict] = {}
    for n in kg.get("nodes", []):
        if isinstance(n, dict) and n.get("id"):
            nodes_by_id[n["id"]] = n

    local_provider_targets: set[str] = set()
    explicit_consumer_pairs: set[tuple[str, str]] = set()

    for edge in kg.get("edges", []):
        if not isinstance(edge, dict):
            continue
        etype = edge.get("type", "")
        if etype == "provides_rpc" and etype in rpc_edge_types:
            local_provider_targets.add(edge.get("target", ""))
        elif etype == "consumes_rpc" and etype in rpc_edge_types:
            explicit_consumer_pairs.add(
                (edge.get("source", ""), edge.get("target", ""))
            )

    # Build file -> functions lookup for method extraction
    funcs_by_file: dict[str, list[dict]] = {}
    for n in kg.get("nodes", []):
        if isinstance(n, dict) and n.get("type") == "function" and n.get("filePath"):
            funcs_by_file.setdefault(n["filePath"], []).append(n)

    # Build class -> file lookup via contains edges AND node filePath
    class_file_map: dict[str, str] = {}
    for edge in kg.get("edges", []):
        if not isinstance(edge, dict) or edge.get("type") != "contains":
            continue
        src_node = nodes_by_id.get(edge.get("source", ""), {})
        tgt_node = nodes_by_id.get(edge.get("target", ""), {})
        if src_node.get("type") == "file" and tgt_node.get("type") == "class":
            class_file_map[edge["target"]] = src_node.get("filePath", src_node.get("name", ""))
    # Fallback: use node's own filePath
    for nid, node in nodes_by_id.items():
        if node.get("type") == "class" and node.get("filePath") and nid not in class_file_map:
            class_file_map[nid] = node["filePath"]

    implicit_consumers: list[dict] = []
    seen: set[tuple[str, str]] = set()

    for edge in kg.get("edges", []):
        if not isinstance(edge, dict) or edge.get("type") != "injects":
            continue
        src_id = edge.get("source", "")
        tgt_id = edge.get("target", "")

        if (src_id, tgt_id) in seen:
            continue
        seen.add((src_id, tgt_id))

        if (src_id, tgt_id) in explicit_consumer_pairs:
            continue

        if tgt_id in local_provider_targets:
            continue

        tgt_node = nodes_by_id.get(tgt_id, {})
        tgt_name = tgt_node.get("name", tgt_id.split(":")[-1])
        tgt_tags = set(tgt_node.get("tags", []))

        if tgt_tags & internal_tags:
            continue

        is_rpc_by_name = bool(implicit_pattern.search(tgt_name))
        is_rpc_by_tags = bool(tgt_tags & implicit_tags)

        if not is_rpc_by_name and not is_rpc_by_tags:
            continue

        src_node = nodes_by_id.get(src_id, {})
        src_name = src_node.get("name", src_id.split(":")[-1])

        # Resolve protocol from target node tags and file context
        protocol = _detect_protocol_from_tags(list(tgt_tags), cfg)
        if protocol == "unknown":
            # Check file path for protocol hints
            tgt_file = tgt_node.get("filePath", "")
            if "moa" in tgt_file.lower() or "wrapper" in tgt_file.lower():
                protocol = "moa"

        tgt_file = class_file_map.get(tgt_id, tgt_node.get("filePath", ""))

        # Try SA callGraph first: resolve per-remote-interface method calls
        if sa_data and tgt_file:
            remote_calls = _resolve_remote_calls_from_sa(sa_data, tgt_file, tgt_name)
            if remote_calls:
                # Detect framework from protocol
                framework_map = {"moa": "MoaProvider", "dubbo": "DubboService", "grpc": "GrpcService", "http": "FeignClient"}
                framework = framework_map.get(protocol, protocol)
                for iface_name, method_names in remote_calls.items():
                    if not method_names:
                        continue
                    methods_list = [{"name": mn} for mn in sorted(method_names)]
                    implicit_consumers.append({
                        "identifier": iface_name,
                        "targetInterface": iface_name,
                        "callerClass": src_name,
                        "protocol": protocol,
                        "framework": framework,
                        "methods": methods_list,
                        "evidence": "implicit-inject-sa",
                        "sourceRef": {"file": src_node.get("filePath", "")},
                    })
                continue

        # Fallback: extract methods from the wrapper class itself
        methods: list[dict] = []
        if tgt_file:
            # Try KG function nodes first
            for fn in funcs_by_file.get(tgt_file, []):
                fn_name = fn.get("name", "")
                if fn_name and not fn_name.startswith("_"):
                    lr = fn.get("lineRange")
                    methods.append({
                        "name": fn_name,
                        "description": fn.get("summary", ""),
                        "sourceRef": {"file": tgt_file, "lineRange": lr} if lr else {"file": tgt_file},
                    })
            # Fallback: read source file directly when KG has no function nodes
            if not methods and project_root is not None:
                methods = _extract_methods_from_source(project_root / tgt_file, tgt_name)
            methods.sort(
                key=lambda m: m.get("sourceRef", {}).get("lineRange", [0])[0]
                if m.get("sourceRef", {}).get("lineRange") else 0
            )

        framework_map = {"moa": "MoaProvider", "dubbo": "DubboService", "grpc": "GrpcService", "http": "FeignClient"}
        consumer_entry: dict[str, Any] = {
            "identifier": tgt_name,
            "targetInterface": tgt_name,
            "callerClass": src_name,
            "protocol": protocol,
            "framework": framework_map.get(protocol, protocol),
            "evidence": "implicit-inject",
            "sourceRef": {"file": src_node.get("filePath", "")},
        }
        if methods:
            consumer_entry["methods"] = methods
        implicit_consumers.append(consumer_entry)

    return implicit_consumers


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(
        description="Extract RPC/MQ/HTTP endpoint metadata from file extraction results",
    )
    parser.add_argument("extraction_dir", help="Directory containing ua-file-extract-results-*.json")
    parser.add_argument("service_name", help="Name of the service being analyzed")
    parser.add_argument("--output", required=True, help="Output JSON file path")
    parser.add_argument(
        "--project-root",
        help="Project root directory for reading source files (enables Javadoc extraction)",
    )
    parser.add_argument(
        "--knowledge-graph",
        help="Path to knowledge-graph.json for client-side HTTP endpoint extraction",
    )
    parser.add_argument(
        "--structural-analysis",
        help="Path to structural-analysis.json (preferred for mobile/frontend HTTP endpoints)",
    )
    parser.add_argument(
        "--config",
        help="Path to endpoint-annotations.json config file (default: auto-detect alongside script)",
    )
    args = parser.parse_args()

    # Load annotation configuration
    config_path = Path(args.config) if args.config else None
    config = load_annotation_config(config_path)
    print(
        f"[extract-endpoints] Loaded config with "
        f"{len(config.get('rpcProviders', {}).get('annotations', []))} provider annotations, "
        f"{sum(len(v.get('methodAnnotations', [])) for v in config.get('httpClient', {}).get('frameworks', {}).values())} HTTP method annotations",
        file=sys.stderr,
    )

    proj_root = Path(args.project_root) if args.project_root else None
    result = extract_endpoints_from_dir(
        Path(args.extraction_dir), args.service_name,
        project_root=proj_root, config=config,
    )

    # HTTP endpoint extraction: prefer structural-analysis.json over KG
    sa_path = Path(args.structural_analysis) if args.structural_analysis else None
    kg_path = Path(args.knowledge_graph) if args.knowledge_graph else None

    # Auto-detect structural-analysis.json if not explicitly provided
    if sa_path is None:
        for candidate in [
            Path(args.extraction_dir).parent / "intermediate" / "extraction" / "structural-analysis.json",
            Path(args.extraction_dir) / "extraction" / "structural-analysis.json",
        ]:
            if candidate.is_file():
                sa_path = candidate
                break

    # Try structural-analysis first (deterministic, high recall)
    if sa_path and sa_path.is_file():
        http_eps = extract_http_endpoints_from_structural_analysis(sa_path, config)
        if http_eps:
            result["httpEndpoints"] = http_eps
            print(
                f"[extract-endpoints] Extracted {len(http_eps)} HTTP endpoints "
                f"from structural-analysis.json",
                file=sys.stderr,
            )

    # Fall back to KG-based extraction (requires consumes_api edges)
    if not result.get("httpEndpoints") and kg_path:
        http_eps = extract_http_endpoints_from_kg(kg_path, config)
        if http_eps:
            result["httpEndpoints"] = http_eps

    # RPC/Event extraction from KG (backend only)
    if kg_path:
        if not result["providers"] and not result["consumers"] and not result["kafkaTopics"]:
            kg_result = extract_rpc_endpoints_from_kg(kg_path, config)
            result["providers"] = kg_result["providers"]
            result["consumers"] = kg_result["consumers"]
            result["kafkaTopics"] = kg_result["kafkaTopics"]

        implicit = extract_implicit_consumers_from_kg(kg_path, config, project_root=proj_root, sa_path=sa_path)
        if implicit:
            existing_ids = {c.get("identifier") for c in result["consumers"]}
            for ic in implicit:
                if ic["identifier"] not in existing_ids:
                    result["consumers"].append(ic)
                    existing_ids.add(ic["identifier"])

    Path(args.output).parent.mkdir(parents=True, exist_ok=True)
    Path(args.output).write_text(
        json.dumps(result, indent=2, ensure_ascii=False), encoding="utf-8"
    )

    http_count = len(result.get("httpEndpoints", []))
    implicit_count = sum(1 for c in result.get("consumers", []) if c.get("evidence") == "implicit-inject")
    print(f"Extracted {len(result['providers'])} providers, "
          f"{len(result['consumers'])} consumers"
          f"{f' ({implicit_count} implicit)' if implicit_count else ''}, "
          f"{len(result['kafkaTopics'])} kafka topics"
          f"{f', {http_count} HTTP endpoints' if http_count else ''}"
          f" for {args.service_name}")
