"""The month-check parity fixtures (MCP proposal editor plan, T2.1):

    python gcf_v3/acceptance/month_check_fixtures.py        (writes fixtures/month-check/parity.json)

The TypeScript month check (`app/mcp/monthProposals/monthCheck.ts`) judges a hand-edited board
against the rules as written; the independent checker (`acceptance/checker.py`) recomputes the
same rule instances and protection misses from a request and its assignments. Both suites assert
this file — `tests/test_month_check_parity.py` against `checker.recompute`, vitest against the
TypeScript judging core — so a change of semantics on either side goes red until the other side
and the fixture follow (the `fixtures/fairness/golden.json` pattern, ADR-0050).

How a case is made: a few BASE runs are solved with the existing acceptance tools (the realistic
world chained to Nov–Dec 2026 and then Jan 2027; the smoke request), and each case APPLIES EDITS
to a base's solved assignments — clear a seat, place an eligible person, add a rule — then
records what `checker.recompute` finds broken. Only where the two semantics coincide:

- every `==`/`>=` count rule's value is within the person's availability (the checker clamps to
  it, the month check never does) — a base drops any rule that would clamp;
- no service is fixed and nothing is pinned (the checker reads a fixed service's pins, the month
  check reads the board);
- an edit places only a person eligible for that seat (the month check counts a seated person
  toward a pair or presence rule whoever they are; the checker only the eligible ones).

The deliberate differences have their own hand-computed cases in `fixtures/month-check/cases.json`.

Every family the checker recomputes is broken in at least one case — count with `<=`, `>=` and
`==`, presence, pair, `mandatory_lead`, and every protection code in `PROTECTION_CODES` — and the
generator refuses to write a file where one is missing (both suites assert it again).

The ids in this file are the fictitious acceptance world's (`m-ana`, `w-2026-11-01-sun`), which
is already public; no real name or id ever goes in.
"""

import copy
import json
import os
import random
import sys

if __package__ in (None, ""):  # run as a script
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from acceptance import checker  # noqa: E402
from acceptance.world import Chain, load_world  # noqa: E402
from owt_v3.service import handle  # noqa: E402
from owt_v3.vocab import add_days, add_months  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
OUT = os.path.join(REPO, "fixtures", "month-check", "parity.json")
WORLD = os.path.join(HERE, "world_realistic.json")
SMOKE = os.path.join(HERE, "smoke.json")
SEED = 1
BASE_LAST = "2026-10"

INSTANCE_FAMILIES = ("count:<=", "count:>=", "count:==", "presence", "pair", "mandatory_lead")
PROTECTION_CODES = (
    "sunday_cap_exceeded", "saturday_cap_exceeded", "consecutive_sundays", "voice_floor_missed",
    "dl_floor_missed", "compensation_missed", "cadence_on_missed", "cadence_off_led",
)


# ── bases ───────────────────────────────────────────────────────────────────

def _solve(req):
    status, resp, _ = handle(req)
    if status != 200 or not resp.get("ok"):
        raise SystemExit(f"base solve failed: {resp.get('code')}")
    return resp


def _unclamped(req):
    """The request without any `==`/`>=` count rule whose value exceeds the availability the
    checker would clamp it to (no fixed services here, so availability is eligibility)."""
    R = checker._Request(req)
    keep = []
    for r in req["rules"]:
        if r["kind"] == "count" and r["op"] in ("==", ">="):
            avail = sum(1 for s in req["services"] if s["kind"] != "special" and s["month"] == r["month"]
                        and any(R.key(s, role) in r["roles"] and R.could(r["person"], s["id"], role)
                                for role in R.roles(s)))
            if r["value"] > avail:
                continue
        keep.append(r)
    return {**req, "rules": keep}


