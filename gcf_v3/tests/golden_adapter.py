"""Test-side adapter for C2's golden fixture (IF2-29; C2 FX-3; spec §6.6).

It turns one `ledger` case's input — C2's IF2-10 `LedgerInput` — into the shared formula's
inputs exactly as C2's ledger prepares its own: first IF2-11's seat-keeping step (LG-1, LG-2,
LG-4's role keys; LG-4's kept seat and second seats are the formula's own `keep_seats`), then
LG-3's month selection, then LG-5–LG-8's populations from each month's record. In production
the caller has already applied LG-1–LG-3 (C5-10); these are test-side obligations only.
"""

import os
from collections import Counter, defaultdict
from fractions import Fraction

from owt_v3.formula import FMonth, FPresence, FService, realised
from owt_v3.rounding import hundredths
from owt_v3.vocab import day_class

FIXTURE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "fixtures", "fairness",
                       "golden.json")
WEEKEND_DAY = {"sunday_role": "Sun", "saturday_role": "Sat"}


def counted(service):
    """LG-2: coalesce(countsForFairness, _type != "special_role") on the raw field."""
    flag = service.get("countsForFairness")
    return flag if flag is not None else service["_type"] != "special_role"


def keep_services(services):
    """LG-1 and LG-2: canonical documents; every copy of a weekend type duplicated on one date dropped."""
    canonical = [s for s in services if not s["_id"].startswith("drafts.")]
    copies = Counter((s["_type"], s["date"]) for s in canonical if s["_type"] != "special_role")
    kept = [s for s in canonical if s["_type"] == "special_role" or copies[(s["_type"], s["date"])] == 1]
    return [s for s in kept if counted(s)]


def record_month(record, live):
    """LG-5–LG-8 facts of one recorded month. `live`: member id -> live unavailable dates."""
    status = {p["memberId"]: p["roles"] for p in record["people"]}
    blocks = {(p["memberId"], b["date"]): b for p in record["people"] for b in p["blocks"]}

    def base_in(person, fs, key):
        if status.get(person, {}).get(key) != "in":
            return False
        block = blocks.get((person, fs.date))
        if (block and block["unavailable"]) or fs.date in live.get(person, ()):
            return False
        return not (fs.weekend and block is not None and key in block["excludedRoles"])

    return FMonth(
        listed=frozenset(status),
        exact={p: frozenset(k for k, v in roles.items() if v == "exact") for p, roles in status.items()},
        cadence=frozenset(p["memberId"] for p in record["people"] if p.get("sundayCadence") == "alternate"),
        exempt=frozenset(p["memberId"] for p in record["people"] if p["exempt"]),
        presence=tuple(FPresence(r["ruleKey"], tuple(r["roles"]), tuple(r["members"]), r["exclusive"])
                       for r in record["presence"]),
        base_in=base_in,
    )


def prepare(ledger_input):
    """(services, months) for `realised`, LG-3's month selection applied."""
    target = ledger_input["target"]
    records = {r["month"]: r for r in ledger_input["records"] if r["month"] < target}
    live = {m["id"]: set(m.get("unavailableDates", [])) for m in ledger_input["members"]}
    fservices = []
    for s in keep_services(ledger_input["services"]):
        month = s["date"][:7]
        if month >= target or month not in records:
            continue
        day = WEEKEND_DAY.get(s["_type"]) or day_class(s["date"])
        fservices.append(FService(
            id=s["_id"], date=s["date"], time=s.get("time"), month=month, day=day,
            weekend=s["_type"] != "special_role", keys=(f"{day}.Lead", f"{day}.BGV", f"{day}.Choir"),
            seats={"Lead": tuple(s["Lead"]), "BGV": tuple(s["BGVs"]), "Choir": tuple(s["Chorus"])}))
    return fservices, {m: record_month(r, live) for m, r in records.items()}


def figures(ledger_input):
    """Per month: {member: {line: {share, received, balance}}} in hundredths, plus the raw result."""
    services, months = prepare(ledger_input)
    res = realised(services, months)
    share, received = defaultdict(Fraction), defaultdict(int)
    for key, v in res.share.items():
        share[key] += v
    for key, v in res.received.items():
        received[key] += v
    out = defaultdict(lambda: defaultdict(dict))
    for (m, p, line) in set(share) | set(received) | set(res.in_population):
        s, r = hundredths(share[(m, p, line)]), 100 * received[(m, p, line)]
        out[m][p][line] = {"share": s, "received": r, "balance": s - r}  # LG-13: share − received
    return out, res, services
