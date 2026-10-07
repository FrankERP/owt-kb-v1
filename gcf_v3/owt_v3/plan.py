"""Planned shares (F13; spec §6.2 «F6 in the plan», §6.3 «Set-asides in the plan», §6.4
«In the plan», §6.5, C5-9, C5-15).

Fixed numbers from the request alone, computed before the solve. Nothing here reads an
assignment. Floor persons are found in a first pass without floor set-asides; shares
are then recomputed with them. Exact `Fraction`s; the caller rounds once (C5-8).

One reading the spec leaves to the plan: a pinned seat that will be a rule's presence
seat (a member's pin in one of the rule's role keys that is not a fixed seat) IS that
rule's forced presence seat, so it is removed from the pool once, not twice.

Amendment F-1 (a) (Frank's ruling at the F13 gate): an exact rule WITH slack spreads its F6
exit the way C5-9 spreads its set-aside — at each target service she weighs
1 − remainder/|targets| in the other role keys' populations, and a pool is shared in
proportion to the weights. Without it the realised exit (C2 LG-8 (vii)) is invisible to the
plan and the F13 gap exceeds half a seat.
"""

from collections import defaultdict
from dataclasses import dataclass, field
from fractions import Fraction
from typing import Dict, FrozenSet, Tuple

from .vocab import LINE_OF_KEY, ROLE_RANK, role_key, seat_order_key


@dataclass
class PlanResult:
    share: Dict[Tuple[str, str, str], Fraction] = field(default_factory=lambda: defaultdict(Fraction))
    floor_persons: Dict[str, FrozenSet[str]] = field(default_factory=dict)
    in_population: set = field(default_factory=set)  # (m, p, line)
    clamped_lines: set = field(default_factory=set)  # (p, line)

    def planned(self, person, line):
        """The exact planned share of a person-line over the horizon."""
        if getattr(self, "_totals", None) is None:
            self._totals = defaultdict(Fraction)
            for (m, p, l), v in self.share.items():
                self._totals[(p, l)] += v
        return self._totals.get((person, line), Fraction(0))


def _spread(sa, services_roles, amount):
    """Spread `amount` evenly over services, then equally over each service's keys."""
    if amount <= 0 or not services_roles:
        return
    per_service = Fraction(amount) / len(services_roles)
    for sid, keys in services_roles:
        for k in keys:
            sa[(sid, k)] += per_service / len(keys)