def bases():
    """(name, request, assignments) per base; no base has a fixed service or a pin."""
    data = load_world(WORLD)
    ch = Chain(data)
    month = data["start"]
    while month <= BASE_LAST:
        req, resp = ch.run([month], SEED)
        if not resp.get("ok"):
            raise SystemExit(f"setup solve failed: {month}")
        month = add_months(month, 1)
    out = []
    req, resp = ch.run(["2026-11", "2026-12"], SEED)
    out.append(("realistic-nov-dec", req, resp["assignments"]))
    req, resp = ch.run(["2027-01"], SEED)
    out.append(("realistic-jan", req, resp["assignments"]))
    with open(SMOKE, encoding="utf-8") as f:
        smoke = json.load(f)
    out.append(("smoke", smoke, _solve(smoke)["assignments"]))
    for name, req, _ in out:
        if req["pins"] or any(s["fixed"] for s in req["services"]):
            raise SystemExit(f"base {name} has a fixed service or a pin")
    return [(name, _unclamped(req), assignments) for name, req, assignments in out]


# ── edits ───────────────────────────────────────────────────────────────────

class Board:
    """A base's assignments under edit. Every `place` is of an eligible person into a role the
    service has, and never a second seat in one service (both suites' hard rules)."""

    def __init__(self, req, assignments, extra_rules=(), extra_services=(), extra_eligibility=None):
        self.req = {**req, "rules": req["rules"] + list(extra_rules)}
        self.services_add = list(extra_services)
        self.eligibility_add = extra_eligibility or {}
        if self.services_add:
            self.req = with_additions(self.req, self.services_add, self.eligibility_add)
        self.R = checker._Request(self.req)
        self.a = copy.deepcopy(assignments)
        self.ops = []

    def seated(self, sid):
        return {p for ids in self.a.get(sid, {}).values() for p in ids}

    def holds(self, sid, role, p):
        return p in self.a.get(sid, {}).get(role, [])

    def clear(self, sid, role, p):
        assert self.holds(sid, role, p)
        self.a[sid][role] = [x for x in self.a[sid][role] if x != p]
        self.ops.append(["clear", sid, role, p])

    def can_place(self, sid, role, p):
        s = self.R.svc[sid]
        return role in self.R.roles(s) and self.R.eligible(p, sid, role) and p not in self.seated(sid)

    def place(self, sid, role, p):
        assert self.can_place(sid, role, p), (sid, role, p)
        self.a.setdefault(sid, {}).setdefault(role, []).append(p)
        self.ops.append(["place", sid, role, p])

    def services(self, month=None, day=None, kind=None):
        return [s for s in self.req["services"] if (month is None or s["month"] == month)
                and (day is None or checker._day(s["date"]) == day) and (kind is None or s["kind"] == kind)]

    def clear_person(self, p, month, roles=("Lead", "BGV", "Choir"), day=None):
        for s in self.services(month, day):
            for role in roles:
                if self.holds(s["id"], role, p):
                    self.clear(s["id"], role, p)


def with_additions(req, services_add, eligibility_add):
    """A request with extra services and the people's eligibility for them (both suites apply
    a case's `services_add`/`eligibility_add` exactly so)."""
    out = {**req, "services": sorted(req["services"] + list(services_add), key=lambda s: (s["date"], s["id"]))}
    out["people"] = [{**p, "eligibility": {**p["eligibility"], **eligibility_add.get(p["id"], {})}} for p in req["people"]]
    return out


# Each maker edits a fresh board of one base and returns it, or None when this base has no way
# to break that family. Order and choices are deterministic (sorted ids, the first that fits).

def make_count_le(req, a):
    for r in [r for r in req["rules"] if r["kind"] == "count" and r["op"] == "<="]:
        b = Board(req, a)
        for s in b.services(r["month"]):
            for role in b.R.roles(s):
                if b.R.key(s, role) in r["roles"] and b.can_place(s["id"], role, r["person"]):
                    b.place(s["id"], role, r["person"])
        if any(i[0] == "count" and i[1] == r["id"] for i in checker.recompute(b.req, b.a)[0]):
            return b
    # No `<=` rule that more seats break: add one under a person's current count.
    b = Board(req, a)
    for p in sorted(b.R.people):
        for s in b.services(day="Sun", kind="sunday"):
            if b.holds(s["id"], "BGV", p):
                n = sum(1 for x in b.services(s["month"], "Sun") if b.holds(x["id"], "BGV", p))
                rule = {"id": "fx-le", "kind": "count", "person": p, "roles": ["Sun.BGV"], "op": "<=",
                        "month": s["month"], "value": n - 1}
                return Board(req, a, [rule])
    return None


