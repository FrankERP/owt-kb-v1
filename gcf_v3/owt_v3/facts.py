"""Request facts derived once, before the model (spec §5–§6): pins, rows, cells, exact
status, clamps, presence scope, the DL line, F9/F10 instances and the formula's inputs.

Everything iterates in canonical order: services by (date, time, id), roles Lead > BGV
> Choir, people by id codepoint, rules by their request index.
"""

from collections import defaultdict

from .formula import FMonth, FPresence, FService, applying, populations, q_members
from .vocab import LINE_OF_KEY, ROLES, add_months, role_key, weekend_of


class Facts:
    def __init__(self, problem):
        P = self.P = problem
        self.months = P.months
        self.services = P.services
        self.svc = P.service_by_id
        self.people = P.people
        self.pids = P.person_ids
        self.pin_of = {}  # (sid, person) -> role
        self.pin_rows = defaultdict(list)  # (sid, role) -> [person]
        for pin in P.pins:
            self.pin_of[(pin.service, pin.person)] = pin.role
            self.pin_rows[(pin.service, pin.role)].append(pin.person)
        self.pinned = frozenset((p.service, p.role, p.person) for p in P.pins)
        self.row_size = {}
        for s in self.services:
            for role in s.roles:
                pins = len(self.pin_rows.get((s.id, role), ()))
                self.row_size[(s.id, role)] = pins if s.fixed else max(s.seats.get(role, 0), pins)
        self.cells = []
        self.cells_at = defaultdict(list)
        for s in self.services:
            for role in s.roles:
                for p in self.pids:
                    if (s.id, role, p) in self.pinned or (not s.fixed and self.eligible(p, s.id, role)):
                        self.cells.append((s.id, role, p))
                        self.cells_at[s.id].append((s.id, role, p))
        self.cell_set = frozenset(self.cells)
        self.exact = defaultdict(frozenset)  # (p, m) -> exact role keys (== value >= 1)
        for r in P.counts:
            if r.op == "==" and r.value >= 1:
                self.exact[(r.person, r.month)] = self.exact[(r.person, r.month)] | frozenset(r.roles)
        self.clamped, self.available, self.clamp_notices = {}, {}, []
        for r in P.counts:
            avail = self.available_matching(r.person, r.month, r.roles)
            self.available[r.index] = avail
            value = r.value
            if r.op in ("==", ">=") and value > avail:
                value = avail
                self.clamp_notices.append({
                    "code": "exact_clamped" if r.op == "==" else "min_clamped",
                    "params": {"rule": r.id, "person": r.person, "month": r.month,
                               "value": r.value, "available": avail}})
            self.clamped[r.index] = value
        self.fmonths = {m: self._fmonth(m) for m in self.months}
        self.fservice_base = {s.id: self._fservice(s, {}) for s in self.services}

    # ── basic predicates ────────────────────────────────────────────────────
    def eligible(self, person, sid, role):
        return role in self.people[person].eligibility.get(sid, ())

    def is_exact(self, person, month, key):
        return key in self.exact.get((person, month), ())

    def cadence_state(self, person, month):
        cad = self.people[person].cadence
        return None if cad is None else cad[month]

    def has_cadence(self, person):
        return self.people[person].cadence is not None

    def key(self, sid, role):
        return role_key(self.svc[sid].day, role)

    def line(self, sid, role):
        return LINE_OF_KEY[self.key(sid, role)]

    def is_dl_lead(self, sid, role):
        return self.key(sid, role) == "Sun.Lead"

    def available_matching(self, person, month, roles):
        """§6.7: weekend services of `month` where she could hold a matching role."""
        n = 0
        for s in self.services:
            if s.month != month or not s.weekend:
                continue
            ok = False
            for role in s.roles:
                if role_key(s.day, role) not in roles:
                    continue
                if (s.id, role, person) in self.pinned or (not s.fixed and self.eligible(person, s.id, role)):
                    ok = True
            n += 1 if ok else 0
        return n

    # ── presence scope ──────────────────────────────────────────────────────
    def presence_in(self, month):
        """The presence objects in scope in `month` (C5-16), as formula rules."""
        return tuple(
            FPresence(r.id, r.roles, r.persons, r.exclusive)
            for r in self.P.presence if r.month is None or r.month == month
        )

    def presence_rules_at(self, s):
        """Request presence objects in scope at a weekend service (instances: counted or not)."""
        if not s.weekend:
            return []
        return [r for r in self.P.presence if r.month is None or r.month == s.month]

    # ── the formula's inputs ────────────────────────────────────────────────
    def _fmonth(self, month):
        def base_in(person, fs, key):
            day, role = key.split(".")
            return (fs.day == day and role in self.people[person].eligibility.get(fs.id, ())
                    and not self.is_exact(person, month, key))
        return FMonth(
            listed=frozenset(self.pids),
            exact={p: self.exact[(p, month)] for p in self.pids if self.exact.get((p, month))},
            cadence=frozenset(p for p in self.pids if self.has_cadence(p)),
            exempt=frozenset(p for p in self.pids if self.people[p].exempt),
            presence=self.presence_in(month),
            base_in=base_in,
        )

    def _fservice(self, s, holders):
        return FService(
            id=s.id, date=s.date, time=s.time, month=s.month, day=s.day, weekend=s.weekend,
            keys=tuple(role_key(s.day, r) for r in s.roles),
            seats={role: tuple(sorted(holders.get(role, ()))) for role in s.roles},
        )

    def fservices(self, assignment):
        """The counted services as formula inputs, seats from an assignment {sid: {role: [ids]}}."""
        return [self._fservice(s, assignment.get(s.id, {})) for s in self.services if s.counts]

    def realised_populations(self, s):
        """Pop(s, k) without item 5 (a holder never holds a second seat there) and Q per rule."""
        fm, fs = self.fmonths[s.month], self.fservice_base[s.id]
        pop = populations(fm, fs)
        q = {rho.id: q_members(fm, fs, rho, a) for rho, a in applying(fm, fs)}
        return pop, q, applying(fm, fs)

    # ── the DL line, F9 and F10 (spec §6.8, §7.1) ────────────────────────────
    def on_dl_line(self, person, month):
        if self.has_cadence(person) or self.is_exact(person, month, "Sun.Lead"):
            return False
        for s in self.services:
            if s.month != month or not s.counts:
                continue
            if s.kind == "sunday" and "Lead" in self.people[person].eligibility.get(s.id, ()):
                return True
            if s.day == "Sun" and self.pin_of.get((s.id, person)) == "Lead":
                return True
        return False

    def f10_instances(self):
        """[(person, month)] per §6.8 and C5-11, skips applied."""
        out = []
        for m in self.months:
            prev = add_months(m, -1)
            for p in self.pids:
                if not self.on_dl_line(p, m):
                    continue
                since = self.people[p].dl_since
                if since is None or prev < since:
                    continue
                if prev == self.P.prior.month and not self.P.prior.has_services:
                    continue
                out.append((p, m))
        return out

    def f9_instances(self):
        out = []
        for m in self.months:
            for p in self.pids:
                if self.people[p].exempt:
                    continue
                if any(s.month == m and s.counts and (
                        self.people[p].eligibility.get(s.id) or self.pin_of.get((s.id, p)))
                        for s in self.services):
                    out.append((p, m))
        return out

    def dl_capacity(self):
        """§6.8 capacity, once per run (A19, C5-12): (seats, people, notice?)."""
        seats = sum(self.row_size[(s.id, "Lead")] for s in self.services
                    if s.counts and s.day == "Sun" and "Lead" in s.roles)
        sub = 0
        counted = set()
        for r in self.P.counts:
            if r.op == "==" and "Sun.Lead" in r.roles:
                sub += self.clamped[r.index]
                counted.add((r.person, r.month))
        for p in self.pids:
            for m in self.months:
                if self.cadence_state(p, m) == "on":
                    sub += 1
                    counted.add((p, m))
        for pin in self.P.pins:
            s = self.svc[pin.service]
            if s.counts and pin.role == "Lead" and s.day == "Sun":
                if not self.on_dl_line(pin.person, s.month) and (pin.person, s.month) not in counted:
                    sub += 1
        capacity = seats - sub
        population = set()
        for p, m in self.f10_instances():
            if m != self.months[0] or self.people[p].prev_dl_leads == 0:
                population.add(p)
        return capacity, len(population)

    # ── consecutive weekends ────────────────────────────────────────────────
    def weekend_terms(self, person, roles, counted_only=False, dl_only=False):
        """{weekend Sunday: ([horizon cells], prior constant)} for one person.

        Rules (`consecutive`) read every weekend service, counted or not, never a special;
        the protection (`no_consecutive`) reads DL-mapped leads at counted services.
        """
        out = defaultdict(lambda: ([], 0))
        for s in self.services:
            if counted_only and not s.counts:
                continue
            if not dl_only and not s.weekend:
                continue
            if dl_only and s.day != "Sun":
                continue
            w = weekend_of(s.date)
            for role in s.roles:
                k = role_key(s.day, role)
                if (dl_only and k != "Sun.Lead") or (not dl_only and k not in roles):
                    continue
                if (s.id, role, person) in self.cell_set:
                    cells, const = out[w]
                    out[w] = (cells + [(s.id, role, person)], const)
        for ps in self.P.prior.services:
            if counted_only and not ps.counts:
                continue
            if not dl_only and ps.kind == "special":
                continue
            if dl_only and ps.day != "Sun":
                continue
            w = weekend_of(ps.date)
            for role in ROLES:
                k = role_key(ps.day, role)
                if (dl_only and k != "Sun.Lead") or (not dl_only and k not in roles):
                    continue
                if person in ps.seats.get(role, ()):
                    cells, const = out[w]
                    out[w] = (cells, 1)
        return dict(out)
