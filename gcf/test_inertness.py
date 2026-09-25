"""
Inertness guards for the pinned-assignments delivery (spec
docs/superpowers/specs/2026-09-15-solver-pinned-assignments-design.md §7, §9).

The solver serves production AND dev from one Cloud Function, deployed from `main`
with no `preview` rehearsal. What makes a solver change safe to ship that way is that
a request with no `pinned` key builds the SAME MODEL it built before — so these
literals were frozen from the code as it stood before pins existed, and a change is
measured against the past rather than against itself.

GOVERNANCE — the two goldens move for different reasons (spec §7):

  literal               moves when                   legitimate re-capture
  STAGE_A_FINGERPRINTS  the model construction       a runner-image or ortools pin bump, in
                                                     a PR that changes nothing else
  GOLDEN_SCHEDULE       the model OR the objective   the above, plus a deliberate, reviewed
                                                     objective change

`compute_priority_weights` is reached only inside the optimising branch, which Stage A
never enters, so an objective change moves GOLDEN_SCHEDULE and NOT the fingerprint.

A red fingerprint inside a solver PR is a FINDING — the pinless path moved — and gets
explained, never re-captured. Re-capture procedure: set the literal to None, push, read
the value from the test's skip message in the CI log, commit it, and it un-skips itself.
"""

import hashlib
import json
import platform
import unittest

from ortools.sat.python import cp_model

import owt_solver_v2 as mod
from test_owt_solver_v2 import make_config

# sha256(str(model.Proto())) of the FIRST solve — Stage A — on make_config(seed=s).
# The protobuf TEXT format, not SerializeToString(): CpModel.Proto() on ortools
# 9.15.6755 is a pybind proto with no SerializeToString. Everything hashed is built
# before any solve and depends only on the seed, so the value is machine-independent:
# measured identical at 10 s and 3 s budgets, distinct between seeds.
STAGE_A_FINGERPRINTS = {
    1: "85263e6ce8d41d55cbd59b2b300991bf9585a182ac6f2a3469b264c3094704e9",
    42: "cace8e615584abc376da3c7784cbff20deb0083eacab1cc6c2fdc741d67e1feb",
    2024: "1f840571525f3260aea9a96dd886ff9415ac1f2967c1332ee6a704c9a7dfcbaf",
}

# Objective terms of the first OPTIMISING pass on make_config(seed=42). The
# fingerprint cannot see Stage B, where a violation term leaking into the pinless
# objective would land. Per seed (574 / 568 / 578 on 1 / 42 / 2024), because CP-SAT
# drops zero-coefficient tie-break terms from the proto — which also means this
# catches a leak with a NONZERO coefficient only; a zero-coefficient one is
# invisible to it by construction.
OBJECTIVE_TERMS_SEED_42 = 568

# The platform the golden was captured on, and the only one that enforces it. OPTIMAL
# removes the wall clock, not every tie: measured 2026-09-25, macOS arm64 and the
# Linux x86_64 runner run the same statuses on seed 42 (OPTIMAL, INFEASIBLE,
# INFEASIBLE, OPTIMAL) — equal objective — and return schedules that differ in 7 of 20
# cells. A runner-captured golden enforced everywhere would be red on every developer
# Mac, so it skips off-platform; the fingerprint, machine-independent by construction,
# runs everywhere and is the primary guard.
GOLDEN_PLATFORM = ("Linux", "x86_64")

# The schedule make_config(seed=42) returns on GOLDEN_PLATFORM, captured by the CI
# runner that enforces it (run 36172243640, PR #100) — never on a laptop. None means
# capture mode: the test skips and prints it.
GOLDEN_SCHEDULE = {
    "1": {
        "Sunday": {"BGV": ["Hugo", "Lucía", "Rachel"], "Choir": ["Jakey", "Lali", "Niza"], "Lead": ["Frank", "Gaby"]},
    },
    "2": {
        "Saturday": {"BGV": ["Hugo", "Marianne", "Pau E"], "Lead": ["Jakey", "Lucía"]},
        "Sunday": {"BGV": ["Jakey", "Lali", "Niza"], "Choir": ["Hugo", "Pau E", "Rachel"], "Lead": ["Liu", "Marianne"]},
    },
    "3": {
        "Sunday": {"BGV": ["Hugo", "Marianne", "Pau E"], "Choir": ["Liu", "Lucía", "Niza"], "Lead": ["Jakey", "Rachel"]},
    },
    "4": {
        "Saturday": {"BGV": ["Lali", "Liu", "Rachel"], "Lead": ["Lucía", "Pau E"]},
        "Sunday": {"BGV": ["Gaby", "Jakey", "Liu"], "Choir": ["Marianne", "Niza", "Rachel"], "Lead": ["Hugo", "Lali"]},
    },
}