def make_count_ge(req, a):
    """Add a `>=` rule at the person's solved count, then clear one of those seats."""
    b = Board(req, a)
    for p in sorted(b.R.people):
        for month in b.req["months"]:
            seats = [s for s in b.services(month, "Sun") if b.holds(s["id"], "BGV", p)]
            if not seats:
                continue
            rule = {"id": "fx-ge", "kind": "count", "person": p, "roles": ["Sun.BGV"], "op": ">=",
                    "month": month, "value": len(seats)}
            b = Board(req, a, [rule])
            b.clear(seats[0]["id"], "BGV", p)
            return b
    return None


def make_count_eq(req, a):
    b = Board(req, a)
    for r in b.req["rules"]:
        if r["kind"] != "count" or r["op"] != "==" or r["value"] < 1:
            continue
        for s in b.services(r["month"]):
            for role in b.R.roles(s):
                if b.R.key(s, role) in r["roles"] and b.holds(s["id"], role, r["person"]):
                    b.clear(s["id"], role, r["person"])
                    return b
    # None here: add an `==` at the solved count and clear one seat.
    for p in sorted(b.R.people):
        for month in b.req["months"]:
            seats = [s for s in b.services(month, "Sun") if b.holds(s["id"], "Lead", p)]
            if seats:
                rule = {"id": "fx-eq", "kind": "count", "person": p, "roles": ["Sun.Lead"], "op": "==",
                        "month": month, "value": len(seats)}
                b = Board(req, a, [rule])
                b.clear(seats[0]["id"], "Lead", p)
                return b
    return None


def make_presence(req, a):
    b = Board(req, a)
    for r in b.req["rules"]:
        if r["kind"] != "presence":
            continue
        for s in b.services():
            if s["kind"] == "special" or (r.get("month") and s["month"] != r["month"]):
                continue
            holders = [(role, p) for role in b.R.roles(s) for p in r["persons"]
                       if b.R.key(s, role) in r["roles"] and b.holds(s["id"], role, p)]
            if holders:
                for role, p in holders:
                    b.clear(s["id"], role, p)
                return b
    return None


def _seat(b, s, p, role):
    """Move `p` into `role` of service `s` (off any other seat there); False when not eligible."""
    if b.holds(s["id"], role, p):
        return True
    for other in b.R.roles(s):
        if b.holds(s["id"], other, p):
            b.clear(s["id"], other, p)
    if not b.can_place(s["id"], role, p):
        return False
    b.place(s["id"], role, p)
    return True


def make_pair(req, a):
    for r in [r for r in req["rules"] if r["kind"] == "pair"]:
        x, y = r["persons"]
        for s in Board(req, a).services():
            if s["kind"] == "special" or (r.get("month") and s["month"] != r["month"]):
                continue
            roles = [role for role in checker._Request(req).roles(s) if checker._Request(req).key(s, role) in r["roles"]]
            for rx in roles:
                for ry in roles:
                    b = Board(req, a)
                    if _seat(b, s, x, rx) and _seat(b, s, y, ry) and any(
                            i[0] == "pair" and i[1] == r["id"] for i in checker.recompute(b.req, b.a)[0]):
                        return b
    return None


def make_mandatory_lead(req, a):
    b = Board(req, a)
    for s in b.services():
        if s["kind"] == "special":
            continue
        leads = list(b.a.get(s["id"], {}).get("Lead", []))
        if leads:
            for p in leads:
                b.clear(s["id"], "Lead", p)
            return b
    return None


def _cap(req, a, day, kind, code):
    """A person without an exact rule placed as Lead on a second counted service of one day class."""
    b = Board(req, a)
    for month in b.req["months"]:
        svcs = [s for s in b.services(month, day, kind) if s["counts"]]
        for p in sorted(b.R.people):
            if b.R.exact(p, month, f"{day}.Lead"):
                continue
            led = [s for s in svcs if b.holds(s["id"], "Lead", p)]
            for s in svcs:
                if len(led) >= 2:
                    break
                if s in led:
                    continue
                if not b.holds(s["id"], "Lead", p) and p in b.seated(s["id"]):
                    continue
                if b.can_place(s["id"], "Lead", p):
                    b.place(s["id"], "Lead", p)
                    led.append(s)
            if any(m[0] == code for m in checker.recompute(b.req, b.a)[1]):
                return b
            b = Board(req, a)
    return None