def compute_plan(F):
    P = F.P
    res = PlanResult()
    counted = [s for s in F.services if s.counts]
    pop, q, sub_pool, rules_at = {}, {}, {}, {}
    # ── decided seats (F6 in the plan): pins, and exact rules with no slack ──
    decided = defaultdict(set)  # (sid, p) -> role keys she is decided to hold there
    for (sid, p), role in F.pin_of.items():
        decided[(sid, p)].add(F.key(sid, role))
    for r in P.counts:
        c = F.clamped[r.index]
        if r.op != "==" or c < 1 or c != F.available[r.index]:
            continue
        for s in F.services:
            if s.month != r.month or not s.weekend:
                continue
            keys = {role_key(s.day, role) for role in s.roles
                    if role_key(s.day, role) in r.roles and (s.id, role, r.person) in F.cell_set}
            if keys and (s.id, r.person) not in F.pin_of:
                decided[(s.id, r.person)] |= keys
    # ── populations ───────────────────────────────────────────────────────
    for s in counted:
        base_pop, base_q, rules = F.realised_populations(s)
        rules_at[s.id] = rules
        for role in s.roles:
            k = s.key(role)
            pop[(s.id, k)] = tuple(
                p for p in base_pop.get(k, ())
                if not decided.get((s.id, p)) or k in decided[(s.id, p)])
            for p in pop[(s.id, k)]:
                res.in_population.add((s.month, p, LINE_OF_KEY[k]))
        for rho, _ in rules:
            q[(s.id, rho.id)] = base_q[rho.id]
            for p in base_q[rho.id]:
                res.in_population.add((s.month, p, f"P:{rho.id}"))
    # ── set-asides that do not depend on floor persons ─────────────────────
    sa = defaultdict(Fraction)  # (sid, key) -> seats
    weight = defaultdict(lambda: Fraction(1))  # (sid, key, p) -> population membership weight
    received_pins = defaultdict(list)  # (m, p) -> [(order, sid, key, kind, rho_id)]
    fixed_pin = set()  # (m, p) holding a pinned seat set aside (a) exact or (b) cadence
    for s in counted:
        fm = F.fmonths[s.month]
        consumed = set()
        for rho, a in rules_at[s.id]:
            cands = sorted(
                (ROLE_RANK[role], p, role)
                for role in s.roles for p in F.pin_rows.get((s.id, role), ())
                if s.key(role) in a and p in rho.members
                and not fm.is_fixed_seat(p, s.key(role)) and (role, p) not in consumed)
            if cands:
                _, p, role = cands[0]
                consumed.add((role, p))
                sa[(s.id, s.key(role))] += 1
                live = p in q[(s.id, rho.id)]
                sub_pool[(s.id, rho.id)] = 1 if live else 0
                if live:
                    received_pins[(s.month, p)].append(
                        (seat_order_key(s.date, role, s.time, s.id), s.id, s.key(role), "presence", rho.id))
            elif s.fixed:
                sub_pool[(s.id, rho.id)] = 0  # a fixed service holds exactly its pins: no seat can be forced
            else:
                keys = [k for k in a if any(fm.base_in(m, F.fservice_base[s.id], k) for m in q[(s.id, rho.id)])]
                for k in keys:
                    sa[(s.id, k)] += Fraction(1, len(keys))
                sub_pool[(s.id, rho.id)] = 1 if keys else 0
        for role in s.roles:
            k = s.key(role)
            for p in F.pin_rows.get((s.id, role), ()):
                if fm.is_fixed_seat(p, k):
                    fixed_pin.add((s.month, p))
                if (role, p) in consumed:
                    continue
                if p not in pop[(s.id, k)]:
                    sa[(s.id, k)] += 1
                else:
                    received_pins[(s.month, p)].append(
                        (seat_order_key(s.date, role, s.time, s.id), s.id, k, "normal", None))
    # monthly set-asides (C5-9): exact counts, then cadence Sundays
    for r in P.counts:
        if r.op != "==":
            continue
        c = F.clamped[r.index]
        if c < r.value:
            for k in r.roles:
                res.clamped_lines.add((r.person, LINE_OF_KEY[k]))
        pinned = sum(1 for pin in P.pins if pin.person == r.person and F.svc[pin.service].month == r.month
                     and F.svc[pin.service].weekend and F.key(pin.service, pin.role) in r.roles)
        targets = []
        for s in F.services:
            if s.month != r.month or not s.weekend or s.fixed or (s.id, r.person) in F.pin_of:
                continue
            keys = [s.key(role) for role in s.roles
                    if s.key(role) in r.roles and F.eligible(r.person, s.id, role)]
            if keys:
                targets.append((s.id, keys))
        _spread(sa, targets, max(0, c - pinned))
        remainder = max(0, c - pinned)
        for sid, keys in targets:  # the F6 exit, spread like the set-aside (spec §6.2 as amended, F-1 (a))
            sv = F.svc[sid]
            for role in sv.roles:
                if sv.key(role) not in keys:
                    weight[(sid, sv.key(role), r.person)] *= 1 - Fraction(remainder, len(targets))
    for p in F.pids:
        for m in F.months:
            if F.cadence_state(p, m) != "on":
                continue
            pinned = sum(1 for pin in P.pins if pin.person == p and pin.role == "Lead"
                         and F.svc[pin.service].month == m and F.svc[pin.service].counts
                         and F.svc[pin.service].day == "Sun")
            targets = [(s.id, ["Sun.Lead"]) for s in counted
                       if s.month == m and s.kind == "sunday" and not s.fixed
                       and (s.id, p) not in F.pin_of and F.eligible(p, s.id, "Lead")]
            _spread(sa, targets, max(0, 1 - pinned))

    def shares(extra_sa, dropped_sub):
        out = defaultdict(Fraction)
        for s in counted:
            for role in s.roles:
                k = s.key(role)
                members = pop[(s.id, k)]
                base = F.row_size[(s.id, role)]
                pool = max(Fraction(0), base - sa[(s.id, k)] - extra_sa[(s.id, k)])
                total = sum((weight[(s.id, k, p)] for p in members), Fraction(0))
                for p in members:
                    out[(s.month, p, LINE_OF_KEY[k])] += pool * weight[(s.id, k, p)] / total
            for rho, _ in rules_at[s.id]:
                members = q[(s.id, rho.id)]
                if members and sub_pool.get((s.id, rho.id)) and (s.id, rho.id) not in dropped_sub:
                    for p in members:
                        out[(s.month, p, f"P:{rho.id}")] += Fraction(1, len(members))
        return out

    first = shares(defaultdict(Fraction), set())
    # ── floor persons (§6.4 «In the plan», C5-15) ─────────────────────────
    plan_fixed = set(fixed_pin)
    for r in P.counts:
        if r.op == "==" and F.clamped[r.index] >= 1:
            plan_fixed.add((r.month, r.person))
    for p in F.pids:
        for m in F.months:
            if F.cadence_state(p, m) == "on":
                plan_fixed.add((m, p))
    floor_sa, dropped_sub = defaultdict(Fraction), set()
    for m in F.months:
        persons = set()
        for p in F.pids:
            if F.people[p].exempt or (m, p) in plan_fixed:
                continue
            if not any(mm == m and pp == p for (mm, pp, _) in res.in_population):
                continue
            total = sum((v for (mm, pp, _), v in first.items() if mm == m and pp == p), Fraction(0))
            if total < 1:
                persons.add(p)
        res.floor_persons[m] = frozenset(persons)
        for p in sorted(persons):
            if received_pins.get((m, p)):
                _, sid, k, kind, rho_id = min(received_pins[(m, p)])
                if kind == "presence":
                    dropped_sub.add((sid, rho_id))
                else:
                    floor_sa[(sid, k)] += 1
                continue
            targets = []
            for s in counted:
                if s.month != m or s.fixed or (s.id, p) in F.pin_of:
                    continue
                keys = [s.key(role) for role in s.roles if F.eligible(p, s.id, role)]
                if keys:
                    targets.append((s.id, keys))
            _spread(floor_sa, targets, 1)
    res.share = shares(floor_sa, dropped_sub)
    return res
