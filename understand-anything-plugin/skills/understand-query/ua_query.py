#!/usr/bin/env python3
"""HTTP CLI for querying Understand-Anything API Server (stdlib only)."""
import argparse
import json
import os
import sys
from typing import Any
import urllib.request
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode

DEFAULT_SERVER = "http://localhost:3001"
DEFAULT_TIMEOUT = 30


class ServerUnavailableError(RuntimeError):
    pass


def fetch_json(url: str, timeout: int = DEFAULT_TIMEOUT) -> Any:
    try:
        req = urllib.request.Request(url, headers={"Accept": "application/json"})
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        try:
            err = json.loads(body)
        except json.JSONDecodeError:
            err = {"error": body}
        raise RuntimeError(f"HTTP {e.code}: {err.get('error', body)}") from e
    except URLError as e:
        raise ServerUnavailableError(
            f"API Server unavailable at {url.split('?')[0]}. "
            f"Start it with: cd understand-anything-plugin/packages/dashboard && pnpm run serve\n"
            f"Detail: {e}"
        ) from e


def build_url(server: str, path: str, params: dict[str, str], token: str) -> str:
    q = {**params, "token": token}
    base = server.rstrip("/")
    return f"{base}{path}?{urlencode(q)}"


def format_output(data: Any, fmt: str) -> str:
    if fmt == "md":
        return _format_markdown(data)
    return json.dumps(data, ensure_ascii=False, indent=2)


def _format_markdown(data: Any) -> str:
    if isinstance(data, dict) and "domains" in data:
        lines = ["# Business Domains", ""]
        for d in data["domains"]:
            lines.append(f"## {d.get('name', d.get('id', '?'))}")
            lines.append(d.get("summary", ""))
            lines.append("")
        return "\n".join(lines)
    if isinstance(data, dict) and "results" in data:
        lines = ["# Search Results", ""]
        for r in data["results"]:
            lines.append(f"- **{r.get('name', r.get('id'))}**: {r.get('match', r.get('summary', ''))}")
        return "\n".join(lines)
    return f"```json\n{json.dumps(data, ensure_ascii=False, indent=2)}\n```"


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Query Understand-Anything API")
    parser.add_argument("--server", default=os.environ.get("UNDERSTAND_SERVER", DEFAULT_SERVER))
    parser.add_argument("--token", default=os.environ.get("UNDERSTAND_TOKEN", ""))
    parser.add_argument("--format", choices=["json", "md"], default="json")
    parser.add_argument("--verbose", action="store_true")
    sub = parser.add_subparsers(dest="command", required=True)

    kg = sub.add_parser("kg", help="Knowledge graph queries")
    kg.add_argument("--service")
    kg.add_argument("--type")
    kg.add_argument("--node")
    kg.add_argument("--search")
    kg.add_argument("--file")
    kg.add_argument("--neighbors")
    kg.add_argument("--edge-type")
    kg.add_argument("--direction", choices=["inbound", "outbound", "both"], default="both")
    kg.add_argument("--depth", type=int, default=1)
    kg.add_argument("--edges", action="store_true")
    kg.add_argument("--source")
    kg.add_argument("--target")
    kg.add_argument("--layers", action="store_true")
    kg.add_argument("--tour", action="store_true")

    domain = sub.add_parser("domain", help="Domain graph queries")
    domain.add_argument("--service")
    domain.add_argument("--domain")
    domain.add_argument("--search")
    domain.add_argument("--neighbors")
    domain.add_argument("--edge-type")
    domain.add_argument("--flows", action="store_true")
    domain.add_argument("--flow")
    domain.add_argument("--steps", action="store_true")

    wiki = sub.add_parser("wiki", help="Wiki queries")
    wiki.add_argument("--service")
    wiki.add_argument("--type")
    wiki.add_argument("--domain")
    wiki.add_argument("--search")
    wiki.add_argument("--overview", action="store_true")
    wiki.add_argument("--architecture", action="store_true")
    wiki.add_argument("--cross-domain")
    wiki.add_argument("--endpoint-index", action="store_true")
    wiki.add_argument("--protocol")
    wiki.add_argument("--flow")
    wiki.add_argument("--related", action="store_true")

    biz = sub.add_parser("business", help="Business landscape queries")
    biz.add_argument("--domain")
    biz.add_argument("--type")
    biz.add_argument("--facet")
    biz.add_argument("--list", action="store_true")
    biz.add_argument("--search")
    biz.add_argument("--links", action="store_true")
    biz.add_argument("--panorama", action="store_true")
    biz.add_argument("--meta", action="store_true")

    svc = sub.add_parser("services", help="Service discovery and readiness")
    svc.add_argument("--list", action="store_true")
    svc.add_argument("--name")
    svc.add_argument("--has")

    meta_cmd = sub.add_parser("meta", help="Cross-layer freshness check")
    meta_cmd.add_argument("--stale", action="store_true")

    return parser.parse_args(argv)


