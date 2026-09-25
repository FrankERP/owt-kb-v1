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

    def test_a_spacing_variant_of_a_pool_name_is_refused(self):
        """' Hugo' beside 'Hugo' is a misspelling: it took a second seat in Hugo's service."""
        self.assertIn("spacing", self.refused([pin(" Hugo", "Sun.BGV", 1)]))

    def test_a_pool_name_with_a_trailing_space_is_pinned_as_is(self):
        """Studio does not trim member_name, so a pin on a pool member's exact name is
        accepted with the space — and the space-less spelling beside it is refused."""
        pool = [p if p != "Pau" else "Pau " for p in SUPPORT]
        res = solve_from_dict(fixture(support=pool, pinned=[pin("Pau ", "Sun.Choir", 1)]))
        self.assertTrue(res["ok"], res.get("error"))
        self.assertIn("Pau ", seated(res, 1, "Sun.Choir"))
        err = self.refused([pin("Pau", "Sun.Choir", 1)], support=pool)
        self.assertIn("spacing", err)

    def test_a_misspelt_pool_name_is_refused(self):
        """'hugo' beside 'Hugo' is a misspelling, not a new person: it would sit beside the
        real one and could inherit his rules depending on hash order."""
        err = self.refused([pin("hugo", "Sun.BGV", 1)], dsl_rules=["Hugo !in Sat.*"])
        self.assertIn("capitalisation", err)

    def test_two_pinned_only_spellings_are_refused(self):
        err = self.refused([pin("Zoe", "Sun.Choir", 1), pin("zoe", "Sun.Choir", 2)])
        self.assertIn("capitalisation", err)

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


# ─── Blocking-mechanism cases (§7) ─────────────────────────────────────────────
# Each starts from what an admin does — move one person into another role — and each
# names an instance that is FORCED: the only one that can give. `violation_target`
# bounds the count, not the identity, so a case with two equally-minimal sets would
# flake on the seed. Each returns (request, expected pin_violations).

def occupancy_case():
    """Round 5's one-pin reproduction: Hugo pinned to lead the week Jakey is out."""
    rules = ["any_of(Hugo,Jakey) on Sun.BGV each_week"] + unavailable("Jakey", 3)
    return (fixture(rules=rules, pinned=[pin("Hugo", "Sun.Lead", 3)]),
            ["W3: any_of(Hugo,Jakey) on Sun.BGV each_week"])


def cap_case():
    """Round 6's two-pin reproduction, authored in the seed's MERGED shape: every clause
    after the first is subject-elided in `source`, so the person comes from the rule
    object. The template resolves before parsing, so the entry shows 2, not {weeks-2}."""
    rules = ["Gaby !in Sat.* & !in Sun.Choir & Sun.BGV <= {weeks-2} & fairness_slack 1",
             "any_of(Gaby,Jakey) on Sun.BGV each_week"] + unavailable("Jakey", 3) + unavailable("Jakey", 4)
    return (fixture(rules=rules, pinned=[pin("Gaby", "Sun.BGV", 1), pin("Gaby", "Sun.BGV", 2)]),
            ["Gaby: Sun.BGV <= 2"])


def pair_case():
    """Round 6's pair reproduction. Two presence rules both need Liu in W2, so waiving
    presence costs two and the pair is the one instance that can give."""
    rules = (["Liu !with Vale on *.Choir",
              "any_of(Liu,Marianne) on Sun.Choir each_week",
              "any_of(Liu,Dani) on Sun.Choir each_week"]
             + unavailable("Marianne", 2) + unavailable("Dani", 2))
    return (fixture(rules=rules, pinned=[pin("Vale", "Sun.Choir", 2)]),
            ["W2 Sun: Liu !with Vale on *.Choir"])


def anchor_case():
    """The only dedicated Saturday lead pinned into Sat.BGV."""
    return fixture(pinned=[pin("Tono", "Sat.BGV", 2)]), ["builtin:sat_anchor:W2"]


def full_row_case():
    """A row pinned full leaves the group no seat that week."""
    return (fixture(rules=["any_of(Liu,Marianne) on Sun.Choir each_week"],
                    pinned=[pin(p, "Sun.Choir", 1) for p in ("Vale", "Dani", "Pau")]),
            ["W1: any_of(Liu,Marianne) on Sun.Choir each_week"])


def unreachable_bound_case(op):
    """Two Sunday pins elsewhere leave Liu two Choir Sundays; the rule wants three."""
    return (fixture(rules=[f"Liu Sun.Choir {op} 3"],
                    pinned=[pin("Liu", "Sun.BGV", 1), pin("Liu", "Sun.BGV", 2)]),
            [f"Liu: Liu Sun.Choir {op} 3"])


