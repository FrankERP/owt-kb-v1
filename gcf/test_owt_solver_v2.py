"""
Tests for owt_solver_v2 — graceful degradation, absence-based fairness slack,
and honest diagnostics. Stdlib unittest (no extra deps); run from gcf/:

    python3 -m unittest test_owt_solver_v2 -v

Capacities per service: Sunday = 2 Lead, 3 BGV, 3 Choir; Saturday = 2 Lead, 3 BGV.
Degradation order when short-staffed: Choir seats -> BGV seats -> 2nd Lead seat.
At least one Lead is always required (else a clear hard failure).
"""

import unittest

from owt_solver_v2 import solve_from_dict, ScheduleConfig

# 12-person default-style roster.
ROSTER = ["Frank", "Gaby", "Marianne", "Rachel", "Lali", "Hugo",
          "Jakey", "Mkz", "Niza", "Liu", "Lucía", "Pau E"]

# Default DSL rules (mirrors production preloaded set), minus week exclusions
# so tests can add their own availability.
BASE_RULES = [
    "Frank !in Sat.* & !in Sun.BGV & !in Sun.Choir & fairness_exempt",
    "Mkz !in Sat.* & !in Sun.BGV & !in Sun.Choir & fairness_exempt",
    "Gaby !in Sat.* & !in Sun.Choir & fairness_slack 1 & Sun.BGV <= {weeks-2}",
    "Lucía !with Niza on *.LeadBGV",
    "Hugo !with Lucía on *.Lead",
    "Niza !with Hugo on *.Lead",
    "Jakey !with Hugo on *.BGV",
    "Jakey !with Hugo on *.Lead",
    "any_of(Hugo,Jakey) on Sun.BGV each_week",
]

SUN_CAP = {"Lead": 2, "BGV": 3, "Choir": 3}
SAT_CAP = {"Lead": 2, "BGV": 3}


def make_config(rules=None, sat_weeks=(2, 4), sunday_leads=None,
                saturday_leads=None, support=None, weeks=4, seed=42, history=None):
    """Default: Sunday leads = everyone but Lucía, Saturday leads = [Lucía] (post-dedup)."""
    sl = sunday_leads if sunday_leads is not None else [p for p in ROSTER if p != "Lucía"]
    satl = saturday_leads if saturday_leads is not None else ["Lucía"]
    sup = support if support is not None else []
    return dict(
        weeks=weeks, weekends_with_saturday=list(sat_weeks),
        sunday_leads=sl, saturday_leads=satl, support=sup,
        dsl_rules=list(rules if rules is not None else BASE_RULES),
        history=list(history or []), seed=seed, solver_max_time_seconds=10,
    )


def out_rules(people, week, pattern="*.*"):
    """`!in week N` availability exclusions for a list of people."""
    return [f"{p} !in week {week} {pattern}" for p in people]


def iter_services(schedule):
    """Yield (week, service_name, roles_dict) for every service in a schedule."""
    for wk, services in schedule.items():
        for svc_name, roles in services.items():
            yield wk, svc_name, roles


class TestFullStaffNoDegradation(unittest.TestCase):
    """When everyone is available, every seat is filled — no gratuitous emptying."""

    def test_full_staff_fills_every_seat(self):
        res = solve_from_dict(make_config())
        self.assertTrue(res.get("ok"), res.get("error"))
        for wk, svc, roles in iter_services(res["schedule"]):
            cap = SUN_CAP if svc == "Sunday" else SAT_CAP
            for role, n in cap.items():
                self.assertEqual(
                    len(roles[role]), n,
                    f"W{wk} {svc} {role} should be full ({n}); got {roles[role]}")


class TestShortStaffSolvesInsteadOfFailing(unittest.TestCase):
    """Tight availability degrades seats rather than killing the whole month."""

    def test_sunday_short_staffed_still_solves(self):
        # 5 people out on week 2 -> can't fill all 8 Sunday seats. Must degrade, not fail.
        rules = BASE_RULES + out_rules(["Rachel", "Lali", "Liu", "Pau E", "Niza"], 2)
        res = solve_from_dict(make_config(rules=rules))
        self.assertTrue(res.get("ok"), f"should degrade, not fail: {res.get('error')}")

    def test_saturday_short_staffed_still_solves(self):
        rules = BASE_RULES + out_rules(["Rachel", "Lali", "Liu", "Jakey"], 2)
        res = solve_from_dict(make_config(rules=rules))
        self.assertTrue(res.get("ok"), f"should degrade, not fail: {res.get('error')}")


