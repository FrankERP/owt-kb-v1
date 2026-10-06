"""Ranking (spec §7.1, F12): each stage's protection wins over the next one's, on instances
built for that purpose. The DL floor and the Sunday cap pull the same way (more distinct
leaders), so no instance trades one for the other; every other neighbouring pair is here.
All names are fictitious; everyone is exempt and has no DL history unless the case needs it.
"""

import unittest

from owt_v3.service import handle
from tests.builders import person, request, service

S1, S8, S15, S29 = "2026-11-01", "2026-11-08", "2026-11-15", "2026-11-29"
SAT14, SAT28 = "2026-11-14", "2026-11-28"
LEAD1 = {"Lead": 1, "BGV": 0, "Choir": 0}
SAT_LEAD1 = {"Lead": 1, "BGV": 0}


def p(pid, elig, **kw):
    kw.setdefault("exempt", True)
    kw.setdefault("dl_since", None)
    return person(pid, elig, **kw)


def solve(body):
    status, resp, _ = handle(body)
    assert status == 200, resp
    return resp


def missed(resp, code=None):
    return [(m["code"], m["person"], m["cause"]) for m in resp["missed"] if code is None or m["code"] == code]


class Ranking(unittest.TestCase):
    def test_rules_over_fill(self):
        s = [service("s1", S1, seats={"Lead": 2, "BGV": 0, "Choir": 0})]
        people = [p("m-ana", {"s1": ["Lead"]}), p("m-bea", {"s1": ["Lead"]})]
        rules = [{"id": "cf-1", "kind": "pair", "persons": ["m-ana", "m-bea"], "roles": ["Sun.Lead"]}]
        resp = solve(request(s, people, rules=rules))
        self.assertEqual(resp["violations"], [])
        self.assertEqual(resp["unfilled"], [{"service": "s1", "role": "Lead", "count": 1, "reason": "rules"}])

    def test_fill_over_cadence(self):
        s = [service("s1", S1, seats=dict(LEAD1))]
        people = [p("m-ana", {"s1": ["Lead"]}, cadence={"2026-11": "off"})]
        resp = solve(request(s, people))
        self.assertEqual(resp["assignments"]["s1"]["Lead"], ["m-ana"])
        self.assertEqual(missed(resp, "cadence_off_led"), [("cadence_off_led", "m-ana", "higher_priority")])

    def test_cadence_over_compensation(self):
        s = [service("s1", S1, seats=dict(LEAD1))]
        people = [p("m-ana", {"s1": ["Lead"]}, cadence={"2026-11": "off"}), p("m-bea", {"s1": ["Lead"]})]
        resp = solve(request(s, people))
        self.assertEqual(resp["assignments"]["s1"]["Lead"], ["m-bea"])  # a Sunday would cancel the debt
        self.assertEqual(missed(resp, "compensation_missed"), [("compensation_missed", "m-ana", "unavailable")])

    def test_compensation_over_voice_floor(self):
        s = [service("s1", S1, seats=dict(LEAD1)), service("t1", SAT14, kind="saturday", seats=dict(SAT_LEAD1))]
        people = [p("m-ana", {"s1": ["Lead"], "t1": ["Lead"]}, cadence={"2026-11": "off"}),
                  p("m-bea", {"s1": ["Lead"]}),
                  p("m-cris", {"t1": ["Lead"]}, exempt=False)]
        resp = solve(request(s, people))
        self.assertEqual(resp["assignments"]["t1"]["Lead"], ["m-ana"])
        self.assertEqual(missed(resp, "voice_floor_missed"), [("voice_floor_missed", "m-cris", "higher_priority")])

    def test_voice_floor_over_dl_floor(self):
        s = [service("s1", S1, seats=dict(LEAD1)), service("t1", SAT14, kind="saturday", seats={"Lead": 0, "BGV": 1})]
        people = [p("m-ana", {"s1": ["Lead"]}, exempt=False),
                  p("m-bea", {"s1": ["Lead"], "t1": ["BGV"]}, dl_since="2026-01", prev=0)]
        resp = solve(request(s, people))
        self.assertEqual(resp["assignments"]["s1"]["Lead"], ["m-ana"])
        self.assertEqual(missed(resp, "dl_floor_missed"), [("dl_floor_missed", "m-bea", "higher_priority")])

    def test_sunday_cap_over_saturday_cap(self):
        s = [service("s1", S1, seats=dict(LEAD1)), service("s2", S15, seats=dict(LEAD1)),
             service("t1", SAT14, kind="saturday", seats=dict(SAT_LEAD1)),
             service("t2", SAT28, kind="saturday", seats=dict(SAT_LEAD1))]
        people = [p("m-ana", {"s1": ["Lead"], "s2": ["Lead"], "t1": ["Lead"], "t2": ["Lead"]}),
                  p("m-bea", {"s1": ["Lead"], "t1": ["Lead"]})]
        rules = [{"id": "cap-b", "kind": "count", "person": "m-bea", "roles": ["Sun.Lead", "Sat.Lead"], "op": "<=",
                  "month": "2026-11", "value": 1}]
        resp = solve(request(s, people, rules=rules))
        self.assertEqual(resp["assignments"]["s1"]["Lead"], ["m-bea"])
        self.assertEqual(missed(resp), [("saturday_cap_exceeded", "m-ana", "higher_priority")])

    def test_saturday_cap_over_no_consecutive(self):
        s = [service("s1", S1, seats=dict(LEAD1)), service("s2", S8, seats=dict(LEAD1)),
             service("s3", S15, seats=dict(LEAD1)),
             service("t1", SAT14, kind="saturday", seats=dict(SAT_LEAD1)),
             service("t2", SAT28, kind="saturday", seats=dict(SAT_LEAD1))]
        people = [p("m-ana", {x: ["Lead"] for x in ("s1", "s2", "s3", "t1", "t2")}),
                  p("m-bea", {"s2": ["Lead"], "t1": ["Lead"]}),
                  p("m-cris", {"s1": ["Lead"], "s3": ["Lead"]})]
        rules = [{"id": "cap-a", "kind": "count", "person": "m-ana", "roles": ["Sun.Lead"], "op": "==",
                  "month": "2026-11", "value": 2},
                 {"id": "cap-b", "kind": "count", "person": "m-bea", "roles": ["Sun.Lead", "Sat.Lead"], "op": "<=",
                  "month": "2026-11", "value": 1}]
        resp = solve(request(s, people, rules=rules))
        self.assertEqual(resp["violations"], [])
        self.assertEqual([m[0] for m in missed(resp)], ["consecutive_sundays"])

    def test_no_consecutive_over_balances(self):
        s = [service("n", S29, seats=dict(LEAD1)), service("d", "2026-12-06", seats=dict(LEAD1))]
        people = [p("m-ana", {"n": ["Lead"], "d": ["Lead"]}, carried={"DL": 500}),
                  p("m-bea", {"n": ["Lead"], "d": ["Lead"]})]
        resp = solve(request(s, people, months=["2026-11", "2026-12"]))
        leads = resp["assignments"]["n"]["Lead"] + resp["assignments"]["d"]["Lead"]
        self.assertEqual(sorted(leads), ["m-ana", "m-bea"])  # the most-owed does not take both weekends
        self.assertEqual(missed(resp), [])


if __name__ == "__main__":
    unittest.main()
