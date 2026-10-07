"""The acceptance runner (spec §12.3, §13):

    python gcf_v3/acceptance/run.py --world <path> --matrix ci|full --out <dir> [--emit-requests <dir>]

Runs the chained solves of the matrix on a world (the fictitious one in the repo, or a
private one built outside it), checks every pass criterion with the independent checker,
writes each run's request and response under `--out`, and writes `summary.json` there —
aggregates only, in public form (C5-17): pass/fail per criterion, stage statuses by public
label, timings, misses and violations by code and cause, and the largest F13 gap. Stdout
carries no more than `summary.json` does. `--emit-requests` writes the timing-gate shapes
A–D (§13) instead.

Before any chain runs, the X1 test double is checked against the golden fixture's `cadence`
cases; a missing fixture or a mismatch is a harness error and nothing runs.
"""

import argparse
import copy
import json
import os
import statistics
import sys
from collections import Counter

if __package__ in (None, ""):  # run as a script: `python gcf_v3/acceptance/run.py …`
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from acceptance import checker, scenarios, x1  # noqa: E402
from acceptance.world import Chain, load_world  # noqa: E402
from owt_v3.constants import FAIRNESS_TOLERANCE  # noqa: E402
from owt_v3.request import parse_request  # noqa: E402
from owt_v3.service import handle, public_label  # noqa: E402
from owt_v3.solver import solve_problem  # noqa: E402
from owt_v3.vocab import add_months  # noqa: E402

WORLD = os.path.join(os.path.dirname(os.path.abspath(__file__)), "world_realistic.json")
BASE_LAST = "2026-10"
RUN_A = ["2026-11", "2026-12"]
CHAIN = [add_months("2026-11", k) for k in range(12)]
MATRIX = {
    "ci": {"A": (1, 2), "B": (1,), "C": (1,), "D": (1,), "P": (1,), "G": (), "O": ()},
    "full": {"A": (1, 2, 3, 4, 5), "B": (1, 2, 3, 4, 5), "C": (1, 2, 3), "D": (1, 2, 3), "P": (1, 2, 3),
             "G": (1, 2, 3), "O": (1, 2, 3, 4, 5)},
}


def _setup(pair, what):
    """A setup solve (history the scenarios stand on) must succeed, or the criteria that read
    that history would pass vacuously on a partial one."""
    if not pair[1].get("ok"):
        raise x1.HarnessError(f"setup solve failed ({what}): {pair[1].get('code')}")
    return pair


class Env:
    """Base chains (the world's history up to Oct 2026, solved by the policy itself) and runs on top."""

    def __init__(self, data, out=None):
        self.data, self.out = data, out
        self._base = {}
        self.pairs = []  # every (label, request, response)

    def base(self, seed, overlay=None):
        if seed not in self._base:
            ch = Chain(self.data)
            month = self.data["start"]
            while month <= BASE_LAST:
                if not ch.stored_in(month):
                    _setup(ch.run([month], seed), f"base {month} seed {seed}")
                month = add_months(month, 1)
            self._base[seed] = ch.stored
        ch = Chain(self.data, overlay)
        ch.stored = copy.deepcopy(self._base[seed])
        ch.add_stored((overlay or {}).get("stored_add", []))
        return ch

    def record(self, label, req, resp):
        self.pairs.append((label, req, resp))
        if self.out:
            os.makedirs(os.path.join(self.out, "runs"), exist_ok=True)
            with open(os.path.join(self.out, "runs", f"{label}.json"), "w", encoding="utf-8") as f:
                json.dump({"request": req, "response": resp}, f, ensure_ascii=False)

    def run(self, months, seed, overlay=None):
        ch = self.base(seed, overlay)
        return ch.run(months, seed, store=False)

    def chain_runs(self, months, step, seed, overlay=None):
        ch = self.base(seed, overlay)
        runs = []
        for i in range(0, len(months), step):
            runs.append(ch.run(months[i:i + step], seed))
            if not runs[-1][1].get("ok"):
                break
        return runs, ch


