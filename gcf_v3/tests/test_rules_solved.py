"""Rule instances solved end to end (spec §5.4, §6.7, §8.1; C5-3, C5-6, C5-16): per-month counts,
the trailing Saturday, month-scoped presence, pairs, specials, consecutive weekends, the mandatory
lead and uncounted services, through the whole pipeline."""

import unittest

from owt_v3.service import handle
from tests.builders import NOV_SATURDAYS, NOV_SUNDAYS, person, pin, request, service

ROLES3 = ["Lead", "BGV", "Choir"]


def solve(body):
    status, resp, _ = handle(body)
    assert status == 200, resp
    return resp


def two_months():
    svcs = [service("n1", "2026-11-22"), service("n2", "2026-11-29"), service("t1", "2026-11-28", kind="saturday"),
            service("d1", "2026-12-06"), service("d2", "2026-12-13")]
    people = [person(p, {s["id"]: (["Lead", "BGV"] if s["kind"] == "saturday" else list(ROLES3)) for s in svcs},
                     exempt=True) for p in ("m-ana", "m-bea", "m-cris", "m-dario", "m-ema", "m-fede", "m-gala")]
    return svcs, people


class Counts(unittest.TestCase):
    def test_count_rules_are_per_month_in_a_two_month_run(self):
        svcs, people = two_months()
        rules = [{"id": "cap-a", "kind": "count", "person": "m-ana", "roles": ["Sun.Lead"], "op": "==",
                  "month": m, "value": v} for m, v in (("2026-11", 2), ("2026-12", 0))]
        resp = solve(request(svcs, people, rules=rules, months=["2026-11", "2026-12"]))
        led = {sid: "m-ana" in resp["assignments"][sid]["Lead"] for sid in ("n1", "n2", "d1", "d2")}
        self.assertEqual(led, {"n1": True, "n2": True, "d1": False, "d2": False})
        self.assertEqual(resp["violations"], [])

    def test_the_trailing_saturday_counts_in_its_own_month(self):
        svcs = [service("o31", "2026-10-31", kind="saturday"), service("n1", "2026-11-01")]
        people = [person(p, {"o31": ["Lead", "BGV"], "n1": list(ROLES3)}, exempt=True)
                  for p in ("m-ana", "m-bea", "m-cris", "m-dario", "m-ema", "m-fede")]
        rules = [{"id": "sat-a", "kind": "count", "person": "m-ana", "roles": ["Sat.Lead"], "op": "==",
                  "month": "2026-10", "value": 1}]
        body = request(svcs, people, rules=rules, months=["2026-10", "2026-11"])
        resp = solve(body)
        self.assertIn("m-ana", resp["assignments"]["o31"]["Lead"])

    def test_an_exact_saturday_lead_above_one_is_off_the_saturday_cap_A16(self):
        svcs = [service("t1", NOV_SATURDAYS[0], kind="saturday"), service("t2", NOV_SATURDAYS[1], kind="saturday")]
        people = [person(p, {"t1": ["Lead", "BGV"], "t2": ["Lead", "BGV"]}, exempt=True)
                  for p in ("m-ana", "m-bea", "m-cris", "m-dario")]
        rules = [{"id": "sat-a", "kind": "count", "person": "m-ana", "roles": ["Sat.Lead"], "op": "==",
                  "month": "2026-11", "value": 2}]
        resp = solve(request(svcs, people, rules=rules))
        self.assertFalse([m for m in resp["missed"] if m["code"] == "saturday_cap_exceeded"])

    def test_each_clamp_is_a_notice(self):
        svcs = [service("s1", NOV_SUNDAYS[0])]
        people = [person("m-ana", {}, exempt=True)] + [
            person(p, {"s1": list(ROLES3)}, exempt=True) for p in ("m-bea", "m-cris", "m-dario")]
        rules = [{"id": "cap-a", "kind": "count", "person": "m-ana", "roles": ["Sun.BGV"], "op": "==",
                  "month": "2026-11", "value": 1},
                 {"id": "min-a", "kind": "count", "person": "m-ana", "roles": ["Sun.Lead"], "op": ">=",
                  "month": "2026-11", "value": 1},
                 {"id": "pr-x", "kind": "presence", "persons": ["m-ana"], "roles": ["Sun.Choir"], "exclusive": False}]
        resp = solve(request(svcs, people, rules=rules))
        self.assertEqual(sorted(n["code"] for n in resp["notices"] if n["code"] != "dl_capacity"),
                         ["exact_clamped", "min_clamped", "presence_not_applicable"])
        self.assertEqual(resp["violations"], [])


