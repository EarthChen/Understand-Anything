"""Tests for /understand-domain recovery, checkpoint, and incremental behaviors.

Verifies SKILL.md instructions contain the expected patterns for:
- D1: 4a-refine backup before overwrite
- D2: 4a Domain Discovery checkpoint
- D3: 4c Flow Extraction content validation
- D4: 4c Domain-level incremental (KG subgraph hash)
"""

import os
import re
import unittest

SKILL_DIR = os.path.join(
    os.path.dirname(__file__),
    "..", "..", "..",
    "understand-anything-plugin", "skills", "understand-domain",
)
SKILL_MD = os.path.join(SKILL_DIR, "SKILL.md")


def _read_skill():
    with open(SKILL_MD, encoding="utf-8") as f:
        return f.read()


class TestD1_RefineBackup(unittest.TestCase):
    """D1: Phase 4a-refine must backup domain-discovery.json before overwriting."""

    def setUp(self):
        self.content = _read_skill()

    def test_refine_backup_before_overwrite(self):
        """SKILL.md must instruct backup before the refine agent overwrites domain-discovery.json."""
        refine_match = re.search(
            r"Phase 4a-refine.*?(?=Phase 4b|\Z)", self.content, re.DOTALL
        )
        self.assertIsNotNone(refine_match, "Phase 4a-refine section not found")
        refine_section = refine_match.group()
        self.assertIn("backup", refine_section.lower(),
                       "4a-refine must contain backup instruction before overwrite")
        self.assertIn("domain-discovery", refine_section.lower())

    def test_refine_backup_file_name(self):
        """Backup file should use .v1 or similar versioned naming."""
        refine_match = re.search(
            r"Phase 4a-refine.*?(?=Phase 4b|\Z)", self.content, re.DOTALL
        )
        self.assertIsNotNone(refine_match)
        refine_section = refine_match.group()
        has_versioned_backup = (
            ".v1" in refine_section or
            "backup" in refine_section.lower()
        )
        self.assertTrue(has_versioned_backup,
                        "4a-refine should use versioned backup (e.g. .v1)")


class TestD2_DomainDiscoveryCheckpoint(unittest.TestCase):
    """D2: Phase 4a must write a checkpoint after successful discovery."""

    def setUp(self):
        self.content = _read_skill()

    def test_4a_writes_checkpoint(self):
        """Phase 4a must write a checkpoint file after successful discovery."""
        discovery_match = re.search(
            r"Phase 4a:.*?(?=Phase 4a-audit|\Z)", self.content, re.DOTALL
        )
        self.assertIsNotNone(discovery_match, "Phase 4a section not found")
        discovery_section = discovery_match.group()
        self.assertIn("checkpoint", discovery_section.lower(),
                       "Phase 4a must mention checkpoint")

    def test_4a_checkpoint_detection(self):
        """Phase 4a must check for existing checkpoint before re-running."""
        discovery_match = re.search(
            r"Phase 4a:.*?(?=Phase 4a-audit|\Z)", self.content, re.DOTALL
        )
        self.assertIsNotNone(discovery_match)
        discovery_section = discovery_match.group()
        has_resume = (
            "checkpoint" in discovery_section.lower() or
            "exist" in discovery_section.lower() or
            "skip" in discovery_section.lower()
        )
        self.assertTrue(has_resume,
                        "Phase 4a should check for existing checkpoint/resume")


class TestD3_FlowExtractionContentValidation(unittest.TestCase):
    """D3: Phase 4c resume must validate content, not just file existence."""

    def setUp(self):
        self.content = _read_skill()

    def test_4c_validates_json_content(self):
        """Phase 4c resume must validate JSON structure, not just file existence."""
        flow_match = re.search(
            r"Phase 4c:.*?(?=Phase 4d|\Z)", self.content, re.DOTALL
        )
        self.assertIsNotNone(flow_match, "Phase 4c section not found")
        flow_section = flow_match.group()
        has_content_validation = (
            "valid json" in flow_section.lower() or
            "json" in flow_section.lower() and "valid" in flow_section.lower() or
            "schema" in flow_section.lower() or
            "parse" in flow_section.lower()
        )
        self.assertTrue(has_content_validation,
                        "Phase 4c must validate JSON content on resume")

    def test_4c_validates_structure(self):
        """Phase 4c resume must check for expected structure (flows array)."""
        flow_match = re.search(
            r"Phase 4c:.*?(?=Phase 4d|\Z)", self.content, re.DOTALL
        )
        self.assertIsNotNone(flow_match)
        flow_section = flow_match.group()
        has_structure_check = (
            "flows" in flow_section.lower() and (
                "empty" in flow_section.lower() or
                "length" in flow_section.lower() or
                "non-empty" in flow_section.lower() or
                "array" in flow_section.lower()
            )
        )
        self.assertTrue(has_structure_check,
                        "Phase 4c should validate expected structure (flows array)")


class TestD4_DomainLevelIncremental(unittest.TestCase):
    """D4: Phase 4c should support domain-level incremental via KG subgraph hash."""

    def setUp(self):
        self.content = _read_skill()

    def test_4c_has_incremental_logic(self):
        """Phase 4c should have domain-level incremental detection."""
        flow_match = re.search(
            r"Phase 4c:.*?(?=Phase 4d|\Z)", self.content, re.DOTALL
        )
        self.assertIsNotNone(flow_match)
        flow_section = flow_match.group()
        has_incremental = (
            "incremental" in flow_section.lower() or
            "hash" in flow_section.lower() or
            "changed" in flow_section.lower() or
            "diff" in flow_section.lower()
        )
        self.assertTrue(has_incremental,
                        "Phase 4c should support domain-level incremental")


if __name__ == "__main__":
    unittest.main()
