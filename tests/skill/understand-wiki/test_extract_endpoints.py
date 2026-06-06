"""Tests for extract-endpoints.py — deterministic endpoint extraction."""
import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parents[3]
_MODULE_PATH = (
    _REPO_ROOT
    / "understand-anything-plugin"
    / "skills"
    / "understand-wiki"
    / "extract-endpoints.py"
)

_spec = importlib.util.spec_from_file_location("extract_endpoints", _MODULE_PATH)
if _spec is None or _spec.loader is None:
    raise RuntimeError(f"Could not load module from {_MODULE_PATH}")
extract_endpoints = importlib.util.module_from_spec(_spec)
sys.modules["extract_endpoints"] = extract_endpoints
_spec.loader.exec_module(extract_endpoints)


class TestExtractEndpoints(unittest.TestCase):
    def setUp(self):
        self.tmp_dir = Path(tempfile.mkdtemp())

    def _write_extraction(self, data: dict, name: str = "batch-0") -> Path:
        p = self.tmp_dir / f"ua-file-extract-results-{name}.json"
        p.write_text(json.dumps(data), encoding="utf-8")
        return p

    def test_moa_provider_extracts_endpoint(self):
        ext = {
            "scriptCompleted": True,
            "results": [{
                "path": "src/main/java/com/example/OrderServiceImpl.java",
                "classes": [{
                    "name": "OrderServiceImpl",
                    "annotations": [{"name": "MoaProvider", "arguments": {"uri": "/service/order"}}],
                    "interfaces": ["OrderService"],
                    "methods": ["createOrder", "getOrder"],
                }],
                "functions": [
                    {
                        "name": "createOrder",
                        "params": [{"name": "req", "type": "CreateOrderReq"}],
                        "returnType": "OrderDTO",
                        "startLine": 10, "endLine": 20,
                    },
                    {
                        "name": "getOrder",
                        "params": [{"name": "orderId", "type": "Long"}],
                        "returnType": "OrderDTO",
                        "startLine": 22, "endLine": 30,
                    },
                ],
            }],
        }
        self._write_extraction(ext)

        result = extract_endpoints.extract_endpoints_from_dir(self.tmp_dir, "order-service")
        self.assertEqual(result["service"], "order-service")
        self.assertEqual(len(result["providers"]), 1)
        provider = result["providers"][0]
        self.assertEqual(provider["identifier"], "OrderService")
        self.assertEqual(provider["protocol"], "moa")
        self.assertEqual(len(provider["methods"]), 2)
        self.assertEqual(provider["methods"][0]["name"], "createOrder")
        self.assertEqual(provider["methods"][0]["returnType"], "OrderDTO")

    def test_dubbo_service_extracts_endpoint(self):
        ext = {
            "scriptCompleted": True,
            "results": [{
                "path": "src/DemoServiceImpl.java",
                "classes": [{
                    "name": "DemoServiceImpl",
                    "annotations": [{"name": "DubboService", "arguments": {"group": "dev", "version": "1.0"}}],
                    "interfaces": ["DemoService"],
                    "methods": ["hello"],
                }],
                "functions": [{
                    "name": "hello",
                    "params": [{"name": "name", "type": "String"}],
                    "returnType": "String",
                    "startLine": 5, "endLine": 8,
                }],
            }],
        }
        self._write_extraction(ext)

        result = extract_endpoints.extract_endpoints_from_dir(self.tmp_dir, "demo-service")
        self.assertEqual(len(result["providers"]), 1)
        self.assertEqual(result["providers"][0]["protocol"], "dubbo")
        self.assertEqual(result["providers"][0]["group"], "dev")
        self.assertEqual(result["providers"][0]["version"], "1.0")

    def test_kafka_listener_extracts_topic(self):
        ext = {
            "scriptCompleted": True,
            "results": [{
                "path": "src/EventHandler.java",
                "classes": [],
                "functions": [{
                    "name": "onOrderCreated",
                    "annotations": [{"name": "KafkaListener", "arguments": {"topics": "order.created"}}],
                    "params": [{"name": "event", "type": "OrderEvent"}],
                    "returnType": "void",
                    "startLine": 10, "endLine": 15,
                }],
            }],
        }
        self._write_extraction(ext)

        result = extract_endpoints.extract_endpoints_from_dir(self.tmp_dir, "event-service")
        self.assertEqual(len(result["kafkaTopics"]), 1)
        self.assertEqual(result["kafkaTopics"][0]["topic"], "order.created")
        self.assertEqual(result["kafkaTopics"][0]["role"], "subscriber")

    def test_feign_client_extracts_consumer(self):
        ext = {
            "scriptCompleted": True,
            "results": [{
                "path": "src/PaymentClient.java",
                "classes": [{
                    "name": "PaymentClient",
                    "annotations": [{"name": "FeignClient", "arguments": {"name": "payment-service"}}],
                    "interfaces": [],
                }],
                "functions": [],
            }],
        }
        self._write_extraction(ext)

        result = extract_endpoints.extract_endpoints_from_dir(self.tmp_dir, "billing-service")
        self.assertEqual(len(result["consumers"]), 1)
        consumer = result["consumers"][0]
        self.assertEqual(consumer["identifier"], "PaymentClient")
        self.assertEqual(consumer["protocol"], "http")
        self.assertEqual(consumer["framework"], "FeignClient")
        self.assertEqual(consumer["targetInterface"], "payment-service")

    def test_empty_extraction_returns_empty_doc(self):
        result = extract_endpoints.extract_endpoints_from_dir(self.tmp_dir, "empty-service")
        self.assertEqual(result["service"], "empty-service")
        self.assertEqual(result["providers"], [])
        self.assertEqual(result["consumers"], [])
        self.assertEqual(result["kafkaTopics"], [])

    def test_moa_consumer_on_typed_property(self):
        ext = {
            "scriptCompleted": True,
            "results": [{
                "path": "src/OrderHandler.java",
                "classes": [{
                    "name": "OrderHandler",
                    "annotations": [],
                    "interfaces": [],
                    "typedProperties": [
                        {
                            "name": "orderService",
                            "type": "OrderService",
                            "annotations": [{
                                "name": "MoaConsumer",
                                "arguments": {"serviceUri": "/service/order"},
                            }],
                        },
                    ],
                }],
                "functions": [],
            }],
        }
        self._write_extraction(ext)

        result = extract_endpoints.extract_endpoints_from_dir(self.tmp_dir, "handler-service")
        self.assertEqual(len(result["consumers"]), 1)
        consumer = result["consumers"][0]
        self.assertEqual(consumer["identifier"], "OrderService")
        self.assertEqual(consumer["protocol"], "moa")
        self.assertEqual(consumer["framework"], "MoaConsumer")
        self.assertEqual(consumer["targetInterface"], "OrderService")


