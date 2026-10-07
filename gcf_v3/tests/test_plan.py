"""Planned shares (F13; spec §6.2 «F6 in the plan», §6.3 set-asides in the plan, §6.4, §6.5,
C5-9, C5-15), hand-computed on fictitious requests."""

import unittest
from fractions import Fraction

from owt_v3.facts import Facts
from owt_v3.plan import compute_plan
from owt_v3.request import parse_request
from tests.builders import NOV_SUNDAYS, person, pin, request, service

LEAD = {"Lead": 2, "BGV": 0, "Choir": 0}


def plan_of(body):
    F = Facts(parse_request(body))
    return F, compute_plan(F)


def sundays(n, seats=LEAD):
    return [service(f"s{i + 1}", NOV_SUNDAYS[i], seats=dict(seats)) for i in range(n)]


def lead_people(ids, svcs, exempt=True, **kw):
    return [person(p, {s["id"]: ["Lead"] for s in svcs}, exempt=exempt, **kw) for p in ids]


class Pools(unittest.TestCase):
    def test_a_pool_is_shared_equally(self):
        s = sundays(1)
        _, plan = plan_of(request(s, lead_people(["m-ana", "m-bea", "m-cris"], s)))
        self.assertEqual(plan.planned("m-ana", "DL"), Fraction(2, 3))

    def test_rows_grow_to_fit_their_pins(self):
        s = sundays(1)
        body = request(s, lead_people(["m-ana", "m-bea", "m-cris"], s),
                       pins=[pin(s[0], "Lead", p) for p in ("m-ana", "m-bea", "m-cris")])
        _, plan = plan_of(body)
        self.assertEqual(plan.planned("m-ana", "DL"), 1)  # base 3 (grown), three members

    def test_a_fixed_service_bases_on_its_pins(self):
        s = [service("st-1", NOV_SUNDAYS[0], fixed=True)]
        people = [person(p, {"st-1": ["Lead"]}, exempt=True) for p in ("m-ana", "m-bea")]
        _, plan = plan_of(request(s, people, pins=[pin(s[0], "Lead", "m-ana")]))
        self.assertEqual(plan.planned("m-bea", "DL"), Fraction(1, 2))


class DecidedSeats(unittest.TestCase):
    def test_a_pin_takes_her_out_of_the_other_roles_there(self):
        s = [service("s1", NOV_SUNDAYS[0], seats={"Lead": 1, "BGV": 1, "Choir": 0})]
        people = [person(p, {"s1": ["Lead", "BGV"]}, exempt=True) for p in ("m-ana", "m-bea")]
        F, plan = plan_of(request(s, people, pins=[pin(s[0], "Lead", "m-ana")]))
        self.assertEqual(plan.planned("m-ana", "BGV"), 0)
        self.assertEqual(plan.planned("m-bea", "BGV"), 1)

    def test_an_exact_rule_with_no_slack_decides_its_services(self):
        s = sundays(2, {"Lead": 1, "BGV": 1, "Choir": 0})
        ana = person("m-ana", {"s1": ["Lead", "BGV"]}, exempt=True)  # available on s1 only
        bea = person("m-bea", {"s1": ["Lead", "BGV"], "s2": ["Lead", "BGV"]}, exempt=True)
        rule = {"id": "cap-a", "kind": "count", "person": "m-ana", "roles": ["Sun.BGV"], "op": "==",
                "month": "2026-11", "value": 1}
        _, plan = plan_of(request(s, [ana, bea], rules=[rule]))
        self.assertEqual(plan.planned("m-ana", "DL"), 0)  # decided: her s1 seat is BGV
        self.assertEqual(plan.planned("m-bea", "DL"), 2)

    def test_with_slack_nothing_is_decided(self):
        s = sundays(2, {"Lead": 1, "BGV": 1, "Choir": 0})
        people = [person(p, {"s1": ["Lead", "BGV"], "s2": ["Lead", "BGV"]}, exempt=True) for p in ("m-ana", "m-bea")]
        rule = {"id": "cap-a", "kind": "count", "person": "m-ana", "roles": ["Sun.BGV"], "op": "==",
                "month": "2026-11", "value": 1}
        _, plan = plan_of(request(s, people, rules=[rule]))
        # nothing is decided, but the spread F6 exit (amendment F-1 (a)) leaves her half a member
        # of the Lead pool at each Sunday: 1 x (1/2) / (1/2 + 1) per Sunday
        self.assertEqual(plan.planned("m-ana", "DL"), Fraction(2, 3))


