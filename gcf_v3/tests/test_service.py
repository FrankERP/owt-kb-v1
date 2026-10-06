"""The function's core end to end (spec §5.8, §8): a request in, a response out — refusals as
422 never 500, ids echoed verbatim, every field present and every code listed."""

import copy
import unittest

from owt_v3.codes import audit_response
from owt_v3.service import handle, public_label
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

    def test_public_labels(self):
        self.assertEqual(public_label("balance_max:P:pr-9", ["pr-1", "pr-9"]), "balance_max:P#2")
        self.assertEqual(public_label("balance_sq:DL", ["pr-1"]), "balance_sq:DL")
        self.assertEqual(public_label("rules", []), "rules")


if __name__ == "__main__":
    unittest.main()
