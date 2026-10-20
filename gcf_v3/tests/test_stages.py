"""Stages and settings (spec §7.1–§7.3, S3): order, fixing, the CP-SAT settings, budgets,
and honest statuses under stubbed limits."""

import types
import unittest
from unittest import mock

from ortools.sat.python import cp_model

from owt_v3.constants import STAGE_DET_LIMIT
from owt_v3.model import Model
from owt_v3.request import parse_request
from owt_v3.service import handle, public_label
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
            "balance_sq:CORO", "balance_max:TOTAL", "balance_sq:TOTAL", "tiebreak"])
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


def total_tie(exempt=False, carried=None):
    """Two members with the same eligibility tie on one BGV seat (Nov 8) and one Coro seat (Nov 15):
    every other seat seats them both, so each line is 1.5 apiece whoever takes the odd seat. Per line
    the four plans are equal; only Total tells «one each» from «both to the same person»."""
    svcs = [service("s1", NOV_SUNDAYS[0], seats={"Lead": 0, "BGV": 2, "Choir": 0}),
            service("s2", NOV_SUNDAYS[1], seats={"Lead": 0, "BGV": 1, "Choir": 0}),
            service("s3", NOV_SUNDAYS[2], seats={"Lead": 0, "BGV": 0, "Choir": 1}),
            service("s4", NOV_SUNDAYS[3], seats={"Lead": 0, "BGV": 0, "Choir": 2})]
    elig = {sv["id"]: ["BGV", "Choir"] for sv in svcs}
    people = [person("m-ana", elig, carried=carried, exempt=exempt), person("m-bea", elig)]
    return svcs, people


class TotalStage(unittest.TestCase):
    """ADR-0058: the Total pair runs after every line pair, so it only breaks the lines' ties."""

    def solve(self, seed, exempt=False, carried=None, with_total=True):
        svcs, people = total_tie(exempt, carried)
        problem = parse_request(request(svcs, people, seed=seed))
        if with_total:
            return solve_problem(problem)
        with mock.patch.object(Model, "total_inputs", return_value=[]):
            return solve_problem(problem)

    def test_the_total_inputs_are_planned_shares_and_received_seats(self):
        report, runner, model = self.solve(1)
        self.assertEqual({p: k for p, k, _, _ in model.total_inputs()}, {"m-ana": 300, "m-bea": 300})
        tabs = {pp["person"]: pp["tabs"]["TOTAL"]["seats"] for pp in report.fairness()["people"]}
        seats = {p: sum(v for (q, _), v in runner.received.items() if q == p) for p in tabs}
        self.assertEqual(seats, tabs)  # n over every line is the Total tab's seats

    def test_the_planned_total_is_rounded_once(self):
        # thirds on two lines: 4/3 + 4/3 = 8/3 is 267 hundredths, not 133 + 133
        elig = {sid: ["BGV", "Choir"] for sid in ("s1", "s2", "s3", "s4")}
        svcs = [service("s1", NOV_SUNDAYS[0], seats={"Lead": 0, "BGV": 1, "Choir": 0}),
                service("s2", NOV_SUNDAYS[1], seats={"Lead": 0, "BGV": 0, "Choir": 1}),
                service("s3", NOV_SUNDAYS[2], seats={"Lead": 0, "BGV": 3, "Choir": 0}),
                service("s4", NOV_SUNDAYS[3], seats={"Lead": 0, "BGV": 0, "Choir": 3})]
        people = [person(p, elig) for p in ("m-ana", "m-bea", "m-cris")]
        _, _, model = solve_problem(parse_request(request(svcs, people, seed=1)))
        self.assertEqual([k for _, k, _, _ in model.total_inputs()], [267, 267, 267])

    def test_a_carried_balance_stays_on_its_line(self):
        # each line's stage repays its own carried balance; Total counting it too would repay it twice
        _, _, model = self.solve(1, carried={"SL": -100, "BGV": 40})
        self.assertEqual([k for _, k, _, _ in model.total_inputs()], [300, 300])

    def test_a_repaid_line_debt_can_move_to_another_line(self):
        # ADR-0058's accepted trade-off: the BGV stage repays her old debt with the odd BGV seat, so
        # Total, which counts this plan only, gives the odd Coro seat to the other person
        for seed in range(1, 9):
            report, _, _ = self.solve(seed, carried={"BGV": 100})
            self.assertEqual((report.assignment["s2"]["BGV"], report.assignment["s3"]["Choir"]),
                             (["m-ana"], ["m-bea"]), f"seed {seed}")

    def test_an_exempt_person_is_outside_the_total_set(self):
        _, _, model = self.solve(1, exempt=True)
        self.assertEqual([p for p, *_ in model.total_inputs()], ["m-bea"])

    def test_the_odd_seats_go_one_each(self):
        stacked_without = False
        for seed in range(1, 9):
            report, runner, _ = self.solve(seed)
            odd = (report.assignment["s2"]["BGV"], report.assignment["s3"]["Choir"])
            self.assertNotEqual(odd[0], odd[1], f"seed {seed}")
            values = {r["id"]: r["value"] for r in runner.records if r["id"] != "tiebreak"}
            base, base_runner, _ = self.solve(seed, with_total=False)
            base_values = {r["id"]: r["value"] for r in base_runner.records if r["id"] != "tiebreak"}
            self.assertEqual({k: v for k, v in values.items() if "TOTAL" not in k},
                             {k: v for k, v in base_values.items() if "TOTAL" not in k}, f"seed {seed}")
            stacked_without |= base.assignment["s2"]["BGV"] == base.assignment["s3"]["Choir"]
        self.assertTrue(stacked_without)  # without the pair the tie-break sometimes stacks them

    def test_the_total_stage_ids_are_their_own_public_labels(self):
        for sid in ("balance_max:TOTAL", "balance_sq:TOTAL"):
            self.assertEqual(public_label(sid, ["pr-1"]), sid)


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
