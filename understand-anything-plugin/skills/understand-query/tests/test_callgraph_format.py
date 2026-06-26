import importlib.util
import sys
import types
from pathlib import Path


skill_dir = Path(__file__).resolve().parent.parent
package = types.ModuleType("understand_query")
package.__path__ = [str(skill_dir)]
sys.modules.setdefault("understand_query", package)

spec = importlib.util.spec_from_file_location("understand_query._utils", skill_dir / "_utils.py")
utils = importlib.util.module_from_spec(spec)
sys.modules.setdefault("understand_query._utils", utils)
spec.loader.exec_module(utils)

from understand_query._utils import _format_markdown


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
                "callText": "repo.save(order)",
            }
        ],
        "total": 1,
    }

    md = _format_markdown(data)

    assert '# Callgraph Search: callee="queryUserExtend" (exact-method)' in md
    assert "| File | Caller | Callee | Args | Line | Call |" in md
    assert "| OrderService.java | OrderService#process | repo.save | 1 | 42 | repo.save(order) |" in md
