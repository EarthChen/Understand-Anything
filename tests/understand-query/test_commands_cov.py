"""Line-coverage tests for _commands.py.

These tests target every branch in the command handlers. The #1 rule (per the
plug-in's import structure): names pulled in via `from _helpers import X` are
DIRECT BINDINGS in `_commands`, so they must be patched at `_commands.<name>`.
HTTP goes through `_helpers.fetch_json`, so that is patched at `_helpers.fetch_json`.
Every relied-upon mock also asserts it was called, to prove the patch target.
"""
import sys
from pathlib import Path
from unittest.mock import patch, MagicMock
import pytest

SKILL_DIR = Path(__file__).resolve().parent.parent.parent / "understand-anything-plugin" / "skills" / "understand-query"
sys.path.insert(0, str(SKILL_DIR))
import _commands  # noqa: E402
import ua_query   # noqa: E402

SERVER = "http://s"


# --------------------------------------------------------------------------- #
# helpers
# --------------------------------------------------------------------------- #
def kg_args(**over):
    base = dict(
        server=SERVER, service="svc", type=None, node=None, search=None,
        tag=None, offset=0, file=None, start=None, end=None, neighbors=None,
        edge_type=None, direction="both", depth=1, edges=False, source=None,
        target=None, layers=False, tour=False, toc=False, summary=False,
        verbose=False,
    )
    base.update(over)
    return _commands.argparse.Namespace(**base)


def domain_args(**over):
    base = dict(
        server=SERVER, service="svc", domain=None, search=None, neighbors=None,
        edge_type=None, flows=False, flow=None, steps=False,
    )
    base.update(over)
    return _commands.argparse.Namespace(**base)


def wiki_args(**over):
    base = dict(
        server=SERVER, service=None, type=None, domain=None, search=None,
        overview=False, architecture=False, cross_domain=None,
        endpoint_index=False, protocol=None, flow=None, related=False,
    )
    base.update(over)
    return _commands.argparse.Namespace(**base)


def biz_args(**over):
    base = dict(
        server=SERVER, domain=None, search=None, platform=None, flow=None,
        type=None, facet=None, list=False, links=False, panorama=False,
        features=False, meta=False,
    )
    base.update(over)
    return _commands.argparse.Namespace(**base)


def services_args(**over):
    base = dict(server=SERVER, list=False, name=None, has=None)
    base.update(over)
    return _commands.argparse.Namespace(**base)


def meta_args(**over):
    base = dict(server=SERVER, stale=False)
    base.update(over)
    return _commands.argparse.Namespace(**base)


def ask_args(**over):
    base = dict(
        server=SERVER, query="q", depth="standard", service="svc",
        platform=None, limit=5, fusion="rrf", format="json",
    )
    base.update(over)
    return _commands.argparse.Namespace(**base)


def impact_args(**over):
    base = dict(server=SERVER, service="svc", symbol="Sym", depth=3,
                direction="inbound", edge_type=None)
    base.update(over)
    return _commands.argparse.Namespace(**base)


def caller_args(**over):
    base = dict(server=SERVER, service="svc", symbol="Sym", depth=1)
    base.update(over)
    return _commands.argparse.Namespace(**base)


def hotspots_args(**over):
    base = dict(server=SERVER, service="svc", limit=20, type=None)
    base.update(over)
    return _commands.argparse.Namespace(**base)


def affected_args(**over):
    base = dict(server=SERVER, service="svc", files="a/b.py", depth=2)
    base.update(over)
    return _commands.argparse.Namespace(**base)


def structure_args(**over):
    base = dict(
        server=SERVER, service="svc", grep=None, file=None, start=None,
        end=None, files=False, annotation=None, param_type=None,
        return_type=None, interface=None, property_type=None,
        section_key=None, section_value=None, q=None, path=None, limit=50,
        offset=0, chain=None, direction="up", implementors=None, symbol=None,
        source=False,
    )
    base.update(over)
    return _commands.argparse.Namespace(**base)


def source_args(**over):
    base = dict(server=SERVER, service="svc", search=None, file=None,
                path=None, limit=20, start=None, end=None)
    base.update(over)
    return _commands.argparse.Namespace(**base)


# --------------------------------------------------------------------------- #
# _make_trace_args
# --------------------------------------------------------------------------- #
def test_make_trace_args_defaults_and_overrides():
    a = _commands._make_trace_args()
    assert a.fusion == "rrf" and a.grouped is False and a.limit == 5
    b = _commands._make_trace_args(service="x", query="q", source=True, grouped=True)
    assert b.service == "x" and b.query == "q" and b.source is True and b.grouped is True


# --------------------------------------------------------------------------- #
# _extract_ascii_keywords
# --------------------------------------------------------------------------- #
def test_extract_ascii_keywords():
    out = _commands._extract_ascii_keywords("挚友 ClosedFriend a bind_user")
    assert "ClosedFriend" in out and "bind_user" in out
    assert "a" not in out  # len < 2 filtered


# --------------------------------------------------------------------------- #
# cmd_kg
# --------------------------------------------------------------------------- #
class TestCmdKg:
    def test_requires_service(self):
        with pytest.raises(SystemExit):
            _commands.cmd_kg(kg_args(service=None))

    @patch("_commands._fetch_neighbors")
    @patch("_helpers.fetch_json")
    def test_file_summary(self, fj, fn):
        # graph then structure/file
        graph = {"nodes": [
            {"id": "file:a.py", "type": "file", "filePath": "src/a.py", "name": "a.py", "lineRange": [1, 1]},
            {"id": "sym1", "type": "function", "filePath": "src/a.py", "name": "foo", "lineRange": [3, 9], "summary": "s"},
        ]}
        struct = {"imports": [{"name": "com.x.Foo"}, "bar.Baz", {"name": "com.x.Foo"}]}
        fj.side_effect = [graph, struct]
        fn.return_value = {"neighbors": [
            {"direction": "inbound", "edge": {"type": "calls"}, "node": {"name": "C1", "type": "function"}},
            {"direction": "inbound", "edge": {"type": "calls"}, "node": {"name": "C1", "type": "function"}},  # dup
            {"direction": "outbound", "edge": {"type": "calls"}, "node": {"name": "D1", "type": "function"}},
            {"direction": "outbound", "edge": {"type": "other"}, "node": {"name": "X", "type": "function"}},
        ]}
        out = _commands.cmd_kg(kg_args(file="a.py", summary=True))
        assert fn.called and fj.called
        assert out["file"] == "a.py"
        assert out["fullPath"] == "src/a.py"
        assert out["callers"] == [{"name": "C1", "type": "function", "edgeType": "calls"}]
        assert out["callees"] == [{"name": "D1", "type": "function", "edgeType": "calls"}]
        assert out["blastRadius"] == {"inbound": 2, "outbound": 2}
        assert out["imports"] == ["Foo", "Baz"]
        assert out["totalSymbols"] == 2

    @patch("_helpers.fetch_json")
    def test_file_summary_graph_load_error(self, fj):
        fj.side_effect = RuntimeError("boom")
        with pytest.raises(RuntimeError, match="Failed to load knowledge graph"):
            _commands.cmd_kg(kg_args(file="a.py", summary=True))

    @patch("_commands._fetch_neighbors")
    @patch("_helpers.fetch_json")
    def test_file_summary_neighbor_and_struct_errors(self, fj, fn, capsys):
        # file matched only via file_symbols (not file_nodes): center via file_symbols branch
        graph = {"nodes": [
            {"id": "sym1", "type": "function", "filePath": "src/a.py", "name": "foo", "lineRange": [3, 9]},
        ]}
        fj.side_effect = [graph, RuntimeError("struct fail")]
        fn.side_effect = RuntimeError("nbr fail")
        out = _commands.cmd_kg(kg_args(file="a.py", summary=True))
        assert fn.called
        assert out["fullPath"] == "src/a.py"
        assert out["callers"] == [] and out["callees"] == []
        assert out["imports"] == []
        err = capsys.readouterr().err
        assert "fetch_neighbors failed" in err and "structure/file fetch failed" in err

    @patch("_commands._fetch_neighbors")
    @patch("_helpers.fetch_json")
    def test_file_summary_no_center(self, fj, fn):
        # no nodes match the file -> center_node None, fullPath ""
        graph = {"nodes": [{"id": "x", "type": "function", "filePath": "other.py", "name": "x"}]}
        struct = {"imports": []}
        fj.side_effect = [graph, struct]
        out = _commands.cmd_kg(kg_args(file="zzz.py", summary=True))
        assert not fn.called
        assert out["fullPath"] == ""
        assert out["blastRadius"] == {"inbound": 0, "outbound": 0}

    @patch("_commands._fetch_neighbors")
    @patch("_helpers.fetch_json")
    def test_file_summary_filenode_uses_id_when_no_filepath(self, fj, fn):
        # file node has empty filePath -> fullPath derived from id minus "file:"
        graph = {"nodes": [{"id": "file:foo.py", "type": "file", "filePath": "", "name": "foo.py"}]}
        fj.side_effect = [graph, {"imports": []}]
        fn.return_value = {"neighbors": []}
        out = _commands.cmd_kg(kg_args(file="foo.py", summary=True))
        assert out["fullPath"] == "foo.py"

    @patch("_helpers.fetch_json")
    def test_neighbors(self, fj):
        fj.return_value = {"neighbors": []}
        _commands.cmd_kg(kg_args(neighbors="n1", edge_type="calls", direction="outbound", depth=2))
        path_arg = fj.call_args[0][1]
        params_arg = fj.call_args[0][2]
        assert path_arg == "/api/graph-query/neighbors"
        assert params_arg["edgeType"] == "calls"
        assert params_arg["depth"] == "2"

    @patch("_helpers.fetch_json")
    def test_edges_all_params(self, fj):
        fj.return_value = {"edges": []}
        _commands.cmd_kg(kg_args(edges=True, type="calls", source="a", target="b"))
        path_arg = fj.call_args[0][1]
        params_arg = fj.call_args[0][2]
        assert path_arg == "/api/graph-query/edges"
        assert params_arg["type"] == "calls"
        assert params_arg["source"] == "a"
        assert params_arg["target"] == "b"

    @patch("_helpers.fetch_json")
    def test_layers(self, fj):
        fj.return_value = {"layers": []}
        _commands.cmd_kg(kg_args(layers=True))
        assert fj.call_args[0][1] == "/api/graph-query/layers"

    @patch("_helpers.fetch_json")
    def test_tour(self, fj):
        fj.return_value = {"tour": []}
        _commands.cmd_kg(kg_args(tour=True))
        assert fj.call_args[0][1] == "/api/graph-query/tour"

    @patch("_helpers.fetch_json")
    def test_file_toc(self, fj):
        fj.return_value = {"nodes": [{"name": "foo", "type": "function", "filePath": "src/a.py", "lineRange": [2, 4], "summary": "x"}]}
        out = _commands.cmd_kg(kg_args(file="a.py", toc=True))
        assert fj.call_args[0][1] == "/api/graph"
        assert out["file"] == "a.py" and out["totalSymbols"] == 1

    @patch("_helpers.fetch_json")
    def test_file_source(self, fj):
        fj.return_value = {"content": "x"}
        _commands.cmd_kg(kg_args(file="a.py", start=5, end=10))
        path_arg = fj.call_args[0][1]
        params_arg = fj.call_args[0][2]
        assert path_arg == "/api/source"
        assert params_arg["start"] == "5"
        assert params_arg["end"] == "10"
        assert params_arg["mode"] == "graph"

    @patch("_commands._search_api")
    def test_search(self, sa):
        sa.return_value = [{"id": "n1", "name": "X"}]
        out = _commands.cmd_kg(kg_args(search="foo", type="node"))
        assert sa.called
        # type "node" -> None filter
        assert sa.call_args.kwargs["type"] is None
        assert out == {"nodes": [{"id": "n1", "name": "X"}], "edges": None}

    @patch("_commands._search_api")
    def test_search_type_filter(self, sa):
        sa.return_value = []
        _commands.cmd_kg(kg_args(search="foo", type="class"))
        assert sa.call_args.kwargs["type"] == "class"

    @patch("_helpers.fetch_json")
    def test_node_exact_match(self, fj):
        fj.return_value = {"nodes": [{"name": "Foo", "id": "1"}, {"name": "FooBar", "id": "2"}], "edges": [{"e": 1}]}
        out = _commands.cmd_kg(kg_args(node="Foo", verbose=True))
        assert [n["name"] for n in out["nodes"]] == ["Foo"]
        assert out["edges"] == [{"e": 1}]

    @patch("_helpers.fetch_json")
    def test_node_fuzzy_match(self, fj):
        fj.return_value = {"nodes": [{"name": "Foo", "id": "x"}, {"name": "zzz", "id": "foobar"}], "edges": []}
        out = _commands.cmd_kg(kg_args(node="foo"))
        # both match (Foo by name, foobar by id)
        assert len(out["nodes"]) == 2
        assert out["edges"] is None  # verbose False

    @patch("_helpers.fetch_json")
    def test_type_filter_default_branch(self, fj):
        fj.return_value = {"nodes": [{"type": "class", "name": "A"}, {"type": "function", "name": "B"}]}
        out = _commands.cmd_kg(kg_args(type="class"))
        assert [n["name"] for n in out["nodes"]] == ["A"]

    @patch("_helpers.fetch_json")
    def test_type_node_no_filter(self, fj):
        fj.return_value = {"nodes": [{"type": "class", "name": "A"}, {"type": "function", "name": "B"}]}
        out = _commands.cmd_kg(kg_args(type="node"))
        assert len(out["nodes"]) == 2