class SpreadExit(unittest.TestCase):
    """Amendment F-1 (a): an exact rule with slack spreads its F6 exit like its set-aside."""

    def test_the_exit_is_spread_over_her_target_services(self):
        s = sundays(2, {"Lead": 1, "BGV": 0, "Choir": 1})
        ana = person("m-ana", {"s1": ["Lead", "Choir"], "s2": ["Lead", "Choir"]}, exempt=True)
        bea = person("m-bea", {"s1": ["Choir"], "s2": ["Choir"]}, exempt=True)
        rule = {"id": "cap-a", "kind": "count", "person": "m-ana", "roles": ["Sun.Lead"], "op": "==",
                "month": "2026-11", "value": 1}
        _, plan = plan_of(request(s, [ana, bea], rules=[rule]))
        # each Sunday: Choir pool 1, ana weighs 1 - 1/2; she gets 1/3, bea 2/3
        self.assertEqual(plan.planned("m-ana", "CORO"), Fraction(2, 3))
        self.assertEqual(plan.planned("m-bea", "CORO"), Fraction(4, 3))


class MonthlySetAsides(unittest.TestCase):
    def test_an_exact_count_minus_its_pins_is_spread_C5_9(self):
        s = sundays(3)
        people = lead_people(["m-ana", "m-bea", "m-cris"], s)
        rule = {"id": "cap-a", "kind": "count", "person": "m-ana", "roles": ["Sun.Lead"], "op": "==",
                "month": "2026-11", "value": 2}
        _, plan = plan_of(request(s, people, rules=[rule], pins=[pin(s[0], "Lead", "m-ana")]))
        # s1: base 2, her pin set aside (exact) -> pool 1 for bea and cris; s2, s3: remainder 1 spread
        # as 1/2 each -> pool 3/2 each. bea = 1/2 + 3/4 + 3/4 = 2.
        self.assertEqual(plan.planned("m-bea", "DL"), 2)
        self.assertEqual(plan.planned("m-ana", "DL"), 0)

    def test_a_cadence_on_sunday_is_spread_over_her_sundays(self):
        s = sundays(2)
        people = lead_people(["m-ana", "m-bea", "m-cris"], s)
        people[0]["cadence"] = {"2026-11": "on"}
        _, plan = plan_of(request(s, people))
        # each Sunday: base 2 - 1/2 set aside = 3/2, shared by bea and cris
        self.assertEqual(plan.planned("m-bea", "DL"), Fraction(3, 2))
        self.assertEqual(plan.planned("m-ana", "DL"), 0)


class Presence(unittest.TestCase):
    def test_the_forced_seat_splits_over_the_keys_with_a_member(self):
        s = [service("s1", NOV_SUNDAYS[0], seats={"Lead": 0, "BGV": 2, "Choir": 2})]
        both = {"s1": ["BGV", "Choir"]}
        people = [person(p, dict(both), exempt=True) for p in ("m-ana", "m-bea", "m-cris")]
        rule = {"id": "pr-1", "kind": "presence", "persons": ["m-ana", "m-bea"], "roles": ["Sun.BGV", "Sun.Choir"],
                "exclusive": False}
        _, plan = plan_of(request(s, people, rules=[rule]))
        # each key: 2 - 1/2 = 3/2 over three members; the sub-line's 1 seat over two members
        self.assertEqual(plan.planned("m-cris", "BGV"), Fraction(1, 2))
        self.assertEqual(plan.planned("m-ana", "P:pr-1"), Fraction(1, 2))

    def test_a_pinned_member_seat_is_the_forced_seat_once(self):
        s = [service("s1", NOV_SUNDAYS[0], seats={"Lead": 0, "BGV": 3, "Choir": 0})]
        people = [person(p, {"s1": ["BGV"]}, exempt=True) for p in ("m-ana", "m-bea", "m-cris", "m-dario")]
        rule = {"id": "pr-1", "kind": "presence", "persons": ["m-ana", "m-bea"], "roles": ["Sun.BGV"],
                "exclusive": True}
        _, plan = plan_of(request(s, people, rules=[rule], pins=[pin(s[0], "BGV", "m-ana")]))
        self.assertEqual(plan.planned("m-cris", "BGV"), 1)  # (3 - 1) / 2, not (3 - 2) / 2

    def test_the_sole_available_member_leaves_every_normal_pool(self):
        s = [service("s1", NOV_SUNDAYS[0], seats={"Lead": 2, "BGV": 1, "Choir": 0})]
        people = [person("m-ana", {"s1": ["Lead", "BGV"]}, exempt=True),
                  person("m-bea", {}, exempt=True),  # the other member, away
                  person("m-cris", {"s1": ["Lead"]}, exempt=True)]
        rule = {"id": "pr-1", "kind": "presence", "persons": ["m-ana", "m-bea"], "roles": ["Sun.BGV"],
                "exclusive": False}
        _, plan = plan_of(request(s, people, rules=[rule]))
        self.assertEqual(plan.planned("m-ana", "DL"), 0)
        self.assertEqual(plan.planned("m-cris", "DL"), 2)
        self.assertEqual(plan.planned("m-ana", "P:pr-1"), 1)