def _passes_like_a(req, resp, verdict):
    """Run A's pass criteria on one run; returns {criterion: bool}."""
    if not resp.get("ok"):
        return {"ok": False}
    missed = Counter(m["code"] for m in resp["missed"])
    comp = [m for m in resp["missed"] if m["code"] == "compensation_missed" and m["cause"] != "unavailable"]
    return {
        "ok": True,
        "stages_proven": all(s["status"] == "proven" for s in resp["stages"]),
        "ceiling_0": resp["violation_ceiling"]["value"] == 0,
        "nothing_unfilled": not resp["unfilled"],
        "checker_ok": verdict["ok"],
        "cadence_met": all(c["met"] for c in resp["cadence"]),
        "compensation": not comp,
        "no_protection_miss": not any(missed[c] for c in (
            "cadence_on_missed", "cadence_off_led", "voice_floor_missed", "dl_floor_missed",
            "sunday_cap_exceeded", "saturday_cap_exceeded", "consecutive_sundays")),
        "pins_honored": resp["pins"]["honored"] == resp["pins"]["requested"],
    }


def _regular_gap_ok(chain, runs, data):
    """No regular (on the DL line) more than 1 month without a Sunday while available."""
    longest = Counter()
    gap = Counter()
    for req, resp in runs:
        if not resp.get("ok"):
            return False
        for month in req["months"]:
            for p in req["people"]:
                if p.get("cadence") or not any(
                        s["month"] == month and s["kind"] == "sunday" and "Lead" in p["eligibility"].get(s["id"], [])
                        for s in req["services"]):
                    continue
                if any(r["kind"] == "count" and r["op"] == "==" and r["person"] == p["id"] and r["month"] == month
                       and "Sun.Lead" in r["roles"] for r in req["rules"]):
                    continue
                led = any(p["id"] in resp["assignments"][s["id"]]["Lead"] for s in req["services"]
                          if s["month"] == month and s["counts"] and s["date"] and s["kind"] != "saturday"
                          and _is_sunday(s["date"]))
                gap[p["id"]] = 0 if led else gap[p["id"]] + 1
                longest[p["id"]] = max(longest[p["id"]], gap[p["id"]])
    return all(v <= 1 for v in longest.values())


def _is_sunday(date):
    import datetime
    return datetime.date(int(date[:4]), int(date[5:7]), int(date[8:10])).weekday() == 6


def _floor_proof(chain, runs):
    """Every realised floor person: cumulative balance within ±2 seats each month, |slope| <= 0.15."""
    floor_people = set()
    for _, resp in runs:
        for p in resp["fairness"]["people"]:
            if any(f["realised"] for f in p["floor"]):
                floor_people.add(p["person"])
    months = [m for req, _ in runs for m in req["months"]]
    series = {}
    for m in months:
        cum = chain.cumulative(chain.data["start"], m)
        for (p, line), v in cum.items():
            if p in floor_people:
                series.setdefault((p, line), []).append(float(v))
    ok = True
    for values in series.values():
        if any(abs(v) > 2.0 for v in values):
            ok = False
        if len(values) >= 2:
            xs = list(range(len(values)))
            mx, my = statistics.fmean(xs), statistics.fmean(values)
            slope = sum((x - mx) * (y - my) for x, y in zip(xs, values)) / sum((x - mx) ** 2 for x in xs)
            if abs(slope) > 0.15:
                ok = False
    return ok, len(floor_people)


