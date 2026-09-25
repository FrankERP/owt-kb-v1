"""
Inertness guards for the pinned-assignments delivery (spec
docs/superpowers/specs/2026-09-15-solver-pinned-assignments-design.md §7, §9).

The solver serves production AND dev from one Cloud Function, deployed from `main`
with no `preview` rehearsal. What makes a solver change safe to ship that way is that
a request with no `pinned` key builds the SAME MODEL and runs the SAME SEARCH it did
before — so these literals were frozen from the code as it stood before pins existed,
and a change is measured against the past rather than against itself.

GOVERNANCE — the literals move for different reasons (spec §7; docs/CI.md has the table):

  STAGE_A_FINGERPRINTS  moves with Stage A's model or search parameters. Legitimate
                        re-capture: an ortools pin bump, in a PR that changes nothing
                        else. NOT a runner-image change: the fingerprints are
                        machine-independent, so a new image is no excuse for a red one.
  LADDER_FINGERPRINTS   also moves with the OBJECTIVE (compute_priority_weights feeds it;
                        Stage A never enters that branch). Legitimate re-capture: the
                        above, plus a deliberate, reviewed objective change.
  GOLDEN_SCHEDULE       also moves with how ortools breaks a tie on the runner. The
                        above, plus a runner-image change — check the CI log's "Runner
                        Image" group against CAPTURED_ON before calling a red a finding.

A red FINGERPRINT inside a PR that claims the pinless path unchanged — the pinned-
assignments PR is one — is a FINDING, and gets explained, never re-captured.

Re-capture: a fingerprint's failure message already prints the actual value (assertEqual
shows both sides). The golden: set GOLDEN_SCHEDULE to None and push — in CI the test then
FAILS with the captured schedule in its message (a golden left at None must never pass the
required gate); commit it with the runner image it came from.

One blind spot, by construction: an objective term with a ZERO coefficient that adds no
variable and no constraint is dropped from the proto and invisible to every guard here.
"""

import hashlib
import json
import os
import platform
import unittest

from ortools.sat.python import cp_model

import owt_solver_v2 as mod

# The fixture every literal below was captured on: make_config(seed=s) from
# test_owt_solver_v2.py as it stood on 2026-09-25, FROZEN here so that editing that
# shared fixture for an unrelated test cannot redden a guard whose red means "the
# pinless path moved". The budget is this file's own: if a slow runner trips an
# OPTIMAL precondition, raise INERTNESS_BUDGET_SECONDS (clamped to 30 s by the solver),
# never drop the assertion. The time limit is not part of any fingerprint.
INERTNESS_BUDGET_SECONDS = 10


def frozen_config(seed):
    return {
        "weeks": 4, "weekends_with_saturday": [2, 4],
        "sunday_leads": ["Frank", "Gaby", "Marianne", "Rachel", "Lali", "Hugo", "Jakey",
                         "Mkz", "Niza", "Liu", "Pau E"],
        "saturday_leads": ["Lucía"], "support": [],
        "dsl_rules": [
            "Frank !in Sat.* & !in Sun.BGV & !in Sun.Choir & fairness_exempt",
            "Mkz !in Sat.* & !in Sun.BGV & !in Sun.Choir & fairness_exempt",
            "Gaby !in Sat.* & !in Sun.Choir & fairness_slack 1 & Sun.BGV <= {weeks-2}",
            "Lucía !with Niza on *.LeadBGV",
            "Hugo !with Lucía on *.Lead",
            "Niza !with Hugo on *.Lead",
            "Jakey !with Hugo on *.BGV",
            "Jakey !with Hugo on *.Lead",
            "any_of(Hugo,Jakey) on Sun.BGV each_week",
        ],
        "history": [], "seed": seed,
        "solver_max_time_seconds": INERTNESS_BUDGET_SECONDS,
    }