# --------------------------------------------------------------------------- #
# cmd_domain
# --------------------------------------------------------------------------- #
class TestCmdDomain:
    def test_requires_service(self):
        with pytest.raises(SystemExit):
            _commands.cmd_domain(domain_args(service=None))

    @patch("_helpers.fetch_json")
    def test_neighbors(self, fj):
        fj.return_value = {}
        _commands.cmd_domain(domain_args(neighbors="n1", edge_type="flow_step"))
        params_arg = fj.call_args[0][2]
        assert params_arg["graph"] == "domain"
        assert params_arg["edgeType"] == "flow_step"

    @patch("_commands._search_api")
    def test_search(self, sa):
        sa.return_value = [{"id": "n"}]
        out = _commands.cmd_domain(domain_args(search="x"))
        assert sa.called and out == {"nodes": [{"id": "n"}]}

    @patch("_helpers.fetch_json")
    def test_flows(self, fj):
        fj.return_value = {"nodes": [{"type": "flow", "name": "F"}, {"type": "step", "name": "S"}]}
        out = _commands.cmd_domain(domain_args(flows=True))
        assert out == {"flows": [{"type": "flow", "name": "F"}]}

    @patch("_helpers.fetch_json")
    def test_flow_with_steps(self, fj):
        fj.return_value = {
            "nodes": [
                {"id": "f1", "name": "Flow1", "type": "flow"},
                {"id": "s1", "name": "Step1", "type": "step"},
                {"id": "s2", "name": "Step2", "type": "step"},
            ],
            "edges": [
                {"source": "f1", "target": "s2", "type": "flow_step", "weight": 2},
                {"source": "f1", "target": "s1", "type": "flow_step", "weight": 1},
            ],
        }
        out = _commands.cmd_domain(domain_args(flow="f1", steps=True))
        assert out["flow"]["id"] == "f1"
        assert [s["id"] for s in out["steps"]] == ["s1", "s2"]

    @patch("_helpers.fetch_json")
    def test_flow_no_steps(self, fj):
        fj.return_value = {"nodes": [{"id": "f1", "name": "Flow1", "type": "flow"}], "edges": []}
        out = _commands.cmd_domain(domain_args(flow="Flow1"))
        assert out == {"flow": {"id": "f1", "name": "Flow1", "type": "flow"}}

    @patch("_helpers.fetch_json")
    def test_flow_not_found_with_suggestions(self, fj):
        fj.return_value = {"nodes": [{"id": "f1", "name": "Bind Friend", "type": "flow"}], "edges": []}
        with pytest.raises(SystemExit, match="Did you mean"):
            _commands.cmd_domain(domain_args(flow="bind"))

    @patch("_helpers.fetch_json")
    def test_flow_not_found_no_suggestions(self, fj):
        fj.return_value = {"nodes": [], "edges": []}
        with pytest.raises(SystemExit, match="not found"):
            _commands.cmd_domain(domain_args(flow="zzz"))

    @patch("_helpers.fetch_json")
    def test_domain_filter(self, fj):
        fj.return_value = {"nodes": [{"id": "domain:order", "name": "Order"}, {"id": "x", "name": "y"}]}
        out = _commands.cmd_domain(domain_args(domain="order"))
        assert out == {"nodes": [{"id": "domain:order", "name": "Order"}]}

    @patch("_helpers.fetch_json")
    def test_default_returns_data(self, fj):
        fj.return_value = {"nodes": [], "edges": []}
        out = _commands.cmd_domain(domain_args())
        assert out == {"nodes": [], "edges": []}


# --------------------------------------------------------------------------- #
# cmd_wiki
# --------------------------------------------------------------------------- #
class TestCmdWiki:
    @patch("_helpers.fetch_json")
    def test_overview(self, fj):
        fj.return_value = {}
        _commands.cmd_wiki(wiki_args(overview=True))
        assert fj.call_args[0][1] == "/api/wiki/overview"

    @patch("_helpers.fetch_json")
    def test_architecture(self, fj):
        fj.return_value = {}
        _commands.cmd_wiki(wiki_args(architecture=True))
        assert fj.call_args[0][1] == "/api/wiki/architecture"

    @patch("_helpers.fetch_json")
    def test_cross_domain(self, fj):
        fj.return_value = {}
        _commands.cmd_wiki(wiki_args(cross_domain="a/b"))
        assert fj.call_args[0][1] == "/api/wiki/domain/a%2Fb"

    @patch("_helpers.fetch_json")
    def test_endpoint_index_no_protocol(self, fj):
        fj.return_value = {"byProtocol": {}}
        out = _commands.cmd_wiki(wiki_args(endpoint_index=True))
        assert out == {"byProtocol": {}}

    @patch("_helpers.fetch_json")
    def test_endpoint_index_with_protocol(self, fj):
        fj.return_value = {"byProtocol": {"http": [1, 2]}}
        out = _commands.cmd_wiki(wiki_args(endpoint_index=True, protocol="http"))
        assert out == {"protocol": "http", "entries": [1, 2]}

    def test_requires_service(self):
        with pytest.raises(SystemExit):
            _commands.cmd_wiki(wiki_args())

    @patch("_helpers.fetch_json")
    def test_flow(self, fj):
        fj.return_value = {}
        _commands.cmd_wiki(wiki_args(service="svc", flow="checkout"))
        assert fj.call_args[0][1] == "/api/wiki/service/svc/flow/checkout"

    def test_related_requires_domain(self):
        with pytest.raises(SystemExit, match="--related requires --domain"):
            _commands.cmd_wiki(wiki_args(service="svc", related=True))

    @patch("_helpers.fetch_json")
    def test_related(self, fj):
        fj.return_value = {}
        _commands.cmd_wiki(wiki_args(service="svc", related=True, domain="order"))
        assert fj.call_args[0][1] == "/api/wiki/order/related"

    @patch("_commands._search_api")
    def test_search(self, sa):
        sa.return_value = [{"id": "x"}]
        out = _commands.cmd_wiki(wiki_args(service="svc", search="foo"))
        assert sa.called and out == [{"id": "x"}]

    @patch("_helpers.fetch_json")
    def test_domain(self, fj):
        fj.return_value = {}
        _commands.cmd_wiki(wiki_args(service="svc", domain="order"))
        assert fj.call_args[0][1] == "/api/wiki/service/svc/domain/order"

    @patch("_helpers.fetch_json")
    def test_type_endpoint(self, fj):
        fj.return_value = {}
        _commands.cmd_wiki(wiki_args(service="svc", type="endpoint"))
        assert fj.call_args[0][1] == "/api/wiki/endpoints/svc"

    @patch("_helpers.fetch_json")
    def test_default_service(self, fj):
        fj.return_value = {}
        _commands.cmd_wiki(wiki_args(service="svc"))
        assert fj.call_args[0][1] == "/api/wiki/service/svc"


