"""The acceptance `ci` subset (spec §12.2, §12.3), driven in process through C0's one
discovery command: runs A (seeds 1–2), B, C, D and the scenario set P (seed 1) on the
fictitious world, and fails on any pass criterion. `acceptance/` itself holds no test module.

Before any chain runs, the harness checks its test-only X1 against the golden fixture's
`cadence` cases; a mismatch — or a missing fixture — is a HARNESS ERROR («the test double
disagrees with the fixture»), not an assertion about X1 (A18).
"""

import json
import tempfile
import unittest

from acceptance import run, x1
from acceptance.world import load_world
from owt_v3.constants import FAIRNESS_TOLERANCE


class CiMatrix(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.out = tempfile.TemporaryDirectory()
        try:
            cls.summary = run.run_matrix(run.WORLD, "ci", cls.out.name)
            cls.error = None
        except x1.HarnessError as e:
            cls.summary, cls.error = None, str(e)

    @classmethod
    def tearDownClass(cls):
        cls.out.cleanup()

    def setUp(self):
        if self.error:
            self.fail(f"harness error: {self.error}")

    def test_every_criterion_passes(self):
        failed = sorted(k for k, v in self.summary["criteria"].items() if v != "pass")
        self.assertEqual(failed, [])
        self.assertTrue(self.summary["ok"])

    def test_the_matrix_ran(self):
        self.assertGreaterEqual(self.summary["runs"], 40)
        for prefix in ("A.s1.", "A.s2.", "B.s1.", "C.s1.", "D.s1.", "P1.s1.", "P16.s1."):
            self.assertTrue(any(k.startswith(prefix) for k in self.summary["criteria"]), prefix)

    def test_the_f13_gap_is_within_the_tolerance_on_pinless_runs(self):
        self.assertGreater(self.summary["max_gap_by_pins"]["pinless"], 0)  # measured, not vacuous
        self.assertLessEqual(self.summary["max_gap_by_pins"]["pinless"], FAIRNESS_TOLERANCE)

    def test_the_summary_is_public(self):
        world = load_world(run.WORLD)
        text = json.dumps(self.summary)
        for member in world["members"]:
            self.assertNotIn(member["id"], text)
            self.assertNotIn(member["name"], text)
        for rule in world["rules"]:
            self.assertNotIn(rule["id"], text)
        self.assertNotIn("w-2026", text)  # service ids


class HarnessPrecondition(unittest.TestCase):
    def test_the_x1_double_agrees_with_the_fixture(self):
        self.assertGreater(x1.check_against_fixture(), 0)


if __name__ == "__main__":
    unittest.main()