class TestDegradationPriorityOrder(unittest.TestCase):
    """Choir empties before BGV; BGV before the 2nd Lead; >=1 Lead always."""

    def _assert_priority_invariant(self, schedule):
        for wk, svc, roles in iter_services(schedule):
            cap = SUN_CAP if svc == "Sunday" else SAT_CAP
            lead_filled = len(roles["Lead"])
            bgv_filled = len(roles["BGV"])
            choir_cap = cap.get("Choir", 0)
            choir_filled = len(roles.get("Choir", []))

            # Lead never zero.
            self.assertGreaterEqual(
                lead_filled, 1, f"W{wk} {svc}: lead must never be empty")

            # If any BGV seat empty, Choir must be fully empty first.
            if bgv_filled < cap["BGV"] and choir_cap:
                self.assertEqual(
                    choir_filled, 0,
                    f"W{wk} {svc}: BGV degraded while Choir still has {choir_filled}")

            # If a Lead seat empty (lead_filled < 2), BGV and Choir must be fully empty.
            if lead_filled < cap["Lead"]:
                self.assertEqual(
                    bgv_filled, 0,
                    f"W{wk} {svc}: 2nd lead dropped while BGV has {bgv_filled}")
                self.assertEqual(
                    choir_filled, 0,
                    f"W{wk} {svc}: 2nd lead dropped while Choir has {choir_filled}")

    def test_choir_drops_before_bgv(self):
        # Leave ~7 available on week 2 Sunday: forces ~1 empty, must be a Choir seat.
        out = ["Rachel", "Lali", "Liu", "Pau E", "Niza"]
        res = solve_from_dict(make_config(rules=BASE_RULES + out_rules(out, 2)))
        self.assertTrue(res.get("ok"), res.get("error"))
        self._assert_priority_invariant(res["schedule"])

    def test_lead_drops_only_after_bgv_and_choir(self):
        # Brutally starve week 2 Saturday so only ~1 lead can serve.
        out = ["Marianne", "Rachel", "Lali", "Hugo", "Jakey", "Niza", "Liu", "Pau E"]
        res = solve_from_dict(make_config(rules=BASE_RULES + out_rules(out, 2, "Sat.*"),
                                          sat_weeks=(2,)))
        self.assertTrue(res.get("ok"), f"should degrade to 1 lead: {res.get('error')}")
        self._assert_priority_invariant(res["schedule"])


class TestZeroLeadsClearError(unittest.TestCase):
    """If a service genuinely has no available lead, fail with a specific message."""

    def test_zero_leads_reports_week_and_role(self):
        # Make EVERYONE unavailable on week 2 -> no leads possible that Saturday.
        rules = BASE_RULES + out_rules(ROSTER, 2)
        res = solve_from_dict(make_config(rules=rules, sat_weeks=(2,)))
        self.assertFalse(res.get("ok"))
        msg = (res.get("error") or "").lower()
        self.assertIn("lead", msg, f"diagnostic should name the lead bottleneck: {res.get('error')}")
        self.assertIn("2", res.get("error") or "", "diagnostic should name the week")


class TestDedicatedLeadRelaxed(unittest.TestCase):
    """Two dedicated leads, no non-dedicated available -> should NOT be infeasible."""

    def test_both_dedicated_allowed_when_no_alternative(self):
        # Dedicated Saturday leads = Liu, Lucía. Force all other Sat.Lead-eligible
        # people out of Sat.Lead on week 2 -> both seats must be dedicated.
        non_dedicated = ["Marianne", "Rachel", "Lali", "Hugo", "Jakey", "Niza", "Pau E"]
        rules = BASE_RULES + out_rules(non_dedicated, 2, "Sat.Lead")
        cfg = make_config(rules=rules, sat_weeks=(2,),
                          sunday_leads=[p for p in ROSTER if p not in ("Liu", "Lucía")],
                          saturday_leads=["Liu", "Lucía"], support=[])
        res = solve_from_dict(cfg)
        self.assertTrue(res.get("ok"), f"both-dedicated should be allowed: {res.get('error')}")


