"""The independent checker (spec §12.3, C5-R15): one request and its response in, counts
out. It recomputes from `assignments` ALONE — never from the response's own flags and
never from `owt_v3`'s model or report code (stdlib only, no `owt_v3` import):

- hard rules: one seat per person per service; a seat only for someone eligible for that
  role there, or pinned to it; a fixed service holding exactly its pins; rows not over size;
- the pin echo: every request pin seated, `pins.honored` equal to that count;
- every rule instance of §6.7 and every protection of §7.1 stages 3–9, compared with
  `violations`, `missed` and `cadence`;
- the `after` identity, the seat-count identities (A39) per line and tab, and
  |planned − share| against `fairness.tolerance` per person-line.

Its result holds counts, codes and stage public labels only (C5-17) — never a name and
never an identifier from the request — so C7 can run it on captured Preview pairs:

    python -m acceptance.checker request.json response.json      (from gcf_v3/)
"""

import datetime
import json
import re
import sys
from collections import Counter, defaultdict

ROLES = ("Lead", "BGV", "Choir")


def _date(s):
    return datetime.date(int(s[0:4]), int(s[5:7]), int(s[8:10]))


def _day(s):
    return "Sun" if _date(s).weekday() == 6 else "Sat"


def _plus(s, k):
    return (_date(s) + datetime.timedelta(days=k)).isoformat()


def _weekend(s):
    d = _date(s)
    return (d + datetime.timedelta(days=(6 - d.weekday()) % 7)).isoformat()


def _prev_month(m):
    y, mm = int(m[:4]), int(m[5:7])
    return f"{y - 1}-12" if mm == 1 else f"{y}-{mm - 1:02d}"


def label(stage_id, presence_ids):
    m = re.match(r"^(balance_(?:max|sq)):P:(.+)$", stage_id)
    if not m:
        return stage_id
    return f"{m.group(1)}:P#{presence_ids.index(m.group(2)) + 1 if m.group(2) in presence_ids else 0}"


class _Request:
    def __init__(self, req):
        self.req = req
        self.months = req["months"]
        self.svc = {s["id"]: s for s in req["services"]}
        self.people = {p["id"]: p for p in req["people"]}
        self.pins = {(p["service"], p["role"], p["person"]) for p in req["pins"]}
        self.pin_at = {(p["service"], p["person"]) for p in req["pins"]}
        self.presence_ids = []
        for r in req["rules"]:
            if r["kind"] == "presence" and r["id"] not in self.presence_ids:
                self.presence_ids.append(r["id"])

    def roles(self, s):
        if s["fixed"]:
            return ROLES
        return ("Lead", "BGV") if s["kind"] == "saturday" else ROLES

    def key(self, s, role):
        return f"{_day(s['date'])}.{role}"

    def eligible(self, p, sid, role):
        return role in self.people[p]["eligibility"].get(sid, [])

    def could(self, p, sid, role):
        s = self.svc[sid]
        return (sid, role, p) in self.pins or (not s["fixed"] and self.eligible(p, sid, role))

    def row_size(self, sid, role):
        s = self.svc[sid]
        pins = sum(1 for (x, r, _) in self.pins if x == sid and r == role)
        return pins if s["fixed"] else max(s.get("seats", {}).get(role, 0), pins)

    def exact(self, p, month, key):
        return any(r["kind"] == "count" and r["op"] == "==" and r["person"] == p and r["month"] == month
                   and key in r["roles"] and r["value"] >= 1 for r in self.req["rules"])


def _seated(req, resp):
    out = set()
    for sid, roles in resp["assignments"].items():
        for role, ids in roles.items():
            for p in ids:
                out.add((sid, role, p))
    return out


