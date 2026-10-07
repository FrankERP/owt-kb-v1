"""The response sections (spec §8.1–§8.2, S4; C5-7, C5-8, A17, A32, A39), on hand-made
assignments — nothing is solved here, so every expected figure is checked by hand."""

import unittest
from fractions import Fraction

from owt_v3.codes import audit_response
from owt_v3.facts import Facts
from owt_v3.instances import build_instances
from owt_v3.plan import compute_plan
from owt_v3.report import Report, line_figures, tab_figures
from owt_v3.request import parse_request
from tests.builders import NOV_SATURDAYS, NOV_SUNDAYS, person, pin, request, service

STAGES = ("rules", "fill", "cadence", "compensation", "voice_floor", "dl_floor", "sunday_cap", "saturday_cap",
          "no_consecutive")


def records(status=None):
    status = status or {}
    return [{"id": s, "status": status.get(s, "proven"), "value": 0, "bound": 0, "limit": "none", "ms": 0,
             "det_milli": 0} for s in STAGES]


def report(body, seated, ceiling=0, status=None):
    """A Report for a hand-made assignment: `seated` is [(service id, role, person)]."""
    F = Facts(parse_request(body))
    plan = compute_plan(F)
    instances, notices = build_instances(F)
    values = {c: 1 if c in set(seated) | F.pinned else 0 for c in F.cells}
    return Report(F, plan, instances, notices, records(status), values, ceiling)


def fig(share, carried=0, seats=0, pinned=0):
    return line_figures(carried=carried, share=share, seats=seats, pinned_seats=pinned, set_aside_seats=0,
                        planned=share, in_stage=True, clamped=False)


class LineFigures(unittest.TestCase):
    def test_tenths_are_rounded_from_the_rational(self):
        f = fig(Fraction(11, 17))
        self.assertEqual((f["share"], f["tenths"]["share"]), (65, 6))
        f = fig(Fraction(9, 26), carried=30)
        self.assertEqual((f["after"], f["tenths"]["after"]), (65, 6))
        self.assertEqual(fig(Fraction(65, 100))["tenths"]["share"], 7)
        self.assertEqual(fig(Fraction(-65, 100))["tenths"]["share"], -7)

    def test_the_after_identity_and_seat_counts(self):
        f = fig(Fraction(1, 8), carried=20, seats=3, pinned=1)
        self.assertEqual(f["after"], f["carried"] + f["share"] - f["received"])
        self.assertEqual((f["received"], f["seats"], f["pinned"], f["pinned_seats"]), (300, 3, 100, 1))


class Tabs(unittest.TestCase):
    def test_a_folded_tab_rounds_its_exact_sum_once(self):
        lines = {"BGV": fig(Fraction(7, 50)), "P:pr-1": fig(Fraction(7, 50))}
        tabs = tab_figures(lines, {"BGV": Fraction(7, 50), "P:pr-1": Fraction(7, 50)}, exempt=False)
        self.assertEqual(tabs["BGV"]["tenths"]["share"], 3)  # 0.28, not the lines' 1 + 1
        lines = {"BGV": fig(Fraction(49, 200)), "P:pr-1": fig(Fraction(1, 250))}
        tabs = tab_figures(lines, {"BGV": Fraction(49, 200), "P:pr-1": Fraction(1, 250)}, exempt=False)
        self.assertEqual((tabs["BGV"]["share"], tabs["BGV"]["tenths"]["share"]), (25, 2))  # 0.249

    def test_total_sums_every_line_and_is_absent_for_an_exempt_person(self):
        shares = {"DL": Fraction(1, 3), "SL": Fraction(1, 3), "CORO": Fraction(1, 3)}
        lines = {k: fig(v, seats=1, pinned=1 if k == "DL" else 0) for k, v in shares.items()}
        tabs = tab_figures(lines, shares, exempt=False)
        self.assertEqual((tabs["TOTAL"]["share"], tabs["TOTAL"]["seats"], tabs["TOTAL"]["pinned_seats"]), (100, 3, 1))
        self.assertEqual(tabs["DL"]["share"], lines["DL"]["share"])
        self.assertEqual(tabs["TOTAL"]["after"], tabs["TOTAL"]["carried"] + tabs["TOTAL"]["share"] - 300)
        folded = tab_figures({"BGV": fig(Fraction(1, 2), seats=2, pinned=1), "P:pr-1": fig(Fraction(1, 2), seats=1)},
                             {"BGV": Fraction(1, 2), "P:pr-1": Fraction(1, 2)}, exempt=False)
        self.assertEqual((folded["BGV"]["seats"], folded["BGV"]["pinned_seats"], folded["BGV"]["received"]), (3, 1, 300))
        exempt = tab_figures(lines, shares, exempt=True)
        self.assertNotIn("TOTAL", exempt)
        self.assertEqual(set(exempt), {"DL", "SL", "CORO"})


