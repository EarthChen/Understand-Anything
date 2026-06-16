#!/usr/bin/env python3
"""Wiki Completeness Verifier.

Run after wiki generation to verify all expected output files are present.
Designed as a mandatory Phase 5 gate — prevents "silent skip" of pipeline steps.

Usage:
    python3 verify-wiki-completeness.py <service-root> [--mode=single|batch] [--repo-type=backend|mobile|frontend] [--parent-root=<path>]

Exit codes:
    0 = All checks passed
    1 = Missing required files (MUST fix before reporting completion)
    2 = Missing optional files (WARN only)
"""
import argparse
import json
import sys
from pathlib import Path


def check_service_wiki(service_root: Path, repo_type: str) -> tuple[list, list]:
    """Check completeness of a single service's wiki output."""
    errors = []
    warnings = []
    wiki_dir = service_root / ".understand-anything" / "wiki"

    required_files = {
        "service.json": "Phase 1 (wiki-worker output)",
        "meta.json": "Phase 2 Script 3 (assemble-wiki.py)",
        "index.json": "Phase 2 Script 2 (build-wiki-index.py)",
    }

    for fname, source in required_files.items():
        fpath = wiki_dir / fname
        if not fpath.exists():
            errors.append(f"MISSING {fname} — produced by {source}")
        elif fpath.stat().st_size == 0:
            errors.append(f"EMPTY {fname} — produced by {source}")

    domains_dir = wiki_dir / "domains"
    if not domains_dir.exists() or not list(domains_dir.glob("*.json")):
        errors.append("MISSING domains/*.json — produced by Phase 1 (wiki-worker) + Phase 2 Script 3 (assemble-wiki.py)")
    else:
        dg_path = service_root / ".understand-anything" / "domain-graph.json"
        if dg_path.exists():
            try:
                dg = json.loads(dg_path.read_text(encoding="utf-8"))
            except (json.JSONDecodeError, OSError) as e:
                errors.append(f"ERROR: Invalid domain-graph.json: {e}")
            else:
                expected = {
                    n["id"].replace("domain:", "")
                    for n in dg.get("nodes", [])
                    if n.get("type") == "domain"
                }
                actual = {f.stem for f in domains_dir.glob("*.json")}
                missing = expected - actual
                if missing:
                    errors.append(
                        f"MISSING domain pages: {', '.join(sorted(missing))} — "
                        f"expected {len(expected)}, found {len(actual)}"
                    )

    meta_path = wiki_dir / "meta.json"
    if meta_path.exists():
        try:
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError) as e:
            errors.append(f"ERROR: Invalid meta.json: {e}")
        else:
            cov = meta.get("sourceRefCoverage", {})
            pct = cov.get("coveragePercent", 0)
            if pct < 80:
                warnings.append(f"Low sourceRef coverage: {pct}% (target: ≥80%)")

    inter_dir = service_root / ".understand-anything" / "intermediate" / "wiki"
    validation_report = inter_dir.parent / "wiki-validation-report.json"
    if not validation_report.exists():
        vr_alt = inter_dir / "wiki-validation-report.json"
        if not vr_alt.exists():
            warnings.append(
                "NO schema validation report found — "
                "Phase 2 Script 1 (validate-wiki-schema.mjs) may not have run"
            )

    return errors, warnings