def _instances(R, seated):
    """Broken rule instances, recomputed: {(family, rule, scope)}."""
    broken = set()
    weekend_svcs = [s for s in R.req["services"] if s["kind"] != "special"]
    for r in R.req["rules"]:
        if r["kind"] == "count":
            avail = 0
            for s in weekend_svcs:
                if s["month"] != r["month"]:
                    continue
                if any(R.key(s, role) in r["roles"] and R.could(r["person"], s["id"], role) for role in R.roles(s)):
                    avail += 1
            value = min(r["value"], avail) if r["op"] in ("==", ">=") else r["value"]
            n = sum(1 for (sid, role, p) in seated if p == r["person"] and R.svc[sid]["kind"] != "special"
                    and R.svc[sid]["month"] == r["month"] and R.key(R.svc[sid], role) in r["roles"])
            bad = {"==": n != value, "<=": n > value, ">=": n < value}[r["op"]]
            if bad:
                broken.add(("count", r["id"], r["month"]))
        elif r["kind"] in ("pair", "presence"):
            for s in weekend_svcs:
                if r.get("month") is not None and s["month"] != r["month"]:
                    continue
                terms = [(role, p) for role in R.roles(s) for p in r["persons"]
                         if R.key(s, role) in r["roles"] and R.could(p, s["id"], role)]
                held = sum(1 for role, p in terms if (s["id"], role, p) in seated)
                if r["kind"] == "pair":
                    if {p for _, p in terms} == set(r["persons"]) and held >= 2:
                        broken.add(("pair", r["id"], s["id"]))
                else:
                    applies = terms or any(R.eligible(p, s["id"], role) for role in R.roles(s)
                                           for p in r["persons"] if R.key(s, role) in r["roles"])
                    if applies and held == 0:
                        broken.add(("presence", r["id"], s["id"]))
        elif r["kind"] == "consecutive":
            weeks = defaultdict(lambda: [False, False, False])  # weekend -> [term, held, horizon term]
            for s in weekend_svcs:
                for role in R.roles(s):
                    if R.key(s, role) in r["roles"] and R.could(r["person"], s["id"], role):
                        w = weeks[_weekend(s["date"])]
                        w[0], w[2] = True, True
                        w[1] = w[1] or (s["id"], role, r["person"]) in seated
            for ps in R.req["prior"]["services"]:
                if ps["kind"] == "special":
                    continue
                for role in ROLES:
                    if f"{_day(ps['date'])}.{role}" in r["roles"] and r["person"] in ps["seats"].get(role, []):
                        w = weeks[_weekend(ps["date"])]
                        w[0], w[1] = True, True
            for w in sorted(weeks):
                nxt = _plus(w, 7)
                if nxt in weeks and (weeks[w][2] or weeks[nxt][2]) and weeks[w][1] and weeks[nxt][1]:
                    broken.add(("consecutive", r["id"], (w, nxt)))
    for s in weekend_svcs:
        if s["fixed"] or "Lead" not in R.roles(s):
            continue
        cand = [p for p in R.people if R.could(p, s["id"], "Lead")]
        if cand and not any((s["id"], "Lead", p) in seated for p in cand):
            broken.add(("mandatory_lead", "mandatory_lead", s["id"]))
    return broken


def _reported_instances(resp):
    out = set()
    for v in resp["violations"]:
        if v["code"] == "count":
            out.add(("count", v["rule"], v["month"]))
        elif v["code"] == "consecutive":
            out.add(("consecutive", v["rule"], tuple(v["weekends"])))
        else:
            out.add((v["code"], v["rule"], v["service"]))
    return out