# sha256 over a solve's model — str(model.Proto()), the protobuf TEXT format; CpModel
# .Proto() on ortools 9.15.6755 has no SerializeToString — plus its solver parameters
# with max_time_in_seconds stripped (it varies with the shared deadline). The
# parameters are what make it "the same search", not only the same model: branching,
# seed and worker count live there, not in the proto. Measured identical on the Linux
# runner and on macOS, at budgets of 1 to 30 s, across PYTHONHASHSEED values.
#
# STAGE_A is the first solve, and machine-independent unconditionally: it depends only
# on the seed. LADDER is every solve after it, in order — the fairness ladder's passes up
# to and including the one that returned the month. Each carries Stage A's
# weighted_empty as a bound, so it is machine-independent only because Stage A proved
# OPTIMAL — asserted, not assumed. The intermediate passes' STATUSES are deliberately not
# frozen: a proof of infeasibility may time out to UNKNOWN on a loaded runner, and the
# ladder moves on identically either way.
STAGE_A_FINGERPRINTS = {
    1: "43870d582112e547492fbb22f24dbd53857125d8e428425e3c0165ae5d29aefb",
    42: "feff7b363731ab259fdf0165e096065ebc70b1365e083831994fb7b091139c3d",
    2024: "c7c99d43bc2eae927fd8461ae9121cb5cad9114b600b8c15bfb53cd9b6f1f774",
}
LADDER_FINGERPRINTS = {
    1: [
        "5a34a77fd24fbc2b2947335464e597b236532aed85abddfd804599d129f9679e",
        "453c6d4373c5df96c75ead6ceec82cda2779b7557921b583699ed94258b72a64",
        "eedcc8ba327c7f53d799aab3d9dd8d492e30ea8f30705ed7dbd7a960619acbf8",
    ],
    42: [
        "a919e7222261df1e4d10ff87946ee2dcf20037a968e1b197d7cb23774c6475af",
        "890c255935907c0ee39b0b8193f138edc13aed1b4a7a6a9ca4b6911045eaf3a5",
        "4f0d657b4b48c6a6f9c57a0335b24f696be5c628a46c836837570bf643204418",
    ],
    2024: [
        "7b17dd7e1b65f77cb50b7a29e8a98f1ea5d77b6eaba444270bc65af6b73a98a5",
        "b309cdc6690a923c1cd59ecf8f676ba64c9f2b04097b1b325fa2e9ee6e3c3fe3",
        "21596f5342fb3715ce8d9ef3d8cf4f8c7b396f04f770787e52e27eeb4ae62ce8",
    ],
}

# The platform the golden was captured on, and the only one that enforces it. OPTIMAL
# removes the wall clock, not every tie: measured 2026-09-25, macOS arm64 and the Linux
# x86_64 runner run the same statuses on seed 42 (OPTIMAL, INFEASIBLE, INFEASIBLE,
# OPTIMAL) — equal objective — and return schedules that differ in 7 of 16 role cells.
# Enforced everywhere, a runner-captured golden would be red on every developer Mac, so
# it skips off-platform — EXCEPT in CI, where a skip would leave the required gate green
# with the guard switched off, so there it fails instead. Capture mode fails in CI too.
GOLDEN_PLATFORM = ("Linux", "x86_64")
CAPTURED_ON = ("GitHub Actions ubuntu-24.04, runner image 20260920.314.1, Python 3.12.14, "
               "ortools 9.15.6755, protobuf 6.33.6 — run 36172243640, PR #100")

# The schedule frozen_config(42) returns on GOLDEN_PLATFORM, captured by the CI runner
# that enforces it, never by a laptop. None means capture mode: the test prints it —
# failing in CI, skipping elsewhere.
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

_TIME_LIMIT = "max_time_in_seconds"


def _search_fingerprint(solver, model):
    params = "\n".join(line for line in str(solver.parameters).splitlines()
                        if not line.startswith(_TIME_LIMIT))
    text = str(model.Proto()) + "\n--- solver parameters ---\n" + params
    return hashlib.sha256(text.encode()).hexdigest()


_RUNS = {}


def _run(seed):
    """
    frozen_config(seed), solved once per process: the response, and per solve its
    (fingerprint, status name, whether it carried an objective), in order.
    """
    if seed not in _RUNS:
        original = cp_model.CpSolver.Solve
        solves = []

        def record(solver_self, model):
            fingerprint = _search_fingerprint(solver_self, model)
            status = original(solver_self, model)
            solves.append((fingerprint, solver_self.StatusName(status), model.HasObjective()))
            return status

        cp_model.CpSolver.Solve = record
        try:
            res = mod.solve_from_dict(frozen_config(seed))
        finally:
            cp_model.CpSolver.Solve = original
        _RUNS[seed] = (res, solves)
    return _RUNS[seed]


