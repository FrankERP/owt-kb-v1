"""The CP-SAT model (spec §6.1, §6.6, §6.7, §7.1): variables, hard constraints, one
violation boolean per rule instance, the counts the protections read, and the received
count per person and line that mirrors the shared formula on the same assignment.

How each objective is encoded is this module's choice; WHAT each stage minimises is the
spec's (§7.1). Variables are created in canonical order (services, roles, people).
"""

import random
from collections import defaultdict

from ortools.sat.python import cp_model

from .constants import SCALE
from .rounding import hundredths
from .vocab import LINE_OF_KEY, ROLE_RANK, add_days, seat_order_key


class Model:
    def __init__(self, F, plan, instances):
        self.F, self.plan, self.instances = F, plan, instances
        self.m = cp_model.CpModel()
        self.allvars = []
        self.x = {}
        self.decision = []
        for c in F.cells:
            v = self._bool("x")
            self.x[c] = v
            if c in F.pinned:
                self.m.Add(v == 1)
            else:
                self.decision.append(c)
        self._hard()
        self.viol = [(inst, self._soft(inst)) for inst in instances]
        self._counts()
        self._received()

    # ── helpers ──────────────────────────────────────────────────────────────
    def _bool(self, name):
        v = self.m.NewBoolVar(name)
        self.allvars.append(v)
        return v

    def _int(self, lo, hi, name):
        v = self.m.NewIntVar(lo, hi, name)
        self.allvars.append(v)
        return v

    def _sum(self, cells):
        return sum(self.x[c] for c in cells)

    def _first_set(self, lits):
        """For literals in order, booleans f_i = lit_i AND no earlier lit (first set bit)."""
        out, seen = [], None
        for lit in lits:
            f = self._bool("first")
            if seen is None:
                self.m.Add(f == lit)
            else:
                self.m.Add(f <= lit)
                self.m.Add(f <= 1 - seen)
                self.m.Add(f >= lit - seen)
            out.append(f)
            nxt = self._bool("seen")
            if seen is None:
                self.m.Add(nxt == lit)
            else:
                self.m.AddMaxEquality(nxt, [seen, lit])
            seen = nxt
        return out

    def _and(self, a, b):
        g = self._bool("and")
        self.m.Add(g <= a)
        self.m.Add(g <= b)
        self.m.Add(g >= a + b - 1)
        return g

    # ── §6.1 hard constraints ────────────────────────────────────────────────
    def _hard(self):
        F, m = self.F, self.m
        per_person = defaultdict(list)
        for c in F.cells:
            per_person[(c[0], c[2])].append(c)
        for cells in per_person.values():
            if len(cells) > 1:
                m.Add(self._sum(cells) <= 1)
        for s in F.services:
            if s.fixed:
                continue
            for role in s.roles:
                cells = [c for c in F.cells_at[s.id] if c[1] == role]
                if cells:
                    m.Add(self._sum(cells) <= F.row_size[(s.id, role)])

    # ── §6.7 soft instances ──────────────────────────────────────────────────
    def _soft(self, inst):
        v = self._bool("viol")
        m, ok = self.m, v.Not()
        if not inst.terms and not inst.terms_b and inst.family != "consecutive":
            if inst.broken(frozenset()):
                m.Add(v == 1)  # nothing can satisfy it (a fixed service's seats are its pins)
            return v
        expr = self._sum(inst.terms)
        if inst.family == "count":
            # A `<=` value is never clamped (only `==`/`>=` are, Facts), and a schema-valid
            # 10**20 overflows CP-SAT's int64 (a 500). The sum cannot exceed its cell count,
            # so that bound changes no solution; inst.limit stays as sent for the report.
            at_most = min(inst.limit, len(inst.terms))
            {"==": lambda: m.Add(expr == inst.limit), "<=": lambda: m.Add(expr <= at_most),
             ">=": lambda: m.Add(expr >= inst.limit)}[inst.op]().OnlyEnforceIf(ok)
        elif inst.family == "pair":
            m.Add(expr <= 1).OnlyEnforceIf(ok)
        elif inst.family in ("presence", "mandatory_lead"):
            m.Add(expr >= 1).OnlyEnforceIf(ok)
        else:
            sides_a = [self.x[c] for c in inst.terms] + ([1] if inst.const_a else [])
            sides_b = [self.x[c] for c in inst.terms_b] + ([1] if inst.const_b else [])
            for a in sides_a:
                for b in sides_b:
                    if isinstance(a, int) and isinstance(b, int):
                        m.Add(v == 1)
                    else:
                        m.Add(a + b <= 1).OnlyEnforceIf(ok)
        return v

    # ── counts the protections read ──────────────────────────────────────────
    def _counts(self):
        F = self.F
        self.L, self.S, self.V = {}, {}, {}
        lead_sun, lead_sat, voice = defaultdict(list), defaultdict(list), defaultdict(list)
        for c in F.cells:
            s = F.svc[c[0]]
            if not s.counts:
                continue
            voice[(c[2], s.month)].append(c)
            if c[1] == "Lead":
                (lead_sun if s.day == "Sun" else lead_sat)[(c[2], s.month)].append(c)
        self.lead_sun_cells, self.lead_sat_cells, self.voice_cells = lead_sun, lead_sat, voice
        for p in F.pids:
            for mo in F.months:
                self.L[(p, mo)] = self._sum(lead_sun.get((p, mo), []))
                self.S[(p, mo)] = self._sum(lead_sat.get((p, mo), []))
                self.V[(p, mo)] = self._sum(voice.get((p, mo), []))

    # ── §6.6 received, mirrored on the decision variables ────────────────────
    def _received(self):
        F, plan = self.F, self.plan
        contrib = defaultdict(list)  # (p, line) -> [linear terms]
        upper = defaultdict(int)  # (p, line) -> how many cells can reach it
        recv_of_cell = {}  # cell -> [(line, literal)]
        for s in F.services:
            if not s.counts:
                continue
            fm = F.fmonths[s.month]
            pop, q, rules = F.realised_populations(s)
            cells = F.cells_at[s.id]
            pi = defaultdict(dict)  # cell -> {rho_id: literal}
            taken = defaultdict(list)  # cell -> literals of earlier rules' presence seats
            for rho, a in rules:
                cands = sorted(
                    (c for c in cells if s.key(c[1]) in a and c[2] in rho.members
                     and not fm.is_fixed_seat(c[2], s.key(c[1]))),
                    key=lambda c: (ROLE_RANK[c[1]], c[2]))
                lits = []
                for c in cands:
                    if taken[c]:
                        free = self._bool("free")
                        self.m.Add(free == self.x[c] - sum(taken[c]))
                        lits.append(free)
                    else:
                        lits.append(self.x[c])
                for c, f in zip(cands, self._first_set(lits)):
                    pi[c][rho.id] = f
                    taken[c].append(f)
            for c in cells:
                h, k = c[2], s.key(c[1])
                parts = []
                if h in pop[k] and not fm.is_fixed_seat(h, k):
                    if pi[c]:
                        normal = self._bool("normal")
                        self.m.Add(normal == self.x[c] - sum(pi[c].values()))
                        parts.append((LINE_OF_KEY[k], normal))
                    else:
                        parts.append((LINE_OF_KEY[k], self.x[c]))
                for rid, lit in pi[c].items():
                    if h in q[rid]:
                        parts.append((f"P:{rid}", lit))
                recv_of_cell[c] = parts
                for line, lit in parts:
                    contrib[(h, line)].append(lit)
                    upper[(h, line)] += 1
        # floor seats of the plan's floor persons: the first received seat of the month
        for mo in F.months:
            for p in sorted(plan.floor_persons.get(mo, ())):
                mine = [c for c in F.cells if c[2] == p and F.svc[c[0]].counts
                        and F.svc[c[0]].month == mo and recv_of_cell.get(c)]
                mine.sort(key=lambda c: seat_order_key(F.svc[c[0]].date, c[1], F.svc[c[0]].time, c[0]))
                lits = []
                for c in mine:
                    parts = recv_of_cell[c]
                    if len(parts) == 1:
                        lits.append(parts[0][1])
                    else:
                        any_recv = self._bool("recv")
                        self.m.Add(any_recv == sum(lit for _, lit in parts))
                        lits.append(any_recv)
                for c, f in zip(mine, self._first_set(lits)):
                    for line, lit in recv_of_cell[c]:
                        contrib[(p, line)].append(-1 * self._and(f, lit))
        self.n = {}
        self.n_upper = dict(upper)
        for key in sorted(contrib):
            n = self._int(0, max(1, upper[key]), "n")
            self.m.Add(n == sum(contrib[key]))
            self.n[key] = n

    def received_expr(self, person, line):
        return self.n.get((person, line), 0)

    # ── stage objectives (§7.1) ──────────────────────────────────────────────
    def obj_rules(self):
        return sum(v for _, v in self.viol), len(self.viol) > 0

    def obj_fill(self):
        F = self.F
        rows = [(s, role) for s in F.services if not s.fixed for role in s.roles]
        choir = sum(F.row_size[(s.id, r)] for s, r in rows if r == "Choir")
        bgv = sum(F.row_size[(s.id, r)] for s, r in rows if r == "BGV")
        weight = {"Choir": 1, "BGV": choir + 1, "Lead": (choir + 1) * (bgv + 1)}
        terms = [weight[c[1]] * self.x[c] for c in F.cells if not F.svc[c[0]].fixed]
        return sum(terms), bool(terms)

    def obj_cadence(self):
        terms = []
        for p in self.F.pids:
            for mo in self.F.months:
                state = self.F.cadence_state(p, mo)
                if state is None:
                    continue
                a = 1 if state == "on" else 0
                d = self._int(0, 64, "cad")
                self.m.Add(d >= self.L[(p, mo)] - a)
                self.m.Add(d >= a - self.L[(p, mo)])
                terms.append(d)
        return sum(terms), bool(terms)

    def obj_compensation(self):
        terms = []
        for p in self.F.pids:
            for mo in self.F.months:
                if self.F.cadence_state(p, mo) != "off":
                    continue
                y = self._bool("comp")
                self.m.Add(y >= 1 - self.L[(p, mo)] - self.S[(p, mo)])
                terms.append(y)
        return sum(terms), bool(terms)

    def obj_voice_floor(self):
        terms = []
        for p, mo in self.F.f9_instances():
            y = self._bool("vf")
            self.m.Add(y >= 1 - self.V[(p, mo)])
            terms.append(y)
        return sum(terms), bool(terms)

    def obj_dl_floor(self):
        terms = []
        F = self.F
        for p, mo in F.f10_instances():
            # min(prev, 1): only prev + L == 0 matters, and an unbounded schema-valid
            # prev_dl_leads (10**20) would overflow CP-SAT's int64 (a 500). report.missed()
            # reads the raw value in pure Python.
            prev = min(F.people[p].prev_dl_leads, 1) if mo == F.months[0] else self.L[(p, F.months[0])]
            y = self._bool("dlf")
            self.m.Add(y >= 1 - prev - self.L[(p, mo)])
            terms.append(y)
        return sum(terms), bool(terms)

    def _cap(self, counts, cells, key):
        terms = []
        for p in self.F.pids:
            for mo in self.F.months:
                if self.F.is_exact(p, mo, key) or len(cells.get((p, mo), [])) < 2:
                    continue
                y = self._int(0, 64, "cap")
                self.m.Add(y >= counts[(p, mo)] - 1)
                terms.append(y)
        return sum(terms), bool(terms)

    def obj_sunday_cap(self):
        return self._cap(self.L, self.lead_sun_cells, "Sun.Lead")

    def obj_saturday_cap(self):
        return self._cap(self.S, self.lead_sat_cells, "Sat.Lead")

    def obj_no_consecutive(self):
        F, terms = self.F, []
        horizon = {s.date for s in F.services}
        for p in F.pids:
            weeks = F.weekend_terms(p, (), counted_only=True, dl_only=True)
            for d in sorted(weeks):
                nxt = add_days(d, 7)
                if nxt not in weeks or nxt not in horizon:
                    continue
                (ca, ka), (cb, kb) = weeks[d], weeks[nxt]
                ha = 1 if ka else self._or([self.x[c] for c in ca])
                hb = 1 if kb else self._or([self.x[c] for c in cb])
                if isinstance(ha, int) and isinstance(hb, int):
                    terms.append(1)
                    continue
                y = self._bool("cons")
                self.m.Add(y >= ha + hb - 1)
                terms.append(y)
        return sum(terms), bool(terms)

    def _or(self, lits):
        if len(lits) == 1:
            return lits[0]
        h = self._bool("or")
        self.m.AddMaxEquality(h, lits)
        return h

    def balance_inputs(self, carried, line):
        """[(person, K, n, U)] for the line's stage set (§7.1): K = carried + planned."""
        out = []
        members = sorted({p for (_, p, l) in self.plan.in_population if l == line})
        for p in members:
            k = carried(p, line) + hundredths(self.plan.planned(p, line))
            n = self.n.get((p, line), 0)
            out.append((p, k, n, self.n_upper.get((p, line), 0)))
        return out

    def obj_balance_max(self, inputs):
        if not inputs:
            return 0, False
        lo = min(k - SCALE * u for _, k, _, u in inputs)
        hi = max(k for _, k, _, _ in inputs)
        mv = self._int(lo, hi, "max")
        for _, k, n, _ in inputs:
            self.m.Add(mv >= k - SCALE * n)
        return mv, True

    def obj_balance_sq(self, inputs):
        if not inputs:
            return 0, False
        terms = []
        for _, k, n, u in inputs:
            table = [(k - SCALE * j) ** 2 for j in range(u + 1)]
            if isinstance(n, int):
                terms.append(table[0])
                continue
            q = self._int(min(table), max(table), "sq")
            self.m.AddElement(n, table, q)
            terms.append(q)
        return sum(terms), True

    def obj_tiebreak(self, seed):
        rng = random.Random(seed)
        weights = [rng.randint(0, 9) for _ in self.decision]
        terms = [w * self.x[c] for w, c in zip(weights, self.decision)]
        return sum(terms), bool(terms)