def no_lead_case():
    """Every lead-pool member pinned into other roles of W4's Sunday."""
    return (fixture(pinned=[pin("Hugo", "Sun.BGV", 4), pin("Niza", "Sun.BGV", 4),
                            pin("Lucia", "Sun.Choir", 4), pin("Rachel", "Sun.Choir", 4)]),
            ["builtin:mandatory_lead:W4:Sun"])


def pair_both_services_case():
    """One rule relaxed on both services of one week: two instances, two distinct entries."""
    return (fixture(rules=["Hugo !with Niza on *.BGV"],
                    pinned=[pin("Hugo", "Sun.BGV", 2), pin("Niza", "Sun.BGV", 2),
                            pin("Hugo", "Sat.BGV", 2), pin("Niza", "Sat.BGV", 2)]),
            ["W2 Sun: Hugo !with Niza on *.BGV", "W2 Sat: Hugo !with Niza on *.BGV"])


def consecutive_case():
    """Merged shape again: the person comes from the rule object, not from `source`."""
    return (fixture(rules=["Rachel !in Sat.* & !consecutive on *.Lead"],
                    pinned=[pin("Rachel", "Sun.Lead", 2), pin("Rachel", "Sun.Lead", 3)]),
            ["W2-3 Rachel: !consecutive on *.Lead"])


CASES = {
    "occupancy": occupancy_case, "cap": cap_case, "pair": pair_case, "anchor": anchor_case,
    "full_row": full_row_case, "gte": lambda: unreachable_bound_case(">="),
    "eq": lambda: unreachable_bound_case("=="), "no_lead": no_lead_case,
    "pair_both_services": pair_both_services_case, "consecutive": consecutive_case,
}


def rules_stay_hard(data):
    original = mod.relaxation_enabled
    mod.relaxation_enabled = lambda pins: False
    try:
        return solve_from_dict(data)
    finally:
        mod.relaxation_enabled = original


class PinsBeatRules(unittest.TestCase):

    def assert_pins_seated(self, res, pinned):
        for p in pinned:
            self.assertIn(p["person"], seated(res, p["week"], p["role"]), p)

    def test_each_mechanism_names_exactly_the_rule_that_gave(self):
        for name, build in CASES.items():
            with self.subTest(case=name):
                data, expected = build()
                res = solve_from_dict(data)
                self.assertTrue(res["ok"], res.get("error"))
                self.assertEqual(res["pinned_honored"], len(data["pinned"]))
                self.assert_pins_seated(res, data["pinned"])
                self.assertCountEqual(res["pin_violations"], expected)
                self.assertTrue(res["violation_ceiling_proven"])

    def test_rules_stay_hard_control(self):
        """With the booleans off, the same reproductions must FAIL — this is what proves the
        suite discriminates a working relaxation from a vacuous one."""
        for build in (occupancy_case, cap_case, pair_case):
            with self.subTest(case=build.__name__):
                data, _ = build()
                self.assertFalse(rules_stay_hard(data)["ok"])

    def test_nothing_left_to_lead_with_leaves_the_seat_unfilled(self):
        data, _ = no_lead_case()
        res = solve_from_dict(data)
        self.assertEqual(seated(res, 4, "Sun.Lead"), [])
        self.assertIn("W4 Sunday Sun.Lead #1", res["unfilled_seats"])
        self.assertIn("W4 Sunday Sun.Lead #2", res["unfilled_seats"])

    def test_a_relaxation_stays_inside_its_own_week(self):
        res = solve_from_dict(occupancy_case()[0])
        for week in (1, 2, 4):
            self.assertTrue({"Hugo", "Jakey"} & set(seated(res, week, "Sun.BGV")),
                            f"presence also failed in W{week}")
        res = solve_from_dict(pair_case()[0])
        for week in (1, 3, 4):
            self.assertFalse({"Liu", "Vale"} <= set(seated(res, week, "Sun.Choir")),
                             f"pair also failed in W{week}")
        res = solve_from_dict(consecutive_case()[0])
        self.assertNotIn("Rachel", seated(res, 1, "Sun.Lead"))
        self.assertNotIn("Rachel", seated(res, 4, "Sun.Lead"))

    def test_a_pinned_unavailable_group_member_breaks_nothing(self):
        """excluded_pwr is scoped for pins: without it, Jakey's pin would not count toward
        the rule it satisfies and E3's headline case would report a conflict."""
        rules = ["any_of(Hugo,Jakey) on Sun.BGV each_week"] + unavailable("Jakey", 3)
        res = solve_from_dict(fixture(rules=rules, pinned=[pin("Jakey", "Sun.BGV", 3),
                                                           pin("Hugo", "Sun.Lead", 3)]))
        self.assertTrue(res["ok"], res.get("error"))
        self.assertEqual(res["pin_violations"], [])

    def test_pins_that_satisfy_rules_relax_nothing(self):
        cap = "Gaby !in Sat.* & !in Sun.Choir & Sun.BGV <= {weeks-2} & fairness_slack 1"
        for label, rules, pins in (
            ("anchor", [], [pin("Tono", "Sat.Lead", 1)]),
            ("presence", ["any_of(Hugo,Jakey) on Sun.BGV each_week"],
             [pin("Jakey", "Sun.BGV", w) for w in range(1, 5)]),
            ("cap", [cap], [pin("Gaby", "Sun.BGV", 1)]),
        ):
            with self.subTest(case=label):
                res = solve_from_dict(fixture(rules=rules, pinned=pins))
                self.assertTrue(res["ok"], res.get("error"))
                self.assertEqual(res["pin_violations"], [])
                if label == "cap":
                    self.assertLessEqual(res["role_counts"]["Gaby"]["Sun.BGV"], 2)

    def test_a_relaxed_cap_is_reported_and_the_pins_still_count(self):
        """
        The cap stops binding once relaxed (§5.2). What Gaby then gets is the objective's
        doing, not the model's: measured exactly her two pins at 2 s and 5 s, but 3 on two
        of four seeds at 1 s per solve — so this asserts only what the model guarantees,
        never the number, or a loaded runner reddens the required gate for no code reason.
        """
        res = solve_from_dict(fixture(rules=["Gaby Sun.BGV <= 1"],
                                      pinned=[pin("Gaby", "Sun.BGV", 1), pin("Gaby", "Sun.BGV", 2)]))
        self.assertEqual(res["pin_violations"], ["Gaby: Gaby Sun.BGV <= 1"])
        self.assertGreaterEqual(res["role_counts"]["Gaby"]["Sun.BGV"], 2)


