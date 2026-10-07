"""The response (spec §8.1–§8.2, S4): built from the request, the plan and the returned
assignment — never from the model's flags. Violations and missed protections are
re-evaluated from the assignment (F15); fairness is the shared formula on it (F14).
"""

from collections import defaultdict
from fractions import Fraction

from .codes import code
from .constants import FAIRNESS_TOLERANCE, SCALE
from .formula import realised
from .instances import violation_entry
from .rounding import hundredths, tenths
from .vocab import add_days, add_months

MISSED_ORDER = ("cadence_on_missed", "cadence_off_led", "compensation_missed", "voice_floor_missed",
                "dl_floor_missed", "sunday_cap_exceeded", "saturday_cap_exceeded", "consecutive_sundays")


def assignment_of(F, values):
    """{sid: {role: [ids]}} with every request service and the roles it has (codepoint order)."""
    out = {}
    for s in F.services:
        out[s.id] = {role: sorted(c[2] for c in F.cells_at[s.id] if c[1] == role and values.get(c))
                     for role in s.roles}
    return out


class Report:
    def __init__(self, F, plan, instances, notices, records, values, ceiling):
        self.F, self.plan, self.instances = F, plan, instances
        self.records, self.values, self.ceiling = records, values, ceiling
        self.assigned = frozenset(c for c, v in values.items() if v)
        self.assignment = assignment_of(F, values)
        self.status = {r["id"]: r["status"] for r in records}
        capacity, population = F.dl_capacity()
        self.notices = []
        if population > capacity:
            self.notices.append({"code": code("notice", "dl_capacity"), "params": {
                "months": list(F.months), "seats": capacity, "people": population}})
        self.capacity_notice = population > capacity
        self.notices += F.clamp_notices + notices
        for n in self.notices:
            code("notice", n["code"])
        self.real = realised(F.fservices(self.assignment), F.fmonths)

    # ── counts on the assignment ────────────────────────────────────────────
    def _count(self, person, month, pred):
        return sum(1 for c in self.assigned if c[2] == person and pred(self.F.svc[c[0]], c[1])
                   and self.F.svc[c[0]].month == month)

    def L(self, p, m):
        return self._count(p, m, lambda s, r: s.counts and r == "Lead" and s.day == "Sun")

    def S(self, p, m):
        return self._count(p, m, lambda s, r: s.counts and r == "Lead" and s.day == "Sat")

    def V(self, p, m):
        return self._count(p, m, lambda s, r: s.counts)

    def pinned_count(self, p, m, pred):
        return sum(1 for (sid, role, q) in self.F.pinned if q == p and self.F.svc[sid].month == m
                   and pred(self.F.svc[sid], role))

    def slots(self, p, months, pred):
        """Her unpinned cells at counted non-fixed services that could meet a protection."""
        return [c for c in self.F.cells if c[2] == p and c not in self.F.pinned
                and self.F.svc[c[0]].month in months and self.F.svc[c[0]].counts
                and not self.F.svc[c[0]].fixed and pred(self.F.svc[c[0]], c[1])]

    def blocked_by_own_pins(self, p, slots):
        return bool(slots) and all((c[0], p) in self.F.pin_of for c in slots)

    def cause(self, stage, pins=False, rule=False, no_slot=False, capacity=False):
        if self.status.get(stage) != "proven":
            return "not_proven"
        if pins:
            return "pins"
        if rule:
            return "rule"
        if no_slot:
            return "unavailable"
        if capacity:
            return "capacity"
        return "higher_priority"

    # ── sections ────────────────────────────────────────────────────────────
    def unfilled(self):
        F, out = self.F, []
        seated = {(c[0], c[2]) for c in self.assigned}
        for s in F.services:
            if s.fixed:
                continue
            for role in s.roles:
                size = F.row_size[(s.id, role)]
                filled = len(self.assignment[s.id][role])
                if filled >= size:
                    continue
                cells = [c for c in F.cells_at[s.id] if c[1] == role]
                free = [c for c in cells if c not in F.pinned and (s.id, c[2]) not in seated]
                if role == "Lead" and not cells:
                    reason = "no_possible_lead"
                elif not free:
                    reason = "no_candidate"
                elif all(sum(1 for i in self.instances if i.broken(self.assigned | {c})) > self.ceiling
                         for c in free):
                    reason = "rules"
                else:
                    reason = "fill_not_proven"
                out.append({"service": s.id, "role": role, "count": size - filled,
                            "reason": code("unfilled_reason", reason)})
        return out

    def violations(self):
        return [violation_entry(self.F, i, self.assigned) for i in self.instances if i.broken(self.assigned)]

    def cadence(self):
        F, out = self.F, []
        for p in F.pids:
            for m in F.months:
                state = F.cadence_state(p, m)
                if state is None:
                    continue
                L, S = self.L(p, m), self.S(p, m)
                a = 1 if state == "on" else 0
                if state != "off" or L >= 1:
                    comp = "not_applicable"
                else:
                    comp = "given" if S >= 1 else "missed"
                out.append({"person": p, "month": m, "state": code("cadence_state", state),
                            "sundays": L, "saturdays": S, "met": L == a,
                            "compensation": code("compensation", comp)})
        return out

    def missed(self):
        F, out = self.F, defaultdict(list)
        sun = lambda s, r: r == "Lead" and s.day == "Sun"
        sat = lambda s, r: r == "Lead" and s.day == "Sat"
        for p in F.pids:
            for m in F.months:
                state = F.cadence_state(p, m)
                if state is None:
                    continue
                L, S = self.L(p, m), self.S(p, m)
                if state == "on" and L == 0:
                    slots = self.slots(p, (m,), sun)
                    out["cadence_on_missed"].append({"person": p, "month": m, "cause": self.cause(
                        "cadence", pins=self.blocked_by_own_pins(p, slots), no_slot=not slots)})
                if state in ("off", "out") and L >= 1:
                    out["cadence_off_led"].append({"person": p, "month": m, "cause": self.cause(
                        "cadence", pins=self.pinned_count(p, m, lambda s, r: s.counts and sun(s, r)) >= 1)})
                if state == "off" and L == 0 and S == 0:
                    slots = self.slots(p, (m,), sat)
                    out["compensation_missed"].append({"person": p, "month": m, "cause": self.cause(
                        "compensation", pins=self.blocked_by_own_pins(p, slots), no_slot=not slots)})
        for p, m in F.f9_instances():
            if self.V(p, m) == 0:
                slots = self.slots(p, (m,), lambda s, r: True)
                out["voice_floor_missed"].append({"person": p, "month": m, "cause": self.cause(
                    "voice_floor", pins=self.blocked_by_own_pins(p, slots), no_slot=not slots)})
        for p, m in F.f10_instances():
            first = m == F.months[0]
            prev = F.people[p].prev_dl_leads if first else self.L(p, F.months[0])
            if prev + self.L(p, m) == 0:
                months = (m,) if first else (F.months[0], m)
                slots = self.slots(p, months, sun)
                out["dl_floor_missed"].append({
                    "person": p, "month1": add_months(m, -1), "month2": m, "cause": self.cause(
                        "dl_floor", pins=self.blocked_by_own_pins(p, slots), no_slot=not slots,
                        capacity=self.capacity_notice)})
        for stage, key, counter, missed_code, pred in (
                ("sunday_cap", "Sun.Lead", self.L, "sunday_cap_exceeded", sun),
                ("saturday_cap", "Sat.Lead", self.S, "saturday_cap_exceeded", sat)):
            for p in F.pids:
                for m in F.months:
                    if F.is_exact(p, m, key):
                        continue
                    n = counter(p, m)
                    if n < 2:
                        continue
                    pins = self.pinned_count(p, m, lambda s, r: s.counts and pred(s, r)) >= 2
                    rule = any(r.person == p and r.month == m and r.op == ">=" and key in r.roles
                               and F.clamped[r.index] >= 2 for r in F.P.counts)
                    out[missed_code].append({"person": p, "month": m, "count": n,
                                             "cause": self.cause(stage, pins=pins, rule=rule)})
        horizon = {s.date for s in F.services}
        for p in F.pids:
            weeks = F.weekend_terms(p, (), counted_only=True, dl_only=True)
            for d in sorted(weeks):
                nxt = add_days(d, 7)
                if nxt not in weeks or nxt not in horizon:
                    continue
                (ca, ka), (cb, kb) = weeks[d], weeks[nxt]
                held_a = ka or any(c in self.assigned for c in ca)
                held_b = kb or any(c in self.assigned for c in cb)
                if held_a and held_b:
                    pins_a = ka or any(c in self.assigned and c in F.pinned for c in ca)
                    pins_b = kb or any(c in self.assigned and c in F.pinned for c in cb)
                    out["consecutive_sundays"].append({"person": p, "dates": [d, nxt], "cause": self.cause(
                        "no_consecutive", pins=bool(pins_a and pins_b))})
        result = []
        for c in MISSED_ORDER:
            for entry in out[c]:
                entry = {"code": code("missed", c), **entry}
                code("missed_cause", entry["cause"])
                result.append(entry)
        return result

    def fairness(self):
        F, plan, real = self.F, self.plan, self.real
        P = F.P
        share = defaultdict(Fraction)
        for (m, p, line), v in real.share.items():
            share[(p, line)] += v
        received = defaultdict(int)
        for (m, p, line), v in real.received.items():
            received[(p, line)] += v
        pinned, set_aside = defaultdict(int), defaultdict(int)
        for sid, role, p, outcome in real.seats:
            if outcome.startswith("set_aside:"):
                set_aside[(p, F.line(sid, role))] += 1
            elif (sid, role, p) in F.pinned:
                pinned[(p, outcome)] += 1
        populated = {(p, line) for (_, p, line) in plan.in_population | real.in_population}
        stage_set = {(p, line) for (_, p, line) in plan.in_population}
        stage_lines = list(P.lines)
        people = []
        for p in F.pids:
            person = F.people[p]
            names = [l for l in stage_lines if (p, l) in populated or l in person.carried or received[(p, l)]]
            extra = sorted(k for k in person.carried if k.startswith("P:") and k not in stage_lines)
            lines = {}
            for line in names + extra:
                lines[line] = line_figures(
                    carried=person.carried.get(line, 0), share=share[(p, line)], seats=received[(p, line)],
                    pinned_seats=pinned[(p, line)], set_aside_seats=set_aside[(p, line)],
                    planned=plan.planned(p, line), in_stage=(p, line) in stage_set and line in stage_lines,
                    clamped=(p, line) in plan.clamped_lines)
            tabs = tab_figures(lines, {l: share[(p, l)] for l in lines}, exempt=person.exempt)
            floor = []
            for m in F.months:
                seat = real.floor_seat.get((m, p))
                floor.append({"month": m, "planned": p in plan.floor_persons.get(m, ()),
                              "realised": p in real.floor_persons.get(m, ()),
                              "seat": {"service": seat[0], "role": seat[1]} if seat else None})
            people.append({"person": p, "floor": floor, "lines": lines, "tabs": tabs})
        return {"scale": SCALE, "tolerance": FAIRNESS_TOLERANCE, "lines": stage_lines, "people": people}

    def pins(self):
        return {"requested": len(self.F.P.pins),
                "honored": sum(1 for c in self.F.pinned if c in self.assigned)}