# --- Subcommand handlers ---

def cmd_kg(args: argparse.Namespace) -> Any:
    if not args.service:
        raise SystemExit("kg requires --service")
    if args.neighbors:
        params: dict[str, str] = {"service": args.service, "graph": "kg", "node": args.neighbors, "direction": args.direction, "depth": str(args.depth)}
        if args.edge_type:
            params["edgeType"] = args.edge_type
        return fetch_json(build_url(args.server, "/api/graph-query/neighbors", params, args.token))
    if args.edges:
        params = {"service": args.service, "graph": "kg"}
        if args.type:
            params["type"] = args.type
        if args.source:
            params["source"] = args.source
        if args.target:
            params["target"] = args.target
        return fetch_json(build_url(args.server, "/api/graph-query/edges", params, args.token))
    if args.layers:
        return fetch_json(build_url(args.server, "/api/graph-query/layers", {"service": args.service}, args.token))
    if args.tour:
        return fetch_json(build_url(args.server, "/api/graph-query/tour", {"service": args.service}, args.token))
    if args.file:
        url_path = f"/api/source?file={quote(args.file, safe='')}&service={quote(args.service, safe='')}&mode=graph"
        return fetch_json(build_url(args.server, url_path, {}, args.token))
    params = {"service": args.service, "file": "knowledge-graph.json"}
    data = fetch_json(build_url(args.server, "/api/graph", params, args.token))
    nodes = data.get("nodes", [])
    if args.node:
        nodes = [n for n in nodes if n.get("name") == args.node]
    elif args.type and args.type != "node":
        nodes = [n for n in nodes if n.get("type") == args.type]
    elif args.search:
        q = args.search.lower()
        nodes = [n for n in nodes if q in json.dumps(n, ensure_ascii=False).lower()]
    return {"nodes": nodes, "edges": data.get("edges", []) if args.verbose else None}


def cmd_domain(args: argparse.Namespace) -> Any:
    if not args.service:
        raise SystemExit("domain requires --service")
    if args.neighbors:
        params: dict[str, str] = {"service": args.service, "graph": "domain", "node": args.neighbors, "direction": "both"}
        if args.edge_type:
            params["edgeType"] = args.edge_type
        return fetch_json(build_url(args.server, "/api/graph-query/neighbors", params, args.token))
    params = {"service": args.service, "file": "domain-graph.json"}
    data = fetch_json(build_url(args.server, "/api/graph", params, args.token))
    if args.flows:
        nodes = [n for n in data.get("nodes", []) if n.get("type") == "flow"]
        return {"flows": nodes}
    if args.flow:
        flow_id = args.flow
        nodes = data.get("nodes", [])
        flow_node = next((n for n in nodes if n.get("id") == flow_id or n.get("name") == flow_id), None)
        if not flow_node:
            raise SystemExit(f"Flow '{flow_id}' not found")
        if args.steps:
            edges = data.get("edges", [])
            step_edges = sorted(
                [e for e in edges if e.get("source") == flow_node["id"] and e.get("type") == "flow_step"],
                key=lambda e: e.get("weight", 0),
            )
            step_ids = [e["target"] for e in step_edges]
            steps = [n for n in nodes if n["id"] in step_ids]
            return {"flow": flow_node, "steps": steps}
        return {"flow": flow_node}
    if args.domain:
        nodes = [n for n in data.get("nodes", []) if args.domain in n.get("id", "") or args.domain in n.get("name", "")]
        return {"nodes": nodes}
    if args.search:
        q = args.search.lower()
        nodes = [n for n in data.get("nodes", []) if q in n.get("name", "").lower() or q in n.get("summary", "").lower()]
        return {"nodes": nodes}
    return data