def occupancy_case_failures(res):
    """
    Every relaxable instance of the occupancy case, evaluated independently of the
    solver: its presence rule, both mandatory leads and the Saturday anchor, each week
    (Tono is the only dedicated Saturday lead and is available throughout). Without the
    ceiling, Stage B does break instances nobody pinned — the Saturday anchor, measured —
    which is exactly why this has to cover all of them.
    """
    failed = set()
    for w in range(1, 5):
        if not {"Hugo", "Jakey"} & set(seated(res, w, "Sun.BGV")):
            failed.add(f"W{w}: any_of(Hugo,Jakey) on Sun.BGV each_week")
        if not seated(res, w, "Sun.Lead"):
            failed.add(f"builtin:mandatory_lead:W{w}:Sun")
        if not seated(res, w, "Sat.Lead"):
            failed.add(f"builtin:mandatory_lead:W{w}:Sat")
        if "Tono" not in seated(res, w, "Sat.Lead"):
            failed.add(f"builtin:sat_anchor:W{w}")
    return failed


class ViolationCeiling(unittest.TestCase):
    """§5.2: solve 0 runs first and its minimum is a hard ceiling on every later stage."""

    def patch_first_solve(self, status_for):
        original = cp_model.CpSolver.Solve
        calls = []

        def patched(solver_self, model):
            calls.append(1)
            if len(calls) == 1:
                return status_for(original, solver_self, model)
            return original(solver_self, model)

        cp_model.CpSolver.Solve = patched
        self.addCleanup(setattr, cp_model.CpSolver, "Solve", original)

    def test_solve_zero_runs_first_and_bounds_every_later_stage(self):
        res, _result, seen = instrumented(occupancy_case()[0])
        first, solve0 = seen[0]
        self.assertTrue(first.get("violation_objective_only"))
        self.assertIsNone(first.get("empty_target"))
        self.assertEqual(solve0.violations_used, 1)
        for kwargs, _ in seen[1:]:
            self.assertEqual(kwargs.get("violation_target"), 1, "a stage ran without the ceiling")
        self.assertLessEqual(len(res["pin_violations"]), solve0.violations_used)
        self.assertTrue(res["violation_ceiling_proven"])

    def test_no_solution_from_solve_zero_falls_back_to_stage_a_as_the_ceiling(self):
        """
        The regime a slow container reaches: solve 0 comes back with nothing, so Stage A
        runs without a ceiling — and Stage A's own count becomes the ceiling for Stage B.
        Without that fallback Stage B broke three or four rules in weeks nobody pinned
        (measured on three seeds) while Stage A had needed one: what ADR-0010 forbids.
        """
        self.patch_first_solve(lambda original, s, m: cp_model.UNKNOWN)
        res, _result, seen = instrumented(occupancy_case()[0])
        self.assertTrue(res["ok"], res.get("error"))
        self.assertFalse(res["violation_ceiling_proven"], "only solve 0 can prove the ceiling")
        stage_a = [(k, r) for k, r in seen if k.get("empty_objective_only")]
        self.assertEqual(len(stage_a), 1)
        self.assertIsNone(stage_a[0][0].get("violation_target"))
        self.assertIsNone(stage_a[0][0].get("hint"), "no solve 0 month, so no hint")
        for kwargs, _ in seen:
            if not kwargs.get("empty_objective_only") and not kwargs.get("violation_objective_only"):
                self.assertEqual(kwargs.get("violation_target"), stage_a[0][1].violations_used)
        self.assertEqual(res["pin_violations"], ["W3: any_of(Hugo,Jakey) on Sun.BGV each_week"])

    def test_the_report_is_honest_even_with_no_ceiling_at_all(self):
        """
        The booleans are one-directional, so the report is re-evaluated against the
        returned assignment. With every ceiling stripped, Stage B does break instances
        nobody pinned (the Saturday anchor, measured) — and every entry must then be a
        real failure and every failure an entry.
        """
        original = mod.create_model_and_solve

        def no_ceiling(**kwargs):
            kwargs["violation_target"] = None
            return original(**kwargs)

        self.patch_first_solve(lambda orig, s, m: cp_model.UNKNOWN)
        mod.create_model_and_solve = no_ceiling
        self.addCleanup(setattr, mod, "create_model_and_solve", original)
        res, _result, _seen = instrumented(occupancy_case()[0])
        self.assertTrue(res["ok"], res.get("error"))
        self.assertEqual(set(res["pin_violations"]), occupancy_case_failures(res))
        self.assertIn("W3: any_of(Hugo,Jakey) on Sun.BGV each_week", res["pin_violations"])

    def test_a_feasible_solve_zero_still_bounds_but_is_not_proven(self):
        def feasible(original, s, m):
            status = original(s, m)
            return cp_model.FEASIBLE if status == cp_model.OPTIMAL else status
        self.patch_first_solve(feasible)
        res, _result, seen = instrumented(occupancy_case()[0])
        self.assertTrue(res["ok"], res.get("error"))
        self.assertFalse(res["violation_ceiling_proven"])
        for kwargs, _ in seen[1:]:
            self.assertEqual(kwargs.get("violation_target"), 1)

    def test_stage_a_starts_from_solve_zeros_month(self):
        res, _result, seen = instrumented(occupancy_case()[0])
        solve0 = seen[0][1]
        stage_a = [k for k, _ in seen if k.get("empty_objective_only")][0]
        self.assertEqual(stage_a.get("hint"), solve0.assignments)
        for kwargs, _ in seen:
            if not kwargs.get("empty_objective_only"):
                self.assertIsNone(kwargs.get("hint"), "only Stage A is hinted")

    def test_a_crowded_row_still_returns_a_month(self):
        """
        64 pinned people outside every pool in one row: without the hint Stage A timed out
        and the month came back ok:false with the mandatory-lead diagnostic — the wrong
        cause (measured at 1, 2, 5 and 10 s per solve). The hinted run still needs ~0.2 s of
        presolve before its first solution, so a slow enough machine fails it too: 5 s per
        solve keeps roughly a 10x margin over the MacBook and the old solver still fails.
        """
        data = fixture(pinned=[pin(f"Z{i}", "Sun.Choir", 1) for i in range(64)],
                       solver_max_time_seconds=5, solver_total_budget_seconds=40)
        res = solve_from_dict(data)
        self.assertTrue(res["ok"], res.get("error"))
        self.assertEqual(res["pinned_honored"], 64)

    def test_the_stage_a_fall_through_carries_the_ceiling(self):
        """
        Earlier drafts said the fall-through escaped the ceiling. Solve 0 runs before
        Stage A, so it does not — and the fall-through is the path production reaches
        (0.33 vCPU, a 40 s budget) and CI does not by accident. Forced here by making
        every Stage B pass come back empty, which is "every tier infeasible" without
        depending on how fast the runner is.
        """
        original = mod.create_model_and_solve

        def stage_b_finds_nothing(**kwargs):
            if kwargs.get("violation_objective_only") or kwargs.get("empty_objective_only"):
                return original(**kwargs)
            return None

        mod.create_model_and_solve = stage_b_finds_nothing
        try:
            res, result, seen = instrumented(occupancy_case()[0])
        finally:
            mod.create_model_and_solve = original
        self.assertTrue(res["ok"], res.get("error"))
        self.assertEqual(result.fairness_limit_used, BIG, "the fall-through did not happen")
        stage_a_kwargs = [k for k, _ in seen if k.get("empty_objective_only")]
        self.assertEqual([k.get("violation_target") for k in stage_a_kwargs], [1],
                         "Stage A ran without the ceiling")
        self.assertTrue(res["violation_ceiling_proven"])
        self.assertEqual(len(res["pin_violations"]), seen[0][1].violations_used)
