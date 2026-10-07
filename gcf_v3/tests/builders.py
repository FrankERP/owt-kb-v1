"""Fictitious request builders for the v3 unit suite. Every name here is invented."""

import copy

ALL3 = ["Lead", "BGV", "Choir"]


def service(sid, date, kind="sunday", seats=None, fixed=False, counts=True, time=None):
    s = {"id": sid, "date": date, "month": date[:7], "kind": kind, "fixed": fixed, "counts": counts}
    if not fixed:
        s["seats"] = seats if seats is not None else (
            {"Lead": 2, "BGV": 3} if kind == "saturday" else {"Lead": 2, "BGV": 3, "Choir": 3})
    if time is not None:
        s["time"] = time
    return s


def person(pid, eligibility, carried=None, exempt=False, cadence=None, dl_since="2026-01", prev=0, name=None):
    p = {"id": pid, "name": name or pid[2:].title(), "eligibility": eligibility, "carried": carried or {},
         "dl_since": dl_since, "prev_dl_leads": prev}
    if exempt:
        p["exempt"] = True
    if cadence is not None:
        p["cadence"] = cadence
    return p


def request(services, people, rules=None, pins=None, months=None, prior=None, seed=1, budget=None, request_id=None):
    months = months or sorted({s["month"] for s in services})
    first = months[0]
    y, m = int(first[:4]), int(first[5:7])
    prev = f"{y - 1}-12" if m == 1 else f"{y}-{m - 1:02d}"
    body = {"contract": 3, "seed": seed, "months": months, "services": services, "people": people,
            "rules": rules or [], "pins": pins or [],
            "prior": prior or {"month": prev, "has_services": True, "services": []}}
    if budget is not None:
        body["budget"] = budget
    if request_id is not None:
        body["request_id"] = request_id
    return copy.deepcopy(body)


def everyone(people_ids, services, roles=ALL3):
    """Eligibility for every listed person at every listed service (roles the service has)."""
    out = []
    for pid in people_ids:
        elig = {}
        for s in services:
            have = ["Lead", "BGV"] if (s["kind"] == "saturday" and not s["fixed"]) else ALL3
            elig[s["id"]] = [r for r in roles if r in have]
        out.append(person(pid, elig))
    return out


def pin(service_, role, pid):
    return {"service": service_["id"], "date": service_["date"], "role": role, "person": pid}


# One month (Nov 2026) used across modules: Sundays 1, 8, 15, 22, 29; Saturdays 14, 28.
NOV_SUNDAYS = ["2026-11-01", "2026-11-08", "2026-11-15", "2026-11-22", "2026-11-29"]
NOV_SATURDAYS = ["2026-11-14", "2026-11-28"]
