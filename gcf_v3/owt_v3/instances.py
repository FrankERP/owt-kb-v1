"""Rule instances (spec §5.4, §6.7; F15): one soft instance per rule scope, each with one
violation boolean in the model and a re-evaluation from the assignment for the report.

Rules see every weekend service, counted or not, and never a special (C5-3). Clamps
are applied before the solve (`Facts.clamped`); a presence rule with no member able to
hold a matching role at a service has no instance there and a notice instead.
"""

from dataclasses import dataclass, field
from typing import Optional, Tuple

from .vocab import add_days, role_key


@dataclass
class Instance:
    family: str  # count | pair | presence | consecutive | mandatory_lead
    rule: str  # the request rule id, or "mandatory_lead"
    terms: Tuple = ()  # cells; for consecutive, the first weekend's cells
    terms_b: Tuple = ()  # consecutive: the second weekend's cells
    const_a: int = 0  # consecutive: prior constants
    const_b: int = 0
    op: Optional[str] = None
    limit: Optional[int] = None
    person: Optional[str] = None
    persons: Optional[Tuple[str, ...]] = None
    month: Optional[str] = None
    service: Optional[str] = None
    weekends: Optional[Tuple[str, str]] = None
    extra: dict = field(default_factory=dict)

    def observed(self, assigned):
        return sum(1 for c in self.terms if c in assigned)

    def broken(self, assigned):
        n = self.observed(assigned)
        if self.family == "count":
            return {"==": n != self.limit, "<=": n > self.limit, ">=": n < self.limit}[self.op]
        if self.family == "pair":
            return n >= 2
        if self.family in ("presence", "mandatory_lead"):
            return n == 0
        b = sum(1 for c in self.terms_b if c in assigned)
        return (n + self.const_a) >= 1 and (b + self.const_b) >= 1


def build_instances(F):
    """Every instance in a canonical order, plus presence_not_applicable notices."""
    P = F.P
    out, notices = [], []
    for r in P.counts:
        terms = tuple(c for c in F.cells if F.svc[c[0]].month == r.month and F.svc[c[0]].weekend
                      and c[2] == r.person and F.key(c[0], c[1]) in r.roles)
        out.append(Instance("count", r.id, terms, op=r.op, limit=F.clamped[r.index],
                            person=r.person, month=r.month))
    for r in P.pairs:
        for s in F.services:
            if not s.weekend or (r.month is not None and s.month != r.month):
                continue
            ta = [c for c in F.cells_at[s.id] if c[2] == r.persons[0] and F.key(s.id, c[1]) in r.roles]
            tb = [c for c in F.cells_at[s.id] if c[2] == r.persons[1] and F.key(s.id, c[1]) in r.roles]
            if ta and tb:
                out.append(Instance("pair", r.id, tuple(ta + tb), persons=tuple(r.persons),
                                    service=s.id, month=s.month))
    for r in P.presence:
        for s in F.services:
            if not s.weekend or (r.month is not None and s.month != r.month):
                continue
            if not any(role_key(s.day, role) in r.roles for role in s.roles):
                continue
            terms = tuple(c for c in F.cells_at[s.id] if c[2] in r.persons and F.key(s.id, c[1]) in r.roles)
            eligible = any(F.eligible(p, s.id, role) for p in r.persons for role in s.roles
                           if role_key(s.day, role) in r.roles)
            if not terms and not eligible:
                notices.append({"code": "presence_not_applicable", "params": {"rule": r.id, "service": s.id}})
                continue
            # At a fixed service a member's eligibility gives her no seat: the stored seats (pins) decide.
            out.append(Instance("presence", r.id, terms, persons=tuple(r.persons), service=s.id, month=s.month,
                                extra={"fixed": s.fixed}))
    for r in P.consecutive:
        weeks = F.weekend_terms(r.person, r.roles)
        for w in sorted(weeks):
            nxt = add_days(w, 7)
            if nxt not in weeks:
                continue
            (ca, ka), (cb, kb) = weeks[w], weeks[nxt]
            if not (ca or cb):
                continue  # both weekends entirely before the horizon
            if (ca or ka) and (cb or kb):
                out.append(Instance("consecutive", r.id, tuple(ca), tuple(cb), ka, kb,
                                    person=r.person, weekends=(w, nxt)))
    for s in F.services:
        if s.fixed or not s.weekend or "Lead" not in s.roles:
            continue
        terms = tuple(c for c in F.cells_at[s.id] if c[1] == "Lead")
        if terms:
            out.append(Instance("mandatory_lead", "mandatory_lead", terms, service=s.id, month=s.month))
    return out, notices


def _possible(F, cell):
    """An unpinned cell that pins alone do not rule out (person free at the service, room in the row)."""
    sid, role, p = cell
    if (sid, p) in F.pin_of:
        return False
    return F.row_size[(sid, role)] - len(F.pin_rows.get((sid, role), ())) > 0


def _blocked_by_pin(F, cell):
    sid, role, p = cell
    if cell in F.pinned:
        return False
    row_full_of_pins = bool(F.pin_rows.get((sid, role))) and (
        F.row_size[(sid, role)] - len(F.pin_rows[(sid, role)]) <= 0)
    return (sid, p) in F.pin_of or row_full_of_pins


def cause(F, inst):
    """`pins` when the pinned seats and the prior constants alone break the instance (§8.1)."""
    pinned = [c for c in inst.terms if c in F.pinned]
    lo = len(pinned) + inst.const_a
    possible = {(c[0], c[2]) for c in inst.terms if c not in F.pinned and _possible(F, c)}
    hi = lo + len(possible)
    involved = lo > 0 or any(_blocked_by_pin(F, c) for c in inst.terms)
    if inst.family == "count":
        lim = inst.limit
        alone = {"==": lo > lim or hi < lim, "<=": lo > lim, ">=": hi < lim}[inst.op]
    elif inst.family == "pair":
        alone = lo >= 2
    elif inst.family in ("presence", "mandatory_lead"):
        alone = hi == 0
        involved = involved or bool(inst.extra.get("fixed"))
    else:
        lo_b = sum(1 for c in inst.terms_b if c in F.pinned) + inst.const_b
        alone = lo >= 1 and lo_b >= 1
        involved = involved or lo_b > 0
    return "pins" if alone and involved else "forced"


def violation_entry(F, inst, assigned):
    entry = {"code": inst.family, "rule": inst.rule, "cause": cause(F, inst)}
    if inst.family == "count":
        entry.update(person=inst.person, month=inst.month, observed=inst.observed(assigned), limit=inst.limit)
    elif inst.family in ("pair", "presence"):
        entry.update(persons=list(inst.persons), service=inst.service, month=inst.month)
    elif inst.family == "consecutive":
        entry.update(person=inst.person, weekends=list(inst.weekends))
    else:
        entry.update(service=inst.service, month=inst.month)
    return entry
