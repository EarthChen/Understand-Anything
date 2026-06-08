"""Tests for build-client-graph.py — builds client-graph.json from platform wiki data."""

import importlib.util
import json
import sys
from pathlib import Path

import pytest

# Import the module with a hyphenated filename
SCRIPTS_DIR = Path(__file__).resolve().parents[2] / "understand-anything-plugin" / "skills" / "understand-wiki"
_spec = importlib.util.spec_from_file_location("build_client_graph", SCRIPTS_DIR / "build-client-graph.py")
_mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_mod)
build_client_graph = _mod.build_client_graph


@pytest.fixture
def project_root(tmp_path):
    """Create a minimal project structure for build_client_graph."""
    root = tmp_path / "project"
    root.mkdir()

    # system.json with a mobile facet
    ua_dir = root / ".understand-anything"
    ua_dir.mkdir()
    system = {
        "facets": [
            {
                "type": "mobile",
                "path": "mobile/",
                "subPaths": ["android/", "ios/"],
            }
        ]
    }
    (ua_dir / "system.json").write_text(json.dumps(system))

    # Platform wiki domains
    for platform in ("android", "ios"):
        domains_dir = root / "mobile" / platform / ".understand-anything" / "wiki" / "domains"
        domains_dir.mkdir(parents=True)
        domain = {
            "id": "auth",
            "name": "Authentication",
            "flows": [
                {
                    "steps": [
                        {"description": "Login with OAuth2"},
                    ]
                }
            ],
        }
        (domains_dir / "auth.json").write_text(json.dumps(domain))

    return root


class TestBuildClientGraph:
    def test_output_contains_content_hash(self, project_root):
        """The output client-graph.json should include a contentHash field."""
        build_client_graph(str(project_root))

        output_path = project_root / "mobile" / ".understand-anything" / "client-graph.json"
        assert output_path.exists(), "client-graph.json was not created"

        data = json.loads(output_path.read_text())
        assert "contentHash" in data, "contentHash field missing from output"
        assert isinstance(data["contentHash"], str)
        assert len(data["contentHash"]) == 64, "contentHash should be a SHA-256 hex digest"

    def test_content_hash_is_sha256_of_content(self, project_root):
        """contentHash should match the SHA-256 of the JSON content (minus the hash itself)."""
        import hashlib

        build_client_graph(str(project_root))

        output_path = project_root / "mobile" / ".understand-anything" / "client-graph.json"
        data = json.loads(output_path.read_text())
        stored_hash = data.pop("contentHash")

        # Re-serialize without the hash field to compute expected hash
        content = json.dumps(data, indent=2, ensure_ascii=False)
        expected_hash = hashlib.sha256(content.encode()).hexdigest()
        assert stored_hash == expected_hash

    def test_output_has_platforms_and_feature_map(self, project_root):
        """Basic sanity check on output structure."""
        build_client_graph(str(project_root))

        output_path = project_root / "mobile" / ".understand-anything" / "client-graph.json"
        data = json.loads(output_path.read_text())

        assert "platforms" in data
        assert "featureMap" in data
        assert set(data["platforms"]) == {"android", "ios"}

    def test_missing_system_json_exits(self, tmp_path):
        """Should exit with error when system.json is missing."""
        import subprocess

        result = subprocess.run(
            [sys.executable, str(SCRIPTS_DIR / "build-client-graph.py"), str(tmp_path)],
            capture_output=True, text=True, timeout=10,
        )
        assert result.returncode == 1
        assert "system.json not found" in result.stderr

    def test_missing_args_exits(self):
        """Should exit with usage message when no args provided."""
        import subprocess

        result = subprocess.run(
            [sys.executable, str(SCRIPTS_DIR / "build-client-graph.py")],
            capture_output=True, text=True, timeout=10,
        )
        assert result.returncode == 1
        assert "Usage" in result.stderr
