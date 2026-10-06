"""Rule instances, clamps and causes, built from the request alone (spec §5.4, §6.7, §8.1)."""

import unittest

from owt_v3.facts import Facts
from owt_v3.instances import build_instances, cause
from owt_v3.request import parse_request
from tests.builders import NOV_SATURDAYS, NOV_SUNDAYS, person, pin, request, service

ROLES3 = ["Lead", "BGV", "Choir"]


def built(body):
    F = Facts(parse_request(body))
    instances, notices = build_instances(F)
    return F, instances, notices


def of(instances, family):
    return [i for i in instances if i.family == family]


def everyone(svcs, ids, roles=ROLES3):
    return [person(p, {s["id"]: [r for r in roles if not (r == "Choir" and s["kind"] == "saturday")]
                       for s in svcs}, exempt=True) for p in ids]


class Counts(unittest.TestCase):
    def test_one_instance_per_rule_and_month_with_clamped_values(self):
        svcs = [service("n1", NOV_SUNDAYS[0]), service("d1", "2026-12-06")]
        people = [person("m-ana", {"n1": ["Lead"]}, exempt=True), person("m-bea", {"d1": ["Lead"]}, exempt=True)]
        rules = [{"id": "cap-a", "kind": "count", "person": "m-ana", "roles": ["Sun.Lead"], "op": "==",
                  "month": m, "value": 2} for m in ("2026-11", "2026-12")]
        F, inst, _ = built(request(svcs, people, rules=rules, months=["2026-11", "2026-12"]))
        self.assertEqual([(i.month, i.limit, len(i.terms)) for i in of(inst, "count")],
                         [("2026-11", 1, 1), ("2026-12", 0, 0)])
        self.assertEqual([(n["code"], n["params"]["month"], n["params"]["available"]) for n in F.clamp_notices],
                         [("exact_clamped", "2026-11", 1), ("exact_clamped", "2026-12", 0)])

    def test_a_fixed_service_counts_only_where_she_is_pinned(self):
        fx = service("fx", NOV_SUNDAYS[1], fixed=True)
        svcs = [service("n1", NOV_SUNDAYS[0]), fx]
        people = [person("m-ana", {"n1": ["Lead"], "fx": ["Lead"]}, exempt=True)]
        rules = [{"id": "min-a", "kind": "count", "person": "m-ana", "roles": ["Sun.Lead"], "op": ">=",
                  "month": "2026-11", "value": 2}]
        F, inst, _ = built(request(svcs, people, rules=rules))
        self.assertEqual(F.available[0], 1)
        F, inst, _ = built(request(svcs, people, rules=rules, pins=[pin(fx, "Lead", "m-ana")]))
        self.assertEqual(F.available[0], 2)


class Presence(unittest.TestCase):
    def test_no_member_able_to_hold_it_means_a_notice_not_an_instance(self):
        svcs = [service("n1", NOV_SUNDAYS[0])]
        people = [person("m-ana", {}, exempt=True), person("m-bea", {"n1": ["Lead"]}, exempt=True)]
        rules = [{"id": "pr-1", "kind": "presence", "persons": ["m-ana"], "roles": ["Sun.BGV"], "exclusive": False}]
        _, inst, notices = built(request(svcs, people, rules=rules))
        self.assertEqual(of(inst, "presence"), [])
        self.assertEqual(notices, [{"code": "presence_not_applicable", "params": {"rule": "pr-1", "service": "n1"}}])

    def test_a_fixed_service_without_the_member_pinned_is_broken_by_its_pins(self):
        fx = service("fx", NOV_SUNDAYS[0], fixed=True)
        people = [person("m-ana", {"fx": ["BGV"]}, exempt=True), person("m-bea", {"fx": ["BGV"]}, exempt=True)]
        rules = [{"id": "pr-1", "kind": "presence", "persons": ["m-ana"], "roles": ["Sun.BGV"], "exclusive": False}]
        F, inst, _ = built(request([fx], people, rules=rules, pins=[pin(fx, "BGV", "m-bea")]))
        [i] = of(inst, "presence")
        self.assertTrue(i.broken(frozenset(F.pinned)))
        self.assertEqual(cause(F, i), "pins")

    def test_a_fixed_seat_still_satisfies_the_soft_presence_instance(self):
        svcs = [service("n1", NOV_SUNDAYS[0])]
        people = [person("m-ana", {"n1": ["BGV"]}, exempt=True), person("m-bea", {"n1": ["BGV"]}, exempt=True)]
        rules = [{"id": "pr-1", "kind": "presence", "persons": ["m-ana"], "roles": ["Sun.BGV"], "exclusive": False},
                 {"id": "cap-a", "kind": "count", "person": "m-ana", "roles": ["Sun.BGV"], "op": "==",
                  "month": "2026-11", "value": 1}]
        F, inst, _ = built(request(svcs, people, rules=rules, pins=[pin(svcs[0], "BGV", "m-ana")]))
        [i] = of(inst, "presence")
        self.assertFalse(i.broken(frozenset(F.pinned)))  # her exact seat is never the presence SEAT, but counts here

    def test_a_saturday_is_out_of_a_sunday_rule(self):
        svcs = [service("t1", NOV_SATURDAYS[0], kind="saturday")]
        rules = [{"id": "pr-1", "kind": "presence", "persons": ["m-ana"], "roles": ["Sun.BGV"], "exclusive": False}]
        _, inst, notices = built(request(svcs, everyone(svcs, ["m-ana", "m-bea"]), rules=rules))
        self.assertEqual((of(inst, "presence"), notices), ([], []))


