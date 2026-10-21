"""Month-check parity (MCP proposal editor plan, T2.1): the TypeScript month check judges a
hand-edited board against the rules as written, and `fixtures/month-check/parity.json` pins what
the independent checker recomputes on each case. This suite asserts the checker still reproduces
every case; vitest (`monthCheckParity.test.ts`) asserts the TypeScript core reproduces the same
file. So when the solver's semantics change and `checker.py` follows (the acceptance suite forces
it), this goes red until the fixture — and with it the TypeScript core — follows too.

Regenerate with `python gcf_v3/acceptance/month_check_fixtures.py` only after a deliberate change
of semantics, and say so in the commit.
"""

import json
import os
import unittest

from acceptance import checker

FIXTURE = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
                       "fixtures", "month-check", "parity.json")

# Enumerated by name here AND in the vitest suite: the guard can never pass vacuously.
INSTANCE_FAMILIES = ["count:<=", "count:>=", "count:==", "presence", "pair", "mandatory_lead"]
PROTECTION_CODES = [
    "sunday_cap_exceeded", "saturday_cap_exceeded", "consecutive_sundays", "voice_floor_missed",
    "dl_floor_missed", "compensation_missed", "cadence_on_missed", "cadence_off_led",
]


def _request(fixture, case):
    req = dict(fixture["bases"][case["base"]]["request"])
    adds = case["eligibility_add"]
    req["services"] = sorted(req["services"] + case["services_add"], key=lambda s: (s["date"], s["id"]))
    req["people"] = [{**p, "eligibility": {**p["eligibility"], **adds.get(p["id"], {})}} for p in req["people"]]
    req["rules"] = req["rules"] + case["rules_add"]
    return req


def _listed(items):
    return [[a, b, list(c) if isinstance(c, tuple) else c] for a, b, c in items]


class MonthCheckParity(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with open(FIXTURE, encoding="utf-8") as f:
            cls.fixture = json.load(f)

    def test_the_checker_reproduces_every_case(self):
        self.assertGreater(len(self.fixture["cases"]), 0)
        for case in self.fixture["cases"]:
            with self.subTest(case=case["name"]):
                instances, missed = checker.recompute(_request(self.fixture, case), case["assignments"])
                self.assertEqual(_listed(instances), case["expected"]["instances"])
                self.assertEqual(_listed(missed), case["expected"]["missed"])

    def test_every_family_and_protection_is_broken_somewhere(self):
        self.assertEqual(self.fixture["instance_families"], INSTANCE_FAMILIES)
        self.assertEqual(self.fixture["protection_codes"], PROTECTION_CODES)
        families, codes = set(), set()
        for case in self.fixture["cases"]:
            req = _request(self.fixture, case)
            for family, rule, _ in case["expected"]["instances"]:
                if family == "count":
                    family = "count:" + next(r["op"] for r in req["rules"] if r["id"] == rule)
                families.add(family)
            codes |= {m[0] for m in case["expected"]["missed"]}
        self.assertEqual(sorted(f for f in INSTANCE_FAMILIES if f not in families), [])
        self.assertEqual(sorted(c for c in PROTECTION_CODES if c not in codes), [])

    def test_no_case_leans_on_a_difference_of_semantics(self):
        """The two differences live in cases.json: nothing here is fixed or pinned, no `==`/`>=`
        rule asks for more than the availability, and every seat is held by someone eligible."""
        for case in self.fixture["cases"]:
            with self.subTest(case=case["name"]):
                req = _request(self.fixture, case)
                R = checker._Request(req)
                self.assertEqual(req["pins"], [])
                self.assertFalse(any(s["fixed"] for s in req["services"]))
                for r in req["rules"]:
                    if r["kind"] == "count" and r["op"] in ("==", ">="):
                        avail = sum(1 for s in req["services"] if s["kind"] != "special" and s["month"] == r["month"]
                                    and any(R.key(s, role) in r["roles"] and R.could(r["person"], s["id"], role)
                                            for role in R.roles(s)))
                        self.assertLessEqual(r["value"], avail, r["id"])
                for sid, roles in case["assignments"].items():
                    for role, ids in roles.items():
                        for p in ids:
                            self.assertTrue(R.eligible(p, sid, role), (sid, role, p))


if __name__ == "__main__":
    unittest.main()
