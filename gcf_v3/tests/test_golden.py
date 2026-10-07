"""The golden fixture (F14; IF2-29; C2 FX-3): Python reproduces every `ledger` case per month,
to the hundredth, and every `plan` case C5 added. `cadence` cases are TypeScript's (A18).

The suite FAILS — never skips — when the fixture is missing or has no `ledger` case.
"""

import json
import os
import unittest

from owt_v3.facts import Facts
from owt_v3.plan import compute_plan
from owt_v3.request import parse_request
from owt_v3.rounding import hundredths
from tests.golden_adapter import FIXTURE, figures

KINDS = ("ledger", "cadence", "plan")


def load():
    if not os.path.exists(FIXTURE):
        raise AssertionError("fixtures/fairness/golden.json is missing: C2's fixture must be on main first")
    with open(FIXTURE, encoding="utf-8") as f:
        return json.load(f)


class Fixture(unittest.TestCase):
    def test_the_file_exists_and_has_ledger_cases(self):
        fx = load()
        self.assertEqual((fx["schemaVersion"], fx["units"], fx["sign"]), (1, "hundredths", "positive_owed"))
        self.assertTrue([c for c in fx["cases"] if c["kind"] == "ledger"], "no ledger case")
        for case in fx["cases"]:
            self.assertIn(case["kind"], KINDS, case["id"])


class LedgerCases(unittest.TestCase):
    def test_every_ledger_case_per_month(self):
        for case in [c for c in load()["cases"] if c["kind"] == "ledger"]:
            with self.subTest(case=case["id"]):
                got, res, services = figures(case["input"])
                expected = case["expected"]["months"]
                for month, members in expected.items():
                    for member, lines in members.items():
                        for line, triple in lines.items():
                            self.assertEqual(got[month][member].get(line), triple, f"{month} {member} {line}")
                for month, members in got.items():
                    for member, lines in members.items():
                        for line, triple in lines.items():
                            if triple != {"share": 0, "received": 0, "balance": 0}:
                                self.assertIn(line, expected.get(month, {}).get(member, {}),
                                              f"unexpected figure {month} {member} {line}")

    def test_set_asides_match_in_the_months_the_case_lists(self):
        for case in [c for c in load()["cases"] if c["kind"] == "ledger"]:
            with self.subTest(case=case["id"]):
                got, res, _ = figures(case["input"])
                month_of = {s["_id"]: s["date"][:7] for s in case["input"]["services"]}
                months = set(case["expected"]["months"])
                mine = sorted((a["service"], a["key"], a["person"], a["reason"]) for a in res.set_asides
                              if month_of[a["service"]] in months)
                theirs = sorted((a["serviceId"], a["roleKey"], a["memberId"], a["reason"])
                                for a in case["expected"]["setAsides"] if month_of.get(a["serviceId"]) in months)
                self.assertEqual(mine, theirs)

    def test_exact_balances_sum_to_zero_per_service_key_and_rule(self):
        for case in [c for c in load()["cases"] if c["kind"] == "ledger"]:
            with self.subTest(case=case["id"]):
                _, res, _ = figures(case["input"])
                for sid, key, shared, pool in res.conservation:
                    self.assertEqual(shared, pool, f"{sid} {key}")

    def test_the_balance_is_share_minus_received_never_the_rounded_exact(self):
        for case in [c for c in load()["cases"] if c["kind"] == "ledger"]:
            for members in case["expected"]["months"].values():
                for lines in members.values():
                    for t in lines.values():
                        self.assertEqual(t["balance"], t["share"] - t["received"], case["id"])


class PlanCases(unittest.TestCase):
    def test_every_plan_case(self):
        for case in [c for c in load()["cases"] if c["kind"] == "plan"]:
            with self.subTest(case=case["id"]):
                F = Facts(parse_request(case["input"]))
                plan = compute_plan(F)
                for member, lines in case["expected"]["planned"].items():
                    for line, value in lines.items():
                        self.assertEqual(hundredths(plan.planned(member, line)), value, f"{member} {line}")
                floor = {m: sorted(v) for m, v in plan.floor_persons.items() if v}
                self.assertEqual(floor, case["expected"]["floor"])


if __name__ == "__main__":
    unittest.main()