def _protections(R, seated):
    """Recomputed misses {(code, person, scope)} and cadence entries {(person, month): tuple}."""
    counted = [s for s in R.req["services"] if s["counts"]]

    def count(p, m, pred):
        return sum(1 for (sid, role, q) in seated if q == p and R.svc[sid]["counts"]
                   and R.svc[sid]["month"] == m and pred(R.svc[sid], role))

    L = lambda p, m: count(p, m, lambda s, r: r == "Lead" and _day(s["date"]) == "Sun")
    S = lambda p, m: count(p, m, lambda s, r: r == "Lead" and _day(s["date"]) == "Sat")
    V = lambda p, m: count(p, m, lambda s, r: True)
    missed, cadence = set(), {}
    for p, person in R.people.items():
        cad = person.get("cadence")
        for m in R.months:
            if cad:
                state = cad[m]
                a = 1 if state == "on" else 0
                comp = "not_applicable" if (state != "off" or L(p, m) >= 1) else (
                    "given" if S(p, m) >= 1 else "missed")
                cadence[(p, m)] = (state, L(p, m), S(p, m), L(p, m) == a, comp)
                if state == "on" and L(p, m) == 0:
                    missed.add(("cadence_on_missed", p, m))
                if state in ("off", "out") and L(p, m) >= 1:
                    missed.add(("cadence_off_led", p, m))
                if state == "off" and L(p, m) == 0 and S(p, m) == 0:
                    missed.add(("compensation_missed", p, m))
            if not person.get("exempt", False) and any(
                    s["month"] == m and (person["eligibility"].get(s["id"]) or (s["id"], p) in R.pin_at)
                    for s in counted):
                if V(p, m) == 0:
                    missed.add(("voice_floor_missed", p, m))
            for key, cnt, code in (("Sun.Lead", L, "sunday_cap_exceeded"), ("Sat.Lead", S, "saturday_cap_exceeded")):
                if not R.exact(p, m, key) and cnt(p, m) >= 2:
                    missed.add((code, p, m))
    for i, m in enumerate(R.months):
        prev = _prev_month(m)
        for p, person in R.people.items():
            if person.get("cadence") or R.exact(p, m, "Sun.Lead"):
                continue
            on_line = any(
                s["month"] == m and s["counts"] and (
                    (s["kind"] == "sunday" and "Lead" in person["eligibility"].get(s["id"], []))
                    or (_day(s["date"]) == "Sun" and (s["id"], "Lead", p) in R.pins))
                for s in R.req["services"])
            if not on_line:
                continue
            since = person["dl_since"]
            if since is None or prev < since:
                continue
            if prev == R.req["prior"]["month"] and not R.req["prior"]["has_services"]:
                continue
            before = person["prev_dl_leads"] if i == 0 else L(p, R.months[0])
            if before + L(p, m) == 0:
                missed.add(("dl_floor_missed", p, m))
    horizon = {s["date"] for s in R.req["services"]}
    for p in R.people:
        leads = set()
        for (sid, role, q) in seated:
            s = R.svc[sid]
            if q == p and role == "Lead" and s["counts"] and _day(s["date"]) == "Sun":
                leads.add(s["date"])
        for ps in R.req["prior"]["services"]:
            if ps["counts"] and _day(ps["date"]) == "Sun" and p in ps["seats"].get("Lead", []):
                leads.add(ps["date"])
        for d in sorted(leads):
            if _plus(d, 7) in leads and _plus(d, 7) in horizon:
                missed.add(("consecutive_sundays", p, d))
    return missed, cadence


def _reported_missed(resp):
    out = set()
    for m in resp["missed"]:
        if m["code"] == "dl_floor_missed":
            out.add((m["code"], m["person"], m["month2"]))
        elif m["code"] == "consecutive_sundays":
            out.add((m["code"], m["person"], m["dates"][0]))
        else:
            out.add((m["code"], m["person"], m["month"]))
    return out


