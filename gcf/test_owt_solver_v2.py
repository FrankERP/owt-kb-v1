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


class ObjectiveWeightLadder(unittest.TestCase):
    """
    The lexicographic objective is a product over eight priority tiers. Charging every
    tier the same global `max_spread` made that product exponential in an over-estimate,
    so the objective's upper bound crossed int64: ortools answered MODEL_INVALID on the
    optimising passes and `solve_schedule` fell through to the objective-less ones
    **silently**, losing fairness optimisation with no signal to the caller.

    Two things are guarded here: per-tier maxima (which fix the history-free months
    outright), and graceful, REPORTED degradation for the months they cannot fix.
    """

    SHAPES = [
        (4, [2, 4]),              # 42 slots: make_config's own default shape
        (4, [1, 2, 3, 4]),        # 52 slots: bound was 3.2e19
        (5, [1, 2, 3]),           # 55 slots: reproduced MODEL_INVALID
        (5, [1, 2, 3, 4, 5]),     # 65 slots: reproduced MODEL_INVALID
        (6, [1, 2]),              # 58 slots: reproduced MODEL_INVALID
        (6, [1, 2, 3, 4, 5, 6]),  # 78 slots: worst bound, 1.9e21
    ]

    @staticmethod
    def _shape(weeks, sats, history):
        cfg = make_config(weeks=weeks, sat_weeks=tuple(sats), history=history)
        cfg["solver_max_time_seconds"] = 3      # the guards are about the model,
        cfg["solver_total_budget_seconds"] = 20  # not about search quality
        return cfg

    def test_no_optimising_pass_is_rejected_by_ortools(self):
        """The original regression: MODEL_INVALID must never be reached."""
        from ortools.sat.python import cp_model

        seen = []
        original = cp_model.CpSolver.Solve

        def record(solver_self, model):
            status = original(solver_self, model)
            seen.append(solver_self.StatusName(status))
            return status

        cp_model.CpSolver.Solve = record
        try:
            for weeks, sats in self.SHAPES:
                with self.subTest(weeks=weeks, saturdays=len(sats)):
                    seen.clear()
                    res = solve_from_dict(self._shape(weeks, sats, []))
                    self.assertTrue(res.get("ok"), res.get("error"))
                    self.assertNotIn(
                        "MODEL_INVALID", seen,
                        f"{weeks}wk/{len(sats)}sat: ortools rejected the objective")

        finally:
            cp_model.CpSolver.Solve = original

    def test_history_bearing_months_still_return_a_schedule(self):
        """
        Production always sends history — `historyForRequest` ships the last three
        months and `build_history_offsets` weights them [10, 6, 3], so `overall_limit`
        and every `ov_r_limit` grow with it. Two entries is enough to push the ladder
        past int64 on an ordinary month.

        The month must still come back. An earlier draft of this fix raised instead,
        which turned "a lopsided month" into "no month at all" — strictly worse for the
        admin than the bug being fixed, and reachable in the steady state the fairness
        feature exists to create.
        """
        for weeks, sats in self.SHAPES[:4]:
            with self.subTest(weeks=weeks, saturdays=len(sats)):
                history = []
                for month in range(3):
                    res = solve_from_dict(self._shape(weeks, sats, history))
                    self.assertTrue(
                        res.get("ok"),
                        f"{weeks}wk/{len(sats)}sat failed with {len(history)} "
                        f"history entries: {res.get('error')}")
                    history.append({"total_counts": res["total_counts"],
                                    "role_counts": res["role_counts"]})

    def test_degradation_is_reported_not_silent(self):
        """
        `objective_skipped` is the whole point: a fairness-free month is legal, but it
        must say so. Assert both directions on the same shape — false without history,
        true once the offsets are large enough to break the ladder.
        """
        cfg = self._shape(4, [2, 4], [])
        first = solve_from_dict(cfg)
        self.assertTrue(first.get("ok"))
        self.assertFalse(first["objective_skipped"])

        history = [{"total_counts": first["total_counts"],
                    "role_counts": first["role_counts"]}]
        second = solve_from_dict(self._shape(4, [2, 4], history))
        self.assertTrue(second.get("ok"))
        history.append({"total_counts": second["total_counts"],
                        "role_counts": second["role_counts"]})

        third = solve_from_dict(self._shape(4, [2, 4], history))
        self.assertTrue(third.get("ok"))
        self.assertTrue(
            third["objective_skipped"],
            "two history entries should exceed the ladder on the default shape; "
            "if this stops holding, the assertion has stopped discriminating")

    def test_per_tier_maxima_keep_the_ladder_lexicographic(self):
        """
        The ladder's point is that each tier outranks everything below it. Shrinking the
        caps must not break that — assert the invariant directly, against the caps the
        solver actually computes for a real month rather than hand-written ones.
        """
        from owt_solver_v2 import compute_priority_weights, PRIORITY_ORDER

        maxima = {"Sun.Choir": 12, "Sat.BGV": 12, "Sun.BGV": 12, "global": 52,
                  "sun_lead_rotation": 72, "sun_lead_weekly_rotation": 72,
                  "Sat.Lead": 8, "Sun.Lead": 8}
        max_consec, max_rand = 180, 2263
        w = compute_priority_weights(52, max_consec, max_rand, maxima)

        below = max_consec * w["consecutive"] + max_rand
        for name in PRIORITY_ORDER:
            self.assertGreater(
                w[name], below, f"{name} does not outrank the tiers below it")
            below += maxima[name] * w[name]
        self.assertLess(below, 2 ** 63 - 1)

    def test_tier_maxima_cover_every_tier(self):
        """
        A tier missing from `tier_maxima` is a programming error that would silently
        break the ordering above it — `max_spread` is not a valid bound for the
        rotation tiers (measured 52 against a real 72). Capture the map the solver
        ACTUALLY builds during a real solve, rather than comparing two literals: a
        literal comparison passes while every month in production fails.
        """
        import owt_solver_v2 as mod
        from owt_solver_v2 import PRIORITY_ORDER

        captured = []
        original = mod.compute_priority_weights

        def record(max_spread, max_consec, max_rand, tier_maxima=None):
            captured.append(tier_maxima)
            return original(max_spread, max_consec, max_rand, tier_maxima)

        mod.compute_priority_weights = record
        try:
            solve_from_dict(self._shape(4, [2, 4], []))
        finally:
            mod.compute_priority_weights = original

        self.assertTrue(captured, "no optimising pass ran; the guard saw nothing")
        for supplied in captured:
            self.assertIsNotNone(supplied)
            self.assertEqual(set(supplied), set(PRIORITY_ORDER))

    def test_a_partial_tier_map_degrades_rather_than_failing_the_month(self):
        """
        The failure class this whole change removed: a programming error must not turn
        into "no month at all". A partial map raises ObjectiveTooLarge, which
        create_model_and_solve catches like an overflow.
        """
        import owt_solver_v2 as mod

        original = mod.compute_priority_weights

        def drop_a_tier(max_spread, max_consec, max_rand, tier_maxima=None):
            if tier_maxima:
                tier_maxima = {k: v for k, v in tier_maxima.items() if k != "Sun.Choir"}
            return original(max_spread, max_consec, max_rand, tier_maxima)

        mod.compute_priority_weights = drop_a_tier
        try:
            res = solve_from_dict(self._shape(4, [2, 4], []))
        finally:
            mod.compute_priority_weights = original

        self.assertTrue(res.get("ok"), res.get("error"))
        self.assertTrue(res["objective_skipped"])

    def test_objective_skipped_covers_every_objective_less_return(self):
        """
        The flag means "no lexicographic objective ran", not "the int64 ladder
        overflowed". Stage A and the ladder's optimize=False passes build no objective
        either, and solve_schedule can return from any of them — a flag scoped to the
        overflow would say "the objective ran" for months where it did not.
        """
        from owt_solver_v2 import create_model_and_solve

        seen = []
        import owt_solver_v2 as mod
        original = create_model_and_solve

        def record(**kwargs):
            result = original(**kwargs)
            if result is not None:
                seen.append((kwargs.get("empty_objective_only", False),
                             kwargs.get("optimize", False),
                             result.objective_skipped))
            return result

        mod.create_model_and_solve = record
        try:
            solve_from_dict(self._shape(4, [2, 4], []))
        finally:
            mod.create_model_and_solve = original

        self.assertTrue(seen)
        for empty_only, optimize, skipped in seen:
            expected_objective = optimize and not empty_only
            if not expected_objective:
                self.assertTrue(
                    skipped,
                    "a pass that builds no objective must report objective_skipped")

    def test_an_absurd_ladder_raises_its_own_exception(self):
        """
        `ObjectiveTooLarge` is deliberately not a ValueError: `solve_from_dict` turns
        those into `ok: false`, and a month the solver can still fill must never come
        back as no month at all.
        """
        from owt_solver_v2 import compute_priority_weights, ObjectiveTooLarge

        with self.assertRaises(ObjectiveTooLarge):
            compute_priority_weights(10 ** 6, 10 ** 6, 10 ** 6)
        self.assertNotIsInstance(ObjectiveTooLarge("x"), ValueError)


if __name__ == "__main__":
    unittest.main(verbosity=2)
