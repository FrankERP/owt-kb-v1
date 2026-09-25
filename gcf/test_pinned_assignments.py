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


class PinsAreSeated(unittest.TestCase):

    def test_a_pin_is_seated_and_counted(self):
        res = solve_from_dict(fixture(pinned=[pin("Gaby", "Sun.BGV", 1)]))
        self.assertTrue(res["ok"], res.get("error"))
        self.assertIn("Gaby", seated(res, 1, "Sun.BGV"))
        self.assertEqual(res["pinned_honored"], 1)
        self.assertEqual(res["pin_violations"], [])

    def test_a_pin_beats_unavailability_on_its_own_row_only(self):
        """E3's guaranteed collision, end to end — and the other service stays excluded."""
        rules = unavailable("Gaby", 2)
        without = solve_from_dict(fixture(rules=rules))
        self.assertTrue(without["ok"], without.get("error"))
        self.assertEqual([c for c in cells_of(without, "Gaby") if c[0] == 2], [])

        res = solve_from_dict(fixture(rules=rules, pinned=[pin("Gaby", "Sun.Choir", 2)]))
        self.assertTrue(res["ok"], res.get("error"))
        self.assertEqual([c for c in cells_of(res, "Gaby") if c[0] == 2], [(2, "Sun.Choir")])
        self.assertEqual(res["pin_violations"], [], "a week exclusion is scoped, not relaxed")

    def test_a_pinned_person_in_no_pool_is_seated_only_at_the_pin(self):
        """The reproduced KeyError at assignments[person], kept as a guard — and the union's
        placement: before `pools` it granted one pinned person three extra services."""
        without = solve_from_dict(fixture())
        self.assertNotIn("Zoe", without["total_counts"])
        res = solve_from_dict(fixture(pinned=[pin("Zoe", "Sun.Choir", 3)]))
        self.assertTrue(res["ok"], res.get("error"))
        self.assertEqual(cells_of(res, "Zoe"), [(3, "Sun.Choir")])
        self.assertEqual(res["total_counts"]["Zoe"], 1)
        self.assertEqual(sum(res["role_counts"]["Zoe"].values()), 1)

    def test_over_pinning_grows_the_row(self):
        res = solve_from_dict(fixture(pinned=[pin(p, "Sun.Lead", 1) for p in SUNDAY_LEADS]))
        self.assertTrue(res["ok"], res.get("error"))
        self.assertEqual(sorted(seated(res, 1, "Sun.Lead")), sorted(SUNDAY_LEADS))
        self.assertEqual(res["pinned_honored"], 4)
        self.assertFalse([u for u in res["unfilled_seats"] if u.startswith("W1 Sunday Sun.Lead")])
        self.assertLessEqual(len(seated(res, 2, "Sun.Lead")), 2, "only the pinned row grows")

    def test_growth_keeps_the_bgv_choir_interleave(self):
        cfg = mod.ScheduleConfig(weeks=3, weekends_w_sat=[], sunday_leads_pool=["A"],
                                 saturday_leads_pool=[], support_pool=[], dsl_restrictions=[],
                                 history=[])
        pins = [(f"P{i}", "Sun.Choir", 1) for i in range(5)]
        week1 = [s.key for s in mod.build_slots(cfg, pins) if s.week == 1]
        self.assertEqual(week1, [
            "W1.Sun.Lead.1", "W1.Sun.Lead.2",
            "W1.Sun.BGV.1", "W1.Sun.Choir.1", "W1.Sun.BGV.2", "W1.Sun.Choir.2",
            "W1.Sun.BGV.3", "W1.Sun.Choir.3", "W1.Sun.Choir.4", "W1.Sun.Choir.5"])

    def test_granted_candidacy_is_appended_after_the_shuffle(self):
        slots = [mod.Slot(1, "Sunday", "Sun.Lead", 1)]
        pools = {"Sun.Lead": {"A", "B", "C"}}
        forbidden = {p: set() for p in ("A", "B", "C", "Z")}
        grown = mod.build_candidate_map(["A", "B", "C", "Z"], pools, forbidden, slots, 7,
                                        [("Z", "Sun.Lead", 1), ("A", "Sun.Lead", 1)])
        self.assertEqual(grown["W1.Sun.Lead.1"][-1], "Z")
        self.assertEqual(grown["W1.Sun.Lead.1"].count("A"), 1, "an eligible pin is not appended twice")


class PinnedOnlyPeopleStayOutOfFairness(unittest.TestCase):
    """§5.1: a person the solver cannot place anywhere must not set gmin for everyone."""

    def first_pass(self, data):
        _res, _result, seen = instrumented(data)
        return seen[0][0]

    def test_excluded_from_strict_and_relaxed(self):
        # The DSL names a pinned-only person — legal because `known` is built after the union.
        kw = self.first_pass(fixture(rules=unavailable("Zoe", 1), pinned=[pin("Zoe", "Sun.Choir", 3)]))
        self.assertNotIn("Zoe", kw["global_fairness_people"])
        self.assertNotIn("Zoe", kw["global_fairness_slack"])

    def test_excluded_from_the_collapse_rebuild(self):
        # Every pool member but Hugo carries slack, so `strict` falls below two and is rebuilt.
        rules = [f"{p} fairness_slack 1" for p in EVERYONE if p != "Hugo"]
        kw = self.first_pass(fixture(rules=rules, pinned=[pin("Zoe", "Sun.Choir", 3)]))
        self.assertEqual(kw["global_fairness_slack"], {}, "the collapse branch was not reached")
        self.assertEqual(sorted(kw["global_fairness_people"]), sorted(EVERYONE))