def check(req, resp):
    """Counts only. `problems` maps a fixed category to how many times it failed."""
    problems = Counter()
    summary = {"ok": False, "problems": problems, "stages": Counter(), "violations": Counter(),
               "missed": Counter(), "notices": Counter(), "unfilled": 0, "max_gap": 0}
    if not resp.get("ok"):
        summary["failure"] = resp.get("code")
        return _finish(summary)
    R = _Request(req)
    seated = _seated(req, resp)
    per_service = Counter((sid, p) for (sid, _, p) in seated)
    problems["hard_two_seats"] += sum(1 for v in per_service.values() if v > 1)
    for (sid, role, p) in seated:
        if sid not in R.svc or p not in R.people:
            problems["hard_unknown"] += 1
            continue
        if not R.could(p, sid, role):
            problems["hard_ineligible"] += 1
    for sid, s in R.svc.items():
        if sid not in resp["assignments"]:
            problems["assignment_missing_service"] += 1
            continue
        for role in R.roles(s):
            held = len(resp["assignments"][sid].get(role, []))
            if held > R.row_size(sid, role):
                problems["hard_row_over"] += 1
        if s["fixed"]:
            mine = {(x, r, p) for (x, r, p) in seated if x == sid}
            if mine != {c for c in R.pins if c[0] == sid}:
                problems["hard_fixed_not_pins"] += 1
    honored = sum(1 for c in R.pins if c in seated)
    if honored != len(R.pins):
        problems["pins_not_honored"] += len(R.pins) - honored
    if resp["pins"] != {"requested": len(R.pins), "honored": honored}:
        problems["pin_echo_mismatch"] += 1
    if _instances(R, seated) != _reported_instances(resp):
        problems["violations_mismatch"] += len(_instances(R, seated) ^ _reported_instances(resp))
    missed, cadence = _protections(R, seated)
    if missed != _reported_missed(resp):
        problems["missed_mismatch"] += len(missed ^ _reported_missed(resp))
    reported_cad = {(c["person"], c["month"]): (c["state"], c["sundays"], c["saturdays"], c["met"],
                                                c["compensation"]) for c in resp["cadence"]}
    if reported_cad != cadence:
        problems["cadence_mismatch"] += 1
    tol = resp["fairness"]["tolerance"]
    over = 0
    for person in resp["fairness"]["people"]:
        for scope, entries in (("line", person["lines"]), ("tab", person["tabs"])):
            for name, f in entries.items():
                if f["after"] != f["carried"] + f["share"] - f["received"]:
                    problems[f"{scope}_after_identity"] += 1
                if f["seats"] * 100 != f["received"] or f["pinned_seats"] * 100 != f["pinned"]:
                    problems[f"{scope}_seat_identity"] += 1
                if scope == "line":
                    gap = abs(f["planned"] - f["share"])
                    summary["max_gap"] = max(summary["max_gap"], gap)
                    over += gap > tol
    # The F13 gap is reported, not judged here: which runs it binds is the harness's criterion.
    summary["gap"] = {"max": summary["max_gap"], "over_tolerance": over, "tolerance": tol,
                      "pins": bool(req["pins"]), "all_proven": all(s["status"] == "proven" for s in resp["stages"]),
                      "filled": not resp["unfilled"]}
    for st in resp["stages"]:
        summary["stages"][f"{label(st['id'], R.presence_ids)} {st['status']}"] += 1
    for v in resp["violations"]:
        summary["violations"][f"{v['code']}/{v['cause']}"] += 1
    for m in resp["missed"]:
        summary["missed"][f"{m['code']}/{m['cause']}"] += 1
    for n in resp["notices"]:
        summary["notices"][n["code"]] += 1
    summary["unfilled"] = sum(u["count"] for u in resp["unfilled"])
    summary["ok"] = not +problems
    return _finish(summary)


def _finish(summary):
    for key in ("problems", "stages", "violations", "missed", "notices"):
        summary[key] = dict(sorted((k, v) for k, v in summary[key].items() if v))
    summary["ok"] = summary["ok"] and not summary["problems"]
    return summary


def main(argv):
    if len(argv) != 3:
        print("usage: python -m acceptance.checker <request.json> <response.json>", file=sys.stderr)
        return 2
    with open(argv[1], encoding="utf-8") as f:
        req = json.load(f)
    with open(argv[2], encoding="utf-8") as f:
        resp = json.load(f)
    result = check(req, resp)
    print(json.dumps(result, sort_keys=True, indent=1))
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
