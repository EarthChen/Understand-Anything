#!/usr/bin/env python3
"""Wiki Domain Diff — Compare old vs new domain-graph.json to identify changed domains.

Usage:
    python3 wiki_diff_domains.py --old <path> --new <path> [--kg <path>]

Output (JSON to stdout):
    { "added": [...], "removed": [...], "modified": [...], "unchanged": [...],
      "serviceOverviewDirty": bool, "crossServiceDirty": bool, "summary": "..." }
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


def load_json(path: str) -> dict:
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def extract_domains(dg: dict) -> dict[str, dict]:
    """Extract domain nodes and their associated flows/steps structure."""
    domains: dict[str, dict] = {}
    edges = dg.get("edges", [])

    for node in dg.get("nodes", []):
        if node.get("type") == "domain":
            domains[node["id"]] = {
                "name": node.get("name", ""),
                "flow_ids": set(),
                "step_ids": set(),
            }

    for edge in edges:
        if edge.get("type") == "contains_flow":
            src = edge["source"]
            tgt = edge["target"]
            if src in domains:
                domains[src]["flow_ids"].add(tgt)
        elif edge.get("type") == "flow_step":
            src = edge["source"]
            tgt = edge["target"]
            for d in domains.values():
                if src in d["flow_ids"]:
                    d["step_ids"].add(tgt)

    return domains


def diff_domain_graphs(old_dg: dict, new_dg: dict, kg: dict | None = None) -> dict:
    """Compare two domain graphs and classify each domain.

    Returns dict with keys: added, removed, modified, unchanged,
    serviceOverviewDirty, crossServiceDirty, summary.
    """
    old_domains = extract_domains(old_dg)
    new_domains = extract_domains(new_dg)

    old_ids = set(old_domains.keys())
    new_ids = set(new_domains.keys())

    added = sorted(new_ids - old_ids)
    removed = sorted(old_ids - new_ids)
    common = old_ids & new_ids

    modified = []
    unchanged = []

    for did in sorted(common):
        old_d = old_domains[did]
        new_d = new_domains[did]
        if old_d["flow_ids"] != new_d["flow_ids"] or old_d["step_ids"] != new_d["step_ids"]:
            modified.append(did)
        else:
            unchanged.append(did)

    service_overview_dirty = bool(added or removed)

    cross_service_dirty = False
    if kg is not None:
        rpc_edges = [
            e for e in kg.get("edges", [])
            if e.get("type") in ("provides_rpc", "consumes_rpc")
        ]
        cross_service_dirty = len(rpc_edges) > 0

    summary = f"{len(modified)} modified, {len(added)} added, {len(removed)} removed, {len(unchanged)} unchanged"

    return {
        "added": added,
        "removed": removed,
        "modified": modified,
        "unchanged": unchanged,
        "serviceOverviewDirty": service_overview_dirty,
        "crossServiceDirty": cross_service_dirty,
        "summary": summary,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Wiki domain diff")
    parser.add_argument("--old", required=True, help="Path to old domain-graph snapshot")
    parser.add_argument("--new", required=True, help="Path to new domain-graph.json")
    parser.add_argument("--kg", default=None, help="Path to knowledge-graph.json (for RPC edge detection)")
    args = parser.parse_args()

    old_dg = load_json(args.old)
    new_dg = load_json(args.new)
    kg = load_json(args.kg) if args.kg else None

    result = diff_domain_graphs(old_dg, new_dg, kg)
    json.dump(result, sys.stdout, indent=2)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
