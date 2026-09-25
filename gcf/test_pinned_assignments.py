"""
Pinned assignments — docs/superpowers/specs/2026-09-15-solver-pinned-assignments-design.md.

Each test is a claim §5 makes, run against the real solver. Run from the repo root the
way CI does:  python -m unittest discover -s gcf -t gcf -v

What these tests deliberately never assert (spec §7): the three *_fairness_relaxed
flags, a pinned person's own total, or equivalence between a pin and a DSL rule.
"""

import unittest

from ortools.sat.python import cp_model

import owt_solver_v2 as mod
from owt_solver_v2 import solve_from_dict

# §5.1's fixture, verbatim: 12 people, four weeks, a Saturday every week, no rules —
# 52 slots, baseline totals [4,4,4,4,4,4,4,4,5,5,5,5], limits (1, 1, 1).
SUNDAY_LEADS = ["Hugo", "Niza", "Lucia", "Rachel"]
SATURDAY_LEADS = ["Tono"]
SUPPORT = ["Jakey", "Gaby", "Liu", "Marianne", "Vale", "Dani", "Pau"]
EVERYONE = SUNDAY_LEADS + SATURDAY_LEADS + SUPPORT
BIG = 52 + 1   # solve_schedule's `big`: a reported limit this size is the stage_a fall-through

SEAT = {"Sun.Lead": ("Sunday", "Lead"), "Sun.BGV": ("Sunday", "BGV"),
        "Sun.Choir": ("Sunday", "Choir"), "Sat.Lead": ("Saturday", "Lead"),
        "Sat.BGV": ("Saturday", "BGV")}
ROLE = {v: k for k, v in SEAT.items()}


def fixture(seed=42, rules=(), pinned=None, **overrides):
    data = dict(
        weeks=4, weekends_with_saturday=[1, 2, 3, 4],
        sunday_leads=list(SUNDAY_LEADS), saturday_leads=list(SATURDAY_LEADS),
        support=list(SUPPORT), dsl_rules=list(rules), history=[],
        seed=seed, solver_max_time_seconds=5,
    )
    if pinned is not None:
        data["pinned"] = pinned
    data.update(overrides)
    return data


def pin(person, role, week):
    return {"person": person, "role": role, "week": week}


def unavailable(person, week):
    """How plannerModel compiles an unavailable weekend: both services, hard."""
    return [f"{person} !in week {week} Sun.*", f"{person} !in week {week} Sat.*"]


def seated(res, week, role):
    service, seat = SEAT[role]
    return res["schedule"][str(week)].get(service, {}).get(seat, [])


def cells_of(res, person):
    return sorted((int(w), ROLE[(svc, seat)])
                  for w, services in res["schedule"].items()
                  for svc, seats in services.items()
                  for seat, names in seats.items() if person in names)


def instrumented(data):
    """solve_from_dict plus the returned SolveResult and every pass's (kwargs, result)."""
    captured, seen = {}, []
    orig_schedule, orig_pass = mod.solve_schedule, mod.create_model_and_solve

    def schedule(config):
        captured["result"] = orig_schedule(config)
        return captured["result"]

    def one_pass(**kwargs):
        result = orig_pass(**kwargs)
        seen.append((kwargs, result))
        return result

    mod.solve_schedule, mod.create_model_and_solve = schedule, one_pass
    try:
        res = solve_from_dict(data)
    finally:
        mod.solve_schedule, mod.create_model_and_solve = orig_schedule, orig_pass
    return res, captured.get("result"), seen


class RequestValidation(unittest.TestCase):
    """§6: every refusal is a ValueError, so it reaches the caller as ok:false, never a 500."""

    def refused(self, pinned, **overrides):
        res = solve_from_dict(fixture(pinned=pinned, **overrides))
        self.assertFalse(res["ok"], "expected a refusal")
        return res["error"]

    def test_malformed_entries_are_refused(self):
        for bad in (["Hugo"], [{"role": "Sun.Lead", "week": 1}],
                    [{"person": "Hugo", "role": "Sun.Lead", "week": "1"}],
                    [{"person": 7, "role": "Sun.Lead", "week": 1}],
                    [{"person": "  ", "role": "Sun.Lead", "week": 1}],
                    [{"person": "Hugo", "role": "Sun.Lead", "week": True}],
                    {"person": "Hugo", "role": "Sun.Lead", "week": 1}):
            with self.subTest(bad=bad):
                self.refused(bad)

    def test_over_the_cap_is_refused_not_truncated(self):
        pins = [pin(f"P{i}", "Sun.Choir", 1) for i in range(mod.PINNED_CAP + 1)]
        self.assertIn(str(mod.PINNED_CAP), self.refused(pins))

    def test_the_cap_itself_parses(self):
        pins = [pin(f"P{i}", "Sun.Choir", 1) for i in range(mod.PINNED_CAP)]
        self.assertEqual(len(mod.parse_pins(pins, 4, [1, 2, 3, 4])), mod.PINNED_CAP)

    def test_unknown_role(self):
        self.assertIn("Sun.Coro", self.refused([pin("Hugo", "Sun.Coro", 1)]))

    def test_week_outside_the_month(self):
        for week in (0, 5):
            with self.subTest(week=week):
                self.assertIn(f"week {week}", self.refused([pin("Hugo", "Sun.Lead", week)]))

    def test_saturday_pin_on_a_week_without_saturday(self):
        err = self.refused([pin("Tono", "Sat.Lead", 1)], weekends_with_saturday=[2, 4])
        self.assertIn("week 1", err)

    def test_two_pins_one_person_one_service(self):
        err = self.refused([pin("Hugo", "Sun.Lead", 2), pin("Hugo", "Sun.BGV", 2)])
        self.assertIn("Hugo", err)
        self.assertIn("Sunday", err)

    def test_one_person_on_both_services_of_a_weekend_is_fine(self):
        res = solve_from_dict(fixture(pinned=[pin("Hugo", "Sun.Lead", 2), pin("Hugo", "Sat.Lead", 2)]))
        self.assertTrue(res["ok"], res.get("error"))
        self.assertEqual(res["pinned_honored"], 2)

    def test_exact_duplicates_collapse(self):
        res = solve_from_dict(fixture(pinned=[pin("Gaby", "Sun.BGV", 1)] * 2))
        self.assertTrue(res["ok"], res.get("error"))
        self.assertEqual(res["pinned_honored"], 1)
        self.assertEqual(len(seated(res, 1, "Sun.BGV")), 3, "a duplicate grew the row")


class PinlessResponse(unittest.TestCase):
    """§4: pinned_honored always present (the deploy check reads it); the other two inert."""

    def test_fields_on_a_pinless_request(self):
        for data in (fixture(), fixture(pinned=[])):
            with self.subTest(pinned=data.get("pinned")):
                res = solve_from_dict(data)
                self.assertTrue(res["ok"], res.get("error"))
                self.assertEqual(res["pinned_honored"], 0)
                self.assertEqual(res["pin_violations"], [])
                self.assertNotIn("violation_ceiling_proven", res)

    def test_no_solve_zero_without_pins(self):
        _res, _result, seen = instrumented(fixture())
        self.assertFalse(any(k.get("violation_objective_only") for k, _ in seen))
        self.assertTrue(seen[0][0].get("empty_objective_only"), "Stage A must be the first solve")
