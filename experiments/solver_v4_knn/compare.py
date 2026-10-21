"""v3 against the v4 prototype on v3's own acceptance world, judged by v3's checker.

    python experiments/solver_v4_knn/compare.py [--seeds 5] [--chain-seeds 3] [--out results.json]

Three experiments, every engine reading the same requests:
- NOV+DEC: the two-month run on a history v3 planned (Aug–Oct), seeds 1..N (the harness's run A);
- CHAIN: twelve months (Nov 2026 – Oct 2027) planned one month at a time, each engine feeding its
  own history forward (the harness's run D);
- SCENARIOS: the harness's set P (pins, rule breaks, clamps, edge cases) with v4 in place of v3.
"""

import argparse
import json
import os
import statistics
import sys
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))
GCF = os.path.join(HERE, "..", "..", "gcf_v3")
sys.path.insert(0, GCF)
sys.path.insert(0, HERE)

import acceptance.world as world_mod  # noqa: E402
from acceptance import checker, run as harness, scenarios  # noqa: E402
from owt_v3.service import handle as v3_handle  # noqa: E402

import knn_v4  # noqa: E402

ENGINES = {"v3": v3_handle, "v4": knn_v4.handle,
           "v4+swaps": lambda req: knn_v4.handle(req, improve=True)}


def use(engine):
    world_mod.handle = ENGINES[engine]


def run_metrics(req, resp):
    """Counts and balances of one run. Balances in SEATS: `after` = carried + share − received."""
    if not resp.get("ok"):
        return {"ok": False}
    verdict = checker.check(req, resp)
    lines = Counter()
    worst = Counter()
    sq_total, worst_total = 0.0, 0.0
    for person in resp["fairness"]["people"]:
        for line, f in person["lines"].items():
            a = f["after"] / 100
            lines[line] += a * a
            worst[line] = max(worst[line], a)
        t = person["tabs"].get("TOTAL")
        if t:
            sq_total += (t["after"] / 100) ** 2
            worst_total = max(worst_total, t["after"] / 100)
    forced = [v for v in resp["violations"] if v["cause"] != "pins"]
    return {
        "ok": True,
        "checker_ok": verdict["ok"],
        "checker_problems": verdict["problems"],
        "unfilled": sum(u["count"] for u in resp["unfilled"]),
        "rules_broken": len(forced),
        "rules_broken_by_family": dict(Counter(v["code"] for v in forced)),
        "missed": dict(Counter(m["code"] for m in resp["missed"])),
        "missed_total": len(resp["missed"]),
        "sq_by_line": {k: round(v, 2) for k, v in sorted(lines.items())},
        "sq_lines": round(sum(lines.values()), 2),
        "most_owed_by_line": {k: round(v, 2) for k, v in sorted(worst.items())},
        "sq_total": round(sq_total, 2),
        "most_owed_total": round(worst_total, 2),
        "ms": resp["total_ms"],
    }


def nov_dec(seeds):
    out = {}
    data = world_mod.load_world(harness.WORLD)
    for seed in range(1, seeds + 1):
        use("v3")
        env = harness.Env(data)
        req = env.base(seed).request(harness.RUN_A, seed)  # v3 planned the history for both
        for engine, h in ENGINES.items():
            _, resp, _ = h(req)
            out.setdefault(engine, []).append(run_metrics(req, resp))
    return out


def chain(seeds):
    out = {}
    data = world_mod.load_world(harness.WORLD)
    for engine in ENGINES:
        for seed in range(1, seeds + 1):
            use("v3")
            env = harness.Env(data)
            ch = env.base(seed)
            use(engine)
            runs, pairs = [], []
            for month in harness.CHAIN:
                req, resp = ch.run([month], seed)
                runs.append(run_metrics(req, resp))
                pairs.append((req, resp))
                if not resp.get("ok"):
                    break
            cum = ch.cumulative(data["start"], harness.CHAIN[-1])
            values = sorted(abs(float(v)) for v in cum.values())
            p95 = values[int(round(0.95 * (len(values) - 1)))] if values else 0
            out.setdefault(engine, []).append({
                "runs": runs,
                "cum_abs_max": round(values[-1], 2) if values else 0,
                "cum_abs_p95": round(p95, 2),
                "cum_abs_mean": round(statistics.fmean(values), 3) if values else 0,
                "regular_gap_le_1": harness._regular_gap_ok(ch, pairs, data),
                "floor_seat_proof": harness._floor_proof(ch, pairs)[0],
            })
    use("v3")
    return out


