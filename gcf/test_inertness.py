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
  IDENTITY_FINGERPRINTS the LADDER's causes, over eight request shapes (the trailing-
                        Saturday guard, below): the same re-capture, and a red one in a PR
                        that claims non-trailing requests unchanged is a finding.
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
        # The solver's own ceiling, so raising INERTNESS_BUDGET_SECONDS can never make the
        # shared 40 s deadline cut the ladder short. It only feeds max_time_in_seconds,
        # which the fingerprints strip.
        "solver_total_budget_seconds": 110,
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


def _record(config):
    """
    One request, solved: the response, and per solve its (fingerprint, status name,
    whether it carried an objective), in order. Every solve is recorded, because the
    fingerprints cover the whole ladder, not only the solve that returned the month.
    """
    original = cp_model.CpSolver.Solve
    solves = []

    def record(solver_self, model):
        fingerprint = _search_fingerprint(solver_self, model)
        status = original(solver_self, model)
        solves.append((fingerprint, solver_self.StatusName(status), model.HasObjective()))
        return status

    cp_model.CpSolver.Solve = record
    try:
        res = mod.solve_from_dict(config)
    finally:
        cp_model.CpSolver.Solve = original
    return res, solves


_RUNS = {}


def _run(seed):
    """frozen_config(seed), solved once per process (see _record)."""
    if seed not in _RUNS:
        _RUNS[seed] = _record(frozen_config(seed))
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
                trace = [(status, "objective" if has_objective else "no objective")
                         for _fingerprint, status, has_objective in solves]
                self.assertEqual(
                    [fingerprint for fingerprint, _status, _obj in solves[1:]], expected,
                    "the pinless ladder's models, objective, search or pass sequence "
                    "changed — a finding unless this PR is a deliberate, reviewed objective "
                    "change. One exception, and it looks like this: the sequence is ONE "
                    "pass longer, the pass expected to return shows UNKNOWN, and an extra "
                    "last pass with no objective returned instead — the returning pass "
                    f"timed out; raise INERTNESS_BUDGET_SECONDS. Solves: {trace}")


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
        A pinless response carries pinned_honored 0, an empty pin_violations and no
        violation_ceiling_proven. pinned_honored is REQUIRED, not merely allowed to be
        0: its presence is how the client and the deploy check tell this solver from one
        that ignores `pinned`, and its absence is the deploy check's revert trigger
        (docs/SOLVER_AND_INFRA.md, "Verifying a Cloud Function deploy"). The pre-pin
        baseline in #100 had to accept absence; the pinned-assignments PR tightened it.
        """
        self.assertIn("pinned_honored", self.res)
        self.assertEqual(self.res["pinned_honored"], 0)
        self.assertEqual(self.res["pin_violations"], [])
        self.assertNotIn("violation_ceiling_proven", self.res)


# ─── The non-trailing identity guard (trailing-Saturday spec §5) ──────────────
#
# The trailing Saturday lets `weekends_with_saturday` name week `weeks + 1`. A request
# that does not name it must build the model it builds today, byte for byte — pinned or
# not, with or without history. STAGE_A and LADDER above prove that for one shape (the
# history-free, pinless seed fixture); these prove it for the shapes a real request can
# take, and were frozen from the solver BEFORE the trailing change, in their own commit,
# so the change is measured against the past rather than against itself.
#
# Each entry is every solve of one request, in order, Stage A included (and Solve 0
# first under pins). Same governance as LADDER_FINGERPRINTS: they move with Stage A's
# model or search parameters, or the objective — an ortools pin bump, or a deliberate,
# reviewed objective change, in a PR that changes nothing else. A red literal in a PR that
# claims non-trailing requests unchanged is a FINDING, never a re-capture.
#
# Machine-independent for the same reason the ladder is: each later pass carries the
# bounds the solves before it proved, so every solve BEFORE the ladder must prove OPTIMAL
# — asserted per shape, not assumed. That is Stage A, and under pins also Solve 0, whose
# violation count is the ceiling Stage A and the ladder inherit.
def _history():
    """
    Three months of counts for six of the twelve names, in the shape buildSolveRequest
    sends: {total_counts, role_counts}. Role keys are ROLE_ORDER's — build_history_offsets
    ignores any other, and a history that named none would leave the model untouched.
    """
    def entry(roles_by_person):
        return {
            "total_counts": {p: sum(roles.values()) for p, roles in roles_by_person.items()},
            "role_counts": {p: dict(roles) for p, roles in roles_by_person.items()},
        }

    return [
        entry({"Rachel": {"Sun.Lead": 1, "Sun.Choir": 1}, "Hugo": {"Sun.BGV": 2},
               "Jakey": {"Sun.BGV": 1, "Sun.Choir": 1}, "Lali": {"Sun.Choir": 2},
               "Lucía": {"Sat.Lead": 1}}),
        entry({"Marianne": {"Sun.Lead": 2}, "Rachel": {"Sun.BGV": 1, "Sun.Choir": 1},
               "Hugo": {"Sun.Choir": 2}, "Lali": {"Sun.BGV": 1, "Sat.BGV": 1},
               "Lucía": {"Sat.Lead": 2}}),
        entry({"Marianne": {"Sun.Lead": 1, "Sun.BGV": 1}, "Rachel": {"Sun.Lead": 1},
               "Jakey": {"Sun.Choir": 2}, "Hugo": {"Sun.BGV": 1, "Sat.BGV": 1},
               "Lucía": {"Sat.Lead": 1, "Sat.BGV": 1}}),
    ]


def _pins():
    return [{"week": 1, "role": "Sun.Lead", "person": "Rachel"},
            {"week": 2, "role": "Sat.BGV", "person": "Hugo"}]


def _shaped(saturdays, weeks=4, rules=(), history=False, pinned=False):
    """frozen_config(1), varied in one request's worth of ways; a fresh dict every call."""
    config = frozen_config(1)
    config["weeks"] = weeks
    config["weekends_with_saturday"] = list(saturdays)
    config["dsl_rules"] = config["dsl_rules"] + list(rules)
    if history:
        config["history"] = _history()
    if pinned:
        config["pinned"] = _pins()
    return config