class Fairness(unittest.TestCase):
    def test_a_line_appears_for_population_carried_or_received_only(self):
        s = [service("s1", NOV_SUNDAYS[0], seats={"Lead": 1, "BGV": 0, "Choir": 0})]
        people = [person("m-ana", {"s1": ["Lead"]}, exempt=True),
                  person("m-bea", {}, exempt=True, carried={"SL": -40, "P:old-1": 25}),
                  person("m-cris", {}, exempt=True)]
        r = report(request(s, people, pins=[pin(s[0], "Choir", "m-cris")]), [("s1", "Lead", "m-ana")])
        fair = r.fairness()
        lines = {p["person"]: p["lines"] for p in fair["people"]}
        self.assertEqual(sorted(lines["m-ana"]), ["DL"])
        self.assertEqual(sorted(lines["m-bea"]), ["P:old-1", "SL"])  # carried-only, a P: key with no rule too
        self.assertEqual(lines["m-cris"], {})  # her pinned Choir seat is set aside: not in any population
        self.assertEqual(fair["lines"], ["DL", "SL", "BGV", "CORO"])
        self.assertEqual(lines["m-ana"]["DL"]["share"], 100)
        self.assertEqual(lines["m-ana"]["DL"]["after"], 0)

    def test_pinned_seats_are_counted_and_seat_identities_hold(self):
        s = [service("s1", NOV_SUNDAYS[0]), service("s2", NOV_SUNDAYS[1])]
        people = [person(p, {"s1": ["Lead", "BGV", "Choir"], "s2": ["Lead", "BGV", "Choir"]}, exempt=True)
                  for p in ("m-ana", "m-bea", "m-cris")]
        seated = [("s1", "Lead", "m-ana"), ("s2", "BGV", "m-ana"), ("s1", "Choir", "m-bea")]
        r = report(request(s, people, pins=[pin(s[1], "BGV", "m-ana")]), seated)
        ana = [p for p in r.fairness()["people"] if p["person"] == "m-ana"][0]
        self.assertEqual((ana["lines"]["BGV"]["seats"], ana["lines"]["BGV"]["pinned_seats"]), (1, 1))
        self.assertEqual((ana["tabs"]["BGV"]["received"], ana["tabs"]["BGV"]["pinned_seats"]), (100, 1))
        self.assertNotIn("TOTAL", ana["tabs"])  # she is exempt
        for f in list(ana["lines"].values()) + list(ana["tabs"].values()):
            self.assertEqual(f["after"], f["carried"] + f["share"] - f["received"])
            self.assertEqual((f["seats"] * 100, f["pinned_seats"] * 100), (f["received"], f["pinned"]))


