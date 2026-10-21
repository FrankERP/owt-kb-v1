"""Solver v4 prototype — «el más cercano al centro», multidimensional (EXPERIMENT, never deployed).

Frank's idea (2026-10-21): pick who serves the way a KNN picks neighbours, the distance being how
much each person has already served. With one dimension that is «fewest participations first»;
this prototype is the multidimensional version discussed in the thread:

- one dimension per line (DL, SL, BGV, presence sub-lines, CORO) measured as DEBT — what the
  ledger says she is owed (carried + planned share) minus what she has received so far — so
  someone who can serve rarely is not «always closest»;
- a TOTAL dimension (her shares summed), as v3's Total stage (ADR-0058);
- a FUTURE-SCARCITY dimension: how many still-open seats she is one of the few people able to
  fill, and would be unable to fill after taking this one (caps, cadence, no consecutive Sundays);
- OBLIGATIONS first (minimums/exact rules, cadence «on», compensation Saturday, voice and DL
  floors, presence rules) by how few chances are left to meet them.

The dimensions are compared in PRIORITY order (a sort key), never added with weights: weights are
what broke v2 (ADR-0038). Seats are taken most-constrained first, not by date.

It reads the same request as v3 and answers with the same response (the report is v3's own
`Report`, re-evaluated from the assignment), so v3's independent checker and acceptance harness
judge both engines with one ruler. It reuses v3's request parsing, facts, planned shares and rule
instances on purpose: what is under test is the DECISION method, not the input plumbing.
"""

import os
import random
import sys
import time
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "..", "gcf_v3"))

from owt_v3.constants import CONTRACT, SCALE  # noqa: E402
from owt_v3.facts import Facts  # noqa: E402
from owt_v3.instances import build_instances  # noqa: E402
from owt_v3.plan import compute_plan  # noqa: E402
from owt_v3.report import Report  # noqa: E402
from owt_v3.request import parse_request  # noqa: E402
from owt_v3.rounding import hundredths  # noqa: E402
from owt_v3.vocab import LINE_OF_KEY, ROLE_RANK, add_days, weekend_of  # noqa: E402

ENGINE = "v4-knn-prototype"

# Feasibility levels: a candidate must pass every check up to the level the seat is filled at.
STRICT, NO_PROTECTIONS = 0, 1


