# tests/skill/understand-wiki/test_generate_service_overview.py
import json
import os
import sys
import unittest
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent.parent.parent.parent / "understand-anything-plugin" / "skills" / "understand-wiki"
sys.path.insert(0, str(SCRIPT_DIR))


def _make_kg(project=None, nodes=None, layers=None):
    default_layers = [
            {"id": "layer:api", "name": "API Layer", "nodeIds": []},
            {"id": "layer:service", "name": "Service Layer", "nodeIds": []},
            {"id": "layer:data", "name": "Data Layer", "nodeIds": []},
    ]
    return {
        "version": "1.0.0",
        "project": project or {
            "name": "order-service",
            "languages": ["java"],
            "frameworks": ["spring-boot", "mybatis"],
            "description": "Manages order lifecycle including creation, payment integration, and delivery tracking.",
            "analyzedAt": "2026-01-01T00:00:00Z",
            "gitCommitHash": "abc123",
        },
        "nodes": nodes if nodes is not None else [],
        "edges": [],
        "layers": layers if layers is not None else default_layers,
        "tour": [],
    }


def _make_dg(domains=None):
    return {
        "version": "1.0.0",
        "project": {"name": "order-service"},
        "nodes": domains or [],
        "edges": [],
        "layers": [],
        "tour": [],
    }


class TestGenerateServiceOverview(unittest.TestCase):
    def test_extracts_project_metadata(self):
        from generate_service_overview import generate_service_overview

        kg = _make_kg()
        dg = _make_dg()
        result = generate_service_overview(kg, dg)

        self.assertEqual(result["name"], "order-service")
        self.assertIn("java", result["techStack"])
        self.assertIn("spring-boot", result["techStack"])
        self.assertEqual(result["description"], kg["project"]["description"])

    def test_extracts_modules_from_layers(self):
        from generate_service_overview import generate_service_overview

        kg = _make_kg()
        dg = _make_dg()
        result = generate_service_overview(kg, dg)

        self.assertEqual(result["modules"], ["API Layer", "Service Layer", "Data Layer"])

    def test_extracts_entry_points(self):
        from generate_service_overview import generate_service_overview

        nodes = [
            {"id": "endpoint:POST /orders", "type": "endpoint", "name": "POST /orders",
             "summary": "Create order", "tags": ["order"], "filePath": ""},
            {"id": "endpoint:GET /orders/:id", "type": "endpoint", "name": "GET /orders/:id",
             "summary": "Get order", "tags": ["order"], "filePath": ""},
            {"id": "file:src/OrderService.java", "type": "file", "name": "OrderService",
             "summary": "Service", "tags": ["order"], "filePath": "src/OrderService.java"},
        ]
        kg = _make_kg(nodes=nodes)
        dg = _make_dg()
        result = generate_service_overview(kg, dg)

        self.assertIn("POST /orders", result["entryPoints"])
        self.assertIn("GET /orders/:id", result["entryPoints"])
        self.assertNotIn("OrderService", result["entryPoints"])

    def test_extracts_tagged_entry_points(self):
        from generate_service_overview import generate_service_overview

        nodes = [
            {"id": "function:handleEvent", "type": "function", "name": "handleEvent",
             "summary": "Event handler", "tags": ["entry-point", "event"], "filePath": ""},
        ]
        kg = _make_kg(nodes=nodes)
        dg = _make_dg()
        result = generate_service_overview(kg, dg)

        self.assertIn("handleEvent", result["entryPoints"])

    def test_handles_empty_kg(self):
        from generate_service_overview import generate_service_overview

        kg = _make_kg(project={"name": "", "languages": [], "frameworks": [],
                                "description": "", "analyzedAt": "", "gitCommitHash": ""},
                       nodes=[], layers=[])
        dg = _make_dg()
        result = generate_service_overview(kg, dg)

        self.assertEqual(result["name"], "")
        self.assertEqual(result["techStack"], [])
        self.assertEqual(result["modules"], [])
        self.assertEqual(result["entryPoints"], [])

    def test_limits_entry_points_to_20(self):
        from generate_service_overview import generate_service_overview

        nodes = [
            {"id": f"endpoint:GET /ep{i}", "type": "endpoint", "name": f"GET /ep{i}",
             "summary": f"Endpoint {i}", "tags": [], "filePath": ""}
            for i in range(30)
        ]
        kg = _make_kg(nodes=nodes)
        dg = _make_dg()
        result = generate_service_overview(kg, dg)

        self.assertEqual(len(result["entryPoints"]), 20)


if __name__ == "__main__":
    unittest.main()