def check_parent_wiki(parent_root: Path, repo_type: str) -> tuple[list, list]:
    """Check completeness of parent-level wiki output (batch mode)."""
    errors = []
    warnings = []
    wiki_dir = parent_root / ".understand-anything" / "wiki"

    required_files = {
        "index.json": "Phase 4 (parent index construction)",
        "meta.json": "Phase 4 (parent meta construction)",
        "overview.json": "Phase 3 Step 4 (LLM parent wiki generation)",
        "architecture.json": "Phase 3 Step 4 (LLM parent wiki generation)",
    }

    for fname, source in required_files.items():
        fpath = wiki_dir / fname
        if not fpath.exists():
            errors.append(f"MISSING parent {fname} — produced by {source}")
        elif fpath.stat().st_size == 0:
            errors.append(f"EMPTY parent {fname} — produced by {source}")

    cross_domains = wiki_dir / "domains"
    if not cross_domains.exists() or not list(cross_domains.glob("*.json")):
        warnings.append(
            "NO cross-domain pages in parent wiki/domains/ — "
            "Phase 3 Step 4 may not have generated cross-service flow pages"
        )

    cross_svc = parent_root / ".understand-anything" / "cross-service-relationships.json"
    cross_svc_wiki = wiki_dir / "cross-service-relationships.json"
    cross_svc_tmp = parent_root / ".understand-anything" / "tmp" / "cross-service-candidates.json"
    if not (cross_svc.exists() or cross_svc_wiki.exists() or cross_svc_tmp.exists()):
        arch_path = wiki_dir / "architecture.json"
        if arch_path.exists():
            warnings.append(
                "cross-service-relationships.json not found (architecture.json exists, so analysis was done)"
            )
        else:
            errors.append(
                "MISSING cross-service-relationships.json — "
                "produced by Phase 3 Step 2 (cross-service-matcher.py)"
            )

    if repo_type == "mobile":
        client_graph = parent_root / ".understand-anything" / "client-graph.json"
        if not client_graph.exists():
            errors.append(
                "MISSING client-graph.json — "
                "produced by Phase 3 Mobile Mode (build-client-graph.py)"
            )
    elif repo_type == "frontend":
        frontend_graph = parent_root / ".understand-anything" / "frontend-graph.json"
        if not frontend_graph.exists():
            errors.append(
                "MISSING frontend-graph.json — "
                "produced by Phase 3 Frontend Mode (build-frontend-graph.py)"
            )
    elif repo_type == "backend":
        system_graph = parent_root / ".understand-anything" / "system-graph.json"
        if not system_graph.exists():
            warnings.append(
                "MISSING system-graph.json — "
                "produced by Phase 3 Step 5 (build-system-graph.py)"
            )

    return errors, warnings


def main():
    parser = argparse.ArgumentParser(description="Verify wiki output completeness")
    parser.add_argument("service_root", help="Service root directory (or parent root in batch mode)")
    parser.add_argument("--mode", choices=["single", "batch"], default="single")
    parser.add_argument("--repo-type", choices=["backend", "mobile", "frontend"], default="backend")
    parser.add_argument("--parent-root", help="Parent root directory (batch mode)")
    args = parser.parse_args()

    service_root = Path(args.service_root)
    all_errors = []
    all_warnings = []

    if args.mode == "single":
        errors, warnings = check_service_wiki(service_root, args.repo_type)
        if errors or warnings:
            print(f"\n=== {service_root.name} ===")
        all_errors.extend(errors)
        all_warnings.extend(warnings)
    else:
        parent_root = Path(args.parent_root) if args.parent_root else service_root
        for svc_dir in sorted(parent_root.iterdir()):
            if not svc_dir.is_dir():
                continue
            wiki_meta = svc_dir / ".understand-anything" / "wiki" / "meta.json"
            if wiki_meta.exists():
                errors, warnings = check_service_wiki(svc_dir, args.repo_type)
                if errors or warnings:
                    print(f"\n=== {svc_dir.name} ===")
                    for e in errors:
                        print(f"  ERROR: {e}")
                    for w in warnings:
                        print(f"  WARN:  {w}")
                all_errors.extend([(svc_dir.name, e) for e in errors])
                all_warnings.extend([(svc_dir.name, w) for w in warnings])

        p_errors, p_warnings = check_parent_wiki(parent_root, args.repo_type)
        if p_errors or p_warnings:
            print(f"\n=== Parent ({parent_root.name}) ===")
            for e in p_errors:
                print(f"  ERROR: {e}")
            for w in p_warnings:
                print(f"  WARN:  {w}")
        all_errors.extend([("parent", e) for e in p_errors])
        all_warnings.extend([("parent", w) for w in p_warnings])

    if args.mode == "single":
        for e in all_errors:
            print(f"  ERROR: {e}")
        for w in all_warnings:
            print(f"  WARN:  {w}")

    print(f"\n{'='*50}")
    if all_errors:
        print(f"FAILED — {len(all_errors)} error(s), {len(all_warnings)} warning(s)")
        print("\nMissing files indicate skipped pipeline steps.")
        print("Re-run the corresponding Phase/Script to fix.")
        return 1
    if all_warnings:
        print(f"PASSED with {len(all_warnings)} warning(s)")
        return 2
    print("PASSED — all wiki output files present and valid")
    return 0


if __name__ == "__main__":
    sys.exit(main())