# --------------------------------------------------------------------------- #
# cmd_business
# --------------------------------------------------------------------------- #
class TestCmdBusiness:
    @patch("_helpers.fetch_json")
    def test_meta(self, fj):
        fj.return_value = {}
        _commands.cmd_business(biz_args(meta=True))
        assert fj.call_args[0][1] == "/api/business/meta"

    @patch("_helpers.fetch_json")
    def test_panorama(self, fj):
        fj.return_value = {}
        _commands.cmd_business(biz_args(panorama=True))
        assert fj.call_args[0][1] == "/api/business/panorama"

    @patch("_helpers.fetch_json")
    def test_features(self, fj):
        fj.return_value = {}
        _commands.cmd_business(biz_args(features=True))
        assert fj.call_args[0][1] == "/api/business/features"

    @patch("_helpers.fetch_json")
    def test_links_no_domain(self, fj):
        fj.return_value = {}
        _commands.cmd_business(biz_args(links=True))
        assert fj.call_args[0][1] == "/api/business/cross-facet-links"

    @patch("_helpers.fetch_json")
    def test_links_with_domain(self, fj):
        fj.return_value = {}
        _commands.cmd_business(biz_args(links=True, domain="order"))
        assert fj.call_args[0][2]["domain"] == "order"

    @patch("_helpers.fetch_json")
    def test_list(self, fj):
        fj.return_value = {}
        _commands.cmd_business(biz_args(list=True))
        assert fj.call_args[0][1] == "/api/business/domains"

    def test_search_domain_mutually_exclusive(self):
        with pytest.raises(SystemExit, match="mutually exclusive"):
            _commands.cmd_business(biz_args(search="x", domain="y"))

    @patch("_helpers.fetch_json")
    def test_search_with_platform_and_flow(self, fj):
        fj.return_value = {}
        _commands.cmd_business(biz_args(search="挚友", platform="ios", flow="bind"))
        path_arg = fj.call_args[0][1]
        params_arg = fj.call_args[0][2]
        assert path_arg == "/api/business/search"
        assert params_arg["platform"] == "ios"
        assert params_arg["flow"] == "bind"

    @patch("_helpers.fetch_json")
    def test_domain_and_platform(self, fj):
        fj.return_value = {}
        _commands.cmd_business(biz_args(domain="order flow", platform="android", flow="bind"))
        path_arg = fj.call_args[0][1]
        params_arg = fj.call_args[0][2]
        assert path_arg.startswith("/api/business/domains/")
        assert params_arg["platform"] == "android"
        assert params_arg["flow"] == "bind"

    @patch("_helpers.fetch_json")
    def test_domain_interactions(self, fj):
        fj.return_value = {"interactions": [1, 2], "businessRules": [3]}
        out = _commands.cmd_business(biz_args(domain="domain:Order", type="interactions"))
        assert out == {"interactions": [1, 2]}
        assert fj.call_args[0][1] == "/api/business/domains/order"

    @patch("_helpers.fetch_json")
    def test_domain_rules(self, fj):
        fj.return_value = {"businessRules": [9]}
        out = _commands.cmd_business(biz_args(domain="Order", type="rules"))
        assert out == {"businessRules": [9]}

    @patch("_helpers.fetch_json")
    def test_domain_facet(self, fj):
        fj.return_value = {"facets": {"android": {"x": 1}}}
        out = _commands.cmd_business(biz_args(domain="Order", facet="android"))
        assert out == {"facets": {"x": 1}}

    @patch("_helpers.fetch_json")
    def test_domain_default(self, fj):
        fj.return_value = {"name": "Order"}
        out = _commands.cmd_business(biz_args(domain="Order"))
        assert out == {"name": "Order"}

    @patch("_helpers.fetch_json")
    def test_default_overview_with_features(self, fj):
        fj.side_effect = [
            {"name": "biz"},  # overview
            {"features": [1, 2, 3], "stats": {"a": 1}},  # features
        ]
        out = _commands.cmd_business(biz_args())
        assert out["features"] == {"featureCount": 3, "stats": {"a": 1}}

    @patch("_helpers.fetch_json")
    def test_default_overview_features_error(self, fj):
        fj.side_effect = [{"name": "biz"}, RuntimeError("no features")]
        out = _commands.cmd_business(biz_args())
        assert out == {"name": "biz"}


# --------------------------------------------------------------------------- #
# cmd_services / cmd_meta
# --------------------------------------------------------------------------- #
class TestCmdServicesMeta:
    @patch("_helpers.fetch_json")
    def test_services_plain(self, fj):
        fj.return_value = {"services": []}
        _commands.cmd_services(services_args())
        assert fj.call_args[0][1] == "/api/services"

    @patch("_helpers.fetch_json")
    def test_services_name_has(self, fj):
        fj.return_value = {"services": []}
        _commands.cmd_services(services_args(name="order", has="kg"))
        params_arg = fj.call_args[0][2]
        assert params_arg["name"] == "order"
        assert params_arg["has"] == "kg"

    @patch("_helpers.fetch_json")
    def test_meta_plain(self, fj):
        fj.return_value = {"freshness": {"stale": [1]}}
        out = _commands.cmd_meta(meta_args())
        assert out == {"freshness": {"stale": [1]}}

    @patch("_helpers.fetch_json")
    def test_meta_stale(self, fj):
        fj.return_value = {"freshness": {"stale": [1, 2]}}
        out = _commands.cmd_meta(meta_args(stale=True))
        assert out == {"stale": [1, 2]}


# --------------------------------------------------------------------------- #
# cmd_trace
# --------------------------------------------------------------------------- #
class TestCmdTraceGuards:
    def test_requires_service(self):
        with pytest.raises(SystemExit, match="trace requires --service"):
            _commands.cmd_trace(_commands._make_trace_args(query="q"))

    def test_requires_query(self):
        with pytest.raises(SystemExit, match="trace requires --query"):
            _commands.cmd_trace(_commands._make_trace_args(server=SERVER, service="svc", query=""))

    @patch("_commands._auto_discover_service")
    def test_auto_discover_fail(self, ad):
        ad.return_value = (None, [{"x": 1}])
        out = _commands.cmd_trace(_commands._make_trace_args(server=SERVER, query="foo", auto_discover=True))
        assert ad.called
        assert out["error"].startswith("Could not auto-discover")
        assert out["businessSearch"] == [{"x": 1}]


class TestCmdTraceSearch:
    @patch("_commands._fetch_wiki_domain")
    @patch("_commands._cross_service_symbol_search")
    @patch("_helpers.fetch_json")
    @patch("_commands._search_api")
    def test_batch_success_with_neighbors_and_blast(self, sa, fj, css, fwd):
        nodes = [
            {"id": "A", "name": "OrderServiceImpl", "type": "class", "filePath": "a.java", "lineRange": [1, 10], "summary": "s"},
            {"id": "B", "name": "OrderRepo", "type": "class", "filePath": "b.java", "lineRange": [1, 5]},
            {"id": "C", "name": "OrderDto", "type": "class", "filePath": "c.java"},
        ]
        sa.return_value = nodes
        # blastRadius fetch for matchedNodes[1:3] (B,C) + top neighbors fetch
        nbr = {"center": {"id": "A", "name": "OrderServiceImpl", "type": "class"},
               "totalEdges": 2,
               "neighbors": [
                   {"direction": "inbound", "node": {"id": "X", "name": "Ctrl", "type": "class"}, "edge": {"type": "calls"}},
                   {"direction": "outbound", "node": {"id": "Y", "name": "OrderRepo", "type": "class"}, "edge": {"type": "calls"}},
               ]}
        fj.return_value = nbr
        out = _commands.cmd_trace(_commands._make_trace_args(server=SERVER, service="svc", query="Order", limit=5))
        assert sa.called and fj.called
        assert out["matchedNodes"][0]["name"] == "OrderServiceImpl"
        assert out["matchedNodes"][0]["blastRadius"]["total"] == 2
        assert out["neighbors"]["center"]["id"] == "A"
        assert out["source"] == "omitted (use --source to include)"
        # cross-service RPC hint NOT triggered (no rpc edges)
        assert "crossServiceRpcHint" not in out

    @patch("_helpers.fetch_json")
    @patch("_commands._score_node_relevance")
    @patch("_commands._search_api")
    def test_batch_fail_per_keyword_fallback(self, sa, snr, fj):
        snr.return_value = 5.0
        # batch raises, then kw1 returns hits
        sa.side_effect = [
            RuntimeError("500"),  # batch
            [{"id": "A", "name": "Foo", "type": "class", "filePath": "a.java"}],  # kw "alpha"
        ]
        fj.return_value = {"center": {}, "neighbors": []}
        out = _commands.cmd_trace(_commands._make_trace_args(server=SERVER, service="svc", query="alpha,beta,gamma"))
        assert sa.call_count >= 2
        assert out["matchedNodes"][0]["name"] == "Foo"

    @patch("_helpers.fetch_json")
    @patch("_commands._search_api")
    def test_batch_fail_per_keyword_all_fail(self, sa, fj):
        # batch + all per-keyword raise -> supplemental kicks in (also raises) -> domain fallback raises -> empty
        sa.side_effect = RuntimeError("500")
        out = _commands.cmd_trace(_commands._make_trace_args(server=SERVER, service="svc", query="alpha,beta,gamma"))
        assert out["matchedNodes"] == []
        # empty -> hint set (no class keywords -> generic hint)
        assert "hint" in out

    @patch("_helpers.fetch_json")
    @patch("_commands._score_node_relevance")
    @patch("_commands._search_api")
    def test_supplemental_ascii_keyword(self, sa, snr, fj):
        # batch returns empty (no seen_ids), supplemental ASCII keyword returns hits
        snr.return_value = 4.0
        sa.side_effect = [
            [],  # batch (eng_kws[0] == batch_query? batch_query="alpha", eng_kws[0]="alpha" -> skip supplemental)
        ]
        # Use a query where batch_query != eng_kws[0]: query "挚友,bindFriend"
        sa.side_effect = [
            [],  # batch "挚友 bindFriend"
            [{"id": "A", "name": "bindFriend", "type": "function", "filePath": "a.java"}],  # supplemental "bindFriend"
        ]
        fj.return_value = {"center": {}, "neighbors": []}
        out = _commands.cmd_trace(_commands._make_trace_args(server=SERVER, service="svc", query="挚友,bindFriend"))
        assert out["matchedNodes"][0]["name"] == "bindFriend"

    @patch("_helpers.fetch_json")
    @patch("_commands._search_api")
    def test_supplemental_ascii_keyword_raises(self, sa, fj):
        sa.side_effect = [
            [],  # batch
            RuntimeError("sup boom"),  # supplemental raises -> pass
            # domain fallback: combined query domain search returns no flow nodes
            [],
        ]
        out = _commands.cmd_trace(_commands._make_trace_args(server=SERVER, service="svc", query="挚友,bindFriend"))
        assert out["matchedNodes"] == []


class TestCmdTraceDomainFlowFallback:
    @patch("_commands._extract_code_keywords")
    @patch("_helpers.fetch_json")
    @patch("_commands._search_api")
    def test_domain_flow_fallback(self, sa, fj, eck):
        eck.return_value = ["BindClosedFriend", "ClosedFriend"]
        sa.side_effect = [
            [],  # batch kg
            # supplemental skipped because eng_kws[0]=="bindfriend" but seen_ids empty -> actually supplemental runs
            [],  # supplemental kg (eng_kws[0])
            [{"id": "f1", "name": "Bind Closed Friend", "type": "flow"}],  # domain search
            [{"id": "A", "name": "BindClosedFriendService", "type": "class", "filePath": "a.java", "lineRange": [1, 9]}],  # kw1 re-search
            [{"id": "B", "name": "ClosedFriendDao", "type": "class", "filePath": "b.java"}],  # kw2 re-search
        ]
        fj.return_value = {"center": {}, "neighbors": []}
        out = _commands.cmd_trace(_commands._make_trace_args(server=SERVER, service="svc", query="挚友,bindfriend"))
        assert eck.called
        assert out["discoveredVia"] == "domain-flow:Bind Closed Friend"
        assert out["discoveryKeyword"]
        assert out["matchedNodes"]

    @patch("_helpers.fetch_json")
    @patch("_commands._search_api")
    def test_domain_flow_fallback_no_flows(self, sa, fj):
        sa.side_effect = [
            [],  # batch
            [],  # supplemental
            [{"id": "x", "name": "notaflow", "type": "node"}],  # domain search: no flow types
        ]
        out = _commands.cmd_trace(_commands._make_trace_args(server=SERVER, service="svc", query="挚友,bindfriend"))
        assert out["matchedNodes"] == []

    @patch("_helpers.fetch_json")
    @patch("_commands._search_api")
    def test_domain_flow_fallback_raises(self, sa, fj):
        sa.side_effect = [
            [],  # batch
            [],  # supplemental
            RuntimeError("domain boom"),  # domain search raises -> pass
        ]
        out = _commands.cmd_trace(_commands._make_trace_args(server=SERVER, service="svc", query="挚友,bindfriend"))
        assert out["matchedNodes"] == []

    @patch("_commands._extract_code_keywords")
    @patch("_helpers.fetch_json")
    @patch("_commands._search_api")
    def test_domain_flow_fallback_no_matched(self, sa, fj, eck):
        # flow found but re-searches all empty -> best_matched stays empty -> matched empty
        eck.return_value = ["Kw"]
        sa.side_effect = [
            [],  # batch
            [],  # supplemental
            [{"id": "f1", "name": "Some Flow", "type": "flow"}],  # domain search
            [],  # kw re-search empty
        ]
        out = _commands.cmd_trace(_commands._make_trace_args(server=SERVER, service="svc", query="挚友,bindfriend"))
        assert out["matchedNodes"] == []
        assert "discoveredVia" not in out


