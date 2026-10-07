"""The acceptance world (spec §12.3): a roster, its rules and a calendar, plus the chain
that solves month after month and derives each next request's inputs:

- carried balances from the SAME Python formula over the chain's stored months (the
  3-month window, F3) — `owt_v3.formula.realised`;
- cadence states from the test-only X1 (`acceptance.x1`);
- `dl_since`, `prev_dl_leads` and `prior` from the stored services.

World file schema (`world_realistic.json`; the private converter writes the same shape):

    {"schema": 1, "scenarios": true?, "start": "YYYY-MM", "saturday_anchor": "YYYY-MM-DD",
     "seats": {"sunday": {"Lead", "BGV", "Choir"}, "saturday": {"Lead", "BGV"}},
     "availability": {"seed": int, "rate": float},
     "members": [{"id", "name", "roles": [RoleKey…], "since": {RoleKey: "YYYY-MM"}?,
                  "exempt": bool, "cadence": bool, "unavailable": ["YYYY-MM-DD"…]}],
     "rules": [count {id, person, roles, op, value | sundays_minus} | pair {id, persons, roles}
               | presence {id, persons, roles, exclusive}],
     "stored": [{"id", "date", "kind", "counts", "time"?, "seats": {"Lead": [ids], …}}]?}

A member's status for a role key is "in" when the key is in `roles` and the month is not
before `since[key]`; an `==` count with value >= 1 makes it "exact" (C2 REC-3). `scenarios`
marks the fictitious world, whose member ids the scenario sets P and G name; a private world
built by the converter omits it, and runs A–D and O only.
"""

import copy
import json
import random
from collections import defaultdict
from fractions import Fraction

from owt_v3.formula import FMonth, FPresence, FService, realised
from owt_v3.rounding import hundredths
from owt_v3.service import handle
from owt_v3.vocab import (add_days, add_months, day_class, month_index,
                          parse_date, role_key)

from . import x1

ROLES = ("Lead", "BGV", "Choir")