class PairsAndPresence(unittest.TestCase):
    def test_a_month_scoped_object_applies_only_in_its_month_C5_16(self):
        svcs, people = two_months()
        rules = [{"id": "pr-1", "kind": "presence", "persons": ["m-ana"], "roles": ["Sun.BGV"], "exclusive": False,
                  "month": "2026-11"},
                 {"id": "pr-1", "kind": "presence", "persons": ["m-bea"], "roles": ["Sun.BGV"], "exclusive": False,
                  "month": "2026-12"}]
        resp = solve(request(svcs, people, rules=rules, months=["2026-11", "2026-12"]))
        for sid in ("n1", "n2"):
            self.assertIn("m-ana", resp["assignments"][sid]["BGV"])
        for sid in ("d1", "d2"):
            self.assertIn("m-bea", resp["assignments"][sid]["BGV"])
        lines = {p["person"]: p["lines"] for p in resp["fairness"]["people"]}
        self.assertIn("P:pr-1", lines["m-ana"])
        self.assertIn("P:pr-1", lines["m-bea"])  # one sub-line spans both months

    def test_a_pair_applies_per_service(self):
        svcs, people = two_months()
        rules = [{"id": "cf-1", "kind": "pair", "persons": ["m-ana", "m-bea"], "roles": ["Sun.Lead", "Sun.BGV"]}]
        resp = solve(request(svcs, people, rules=rules, months=["2026-11", "2026-12"]))
        for sid in ("n1", "n2", "d1", "d2"):
            seated = resp["assignments"][sid]["Lead"] + resp["assignments"][sid]["BGV"]
            self.assertFalse("m-ana" in seated and "m-bea" in seated)

    def test_a_special_never_appears_in_a_rule_instance(self):
        special = service("sp-1", NOV_SUNDAYS[1], kind="special", fixed=True)
        svcs = [service("s1", NOV_SUNDAYS[0]), special]
        people = [person(p, {"s1": list(ROLES3), "sp-1": ["Lead"]}, exempt=True)
                  for p in ("m-ana", "m-bea", "m-cris", "m-dario")]
        rules = [{"id": "cap-a", "kind": "count", "person": "m-ana", "roles": ["Sun.Lead"], "op": "<=",
                  "month": "2026-11", "value": 0}]
        resp = solve(request(svcs, people, rules=rules, pins=[pin(special, "Lead", "m-ana")]))
        self.assertEqual(resp["violations"], [])  # her special Lead is not a rule seat

    def test_pins_that_break_a_pair_are_the_cause(self):
        svcs = [service("s1", NOV_SUNDAYS[0])]
        people = [person(p, {"s1": list(ROLES3)}, exempt=True) for p in ("m-ana", "m-bea", "m-cris", "m-dario")]
        rules = [{"id": "cf-1", "kind": "pair", "persons": ["m-ana", "m-bea"], "roles": ["Sun.BGV"]}]
        resp = solve(request(svcs, people, rules=rules,
                             pins=[pin(svcs[0], "BGV", "m-ana"), pin(svcs[0], "BGV", "m-bea")]))
        self.assertEqual([(v["code"], v["rule"], v["cause"]) for v in resp["violations"]], [("pair", "cf-1", "pins")])
        self.assertEqual(resp["violation_ceiling"], {"value": 1, "proven": True})


