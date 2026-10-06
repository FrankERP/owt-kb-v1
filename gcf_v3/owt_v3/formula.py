"""The shared realised formula (spec §6.2–§6.4, §6.6; C2 LG-4, LG-7–LG-11, F14).

One pure function, `realised`, computes per month, person and line the exact share
and the received seats of a set of COUNTED services whose seats are filled. It runs
in the post-solve report (on the returned assignment) and in the golden-fixture test
(on C2's stored cases). Its inputs are neutral so both callers can build them:

- `FService`: one counted service, its seat holders per role in input order.
- `FMonth`: the month's facts — who is listed, each person's exact role keys, the
  cadence and exempt sets, the presence rules in scope, and `base_in(p, s, k)`: p is
  «in» for role key k at s (status `in`, available, not rule-excluded). On the request
  side that is «k's role is in her eligibility and k is not exact for her».

Everything is exact (`Fraction`); nothing is rounded here (C5-8).
"""

from collections import defaultdict
from dataclasses import dataclass, field
from fractions import Fraction
from typing import Callable, Dict, FrozenSet, Optional, Tuple

from .vocab import LINE_OF_KEY, ROLE_RANK, ROLES, role_key, seat_order_key


@dataclass(frozen=True)
class FService:
    id: str
    date: str
    time: Optional[str]
    month: str
    day: str  # "Sun" | "Sat"
    weekend: bool
    keys: Tuple[str, ...]  # the role keys the service has
    seats: Dict[str, Tuple[str, ...]]  # role -> holders, input order


@dataclass(frozen=True)
class FPresence:
    id: str
    roles: Tuple[str, ...]
    members: Tuple[str, ...]
    exclusive: bool


@dataclass
class FMonth:
    listed: FrozenSet[str]
    exact: Dict[str, FrozenSet[str]]
    cadence: FrozenSet[str]
    exempt: FrozenSet[str]
    presence: Tuple[FPresence, ...]
    base_in: Callable[[str, FService, str], bool]

    def is_exact(self, person, key):
        return key in self.exact.get(person, ())

    def is_fixed_seat(self, person, key):
        """A12's fixed seat: an exact role key, or a DL-mapped seat of a cadence holder."""
        return self.is_exact(person, key) or (LINE_OF_KEY[key] == "DL" and person in self.cadence)


@dataclass
class Realised:
    share: Dict[Tuple[str, str, str], Fraction] = field(default_factory=lambda: defaultdict(Fraction))
    received: Dict[Tuple[str, str, str], int] = field(default_factory=lambda: defaultdict(int))
    # every seat: (service, role, person, outcome) with outcome a line key or "set_aside:<reason>"
    seats: list = field(default_factory=list)
    set_asides: list = field(default_factory=list)  # {service, role, key, person, reason}
    floor_seat: Dict[Tuple[str, str], Tuple[str, str]] = field(default_factory=dict)  # (m, p) -> (sid, role)
    floor_persons: Dict[str, FrozenSet[str]] = field(default_factory=dict)
    in_population: set = field(default_factory=set)  # (m, p, line)
    fixed_holders: Dict[str, FrozenSet[str]] = field(default_factory=dict)  # m -> people with an exact/cadence seat
    conservation: list = field(default_factory=list)  # (service, line, sum of shares, received seats)


def applying(month, s):
    """[(rule, A)] for the presence rules applying at s, in codepoint order of id (LG-7)."""
    if not s.weekend:
        return []
    out = []
    for rho in sorted(month.presence, key=lambda r: r.id):
        a = tuple(k for k in rho.roles if k in s.keys)
        if a:
            out.append((rho, a))
    return out


def q_members(month, s, rho, a):
    """Q(rho, s): members «in» at s for some role key of A(rho, s), codepoint order."""
    return tuple(sorted(m for m in set(rho.members) if any(month.base_in(m, s, k) for k in a)))