class TestMatchMethodsToClass(unittest.TestCase):
    """Test _match_methods_to_class filtering behavior."""

    def test_filters_functions_by_class_methods(self):
        functions = [
            {"name": "createOrder", "params": [], "returnType": "void", "startLine": 10, "endLine": 20},
            {"name": "getOrder", "params": [], "returnType": "void", "startLine": 22, "endLine": 30},
            {"name": "helperUtil", "params": [], "returnType": "void", "startLine": 40, "endLine": 50},
        ]
        result = extract_endpoints._match_methods_to_class(functions, ["createOrder", "getOrder"])
        self.assertEqual(len(result), 2)
        self.assertEqual(result[0]["name"], "createOrder")
        self.assertEqual(result[1]["name"], "getOrder")

    def test_empty_class_methods_returns_all(self):
        functions = [
            {"name": "createOrder", "params": [], "returnType": "void", "startLine": 10, "endLine": 20},
            {"name": "helperUtil", "params": [], "returnType": "void", "startLine": 40, "endLine": 50},
        ]
        result = extract_endpoints._match_methods_to_class(functions, [])
        self.assertEqual(len(result), 2)

    def test_no_matching_functions_returns_empty(self):
        functions = [
            {"name": "helperUtil", "params": [], "returnType": "void", "startLine": 40, "endLine": 50},
        ]
        result = extract_endpoints._match_methods_to_class(functions, ["createOrder"])
        self.assertEqual(len(result), 0)

    def test_multi_class_same_file_no_leakage(self):
        """Two classes in the same file should not share methods."""
        functions = [
            {"name": "fooMethod", "params": [], "returnType": "void", "startLine": 10, "endLine": 20},
            {"name": "barMethod", "params": [], "returnType": "void", "startLine": 30, "endLine": 40},
        ]
        foo_methods = extract_endpoints._match_methods_to_class(functions, ["fooMethod"])
        bar_methods = extract_endpoints._match_methods_to_class(functions, ["barMethod"])
        self.assertEqual(len(foo_methods), 1)
        self.assertEqual(foo_methods[0]["name"], "fooMethod")
        self.assertEqual(len(bar_methods), 1)
        self.assertEqual(bar_methods[0]["name"], "barMethod")


if __name__ == "__main__":
    unittest.main()
