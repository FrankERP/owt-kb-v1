"""The stage pipeline (spec §7.1): validation and planned shares before the budget, then
model build, the stages in order, and the report after it.
"""

import time

from .facts import Facts
from .instances import build_instances
from .model import Model
from .plan import compute_plan
from .report import Report
from .stages import Runner

PROTECTION_STAGES = ("cadence", "compensation", "voice_floor", "dl_floor", "sunday_cap", "saturday_cap",
                     "no_consecutive")


def stage_ids(problem):
    ids = ["rules", "fill", *PROTECTION_STAGES]
    for line in problem.lines:
        ids += [f"balance_max:{line}", f"balance_sq:{line}"]
    return ids + ["tiebreak"]


def solve_problem(problem, clock=time.perf_counter, solver_for=None, consecutive_last=False):
    """Returns (Report, runner, model). Raises SolveTimeout / SolverDefect (§7.3).

    `consecutive_last` is the acceptance harness's run O only (the prototype's order, with
    `no_consecutive` after the balances); it never reaches the wire.
    """
    F = Facts(problem)
    plan = compute_plan(F)
    instances, notices = build_instances(F)
    started = clock()  # the 25 s budget counts from the start of model build (§7.2)
    model = Model(F, plan, instances)
    runner = Runner(model, problem.budget, problem.seed, clock=clock, solver_for=solver_for, started=started)
    rec = runner.run("rules", *model.obj_rules(), essential=True)
    ceiling = rec["value"]
    runner.run("fill", *model.obj_fill(), sense="max", essential=True)
    for stage in PROTECTION_STAGES:
        if consecutive_last and stage == "no_consecutive":
            continue
        runner.run(stage, *getattr(model, f"obj_{stage}")())
    carried = lambda p, line: problem.people[p].carried.get(line, 0)
    for line in problem.lines:
        inputs = model.balance_inputs(carried, line)
        runner.run(f"balance_max:{line}", *model.obj_balance_max(inputs))
        runner.run(f"balance_sq:{line}", *model.obj_balance_sq(inputs))
    if consecutive_last:
        runner.run("no_consecutive", *model.obj_no_consecutive())
    runner.run("tiebreak", *model.obj_tiebreak(problem.seed), fix=False)
    values = runner.values
    if values is None:  # every stage had no terms: the only seats are pins
        values = {c: 1 if c in F.pinned else 0 for c in F.cells}
    report = Report(F, plan, instances, notices, runner.records, values, ceiling)
    return report, runner, model