def populations(month, s, held_exact=frozenset()):
    """Pop(s, k) for every key s has (§6.2 items 1–5; LG-8).

    `held_exact` is item 5's input: the people holding, at s, a kept seat whose role key
    is exact for them; they leave every OTHER key's population there.
    """
    rules = applying(month, s)
    sole = set()
    for rho, a in rules:
        q = q_members(month, s, rho, a)
        if len(q) == 1:
            sole.add(q[0])
    out = {}
    for k in s.keys:
        members = []
        for p in sorted(month.listed):
            if not month.base_in(p, s, k):
                continue
            if LINE_OF_KEY[k] == "DL" and p in month.cadence:
                continue
            if any(rho.exclusive and p in rho.members and k in a for rho, a in rules):
                continue
            if p in sole:
                continue
            if p in held_exact and not month.is_exact(p, k):
                continue
            members.append(p)
        out[k] = tuple(members)
    return out


def keep_seats(s):
    """LG-4: each holder's first seat in Lead > BGV > Choir order; every further one is a second seat."""
    kept, second, seen = [], [], set()
    for role in ROLES:
        for h in s.seats.get(role, ()):
            if h in seen:
                second.append((role, h))
            else:
                seen.add(h)
                kept.append((role, h))
    return kept, second


def _service_pass(s, month):
    """Everything about one counted service before floor set-asides."""
    kept, second = keep_seats(s)
    held_exact = frozenset(h for role, h in kept if month.is_exact(h, role_key(s.day, role)))
    pop = populations(month, s, held_exact)
    rules = applying(month, s)
    q = {rho.id: q_members(month, s, rho, a) for rho, a in rules}
    used, pi = set(), {}
    for rho, a in rules:
        cands = sorted(
            (ROLE_RANK[role], h, role) for role, h in kept
            if role_key(s.day, role) in a and h in rho.members
            and not month.is_fixed_seat(h, role_key(s.day, role)) and (role, h) not in used
        )
        if cands:
            _, h, role = cands[0]
            used.add((role, h))
            pi[rho.id] = (role, h)
    seat_class = {}  # (role, h) -> ("normal", line) | ("presence", rho_id) | ("set_aside", reason)
    pi_of = {v: k for k, v in pi.items()}
    for role, h in kept:
        k = role_key(s.day, role)
        if (role, h) in pi_of:
            rid = pi_of[(role, h)]
            seat_class[(role, h)] = ("presence", rid) if h in q[rid] else ("set_aside", "outside_population")
        elif month.is_exact(h, k):
            seat_class[(role, h)] = ("set_aside", "exact")
        elif LINE_OF_KEY[k] == "DL" and h in month.cadence:
            seat_class[(role, h)] = ("set_aside", "cadence")
        elif h not in month.listed:
            seat_class[(role, h)] = ("set_aside", "not_in_record")
        elif h not in pop[k]:
            seat_class[(role, h)] = ("set_aside", "outside_population")
        else:
            seat_class[(role, h)] = ("normal", LINE_OF_KEY[k])
    return kept, second, pop, rules, q, pi, seat_class