class PairsSpecialsAndCounted(unittest.TestCase):
    def test_a_pair_needs_a_term_for_both(self):
        svcs = [service("n1", NOV_SUNDAYS[0]), service("n2", NOV_SUNDAYS[1])]
        people = [person("m-ana", {"n1": ["Lead"], "n2": ["Lead"]}, exempt=True),
                  person("m-bea", {"n1": ["Lead"]}, exempt=True)]
        rules = [{"id": "cf-1", "kind": "pair", "persons": ["m-ana", "m-bea"], "roles": ["Sun.Lead"]}]
        _, inst, _ = built(request(svcs, people, rules=rules))
        self.assertEqual([i.service for i in of(inst, "pair")], ["n1"])

    def test_specials_never_and_uncounted_weekends_always(self):
        sp = service("sp", NOV_SUNDAYS[1], kind="special", fixed=True)
        svcs = [service("n1", NOV_SUNDAYS[0], counts=False), sp]
        people = [person("m-ana", {"n1": ["Lead"], "sp": ["Lead"]}, exempt=True)]
        rules = [{"id": "cap-a", "kind": "count", "person": "m-ana", "roles": ["Sun.Lead"], "op": "<=",
                  "month": "2026-11", "value": 0}]
        F, inst, _ = built(request(svcs, people, rules=rules, pins=[pin(sp, "Lead", "m-ana")]))
        [count] = of(inst, "count")
        self.assertEqual([c[0] for c in count.terms], ["n1"])  # the uncounted weekend service, not the special
        self.assertEqual([i.service for i in of(inst, "mandatory_lead")], ["n1"])

    def test_no_possible_lead_means_no_mandatory_lead_instance(self):
        svcs = [service("n1", NOV_SUNDAYS[0])]
        _, inst, _ = built(request(svcs, [person("m-ana", {"n1": ["BGV"]}, exempt=True)]))
        self.assertEqual(of(inst, "mandatory_lead"), [])


class Consecutive(unittest.TestCase):
    def rule(self):
        return [{"id": "cs-1", "kind": "consecutive", "person": "m-ana", "roles": ["Sun.Lead", "Sat.Lead"]}]

    def test_weekends_link_across_the_month_boundary_and_the_prior(self):
        svcs = [service("o31", "2026-10-31", kind="saturday"), service("n1", NOV_SUNDAYS[0]),
                service("n8", NOV_SUNDAYS[1])]
        prior = {"month": "2026-09", "has_services": True, "services": [
            {"date": "2026-09-27", "kind": "sunday", "counts": True, "seats": {"Lead": ["m-ana"]}}]}
        body = request(svcs, everyone(svcs, ["m-ana"], ["Lead"]), rules=self.rule(), months=["2026-10", "2026-11"],
                       prior=prior)
        _, inst, _ = built(body)
        [i] = of(inst, "consecutive")  # Sep 27 has no neighbour seven days on
        self.assertEqual(i.weekends, ("2026-11-01", "2026-11-08"))
        self.assertEqual(sorted(c[0] for c in i.terms), ["n1", "o31"])  # Oct 31 is Nov 1's weekend

    def test_a_prior_seat_pairs_with_the_first_weekend(self):
        svcs = [service("n1", NOV_SUNDAYS[0])]
        prior = {"month": "2026-10", "has_services": True, "services": [
            {"date": "2026-10-25", "kind": "sunday", "counts": True, "seats": {"Lead": ["m-ana"]}}]}
        F, inst, _ = built(request(svcs, everyone(svcs, ["m-ana"], ["Lead"]), rules=self.rule(), prior=prior,
                                   pins=[pin(svcs[0], "Lead", "m-ana")]))
        [i] = of(inst, "consecutive")
        self.assertEqual((i.weekends, i.const_a), (("2026-10-25", "2026-11-01"), 1))
        self.assertTrue(i.broken(frozenset(F.pinned)))
        self.assertEqual(cause(F, i), "pins")


class Causes(unittest.TestCase):
    def test_pins_versus_forced(self):
        svcs = [service("n1", NOV_SUNDAYS[0], seats={"Lead": 2, "BGV": 0, "Choir": 0})]
        people = everyone(svcs, ["m-ana", "m-bea", "m-cris"], ["Lead"])
        rules = [{"id": "cf-1", "kind": "pair", "persons": ["m-ana", "m-bea"], "roles": ["Sun.Lead"]}]
        F, inst, _ = built(request(svcs, people, rules=rules,
                                   pins=[pin(svcs[0], "Lead", "m-ana"), pin(svcs[0], "Lead", "m-bea")]))
        self.assertEqual(cause(F, of(inst, "pair")[0]), "pins")
        F, inst, _ = built(request(svcs, people, rules=rules))
        self.assertEqual(cause(F, of(inst, "pair")[0]), "forced")

    def test_a_member_pinned_in_another_role_is_a_pin_cause(self):
        svcs = [service("n1", NOV_SUNDAYS[0])]
        people = [person("m-ana", {"n1": ["Lead", "BGV"]}, exempt=True)]
        rules = [{"id": "pr-1", "kind": "presence", "persons": ["m-ana"], "roles": ["Sun.BGV"], "exclusive": False}]
        F, inst, _ = built(request(svcs, people, rules=rules, pins=[pin(svcs[0], "Lead", "m-ana")]))
        [i] = of(inst, "presence")
        self.assertEqual(cause(F, i), "pins")


if __name__ == "__main__":
    unittest.main()
