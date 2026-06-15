#!/usr/bin/env python3
"""
Batch Dispatch Planner for /understand Phase 2.

Two modes:
  --plan:     Compute context-aware LPT fusion groups from batches.json
  --validate: Check per-batch output quality after subagent dispatch

Usage:
    python batch-dispatch-planner.py --plan <project-root>
    python batch-dispatch-planner.py --validate <project-root>
"""

import json
import math
import os
import sys
import argparse
from pathlib import Path
from typing import Any


# ── Quality-level presets ───────────────────────────────────────────────
#
# Each preset trades throughput for output quality by adjusting context
# utilisation.  "balanced" is the default and works well for most projects.
#
#   high     – 40 % utilisation → fewest files per group, best descriptions
#   balanced – 50 % utilisation → recommended default
#   fast     – 64 % utilisation → legacy behaviour, speed over quality
#
QUALITY_PRESETS: dict[str, dict[str, int]] = {
    "high": {
        "context_budget": 80_000,
        "base_tokens":    30_000,
        "token_per_loc":  4,
        "token_per_file": 1_000,
    },
    "balanced": {
        "context_budget": 100_000,
        "base_tokens":    25_000,
        "token_per_loc":  4,
        "token_per_file": 800,
    },
    "fast": {
        "context_budget": 128_000,
        "base_tokens":    10_000,
        "token_per_loc":  4,
        "token_per_file": 500,
    },
}

DEFAULT_QUALITY = "balanced"

MAX_FILE_LINES = 5_000     # files exceeding this are capped in LOC estimation
MIN_GROUPS     = 3         # minimum parallelism
MAX_CONCURRENT = 10        # platform constraint


def _get_params(quality: str) -> dict[str, int]:
    return QUALITY_PRESETS.get(quality, QUALITY_PRESETS[DEFAULT_QUALITY])


def estimate_tokens(loc: int, file_count: int, params: dict[str, int]) -> int:
    return loc * params["token_per_loc"] + file_count * params["token_per_file"]


# ── Plan mode: Context-Aware LPT Fusion ────────────────────────────────

def compute_plan(project_root: str, quality: str = DEFAULT_QUALITY) -> dict:
    batches_path = os.path.join(
        project_root, ".understand-anything", "intermediate", "batches.json"
    )
    if not os.path.isfile(batches_path):
        return {"error": f"batches.json not found at {batches_path}"}

    data = json.load(open(batches_path, encoding="utf-8"))
    batches = data.get("batches", [])
    if not batches:
        return {"error": "No batches found in batches.json"}

    params = _get_params(quality)
    context_budget = params["context_budget"]
    base_tokens = params["base_tokens"]

    oversized_files_capped = 0
    batch_info = []
    for b in batches:
        files = b.get("files", b.get("batchFiles", []))
        loc = 0
        for f in files:
            file_loc = f.get("sizeLines", 0)
            if file_loc > MAX_FILE_LINES:
                oversized_files_capped += 1
                file_loc = MAX_FILE_LINES
            loc += file_loc
        tokens = estimate_tokens(loc, len(files), params)
        batch_info.append({
            "batchIndex": b["batchIndex"],
            "loc": loc,
            "files": len(files),
            "tokens": tokens,
        })

    total_tokens = sum(bi["tokens"] for bi in batch_info)
    per_group_budget = context_budget - base_tokens

    target_groups = max(MIN_GROUPS, math.ceil(total_tokens / per_group_budget))
    target_groups = min(target_groups, len(batch_info))

    sorted_batches = sorted(batch_info, key=lambda x: -x["tokens"])
    groups: list[dict[str, Any]] = [
        {"indices": [], "loc": 0, "files": 0, "tokens": 0}
        for _ in range(target_groups)
    ]

    for bi in sorted_batches:
        best = min(groups, key=lambda g: (g["tokens"], g["files"]))
        best["indices"].append(bi["batchIndex"])
        best["loc"] += bi["loc"]
        best["files"] += bi["files"]
        best["tokens"] += bi["tokens"]

    for g in groups:
        g["indices"].sort()
    groups = [g for g in groups if g["indices"]]

    oversized = []
    for g in groups:
        total = g["tokens"] + base_tokens
        if total > context_budget:
            oversized.append({
                "indices": g["indices"],
                "estimatedTokens": total,
                "budget": context_budget,
            })

    fusion_groups = []
    for i, g in enumerate(groups):
        fusion_groups.append({
            "groupIndex": i,
            "batchIndices": g["indices"],
            "totalLoc": g["loc"],
            "totalFiles": g["files"],
            "estimatedTokens": g["tokens"] + base_tokens,
            "budgetUsage": round((g["tokens"] + base_tokens) / context_budget * 100, 1),
        })

    plan = {
        "totalBatches": len(batch_info),
        "totalFiles": sum(bi["files"] for bi in batch_info),
        "totalLoc": sum(bi["loc"] for bi in batch_info),
        "totalEstimatedTokens": total_tokens,
        "oversizedFilesCapped": oversized_files_capped,
        "maxFileLines": MAX_FILE_LINES,
        "contextBudget": context_budget,
        "qualityLevel": quality,
        "targetGroups": target_groups,
        "actualGroups": len(groups),
        "wavesNeeded": math.ceil(len(groups) / MAX_CONCURRENT),
        "fusionGroups": fusion_groups,
        "oversizedGroups": oversized,
        "params": {
            "contextBudget": context_budget,
            "baseTokens": base_tokens,
            "tokenPerLoc": params["token_per_loc"],
            "tokenPerFile": params["token_per_file"],
            "qualityLevel": quality,
            "minGroups": MIN_GROUPS,
            "maxConcurrent": MAX_CONCURRENT,
        },
    }

    out_dir = os.path.join(project_root, ".understand-anything", "tmp")
    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, "dispatch-plan.json")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(plan, f, indent=2, ensure_ascii=False)

    return plan