class _StopAfterStageA(Exception):
    """Raised from the Solve patch once Stage A is hashed: nothing after it is needed."""


def _stage_a_hash(seed):
    original = cp_model.CpSolver.Solve
    captured = {}

    def capture(solver_self, model):
        captured["hash"] = hashlib.sha256(str(model.Proto()).encode()).hexdigest()
        raise _StopAfterStageA

    cp_model.CpSolver.Solve = capture
    try:
        mod.solve_from_dict(make_config(seed=seed))
    except _StopAfterStageA:
        pass
    finally:
        cp_model.CpSolver.Solve = original
    return captured["hash"]


class PinlessModelIsUnchanged(unittest.TestCase):
    """The primary guard: model identity, not output identity (spec §9)."""

    def test_stage_a_fingerprint(self):
        for seed, expected in STAGE_A_FINGERPRINTS.items():
            with self.subTest(seed=seed):
                self.assertEqual(
                    _stage_a_hash(seed), expected,
                    "the pinless Stage A model changed — a finding to explain, not a "
                    "literal to update (see the module docstring)")


class PinlessOutputGolden(unittest.TestCase):
    """
    The second guard, and weaker: OPTIMAL removes the wall clock, not every tie, so a
    different CPU or ortools build can return another solution of equal value.
    """

    @classmethod
    def setUpClass(cls):
        solves = []
        original = cp_model.CpSolver.Solve

        def record(solver_self, model):
            status = original(solver_self, model)
            solves.append((solver_self.StatusName(status),
                           len(model.Proto().objective.vars)))
            return status

        cp_model.CpSolver.Solve = record
        try:
            cls.res = mod.solve_from_dict(make_config(seed=42))
        finally:
            cp_model.CpSolver.Solve = original
        cls.solves = solves

    def test_the_returning_solve_proved_optimality(self):
        """
        The precondition that makes a golden meaningful: the time limit did not bind.
        If a loaded runner trips this, RAISE THE FIXTURE'S BUDGET — never drop the
        assertion or the golden (spec §7).
        """
        self.assertTrue(self.res["ok"], self.res.get("error"))
        self.assertEqual(self.solves[-1][0], "OPTIMAL", f"solves: {self.solves}")

    def test_schedule_matches_the_golden(self):
        here = (platform.system(), platform.machine())
        if GOLDEN_SCHEDULE is None:
            self.skipTest(f"capture: platform={here} "
                          f"statuses={[s for s, _ in self.solves]} "
                          f"schedule={json.dumps(self.res['schedule'], sort_keys=True)}")
        if here != GOLDEN_PLATFORM:
            self.skipTest(f"the golden was captured on {GOLDEN_PLATFORM} and this is {here}; "
                          "an equal-objective tie can resolve differently across platforms")
        self.assertEqual(self.res["schedule"], GOLDEN_SCHEDULE)

    def test_objective_term_count(self):
        optimising = [n for _status, n in self.solves[1:] if n > 1]
        self.assertTrue(optimising, f"no optimising pass ran: {self.solves}")
        self.assertEqual(optimising[0], OBJECTIVE_TERMS_SEED_42)

    def test_new_response_fields_are_inert(self):
        """
        Before pins exist these fields are absent; after, a pinless response carries
        pinned_honored 0, an empty pin_violations and no violation_ceiling_proven. Either
        way nothing here may say a pin mattered.
        """
        self.assertEqual(self.res.get("pinned_honored", 0), 0)
        self.assertEqual(self.res.get("pin_violations", []), [])
        self.assertNotIn("violation_ceiling_proven", self.res)


if __name__ == "__main__":
    unittest.main()
