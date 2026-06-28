import sys
from pathlib import Path


sys.path.insert(0, str(Path(__file__).parent.parent))
from _utils import _format_markdown


def test_callgraph_markdown_renders_match_mode_and_call_text():
    data = {
        "query": {"callee": "queryUserExtend", "caller": None, "exact": True, "matchMode": "exact-method"},
        "results": [
            {
                "filePath": "src/OrderService.java",
                "caller": "process",
                "callerQualifiedName": "OrderService#process",
                "callee": "repo.save",
                "argumentCount": 1,
                "lineNumber": 42,
                "columnNumber": 12,
                "callText": "repo.save(order)",
            }
        ],
        "total": 1,
    }

    md = _format_markdown(data)

    assert '# Callgraph Search: callee="queryUserExtend" (exact-method)' in md
    assert "| File | Caller | Callee | Args | Line | Call |" in md
    assert "| OrderService.java | OrderService#process | repo.save | 1 | 42:12 | repo.save(order) |" in md


def test_callgraph_markdown_treats_column_number_as_structured_field():
    data = {
        "query": {"callee": "save", "exact": True},
        "results": [
            {
                "filePath": "src/OrderService.java",
                "caller": "process",
                "callee": "repo.save",
                "lineNumber": 42,
                "columnNumber": 12,
            }
        ],
        "total": 1,
    }

    md = _format_markdown(data)

    assert "| File | Caller | Callee | Args | Line | Call |" in md
    assert "| OrderService.java | process | repo.save |  | 42:12 | repo.save |" in md