class PinlessModelIsUnchanged(unittest.TestCase):
    """The primary guard: model and search identity, not output identity (spec §9)."""

    def test_stage_a_fingerprint(self):
        for seed, expected in STAGE_A_FINGERPRINTS.items():
            with self.subTest(seed=seed):
                _res, solves = _run(seed)
                self.assertEqual(
                    solves[0][0], expected,
                    "the pinless Stage A model or search changed — a finding to explain, "
                    "not a literal to update (see the module docstring)")

    def test_ladder_fingerprints(self):
        for seed, expected in LADDER_FINGERPRINTS.items():
            with self.subTest(seed=seed):
                _res, solves = _run(seed)
                self.assertEqual(
                    solves[0][1], "OPTIMAL",
                    "precondition: Stage A must prove OPTIMAL for its bound on the ladder "
                    "to be machine-independent — raise INERTNESS_BUDGET_SECONDS")
                self.assertEqual(
                    [fingerprint for fingerprint, _status, _obj in solves[1:]], expected,
                    "the pinless ladder's models, objective, search or pass sequence "
                    "changed — a finding unless this PR is a deliberate, reviewed objective "
                    "change. (A LONGER sequence with an UNKNOWN last pass means the "
                    "returning pass timed out: raise INERTNESS_BUDGET_SECONDS.)")


class PinlessOutputGolden(unittest.TestCase):
    """
    The second guard, and weaker: OPTIMAL removes the wall clock, not every tie, so a
    different CPU or ortools build can return another solution of equal value.
    """

    @classmethod
    def setUpClass(cls):
        cls.res, solves = _run(42)
        cls.statuses = [status for _fingerprint, status, _obj in solves]

    def test_the_returning_solve_proved_optimality(self):
        """
        The precondition that makes a golden meaningful: the time limit did not bind.
        A returning pass returns at once, so the LAST solve is the one that produced the
        month; both stage_a fall-throughs leave a non-OPTIMAL last status and go red
        here. If a loaded runner trips this, raise INERTNESS_BUDGET_SECONDS — never drop
        the assertion or the golden (spec §7).
        """
        self.assertTrue(self.res["ok"], self.res.get("error"))
        self.assertEqual(self.statuses[-1], "OPTIMAL", f"statuses: {self.statuses}")
        self.assertFalse(self.res["objective_skipped"], "the returning pass had no objective")

    def test_schedule_matches_the_golden(self):
        here = (platform.system(), platform.machine())
        in_ci = os.environ.get("GITHUB_ACTIONS") == "true"
        if GOLDEN_SCHEDULE is None:
            capture = (f"capture: platform={here} python={platform.python_version()} "
                       f"statuses={self.statuses} "
                       f"schedule={json.dumps(self.res['schedule'], sort_keys=True)}")
            if in_ci:
                self.fail(capture + " — commit it; a golden left at None must never pass "
                          "the required gate")
            self.skipTest(capture)
        if here != GOLDEN_PLATFORM:
            if in_ci:
                self.fail(f"CI now runs on {here}, not {GOLDEN_PLATFORM}: off-platform the "
                          "golden skips, which would leave the required gate green with it "
                          "switched off. Re-capture it on this platform (module docstring).")
            self.skipTest(f"the golden was captured on {GOLDEN_PLATFORM} and this is {here}; "
                          "an equal-objective tie can resolve differently across platforms")
        self.assertEqual(self.res["schedule"], GOLDEN_SCHEDULE,
                         f"captured on {CAPTURED_ON}")

    def test_new_response_fields_are_inert(self):
        """
        Before pins exist these fields are absent; after, a pinless response carries
        pinned_honored 0, an empty pin_violations and no violation_ceiling_proven. This
        pre-pin baseline has to accept absence; the pinned-assignments PR tightens it to
        REQUIRE pinned_honored, whose absence is the deploy check's revert trigger.
        """
        self.assertEqual(self.res.get("pinned_honored", 0), 0)
        self.assertEqual(self.res.get("pin_violations", []), [])
        self.assertNotIn("violation_ceiling_proven", self.res)


if __name__ == "__main__":
    unittest.main()