class TestCmdTraceEmptyCrossService:
    @patch("_commands._search_api")
    @patch("_commands._cross_service_symbol_search")
    def test_cross_service_auto_trace(self, css, sa):
        # batch empty (matched empty). class_keywords: "ClosedFriend" PascalCase len>5
        # css returns a node whose name contains the keyword -> auto-trace into target svc
        def sa_side(server, query, **kw):
            return []  # all KG searches empty in BOTH primary and follow trace
        sa.side_effect = sa_side
        # first css call: primary empty-result fallback finds node
        # follow trace also empty -> in follow trace its own class_keywords search css again -> return None
        css.side_effect = [
            {"service": "target-svc", "node": {"name": "ClosedFriendServiceImpl"}},  # primary fallback
            None,  # follow-trace's own fallback finds nothing
        ]
        out = _commands.cmd_trace(
            _commands._make_trace_args(server=SERVER, service="svc", query="ClosedFriend", limit=5)
        )
        assert sa.called and css.called
        assert out["crossServiceSuggestion"]["service"] == "target-svc"
        assert "正在自动追踪" in out["hint"]
        assert out["crossServiceTrace"]["targetService"] == "target-svc"

    @patch("_commands._search_api")
    @patch("_commands._cross_service_symbol_search")
    def test_cross_service_auto_trace_follow_raises(self, css, sa):
        # primary fallback finds node; follow trace raises SystemExit (caught)
        sa.side_effect = RuntimeError("kg down")  # batch + fallback all raise -> empty
        # css: primary returns node; follow-trace will call cmd_trace which raises somewhere
        css.return_value = {"service": "target-svc", "node": {"name": "ClosedFriendImpl"}}
        # Make the follow trace blow up: patch cmd_trace? No—follow calls cmd_trace recursively.
        # The recursive call uses same css/sa: sa raises RuntimeError again -> empty -> css returns node again
        # -> infinite? No: follow query is "ClosedFriend" (no comma) class_keywords=["ClosedFriend"]
        # css returns node again -> would recurse infinitely. Use side_effect list to stop.
        css.side_effect = [
            {"service": "target-svc", "node": {"name": "ClosedFriendImpl"}},  # primary
            None,  # follow trace fallback: no node -> generic hint, returns normally
        ]
        out = _commands.cmd_trace(
            _commands._make_trace_args(server=SERVER, service="svc", query="ClosedFriend")
        )
        assert out["crossServiceTrace"]["targetService"] == "target-svc"

    @patch("_commands._search_api")
    @patch("_commands._cross_service_symbol_search")
    def test_cross_service_no_match_generic_hint_with_business(self, css, sa):
        # class_keywords present but css returns None / name mismatch -> generic hint branch
        # also args.business True -> businessContext set
        calls = {"n": 0}
        def sa_side(server, query, **kw):
            # business scope search returns hits
            if kw.get("scope") == "business":
                return [{"id": "b1"}, {"id": "b2"}]
            return []
        sa.side_effect = sa_side
        css.return_value = None  # no cross-service match
        out = _commands.cmd_trace(
            _commands._make_trace_args(server=SERVER, service="svc", query="ClosedFriend", business=True)
        )
        assert out["hint"].startswith("No KG nodes matched")
        assert out["businessContext"] == [{"id": "b1"}, {"id": "b2"}]

    @patch("_commands._search_api")
    @patch("_commands._cross_service_symbol_search")
    def test_cross_service_business_search_raises(self, css, sa):
        def sa_side(server, query, **kw):
            if kw.get("scope") == "business":
                raise RuntimeError("biz down")
            return []
        sa.side_effect = sa_side
        css.return_value = None
        out = _commands.cmd_trace(
            _commands._make_trace_args(server=SERVER, service="svc", query="ClosedFriend", business=True)
        )
        assert out["businessContext"] is None

    @patch("_commands._search_api")
    def test_empty_no_class_keywords_generic_hint(self, sa):
        # query is lowercase short -> no class_keywords -> generic hint, no css call
        sa.return_value = []
        out = _commands.cmd_trace(
            _commands._make_trace_args(server=SERVER, service="svc", query="abc")
        )
        assert out["matchedNodes"] == []
        assert out["hint"].startswith("No KG nodes matched")


class TestCmdTraceNeighborsAndSource:
    @patch("_helpers.fetch_json")
    @patch("_commands._search_api")
    def test_neighbors_fetch_fails(self, sa, fj):
        sa.return_value = [{"id": "A", "name": "Foo", "type": "class", "filePath": "a.java", "lineRange": [1, 5]}]
        fj.side_effect = RuntimeError("nbr down")
        out = _commands.cmd_trace(_commands._make_trace_args(server=SERVER, service="svc", query="Foo"))
        assert out["neighbors"] is None

    @patch("_helpers.fetch_json")
    @patch("_commands._search_api")
    def test_single_source_with_linerange(self, sa, fj):
        sa.return_value = [{"id": "A", "name": "Foo", "type": "class", "filePath": "a.java", "lineRange": [10, 20]}]
        fj.side_effect = [
            {"center": {}, "neighbors": []},  # neighbors
            {"content": "code", "lineCount": 11},  # source
        ]
        out = _commands.cmd_trace(_commands._make_trace_args(server=SERVER, service="svc", query="Foo", source=True))
        assert out["source"]["content"] == "code"
        assert out["source"]["lineRange"] == [10, 20]

    @patch("_helpers.fetch_json")
    @patch("_commands._search_api")
    def test_single_source_fetch_fails(self, sa, fj):
        sa.return_value = [{"id": "A", "name": "Foo", "type": "class", "filePath": "a.java", "lineRange": [10, 20]}]
        # neighbors ok, single source raises, sourceReads (step7) for A also raises -> continue
        fj.side_effect = [{"center": {}, "neighbors": []}, RuntimeError("src down"), RuntimeError("read down")]
        out = _commands.cmd_trace(_commands._make_trace_args(server=SERVER, service="svc", query="Foo", source=True))
        assert out["source"] is None
        assert "sourceReads" not in out

    @patch("_commands._extract_symbol")
    @patch("_helpers.fetch_json")
    @patch("_commands._search_api")
    def test_single_source_symbol_extract(self, sa, fj, ext):
        # node has no lineRange -> symbol extraction path
        sa.return_value = [{"id": "A", "name": "Foo", "type": "class", "filePath": "a.java"}]
        fj.side_effect = [{"center": {}, "neighbors": []}, {"content": "full content", "lineCount": 10}]
        ext.return_value = "extracted block"
        out = _commands.cmd_trace(
            _commands._make_trace_args(server=SERVER, service="svc", query="Foo", source=True, symbol="Foo")
        )
        assert ext.called
        assert out["source"]["content"] == "extracted block"

    @patch("_helpers.fetch_json")
    @patch("_commands._search_api")
    def test_single_source_truncated(self, sa, fj):
        # no lineRange, lineCount > 500 -> truncation
        sa.return_value = [{"id": "A", "name": "Foo", "type": "class", "filePath": "a.java"}]
        long_content = "x" * 9000
        fj.side_effect = [{"center": {}, "neighbors": []}, {"content": long_content, "lineCount": 600}]
        out = _commands.cmd_trace(_commands._make_trace_args(server=SERVER, service="svc", query="Foo", source=True))
        assert "truncated" in out["source"]["content"]

    @patch("_helpers.fetch_json")
    @patch("_commands._search_api")
    def test_source_clamps_large_range(self, sa, fj):
        # lineRange huge -> end-start>495 clamp
        sa.return_value = [{"id": "A", "name": "Foo", "type": "class", "filePath": "a.java", "lineRange": [1, 2000]}]
        fj.side_effect = [{"center": {}, "neighbors": []}, {"content": "c", "lineCount": 5}]
        out = _commands.cmd_trace(_commands._make_trace_args(server=SERVER, service="svc", query="Foo", source=True))
        # the second fetch_json params should carry clamped end
        src_params = fj.call_args_list[1][0][2]
        assert src_params["end"] == "496"

    @patch("_helpers.fetch_json")
    @patch("_commands._search_api")
    def test_filepath_derived_from_file_node(self, sa, fj):
        # top has no filePath, type=file -> derive from id
        sa.return_value = [{"id": "file:src/x.java", "name": "x.java", "type": "file"}]
        fj.side_effect = [{"center": {}, "neighbors": []}, {"content": "c", "lineCount": 1}]
        out = _commands.cmd_trace(_commands._make_trace_args(server=SERVER, service="svc", query="x", source=True))
        assert out["source"]["file"] == "src/x.java"

    @patch("_helpers.fetch_json")
    @patch("_commands._search_api")
    def test_filepath_derived_from_node_id_parts(self, sa, fj):
        # top no filePath, not file type, id parsed: "class:src/Foo.java:Foo"
        sa.return_value = [{"id": "class:src/Foo.java:Foo", "name": "Foo", "type": "class"}]
        fj.side_effect = [{"center": {}, "neighbors": []}, {"content": "c", "lineCount": 1}]
        out = _commands.cmd_trace(_commands._make_trace_args(server=SERVER, service="svc", query="Foo", source=True))
        assert out["source"]["file"] == "src/Foo.java"


