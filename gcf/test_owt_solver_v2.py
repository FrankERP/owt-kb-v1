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

    # One month of history, HAND-WRITTEN for the reason test_degradation_is_reported_
    # not_silent gives: the bound must be a property of the fixture, not of the search.
    # The ladder reads only the MAXIMA of the offsets, so a uniform entry pins it. These
    # are the maxima a real four-week, every-Saturday month produced (seed 42) — six
    # services, Sat.Lead four times, two each of BGV and Choir — and on that shape they
    # bound the ladder at 8.0e18: over CP-SAT's real limit, INT64_MAX // 2 (4.6e18), and
    # under INT64_MAX (9.2e18). A guard at INT64_MAX let exactly this window through,
    # built an integer objective and got MODEL_INVALID back on every optimising pass.
    ONE_MONTH = [{
        "total_counts": {p: 6 for p in ROSTER},
        "role_counts": {p: {"Sun.Lead": 1, "Sat.Lead": 4, "Sun.BGV": 2,
                            "Sat.BGV": 2, "Sun.Choir": 2} for p in ROSTER},
    }]

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

        # Every history-free shape, plus one history-bearing shape whose ladder sits
        # between INT64_MAX // 2 and INT64_MAX — see ONE_MONTH.
        cases = [(weeks, sats, []) for weeks, sats in self.SHAPES]
        cases.append((4, [1, 2, 3, 4], self.ONE_MONTH))

        cp_model.CpSolver.Solve = record
        try:
            for weeks, sats, history in cases:
                with self.subTest(weeks=weeks, saturdays=len(sats), history=len(history)):
                    seen.clear()
                    res = solve_from_dict(self._shape(weeks, sats, history))
                    self.assertTrue(res.get("ok"), res.get("error"))
                    self.assertNotIn(
                        "MODEL_INVALID", seen,
                        f"{weeks}wk/{len(sats)}sat, {len(history)} history: "
                        f"ortools rejected the objective")

        finally:
            cp_model.CpSolver.Solve = original

    def test_the_guard_is_cpsat_ceiling_not_int64(self):
        """
        ONE_MONTH's ladder sits between INT64_MAX // 2 and INT64_MAX, and the guard in
        compute_priority_weights must catch it ITSELF. The validator check in
        create_model_and_solve would catch it too, so the test above cannot tell a guard
        at INT64_MAX from one at CP-SAT's real ceiling — this one can. The validator is
        the backstop for the reachable-vs-domain sliver, not the gate.
        """
        import owt_solver_v2 as mod
        from owt_solver_v2 import ObjectiveTooLarge

        outcomes = []
        original = mod.compute_priority_weights

        def record(*args):
            try:
                weights = original(*args)
            except ObjectiveTooLarge:
                outcomes.append("raised")
                raise
            outcomes.append("fitted")
            return weights

        mod.compute_priority_weights = record
        try:
            res = solve_from_dict(self._shape(4, [1, 2, 3, 4], self.ONE_MONTH))
        finally:
            mod.compute_priority_weights = original

        self.assertTrue(res.get("ok"), res.get("error"))
        self.assertTrue(outcomes, "no optimising pass ran; the guard saw nothing")
        self.assertEqual(set(outcomes), {"raised"})
        self.assertTrue(res["objective_skipped"])

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
        must say so. Assert both directions on the same shape.

        The history here is HAND-WRITTEN and sized well past the ceiling, deliberately.
        An earlier version chained the solver's own output forward, which put the
        objective bound 4% over int64 — so whether the assertion held depended on which
        person happened to take which seat two months earlier. One Sat.BGV seat moves
        that cap by up to 10, several times the flip threshold. In a blocking CI gate
        that is a red check on an unrelated PR, and the pressure then is to disable the
        gate rather than debug it. The bound must be a property of the fixture, not of
        the search.
        """
        clean = solve_from_dict(self._shape(4, [2, 4], []))
        self.assertTrue(clean.get("ok"), clean.get("error"))
        self.assertFalse(
            clean["objective_skipped"],
            "a history-free month is exactly what per-tier maxima fix; if this is "
            "True the ladder is no longer fitting where it should")

        # Every member maxed out for three months running — far past any real roster,
        # and far past the ceiling, so the flip cannot depend on the search.
        heavy = [{
            "total_counts": {p: 40 for p in ROSTER},
            "role_counts": {p: {r: 8 for r in
                                ["Sun.Lead", "Sat.Lead", "Sun.BGV", "Sat.BGV", "Sun.Choir"]}
                            for p in ROSTER},
        } for _ in range(3)]

        loaded = solve_from_dict(self._shape(4, [2, 4], heavy))
        self.assertTrue(loaded.get("ok"), loaded.get("error"))
        self.assertTrue(
            loaded["objective_skipped"],
            "history this large cannot fit the ladder; the flag must report it")

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

    def test_an_optimize_false_return_reports_objective_skipped(self):
        """
        The other half of the flag. On a clean month the ladder returns from an
        optimising pass, so the test above only ever sees Stage A as an objective-less
        return — it passes whether or not an optimize=False pass reports anything.
        Force the case it cannot reach: every optimising pass comes back empty-handed,
        which is what a timeout looks like to the ladder, so the month lands on an
        optimize=False sibling. That pass builds no objective and the RESPONSE must say
        so, not just the SolveResult.
        """
        import owt_solver_v2 as mod

        original = mod.create_model_and_solve
        returned = []

        def optimising_passes_time_out(**kwargs):
            if kwargs.get("optimize", True) and not kwargs.get("empty_objective_only"):
                return None
            result = original(**kwargs)
            if result is not None:
                returned.append("stage_a" if kwargs.get("empty_objective_only") else "ladder")
            return result

        mod.create_model_and_solve = optimising_passes_time_out
        try:
            res = solve_from_dict(self._shape(4, [2, 4], []))
        finally:
            mod.create_model_and_solve = original

        self.assertTrue(res.get("ok"), res.get("error"))
        self.assertEqual(
            returned[-1], "ladder",
            "the month fell back to Stage A, so this never reached an optimize=False return")
        self.assertTrue(
            res["objective_skipped"],
            "an optimize=False pass builds no objective; the response must report it")

    def test_an_objective_less_tier_is_not_proved_infeasible_twice(self):
        """
        Once the objective is skipped, a tier's optimize=True pass admits exactly the
        assignments its optimize=False sibling does and minimises nothing — it is the
        same problem. When it PROVES the tier infeasible the sibling can only prove it
        again, spending a pass of the 40 s budget on a month that is already degraded.

        Only a proof is final. A pass that ran out of time (UNKNOWN) still hands over:
        the sibling searches differently and may find what this one missed.

        Observed independently of the code under test — the model's own objective and
        the status ortools returned — rather than through the ladder's bookkeeping.
        """
        import owt_solver_v2 as mod
        from ortools.sat.python import cp_model

        heavy = [{
            "total_counts": {p: 40 for p in ROSTER},
            "role_counts": {p: {r: 8 for r in
                                ["Sun.Lead", "Sat.Lead", "Sun.BGV", "Sat.BGV", "Sun.Choir"]}
                            for p in ROSTER},
        } for _ in range(3)]

        solves = []
        passes = []
        original_solve = cp_model.CpSolver.Solve
        original_pass = mod.create_model_and_solve

        def record_solve(solver_self, model):
            status = original_solve(solver_self, model)
            solves.append((model.HasObjective(), status))
            return status

        def record_pass(**kwargs):
            result = original_pass(**kwargs)
            if not kwargs.get("empty_objective_only"):
                had_objective, status = solves[-1]
                tier = (kwargs["sun_lead_limit"], kwargs["sun_bgv_limit"],
                        kwargs["fairness_limit"])
                passes.append((tier, kwargs["optimize"], had_objective, status))
            return result

        cp_model.CpSolver.Solve = record_solve
        mod.create_model_and_solve = record_pass
        try:
            res = solve_from_dict(self._shape(4, [2, 4], heavy))
        finally:
            cp_model.CpSolver.Solve = original_solve
            mod.create_model_and_solve = original_pass

        proved = [tier for tier, optimize, had_objective, status in passes
                  if optimize and not had_objective and status == cp_model.INFEASIBLE]
        self.assertTrue(
            proved, f"no objective-less pass proved a tier infeasible; saw {passes}")
        for tier in proved:
            siblings = [p for p in passes if p[0] == tier and not p[1]]
            self.assertEqual(siblings, [], f"tier {tier} was proved infeasible twice")

        # Nothing the caller reads moves: the month lands on the same tier it did
        # when the sibling still ran, and still says the objective was skipped.
        self.assertTrue(res.get("ok"), res.get("error"))
        self.assertTrue(res["objective_skipped"])
        self.assertTrue(res["fairness_relaxed"])
        self.assertFalse(res["sun_lead_fairness_relaxed"])
        self.assertFalse(res["sun_bgv_fairness_relaxed"])

    def test_a_timed_out_objective_less_pass_still_hands_over(self):
        """
        The other side of that skip: only a PROOF is final. An objective-less pass that
        ran out of time proved nothing, and its sibling searches differently (AUTOMATIC
        rather than RANDOMIZED), so the ladder must still run it — skipping there could
        change the month. Simulated, because a real timeout depends on the machine.
        """
        import owt_solver_v2 as mod
        from ortools.sat.python import cp_model

        original = mod.create_model_and_solve
        ladder = []

        def objective_less_timeout(**kwargs):
            if kwargs.get("empty_objective_only"):
                return original(**kwargs)
            ladder.append(kwargs["optimize"])
            if kwargs["optimize"]:
                kwargs["pass_info"].update(objective_skipped=True, status=cp_model.UNKNOWN)
                return None
            return original(**kwargs)

        mod.create_model_and_solve = objective_less_timeout
        try:
            res = solve_from_dict(self._shape(4, [2, 4], []))
        finally:
            mod.create_model_and_solve = original

        self.assertTrue(res.get("ok"), res.get("error"))
        self.assertEqual(
            ladder[:2], [True, False],
            "a tier whose objective-less pass timed out must still run its sibling")

    def test_cpsat_validator_has_the_last_word(self):
        """
        compute_priority_weights bounds each tier by what it can REACH. CP-SAT validates
        the flattened objective against each variable's declared DOMAIN, and it reads
        the two Sun.Lead rotation tiers per person — measured 0.5-10% above the ladder's
        own figure. A month in that sliver passes the arithmetic guard and is still
        MODEL_INVALID, which the ladder reads as an infeasible tier.

        Put a model there on purpose: scale the weights until the top tier alone is
        past INT64_MAX // 2, behind the arithmetic guard's back. The pass must drop the
        objective and report it, never hand ortools a model it rejects.
        """
        import owt_solver_v2 as mod
        from ortools.sat.python import cp_model

        original_weights = mod.compute_priority_weights

        def past_the_guard(max_spread, max_consec, max_rand, tier_maxima=None):
            w = original_weights(max_spread, max_consec, max_rand, tier_maxima)
            top = w["Sun.Lead"] * tier_maxima["Sun.Lead"]
            scale = (2 ** 63 - 1) // 2 // top + 1
            return {k: v * scale for k, v in w.items()}

        seen = []
        original_solve = cp_model.CpSolver.Solve

        def record(solver_self, model):
            status = original_solve(solver_self, model)
            seen.append(solver_self.StatusName(status))
            return status

        mod.compute_priority_weights = past_the_guard
        cp_model.CpSolver.Solve = record
        try:
            res = solve_from_dict(self._shape(4, [2, 4], []))
        finally:
            mod.compute_priority_weights = original_weights
            cp_model.CpSolver.Solve = original_solve

        self.assertTrue(res.get("ok"), res.get("error"))
        self.assertNotIn("MODEL_INVALID", seen)
        self.assertTrue(res["objective_skipped"])

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
