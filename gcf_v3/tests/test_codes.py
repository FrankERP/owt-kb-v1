"""The code registry (spec §9) and the pin-cap literal (C5-13, U8)."""

import json
import os
import re
import unittest

from owt_v3 import codes
from owt_v3.codes import Refusal, audit_response, code

PKG = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "owt_v3")

RETIRED = ("sat_anchor", "rate_reduced", "alternation_rest", "alternation_broken", "within_slack",
           "carried_clamped", "timeout_no_solution", "mandatory_lead_impossible", "horizon_too_long",
           "degraded", "week_exclusion")


class Registry(unittest.TestCase):
    def test_groups_are_the_spec_groups(self):
        self.assertEqual(sorted(codes.GROUPS), sorted([
            "error", "stage", "stage_status", "stage_reason", "limit", "violation", "violation_rule",
            "violation_cause", "unfilled_reason", "missed", "missed_cause", "notice", "cadence_state",
            "compensation"]))

    def test_every_entry_lists_parameter_names_and_no_copy(self):
        for group, entries in codes.GROUPS.items():
            for name, params in entries.items():
                self.assertIsInstance(params, list, f"{group}/{name}")
                for p in params:
                    self.assertRegex(p, r"^[a-z][a-z0-9_]*$")

    def test_error_codes_and_parameters(self):
        self.assertEqual(codes.GROUPS["error"]["invalid_request"], ["field", "detail"])
        self.assertEqual(codes.GROUPS["error"]["timeout"], ["stage", "seconds"])
        self.assertEqual(codes.GROUPS["error"]["too_many_pins"], ["count", "cap"])
        self.assertEqual(codes.GROUPS["error"]["pin_conflict"], ["person", "service"])

    def test_mandatory_lead_is_the_one_violation_rule_token(self):
        self.assertEqual(list(codes.GROUPS["violation_rule"]), ["mandatory_lead"])

    def test_no_retired_code_is_listed(self):
        names = {n for entries in codes.GROUPS.values() for n in entries}
        for retired in RETIRED:
            self.assertNotIn(retired, names)

    def test_stage_templates_match_line_stages(self):
        self.assertEqual(code("stage", "balance_max:DL"), "balance_max:DL")
        self.assertEqual(code("stage", "balance_sq:P:pr-1"), "balance_sq:P:pr-1")
        with self.assertRaises(AssertionError):
            code("stage", "balance_max:")
        with self.assertRaises(AssertionError):
            code("stage", "fairness")

    def test_refusal_requires_exactly_the_listed_params(self):
        r = Refusal("pin_conflict", person="m-ana", service="s1")
        self.assertEqual((r.code, r.params), ("pin_conflict", {"person": "m-ana", "service": "s1"}))
        with self.assertRaises(AssertionError):
            Refusal("pin_conflict", person="m-ana")
        with self.assertRaises(AssertionError):
            Refusal("no_such_code")

    def test_audit_flags_an_unlisted_code(self):
        resp = {"ok": True, "stages": [{"id": "rules", "status": "proven", "limit": "none"}],
                "violations": [{"code": "week_exclusion", "rule": "x", "cause": "pins"}],
                "unfilled": [], "missed": [], "notices": [], "cadence": []}
        self.assertTrue(audit_response(resp))

    def test_codes_json_is_plain_json(self):
        with open(os.path.join(PKG, "codes.json"), encoding="utf-8") as f:
            self.assertEqual(json.load(f)["contract"], 3)


class PinCap(unittest.TestCase):
    def test_the_literal_appears_exactly_once_in_the_package(self):
        hits = []
        for root, _, files in os.walk(PKG):
            for name in files:
                if name.endswith(".py"):
                    with open(os.path.join(root, name), encoding="utf-8") as f:
                        hits += [name for line in f if re.fullmatch(r"PIN_CAP = 250\n?", line)]
        self.assertEqual(hits, ["constants.py"])


if __name__ == "__main__":
    unittest.main()