# ── Validate mode: Per-batch quality gate ──────────────────────────────

NODE_COVERAGE_THRESHOLD  = 0.8   # ≥80% of batch files should have a file-level node
EDGE_RATIO_THRESHOLD     = 0.3   # ≥30% of node count
DESC_COVERAGE_THRESHOLD  = 0.5   # ≥50% of file nodes should have descriptions


def validate_batches(project_root: str) -> dict:
    batches_path = os.path.join(
        project_root, ".understand-anything", "intermediate", "batches.json"
    )
    if not os.path.isfile(batches_path):
        return {"error": f"batches.json not found at {batches_path}"}

    data = json.load(open(batches_path, encoding="utf-8"))
    batches = data.get("batches", [])
    if not batches:
        return {"error": "No batches found"}

    intermediate_dir = os.path.join(
        project_root, ".understand-anything", "intermediate"
    )

    results = []
    retry_batches = []

    for b in batches:
        idx = b["batchIndex"]
        files = b.get("files", b.get("batchFiles", []))
        expected_files = len(files)

        batch_path = os.path.join(intermediate_dir, f"batch-{idx}.json")

        # Check for split-mode parts
        part_paths = sorted(
            Path(intermediate_dir).glob(f"batch-{idx}-part-*.json")
        )

        batch_data = None
        source = ""

        if os.path.isfile(batch_path):
            try:
                batch_data = json.load(open(batch_path, encoding="utf-8"))
                source = f"batch-{idx}.json"
            except (json.JSONDecodeError, OSError):
                pass

        if batch_data is None and part_paths:
            merged_nodes = []
            merged_edges = []
            for pp in part_paths:
                try:
                    part = json.load(open(pp, encoding="utf-8"))
                    merged_nodes.extend(part.get("nodes", []))
                    merged_edges.extend(part.get("edges", []))
                except (json.JSONDecodeError, OSError):
                    continue
            if merged_nodes:
                batch_data = {"nodes": merged_nodes, "edges": merged_edges}
                source = f"batch-{idx}-part-*.json ({len(part_paths)} parts)"

        if batch_data is None:
            results.append({
                "batchIndex": idx,
                "verdict": "fail",
                "reason": "output file missing or invalid",
                "expectedFiles": expected_files,
            })
            retry_batches.append(idx)
            continue

        nodes = batch_data.get("nodes", [])
        edges = batch_data.get("edges", [])

        file_nodes = [
            n for n in nodes
            if n.get("type") in ("file", "config", "document", "service",
                                  "pipeline", "table", "schema", "resource",
                                  "endpoint")
        ]

        node_count = len(nodes)
        file_node_count = len(file_nodes)
        edge_count = len(edges)

        desc_count = sum(
            1 for n in file_nodes
            if (n.get("description") and len(str(n["description"])) > 10)
            or (n.get("summary") and len(str(n["summary"])) > 10)
        )

        node_coverage = file_node_count / expected_files if expected_files > 0 else 0
        edge_ratio = edge_count / node_count if node_count > 0 else 0
        desc_coverage = desc_count / file_node_count if file_node_count > 0 else 0

        issues = []
        if node_coverage < NODE_COVERAGE_THRESHOLD:
            issues.append(
                f"Low file node coverage: {file_node_count}/{expected_files} "
                f"({node_coverage:.0%}, need ≥{NODE_COVERAGE_THRESHOLD:.0%})"
            )
        if edge_ratio < EDGE_RATIO_THRESHOLD:
            issues.append(
                f"Low edge ratio: {edge_count}/{node_count} "
                f"({edge_ratio:.0%}, need ≥{EDGE_RATIO_THRESHOLD:.0%})"
            )
        if desc_coverage < DESC_COVERAGE_THRESHOLD:
            issues.append(
                f"Low description coverage: {desc_count}/{file_node_count} "
                f"({desc_coverage:.0%}, need ≥{DESC_COVERAGE_THRESHOLD:.0%})"
            )

        if issues:
            verdict = "fail" if node_coverage < 0.5 else "warn"
        else:
            verdict = "pass"

        results.append({
            "batchIndex": idx,
            "verdict": verdict,
            "source": source,
            "expectedFiles": expected_files,
            "nodeCount": node_count,
            "fileNodeCount": file_node_count,
            "edgeCount": edge_count,
            "nodeCoverage": round(node_coverage, 3),
            "edgeRatio": round(edge_ratio, 3),
            "descCoverage": round(desc_coverage, 3),
            "issues": issues,
        })

        if verdict == "fail":
            retry_batches.append(idx)

    passed = sum(1 for r in results if r["verdict"] == "pass")
    warned = sum(1 for r in results if r["verdict"] == "warn")
    failed = sum(1 for r in results if r["verdict"] == "fail")

    validation = {
        "results": results,
        "summary": {
            "total": len(results),
            "passed": passed,
            "warned": warned,
            "failed": failed,
        },
        "retryBatches": retry_batches,
    }

    out_dir = os.path.join(project_root, ".understand-anything", "tmp")
    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, "batch-validation.json")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(validation, f, indent=2, ensure_ascii=False)

    return validation


