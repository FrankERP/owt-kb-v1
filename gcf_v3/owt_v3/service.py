"""The function's core, shared by the HTTP entry (`gcf_v3/main.py`) and the CLI
(`gcf_v3/owt_solver_v3.py`): raw body in, (HTTP status, response, log record) out.

Logs carry counts, timings and status codes only (C5-17, spec §11.2): never a name, an
id, a rule key, a line key, a month, the `request_id`, the body, an exception message
or a traceback. A stage is logged by its PUBLIC LABEL (`P:<id>` → `P#<n>`).
"""

import json
import os
import re
import sys
import time

from .codes import Refusal, code
from .constants import CONTRACT, ENGINE, PIN_CAP, SOLVER_VERSION
from .request import is_ping, parse_request
from .solver import solve_problem
from .stages import SolveTimeout, SolverDefect

HTTP_OF = {"invalid_json": 400, "unauthorized": 401, "method_not_allowed": 405, "misconfigured": 503,
           "internal_error": 500}


def build_id():
    return os.environ.get("OWT_SOLVER_V3_BUILD") or "unknown"


def public_label(stage_id, presence_ids):
    """`balance_max:P:<id>` → `balance_max:P#<n>`; every other stage id is its own label."""
    m = re.match(r"^(balance_(?:max|sq)):P:(.+)$", stage_id)
    if not m:
        return stage_id
    ids = list(presence_ids)
    n = ids.index(m.group(2)) + 1 if m.group(2) in ids else 0
    return f"{m.group(1)}:P#{n}"


def failure(name, **params):
    code("error", name)
    return {"ok": False, "contract": CONTRACT, "engine": ENGINE, "code": name, "params": params}


def _sizes(body):
    def n(key):
        v = body.get(key) if isinstance(body, dict) else None
        return len(v) if isinstance(v, list) else 0
    return {"months": n("months"), "services": n("services"), "people": n("people"),
            "rules": n("rules"), "pins": n("pins")}


def _presence_ids(body):
    ids = []
    rules = body.get("rules") if isinstance(body, dict) else None
    for r in rules if isinstance(rules, list) else []:
        if isinstance(r, dict) and r.get("kind") == "presence" and isinstance(r.get("id"), str):
            if r["id"] not in ids:
                ids.append(r["id"])
    return ids


def handle(body, clock=time.perf_counter, solver_for=None):
    """A parsed JSON body → (status, response, log record)."""
    t0 = clock()
    log = {"event": "owt-solver-v3", "sizes": _sizes(body)}
    try:
        if is_ping(body):
            resp = {"ok": True, "contract": CONTRACT, "engine": ENGINE, "solver_version": SOLVER_VERSION,
                    "build": build_id(), "pin_cap": PIN_CAP}
            log.update(http=200, ping=True)
            return 200, resp, log
        problem = parse_request(body)
        if problem is None:  # unreachable: parse_request returns None only for a ping
            raise Refusal("invalid_request", field="ping", detail="type")
        report, runner, _ = solve_problem(problem, clock=clock, solver_for=solver_for)
        total_ms = int(round((clock() - t0) * 1000))
        labels = problem.presence_ids
        stages = runner.records
        resp = {
            "ok": True, "contract": CONTRACT, "engine": ENGINE, "solver_version": SOLVER_VERSION,
            "build": build_id(), "request_id": problem.request_id, "seed": problem.seed,
            "months": list(problem.months),
            "reproducible": all(s["status"] == "proven" for s in stages),
            "assignments": report.assignment,
            "unfilled": report.unfilled(),
            "pins": report.pins(),
            "violations": report.violations(),
            "violation_ceiling": {"value": report.ceiling, "proven": report.status.get("rules") == "proven"},
            "stages": stages,
            "total_ms": total_ms,
            "fairness": report.fairness(),
            "cadence": report.cadence(),
            "missed": report.missed(),
            "notices": report.notices,
        }
        log.update(http=200, total_ms=total_ms, stages=[
            {"label": public_label(s["id"], labels), "status": s["status"], "limit": s["limit"],
             "ms": s["ms"], "det_milli": s["det_milli"]} for s in stages])
        return 200, resp, log
    except Refusal as r:
        log.update(http=422, code=r.code)
        if r.code == "too_many_pins":
            log.update(count=r.params["count"], cap=r.params["cap"])
        return 422, failure(r.code, **r.params), log
    except SolveTimeout as t:
        log.update(http=422, code="timeout", stage=public_label(t.stage, _presence_ids(body)), seconds=t.seconds)
        return 422, failure("timeout", stage=t.stage, seconds=t.seconds), log
    except SolverDefect as d:
        log.update(http=500, code="internal_error", stage=public_label(d.stage, _presence_ids(body)))
        return 500, failure("internal_error"), log
    except Exception as e:  # never a message, an argument or a traceback: a KeyError's message is the key
        log.update(http=500, code="internal_error", exception=type(e).__name__)
        return 500, failure("internal_error"), log
    finally:
        log.setdefault("total_ms", int(round((clock() - t0) * 1000)))


def handle_raw(data, clock=time.perf_counter):
    """Raw bytes or text → (status, response, log record); unparseable JSON is `invalid_json` (400)."""
    try:
        body = json.loads(data)
    except (ValueError, TypeError):
        log = {"event": "owt-solver-v3", "http": 400, "code": "invalid_json"}
        return 400, failure("invalid_json"), log
    return handle(body, clock=clock)


def emit_log(record, stream=None):
    print(json.dumps(record, sort_keys=True), file=stream or sys.stderr, flush=True)
