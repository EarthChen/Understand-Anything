#!/usr/bin/env python3
"""
Validate a knowledge-graph.json produced by the understand-knowledge skill.

Checks:
  1. Required node fields: id, type, name, summary, tags, complexity
  2. Non-empty summary for every node
  3. Valid node types
  4. Every edge source/target references an existing node
  5. Valid edge types
  6. No duplicate node IDs

Usage:
    python validate-knowledge-graph.py <wiki-directory> [--fix]

    --fix   Automatically remove invalid edges and write a corrected file.

Exit codes:
    0  All checks passed (or --fix applied successfully)
    1  Validation errors found (without --fix)
    2  File not found or parse error
"""

import json
import sys
from pathlib import Path

VALID_NODE_TYPES = {
    "article", "entity", "topic", "claim", "source",
    "requirement", "testcase",
    "file", "function", "class", "module", "concept",
    "config", "document", "service", "table", "endpoint",
    "pipeline", "schema", "resource", "domain", "flow", "step",
}

VALID_EDGE_TYPES = {
    "cites", "contradicts", "builds_on", "exemplifies",
    "categorized_under", "authored_by", "related", "similar_to",
    "imports", "exports", "contains", "inherits", "implements",
    "calls", "subscribes", "publishes", "middleware",
    "provides_rpc", "consumes_rpc", "injects",
    "reads_from", "writes_to", "transforms", "validates",
    "depends_on", "tested_by", "configures",
    "deploys", "serves", "provisions", "triggers",
    "migrates", "documents", "routes", "defines_schema",
    "contains_flow", "flow_step", "cross_domain",
}

REQUIRED_NODE_FIELDS = {"id", "type", "name", "summary", "tags", "complexity"}


def validate(graph: dict) -> tuple[list[str], list[str], dict]:
    """Return (errors, warnings, stats)."""
    errors: list[str] = []
    warnings: list[str] = []

    nodes = graph.get("nodes", [])
    edges = graph.get("edges", [])
    node_ids = set()
    dup_ids: list[str] = []

    for i, node in enumerate(nodes):
        nid = node.get("id", f"<missing-id-{i}>")

        if nid in node_ids:
            dup_ids.append(nid)
        node_ids.add(nid)

        missing = REQUIRED_NODE_FIELDS - set(node.keys())
        if missing:
            errors.append(f"Node '{nid}': missing fields {sorted(missing)}")

        summary = node.get("summary", "")
        if not isinstance(summary, str) or not summary.strip():
            warnings.append(f"Node '{nid}': empty or missing summary")

        ntype = node.get("type", "")
        if ntype and ntype not in VALID_NODE_TYPES:
            warnings.append(f"Node '{nid}': unknown type '{ntype}'")

    dangling: list[int] = []
    invalid_type: list[int] = []
    for i, edge in enumerate(edges):
        src = edge.get("source", "")
        tgt = edge.get("target", "")
        if src not in node_ids or tgt not in node_ids:
            dangling.append(i)
            ref = src if src not in node_ids else tgt
            errors.append(f"Edge {i} ({src} -> {tgt}): dangling reference '{ref}'")

        etype = edge.get("type", "")
        if etype and etype not in VALID_EDGE_TYPES:
            invalid_type.append(i)
            warnings.append(f"Edge {i} ({src} -> {tgt}): invalid type '{etype}'")

    if dup_ids:
        errors.append(f"Duplicate node IDs: {dup_ids}")

    stats = {
        "nodes": len(nodes),
        "edges": len(edges),
        "dangling_edges": len(dangling),
        "invalid_type_edges": len(invalid_type),
        "duplicate_ids": len(dup_ids),
        "empty_summaries": sum(1 for w in warnings if "empty or missing summary" in w),
    }
    return errors, warnings, stats


def fix_graph(graph: dict) -> dict:
    """Return a new graph with dangling/invalid-type edges removed."""
    node_ids = {n["id"] for n in graph.get("nodes", []) if "id" in n}
    clean_edges = [
        e for e in graph.get("edges", [])
        if e.get("source") in node_ids
        and e.get("target") in node_ids
        and e.get("type", "") in VALID_EDGE_TYPES
    ]
    return {**graph, "edges": clean_edges}


def main() -> int:
    if len(sys.argv) < 2:
        print("Usage: python validate-knowledge-graph.py <wiki-directory> [--fix]", file=sys.stderr)
        return 2

    target = Path(sys.argv[1])
    do_fix = "--fix" in sys.argv

    kg_path = target / ".understand-anything" / "knowledge-graph.json"
    if not kg_path.exists():
        print(f"ERROR: {kg_path} not found", file=sys.stderr)
        return 2

    try:
        graph = json.loads(kg_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as exc:
        print(f"ERROR: cannot parse {kg_path}: {exc}", file=sys.stderr)
        return 2

    errors, warnings, stats = validate(graph)

    print(f"=== Knowledge Graph Validation ===")
    print(f"Nodes: {stats['nodes']}, Edges: {stats['edges']}")
    print(f"Dangling edges: {stats['dangling_edges']}")
    print(f"Invalid-type edges: {stats['invalid_type_edges']}")
    print(f"Duplicate IDs: {stats['duplicate_ids']}")
    print(f"Empty summaries: {stats['empty_summaries']}")
    print()

    if warnings:
        print(f"--- Warnings ({len(warnings)}) ---")
        for w in warnings[:20]:
            print(f"  WARN: {w}")
        if len(warnings) > 20:
            print(f"  ... and {len(warnings) - 20} more")
        print()

    if errors:
        print(f"--- Errors ({len(errors)}) ---")
        for e in errors[:20]:
            print(f"  ERROR: {e}")
        if len(errors) > 20:
            print(f"  ... and {len(errors) - 20} more")
        print()

    if not errors and not warnings:
        print("PASSED: all checks OK")
        return 0

    if do_fix:
        fixed = fix_graph(graph)
        removed = stats["dangling_edges"] + stats["invalid_type_edges"]
        kg_path.write_text(json.dumps(fixed, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"FIXED: removed {removed} invalid edges, saved to {kg_path}")
        return 0

    if errors:
        print("FAILED: run with --fix to auto-remove invalid edges")
        return 1

    print("PASSED with warnings (no structural errors)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