class Floor(unittest.TestCase):
    def crowd(self, s, n=6):
        return [person(f"m-x{i}", {x["id"]: ["Lead"] for x in s}, exempt=True) for i in range(n)]

    def test_a_low_share_person_gets_a_floor_seat(self):
        s = sundays(1)
        ana = person("m-ana", {"s1": ["Lead"]})
        F, plan = plan_of(request(s, self.crowd(s) + [ana]))
        self.assertEqual(plan.floor_persons["2026-11"], frozenset({"m-ana"}))
        # her floor seat is set aside from s1: pool 2 - 1 = 1 over seven members
        self.assertEqual(plan.planned("m-x0", "DL"), Fraction(1, 7))

    def test_C5_15_skips_in_the_plan(self):
        s = sundays(1)
        ana = person("m-ana", {"s1": ["Lead"]})
        exact = {"id": "cap-a", "kind": "count", "person": "m-ana", "roles": ["Sun.Lead"], "op": "==",
                 "month": "2026-11", "value": 1}
        _, plan = plan_of(request(s, self.crowd(s) + [ana], rules=[exact]))
        self.assertEqual(plan.floor_persons["2026-11"], frozenset())  # a clamped == of 1
        ana_cad = person("m-ana", {"s1": ["Lead"]}, cadence={"2026-11": "on"})
        _, plan = plan_of(request(s, self.crowd(s) + [ana_cad]))
        self.assertEqual(plan.floor_persons["2026-11"], frozenset())  # an «on» month

    def test_a_received_pin_is_the_floor_seat(self):
        s = sundays(2)
        ana = person("m-ana", {"s1": ["Lead"], "s2": ["Lead"]})
        F, plan = plan_of(request(s, self.crowd(s, 10) + [ana], pins=[pin(s[1], "Lead", "m-ana")]))
        self.assertIn("m-ana", plan.floor_persons["2026-11"])
        # s2's pool loses her pinned seat: (2 - 1) / 11; s1 keeps its full pool 2 / 11
        self.assertEqual(plan.planned("m-x0", "DL"), Fraction(2, 11) + Fraction(1, 11))


class Clamps(unittest.TestCase):
    def test_exact_and_min_clamps_are_notices(self):
        s = sundays(2)
        people = lead_people(["m-ana", "m-bea"], s[:1]) + lead_people(["m-cris"], s)
        rules = [{"id": "cap-a", "kind": "count", "person": "m-ana", "roles": ["Sun.Lead"], "op": "==",
                  "month": "2026-11", "value": 2},
                 {"id": "min-c", "kind": "count", "person": "m-cris", "roles": ["Sun.Lead"], "op": ">=",
                  "month": "2026-11", "value": 3}]
        F, plan = plan_of(request(s, people, rules=rules))
        self.assertEqual([(n["code"], n["params"]["value"], n["params"]["available"]) for n in F.clamp_notices],
                         [("exact_clamped", 2, 1), ("min_clamped", 3, 2)])
        self.assertIn(("m-ana", "DL"), plan.clamped_lines)


if __name__ == "__main__":
    unittest.main()