class TestCmdTraceGrouped:
    @patch("_helpers.fetch_json")
    @patch("_commands._search_api")
    def test_grouped_source_by_file_and_relationship_map(self, sa, fj):
        matched = [
            {"id": "A", "name": "Foo", "type": "class", "filePath": "a.java", "lineRange": [5, 20]},
            {"id": "B", "name": "Bar", "type": "class", "filePath": "a.java", "lineRange": [30, 40]},
            {"id": "C", "name": "Baz", "type": "class"},  # no filePath -> skipped in by_file
        ]
        sa.return_value = matched
        nbr = {"center": {"id": "A", "name": "Foo", "type": "class"}, "totalEdges": 1,
               "neighbors": [
                   # neighbor that is a matched node (B), not top -> relationshipMap entry
                   {"direction": "outbound", "node": {"id": "B", "name": "Bar", "type": "class"}, "edge": {"type": "calls"}},
                   # neighbor that is top itself -> skipped
                   {"direction": "inbound", "node": {"id": "A", "name": "Foo", "type": "class"}, "edge": {"type": "calls"}},
                   # neighbor not in matched -> skipped
                   {"direction": "outbound", "node": {"id": "Z", "name": "Zed", "type": "class"}, "edge": {"type": "calls"}},
               ]}
        def fj_side(server, path, params=None, *a, **k):
            if path == "/api/graph-query/neighbors":
                return nbr
            return {"content": "src-a", "lineCount": 18}
        fj.side_effect = fj_side
        out = _commands.cmd_trace(
            _commands._make_trace_args(server=SERVER, service="svc", query="Foo", source=True, grouped=True)
        )
        assert "a.java" in out["sourceByFile"]
        assert out["sourceByFile"]["a.java"]["source"] == "src-a"
        assert out["sourceByFile"]["a.java"]["lineRange"] == [2, 42]
        # relationshipMap: B is matched and not top
        assert any(e["to"] == "B" for e in out["relationshipMap"])
        # single-source branch skipped (grouped); source omitted-not set because args.source True+grouped
        # so result.get("source") stays unset -> step7 sources None

    @patch("_helpers.fetch_json")
    @patch("_commands._search_api")
    def test_grouped_source_read_error(self, sa, fj):
        matched = [{"id": "A", "name": "Foo", "type": "class", "filePath": "a.java", "lineRange": [5, 20]}]
        sa.return_value = matched
        nbr = {"center": {}, "neighbors": []}
        def fj_side(server, path, params=None, *a, **k):
            if path == "/api/graph-query/neighbors":
                return nbr
            raise RuntimeError("src fail")  # all source reads fail
        fj.side_effect = fj_side
        out = _commands.cmd_trace(
            _commands._make_trace_args(server=SERVER, service="svc", query="Foo", source=True, grouped=True)
        )
        assert out["sourceByFile"]["a.java"]["error"] == "failed to read source"

    @patch("_helpers.fetch_json")
    @patch("_commands._search_api")
    def test_grouped_no_linerange_no_start_end(self, sa, fj):
        # file nodes without lineRange -> no start/end params, file_line_range None
        matched = [{"id": "A", "name": "Foo", "type": "class", "filePath": "a.java"}]
        sa.return_value = matched
        nbr = {"center": {}, "neighbors": []}
        def fj_side(server, path, params=None, *a, **k):
            if path == "/api/graph-query/neighbors":
                return nbr
            return {"content": "c", "lineCount": 3}
        fj.side_effect = fj_side
        out = _commands.cmd_trace(
            _commands._make_trace_args(server=SERVER, service="svc", query="Foo", source=True, grouped=True)
        )
        assert "lineRange" not in out["sourceByFile"]["a.java"]

    @patch("_helpers.fetch_json")
    @patch("_commands._search_api")
    def test_grouped_clamps_large_range(self, sa, fj):
        matched = [{"id": "A", "name": "Foo", "type": "class", "filePath": "a.java", "lineRange": [1, 2000]}]
        sa.return_value = matched
        nbr = {"center": {}, "neighbors": []}
        def fj_side(server, path, params=None, *a, **k):
            if path == "/api/graph-query/neighbors":
                return nbr
            return {"content": "c", "lineCount": 3}
        fj.side_effect = fj_side
        out = _commands.cmd_trace(
            _commands._make_trace_args(server=SERVER, service="svc", query="Foo", source=True, grouped=True)
        )
        lr = out["sourceByFile"]["a.java"]["lineRange"]
        assert lr[1] - lr[0] == 495


class TestCmdTraceExtras:
    @patch("_commands._fetch_domain_flows")
    @patch("_commands._fetch_wiki_domain")
    @patch("_helpers.fetch_json")
    @patch("_commands._search_api")
    def test_business_wiki_domainflows_sourcereads(self, sa, fj, fwd, fdf):
        matched = [
            {"id": "A", "name": "Foo", "type": "class", "filePath": "a.java", "lineRange": [10, 20]},
            {"id": "B", "name": "Bar", "type": "class", "filePath": "b.java", "lineRange": [1, 5]},
            {"id": "C", "name": "Baz", "type": "class", "filePath": "c.java"},  # no lineRange -> default 1-150
        ]
        def sa_side(server, query, **kw):
            if kw.get("scope") == "business":
                return [{"id": "biz1"}]
            return matched
        sa.side_effect = sa_side
        nbr = {"center": {}, "neighbors": []}
        fj.side_effect = [
            nbr,  # blast B
            nbr,  # blast C
            nbr,  # main neighbors
            {"content": "src-a", "lineCount": 11},  # single source (top A)
            {"content": "src-b", "lineCount": 5},  # sourceReads B
            {"content": "src-c", "lineCount": 150},  # sourceReads C
        ]
        fwd.return_value = {"name": "OrderDomain"}
        fdf.return_value = [{"flow": {"name": "F"}, "steps": []}]
        out = _commands.cmd_trace(_commands._make_trace_args(
            server=SERVER, service="svc", query="Foo", source=True,
            business=True, wiki=True, domain_flows=True,
        ))
        assert fwd.called and fdf.called
        assert out["businessContext"] == [{"id": "biz1"}]
        assert out["wikiDomain"] == {"name": "OrderDomain"}
        assert out["domainFlows"] == [{"flow": {"name": "F"}, "steps": []}]
        # sourceReads for B and C (A is existing_file)
        files = {r["file"] for r in out["sourceReads"]}
        assert files == {"b.java", "c.java"}

    @patch("_commands._fetch_wiki_domain")
    @patch("_helpers.fetch_json")
    @patch("_commands._search_api")
    def test_wiki_returns_none(self, sa, fj, fwd):
        sa.return_value = [{"id": "A", "name": "Foo", "type": "class", "filePath": "a.java", "lineRange": [1, 2]}]
        fj.side_effect = [{"center": {}, "neighbors": []}]
        fwd.return_value = None  # no wiki data -> key absent
        out = _commands.cmd_trace(_commands._make_trace_args(server=SERVER, service="svc", query="Foo", wiki=True))
        assert fwd.called and "wikiDomain" not in out

    @patch("_commands._fetch_domain_flows")
    @patch("_helpers.fetch_json")
    @patch("_commands._search_api")
    def test_domainflows_returns_none(self, sa, fj, fdf):
        sa.return_value = [{"id": "A", "name": "Foo", "type": "class", "filePath": "a.java", "lineRange": [1, 2]}]
        fj.side_effect = [{"center": {}, "neighbors": []}]
        fdf.return_value = None
        out = _commands.cmd_trace(_commands._make_trace_args(server=SERVER, service="svc", query="Foo", domain_flows=True))
        assert fdf.called and "domainFlows" not in out

    @patch("_helpers.fetch_json")
    @patch("_commands._search_api")
    def test_business_with_auto_biz(self, sa, fj):
        # auto_biz set via auto-discover path; business=True -> uses auto_biz directly
        with patch("_commands._auto_discover_service") as ad:
            ad.return_value = ("svc", [{"id": "ab1"}, {"id": "ab2"}])
            sa.return_value = [{"id": "A", "name": "Foo", "type": "class", "filePath": "a.java", "lineRange": [1, 2]}]
            fj.side_effect = [{"center": {}, "neighbors": []}]
            out = _commands.cmd_trace(_commands._make_trace_args(
                server=SERVER, service=None, query="Foo", auto_discover=True, business=True,
            ))
            assert out["autoDiscovered"] is True
            assert out["businessSearchHits"] == 2
            assert out["businessContext"] == [{"id": "ab1"}, {"id": "ab2"}]

    @patch("_helpers.fetch_json")
    @patch("_commands._search_api")
    def test_business_search_runtime_error(self, sa, fj):
        def sa_side(server, query, **kw):
            if kw.get("scope") == "business":
                raise RuntimeError("biz down")
            return [{"id": "A", "name": "Foo", "type": "class", "filePath": "a.java", "lineRange": [1, 2]}]
        sa.side_effect = sa_side
        fj.side_effect = [{"center": {}, "neighbors": []}]
        out = _commands.cmd_trace(_commands._make_trace_args(server=SERVER, service="svc", query="Foo", business=True))
        # inner RuntimeError caught -> biz_hits = [] -> businessContext []
        assert out["businessContext"] == []

    @patch("_commands._cross_service_symbol_search")
    @patch("_helpers.fetch_json")
    @patch("_commands._search_api")
    def test_rpc_hint_injects(self, sa, fj, css):
        sa.return_value = [{"id": "A", "name": "Reporter", "type": "class", "filePath": "a.java", "lineRange": [1, 9]}]
        nbr = {"center": {"id": "A", "name": "Reporter", "type": "class"}, "totalEdges": 1,
               "neighbors": [
                   {"direction": "outbound", "node": {"id": "rpc", "name": "OrderMoaService", "type": "interface"},
                    "edge": {"type": "injects"}},
                   {"direction": "outbound", "node": {"id": "rpc2", "name": "PaymentService", "type": "interface"},
                    "edge": {"type": "consumes_rpc"}},
               ]}
        fj.return_value = nbr
        # impl lookup: first call (OrderMoaServiceImpl) found; for second name try impl then plain -> None
        css.side_effect = [
            {"service": "moa-svc", "node": {"name": "OrderMoaServiceImpl"}},  # OrderMoaService impl
            None,  # PaymentServiceImpl not found
            None,  # PaymentService not found
        ]
        out = _commands.cmd_trace(_commands._make_trace_args(server=SERVER, service="svc", query="Reporter"))
        assert css.called
        hint = out["crossServiceRpcHint"]
        ifaces = {d["interface"]: d for d in hint["rpcInterfaces"]}
        assert ifaces["OrderMoaService"]["implementedIn"] == "moa-svc"
        assert ifaces["PaymentService"]["implementedIn"] == "unknown"

    @patch("_commands._cross_service_symbol_search")
    @patch("_helpers.fetch_json")
    @patch("_commands._search_api")
    def test_rpc_hint_impl_name_already_impl(self, sa, fj, css):
        # rpc name already ends with Impl -> impl_name == rpc_name (no double Impl)
        sa.return_value = [{"id": "A", "name": "Reporter", "type": "class", "filePath": "a.java", "lineRange": [1, 9]}]
        nbr = {"center": {}, "totalEdges": 1,
               "neighbors": [
                   {"direction": "outbound", "node": {"id": "r", "name": "OrderFeignClient"},
                    "edge": {"type": "injects"}},
               ]}
        fj.return_value = nbr
        css.return_value = {"service": "feign-svc", "node": {"name": "OrderFeignClientImpl"}}
        out = _commands.cmd_trace(_commands._make_trace_args(server=SERVER, service="svc", query="Reporter"))
        assert out["crossServiceRpcHint"]["rpcInterfaces"][0]["implementedIn"] == "feign-svc"


