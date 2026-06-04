# understand-anything-plugin/skills/understand-wiki/generate_service_overview.py
#!/usr/bin/env python3
"""
generate_service_overview.py — Deterministic service.json generator from KG + DG metadata.

Input: knowledge-graph.json + domain-graph.json
Output: intermediate/wiki/service.json
"""
from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

ENTRY_POINT_TYPES = frozenset({"endpoint", "service"})
ENTRY_POINT_TAGS = frozenset({"entry-point", "api-handler"})
MAX_ENTRY_POINTS = 20


def generate_service_overview(kg: dict[str, Any], dg: dict[str, Any]) -> dict[str, Any]:
    """Extract service overview from KG and DG metadata."""
    project = kg.get("project", {})
    layers = kg.get("layers", [])
    nodes = kg.get("nodes", [])

    entry_points: list[str] = []
    for node in nodes:
        is_entry = (
            node.get("type") in ENTRY_POINT_TYPES
            or bool(ENTRY_POINT_TAGS & set(node.get("tags", [])))
        )
        if is_entry:
            name = node.get("name", "")
            if name:
                entry_points.append(name)

    return {
        "name": project.get("name", ""),
        "description": project.get("description", ""),
        "techStack": project.get("languages", []) + project.get("frameworks", []),
        "modules": [layer.get("name", "") for layer in layers],
        "entryPoints": entry_points[:MAX_ENTRY_POINTS],
    }


def main() -> int:
    if len(sys.argv) < 2:
        print("Usage: python generate_service_overview.py <service-root>", file=sys.stderr)
        return 1

    service_root = Path(sys.argv[1])
    ua_dir = service_root / ".understand-anything"
    kg_path = ua_dir / "knowledge-graph.json"
    dg_path = ua_dir / "domain-graph.json"

    if not kg_path.exists():
        print(f"[generate-overview] KG not found: {kg_path}", file=sys.stderr)
        return 1

    kg = json.loads(kg_path.read_text(encoding="utf-8"))
    dg = json.loads(dg_path.read_text(encoding="utf-8")) if dg_path.exists() else {"nodes": []}

    overview = generate_service_overview(kg, dg)

    out_dir = ua_dir / "intermediate" / "wiki"
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / "service.json"
    out_path.write_text(json.dumps(overview, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    print(f"[generate-overview] {overview['name']}: {len(overview['entryPoints'])} entry points, {len(overview['modules'])} modules")
    return 0


if __name__ == "__main__":
    sys.exit(main())