_WEEK_EXCLUSIONS = ("Rachel !in week 3 *.*", "Liu !in week 2 Sat.*")

IDENTITY_SHAPES = {
    "w4-none": lambda: _shaped([]),
    "w4-some": lambda: _shaped([2, 4]),
    "w4-all": lambda: _shaped([1, 2, 3, 4]),
    "w5-all": lambda: _shaped([1, 2, 3, 4, 5], weeks=5),
    "w4-weekexcl": lambda: _shaped([2, 4], rules=_WEEK_EXCLUSIONS),
    "w4-history": lambda: _shaped([2, 4], history=True),
    "w4-pinned": lambda: _shaped([2, 4], pinned=True),
    "w4-pinned-history": lambda: _shaped([2, 4], history=True, pinned=True),
}

# Captured 2026-09-30 on the solver as it stood before the trailing change (macOS arm64,
# ortools 9.15.6755). Setting it to None is capture mode: the test then fails with the
# literal to paste, and a literal left at None never passes the required gate.
IDENTITY_FINGERPRINTS = {
    "w4-none": [
        "6dbb17da42338427b4a435f666666e5c174883657e5d9663dfe90aa064dc299b",
        "a1124f786297f1f4ca706b3a4880050d220c5b9361f907132199a575ec6f473b",
    ],
    "w4-some": [
        "43870d582112e547492fbb22f24dbd53857125d8e428425e3c0165ae5d29aefb",
        "5a34a77fd24fbc2b2947335464e597b236532aed85abddfd804599d129f9679e",
        "453c6d4373c5df96c75ead6ceec82cda2779b7557921b583699ed94258b72a64",
        "eedcc8ba327c7f53d799aab3d9dd8d492e30ea8f30705ed7dbd7a960619acbf8",
    ],
    "w4-all": [
        "dfe256316e2475ffad3e7a82c8cb86f87dfb0b2cb5e57d2bd2917177b8fe7e50",
        "3dbf5f8e582059408a27f210a342e3ac340bedb8cdc1970cdd849c2ceca5a402",
        "fa08e8a4b112be87a1066f8d7b591828a44eea66b8a604858f2dfa6df7a99bce",
        "0bb136b497a387644ba46d0132871ebdf5c28c14881994e375aacaa9747f2235",
        "59c65f8eca9582a784206195692b9831fee305e629f91385801678cd26711e37",
        "2d3a77056c60ff07bb99160ab7aa5f940a3ef20a0a4e0edb60e1aa1954d6f590",
        "b67e064ffcdd5207697f96f6f014796d41a13560f937c673c9c3f8132b5ba77c",
        "626fc821777a35a0ccde8284fbb6336747df598c12eb37099f22cd2d57ee7e52",
    ],
    "w5-all": [
        "0a2ed66e7fdc4c8d80e33324a5983c537c02b9b351bc1d50ab775345db4fa4c1",
        "be510b5a85052e8a270755f685231b49f16381d7a1b737940e35f2b8db8ea9bc",
        "1fd41a1b7bf575ff2f3f24c7a62f9445192fd346a35e461e01d070b0dcbf92fa",
        "b9a0138cf4e6dfaada2a99f064f0d7a5357c17c5956e730840a739a33a4de704",
        "308643ab48170db1f0e782cd630dc475be87ff30d0fb544dd51858e29b10143f",
        "f58960f340c7df06e87a3dedc9b907320391f7a5e0fecb3fce407b8a45d973e0",
        "8530725d228a402bf6245b29ae73874369bcd90d5db427f0badcc305847aad35",
        "3623bd6795beb0d301307aab9ff0fbf95a2bb2d859a8650ddf22cf1c860fc5ee",
    ],
    "w4-weekexcl": [
        "db2108d4a90834a935f9a87c6a966cfe86263a66a9a4d8a0176f68919cc3ed65",
        "ecafe673df39fe53878db435c4ea85a88f4add919d8d5f2fc0f85e752e24d47c",
    ],
    "w4-history": [
        "4dd623fd14ed77118204583d723b4caeefccc10db14490e27211a3a3ec04dbd1",
        "2d1b984d1661d464548e828a3494ebf555a39e92351d73c52306fba246821527",
        "92bd07a20670244b84268d05e4d3eee95afec6020ceadeccaaec9c71591590ca",
        "cd6f727b923be3a0bbce12319de316972f51840ce2408522b681ee3a6b1e2d31",
    ],
    "w4-pinned": [
        "2f666dbdbcfd45db95dab3851b2e0d4c7c164ec73edbe9e85df3f35b654bb011",
        "95367113c2ea74a8bb8ff470973b6c1462326cd5bc4fd50fe324939ae58e8f82",
        "436ef91d34e1dda4b9bb1f431a5be460f4300b65f809ad5371756349c9241fa1",
    ],
    "w4-pinned-history": [
        "50ecfbe42c501ff11c068e91f66cc4a141a159fb96ee861a594d69a3b0a15be5",
        "6f388184bc9ed696bccdebc317acb477123e6df5ab5d45e117b1fb1fb933139c",
        "449858c032f6e817ef3a60fc502c2c321871e2fa1460929740d501b6075facc0",
    ],
}