def make_sunday_cap(req, a):
    return _cap(req, a, "Sun", "sunday", "sunday_cap_exceeded")


def make_saturday_cap(req, a):
    return _cap(req, a, "Sat", "saturday", "saturday_cap_exceeded")


def make_consecutive(req, a):
    b = Board(req, a)
    for s in b.services(day="Sun", kind="sunday"):
        nxt = next((x for x in b.services(day="Sun", kind="sunday") if x["date"] == add_days(s["date"], 7)), None)
        if not nxt or not s["counts"] or not nxt["counts"]:
            continue
        for p in list(b.a.get(s["id"], {}).get("Lead", [])):
            bx = Board(req, a)
            if bx.can_place(nxt["id"], "Lead", p):
                bx.place(nxt["id"], "Lead", p)
                if any(m[0] == "consecutive_sundays" for m in checker.recompute(bx.req, bx.a)[1]):
                    return bx
    return None


def make_voice_floor(req, a):
    for p in sorted(checker._Request(req).people):
        person = checker._Request(req).people[p]
        if person.get("exempt"):
            continue
        for month in req["months"]:
            b = Board(req, a)
            b.clear_person(p, month)
            if b.ops and any(m[0] == "voice_floor_missed" and m[1] == p for m in checker.recompute(b.req, b.a)[1]):
                return b
    return None


def make_dl_floor(req, a):
    R = checker._Request(req)
    for p in sorted(R.people):
        b = Board(req, a)
        for month in req["months"]:
            b.clear_person(p, month, roles=("Lead",), day="Sun")
        if b.ops and any(m[0] == "dl_floor_missed" and m[1] == p for m in checker.recompute(b.req, b.a)[1]):
            return b
    return None


def _cadence_people(req, state):
    R = checker._Request(req)
    return [(p, m) for p in sorted(R.people) for m in req["months"]
            if (R.people[p].get("cadence") or {}).get(m) == state]


def make_compensation(req, a):
    for p, month in _cadence_people(req, "off"):
        b = Board(req, a)
        b.clear_person(p, month, roles=("Lead",))
        if any(m[0] == "compensation_missed" and m[1] == p for m in checker.recompute(b.req, b.a)[1]):
            return b
    return None


def make_cadence_on(req, a):
    for p, month in _cadence_people(req, "on"):
        b = Board(req, a)
        b.clear_person(p, month, roles=("Lead",), day="Sun")
        if b.ops and any(m[0] == "cadence_on_missed" and m[1] == p for m in checker.recompute(b.req, b.a)[1]):
            return b
    return None


def make_cadence_off_led(req, a):
    for state in ("off", "out"):
        for p, month in _cadence_people(req, state):
            b = Board(req, a)
            for s in b.services(month, "Sun"):
                if not s["counts"]:
                    continue
                for role in ("BGV", "Choir"):
                    if b.holds(s["id"], role, p):
                        b.clear(s["id"], role, p)
                if b.can_place(s["id"], "Lead", p):
                    b.place(s["id"], "Lead", p)
                    if any(m[0] == "cadence_off_led" and m[1] == p for m in checker.recompute(b.req, b.a)[1]):
                        return b
                    break
    return None


def make_counted_special(req, a):
    """A counted special on a Friday (a «Sat» day for the protections, never a count rule's): a
    person with a Saturday Lead that month also leads it."""
    for month in req["months"]:
        sats = [x for x in req["services"] if x["month"] == month and x["kind"] == "saturday" and x["counts"]]
        for sat in sats:
            for p in a.get(sat["id"], {}).get("Lead", []):
                friday = add_days(sat["date"], -1)
                sp = {"id": f"sp-{friday}", "date": friday, "month": month, "kind": "special", "fixed": False,
                      "counts": True, "seats": {"Lead": 1, "BGV": 1, "Choir": 0}}
                b = Board(req, a, extra_services=[sp], extra_eligibility={p: {sp["id"]: ["Lead", "BGV"]}})
                b.place(sp["id"], "Lead", p)
                if any(m[0] == "saturday_cap_exceeded" and m[1] == p for m in checker.recompute(b.req, b.a)[1]):
                    return b
    return None