class Greedy:
    def __init__(self, problem, debt_step=0, use_scarcity=True, use_obligations=True, by_constraint=True,
                 one_dimension=False, improve=False):
        self.P = problem
        self.F = F = Facts(problem)
        self.plan = compute_plan(F)
        self.instances, self.notices = build_instances(F)
        self.rng = random.Random(problem.seed)
        self.debt_step = debt_step
        self.use_scarcity, self.use_obligations, self.by_constraint = use_scarcity, use_obligations, by_constraint
        self.improve = improve  # beyond the KNN idea: a local search after the greedy
        self.one_dimension = one_dimension  # Frank's first version: fewest participations so far, nothing else

        # ── the dimensions' targets ─────────────────────────────────────────────
        self.K = {}  # (p, line) -> carried + planned, hundredths
        lines_of = defaultdict(set)
        for (_, p, line) in self.plan.in_population:
            lines_of[p].add(line)
        for p in F.pids:
            for line in lines_of[p] | set(F.people[p].carried):
                self.K[(p, line)] = F.people[p].carried.get(line, 0) + hundredths(self.plan.planned(p, line))
        self.K_total = {p: hundredths(sum((self.plan.planned(p, l) for l in lines_of[p]), 0)) for p in F.pids}
        self.presence_line = {}  # (sid, person, role key) -> "P:<id>"
        for s in F.services:
            for rho in F.presence_rules_at(s):
                for p in rho.persons:
                    if (p, f"P:{rho.id}") in self.K:
                        for key in rho.roles:
                            self.presence_line.setdefault((s.id, p, key), f"P:{rho.id}")

        # ── rule instances indexed by cell ───────────────────────────────────────
        self.count_of_cell, self.pair_of_cell = defaultdict(list), defaultdict(list)
        self.cons_a, self.cons_b = defaultdict(list), defaultdict(list)
        self.presence_of_service = defaultdict(list)
        for inst in self.instances:
            if inst.family == "count":
                for c in inst.terms:
                    self.count_of_cell[c].append(inst)
            elif inst.family == "pair":
                for c in inst.terms:
                    self.pair_of_cell[c].append(inst)
            elif inst.family == "consecutive":
                for c in inst.terms:
                    self.cons_a[c].append(inst)
                for c in inst.terms_b:
                    self.cons_b[c].append(inst)
            elif inst.family == "presence":
                self.presence_of_service[inst.service].append(inst)
        self.obs = defaultdict(int)  # id(inst) -> seats held among its terms (side a for consecutive)
        self.obs_b = defaultdict(int)
        self.f9 = set(F.f9_instances())
        self.f10 = set(F.f10_instances())

        # ── running state ────────────────────────────────────────────────────────
        self.assigned = set()
        self.at = defaultdict(set)  # sid -> people seated
        self.L, self.S, self.V = defaultdict(int), defaultdict(int), defaultdict(int)
        self.n = defaultdict(int)  # (p, line) -> seats received on the line
        self.n_total = defaultdict(int)
        self.led_weekends = defaultdict(int)  # (p, weekend Sunday) -> counted Sunday leads
        for p in F.pids:
            for w, (_, const) in F.weekend_terms(p, (), counted_only=True, dl_only=True).items():
                if const:
                    self.led_weekends[(p, w)] += 1
        self.cells_by_row = defaultdict(list)
        for c in F.cells:
            self.cells_by_row[(c[0], c[1])].append(c)
        self.open = {}  # (sid, role) -> seats still to fill
        for pin in F.pinned:
            self._apply(pin)
        for s in F.services:
            if s.fixed:
                continue
            for role in s.roles:
                left = F.row_size[(s.id, role)] - len(F.pin_rows.get((s.id, role), ()))
                if left > 0:
                    self.open[(s.id, role)] = left
        self.relaxed = 0
        self.trace = None  # a list to record each decision (debugging)

    # ── bookkeeping ─────────────────────────────────────────────────────────────
    def line_of(self, c):
        sid, role, p = c
        F, s = self.F, self.F.svc[c[0]]
        if not s.counts:
            return None
        key = F.key(sid, role)
        if F.fmonths[s.month].is_fixed_seat(p, key):
            return None  # exact / cadence seats are set aside from the balance
        return self.presence_line.get((sid, p, key), LINE_OF_KEY[key])

    def _apply(self, c, sign=1):
        sid, role, p = c
        s = self.F.svc[sid]
        if sign > 0:
            self.assigned.add(c)
            self.at[sid].add(p)
        else:
            self.assigned.discard(c)
            self.at[sid].discard(p)
        for inst in self.count_of_cell[c] + self.pair_of_cell[c] + self.cons_a[c]:
            self.obs[id(inst)] += sign
        for inst in self.cons_b[c]:
            self.obs_b[id(inst)] += sign
        if s.counts:
            self.V[(p, s.month)] += sign
            if role == "Lead" and s.day == "Sun":
                self.L[(p, s.month)] += sign
                self.led_weekends[(p, weekend_of(s.date))] += sign
            elif role == "Lead":
                self.S[(p, s.month)] += sign
            line = self.line_of(c)
            if line is not None:
                self.n[(p, line)] += sign
                self.n_total[p] += sign

    def _floor_lines(self, p):
        """The lines of her floor seats: a floor person's first counted seat of each month is set
        aside from the balance (her planned share already leaves it out — C5's floor rule)."""
        out = []
        for m, people in self.plan.floor_persons.items():
            if p not in people or not self.V[(p, m)]:
                continue
            mine = [c for c in self.assigned if c[2] == p and self.F.svc[c[0]].counts and self.F.svc[c[0]].month == m
                    and self.line_of(c)]
            if mine:
                first = min(mine, key=lambda c: (self.F.svc[c[0]].date, ROLE_RANK[c[1]], c[0]))
                out.append(self.line_of(first))
        return out

    def received(self, p, line):
        return self.n[(p, line)] - self._floor_lines(p).count(line)

    def received_total(self, p):
        return self.n_total[p] - len(self._floor_lines(p))

    # ── feasibility ─────────────────────────────────────────────────────────────
    def feasible(self, c, level=STRICT):
        sid, role, p = c
        F, s = self.F, self.F.svc[sid]
        if c not in F.cell_set or s.fixed or p in self.at[sid]:
            return False
        for inst in self.count_of_cell[c]:
            if inst.op in ("<=", "==") and self.obs[id(inst)] + 1 > inst.limit:
                return False
        for inst in self.pair_of_cell[c]:
            if self.obs[id(inst)] >= 1:
                return False
        for inst in self.cons_a[c]:
            if self.obs_b[id(inst)] + inst.const_b >= 1:
                return False
        for inst in self.cons_b[c]:
            if self.obs[id(inst)] + inst.const_a >= 1:
                return False
        sun_lead = s.counts and role == "Lead" and s.day == "Sun"
        sat_lead = s.counts and role == "Lead" and s.day == "Sat"
        state = F.cadence_state(p, s.month)
        if sun_lead and state == "off":
            return False
        if sun_lead and state == "on" and self.L[(p, s.month)] >= 1:
            return False
        if not self._keeps_presence(c):
            return False
        if level >= NO_PROTECTIONS:
            return True
        if sun_lead and not F.is_exact(p, s.month, "Sun.Lead") and self.L[(p, s.month)] >= 1:
            return False
        if sat_lead and not F.is_exact(p, s.month, "Sat.Lead") and self.S[(p, s.month)] >= 1:
            return False
        if sun_lead:
            w = weekend_of(s.date)
            if self.led_weekends[(p, add_days(w, -7))] or self.led_weekends[(p, add_days(w, 7))]:
                return False
        return True

    def _keeps_presence(self, c):
        """Taking `c` must leave every unmet presence rule at that service still meetable."""
        sid, role, p = c
        for inst in self.presence_of_service[sid]:
            if c in inst.terms or any(t in self.assigned for t in inst.terms):
                continue
            ok = False
            for t in inst.terms:
                left = self.open.get((t[0], t[1]), 0) - (1 if t[1] == role else 0)
                if t[2] != p and left > 0 and self.feasible(t, NO_PROTECTIONS):
                    ok = True
                    break
            if not ok:
                return False
        return True

    def candidates(self, row, level=STRICT):
        return [c for c in self.cells_by_row[row] if self.feasible(c, level)]

    # ── the dimensions ──────────────────────────────────────────────────────────
    def _chances(self, p, pred, sundays=False):
        """Distinct open services where she could still take a seat matching `pred`. Sunday Leads
        cannot be on consecutive weekends, so for them it is the most non-adjacent Sundays."""
        sids = sorted({sid for (sid, role) in self.open if pred(sid, role) and self.feasible((sid, role, p))},
                      key=lambda x: self.F.svc[x].date)
        if not sundays:
            return len(sids) or 1
        n, last = 0, None
        for sid in sids:
            w = weekend_of(self.F.svc[sid].date)
            if last is None or w > add_days(last, 7):
                n, last = n + 1, w
        return n or 1

    def pressure(self, c):
        """The most urgent obligation this seat meets: need / chances left (≥ 1 = now or never)."""
        sid, role, p = c
        F, s = self.F, self.F.svc[sid]
        best = 0.0
        for inst in self.count_of_cell[c]:
            if inst.op in (">=", "==") and self.obs[id(inst)] < inst.limit:
                terms = set(inst.terms)
                need = inst.limit - self.obs[id(inst)]
                only_sun_lead = all(F.key(t[0], t[1]) == "Sun.Lead" for t in terms)
                best = max(best, need / self._chances(p, lambda x, r: (x, r, p) in terms, only_sun_lead))
        if not s.counts:
            return best
        m = s.month
        sun = lambda x, r: r == "Lead" and F.svc[x].day == "Sun" and F.svc[x].counts and F.svc[x].month == m
        sat = lambda x, r: r == "Lead" and F.svc[x].day == "Sat" and F.svc[x].counts and F.svc[x].month == m
        state = F.cadence_state(p, m)
        if sun(sid, role):
            if state == "on" and self.L[(p, m)] == 0:
                best = max(best, 1 / self._chances(p, sun, True))
            if (p, m) in self.f10 and self.L[(p, m)] == 0:
                prev = min(F.people[p].prev_dl_leads, 1) if m == F.months[0] else self.L[(p, F.months[0])]
                if prev == 0:
                    best = max(best, 1 / self._chances(p, sun, True))
        if sat(sid, role) and state == "off" and self.L[(p, m)] == 0 and self.S[(p, m)] == 0:
            best = max(best, 1 / self._chances(p, sat))
        if (p, m) in self.f9 and self.V[(p, m)] == 0:
            best = max(best, 1 / self._chances(p, lambda x, r: F.svc[x].counts and F.svc[x].month == m))
        for inst in self.presence_of_service[sid]:
            if c in inst.terms and not any(t in self.assigned for t in inst.terms):
                terms = set(inst.terms)
                left = sum(1 for (x, r) in self.open if x == sid
                           for q in inst.persons if (x, r, q) in terms and self.feasible((x, r, q)))
                best = max(best, 1 / max(left, 1))
        return best

    def _impossible_obligations(self, p):
        """How many of her own minimum / exact rules can no longer be met with the seats left."""
        n = 0
        for inst in self.instances:
            if inst.family != "count" or inst.person != p or inst.op not in (">=", "=="):
                continue
            need = inst.limit - self.obs[id(inst)]
            if need <= 0:
                continue
            terms = set(inst.terms)
            only_sun_lead = all(self.F.key(t[0], t[1]) == "Sun.Lead" for t in terms)
            sids = {t[0] for t in terms if (t[0], t[1]) in self.open and self.feasible(t)}
            if not sids:
                n += 1
            elif need > self._chances(p, lambda x, r: (x, r, p) in terms, only_sun_lead):
                n += 1
        return n

    def scarcity(self, c):
        """(seats it would leave short, seats it makes scarcer): what taking `c` costs the rest."""
        sid, role, p = c
        affected = [(row, len(self.candidates(row))) for row in self.open
                    if row != (sid, role) and row[0] != sid and self.feasible((row[0], row[1], p))]
        before_own = self._impossible_obligations(p)
        self._apply(c)
        self.open[(sid, role)] -= 1
        own = self._impossible_obligations(p) - before_own
        self.open[(sid, role)] += 1
        short, scarcer = 0, 0.0
        for row, before in affected:
            if not self.feasible((row[0], row[1], p)):
                spare = before - self.open[row]
                if spare <= 0:
                    short += 1
                scarcer += 1 / max(spare, 1)
        self._apply(c, -1)
        return max(own, 0), short, scarcer

    def key(self, c):
        _, _, p = c
        if self.one_dimension:
            served = sum(v for (q, _), v in self.n.items() if q == p) + self.F.people[p].prev_dl_leads * 0
            return (-served, self.rng.random())
        line = self.line_of(c)
        debt = (self.K.get((p, line), 0) - SCALE * self.received(p, line)) / SCALE if line else 0.0
        total = (self.K_total.get(p, 0) - SCALE * self.received_total(p)) / SCALE
        press = self.pressure(c) if self.use_obligations else 0.0
        urgency = 2 if press >= 1 else 1 if press >= 0.5 else 0
        own, short, scarcer = self.scarcity(c) if self.use_scarcity else (0, 0, 0.0)
        bucket = int(debt // self.debt_step) if self.debt_step else debt
        # Higher is better, compared left to right: not ruining her own minimum, obligations, then not
        # starving another seat,
        # then the line debt (coarse), then sparing scarce people, then the Total, then exact debt.
        return (-own, urgency, -short, bucket, -scarcer, total, debt, self.rng.random())

    # ── the fill ────────────────────────────────────────────────────────────────
    def next_row(self):
        def order(row):
            sid, role = row
            slack = len(self.candidates(row)) - self.open[row]
            first = slack if self.by_constraint else 0
            return (first, ROLE_RANK[role], self.F.svc[sid].date, sid)
        return min(self.open, key=order)

    def solve(self):
        while self.open:
            row = self.next_row()
            cands = self.candidates(row)
            if not cands:
                cands = self.candidates(row, NO_PROTECTIONS)
                if cands:
                    self.relaxed += 1
            if not cands:
                del self.open[row]  # left empty: nobody can take it without breaking a rule
                continue
            ranked = sorted(cands, key=self.key, reverse=True)
            best = ranked[0]
            if self.trace is not None:
                self.trace.append((row, [(c[2], self.key(c)) for c in ranked[:4]]))
            self._apply(best)
            self.open[row] -= 1
            if not self.open[row]:
                del self.open[row]
        if self.improve:
            self.improve_by_swaps()
        return {c: 1 if c in self.assigned else 0 for c in self.F.cells}

    # ── optional: improvement by exchanges (beyond KNN — a local search) ─────────
    def _misses(self):
        F, out = self.F, 0
        for p in F.pids:
            for m in F.months:
                L, S = self.L[(p, m)], self.S[(p, m)]
                state = F.cadence_state(p, m)
                out += (state == "on" and L != 1) + (state == "off" and L > 0) + (state == "off" and L == 0 and S == 0)
                out += (p, m) in self.f9 and self.V[(p, m)] == 0
                if (p, m) in self.f10 and L == 0:
                    prev = min(F.people[p].prev_dl_leads, 1) if m == F.months[0] else self.L[(p, F.months[0])]
                    out += prev == 0
                out += L > 1 and not F.is_exact(p, m, "Sun.Lead")
                out += S > 1 and not F.is_exact(p, m, "Sat.Lead")
        led = [(p, w) for (p, w), v in list(self.led_weekends.items()) if v]
        out += sum(1 for (p, w) in led if self.led_weekends.get((p, add_days(w, 7))))
        return out

    def _hard_score(self):
        return (sum(1 for inst in self.instances if inst.broken(self.assigned)), self._misses())

    def _fair_score(self):
        lines = sum((k - SCALE * self.received(p, line)) ** 2 for (p, line), k in self.K.items())
        total = sum((k - SCALE * self.received_total(p)) ** 2 for p, k in self.K_total.items()
                    if not self.F.people[p].exempt)
        return (lines, total)

    def _ok_cell(self, c):
        sid, _, p = c
        return c in self.F.cell_set and not self.F.svc[sid].fixed and p not in self.at[sid]

    def improve_by_swaps(self, rounds=20):
        """Hill-climb: hand a seat to someone else, or trade two people's seats, whenever no rule or
        protection gets worse and the balance (lines first, then Total) improves."""
        hard, fair = self._hard_score(), self._fair_score()
        for _ in range(rounds):
            improved = False
            seated = sorted(c for c in self.assigned if c not in self.F.pinned)
            for c in seated:
                if c not in self.assigned:
                    continue
                sid, role, p = c
                for q in self.F.pids:
                    d = (sid, role, q)
                    if q == p:
                        continue
                    self._apply(c, -1)
                    if self._ok_cell(d):
                        self._apply(d)
                        h, f = self._hard_score(), self._fair_score()
                        if h <= hard and (h < hard or f < fair):
                            hard, fair, improved = h, f, True
                            break
                        self._apply(d, -1)
                    self._apply(c)
            seated = sorted(c for c in self.assigned if c not in self.F.pinned)
            for i, a in enumerate(seated):
                for b in seated[i + 1:]:
                    if a not in self.assigned or b not in self.assigned or a[2] == b[2] or a[0] == b[0]:
                        continue
                    a2, b2 = (a[0], a[1], b[2]), (b[0], b[1], a[2])
                    self._apply(a, -1)
                    self._apply(b, -1)
                    if self._ok_cell(a2):
                        self._apply(a2)
                        if self._ok_cell(b2):
                            self._apply(b2)
                            h, f = self._hard_score(), self._fair_score()
                            if h <= hard and (h < hard or f < fair):
                                hard, fair, improved = h, f, True
                                continue
                            self._apply(b2, -1)
                        self._apply(a2, -1)
                    self._apply(b)
                    self._apply(a)
            if not improved:
                break


def handle(body, **options):
    """Same contract as `owt_v3.service.handle`: (status, response, log)."""
    t0 = time.perf_counter()
    problem = parse_request(body)
    g = Greedy(problem, **options)
    values = g.solve()
    ceiling = sum(1 for inst in g.instances if inst.broken(g.assigned))
    report = Report(g.F, g.plan, g.instances, g.notices, [], values, ceiling)
    total_ms = int(round((time.perf_counter() - t0) * 1000))
    resp = {
        "ok": True, "contract": CONTRACT, "engine": ENGINE, "solver_version": "0",
        "build": "experiment", "request_id": problem.request_id, "seed": problem.seed,
        "months": list(problem.months), "reproducible": True,
        "assignments": report.assignment, "unfilled": report.unfilled(), "pins": report.pins(),
        "violations": report.violations(),
        "violation_ceiling": {"value": ceiling, "proven": False},
        "stages": [], "total_ms": total_ms, "fairness": report.fairness(), "cadence": report.cadence(),
        "missed": report.missed(), "notices": report.notices,
        "experiment": {"relaxed_protection_seats": g.relaxed},
    }
    return 200, resp, {"event": ENGINE, "total_ms": total_ms}
