#!/usr/bin/env python3
"""
Detect stale upstream knowledge-graph.json and domain-graph.json relative to git HEAD.

Compares each graph's generation commit (project.gitCommitHash, meta.generatedFromCommit,
or .understand-anything/meta.json) against the current repository HEAD.
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path
from typing import Any, Literal

GraphStatus = Literal["fresh", "stale", "missing"]

KG_FILE = "knowledge-graph.json"
DG_FILE = "domain-graph.json"
META_FILE = "meta.json"


def _read_json(path: Path) -> dict[str, Any] | None:
    if not path.is_file():
        return None
    try:
        with path.open(encoding="utf-8") as f:
            data = json.load(f)
    except (json.JSONDecodeError, OSError):
        return None
    return data if isinstance(data, dict) else None


def extract_generation_commit(data: dict[str, Any]) -> str | None:
    """Resolve the commit hash a graph was generated from."""
    project = data.get("project")
    if isinstance(project, dict):
        commit = project.get("gitCommitHash")
        if isinstance(commit, str) and commit.strip():
            return commit.strip()

    meta = data.get("meta")
    if isinstance(meta, dict):
        for key in ("generatedFromCommit", "gitCommitHash"):
            value = meta.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()

    metadata = data.get("metadata")
    if isinstance(metadata, dict):
        for key in ("generatedFromCommit", "gitCommitHash"):
            value = metadata.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()

    top = data.get("gitCommitHash")
    if isinstance(top, str) and top.strip():
        return top.strip()

    return None


def get_current_commit(service_root: Path) -> str | None:
    """Return git HEAD for service_root, or None if not in a git repository."""
    try:
        result = subprocess.run(
            ["git", "-C", str(service_root), "rev-parse", "HEAD"],
            capture_output=True,
            text=True,
            check=True,
            timeout=10,
        )
    except (subprocess.CalledProcessError, FileNotFoundError, subprocess.TimeoutExpired):
        return None
    commit = result.stdout.strip()
    return commit or None


def _commit_from_meta_file(ua_dir: Path) -> str | None:
    meta = _read_json(ua_dir / META_FILE)
    if not meta:
        return None
    value = meta.get("gitCommitHash")
    if isinstance(value, str) and value.strip():
        return value.strip()
    return None


def _graph_commit(ua_dir: Path, filename: str) -> str | None:
    data = _read_json(ua_dir / filename)
    if data is None:
        return None
    commit = extract_generation_commit(data)
    if commit:
        return commit
    return _commit_from_meta_file(ua_dir)


def _status_for_graph(
    *,
    exists: bool,
    graph_commit: str | None,
    current_commit: str | None,
    label: str,
    warnings: list[str],
    should_regenerate: dict[str, bool],
    key: str,
) -> GraphStatus:
    if not exists:
        warnings.append(f"{label} is missing at expected path")
        should_regenerate[key] = True
        return "missing"

    if current_commit is None:
        should_regenerate[key] = False
        return "fresh"

    if graph_commit is None:
        warnings.append(
            f"{label} exists but has no generation commit "
            "(expected project.gitCommitHash or meta.generatedFromCommit)"
        )
        should_regenerate[key] = True
        return "stale"

    if graph_commit == current_commit:
        should_regenerate[key] = False
        return "fresh"

    short_graph = graph_commit[:8]
    short_current = current_commit[:8]
    warnings.append(
        f"{label} was generated from commit {short_graph} but current HEAD is {short_current}"
    )
    should_regenerate[key] = True
    return "stale"


def check_upstream_staleness(service_root: str | Path) -> dict[str, Any]:
    """
    Check KG/DG freshness for a service directory.

    Returns a dict with kg_status, dg_status, commits, warnings, and should_regenerate.
    """
    root = Path(service_root)
    ua_dir = root / ".understand-anything"
    kg_path = ua_dir / KG_FILE
    dg_path = ua_dir / DG_FILE

    warnings: list[str] = []
    should_regenerate: dict[str, bool] = {"kg": False, "dg": False}

    current_commit = get_current_commit(root)
    if current_commit is None:
        warnings.append(
            "Not a git repository (or git unavailable); cannot compare graph commits to HEAD"
        )

    kg_exists = kg_path.is_file()
    dg_exists = dg_path.is_file()
    kg_commit = _graph_commit(ua_dir, KG_FILE) if kg_exists else None
    dg_commit = _graph_commit(ua_dir, DG_FILE) if dg_exists else None

    kg_status = _status_for_graph(
        exists=kg_exists,
        graph_commit=kg_commit,
        current_commit=current_commit,
        label="KG",
        warnings=warnings,
        should_regenerate=should_regenerate,
        key="kg",
    )
    dg_status = _status_for_graph(
        exists=dg_exists,
        graph_commit=dg_commit,
        current_commit=current_commit,
        label="DG",
        warnings=warnings,
        should_regenerate=should_regenerate,
        key="dg",
    )

    return {
        "kg_status": kg_status,
        "dg_status": dg_status,
        "kg_commit": kg_commit,
        "dg_commit": dg_commit,
        "current_commit": current_commit,
        "warnings": warnings,
        "should_regenerate": should_regenerate,
    }


def main() -> int:
    import argparse

    parser = argparse.ArgumentParser(
        description="Check whether knowledge-graph.json and domain-graph.json are stale vs git HEAD"
    )
    parser.add_argument("service_root", help="Path to the service directory")
    args = parser.parse_args()

    result = check_upstream_staleness(args.service_root)
    json.dump(result, sys.stdout, indent=2)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
