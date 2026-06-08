#!/usr/bin/env python3
"""HTTP CLI for querying Understand-Anything API Server (stdlib only)."""
import argparse
import json
import os
import sys
from typing import Any
import urllib.request
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode

DEFAULT_SERVER = "http://localhost:3001"
DEFAULT_TIMEOUT = 30


class ServerUnavailableError(RuntimeError):
    pass


def fetch_json(url: str, timeout: int = DEFAULT_TIMEOUT) -> Any:
    try:
        req = urllib.request.Request(url, headers={"Accept": "application/json"})
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except URLError as e:
        raise ServerUnavailableError(
            f"API Server unavailable at {url.split('?')[0]}. "
            f"Start it with: cd understand-anything-plugin/packages/dashboard && pnpm run serve\n"
            f"Detail: {e}"
        ) from e
    except HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        try:
            err = json.loads(body)
        except json.JSONDecodeError:
            err = {"error": body}
        raise RuntimeError(f"HTTP {e.code}: {err.get('error', body)}") from e


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

    domain = sub.add_parser("domain", help="Domain graph queries")
    domain.add_argument("--service")
    domain.add_argument("--domain")
    domain.add_argument("--search")

    wiki = sub.add_parser("wiki", help="Wiki queries")
    wiki.add_argument("--service")
    wiki.add_argument("--type")
    wiki.add_argument("--domain")
    wiki.add_argument("--search")

    biz = sub.add_parser("business", help="Business landscape queries")
    biz.add_argument("--domain")
    biz.add_argument("--type")
    biz.add_argument("--facet")
    biz.add_argument("--list", action="store_true")
    biz.add_argument("--search")

    return parser.parse_args(argv)


# --- Subcommand handlers ---

def cmd_kg(args: argparse.Namespace) -> Any:
    if not args.service:
        raise SystemExit("kg requires --service")
    if args.file:
        path = f"/api/source?file={args.file}&service={args.service}&mode=graph"
        return fetch_json(build_url(args.server, path, {}, args.token))
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
    params = {"service": args.service, "file": "domain-graph.json"}
    data = fetch_json(build_url(args.server, "/api/graph", params, args.token))
    if args.domain:
        nodes = [n for n in data.get("nodes", []) if args.domain in n.get("id", "") or args.domain in n.get("name", "")]
        return {"nodes": nodes}
    if args.search:
        q = args.search.lower()
        nodes = [n for n in data.get("nodes", []) if q in n.get("name", "").lower() or q in n.get("summary", "").lower()]
        return {"nodes": nodes}
    return data


def cmd_wiki(args: argparse.Namespace) -> Any:
    if not args.service:
        raise SystemExit("wiki requires --service")
    if args.search:
        return fetch_json(build_url(args.server, "/api/wiki/search", {"q": args.search, "limit": "20"}, args.token))
    if args.domain:
        path = f"/api/wiki/service/{args.service}/domain/{args.domain}"
        return fetch_json(build_url(args.server, path, {}, args.token))
    if args.type == "domain":
        return fetch_json(build_url(args.server, f"/api/wiki/service/{args.service}", {}, args.token))
    if args.type == "endpoint":
        return fetch_json(build_url(args.server, f"/api/wiki/endpoints/{args.service}", {}, args.token))
    if args.type == "structure":
        return fetch_json(build_url(args.server, f"/api/wiki/service/{args.service}", {}, args.token))
    if args.type == "flow":
        return fetch_json(build_url(args.server, f"/api/wiki/service/{args.service}", {}, args.token))
    return fetch_json(build_url(args.server, f"/api/wiki/service/{args.service}", {}, args.token))


def cmd_business(args: argparse.Namespace) -> Any:
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


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    if not args.token:
        print("Error: --token required (or set UNDERSTAND_TOKEN env var)", file=sys.stderr)
        return 1
    try:
        handlers = {"kg": cmd_kg, "domain": cmd_domain, "wiki": cmd_wiki, "business": cmd_business}
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