class Summary:
    def __init__(self, matrix):
        self.matrix = matrix
        self.criteria = {}
        self.stages = Counter()
        self.violations, self.missed, self.notices = Counter(), Counter(), Counter()
        self.total_ms = []
        self.max_gap = 0
        self.gaps = Counter({"pinless": 0, "pinned": 0})
        self.max_det_milli = 0
        self.runs = 0
        self.informational = {}

    def add_run(self, req, resp):
        verdict = checker.check(req, resp)
        self.runs += 1
        if resp.get("ok"):
            self.total_ms.append(resp["total_ms"])
            presence = []
            for r in req["rules"]:
                if r["kind"] == "presence" and r["id"] not in presence:
                    presence.append(r["id"])
            for s in resp["stages"]:
                self.stages[f"{public_label(s['id'], presence)} {s['status']}"] += 1
                if s["status"] == "proven":
                    self.max_det_milli = max(self.max_det_milli, s["det_milli"])
            if all(s["status"] == "proven" for s in resp["stages"]) and not resp["unfilled"]:
                key = "pinned" if req["pins"] else "pinless"
                self.gaps[key] = max(self.gaps[key], verdict["max_gap"])
                self.max_gap = max(self.max_gap, verdict["max_gap"])
        for k, v in verdict["violations"].items():
            self.violations[k] += v
        for k, v in verdict["missed"].items():
            self.missed[k] += v
        for k, v in verdict["notices"].items():
            self.notices[k] += v
        return verdict

    def criterion(self, name, passed):
        self.criteria[name] = "pass" if passed else "fail"

    def as_dict(self):
        ms = sorted(self.total_ms)
        p95 = ms[min(len(ms) - 1, int(round(0.95 * (len(ms) - 1))))] if ms else 0
        return {
            "matrix": self.matrix, "runs": self.runs,
            "ok": all(v == "pass" for v in self.criteria.values()),
            "criteria": dict(sorted(self.criteria.items())),
            "stages": dict(sorted(self.stages.items())),
            "timing": {"total_ms_max": max(ms) if ms else 0, "total_ms_p95": p95},
            "violations": dict(sorted(self.violations.items())),
            "missed": dict(sorted(self.missed.items())),
            "notices": dict(sorted(self.notices.items())),
            "max_gap": self.max_gap, "max_gap_by_pins": dict(self.gaps), "max_det_milli": self.max_det_milli,
            "informational": self.informational,
        }


def run_matrix(world_path, matrix, out_dir=None):
    x1.check_against_fixture()
    data = load_world(world_path)
    env, summary, plan = Env(data, out_dir), Summary(matrix), MATRIX[matrix]
    for seed in plan["A"]:
        req, resp = env.run(RUN_A, seed)
        env.record(f"A-s{seed}", req, resp)
        verdict = summary.add_run(req, resp)
        for name, ok in _passes_like_a(req, resp, verdict).items():
            summary.criterion(f"A.s{seed}.{name}", ok)
    for seed in plan["B"]:
        ch = env.base(seed)
        _setup(ch.run(RUN_A, seed), f"B preliminary Nov+Dec seed {seed}")
        ch.drop_months(["2026-12"])
        req, resp = ch.run(["2026-12"], seed, store=False)
        env.record(f"B-s{seed}", req, resp)
        verdict = summary.add_run(req, resp)
        for name, ok in _passes_like_a(req, resp, verdict).items():
            summary.criterion(f"B.s{seed}.{name}", ok)
    for run_id, step in (("C", 2), ("D", 1)):
        for seed in plan[run_id]:
            runs, ch = env.chain_runs(CHAIN, step, seed)
            all_ok = len(runs) == len(CHAIN) // step
            for i, (req, resp) in enumerate(runs):
                env.record(f"{run_id}-s{seed}-r{i + 1}", req, resp)
                verdict = summary.add_run(req, resp)
                all_ok = all_ok and all(_passes_like_a(req, resp, verdict).values())
            summary.criterion(f"{run_id}.s{seed}.each_run_passes", all_ok)
            summary.criterion(f"{run_id}.s{seed}.regular_gap_le_1", _regular_gap_ok(ch, runs, data))
            proof, n = _floor_proof(ch, runs)
            summary.criterion(f"{run_id}.s{seed}.floor_seat_proof", proof)
            summary.informational[f"{run_id}.s{seed}.floor_people"] = n
    fictitious = bool(data.get("scenarios"))  # P and G name the fictitious world's members
    for seed in plan["P"] if fictitious else ():
        for sid, checks, runs in scenarios.scenario_runs(env, seed):
            verdicts = []
            for i, (req, resp) in enumerate(runs):
                env.record(f"{sid}-s{seed}-r{i + 1}", req, resp)
                verdict = summary.add_run(req, resp)
                if sid not in ("P15",):
                    verdicts.append(bool(resp.get("ok")) and verdict["ok"])
            if verdicts:  # every run's verdict counts, not the last one's
                checks = checks + [("checker_ok", all(verdicts))]
            for name, ok in checks:
                summary.criterion(f"{sid}.s{seed}.{name}", ok)
    for seed in plan["G"] if fictitious else ():
        for size, extra in ((9, ("m-leo", "m-mara")), (10, ("m-leo", "m-mara", "m-nico"))):
            members = [{"id": m, "name": m[2:].title(), "roles": ["Sun.Lead", "Sat.Lead", "Sun.BGV", "Sat.BGV",
                                                                  "Sun.Choir"],
                        "exempt": False, "cadence": False, "unavailable": []} for m in extra]
            ch = Env({**data, "members": data["members"] + members}).base(seed)
            for month in ("2026-11", "2026-12", "2027-01"):
                _setup(ch.run([month], seed), f"G{size} {month} seed {seed}")
            req, resp = ch.run(["2027-02", "2027-03"], seed, store=False)
            env.record(f"G{size}-s{seed}", req, resp)
            summary.add_run(req, resp)
            floors = [m for m in resp.get("missed", []) if m["code"] == "dl_floor_missed"]
            notice = any(n["code"] == "dl_capacity" for n in resp.get("notices", []))
            if size == 9:
                summary.criterion(f"G9.s{seed}.no_floor_miss", bool(resp.get("ok")) and not floors)
            else:
                summary.criterion(f"G10.s{seed}.capacity_notice", bool(resp.get("ok")) and notice)
                summary.criterion(f"G10.s{seed}.misses_by_capacity", all(m["cause"] == "capacity" for m in floors))
    for seed in plan["O"]:
        values = {}
        req = env.base(seed).request(RUN_A, seed)
        for order in ("F12", "prototype"):
            _, runner, _ = solve_problem(parse_request(req), consecutive_last=(order == "prototype"))
            values[order] = {public_label(r["id"], []): r["value"] for r in runner.records
                             if r["id"].startswith("balance_") and ":P:" not in r["id"]}
        summary.informational[f"O.s{seed}.balance_values"] = values
    # F13 (spec §12.4 as amended, Task 15): the tolerance binds pinless runs where every stage is
    # proven and nothing is unfilled; a pinned run's gap is reported (`max_gap_by_pins`), not judged.
    summary.criterion("F13.pinless_gap_within_tolerance", summary.gaps["pinless"] <= FAIRNESS_TOLERANCE)
    result = summary.as_dict()
    if out_dir:
        os.makedirs(out_dir, exist_ok=True)
        with open(os.path.join(out_dir, "summary.json"), "w", encoding="utf-8") as f:
            json.dump(result, f, indent=1, sort_keys=True)
    return result