class TestForbiddenStillRespected(unittest.TestCase):
    """Degradation must not break hard DSL exclusions."""

    def test_forbidden_person_never_assigned_to_role(self):
        res = solve_from_dict(make_config())
        self.assertTrue(res.get("ok"), res.get("error"))
        for wk, svc, roles in iter_services(res["schedule"]):
            if svc == "Sunday":
                self.assertNotIn("Frank", roles["BGV"], f"W{wk}: Frank forbidden Sun.BGV")
                self.assertNotIn("Frank", roles["Choir"], f"W{wk}: Frank forbidden Sun.Choir")
            if svc == "Saturday":
                self.assertNotIn("Frank", roles["Lead"], f"W{wk}: Frank forbidden Sat.*")
                self.assertNotIn("Mkz", roles["Lead"], f"W{wk}: Mkz forbidden Sat.*")


class TestAbsenceSlackHelper(unittest.TestCase):
    """Per-person services-unavailable count drives automatic fairness slack."""

    def test_compute_absence_slack_counts_services(self):
        from owt_solver_v2 import compute_absence_slack
        # Lucía out week 3 (*.*); weeks=4 with Saturdays on weeks 2 and 4.
        # Week 3 has only a Sunday service (no Saturday) -> 1 service missed.
        week_exclusions = _parse_week_exclusions(["Lucía !in week 3 *.*"], ROSTER)
        slack = compute_absence_slack(week_exclusions, weeks=4, sat_weeks=[2, 4],
                                      all_people=ROSTER)
        self.assertEqual(slack.get("Lucía", 0), 1)
        # Someone with no exclusions has zero slack.
        self.assertEqual(slack.get("Hugo", 0), 0)

    def test_full_weekend_absence_counts_two_services(self):
        from owt_solver_v2 import compute_absence_slack
        # Out on week 2, which HAS a Saturday -> misses both Sunday and Saturday = 2.
        week_exclusions = _parse_week_exclusions(["Hugo !in week 2 *.*"], ROSTER)
        slack = compute_absence_slack(week_exclusions, weeks=4, sat_weeks=[2, 4],
                                      all_people=ROSTER)
        self.assertEqual(slack.get("Hugo", 0), 2)


def _parse_week_exclusions(rules, roster):
    """Helper: extract the week-exclusion rules the way the solver does."""
    from owt_solver_v2 import parse_dsl_rules
    parsed = parse_dsl_rules(rules, set(roster))
    # parse_dsl_rules returns a tuple; week_exclusions is index 6.
    return parsed[6]


class TestDefaultConfigRegression(unittest.TestCase):
    """The built-in default config must still solve cleanly."""

    def test_default_config_solves(self):
        from owt_solver_v2 import build_default_config, solve_schedule
        result = solve_schedule(build_default_config())
        self.assertEqual(len(result.assignments) > 0, True)


class TestSolverBudgetClamping(unittest.TestCase):
    """Caller-supplied solver budgets are clamped to safe ceilings (DoS guard)."""

    def test_clamp_helper(self):
        from owt_solver_v2 import _clamp
        self.assertEqual(_clamp(5, 1, 30), 5)      # within range unchanged
        self.assertEqual(_clamp(0, 1, 30), 1)      # below floor -> floor
        self.assertEqual(_clamp(-3, 1, 110), 1)    # negative -> floor
        self.assertEqual(_clamp(1000, 1, 8), 8)    # above ceiling -> ceiling

    def test_solve_from_dict_clamps_extreme_budgets(self):
        import owt_solver_v2 as mod
        captured = {}
        orig = mod.solve_schedule

        def spy(config):
            captured["config"] = config
            return orig(config)

        data = make_config()
        data.update({  # hostile values a malicious caller might send
            "solver_max_time_seconds": 999,
            "solver_num_search_workers": 1000,
            "solver_total_budget_seconds": 9999,
        })
        mod.solve_schedule = spy
        try:
            res = solve_from_dict(data)
        finally:
            mod.solve_schedule = orig

        cfg = captured["config"]
        self.assertEqual(cfg.solver_max_time_seconds, 30)      # ceil
        self.assertEqual(cfg.solver_num_search_workers, 8)     # ceil
        self.assertEqual(cfg.solver_total_budget_seconds, 110) # ceil
        self.assertTrue(res.get("ok"))  # still solves fine with clamped budgets


if __name__ == "__main__":
    unittest.main(verbosity=2)