# ── CLI ────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="Batch dispatch planner for /understand Phase 2"
    )
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--plan", action="store_true",
                       help="Compute fusion groups from batches.json")
    group.add_argument("--validate", action="store_true",
                       help="Validate batch output quality")
    parser.add_argument("--quality", choices=list(QUALITY_PRESETS.keys()),
                        default=DEFAULT_QUALITY,
                        help=f"Quality level preset (default: {DEFAULT_QUALITY})")
    parser.add_argument("project_root",
                        help="Absolute path to project root directory")
    args = parser.parse_args()

    if args.plan:
        result = compute_plan(args.project_root, quality=args.quality)
        if "error" in result:
            print(f"Error: {result['error']}", file=sys.stderr)
            sys.exit(1)

        print(f"Dispatch plan computed (quality={args.quality}).")
        print(f"  Batches: {result['totalBatches']}")
        print(f"  Files: {result['totalFiles']}")
        if result.get("oversizedFilesCapped"):
            print(f"  Oversized files capped (>{MAX_FILE_LINES} LOC): "
                  f"{result['oversizedFilesCapped']}")
        print(f"  Total LOC: {result['totalLoc']:,}")
        print(f"  Estimated tokens: {result['totalEstimatedTokens']:,}")
        print(f"  Fusion groups: {result['actualGroups']} "
              f"(from {result['totalBatches']} batches)")
        print(f"  Waves needed: {result['wavesNeeded']} "
              f"(max {MAX_CONCURRENT} concurrent)")

        for fg in result["fusionGroups"]:
            indices = ",".join(str(i) for i in fg["batchIndices"])
            print(f"    Group {fg['groupIndex']}: "
                  f"batches=[{indices}] "
                  f"files={fg['totalFiles']} "
                  f"LOC={fg['totalLoc']:,} "
                  f"budget={fg['budgetUsage']}%")

        if result["oversizedGroups"]:
            print(f"\n  WARNING: {len(result['oversizedGroups'])} group(s) "
                  f"exceed context budget!", file=sys.stderr)
            for og in result["oversizedGroups"]:
                print(f"    Batches {og['indices']}: "
                      f"{og['estimatedTokens']:,} > {og['budget']:,} tokens",
                      file=sys.stderr)

        out_path = os.path.join(
            args.project_root, ".understand-anything", "tmp", "dispatch-plan.json"
        )
        print(f"\n  Written to: {out_path}")

    elif args.validate:
        result = validate_batches(args.project_root)
        if "error" in result:
            print(f"Error: {result['error']}", file=sys.stderr)
            sys.exit(1)

        s = result["summary"]
        print(f"Batch validation complete.")
        print(f"  Total: {s['total']}, "
              f"Passed: {s['passed']}, "
              f"Warned: {s['warned']}, "
              f"Failed: {s['failed']}")

        for r in result["results"]:
            if r["verdict"] != "pass":
                issues_str = "; ".join(r.get("issues", []))
                print(f"  Batch {r['batchIndex']}: {r['verdict']} — {issues_str}")

        if result["retryBatches"]:
            print(f"\n  Retry needed for batches: {result['retryBatches']}")

        out_path = os.path.join(
            args.project_root, ".understand-anything", "tmp",
            "batch-validation.json"
        )
        print(f"\n  Written to: {out_path}")

        if s["failed"] > 0:
            sys.exit(2)


if __name__ == "__main__":
    main()
