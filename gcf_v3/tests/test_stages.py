"""Stages and settings (spec §7.1–§7.3, S3): order, fixing, the CP-SAT settings, budgets,
and honest statuses under stubbed limits."""

import types
import unittest

from ortools.sat.python import cp_model

from owt_v3.constants import STAGE_DET_LIMIT
from owt_v3.request import parse_request
from owt_v3.service import handle
from owt_v3.solver import solve_problem, stage_ids
from tests.builders import NOV_SUNDAYS, person, request, service
from tests.test_model import random_request


def small():
    svcs = [service("s1", NOV_SUNDAYS[0]), service("s2", NOV_SUNDAYS[1])]
    people = [person(p, {"s1": ["Lead", "BGV", "Choir"], "s2": ["Lead", "BGV", "Choir"]})
              for p in ("m-ana", "m-bea", "m-cris", "m-dario", "m-ema", "m-fede", "m-gala", "m-iris")]
    rules = [{"id": "pr-1", "kind": "presence", "persons": ["m-ana", "m-bea"], "roles": ["Sun.BGV"],
              "exclusive": False}]
    return request(svcs, people, rules=rules, seed=7)


def stub(fail, status=cp_model.UNKNOWN, clock=None, advance=0.0):
    """A solver factory whose stages in `fail` stop with `status`; every solve advances `clock`."""

    class Stub(cp_model.CpSolver):
        def __init__(self, stage):
            super().__init__()
            self.stage, self.stubbed = stage, False

        def Solve(self, model, *args, **kwargs):
            if clock is not None:
                clock.now += advance
            if self.stage in fail:
                self.stubbed = True
                if status == cp_model.FEASIBLE:  # a limit stopped it holding a solution
                    super().Solve(model, *args, **kwargs)
                return status
            return super().Solve(model, *args, **kwargs)

        def ResponseProto(self):
            if self.stubbed:
                return types.SimpleNamespace(deterministic_time=self.parameters.max_deterministic_time)
            return super().ResponseProto()

    return Stub


class FakeClock:
    def __init__(self):
        self.now = 0.0

    def __call__(self):
        return self.now


class Order(unittest.TestCase):
    def test_stages_run_in_the_spec_order(self):
        status, resp, _ = handle(small())
        self.assertEqual([s["id"] for s in resp["stages"]], [
            "rules", "fill", "cadence", "compensation", "voice_floor", "dl_floor", "sunday_cap", "saturday_cap",
            "no_consecutive", "balance_max:DL", "balance_sq:DL", "balance_max:SL", "balance_sq:SL",
            "balance_max:BGV", "balance_sq:BGV", "balance_max:P:pr-1", "balance_sq:P:pr-1", "balance_max:CORO",
            "balance_sq:CORO", "tiebreak"])
        self.assertEqual([s["id"] for s in resp["stages"]], stage_ids(parse_request(small())))

    def test_a_stage_with_no_terms_is_proven_zero_and_not_solved(self):
        _, resp, _ = handle(small())
        cadence = [s for s in resp["stages"] if s["id"] == "cadence"][0]
        self.assertEqual((cadence["status"], cadence["value"], cadence["ms"], cadence["limit"]),
                         ("proven", 0, 0, "none"))

    def test_the_ceiling_is_never_raised(self):
        for k in range(8):
            report, runner, _ = solve_problem(parse_request(random_request(k)))
            broken = sum(1 for i in report.instances if i.broken(report.assigned))
            self.assertLessEqual(broken, report.ceiling, f"request {k}")


class Settings(unittest.TestCase):
    def test_every_stage_uses_the_fixed_settings(self):
        report, runner, _ = solve_problem(parse_request(small()))
        self.assertTrue(runner.parameters)
        for stage, p in runner.parameters:
            self.assertEqual(p.num_search_workers, 1, stage)
            self.assertEqual(p.linearization_level, 2, stage)
            self.assertEqual(p.random_seed, 7, stage)
            self.assertEqual(p.max_deterministic_time, STAGE_DET_LIMIT, stage)
            self.assertLessEqual(p.max_time_in_seconds, 2.5, stage)

    def test_the_wall_guard_is_the_remaining_budget_when_smaller(self):
        clock = FakeClock()
        body = small()
        body["budget"] = {"total_seconds": 1}
        _, runner, _ = solve_problem(parse_request(body), clock=clock, solver_for=stub(set(), clock=clock, advance=0.3))
        walls = [p.max_time_in_seconds for _, p in runner.parameters]
        self.assertEqual(walls[0], 1.0)
        self.assertAlmostEqual(walls[1], 0.7)


class Statuses(unittest.TestCase):
    def test_no_solution_in_rules_or_fill_is_a_timeout(self):
        for stage in ("rules", "fill"):
            status, resp, log = handle(small(), solver_for=stub({stage}))
            self.assertEqual((status, resp["code"], resp["params"]["stage"]), (422, "timeout", stage))
            self.assertEqual(log["code"], "timeout")

    def test_no_solution_after_fill_ends_the_run(self):
        status, resp, _ = handle(small(), solver_for=stub({"voice_floor"}))
        self.assertEqual(status, 200)
        by_id = {s["id"]: s for s in resp["stages"]}
        self.assertEqual((by_id["voice_floor"]["status"], by_id["voice_floor"]["reason"]),
                         ("not_run", "no_solution_in_limit"))
        later = resp["stages"][[s["id"] for s in resp["stages"]].index("voice_floor") + 1:]
        self.assertTrue(later)
        self.assertTrue(all(s["status"] == "not_run" and s["reason"] == "stopped_earlier" for s in later))
        self.assertFalse(resp["reproducible"])

    def test_a_stage_that_cannot_start_is_not_run_budget(self):
        clock = FakeClock()
        body = small()
        body["budget"] = {"total_seconds": 1}
        status, resp, _ = handle(body, clock=clock, solver_for=stub(set(), clock=clock, advance=0.45))
        reasons = {s["id"]: s.get("reason") for s in resp["stages"] if s["status"] == "not_run"}
        self.assertTrue(reasons)
        self.assertEqual(set(reasons.values()), {"budget"})

    def test_a_stage_stopped_by_a_limit_is_unproven(self):
        status, resp, _ = handle(small(), solver_for=stub({"balance_sq:DL"}, status=cp_model.FEASIBLE))
        by_id = {s["id"]: s for s in resp["stages"]}
        self.assertEqual((by_id["balance_sq:DL"]["status"], by_id["balance_sq:DL"]["limit"]),
                         ("unproven", "deterministic"))
        self.assertEqual(by_id["tiebreak"]["status"], "proven")  # the run goes on with its value fixed
        self.assertFalse(resp["reproducible"])

    def test_a_proven_infeasible_is_a_defect(self):
        status, resp, log = handle(small(), solver_for=stub({"cadence", "dl_floor"}, status=cp_model.INFEASIBLE))
        self.assertEqual((status, resp["code"]), (500, "internal_error"))
        self.assertEqual(log["stage"], "dl_floor")


if __name__ == "__main__":
    unittest.main()