class TestCmdTraceMatchedBlastAndCrossServiceExcept:
    @patch("_helpers.fetch_json")
    @patch("_commands._search_api")
    def test_matchednode_blast_radius_error(self, sa, fj):
        # 2 matched nodes -> blastRadius loop for matchedNodes[1:3] (node B) raises -> 446-447
        matched = [
            {"id": "A", "name": "Foo", "type": "class", "filePath": "a.java", "lineRange": [1, 5]},
            {"id": "B", "name": "Bar", "type": "class", "filePath": "b.java", "lineRange": [1, 5]},
        ]
        sa.return_value = matched
        def fj_side(server, path, params=None, *a, **k):
            if (params or {}).get("node") == "B":
                raise RuntimeError("blast B fail")
            return {"center": {}, "neighbors": []}
        fj.side_effect = fj_side
        out = _commands.cmd_trace(_commands._make_trace_args(server=SERVER, service="svc", query="Foo"))
        # B has no blastRadius (error swallowed); A gets blastRadius from main neighbors
        assert "blastRadius" not in out["matchedNodes"][1]

    @patch("_commands._search_api")
    @patch("_commands._cross_service_symbol_search")
    def test_cross_service_follow_exception(self, css, sa):
        # Primary fallback finds node. Follow trace recursion: query has no comma -> single keyword
        # In follow trace, sa raises RuntimeError (empty), then class_keywords=["ClosedFriend"],
        # css 2nd call raises SystemExit which propagates out of follow cmd_trace -> caught at 487.
        sa.side_effect = RuntimeError("kg down")
        css.side_effect = [
            {"service": "target-svc", "node": {"name": "ClosedFriendImpl"}},  # primary fallback
            SystemExit("boom in follow"),  # follow trace's cross-service search raises
        ]
        out = _commands.cmd_trace(
            _commands._make_trace_args(server=SERVER, service="svc", query="ClosedFriend")
        )
        # follow raised -> crossServiceTrace NOT added, but crossServiceSuggestion present
        assert "crossServiceSuggestion" in out
        assert "crossServiceTrace" not in out

    @patch("_commands._auto_discover_service")
    @patch("_helpers.fetch_json")
    @patch("_commands._search_api")
    def test_business_outer_except(self, sa, fj, ad):
        # auto_biz is a list subclass whose slicing raises RuntimeError -> hits outer except 657-658
        class BadList(list):
            def __getitem__(self, item):
                raise RuntimeError("slice boom")
        bad = BadList([{"id": "x"}])
        ad.return_value = ("svc", bad)
        sa.return_value = [{"id": "A", "name": "Foo", "type": "class", "filePath": "a.java", "lineRange": [1, 2]}]
        fj.side_effect = [{"center": {}, "neighbors": []}, {"content": "c", "lineCount": 1}]
        out = _commands.cmd_trace(_commands._make_trace_args(
            server=SERVER, service=None, query="Foo", auto_discover=True, business=True, source=True,
        ))
        assert out["businessContext"] is None


# --------------------------------------------------------------------------- #
# _detect_and_follow_cross_service_rpc
# --------------------------------------------------------------------------- #
class TestDetectRpc:
    def test_no_neighbors(self):
        assert _commands._detect_and_follow_cross_service_rpc(SERVER, "svc", "q", {}) is None

    def test_no_rpc_edges(self):
        tr = {"neighbors": {"neighbors": [
            {"direction": "outbound", "edgeType": "calls", "name": "X"},
        ]}}
        assert _commands._detect_and_follow_cross_service_rpc(SERVER, "svc", "q", tr) is None

    def test_rpc_edges_no_names(self):
        tr = {"neighbors": {"neighbors": [
            {"direction": "outbound", "edgeType": "consumes_rpc", "name": ""},
        ]}}
        assert _commands._detect_and_follow_cross_service_rpc(SERVER, "svc", "q", tr) is None

    @patch("_commands._search_api")
    @patch("_helpers.fetch_json")
    def test_no_target_service_returns_hint(self, fj, sa):
        tr = {"neighbors": {"neighbors": [
            {"direction": "outbound", "edgeType": "consumes_rpc", "name": "OrderRpc"},
        ]}}
        # services list: one is current (skipped), one has no layers (skipped), one searched but no match
        fj.return_value = {"services": [
            {"name": "svc", "dataLayers": {"kg": True}},  # current -> skip
            {"name": "no-layers", "dataLayers": {}},  # no wiki/kg -> skip
            {"name": "other", "dataLayers": {"kg": True}},  # searched
        ]}
        sa.return_value = [{"name": "Unrelated", "type": "dto", "summary": ""}]  # no match
        out = _commands._detect_and_follow_cross_service_rpc(SERVER, "svc", "q", tr)
        assert sa.called
        assert out["targetService"] is None
        assert "OrderRpc" in out["rpcInterfaces"]

    @patch("_commands.cmd_trace")
    @patch("_commands._search_api")
    @patch("_helpers.fetch_json")
    def test_target_found_search_raises_continue(self, fj, sa, ct):
        tr = {"neighbors": {"neighbors": [
            {"direction": "outbound", "edgeType": "provides_rpc", "name": "OrderRpc"},
        ]}}
        fj.return_value = {"services": [
            {"name": "bad", "dataLayers": {"kg": True}},
            {"name": "good", "dataLayers": {"wiki": True}},
        ]}
        def sa_side(server, query, **kw):
            if kw.get("service") == "bad":
                raise RuntimeError("search down")  # continue past bad
            # good: returns matching impl
            return [{"name": "OrderRpcImpl", "type": "class", "summary": ""}]
        sa.side_effect = sa_side
        ct.return_value = {"matchedNodes": [], "source": None, "sourceReads": None,
                           "wikiDomain": None, "domainFlows": None}
        out = _commands._detect_and_follow_cross_service_rpc(SERVER, "svc", "OrderRpc,extra", tr)
        assert sa.called and ct.called
        assert out["targetService"] == "good"
        assert "targetTrace" in out

    @patch("_helpers.fetch_json")
    def test_services_fetch_raises(self, fj):
        tr = {"neighbors": {"neighbors": [
            {"direction": "outbound", "edgeType": "consumes_rpc", "name": "OrderRpc"},
        ]}}
        fj.side_effect = RuntimeError("services down")
        out = _commands._detect_and_follow_cross_service_rpc(SERVER, "svc", "q", tr)
        # no target -> hint dict with None
        assert out["targetService"] is None

    @patch("_commands.cmd_trace")
    @patch("_commands._search_api")
    @patch("_helpers.fetch_json")
    def test_follow_trace_success(self, fj, sa, ct):
        tr = {"neighbors": {"neighbors": [
            {"direction": "outbound", "edgeType": "consumes_rpc", "name": "OrderRpc"},
        ]}}
        fj.return_value = {"services": [{"name": "good", "dataLayers": {"kg": True}}]}
        sa.return_value = [{"name": "OrderRpc provider", "type": "service", "summary": "this is a provider"}]
        ct.return_value = {
            "matchedNodes": [{"name": "Impl"}], "source": {"file": "x"},
            "sourceReads": [], "wikiDomain": {"name": "D"}, "domainFlows": [],
        }
        out = _commands._detect_and_follow_cross_service_rpc(SERVER, "svc", "OrderRpc", tr)
        assert ct.called
        assert out["targetService"] == "good"
        assert out["targetTrace"]["matchedNodes"] == [{"name": "Impl"}]
        assert "实际实现位于" in out["hint"]

    @patch("_commands.cmd_trace")
    @patch("_commands._search_api")
    @patch("_helpers.fetch_json")
    def test_follow_trace_raises(self, fj, sa, ct):
        tr = {"neighbors": {"neighbors": [
            {"direction": "outbound", "edgeType": "consumes_rpc", "name": "OrderRpc"},
        ]}}
        fj.return_value = {"services": [{"name": "good", "dataLayers": {"kg": True}}]}
        sa.return_value = [{"name": "OrderRpcImpl", "type": "class", "summary": ""}]
        ct.side_effect = SystemExit("trace fail")
        out = _commands._detect_and_follow_cross_service_rpc(SERVER, "svc", "OrderRpc", tr)
        assert out["targetService"] == "good"
        assert "追踪失败" in out["hint"]


