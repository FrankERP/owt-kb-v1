"""The function's core end to end (spec §5.8, §8): a request in, a response out — refusals as
422 never 500, ids echoed verbatim, every field present and every code listed."""

import copy
import unittest

from owt_v3.codes import audit_response
from owt_v3.facts import Facts
from owt_v3.instances import build_instances
from owt_v3.request import parse_request
from owt_v3.service import handle, handle_raw, public_label
from tests.test_model import random_request
from tests.test_request import EXAMPLE

FIELDS = ("ok", "contract", "engine", "solver_version", "build", "request_id", "seed", "months", "reproducible",
          "assignments", "unfilled", "pins", "violations", "violation_ceiling", "stages", "total_ms", "fairness",
          "cadence", "missed", "notices")


class Core(unittest.TestCase):
    def test_the_example_solves(self):
        status, resp, _ = handle(copy.deepcopy(EXAMPLE))
        self.assertEqual(status, 200, resp)
        self.assertEqual((resp["request_id"], resp["seed"], resp["months"]), ("r-7f3a", 418207, ["2026-11"]))
        self.assertEqual(resp["assignments"]["sundayRole-8f2c"], {"Lead": ["m-bruno"], "BGV": [], "Choir": []})
        self.assertEqual(resp["assignments"]["p-2026-11-07-sat"].keys(), {"Lead", "BGV"})

    def test_refusals_answer_422_never_500(self):
        body = copy.deepcopy(EXAMPLE)
        body["services"][0]["date"] = "2026-02-30"
        status, resp, _ = handle(body)
        self.assertEqual((status, resp["ok"], resp["code"], resp["contract"], resp["engine"]),
                         (422, False, "invalid_request", 3, "v3"))
        self.assertEqual(handle([1, 2])[0], 422)

    def test_a_200_character_service_id_is_echoed_verbatim(self):
        body = copy.deepcopy(EXAMPLE)
        long_id = "a+b/" + "x" * 196
        body["services"][0]["id"] = long_id
        for p in body["people"]:
            if "p-2026-11-01-sun" in p["eligibility"]:
                p["eligibility"][long_id] = p["eligibility"].pop("p-2026-11-01-sun")
        status, resp, _ = handle(body)
        self.assertEqual(status, 200)
        self.assertIn(long_id, resp["assignments"])
        self.assertTrue(all(u["service"] in resp["assignments"] for u in resp["unfilled"]))
        seats = [f["seat"]["service"] for p in resp["fairness"]["people"] for f in p["floor"] if f["seat"]]
        self.assertTrue(all(s in resp["assignments"] for s in seats))

    def test_every_field_and_every_code_is_listed(self):
        for k in range(6):
            status, resp, _ = handle(random_request(k))
            self.assertEqual(status, 200)
            for key in FIELDS:
                self.assertIn(key, resp)
            self.assertEqual(audit_response(resp), [], f"request {k}")
            for person_ in resp["fairness"]["people"]:
                for f in list(person_["lines"].values()) + list(person_["tabs"].values()):
                    self.assertEqual(f["after"], f["carried"] + f["share"] - f["received"])
                    self.assertEqual((f["seats"] * 100, f["pinned_seats"] * 100), (f["received"], f["pinned"]))

    def test_the_ping(self):
        status, resp, log = handle({"contract": 3, "ping": True})
        self.assertEqual((status, resp["pin_cap"], resp["engine"]), (200, 250, "v3"))
        self.assertTrue(log["ping"])

    def test_an_unbounded_prev_dl_leads_never_overflows_the_model(self):
        # «int ≥ 0» with no maximum (§5): 10**20 overflowed CP-SAT's int64 → 500 (§5.8, §6.1).
        # The model reads min(prev, 1), so any prev ≥ 1 builds the same model as prev = 1.
        # m-ana is the example's one DL-floor instance (F10) in its first month.
        def run(prev):
            body = copy.deepcopy(EXAMPLE)
            body["people"][0]["prev_dl_leads"] = prev
            self.assertEqual(body["people"][0]["id"], "m-ana")
            return handle(body)

        status_1, resp_1, _ = run(1)
        self.assertEqual(status_1, 200, resp_1)
        for prev in (10**20, 10**4000):
            status, resp, log = run(prev)
            self.assertEqual(status, 200, (resp.get("code"), log.get("exception")))
            self.assertEqual((resp["assignments"], resp["missed"]), (resp_1["assignments"], resp_1["missed"]))

    def test_an_unbounded_at_most_count_never_overflows_the_model(self):
        # A `<=` value is never clamped (only ==/>= are): 10**20 reached the model → 500.
        def run(value):
            body = copy.deepcopy(EXAMPLE)
            body["rules"].append({"id": "cap-a", "kind": "count", "person": "m-ana", "roles": ["Sun.Lead"],
                                  "op": "<=", "month": "2026-11", "value": value})
            return handle(body)

        status_9, resp_9, _ = run(9)
        self.assertEqual(status_9, 200, resp_9)
        for value in (10**20, 10**4000):
            status, resp, log = run(value)
            self.assertEqual(status, 200, (resp.get("code"), log.get("exception")))
            self.assertEqual(resp["assignments"], resp_9["assignments"])
            self.assertNotIn("cap-a", [v.get("rule") for v in resp["violations"]])

    def test_an_at_most_count_keeps_its_limit_as_sent(self):
        # The model's bound is min(limit, cells); the instance — and so violations[].limit — is not.
        body = copy.deepcopy(EXAMPLE)
        body["rules"].append({"id": "cap-a", "kind": "count", "person": "m-ana", "roles": ["Sun.Lead"],
                              "op": "<=", "month": "2026-11", "value": 10**20})
        facts = Facts(parse_request(body))
        [inst] = [i for i in build_instances(facts)[0] if i.rule == "cap-a"]
        self.assertEqual(inst.limit, 10**20)

    def test_a_too_deep_body_is_invalid_json_not_a_500(self):
        # §11.2: unparseable JSON is 400 invalid_json; a 200,000-deep array raised RecursionError.
        status, resp, log = handle_raw("[" * 200000 + "]" * 200000)
        self.assertEqual((status, resp["code"], log["code"]), (400, "invalid_json", "invalid_json"))

    def test_public_labels(self):
        self.assertEqual(public_label("balance_max:P:pr-9", ["pr-1", "pr-9"]), "balance_max:P#2")
        self.assertEqual(public_label("balance_sq:DL", ["pr-1"]), "balance_sq:DL")
        self.assertEqual(public_label("rules", []), "rules")


if __name__ == "__main__":
    unittest.main()