MAKERS = (
    ("count_le", make_count_le), ("count_ge", make_count_ge), ("count_eq", make_count_eq),
    ("presence", make_presence), ("pair", make_pair), ("mandatory_lead", make_mandatory_lead),
    ("sunday_cap", make_sunday_cap), ("saturday_cap", make_saturday_cap), ("consecutive", make_consecutive),
    ("voice_floor", make_voice_floor), ("dl_floor", make_dl_floor), ("compensation", make_compensation),
    ("cadence_on", make_cadence_on), ("cadence_off_led", make_cadence_off_led),
    ("counted_special", make_counted_special),
)


def make_random(req, a, rng, n_ops):
    """A mixed hand edit: clears and eligible placements chosen by a seeded generator."""
    b = Board(req, a)
    for _ in range(n_ops):
        if rng.random() < 0.5:
            seats = [(sid, role, p) for sid in sorted(b.a) for role in sorted(b.a[sid]) for p in b.a[sid][role]]
            if seats:
                b.clear(*rng.choice(seats))
        else:
            options = [(s["id"], role, p) for s in b.services() for role in b.R.roles(s)
                       for p in sorted(b.R.people) if b.can_place(s["id"], role, p)]
            if options:
                b.place(*rng.choice(options))
    return b


# ── the file ────────────────────────────────────────────────────────────────

def family_of(req, instance):
    family, rule, _ = instance
    if family == "count":
        return f"count:{next(r for r in req['rules'] if r['id'] == rule)['op']}"
    return family


def case_of(name, base_index, board):
    instances, missed = checker.recompute(board.req, board.a)
    base_rules = {r["id"] for r in bases_cache[base_index][1]["rules"]}
    return {
        "name": name,
        "base": base_index,
        "rules_add": [r for r in board.req["rules"] if r["id"] not in base_rules],
        "services_add": board.services_add,
        "eligibility_add": board.eligibility_add,
        "edits": board.ops,
        "assignments": board.a,
        "expected": {
            "instances": [[f, r, list(s) if isinstance(s, tuple) else s] for f, r, s in instances],
            "missed": [[c, p, s] for c, p, s in missed],
        },
    }


bases_cache = []


def build():
    bases_cache[:] = bases()
    cases = []
    for i, (bname, req, a) in enumerate(bases_cache):
        cases.append(case_of(f"{bname}/as-solved", i, Board(req, a)))
        for mname, make in MAKERS:
            board = make(req, a)
            if board is not None:
                cases.append(case_of(f"{bname}/{mname}", i, board))
        rng = random.Random(f"month-check|{bname}")
        for k in range(6):
            cases.append(case_of(f"{bname}/random-{k + 1}", i, make_random(req, a, rng, rng.randint(1, 5))))
    families, codes = set(), set()
    for c in cases:
        req = with_additions({**bases_cache[c["base"]][1]}, c["services_add"], c["eligibility_add"])
        req["rules"] = req["rules"] + c["rules_add"]
        families |= {family_of(req, tuple(x)) for x in c["expected"]["instances"]}
        codes |= {m[0] for m in c["expected"]["missed"]}
    missing = [f for f in INSTANCE_FAMILIES if f not in families] + [c for c in PROTECTION_CODES if c not in codes]
    if missing:
        raise SystemExit(f"no case breaks: {', '.join(missing)}")
    return {
        "schema": 1,
        "about": "Month-check parity (MCP editor plan T2.1). GENERATED by "
                 "`python gcf_v3/acceptance/month_check_fixtures.py`; asserted by "
                 "gcf_v3/tests/test_month_check_parity.py and app/mcp/monthProposals/__tests__/monthCheckParity.test.ts.",
        "instance_families": list(INSTANCE_FAMILIES),
        "protection_codes": list(PROTECTION_CODES),
        "bases": [{"name": n, "request": r} for n, r, _ in bases_cache],
        "cases": cases,
    }


def main():
    fixture = build()
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(fixture, f, ensure_ascii=False, indent=1, sort_keys=False)
        f.write("\n")
    print(json.dumps({"cases": len(fixture["cases"]), "bases": len(fixture["bases"]), "out": os.path.relpath(OUT, REPO)}))


if __name__ == "__main__":
    main()
