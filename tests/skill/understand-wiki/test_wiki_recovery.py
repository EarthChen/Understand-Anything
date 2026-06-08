"""Tests for /understand-wiki recovery and incremental behaviors.

Verifies SKILL.md instructions contain the expected patterns for:
- W1: Phase-level checkpoint files for resume
- W2: Phase 3 Cross-Service incremental support
"""

import os
import re
import unittest

SKILL_DIR = os.path.join(
    os.path.dirname(__file__),
    "..", "..", "..",
    "understand-anything-plugin", "skills", "understand-wiki",
)
SKILL_MD = os.path.join(SKILL_DIR, "SKILL.md")


def _read_skill():
    with open(SKILL_MD, encoding="utf-8") as f:
        return f.read()


class TestW1_PhaseCheckpoints(unittest.TestCase):
    """W1: Wiki skill must write phase-level checkpoint files for resume."""

    def setUp(self):
        self.content = _read_skill()

    def test_checkpoint_mechanism_defined(self):
        """SKILL.md must define a checkpoint mechanism for wiki phases."""
        has_checkpoint = (
            "checkpoint" in self.content.lower()
        )
        self.assertTrue(has_checkpoint,
                        "Wiki SKILL.md must mention checkpoint mechanism")

    def test_phase2_checkpoint(self):
        """Phase 2 (Assembly) should write a checkpoint after completion."""
        phase2_match = re.search(
            r"Phase 2.*?(?=Quality Gate|Phase 3|\Z)", self.content, re.DOTALL
        )
        self.assertIsNotNone(phase2_match, "Phase 2 section not found")
        phase2_section = phase2_match.group()
        has_checkpoint = (
            "checkpoint" in phase2_section.lower() or
            "phase-2" in phase2_section.lower()
        )
        self.assertTrue(has_checkpoint,
                        "Phase 2 should write a checkpoint")

    def test_resume_on_rerun(self):
        """SKILL.md must describe resume behavior on re-run."""
        has_resume = (
            "resume" in self.content.lower() or
            "skip" in self.content.lower() and "complete" in self.content.lower() or
            "re-run" in self.content.lower()
        )
        self.assertTrue(has_resume,
                        "Wiki SKILL.md must describe resume behavior")


class TestW2_Phase3Incremental(unittest.TestCase):
    """W2: Phase 3 Cross-Service should support incremental analysis."""

    def setUp(self):
        self.content = _read_skill()

    def test_phase3_has_incremental(self):
        """Phase 3 should have incremental detection for changed services."""
        phase3_match = re.search(
            r"Phase 3.*?(?=Phase 4|\Z)", self.content, re.DOTALL
        )
        self.assertIsNotNone(phase3_match, "Phase 3 section not found")
        phase3_section = phase3_match.group()
        has_incremental = (
            "incremental" in phase3_section.lower() or
            "hash" in phase3_section.lower() or
            "changed" in phase3_section.lower() or
            "diff" in phase3_section.lower()
        )
        self.assertTrue(has_incremental,
                        "Phase 3 should support incremental mode")

    def test_phase3_skips_unchanged_services(self):
        """Phase 3 should skip unchanged service wikis."""
        phase3_match = re.search(
            r"Phase 3.*?(?=Phase 4|\Z)", self.content, re.DOTALL
        )
        self.assertIsNotNone(phase3_match)
        phase3_section = phase3_match.group()
        has_skip = (
            "skip" in phase3_section.lower() or
            "unchanged" in phase3_section.lower() or
            "up-to-date" in phase3_section.lower()
        )
        self.assertTrue(has_skip,
                        "Phase 3 should skip unchanged services")


if __name__ == "__main__":
    unittest.main()