def load_world(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def month_dates(month):
    d = parse_date(f"{month}-01")
    while d.strftime("%Y-%m") == month:
        yield d.isoformat()
        d = parse_date(add_days(d.isoformat(), 1))


def sunday_count(month):
    return sum(1 for d in month_dates(month) if parse_date(d).weekday() == 6)


class World:
    def __init__(self, data, overlay=None):
        self.data = copy.deepcopy(data)
        ov = overlay or {}
        self.members = {m["id"]: m for m in self.data["members"]}
        for m in ov.get("members_add", []):
            self.members[m["id"]] = m
        for mid, roles in ov.get("roles_override", {}).items():
            self.members[mid] = {**self.members[mid], "roles": roles}
        for mid, since in ov.get("since_override", {}).items():
            self.members[mid] = {**self.members[mid], "since": since}
        self.rules = [r for r in self.data["rules"] if r["id"] not in ov.get("rules_drop", [])]
        self.rules += ov.get("rules_add", [])
        self.extra_unav = {k: set(v) for k, v in ov.get("unavailable", {}).items()}
        self.forced = {k: set(v) for k, v in ov.get("available", {}).items()}
        self.saturdays = ov.get("saturdays", "alternate")
        for kind, seats in ov.get("seats", {}).items():
            self.data["seats"][kind] = {**self.data["seats"][kind], **seats}
        av = self.data["availability"]
        self._rate, self._seed = av["rate"], av["seed"]

    # ── facts ───────────────────────────────────────────────────────────────
    def ids(self):
        return sorted(self.members)

    def status(self, mid, key, month):
        m = self.members[mid]
        if key not in m["roles"]:
            return "out"
        since = m.get("since", {}).get(key)
        if since is not None and month < since:
            return "out"
        for r in self.rules:
            if r["kind"] == "count" and r["op"] == "==" and r["person"] == mid and key in r["roles"]:
                if self.count_value(r, month) >= 1:
                    return "exact"
        return "in"

    def available(self, mid, date):
        if date in self.forced.get(mid, ()):
            return True
        if date in self.members[mid].get("unavailable", ()) or date in self.extra_unav.get(mid, ()):
            return False
        return random.Random(f"{self._seed}|{mid}|{date}").random() >= self._rate

    def count_value(self, rule, month):
        if "sundays_minus" in rule:
            return max(0, sunday_count(month) - rule["sundays_minus"])
        return rule["value"]

    def presence_rules(self, month=None):
        return [r for r in self.rules if r["kind"] == "presence"
                and (month is None or r.get("month") in (None, month))]

    def record(self, month):
        """The month's facts as a C2 record would hold them, for the ledger."""
        listed = frozenset(self.ids())
        exact = defaultdict(frozenset)
        for mid in listed:
            keys = {k for k in self.members[mid]["roles"] if self.status(mid, k, month) == "exact"}
            if keys:
                exact[mid] = frozenset(keys)
        world = self

        def base_in(p, fs, key):
            return (key.split(".")[0] == fs.day and world.status(p, key, month) == "in"
                    and world.available(p, fs.date))
        return FMonth(
            listed=listed, exact=dict(exact),
            cadence=frozenset(m for m in listed if self.members[m].get("cadence")),
            exempt=frozenset(m for m in listed if self.members[m].get("exempt")),
            presence=tuple(FPresence(r["id"], tuple(r["roles"]), tuple(r["persons"]), r["exclusive"])
                           for r in self.presence_rules(month)),
            base_in=base_in,
        )

    # ── calendar ────────────────────────────────────────────────────────────
    def calendar(self, months):
        anchor = parse_date(self.data["saturday_anchor"])
        out = []
        for month in months:
            for d in month_dates(month):
                wd = parse_date(d).weekday()
                if wd == 6:
                    out.append({"id": f"w-{d}-sun", "date": d, "month": month, "kind": "sunday",
                                "fixed": False, "counts": True, "seats": dict(self.data["seats"]["sunday"])})
                elif wd == 5 and (self.saturdays == "every" or (parse_date(d) - anchor).days % 14 == 0):
                    out.append({"id": f"w-{d}-sat", "date": d, "month": month, "kind": "saturday",
                                "fixed": False, "counts": True, "seats": dict(self.data["seats"]["saturday"])})
        return out


class Chain:
    """Solves runs in sequence; each run's assignment becomes stored services."""

    def __init__(self, data, overlay=None):
        self.data = data
        self.world = World(data, overlay)
        self.stored = [copy.deepcopy(s) for s in data.get("stored", [])]
        self.overlay = overlay or {}

    def add_stored(self, services):
        for s in services:
            self.stored = [x for x in self.stored if (x["date"], x["kind"]) != (s["date"], s["kind"])]
            self.stored.append(copy.deepcopy(s))
        self.stored.sort(key=lambda s: (s["date"], s["id"]))

    def drop_months(self, months):
        self.stored = [s for s in self.stored if s["date"][:7] not in months]

    def stored_in(self, month):
        return [s for s in self.stored if s["date"][:7] == month]

    # ── derived inputs ──────────────────────────────────────────────────────
    def ledger(self, months):
        """Exact (share, received) per (person, line) over stored counted services of `months`."""
        fsvcs, fmonths = [], {}
        for month in months:
            fmonths[month] = self.world.record(month)
            for s in self.stored_in(month):
                if not s["counts"]:
                    continue
                day = day_class(s["date"])
                fsvcs.append(FService(id=s["id"], date=s["date"], time=s.get("time"), month=month, day=day,
                                      weekend=s["kind"] != "special",
                                      keys=tuple(role_key(day, r) for r in ROLES),
                                      seats={r: tuple(s["seats"].get(r, [])) for r in ROLES}))
        res = realised(fsvcs, fmonths)
        share, received = defaultdict(Fraction), defaultdict(int)
        for (m, p, line), v in res.share.items():
            share[(p, line)] += v
        for (m, p, line), v in res.received.items():
            received[(p, line)] += v
        return share, received, res

    def carried(self, first):
        window = [add_months(first, -k) for k in (3, 2, 1)]
        share, received, _ = self.ledger(window)
        out = defaultdict(dict)
        for key in set(share) | set(received):
            p, line = key
            value = hundredths(share[key]) - 100 * received[key]
            if value:
                out[p][line] = value
        return out

    def led_sunday(self, mid, month):
        return any(mid in s["seats"].get("Lead", []) and s["counts"] and day_class(s["date"]) == "Sun"
                   for s in self.stored_in(month))

    def dl_leads(self, mid, month):
        return sum(1 for s in self.stored_in(month)
                   if s["counts"] and day_class(s["date"]) == "Sun" and mid in s["seats"].get("Lead", []))

    # ── the request ─────────────────────────────────────────────────────────
    def request(self, months, seed):
        W, ov = self.world, self.overlay
        stored_dates = {(s["date"], s["kind"]) for s in self.stored}
        services = [s for s in W.calendar(months) if (s["date"], s["kind"]) not in stored_dates]
        fixed = [s for s in self.stored if s["date"][:7] in months]
        for s in ov.get("specials", []):
            if s["date"][:7] in months:
                fixed.append(s)
        pins = []
        for s in fixed:
            entry = {"id": s["id"], "date": s["date"], "month": s["date"][:7], "kind": s["kind"],
                     "fixed": True, "counts": s["counts"]}
            if s.get("time"):
                entry["time"] = s["time"]
            services.append(entry)
            for role in ROLES:
                for mid in s["seats"].get(role, []):
                    pins.append({"service": s["id"], "date": s["date"], "role": role, "person": mid})
        pins += [p for p in ov.get("pins", []) if p["date"][:7] in months]
        services.sort(key=lambda s: (s["date"], s["id"]))
        first = months[0]
        carried = self.carried(first)
        people = []
        for mid in W.ids():
            m = W.members[mid]
            elig = {}
            for s in services:
                roles = [r for r in ROLES
                         if W.status(mid, role_key(day_class(s["date"]), r), s["date"][:7]) in ("in", "exact")
                         and W.available(mid, s["date"])]
                if s["kind"] == "saturday" and not s["fixed"]:
                    roles = [r for r in roles if r != "Choir"]
                if roles:
                    elig[s["id"]] = roles
            entry = {"id": mid, "name": m["name"], "exempt": bool(m.get("exempt")), "eligibility": elig,
                     "carried": dict(sorted(carried.get(mid, {}).items())),
                     "dl_since": self.dl_since(mid, months),
                     "prev_dl_leads": self.dl_leads(mid, add_months(first, -1))}
            if m.get("cadence"):
                states = x1.cadence_states(self.led_sunday(mid, add_months(first, -1)), [
                    {"month": mo, "eligible": W.status(mid, "Sun.Lead", mo) == "in",
                     "availableCountedSundays": sum(
                         1 for s in services if s["date"][:7] == mo and s["counts"]
                         and day_class(s["date"]) == "Sun" and W.available(mid, s["date"]))}
                    for mo in months])
                entry["cadence"] = {e["month"]: x1.wire_state(e) for e in states}
            people.append(entry)
        rules = []
        for r in W.rules:
            if r["kind"] == "count":
                for mo in months:
                    rules.append({"id": r["id"], "kind": "count", "person": r["person"], "roles": r["roles"],
                                  "op": r["op"], "month": mo, "value": W.count_value(r, mo)})
            elif r["kind"] in ("pair", "presence"):
                if r.get("month") is not None and r["month"] not in months:
                    continue
                keys = ("id", "kind", "persons", "roles") + (("exclusive",) if r["kind"] == "presence" else ())
                rules.append({k: r[k] for k in keys + (("month",) if r.get("month") else ())})
        prior_month = add_months(first, -1)
        lo, hi = add_days(f"{first}-01", -14), add_days(f"{first}-01", -1)
        prior = {"month": prior_month,
                 "has_services": any(s["kind"] != "special" or s["counts"] for s in self.stored_in(prior_month)),
                 "services": [{"date": s["date"], "kind": s["kind"], "counts": s["counts"],
                               "seats": {r: list(s["seats"].get(r, [])) for r in ROLES}}
                              for s in self.stored if lo <= s["date"] <= hi
                              and (s["kind"] != "special" or s["counts"])]}
        req = {"contract": 3, "request_id": f"acc-{'-'.join(months)}-{seed}", "seed": seed,
               "months": list(months), "services": services, "people": people, "rules": rules,
               "pins": pins, "prior": prior}
        if "budget" in ov:
            req["budget"] = ov["budget"]
        return req

    def dl_since(self, mid, months):
        m = self.world.members[mid]
        if "Sun.Lead" not in m["roles"]:
            return None
        since = max(self.data["start"], m.get("since", {}).get("Sun.Lead", self.data["start"]))
        if month_index(since) > month_index(months[-1]):
            return None
        return since

    # ── one run ─────────────────────────────────────────────────────────────
    def run(self, months, seed, store=True):
        req = self.request(months, seed)
        status, resp, _ = handle(req)
        if resp.get("ok") and store:
            fixed = {s["id"] for s in req["services"] if s["fixed"]}
            for s in req["services"]:
                if s["id"] in fixed and any(x["id"] == s["id"] for x in self.stored):
                    continue
                self.stored.append({"id": s["id"], "date": s["date"], "kind": s["kind"], "counts": s["counts"],
                                    "time": s.get("time"),
                                    "seats": {r: list(resp["assignments"][s["id"]].get(r, [])) for r in ROLES}})
            self.stored.sort(key=lambda s: (s["date"], s["id"]))
        return req, resp

    def cumulative(self, first, last):
        """Exact cumulative balance per (person, line) from `first` through `last` (LINE seats)."""
        months = [first]
        while months[-1] < last:
            months.append(add_months(months[-1], 1))
        share, received, _ = self.ledger(months)
        return {k: share[k] - received[k] for k in set(share) | set(received)}
