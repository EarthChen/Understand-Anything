"""Wiki Structure Validator — structural validation without requiring domain-graph.

Validates that a service wiki directory has the expected layout and that each
JSON file is well-formed. Optionally checks domain coverage when a domain-graph
path is supplied.

Usage:
    python wiki_structure_validator.py <wiki_dir> [dg_path]
"""

from __future__ import annotations

import json
import os
import sys
from typing import Any


REQUIRED_TOP_LEVEL = ("meta.json", "index.json", "service.json")
META_FIELDS = ("gitCommitHash", "generatedAt", "version", "outputLanguage")
MIN_DESCRIPTION_LEN = 10
MIN_SUMMARY_LEN = 10


def validate_wiki_structure(
    wiki_dir: str,
    dg_path: str | None = None,
) -> dict[str, Any]:
    """Validate wiki directory structure and JSON shape.

    Returns dict with keys: valid, missing_files, malformed_files, warnings, issues.
    """
    missing_files: list[str] = []
    malformed_files: list[dict[str, Any]] = []
    warnings: list[str] = []
    issues: list[str] = []

    for filename in REQUIRED_TOP_LEVEL:
        if not os.path.isfile(os.path.join(wiki_dir, filename)):
            missing_files.append(filename)
            issues.append(f"Missing required file: {filename}")

    domain_dir = os.path.join(wiki_dir, "domains")
    if not os.path.isdir(domain_dir):
        missing_files.append("domains/")
        issues.append("Missing required directory: domains/")
        domain_files: list[str] = []
    else:
        domain_files = sorted(f for f in os.listdir(domain_dir) if f.endswith(".json"))
        if len(domain_files) == 0:
            issues.append("domains/: no domain JSON files found")

    meta = _load_json(os.path.join(wiki_dir, "meta.json"))
    index = _load_json(os.path.join(wiki_dir, "index.json"))
    service = _load_json(os.path.join(wiki_dir, "service.json"))

    _validate_meta(meta, malformed_files, issues, warnings)
    _validate_index(index, malformed_files, issues)
    _validate_service(service, malformed_files, issues)

    for filename in domain_files:
        page_path = os.path.join(domain_dir, filename)
        page = _load_json(page_path)
        page_issues = _validate_domain_page(page, filename)
        if page_issues:
            malformed_files.append({"file": f"domains/{filename}", "errors": page_issues})
            issues.extend(f"domains/{filename}: {err}" for err in page_issues)

    if dg_path and os.path.isfile(dg_path):
        dg = _load_json(dg_path)
        dg_domains = [
            n["id"].replace("domain:", "")
            for n in dg.get("nodes", [])
            if n.get("type") == "domain"
        ]
        existing = {f.removesuffix(".json") for f in domain_files}
        for slug in dg_domains:
            if slug not in existing:
                missing_files.append(f"domains/{slug}.json")
                issues.append(
                    f"Coverage: domain '{slug}' has no wiki page "
                    f"(expected domains/{slug}.json)"
                )
    elif dg_path:
        issues.append(f"domain-graph not found: {dg_path}")

    valid = len(issues) == 0
    return {
        "valid": valid,
        "missing_files": missing_files,
        "malformed_files": malformed_files,
        "warnings": warnings,
        "issues": issues,
    }


def _load_json(path: str) -> dict:
    if not os.path.isfile(path):
        return {}
    try:
        with open(path) as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except json.JSONDecodeError:
        return {}


def _validate_meta(
    meta: dict,
    malformed_files: list[dict[str, Any]],
    issues: list[str],
    warnings: list[str],
) -> None:
    if not meta:
        return
    errors: list[str] = []
    for field in META_FIELDS:
        if not meta.get(field):
            errors.append(f"missing {field}")
    if errors:
        malformed_files.append({"file": "meta.json", "errors": errors})
        issues.extend(f"meta.json: {err}" for err in errors)


def _validate_index(
    index: dict,
    malformed_files: list[dict[str, Any]],
    issues: list[str],
) -> None:
    if not index:
        return
    errors: list[str] = []
    entries = index.get("entries")
    if not isinstance(entries, list):
        errors.append("entries is not an array")
    elif len(entries) == 0:
        errors.append("entries is empty")
    if errors:
        malformed_files.append({"file": "index.json", "errors": errors})
        issues.extend(f"index.json: {err}" for err in errors)


def _validate_service(
    service: dict,
    malformed_files: list[dict[str, Any]],
    issues: list[str],
) -> None:
    if not service:
        return
    errors: list[str] = []
    if not service.get("name"):
        errors.append("missing name")
    desc = service.get("description", "")
    if not desc or len(str(desc)) < MIN_DESCRIPTION_LEN:
        errors.append("description is missing or too short")
    if errors:
        malformed_files.append({"file": "service.json", "errors": errors})
        issues.extend(f"service.json: {err}" for err in errors)


def _validate_domain_page(page: dict, filename: str) -> list[str]:
    errors: list[str] = []
    if not page:
        return [f"domains/{filename} is missing or invalid JSON"]

    for field in ("id", "name", "summary"):
        if not page.get(field):
            errors.append(f"missing {field}")

    summary = page.get("summary", "")
    if summary and len(str(summary)) < MIN_SUMMARY_LEN:
        errors.append("summary is too short")

    flows = page.get("flows")
    if not isinstance(flows, list) or len(flows) == 0:
        errors.append("no flows defined")
        return errors

    for i, flow in enumerate(flows):
        if not isinstance(flow, dict):
            errors.append(f"flows[{i}] is not an object")
            continue
        if not flow.get("name") and not flow.get("id"):
            errors.append(f"flows[{i}] missing name or id")
        steps = flow.get("steps")
        if not isinstance(steps, list) or len(steps) == 0:
            errors.append(f"flows[{i}] has no steps")
            continue
        for j, step in enumerate(steps):
            if not isinstance(step, dict):
                errors.append(f"flows[{i}].steps[{j}] is not an object")
                continue
            if not step.get("description"):
                errors.append(f"flows[{i}].steps[{j}] missing description")

    return errors


def main() -> None:
    if len(sys.argv) < 2:
        print(f"Usage: {sys.argv[0]} <wiki_dir> [dg_path]")
        sys.exit(1)

    wiki_dir = sys.argv[1]
    dg_path = sys.argv[2] if len(sys.argv) > 2 else None

    result = validate_wiki_structure(wiki_dir, dg_path)

    if result["valid"]:
        print("[wiki-structure-validator] PASSED")
    else:
        print(f"[wiki-structure-validator] FAILED — {len(result['issues'])} issue(s)")
        for issue in result["issues"]:
            print(f"  ERROR: {issue}")
    for w in result["warnings"]:
        print(f"  WARN: {w}")

    sys.exit(0 if result["valid"] else 1)


if __name__ == "__main__":
    main()
