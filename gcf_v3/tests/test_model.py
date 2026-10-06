"""The model (spec §6.1, §6.6): hard rules, rows, pins, and the received count it optimises,
which must equal the shared formula's on the same assignment (with the plan's floor persons).

Solved here with one plain CP-SAT call on the fill objective — any feasible assignment will do:
the equality and the hard rules must hold for every one of them.
"""

import random
import unittest
from collections import Counter

from ortools.sat.python import cp_model

from owt_v3.facts import Facts
from owt_v3.formula import realised
from owt_v3.instances import build_instances
from owt_v3.model import Model
from owt_v3.plan import compute_plan
from owt_v3.report import assignment_of
from owt_v3.request import parse_request
from tests.builders import NOV_SATURDAYS, NOV_SUNDAYS, person, pin, request, service

NAMES = ["m-ana", "m-bea", "m-cris", "m-dario", "m-ema", "m-fede", "m-gala", "m-iris", "m-joel", "m-karen"]


def random_request(k):
    """A small fictitious month with random eligibility, pins, presence, exact rules and cadence."""
    rng = random.Random(k)
    svcs = [service(f"s{i}", d) for i, d in enumerate(NOV_SUNDAYS[:3])]
    svcs += [service(f"t{i}", d, kind="saturday") for i, d in enumerate(NOV_SATURDAYS)]
    if rng.random() < 0.5:
        svcs.append(service("fx", NOV_SUNDAYS[3], fixed=True))
    people = []
    for p in NAMES:
        elig = {}
        for s in svcs:
            roles = ["Lead", "BGV"] if (s["kind"] == "saturday" and not s["fixed"]) else ["Lead", "BGV", "Choir"]
            pick = [r for r in roles if rng.random() < 0.6]
            if pick:
                elig[s["id"]] = pick
        people.append(person(p, elig, exempt=rng.random() < 0.2))
    people[0]["cadence"] = {"2026-11": rng.choice(["on", "off", "out"])}
    rules = [{"id": "pr-1", "kind": "presence", "persons": ["m-bea", "m-cris"], "roles": ["Sun.BGV"],
              "exclusive": rng.random() < 0.5},
             {"id": "cap-d", "kind": "count", "person": "m-dario", "roles": ["Sun.BGV"], "op": "==",
              "month": "2026-11", "value": rng.choice([0, 1, 2])}]
    pins, taken = [], set()
    for _ in range(rng.randint(0, 4)):
        s = rng.choice(svcs)
        roles = ["Lead", "BGV"] if (s["kind"] == "saturday" and not s["fixed"]) else ["Lead", "BGV", "Choir"]
        p = rng.choice(NAMES)
        if (s["id"], p) not in taken:
            taken.add((s["id"], p))
            pins.append(pin(s, rng.choice(roles), p))
    return request(svcs, people, rules=rules, pins=pins, seed=k)


def solve_fill(body):
    """(Facts, plan, model, {cell: value}, {(person, line): received}) after one fill solve."""
    F = Facts(parse_request(body))
    plan = compute_plan(F)
    instances, _ = build_instances(F)
    model = Model(F, plan, instances)
    objective, _ = model.obj_fill()
    model.m.Maximize(objective)
    solver = cp_model.CpSolver()
    solver.parameters.num_search_workers = 1
    status = solver.Solve(model.m)
    assert status in (cp_model.OPTIMAL, cp_model.FEASIBLE), solver.StatusName(status)
    values = {c: solver.Value(v) for c, v in model.x.items()}
    received = {k: solver.Value(v) for k, v in model.n.items()}
    return F, plan, model, values, received


class ReceivedEquality(unittest.TestCase):
    def test_the_model_counts_what_the_formula_counts(self):
        for k in range(12):
            F, plan, _, values, received = solve_fill(random_request(k))
            real = realised(F.fservices(assignment_of(F, values)), F.fmonths, floor_override=plan.floor_persons)
            formula = Counter()
            for (m, p, line), v in real.received.items():
                formula[(p, line)] += v
            self.assertEqual({key: v for key, v in formula.items() if v},
                             {key: v for key, v in received.items() if v}, f"request {k}")


    def test_equality_when_a_presence_member_holds_a_fixed_seat(self):
        s = [service(f"s{i}", d) for i, d in enumerate(NOV_SUNDAYS[:2])]
        everyone = {x["id"]: ["Lead", "BGV", "Choir"] for x in s}
        people = [person(p, dict(everyone)) for p in NAMES[:8]]
        people[1]["cadence"] = {"2026-11": "on"}
        rules = [{"id": "pr-1", "kind": "presence", "persons": ["m-ana", "m-bea", "m-cris"],
                  "roles": ["Sun.Lead", "Sun.BGV"], "exclusive": False},
                 {"id": "cap-a", "kind": "count", "person": "m-ana", "roles": ["Sun.BGV"], "op": "==",
                  "month": "2026-11", "value": 1}]
        pins = [pin(s[0], "BGV", "m-ana"), pin(s[0], "Lead", "m-bea"), pin(s[1], "BGV", "m-cris")]
        F, plan, _, values, received = solve_fill(request(s, people, rules=rules, pins=pins))
        real = realised(F.fservices(assignment_of(F, values)), F.fmonths, floor_override=plan.floor_persons)
        formula = Counter()
        for (m, p, line), v in real.received.items():
            formula[(p, line)] += v
        self.assertEqual({k: v for k, v in formula.items() if v}, {k: v for k, v in received.items() if v})
        reasons = {(a["person"], a["reason"]) for a in real.set_asides}
        self.assertTrue({("m-ana", "exact"), ("m-bea", "cadence")} <= reasons)


class HardRules(unittest.TestCase):
    def test_hard_rules_hold_on_random_requests(self):
        for k in range(12):
            F, _, _, values, _ = solve_fill(random_request(k))
            seated = {c for c, v in values.items() if v}
            per_service = Counter((c[0], c[2]) for c in seated)
            self.assertTrue(all(v == 1 for v in per_service.values()), f"two seats, request {k}")
            for sid, role, p in seated:
                self.assertTrue((sid, role, p) in F.pinned or (not F.svc[sid].fixed and F.eligible(p, sid, role)))
            self.assertTrue(F.pinned <= seated)
            assignment = assignment_of(F, values)
            for s in F.services:
                for role in s.roles:
                    self.assertLessEqual(len(assignment[s.id][role]), F.row_size[(s.id, role)])
                    if s.fixed:
                        self.assertEqual(len(assignment[s.id][role]), len(F.pin_rows.get((s.id, role), ())))

    def test_rows_grow_to_fit_their_pins(self):
        s = [service("s1", NOV_SUNDAYS[0], seats={"Lead": 2, "BGV": 0, "Choir": 0})]
        people = [person(p, {"s1": ["Lead"]}, exempt=True) for p in NAMES[:4]]
        F, _, _, values, _ = solve_fill(request(s, people, pins=[pin(s[0], "Lead", p) for p in NAMES[:3]]))
        self.assertEqual(assignment_of(F, values)["s1"]["Lead"], NAMES[:3])

    def test_a_fixed_service_gains_no_seat(self):
        s = [service("fx", NOV_SUNDAYS[0], fixed=True)]
        people = [person(p, {"fx": ["Lead", "BGV", "Choir"]}, exempt=True) for p in NAMES[:5]]
        F, _, _, values, _ = solve_fill(request(s, people, pins=[pin(s[0], "BGV", "m-ana")]))
        self.assertEqual(assignment_of(F, values)["fx"], {"Lead": [], "BGV": ["m-ana"], "Choir": []})


if __name__ == "__main__":
    unittest.main()