class Sections(unittest.TestCase):
    def test_cadence_outcomes(self):
        s = [service("s1", NOV_SUNDAYS[0], seats={"Lead": 1, "BGV": 0, "Choir": 0}),
             service("t1", NOV_SATURDAYS[0], kind="saturday", seats={"Lead": 1, "BGV": 0})]
        people = [person("m-ana", {"s1": ["Lead"], "t1": ["Lead"]}, cadence={"2026-11": "off"}, exempt=True),
                  person("m-bea", {"s1": ["Lead"]}, exempt=True, dl_since=None)]
        r = report(request(s, people), [("s1", "Lead", "m-bea"), ("t1", "Lead", "m-ana")])
        self.assertEqual(r.cadence(), [{"person": "m-ana", "month": "2026-11", "state": "off", "sundays": 0,
                                        "saturdays": 1, "met": True, "compensation": "given"}])
        r = report(request(s, people), [("s1", "Lead", "m-ana")])
        self.assertEqual(r.cadence()[0]["compensation"], "not_applicable")  # she led a Sunday (X2)
        self.assertEqual([(m["code"], m["cause"]) for m in r.missed()], [("cadence_off_led", "higher_priority")])

    def test_unfilled_reasons(self):
        s = [service("s1", NOV_SUNDAYS[0], seats={"Lead": 2, "BGV": 2, "Choir": 0})]
        people = [person("m-ana", {"s1": ["Lead", "BGV"]}, exempt=True), person("m-bea", {"s1": ["Lead"]}, exempt=True)]
        rules = [{"id": "cf-1", "kind": "pair", "persons": ["m-ana", "m-bea"], "roles": ["Sun.Lead"]}]
        r = report(request(s, people, rules=rules), [("s1", "Lead", "m-ana")])
        self.assertEqual(r.unfilled(), [{"service": "s1", "role": "Lead", "count": 1, "reason": "rules"},
                                        {"service": "s1", "role": "BGV", "count": 2, "reason": "no_candidate"}])
        r = report(request(s, people), [("s1", "Lead", "m-ana")], status={"fill": "unproven"})
        self.assertEqual(r.unfilled()[0]["reason"], "fill_not_proven")
        r = report(request(s, [person("m-ana", {"s1": ["BGV"]}, exempt=True)]), [("s1", "BGV", "m-ana")])
        self.assertEqual(r.unfilled()[0], {"service": "s1", "role": "Lead", "count": 2, "reason": "no_possible_lead"})

    def test_violations_and_the_handshake(self):
        s = [service("s1", NOV_SUNDAYS[0], seats={"Lead": 1, "BGV": 1, "Choir": 0})]
        people = [person("m-ana", {"s1": ["Lead", "BGV"]}, exempt=True)]
        r = report(request(s, people, pins=[pin(s[0], "BGV", "m-ana")]), [], ceiling=1)
        self.assertEqual(r.violations(), [{"code": "mandatory_lead", "rule": "mandatory_lead", "cause": "pins",
                                           "service": "s1", "month": "2026-11"}])
        self.assertEqual(r.pins(), {"requested": 1, "honored": 1})

    def test_missed_causes(self):
        s = [service(f"s{i}", d, seats={"Lead": 1, "BGV": 1, "Choir": 0}) for i, d in enumerate(NOV_SUNDAYS[:2])]
        both = {"s0": ["Lead", "BGV"], "s1": ["Lead", "BGV"]}
        people = [person("m-ana", dict(both), cadence={"2026-11": "on"}, exempt=True),
                  person("m-bea", dict(both), exempt=True), person("m-cris", dict(both), exempt=True)]
        pins = [pin(s[0], "BGV", "m-ana"), pin(s[1], "BGV", "m-ana")]
        seated = [("s0", "Lead", "m-bea"), ("s1", "Lead", "m-bea")]
        r = report(request(s, people, pins=pins), seated)
        causes = {(m["code"], m["person"]): m["cause"] for m in r.missed()}
        self.assertEqual(causes[("cadence_on_missed", "m-ana")], "pins")  # every slot is where she is pinned
        self.assertEqual(causes[("sunday_cap_exceeded", "m-bea")], "higher_priority")
        r = report(request(s, people, pins=pins), seated, status={"cadence": "unproven"})
        self.assertEqual({m["cause"] for m in r.missed() if m["code"] == "cadence_on_missed"}, {"not_proven"})
        rules = [{"id": "min-b", "kind": "count", "person": "m-bea", "roles": ["Sun.Lead"], "op": ">=",
                  "month": "2026-11", "value": 2}]
        r = report(request(s, people, pins=pins, rules=rules), seated)
        self.assertEqual({m["cause"] for m in r.missed() if m["code"] == "sunday_cap_exceeded"}, {"rule"})

    def test_dl_capacity_is_a_notice_and_a_cause(self):
        s = [service("s1", NOV_SUNDAYS[0], seats={"Lead": 1, "BGV": 0, "Choir": 0})]
        people = [person(x, {"s1": ["Lead"]}, exempt=True, dl_since="2026-01", prev=0)
                  for x in ("m-ana", "m-bea", "m-cris")]
        r = report(request(s, people), [("s1", "Lead", "m-ana")])
        self.assertEqual(r.notices[0], {"code": "dl_capacity",
                                        "params": {"months": ["2026-11"], "seats": 1, "people": 3}})
        self.assertEqual({m["cause"] for m in r.missed() if m["code"] == "dl_floor_missed"}, {"capacity"})

    def test_every_code_in_a_built_response_is_listed(self):
        s = [service("s1", NOV_SUNDAYS[0], seats={"Lead": 1, "BGV": 1, "Choir": 0})]
        people = [person("m-ana", {"s1": ["Lead", "BGV"]}, exempt=True, cadence={"2026-11": "on"})]
        r = report(request(s, people, pins=[pin(s[0], "BGV", "m-ana")]), [], ceiling=1)
        resp = {"ok": True, "stages": records(), "violations": r.violations(), "unfilled": r.unfilled(),
                "missed": r.missed(), "notices": r.notices, "cadence": r.cadence()}
        self.assertEqual(audit_response(resp), [])


if __name__ == "__main__":
    unittest.main()