def line_figures(carried, share, seats, pinned_seats, set_aside_seats, planned, in_stage, clamped):
    """One person-line (§8.2): hundredths rounded once from the exact share; tenths rounded once
    from the same rational (never from the hundredths); `after` is the identity."""
    sh = hundredths(share)
    return {
        "carried": carried,
        "planned": hundredths(planned),
        "share": sh,
        "received": SCALE * seats,
        "pinned": SCALE * pinned_seats,
        "seats": seats,
        "pinned_seats": pinned_seats,
        "set_aside": SCALE * set_aside_seats,
        "after": carried + sh - SCALE * seats,
        "tenths": {"share": tenths(share), "after": tenths(Fraction(carried, SCALE) + share - seats)},
        "in_stage": in_stage,
        "clamped": clamped,
    }


TAB_LINES = {"DL": lambda l: l == "DL", "SL": lambda l: l == "SL",
             "BGV": lambda l: l == "BGV" or l.startswith("P:"), "CORO": lambda l: l == "CORO",
             "TOTAL": lambda l: True}


def tab_figures(lines, exact_shares, exempt):
    """The display tabs (§8.2, LG-14): sums of the lines' exact values, each figure rounded once from
    the exact sum — never summed from the lines' rounded figures. TOTAL is absent for an exempt person."""
    tabs = {}
    for tab, member in TAB_LINES.items():
        names = [l for l in lines if member(l)]
        if not names or (tab == "TOTAL" and exempt):
            continue
        carried = sum(lines[l]["carried"] for l in names)
        exact = sum((exact_shares[l] for l in names), Fraction(0))
        seats = sum(lines[l]["seats"] for l in names)
        pins = sum(lines[l]["pinned_seats"] for l in names)
        sh = hundredths(exact)
        tabs[tab] = {
            "carried": carried, "share": sh, "received": SCALE * seats, "pinned": SCALE * pins,
            "seats": seats, "pinned_seats": pins, "after": carried + sh - SCALE * seats,
            "tenths": {"share": tenths(exact), "after": tenths(Fraction(carried, SCALE) + exact - seats)},
        }
    return tabs