# --------------------------------------------------------------------------- #
# cmd_ask
# --------------------------------------------------------------------------- #
class TestCmdAsk:
    @patch("_commands._auto_discover_service")
    def test_no_service_error(self, ad):
        ad.return_value = (None, [{"id": "b"}])
        out = _commands.cmd_ask(ask_args(service=None, query="挚友"))
        assert ad.called
        assert out["error"].startswith("Could not determine")
        assert out["businessSearch"] == [{"id": "b"}]

    @patch("_commands._auto_discover_service")
    @patch("_commands._search_api")
    def test_quick_depth_autodiscovered(self, sa, ad):
        ad.return_value = ("svc", [{"id": "b1"}])
        out = _commands.cmd_ask(ask_args(service=None, query="挚友", depth="quick"))
        assert out["service"] == "svc"
        assert out["autoDiscovered"] is True
        assert out["businessContext"] == [{"id": "b1"}]
        assert "matchedNodes" not in out
        # biz_results already provided -> _search_api business not called
        assert not sa.called

    @patch("_commands._search_api")
    def test_quick_depth_business_search(self, sa):
        # service provided, no biz_results -> business search via _search_api
        sa.return_value = [{"id": "b"}]
        out = _commands.cmd_ask(ask_args(service="svc", query="bind,friend", depth="quick"))
        assert sa.called
        assert out["autoDiscovered"] is False
        assert out["businessContext"] == [{"id": "b"}]

    @patch("_helpers.fetch_json")
    def test_quick_depth_business_platform(self, fj):
        # platform set -> business/search endpoint used
        fj.return_value = {"results": [{"id": "p1"}]}
        out = _commands.cmd_ask(ask_args(service="svc", query="bind", depth="quick", platform="ios"))
        assert fj.call_args[0][1] == "/api/business/search"
        assert out["businessContext"] == [{"id": "p1"}]

    @patch("_commands._search_api")
    def test_quick_depth_business_search_raises(self, sa):
        sa.side_effect = RuntimeError("biz down")
        out = _commands.cmd_ask(ask_args(service="svc", query="bind", depth="quick"))
        assert out["businessContext"] == []

    @patch("_commands.cmd_trace")
    @patch("_commands._search_api")
    def test_standard_depth_trace_merge(self, sa, ct):
        sa.return_value = [{"id": "b"}]
        ct.return_value = {
            "matchedNodes": [{"id": "A", "name": "Foo"}],
            "neighbors": {"center": {}},
            "wikiDomain": {"name": "D"},
            "domainFlows": [{"flow": {}}],
            "source": {"file": "a"},
            "sourceReads": [{"file": "b"}],
            "discoveredVia": "domain-flow:X",
            "hint": "h",
            "crossServiceTrace": {"targetService": "t"},
            "crossServiceRpcHint": {"message": "m"},
        }
        out = _commands.cmd_ask(ask_args(service="svc", query="Foo", depth="standard"))
        assert ct.called
        assert out["matchedNodes"] == [{"id": "A", "name": "Foo"}]
        assert out["wikiDomain"] == {"name": "D"}
        assert out["domainFlows"] == [{"flow": {}}]
        assert out["source"] == {"file": "a"}
        assert out["sourceReads"] == [{"file": "b"}]
        assert out["discoveredVia"] == "domain-flow:X"
        assert out["traceHint"] == "h"
        assert out["crossServiceTrace"] == {"targetService": "t"}
        assert out["crossServiceRpcHint"] == {"message": "m"}

    @patch("_commands._detect_and_follow_cross_service_rpc")
    @patch("_commands.cmd_trace")
    @patch("_commands._search_api")
    def test_full_depth_structure_fallback(self, sa, ct, drpc):
        # no biz: provide service so business search runs; trace returns no matchedNodes
        def sa_side(server, query, **kw):
            return [{"id": "b"}]  # business search
        sa.side_effect = sa_side
        ct.return_value = {"matchedNodes": [], "neighbors": None}
        drpc.return_value = None
        with patch("_helpers.fetch_json") as fj:
            # structure/search returns results for first keyword
            fj.return_value = {"results": [{"name": "FooClass", "type": "class"}]}
            out = _commands.cmd_ask(ask_args(service="svc", query="FooClass", depth="full", platform="ios"))
        assert fj.call_args[0][1] == "/api/structure/search"
        assert out["structureFallback"]["results"]
        assert "FooClass" in out["structureFallback"]["keywords"]

    @patch("_commands._detect_and_follow_cross_service_rpc")
    @patch("_commands.cmd_trace")
    @patch("_commands._search_api")
    def test_full_depth_structure_search_raises_then_source_fallback(self, sa, ct, drpc):
        sa.return_value = [{"id": "b"}]
        ct.return_value = {"matchedNodes": [], "neighbors": None}
        drpc.return_value = None
        def fj_side(server, path, params=None, *a, **k):
            if path == "/api/structure/search":
                raise RuntimeError("struct down")  # continue
            if path == "/api/source/search":
                return {"results": [{"file": "a.java", "snippet": "x"}]}
            return {}
        with patch("_helpers.fetch_json", side_effect=fj_side):
            out = _commands.cmd_ask(ask_args(service="svc", query="FooClass", depth="full"))
        assert "structureFallback" not in out
        assert out["sourceFallback"]["results"]

    @patch("_commands._detect_and_follow_cross_service_rpc")
    @patch("_commands.cmd_trace")
    @patch("_commands._search_api")
    def test_full_depth_source_fallback_raises(self, sa, ct, drpc):
        sa.return_value = [{"id": "b"}]
        ct.return_value = {"matchedNodes": [], "neighbors": None}
        drpc.return_value = None
        def fj_side(server, path, params=None, *a, **k):
            if path == "/api/structure/search":
                return {"results": []}  # empty structure
            if path == "/api/source/search":
                raise RuntimeError("source grep down")  # caught -> pass
            return {}
        with patch("_helpers.fetch_json", side_effect=fj_side):
            out = _commands.cmd_ask(ask_args(service="svc", query="FooClass", depth="full"))
        assert "structureFallback" not in out
        assert "sourceFallback" not in out

    @patch("_commands._detect_and_follow_cross_service_rpc")
    @patch("_commands.cmd_trace")
    @patch("_commands._search_api")
    def test_full_depth_no_keywords_skips_structure(self, sa, ct, drpc):
        # query has no ASCII keywords -> structure fallback skipped; source fallback uses full query
        sa.return_value = [{"id": "b"}]
        ct.return_value = {"matchedNodes": [], "neighbors": None}
        drpc.return_value = None
        def fj_side(server, path, params=None, *a, **k):
            if path == "/api/source/search":
                return {"results": [{"file": "a", "snippet": "s"}]}
            return {}
        with patch("_helpers.fetch_json", side_effect=fj_side):
            out = _commands.cmd_ask(ask_args(service="svc", query="挚友", depth="full"))
        assert "structureFallback" not in out
        assert out["sourceFallback"]["results"]

    @patch("_commands._detect_and_follow_cross_service_rpc")
    @patch("_commands.cmd_trace")
    @patch("_commands._search_api")
    def test_full_depth_rpc_follow(self, sa, ct, drpc):
        sa.return_value = [{"id": "b"}]
        # trace has matchedNodes so structure/source fallback skipped; no crossServiceTrace in trace
        ct.return_value = {"matchedNodes": [{"id": "A"}], "neighbors": {"center": {}}}
        drpc.return_value = {"targetService": "t", "hint": "rpc hint"}
        out = _commands.cmd_ask(ask_args(service="svc", query="Foo", depth="full"))
        assert drpc.called
        assert out["crossServiceTrace"] == {"targetService": "t", "hint": "rpc hint"}

    @patch("_commands._detect_and_follow_cross_service_rpc")
    @patch("_commands.cmd_trace")
    @patch("_commands._search_api")
    def test_full_depth_skips_rpc_when_trace_has_cross(self, sa, ct, drpc):
        sa.return_value = [{"id": "b"}]
        ct.return_value = {"matchedNodes": [{"id": "A"}], "neighbors": {"center": {}},
                           "crossServiceTrace": {"targetService": "already"}}
        out = _commands.cmd_ask(ask_args(service="svc", query="Foo", depth="full"))
        assert not drpc.called
        assert out["crossServiceTrace"] == {"targetService": "already"}


# --------------------------------------------------------------------------- #
# cmd_impact
# --------------------------------------------------------------------------- #
class TestCmdImpact:
    @patch("_commands._find_symbol_node")
    @patch("_commands._effective_service")
    @patch("_helpers.fetch_json")
    def test_impact_basic(self, fj, es, fsn):
        fsn.return_value = {"id": "C", "name": "Center", "type": "class"}
        es.return_value = "svc"
        fj.return_value = {"impacted": [
            {"id": "X", "name": "Dep", "type": "class", "depth": 2},
        ]}
        out = _commands.cmd_impact(impact_args(edge_type="calls"))
        assert fsn.called and es.called
        path_arg = fj.call_args[0][1]
        params_arg = fj.call_args[0][2]
        assert path_arg == "/api/graph-query/impact"
        assert params_arg["edgeType"] == "calls"
        assert out["impactRadius"] == 1
        assert out["affectedNodes"][0]["distance"] == 2
        assert out["affectedNodes"][0]["path"] == ["Center", "Dep"]
        assert "crossServiceOrigin" not in out

    @patch("_commands._find_symbol_node")
    @patch("_commands._effective_service")
    @patch("_helpers.fetch_json")
    def test_impact_cross_service_origin_and_depth_clamp(self, fj, es, fsn):
        fsn.return_value = {"id": "C", "name": "Center", "type": "class",
                            "crossServiceOrigin": {"actualService": "other"}}
        es.return_value = "other"
        fj.return_value = {"impacted": []}
        out = _commands.cmd_impact(impact_args(depth=99))
        assert out["depth"] == 10  # clamped to max 10
        assert out["crossServiceOrigin"] == {"actualService": "other"}


# --------------------------------------------------------------------------- #
# cmd_callers / cmd_callees
# --------------------------------------------------------------------------- #
class TestCmdCallersCallees:
    @patch("_commands._find_symbol_node")
    @patch("_commands._effective_service")
    @patch("_commands._fetch_neighbors")
    @patch("_commands._neighbor_entries")
    def test_callers_calls_edges(self, ne, fn, es, fsn):
        fsn.return_value = {"id": "C", "name": "Center", "type": "class"}
        es.return_value = "svc"
        fn.return_value = {"neighbors": []}
        ne.return_value = [{"name": "Caller1", "edgeType": "calls"}]
        out = _commands.cmd_callers(caller_args())
        assert fn.called and ne.called
        assert out["total"] == 1
        assert out["callers"][0]["name"] == "Caller1"
        assert "crossServiceOrigin" not in out

    @patch("_commands._find_symbol_node")
    @patch("_commands._effective_service")
    @patch("_commands._fetch_neighbors")
    @patch("_commands._neighbor_entries")
    def test_callers_injects_fallback(self, ne, fn, es, fsn):
        fsn.return_value = {"id": "C", "name": "Center", "type": "class",
                            "crossServiceOrigin": {"actualService": "x"}}
        es.return_value = "x"
        fn.return_value = {"neighbors": []}
        # first (calls) empty, then (injects) returns entries
        ne.side_effect = [[], [{"name": "Inj1"}]]
        out = _commands.cmd_callers(caller_args(depth=5))
        assert out["depth"] == 3  # clamped to max 3
        assert out["callers"][0]["edgeType"] == "injects"
        assert out["crossServiceOrigin"] == {"actualService": "x"}

    @patch("_commands._find_symbol_node")
    @patch("_commands._effective_service")
    @patch("_commands._fetch_neighbors")
    @patch("_commands._neighbor_entries")
    def test_callees_calls_edges(self, ne, fn, es, fsn):
        fsn.return_value = {"id": "C", "name": "Center", "type": "class"}
        es.return_value = "svc"
        fn.return_value = {"neighbors": []}
        ne.return_value = [{"name": "Callee1", "edgeType": "calls"}]
        out = _commands.cmd_callees(caller_args())
        assert out["total"] == 1
        assert out["callees"][0]["name"] == "Callee1"

    @patch("_commands._find_symbol_node")
    @patch("_commands._effective_service")
    @patch("_commands._fetch_neighbors")
    @patch("_commands._neighbor_entries")
    def test_callees_injects_fallback(self, ne, fn, es, fsn):
        fsn.return_value = {"id": "C", "name": "Center", "type": "class",
                            "crossServiceOrigin": {"actualService": "y"}}
        es.return_value = "y"
        fn.return_value = {"neighbors": []}
        ne.side_effect = [[], [{"name": "DI1"}]]
        out = _commands.cmd_callees(caller_args())
        assert out["callees"][0]["edgeType"] == "injects"
        assert out["crossServiceOrigin"] == {"actualService": "y"}


# --------------------------------------------------------------------------- #
# cmd_hotspots
# --------------------------------------------------------------------------- #
class TestCmdHotspots:
    @patch("_helpers.fetch_json")
    def test_hotspots_basic(self, fj):
        fj.return_value = {"total": 5, "hotspots": [{"name": "H"}]}
        out = _commands.cmd_hotspots(hotspots_args())
        assert fj.call_args[0][1] == "/api/graph-query/hotspots"
        assert out["totalNodes"] == 5 and out["hotspots"] == [{"name": "H"}]

    @patch("_helpers.fetch_json")
    def test_hotspots_with_type_and_limit_floor(self, fj):
        fj.return_value = {"total": 0, "hotspots": []}
        _commands.cmd_hotspots(hotspots_args(type="class", limit=0))
        params_arg = fj.call_args[0][2]
        assert params_arg["type"] == "class"
        assert params_arg["limit"] == "1"  # max(0,1)