class Consecutive(unittest.TestCase):
    def test_links_across_the_month_boundary_and_against_prior(self):
        svcs, people = two_months()
        rules = [{"id": "cs-1", "kind": "consecutive", "person": "m-ana", "roles": ["Sun.Lead"]}]
        prior = {"month": "2026-10", "has_services": True,
                 "services": [{"date": "2026-10-25", "kind": "sunday", "counts": True,
                               "seats": {"Lead": ["m-ana"], "BGV": [], "Choir": []}}]}
        body = request(svcs, people, rules=rules, months=["2026-11", "2026-12"], prior=prior,
                       pins=[pin(svcs[0], "Lead", "m-ana")])
        body["services"].insert(0, service("n0", "2026-11-15"))
        for p in body["people"]:
            p["eligibility"]["n0"] = list(ROLES3)
        resp = solve(body)
        # Nov 22 is pinned; she must not lead Nov 15 or Nov 29 (both neighbours) — no break
        self.assertNotIn("m-ana", resp["assignments"]["n0"]["Lead"])
        self.assertNotIn("m-ana", resp["assignments"]["n2"]["Lead"])
        self.assertEqual(resp["violations"], [])

    def test_a_pin_after_a_prior_seat_is_a_break_caused_by_pins(self):
        svcs = [service("n1", NOV_SUNDAYS[0])]
        people = [person(p, {"n1": list(ROLES3)}, exempt=True) for p in ("m-ana", "m-bea", "m-cris", "m-dario")]
        rules = [{"id": "cs-1", "kind": "consecutive", "person": "m-ana", "roles": ["Sun.Lead"]}]
        prior = {"month": "2026-10", "has_services": True,
                 "services": [{"date": "2026-10-25", "kind": "sunday", "counts": True,
                               "seats": {"Lead": ["m-ana"], "BGV": [], "Choir": []}}]}
        resp = solve(request(svcs, people, rules=rules, prior=prior, pins=[pin(svcs[0], "Lead", "m-ana")]))
        self.assertEqual([(v["code"], v["cause"], v["weekends"]) for v in resp["violations"]],
                         [("consecutive", "pins", ["2026-10-25", "2026-11-01"])])


class MandatoryLead(unittest.TestCase):
    def test_no_possible_lead_is_an_unfilled_reason_not_a_violation(self):
        svcs = [service("s1", NOV_SUNDAYS[0])]
        people = [person(p, {"s1": ["BGV", "Choir"]}, exempt=True) for p in ("m-ana", "m-bea", "m-cris")]
        resp = solve(request(svcs, people))
        self.assertIn({"service": "s1", "role": "Lead", "count": 2, "reason": "no_possible_lead"}, resp["unfilled"])
        self.assertEqual(resp["violations"], [])

    def test_a_mandatory_lead_break_names_the_token(self):
        svcs = [service("s1", NOV_SUNDAYS[0], seats={"Lead": 1, "BGV": 1, "Choir": 0})]
        people = [person("m-ana", {"s1": ["Lead", "BGV"]}, exempt=True)]  # the only possible lead…
        resp = solve(request(svcs, people, pins=[pin(svcs[0], "BGV", "m-ana")]))  # …pinned in BGV
        self.assertEqual(resp["violations"], [{"code": "mandatory_lead", "rule": "mandatory_lead", "cause": "pins",
                                               "service": "s1", "month": "2026-11"}])
        self.assertEqual(resp["violation_ceiling"], {"value": 1, "proven": True})


class Uncounted(unittest.TestCase):
    def test_uncounted_services_stay_out_of_lines_and_protections_C5_3(self):
        svcs = [service("s1", NOV_SUNDAYS[0], counts=False)]
        people = [person(p, {"s1": list(ROLES3)}) for p in ("m-ana", "m-bea", "m-cris", "m-dario", "m-ema",
                                                                "m-fede", "m-gala", "m-iris")]
        resp = solve(request(svcs, people))
        self.assertEqual(resp["missed"], [])  # no voice floor instance: nothing counted
        for p in resp["fairness"]["people"]:
            self.assertEqual(p["lines"], {})


if __name__ == "__main__":
    unittest.main()
