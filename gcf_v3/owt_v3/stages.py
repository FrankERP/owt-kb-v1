"""Stage runner (spec §7.1–§7.3, S3): each stage solved, then fixed at the value it found
before the next one runs; fixed CP-SAT settings; a deterministic limit per stage with a
wall-clock guard; a total budget counted from the start of model build.
"""

import time

from ortools.sat.python import cp_model

from .codes import code
from .constants import STAGE_START_FLOOR


class SolveTimeout(Exception):
    """`rules` or `fill` found no solution within its limits (§7.3)."""

    def __init__(self, stage, seconds):
        super().__init__("timeout")
        self.stage, self.seconds = stage, seconds


class SolverDefect(Exception):
    """A proven INFEASIBLE (or an invalid model) in any stage: a defect, never «no solution»."""

    def __init__(self, stage):
        super().__init__("internal_error")
        self.stage = stage


def stage_parameters(solver, seed, det_limit, wall):
    p = solver.parameters
    p.num_search_workers = 1
    p.linearization_level = 2
    p.random_seed = seed
    p.max_deterministic_time = det_limit
    p.max_time_in_seconds = wall
    return p


class Runner:
    def __init__(self, model, budget, seed, clock=time.perf_counter, solver_for=None, started=None):
        """`solver_for(stage_id)` returns the CP-SAT solver of one stage (tests stub it)."""
        self.model, self.budget, self.seed = model, budget, seed
        self.clock = clock
        self.solver_for = solver_for or (lambda stage_id: cp_model.CpSolver())
        self.started = clock() if started is None else started
        self.records = []
        self.parameters = []  # (stage id, CP-SAT parameters) — for tests; never on the wire
        self.values = None  # the last solution: {cell: 0/1}
        self.received = None
        self.stopped = False
        self._hint = None

    def remaining(self):
        return self.budget.total_seconds - (self.clock() - self.started)

    def _record(self, stage_id, status, value=0, bound=0, limit="none", ms=0, det_milli=0, reason=None):
        rec = {"id": code("stage", stage_id), "status": code("stage_status", status)}
        if reason is not None:
            rec["reason"] = code("stage_reason", reason)
        rec.update(value=value, bound=bound, limit=code("limit", limit), ms=ms, det_milli=det_milli)
        self.records.append(rec)
        return rec

    def skip_rest(self, stage_ids):
        for sid in stage_ids:
            self._record(sid, "not_run", reason="stopped_earlier")

    def run(self, stage_id, objective, has_terms, sense="min", fix=True, essential=False):
        """Solve one stage. Returns the record. `essential` stages (rules, fill) raise on no solution."""
        if self.stopped:
            return self._record(stage_id, "not_run", reason="stopped_earlier")
        if not has_terms:
            return self._record(stage_id, "proven")
        remaining = self.remaining()
        if remaining < STAGE_START_FLOOR:
            if essential:
                raise SolveTimeout(stage_id, round(self.clock() - self.started, 3))
            return self._record(stage_id, "not_run", reason="budget")
        m = self.model.m
        if sense == "min":
            m.Minimize(objective)
        else:
            m.Maximize(objective)
        solver = self.solver_for(stage_id)
        wall = min(self.budget.stage_seconds, remaining)
        self.parameters.append((stage_id, stage_parameters(solver, self.seed, self.budget.stage_det_limit, wall)))
        t0 = self.clock()
        status = solver.Solve(m)
        ms = int(round((self.clock() - t0) * 1000))
        det = solver.ResponseProto().deterministic_time
        det_milli = int(round(det * 1000))
        if status in (cp_model.INFEASIBLE, cp_model.MODEL_INVALID):
            raise SolverDefect(stage_id)
        if status == cp_model.OPTIMAL:
            limit = "none"
        else:
            limit = "deterministic" if det >= self.budget.stage_det_limit * 0.999 else "wall"
        if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
            if essential:
                raise SolveTimeout(stage_id, round(self.clock() - self.started, 3))
            self.stopped = True
            return self._record(stage_id, "not_run", limit=limit, ms=ms, det_milli=det_milli,
                                reason="no_solution_in_limit")
        value = int(round(solver.ObjectiveValue()))
        bound = int(round(solver.BestObjectiveBound()))
        if fix:
            m.Add(objective <= value) if sense == "min" else m.Add(objective >= value)
        m.ClearHints()
        for v in self.model.allvars:
            m.AddHint(v, solver.Value(v))
        self.values = {c: solver.Value(v) for c, v in self.model.x.items()}
        self.received = {k: solver.Value(v) for k, v in self.model.n.items()}  # tests: model view of §6.6
        return self._record(stage_id, "proven" if status == cp_model.OPTIMAL else "unproven",
                            value=value, bound=bound, limit=limit, ms=ms, det_milli=det_milli)