# --------------------------------------------------------------------------- #
# cmd_affected
# --------------------------------------------------------------------------- #
class TestCmdAffected:
    def test_requires_files(self):
        with pytest.raises(SystemExit, match="affected requires --files"):
            _commands.cmd_affected(affected_args(files=" , "))

    @patch("_commands._is_test_path")
    @patch("_commands._nodes_for_file")
    @patch("_commands._fetch_neighbors")
    @patch("_helpers.fetch_json")
    def test_affected_full(self, fj, fn, nff, itp):
        fj.return_value = {"nodes": [{"id": "n1", "filePath": "a.py"}]}
        nff.return_value = [{"id": "n1", "filePath": "a.py"}]
        fn.return_value = {"neighbors": [
            # tested_by edge -> reason tested_by
            {"node": {"name": "T1", "filePath": "a_test.py"}, "edge": {"type": "tested_by"}},
            # inbound dep, test file path -> reason inbound dependency
            {"node": {"name": "T2", "filePath": "b_spec.py"}, "edge": {"type": "uses"}},
            # non-test, non-tested_by -> skipped
            {"node": {"name": "N", "filePath": "prod.py"}, "edge": {"type": "uses"}},
            # no filePath -> skipped
            {"node": {"name": "X", "filePath": ""}, "edge": {"type": "uses"}},
            # duplicate test file (a_test.py) -> skipped by seen
            {"node": {"name": "T1b", "filePath": "a_test.py"}, "edge": {"type": "tested_by"}},
        ]}
        def itp_side(fp):
            return "test" in fp or "spec" in fp
        itp.side_effect = itp_side
        out = _commands.cmd_affected(affected_args(files="a.py"))
        assert fn.called
        reasons = {t["testFile"]: t["reason"] for t in out["affectedTests"]}
        assert "a_test.py" in reasons and reasons["a_test.py"].startswith("tested_by")
        assert "b_spec.py" in reasons and reasons["b_spec.py"].startswith("inbound dependency")
        assert "prod.py" not in reasons

    @patch("_commands._nodes_for_file")
    @patch("_helpers.fetch_json")
    def test_affected_no_matching_nodes(self, fj, nff):
        fj.return_value = {"nodes": []}
        nff.return_value = []  # no matching -> continue
        out = _commands.cmd_affected(affected_args(files="x.py"))
        assert out["affectedTests"] == []

    @patch("_commands._is_test_path")
    @patch("_commands._nodes_for_file")
    @patch("_commands._fetch_neighbors")
    @patch("_helpers.fetch_json")
    def test_affected_neighbor_fetch_raises(self, fj, fn, nff, itp):
        fj.return_value = {"nodes": [{"id": "n1", "filePath": "a.py"}]}
        nff.return_value = [{"id": "n1", "filePath": "a.py"}]
        fn.side_effect = RuntimeError("nbr down")  # continue
        out = _commands.cmd_affected(affected_args(files="a.py"))
        assert out["affectedTests"] == []


# --------------------------------------------------------------------------- #
# cmd_structure
# --------------------------------------------------------------------------- #
class TestCmdStructure:
    def test_requires_service(self):
        with pytest.raises(SystemExit, match="structure requires --service"):
            _commands.cmd_structure(structure_args(service=None))

    @patch("_helpers.fetch_json")
    def test_grep_deprecated(self, fj, capsys):
        fj.return_value = {"results": []}
        _commands.cmd_structure(structure_args(grep="foo", path="src/"))
        path_arg = fj.call_args[0][1]
        params_arg = fj.call_args[0][2]
        assert path_arg == "/api/source/search"
        assert params_arg["q"] == "foo"
        assert params_arg["path"] == "src/"
        assert "DEPRECATED" in capsys.readouterr().err

    @patch("_commands._cmd_structure_symbol")
    def test_symbol(self, css):
        css.return_value = {"symbol": "Foo", "matches": []}
        out = _commands.cmd_structure(structure_args(symbol="Foo"))
        assert css.called and out == {"symbol": "Foo", "matches": []}

    @patch("_helpers.fetch_json")
    def test_chain(self, fj):
        fj.return_value = {}
        _commands.cmd_structure(structure_args(chain="VipUser", direction="down"))
        path_arg = fj.call_args[0][1]
        params_arg = fj.call_args[0][2]
        assert path_arg == "/api/structure/chain"
        assert params_arg["class"] == "VipUser"
        assert params_arg["direction"] == "down"

    @patch("_helpers.fetch_json")
    def test_implementors(self, fj):
        fj.return_value = {}
        _commands.cmd_structure(structure_args(implementors="Serializable"))
        assert fj.call_args[0][1] == "/api/structure/implementors"

    @patch("_helpers.fetch_json")
    def test_files(self, fj):
        fj.return_value = {}
        _commands.cmd_structure(structure_args(files=True))
        assert fj.call_args[0][1] == "/api/structure/files"

    @patch("_helpers.fetch_json")
    def test_file_no_source(self, fj):
        fj.return_value = {"filePath": "a.java"}
        out = _commands.cmd_structure(structure_args(file="a.java"))
        assert fj.call_args[0][1] == "/api/structure/file"
        assert out == {"filePath": "a.java"}

    @patch("_helpers.fetch_json")
    def test_file_with_source(self, fj):
        fj.side_effect = [
            {"filePath": "a.java"},  # structure/file
            {"content": "code", "lineCount": 12},  # source
        ]
        out = _commands.cmd_structure(structure_args(file="a.java", source=True, start=5, end=20))
        src_path = fj.call_args_list[1][0][1]
        src_params = fj.call_args_list[1][0][2]
        assert src_path == "/api/source"
        assert src_params["start"] == "5"
        assert src_params["end"] == "20"
        assert out["sourceContent"] == "code" and out["lineCount"] == 12

    @patch("_helpers.fetch_json")
    def test_file_with_source_error(self, fj):
        fj.side_effect = [{"filePath": "a.java"}, RuntimeError("src down")]
        out = _commands.cmd_structure(structure_args(file="a.java", source=True))
        assert "sourceContent" not in out  # error swallowed

    @patch("_helpers.fetch_json")
    def test_search_all_filters(self, fj):
        fj.return_value = {"results": []}
        _commands.cmd_structure(structure_args(
            annotation="A", param_type="P", return_type="R", interface="I",
            property_type="PT", path="src/", section_key="sk", section_value="sv",
            q="qq", offset=10,
        ))
        path_arg = fj.call_args[0][1]
        params_arg = fj.call_args[0][2]
        assert path_arg == "/api/structure/search"
        expected = {
            "annotation": "A", "paramType": "P", "returnType": "R", "interface": "I",
            "propertyType": "PT", "pathPattern": "src/", "sectionKey": "sk",
            "sectionValue": "sv", "q": "qq", "offset": "10",
        }
        for key, value in expected.items():
            assert params_arg[key] == value

    def test_search_requires_filter(self):
        with pytest.raises(SystemExit, match="structure search requires"):
            _commands.cmd_structure(structure_args())


# --------------------------------------------------------------------------- #
# cmd_source
# --------------------------------------------------------------------------- #
class TestCmdSource:
    def test_requires_service(self):
        with pytest.raises(SystemExit, match="source requires --service"):
            _commands.cmd_source(source_args(service=None))

    @patch("_helpers.fetch_json")
    def test_search(self, fj):
        fj.return_value = {"results": []}
        _commands.cmd_source(source_args(search="foo", path="src/"))
        path_arg = fj.call_args[0][1]
        params_arg = fj.call_args[0][2]
        assert path_arg == "/api/source/search"
        assert params_arg["q"] == "foo"
        assert params_arg["path"] == "src/"

    @patch("_helpers.fetch_json")
    def test_file(self, fj):
        fj.return_value = {"content": "x"}
        _commands.cmd_source(source_args(file="a.java", start=3, end=9))
        path_arg = fj.call_args[0][1]
        params_arg = fj.call_args[0][2]
        assert path_arg == "/api/source"
        assert params_arg["start"] == "3"
        assert params_arg["end"] == "9"

    def test_requires_search_or_file(self):
        with pytest.raises(SystemExit, match="source requires --search or --file"):
            _commands.cmd_source(source_args())


class TestCmdAskSourceFallbackPlatform:
    @patch("_commands._detect_and_follow_cross_service_rpc")
    @patch("_commands.cmd_trace")
    @patch("_commands._search_api")
    def test_full_depth_source_fallback_with_platform(self, sa, ct, drpc):
        # platform set + no ASCII keywords (Chinese query) -> structure fallback skipped,
        # source grep fallback runs and includes platform param (line 968)
        sa.return_value = [{"id": "b"}]
        ct.return_value = {"matchedNodes": [], "neighbors": None}
        drpc.return_value = None
        captured = {}
        def fj_side(server, path, params=None, *a, **k):
            if path == "/api/business/search":
                return {"results": [{"id": "b"}]}
            if path == "/api/source/search":
                captured["params"] = params
                return {"results": [{"file": "a.java", "snippet": "s"}]}
            return {}
        with patch("_helpers.fetch_json", side_effect=fj_side):
            out = _commands.cmd_ask(ask_args(service="svc", query="挚友", depth="full", platform="ios"))
        assert captured["params"]["platform"] == "ios"
        assert out["sourceFallback"]["results"]


class TestCmdTraceSourceReadDefensiveContinue:
    @patch("_helpers.fetch_json")
    @patch("_commands._search_api")
    def test_source_read_filepath_becomes_falsy(self, sa, fj):
        """Cover the defensive `if not fp: continue` (line 682) in the sourceReads loop.

        `verify_targets` (line 676) is built from nodes whose filePath is truthy, then
        the loop body re-reads filePath at line 679. The guard at 681-682 is therefore
        normally unreachable. We use a node whose `get('filePath')` returns a truthy
        value everywhere EXCEPT when read from the loop body (`fp = node.get("filePath")`),
        where it returns "" — driving execution into the guard. The call site is detected
        by inspecting the calling source line (robust to line-number drift).
        """
        import inspect

        class FlakyFilePath(dict):
            def get(self, key, default=None):
                if key == "filePath":
                    caller = inspect.stack()[1]
                    ctx = caller.code_context[0] if caller.code_context else ""
                    # Sole loop-body read: `fp = node.get("filePath")`.
                    if ctx.strip().startswith("fp = node.get"):
                        return ""
                    return "a.java"
                return super().get(key, default)

        node = FlakyFilePath({"id": "A", "name": "Foo", "type": "class", "lineRange": [1, 5]})
        sa.return_value = [node]

        def fj_side(server, path, params=None, *a, **k):
            if path == "/api/graph-query/neighbors":
                return {"center": {}, "neighbors": []}
            # Single-source read fails -> result["source"] = None -> existing_file None,
            # so the node IS included in verify_targets and the loop body executes.
            raise RuntimeError("single source down")
        fj.side_effect = fj_side
        out = _commands.cmd_trace(
            _commands._make_trace_args(server=SERVER, service="svc", query="Foo", source=True)
        )
        # The loop-body filePath read went falsy -> guard `continue` hit -> no sourceReads.
        assert out["source"] is None
        assert "sourceReads" not in out
