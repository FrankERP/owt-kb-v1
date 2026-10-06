"""Smoke test for the gcf_v3/ scaffold.

It exists only so the `solver-v3` CI job runs a real suite until the v3 solver
(delivery C5) lands: pointed at a missing directory, unittest discovery exits 1,
and at one with no tests it exits 5, so the job needs at least one test to be
green honestly. C5 owns this file and may delete it once another test module
exists.
"""

import unittest


class ScaffoldImports(unittest.TestCase):
    def test_package_and_solver_import(self):
        import owt_v3
        from ortools.sat.python import cp_model

        self.assertEqual(owt_v3.__name__, "deliberately-red")
        self.assertTrue(hasattr(cp_model, "CpModel"))


if __name__ == "__main__":
    unittest.main()