def realised(services, months, floor_override=None):
    """Exact shares and received seats (§6.6). `services` are counted only.

    `months` maps each month to its `FMonth`. `floor_override`, when given, maps a month
    to the set of floor persons to use instead of the realised test (the model's view:
    it uses the plan's floor persons, §6.6); each of them still needs a received seat.
    """
    out = Realised()
    by_month = defaultdict(list)
    for s in sorted(services, key=lambda x: (x.date, x.id)):
        by_month[s.month].append(s)
    for m in sorted(by_month):
        month = months[m]
        passes = []
        share = defaultdict(Fraction)  # (p, line) before floor set-asides
        received_seats = defaultdict(list)  # p -> [(order key, sid, role, line)]
        fixed = set()
        for s in by_month[m]:
            kept, second, pop, rules, q, pi, cls = _service_pass(s, month)
            passes.append((s, kept, second, pop, rules, q, pi, cls))
            for k, members in pop.items():
                for p in members:
                    out.in_population.add((m, p, LINE_OF_KEY[k]))
            for rho, _ in rules:
                for p in q[rho.id]:
                    out.in_population.add((m, p, f"P:{rho.id}"))
            for (role, h), (kind, what) in cls.items():
                if kind == "set_aside" and what in ("exact", "cadence"):
                    fixed.add(h)
                if kind in ("normal", "presence"):
                    line = what if kind == "normal" else f"P:{what}"
                    received_seats[h].append((seat_order_key(s.date, role, s.time, s.id), s.id, role, line))
            for k, members in pop.items():
                pool = sum(1 for (role, h), (kind, what) in cls.items()
                           if kind == "normal" and role_key(s.day, role) == k)
                for p in members:
                    share[(p, LINE_OF_KEY[k])] += Fraction(pool, len(members))
            for rho, _ in rules:
                if rho.id in pi and cls[pi[rho.id]][0] == "presence":
                    for p in q[rho.id]:
                        share[(p, f"P:{rho.id}")] += Fraction(1, len(q[rho.id]))
        # LG-11 / §6.4: floor persons, on values without floor set-asides
        if floor_override is not None:
            persons = frozenset(floor_override.get(m, ()))
        else:
            persons = set()
            for p in sorted(month.listed):
                if p in month.exempt or p in fixed or not received_seats.get(p):
                    continue
                if not any(mm == m and pp == p for (mm, pp, _) in out.in_population):
                    continue
                total = sum((v for (pp, _), v in share.items() if pp == p), Fraction(0))
                if total < 1:
                    persons.add(p)
            persons = frozenset(persons)
        out.floor_persons[m] = persons
        out.fixed_holders[m] = frozenset(fixed)
        floor = {}
        for p in sorted(persons):
            if received_seats.get(p):
                _, sid, role, line = min(received_seats[p])
                floor[(sid, role, p)] = line
                out.floor_seat[(m, p)] = (sid, role)
        # final pass with floor set-asides applied together
        for s, kept, second, pop, rules, q, pi, cls in passes:
            seat_start = len(out.seats)
            for role, h in second:
                k = role_key(s.day, role)
                out.set_asides.append({"service": s.id, "role": role, "key": k, "person": h, "reason": "second_seat"})
                out.seats.append((s.id, role, h, "set_aside:second_seat"))
            final = {}
            for (role, h), (kind, what) in cls.items():
                if kind in ("normal", "presence") and (s.id, role, h) in floor:
                    final[(role, h)] = ("set_aside", "floor")
                else:
                    final[(role, h)] = (kind, what)
            for role, h in kept:
                kind, what = final[(role, h)]
                k = role_key(s.day, role)
                if kind == "set_aside":
                    out.set_asides.append({"service": s.id, "role": role, "key": k, "person": h, "reason": what})
                    out.seats.append((s.id, role, h, f"set_aside:{what}"))
                else:
                    line = what if kind == "normal" else f"P:{what}"
                    out.received[(m, h, line)] += 1
                    out.seats.append((s.id, role, h, line))
            # conservation: independent sources. Share actually added to out.share vs the
            # seats actually recorded in out.seats for this service (FX-3 / LG-10).
            svc_seats = out.seats[seat_start:]
            role_of_key = {}
            for role, h in kept:
                role_of_key.setdefault(role_key(s.day, role), set()).add(role)
            for k, members in pop.items():
                pool = sum(1 for (role, h), (kind, what) in final.items()
                           if kind == "normal" and role_key(s.day, role) == k)
                added = Fraction(0)
                for p in members:
                    inc = Fraction(pool, len(members))
                    out.share[(m, p, LINE_OF_KEY[k])] += inc
                    added += inc
                roles = role_of_key.get(k, set())
                recorded = sum(1 for (_sid, role, _h, oc) in svc_seats
                               if role in roles and oc == LINE_OF_KEY[k])
                out.conservation.append((s.id, k, added, recorded))
            for rho, _ in rules:
                live = rho.id in pi and final[pi[rho.id]][0] == "presence"
                members = q[rho.id]
                added = Fraction(0)
                if live:
                    for p in members:
                        inc = Fraction(1, len(members))
                        out.share[(m, p, f"P:{rho.id}")] += inc
                        added += inc
                recorded = sum(1 for (_sid, _role, _h, oc) in svc_seats if oc == f"P:{rho.id}")
                out.conservation.append((s.id, f"P:{rho.id}", added, recorded))
    return out