def cmd_wiki(args: argparse.Namespace) -> Any:
    if args.overview:
        return fetch_json(build_url(args.server, "/api/wiki/overview", {}, args.token))
    if args.architecture:
        return fetch_json(build_url(args.server, "/api/wiki/architecture", {}, args.token))
    if args.cross_domain:
        slug = quote(args.cross_domain, safe="")
        return fetch_json(build_url(args.server, f"/api/wiki/domain/{slug}", {}, args.token))
    if args.endpoint_index:
        data = fetch_json(build_url(args.server, "/api/wiki/endpoints/index", {}, args.token))
        if args.protocol:
            by_proto = data.get("byProtocol", {})
            return {"protocol": args.protocol, "entries": by_proto.get(args.protocol, [])}
        return data
    if not args.service:
        raise SystemExit("wiki requires --service (or use --overview/--architecture/--cross-domain/--endpoint-index)")
    svc = quote(args.service, safe="")
    if args.flow:
        flow_id = quote(args.flow, safe="")
        return fetch_json(build_url(args.server, f"/api/wiki/service/{svc}/flow/{flow_id}", {}, args.token))
    if args.related:
        if not args.domain:
            raise SystemExit("--related requires --domain")
        domain_id = quote(args.domain, safe="")
        return fetch_json(build_url(args.server, f"/api/wiki/{domain_id}/related", {}, args.token))
    if args.search:
        return fetch_json(build_url(args.server, "/api/wiki/search", {"q": args.search, "limit": "20"}, args.token))
    if args.domain:
        return fetch_json(build_url(args.server, f"/api/wiki/service/{svc}/domain/{quote(args.domain, safe='')}", {}, args.token))
    if args.type == "endpoint":
        return fetch_json(build_url(args.server, f"/api/wiki/endpoints/{svc}", {}, args.token))
    return fetch_json(build_url(args.server, f"/api/wiki/service/{svc}", {}, args.token))


def cmd_business(args: argparse.Namespace) -> Any:
    if args.meta:
        return fetch_json(build_url(args.server, "/api/business/meta", {}, args.token))
    if args.panorama:
        return fetch_json(build_url(args.server, "/api/business/panorama", {}, args.token))
    if args.links:
        params: dict[str, str] = {}
        if args.domain:
            params["domain"] = args.domain
        return fetch_json(build_url(args.server, "/api/business/cross-facet-links", params, args.token))
    if args.list:
        return fetch_json(build_url(args.server, "/api/business/domains", {}, args.token))
    if args.search:
        return fetch_json(build_url(args.server, "/api/business/search", {"q": args.search}, args.token))
    if args.domain:
        slug = args.domain.replace("domain:", "").replace(" ", "-").lower()
        data = fetch_json(build_url(args.server, f"/api/business/domains/{slug}", {}, args.token))
        if args.type == "interactions":
            return {"interactions": data.get("interactions", [])}
        if args.type == "rules":
            return {"businessRules": data.get("businessRules", [])}
        if args.facet:
            return {"facets": data.get("facets", {}).get(args.facet, {})}
        return data
    return fetch_json(build_url(args.server, "/api/business/overview", {}, args.token))


def cmd_services(args: argparse.Namespace) -> Any:
    params: dict[str, str] = {}
    if args.name:
        params["name"] = args.name
    if args.has:
        params["has"] = args.has
    return fetch_json(build_url(args.server, "/api/services", params, args.token))


def cmd_meta(args: argparse.Namespace) -> Any:
    data = fetch_json(build_url(args.server, "/api/meta", {}, args.token))
    if args.stale:
        return {"stale": data.get("freshness", {}).get("stale", [])}
    return data


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    if not args.token:
        print("Error: --token required (or set UNDERSTAND_TOKEN env var)", file=sys.stderr)
        return 1
    try:
        handlers = {"kg": cmd_kg, "domain": cmd_domain, "wiki": cmd_wiki, "business": cmd_business, "services": cmd_services, "meta": cmd_meta}
        data = handlers[args.command](args)
        print(format_output(data, args.format))
        return 0
    except ServerUnavailableError as e:
        print(str(e), file=sys.stderr)
        return 2
    except RuntimeError as e:
        print(str(e), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