def scenario_set(seed=1):
    """Set P with each engine; a scenario passes when every check it names passes."""
    out = {}
    data = world_mod.load_world(harness.WORLD)
    for engine in ENGINES:
        use("v3")
        env = harness.Env(data)
        env.base(seed)  # history planned by v3 for both
        use(engine)
        rows = []
        for sid, checks, runs in scenarios.scenario_runs(env, seed):
            if sid == "P15":  # v3's budget/timeout honesty: no counterpart in a greedy
                continue
            verdicts = [bool(resp.get("ok")) and checker.check(req, resp)["ok"] for req, resp in runs]
            # The causes a report names («pins», «higher_priority») come from v3's proven stages, which a
            # greedy does not have; judge the OUTCOME: the same breaks, misses and notices by code, nothing
            # left empty, and every named check that is not about a cause.
            want = scenarios.EXPECTED.get(sid)
            same = want is None or (len(want) == len(runs) and all(
                Counter(x["code"] for x in resp[key]) == Counter(c for c, _ in w.get(short, []))
                for (_, resp), w in zip(runs, want)
                for key, short in (("violations", "v"), ("missed", "m"), ("notices", "n"))))
            filled = all(not resp.get("unfilled") for _, resp in runs)
            failed = [name for name, ok in checks if not ok and name != "report_exact" and not name.endswith("_pins")]
            failed += [] if same else ["same_outcome"]
            failed += [] if filled else ["nothing_unfilled"]
            rows.append({"scenario": sid, "passed": not failed and all(verdicts), "failed_checks": failed,
                         "runs": [run_metrics(req, resp) for req, resp in runs]})
        out[engine] = rows
    use("v3")
    return out


def summarize(nd, ch, sc):
    def agg(rows, key):
        vals = [r[key] for r in rows if r.get("ok")]
        return round(statistics.fmean(vals), 2) if vals else None

    lines = []
    lines.append("NOV+DEC (2 months, same history) — mean per seed")
    for e, rows in nd.items():
        lines.append(f"  {e}: unfilled={agg(rows, 'unfilled')} rules={agg(rows, 'rules_broken')} "
                     f"missed={agg(rows, 'missed_total')} sq_lines={agg(rows, 'sq_lines')} "
                     f"most_owed_total={agg(rows, 'most_owed_total')} sq_total={agg(rows, 'sq_total')} "
                     f"checker_ok={all(r.get('checker_ok') for r in rows)}")
    lines.append("CHAIN (12 months, own history) — totals over the year, mean per seed")
    for e, chains in ch.items():
        tot = lambda k: round(statistics.fmean(sum(r.get(k, 0) for r in c["runs"]) for c in chains), 2)
        lines.append(f"  {e}: unfilled={tot('unfilled')} rules={tot('rules_broken')} missed={tot('missed_total')} "
                     f"cum|bal| max={statistics.fmean(c['cum_abs_max'] for c in chains):.2f} "
                     f"p95={statistics.fmean(c['cum_abs_p95'] for c in chains):.2f} "
                     f"mean={statistics.fmean(c['cum_abs_mean'] for c in chains):.3f}")
    lines.append("SCENARIOS (set P)")
    for e, rows in sc.items():
        lines.append(f"  {e}: {sum(r['passed'] for r in rows)}/{len(rows)} pass; failed: "
                     + ", ".join(f"{r['scenario']}({','.join(r['failed_checks']) or 'checker'})"
                                 for r in rows if not r["passed"]))
    return "\n".join(lines)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--seeds", type=int, default=5)
    ap.add_argument("--chain-seeds", type=int, default=3)
    ap.add_argument("--out")
    ap.add_argument("--only", choices=["nd", "chain", "scen"])
    a = ap.parse_args()
    nd = nov_dec(a.seeds) if a.only in (None, "nd") else {}
    ch = chain(a.chain_seeds) if a.only in (None, "chain") else {}
    sc = scenario_set() if a.only in (None, "scen") else {}
    if a.out:
        with open(a.out, "w", encoding="utf-8") as f:
            json.dump({"nov_dec": nd, "chain": ch, "scenarios": sc}, f, indent=1)
    print(summarize(nd, ch, sc))


if __name__ == "__main__":
    main()