def emit_requests(world_path, out_dir):
    """The timing-gate shapes A–D (§13), from the fictitious world after its Aug–Oct chain.

    The base chain is driven by the X1 double, so the double is checked against the fixture
    first, as `run_matrix` does: a mismatch is a HarnessError and nothing is written."""
    x1.check_against_fixture()
    data = load_world(world_path)
    env = Env(data)
    os.makedirs(out_dir, exist_ok=True)
    shapes = {
        "A": env.base(1).request(["2026-11"], 1),
        "B": env.base(1).request(RUN_A, 1),
    }
    every = Env(data)
    ch = every.base(1, {"saturdays": "every"})
    ch.drop_months(["2026-10"])
    shapes["C"] = ch.request(["2026-10", "2026-11"], 1)
    req = shapes["B"]
    _, resp, _ = handle(req)
    pins = []
    for s in req["services"]:
        for role, ids in resp["assignments"][s["id"]].items():
            for p in ids:
                pins.append({"service": s["id"], "date": s["date"], "role": role, "person": p})
    shapes["D"] = {**req, "pins": pins[:100], "request_id": "shape-D"}
    for name, body in shapes.items():
        body = {**body, "request_id": f"shape-{name}"}
        with open(os.path.join(out_dir, f"shape-{name}.json"), "w", encoding="utf-8") as f:
            json.dump(body, f, ensure_ascii=False)
    return sorted(shapes)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--world", default=WORLD)
    ap.add_argument("--matrix", choices=sorted(MATRIX), default="ci")
    ap.add_argument("--out")
    ap.add_argument("--emit-requests", dest="emit")
    args = ap.parse_args(argv)
    if args.emit:
        try:
            names = emit_requests(args.world, args.emit)
        except x1.HarnessError as e:
            print(json.dumps({"harness_error": str(e)}))
            return 2
        print(json.dumps({"emitted": names}))
        return 0
    if not args.out:
        ap.error("--out is required")
    try:
        result = run_matrix(args.world, args.matrix, args.out)
    except x1.HarnessError as e:
        print(json.dumps({"harness_error": str(e)}))
        return 2
    print(json.dumps(result, indent=1, sort_keys=True))
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