def baseline_band(seed):
    res = solve_from_dict(fixture(seed=seed))
    assert res["ok"], res.get("error")
    return min(res["total_counts"].values()), max(res["total_counts"].values())


class FairnessUnderPins(unittest.TestCase):
    """
    §5.1/§7: the un-pinned members IN THE FAIRNESS GROUPS stay inside the un-pinned
    baseline's spread. The fixture has no fairness_exempt member, so that is everyone
    un-pinned; an exempt member would be outside every bound and asserted nothing about.
    """

    @classmethod
    def setUpClass(cls):
        cls.band = {seed: baseline_band(seed) for seed in (1, 42)}

    def assert_group_holds(self, data, pinned_people, seed):
        res, result, _ = instrumented(data)
        self.assertTrue(res["ok"], res.get("error"))
        self.assertEqual(res["pinned_honored"], len(data["pinned"]))
        self.assertNotEqual(result.fairness_limit_used, BIG, "fell through to the fairness-free stage_a")
        lo, hi = self.band[seed]
        for p in EVERYONE:
            if p not in pinned_people:
                self.assertTrue(lo <= res["total_counts"][p] <= hi,
                                f"{p}: {res['total_counts'][p]} outside baseline [{lo}, {hi}]")

    def test_skewed_partial_pin_leaves_everyone_else_alone(self):
        for row in ("Sun.Lead", "Sun.BGV", "Sun.Choir"):
            for k in (1, 2, 3):
                with self.subTest(row=row, pins=k):
                    pins = [pin("Rachel", row, w) for w in range(1, k + 1)]
                    self.assert_group_holds(fixture(seed=42, pinned=pins), {"Rachel"}, 42)
        with self.subTest(seed=1):
            pins = [pin("Rachel", "Sun.Lead", w) for w in (1, 2, 3)]
            self.assert_group_holds(fixture(seed=1, pinned=pins), {"Rachel"}, 1)

    def test_a_full_row_pin_for_a_lead_pool_member_and_a_support_member(self):
        """Pool membership is the discriminator, not the row's seat count (§5.1)."""
        for row in ("Sun.Lead", "Sun.BGV", "Sun.Choir"):
            for person in ("Hugo", "Vale"):
                with self.subTest(row=row, person=person):
                    pins = [pin(person, row, w) for w in range(1, 5)]
                    self.assert_group_holds(fixture(seed=42, pinned=pins), {person}, 42)

    def test_role_keyed_slack_is_a_failing_control(self):
        """
        The rejected role-keyed slack MUST collapse the lead-pool case, or the guard above
        proves nothing. Three-seat rows only: measured, Sun.Lead does not collapse under
        either form, so a control there fails to fail — never weaken this to make it pass.
        """
        def role_keyed(pins, spread_role):
            counts = {}
            for person, role, _week in pins:
                if spread_role is None or role == spread_role:
                    counts[person] = counts.get(person, 0) + 1
            return counts

        original = mod.pin_slack
        mod.pin_slack = role_keyed
        try:
            for row in ("Sun.BGV", "Sun.Choir"):
                with self.subTest(row=row):
                    pins = [pin("Hugo", row, w) for w in range(1, 5)]
                    res, result, _ = instrumented(fixture(seed=42, pinned=pins))
                    self.assertTrue(res["ok"], res.get("error"))
                    self.assertEqual(result.fairness_limit_used, BIG,
                                     "role-keyed slack did not collapse: the control is vacuous")
        finally:
            mod.pin_slack = original

    def test_heavy_pin_load_keeps_absence_slack(self):
        """30 pins on 12 people — where routing pins through combined_slack would have emptied
        `strict` and discarded every absence's slack (the rejected design, §5.1)."""
        rules = unavailable("Marianne", 2)
        base = solve_from_dict(fixture(rules=rules))
        self.assertTrue(base["ok"], base.get("error"))
        pins = [pin(p, ROLE[(svc, seat)], int(w))
                for w, services in sorted(base["schedule"].items(), key=lambda t: int(t[0]))
                for svc, seats in services.items() for seat, names in seats.items()
                for p in names if p != "Marianne"][:30]
        self.assertEqual(len(pins), 30)
        res, _result, seen = instrumented(fixture(rules=rules, pinned=pins))
        self.assertTrue(res["ok"], res.get("error"))
        self.assertEqual(seen[0][0]["global_fairness_slack"].get("Marianne"), 2)