_SHAPE_RUNS = {}


def _run_shape(name):
    """IDENTITY_SHAPES[name](), solved once per process (see _record)."""
    if name not in _SHAPE_RUNS:
        _SHAPE_RUNS[name] = _record(IDENTITY_SHAPES[name]())
    return _SHAPE_RUNS[name]


def _leading_solves(name):
    """How many solves come before the ladder and must prove OPTIMAL: Stage A, and
    Solve 0 ahead of it when the request pins (relaxation_enabled)."""
    return 2 if IDENTITY_SHAPES[name]().get("pinned") else 1


class NonTrailingModelIsUnchanged(unittest.TestCase):
    """The guard for the trailing Saturday: non-trailing requests build the model they did."""

    def test_the_solves_before_the_ladder_prove_optimal(self):
        for name in IDENTITY_SHAPES:
            with self.subTest(shape=name):
                _res, solves = _run_shape(name)
                statuses = [status for _fingerprint, status, _obj in solves]
                lead = _leading_solves(name)
                self.assertEqual(
                    statuses[:lead], ["OPTIMAL"] * lead,
                    "precondition: Stage A (and Solve 0 under pins) must prove OPTIMAL for "
                    "the bounds they hand the ladder to be machine-independent — simplify "
                    "this shape, or on a slow runner raise INERTNESS_BUDGET_SECONDS; never "
                    f"drop the assertion. Statuses: {statuses}")

    def test_identity_fingerprints(self):
        captured = {name: [fingerprint for fingerprint, _status, _obj in _run_shape(name)[1]]
                    for name in IDENTITY_SHAPES}
        if IDENTITY_FINGERPRINTS is None:
            body = "".join(
                f'    "{name}": [\n' + "".join(f'        "{fp}",\n' for fp in fingerprints) + "    ],\n"
                for name, fingerprints in captured.items())
            statuses = {name: [status for _fp, status, _obj in _run_shape(name)[1]]
                        for name in IDENTITY_SHAPES}
            self.fail(f"capture mode — paste as IDENTITY_FINGERPRINTS:\nIDENTITY_FINGERPRINTS = {{\n"
                      f"{body}}}\nstatuses: {statuses}\n"
                      "Commit it only from the solver as it stood BEFORE the trailing change, "
                      "with test_the_solves_before_the_ladder_prove_optimal green.")
        self.assertEqual(set(IDENTITY_FINGERPRINTS), set(IDENTITY_SHAPES),
                         "a shape and its literal must be added together")
        for name, expected in IDENTITY_FINGERPRINTS.items():
            with self.subTest(shape=name):
                self.assertEqual(
                    captured[name], expected,
                    "a request that does not name the trailing Saturday built a different "
                    "model, search or pass sequence — a FINDING to explain in a PR that "
                    "claims non-trailing requests unchanged, never a literal to re-capture "
                    "(see the governance note above IDENTITY_SHAPES)")

    def test_w4_some_is_the_seed_1_fixture(self):
        """
        w4-some is frozen_config(1) and nothing else, so its literal must be the seed-1
        literals above: a recorder or a shape that drifted from them would show here
        before it showed anywhere else.
        """
        self.assertEqual(IDENTITY_SHAPES["w4-some"](), frozen_config(1))
        if IDENTITY_FINGERPRINTS is not None:
            self.assertEqual(IDENTITY_FINGERPRINTS["w4-some"],
                             [STAGE_A_FINGERPRINTS[1]] + LADDER_FINGERPRINTS[1])


if __name__ == "__main__":
    unittest.main()
