"""The request contract v3 (spec §5, §5.8): every refusal is `ok: false` with a code, before
any solve; the spec's own example is accepted."""

import copy
import unittest

from owt_v3.codes import Refusal
from owt_v3.request import parse_request

EXAMPLE = {
    "contract": 3, "request_id": "r-7f3a", "seed": 418207, "months": ["2026-11"],
    "services": [
        {"id": "p-2026-11-01-sun", "date": "2026-11-01", "month": "2026-11", "kind": "sunday",
         "fixed": False, "counts": True, "seats": {"Lead": 2, "BGV": 3, "Choir": 3}},
        {"id": "p-2026-11-07-sat", "date": "2026-11-07", "month": "2026-11", "kind": "saturday",
         "fixed": False, "counts": True, "seats": {"Lead": 2, "BGV": 3}},
        {"id": "sundayRole-8f2c", "date": "2026-11-08", "month": "2026-11", "kind": "sunday",
         "fixed": True, "counts": True}],
    "people": [
        {"id": "m-ana", "name": "Ana", "exempt": False, "dl_since": "2026-05", "prev_dl_leads": 0,
         "eligibility": {"p-2026-11-01-sun": ["Lead", "BGV", "Choir"], "p-2026-11-07-sat": ["Lead"]},
         "carried": {"DL": 45, "CORO": -120}},
        {"id": "m-carla", "name": "Carla", "exempt": False, "dl_since": "2026-05", "prev_dl_leads": 1,
         "cadence": {"2026-11": "off"},
         "eligibility": {"p-2026-11-01-sun": ["Lead", "Choir"], "p-2026-11-07-sat": ["Lead"]},
         "carried": {"SL": 30}},
        {"id": "m-bruno", "name": "Bruno", "dl_since": "2026-05", "prev_dl_leads": 1,
         "eligibility": {"p-2026-11-01-sun": ["Lead"]}, "carried": {}},
        {"id": "m-dani", "name": "Dani", "dl_since": None, "prev_dl_leads": 0,
         "eligibility": {"p-2026-11-01-sun": ["BGV"]}, "carried": {"P:pr-1": 50}},
        {"id": "m-eli", "name": "Eli", "dl_since": None, "prev_dl_leads": 0,
         "eligibility": {"p-2026-11-01-sun": ["BGV"]}, "carried": {}}],
    "rules": [
        {"id": "cap-b1", "kind": "count", "person": "m-bruno", "roles": ["Sun.Lead"], "op": "==",
         "month": "2026-11", "value": 2},
        {"id": "pr-1", "kind": "presence", "persons": ["m-dani", "m-eli"], "roles": ["Sun.BGV"], "exclusive": True},
        {"id": "cf-3", "kind": "pair", "persons": ["m-dani", "m-eli"], "roles": ["Sun.BGV", "Sat.BGV"]}],
    "pins": [{"service": "sundayRole-8f2c", "date": "2026-11-08", "role": "Lead", "person": "m-bruno"}],
    "prior": {"month": "2026-10", "has_services": True,
              "services": [{"date": "2026-10-25", "kind": "sunday", "counts": True,
                            "seats": {"Lead": ["m-ana", "m-bruno"], "BGV": [], "Choir": []}}]},
}


def refused(body):
    try:
        parse_request(body)
    except Refusal as r:
        return r.code, r.params
    return None


class TheExample(unittest.TestCase):
    def test_is_accepted(self):
        problem = parse_request(copy.deepcopy(EXAMPLE))
        self.assertEqual(problem.months, ("2026-11",))
        self.assertEqual([s.id for s in problem.services],
                         ["p-2026-11-01-sun", "p-2026-11-07-sat", "sundayRole-8f2c"])
        self.assertEqual(problem.presence_ids, ("pr-1",))
        self.assertEqual(problem.lines, ("DL", "SL", "BGV", "P:pr-1", "CORO"))
        self.assertEqual(problem.services[2].roles, ("Lead", "BGV", "Choir"))  # a fixed service has all three
        self.assertEqual(problem.services[1].roles, ("Lead", "BGV"))  # a board Saturday has no Choir

    def test_the_ping_skips_validation(self):
        self.assertIsNone(parse_request({"contract": 3, "ping": True, "anything": "ignored"}))


class Refusals(unittest.TestCase):
    def mutate(self, fn):
        body = copy.deepcopy(EXAMPLE)
        fn(body)
        return refused(body)

    def assertInvalid(self, fn, field=None, detail=None):
        got = self.mutate(fn)
        self.assertIsNotNone(got, "accepted")
        self.assertEqual(got[0], "invalid_request", got)
        if field is not None:
            self.assertEqual(got[1]["field"], field)
        if detail is not None:
            self.assertEqual(got[1]["detail"], detail)

    def test_contract_mismatch(self):
        self.assertEqual(self.mutate(lambda b: b.update(contract=2)), ("contract_mismatch", {"received": 2}))
        self.assertEqual(self.mutate(lambda b: b.pop("contract")), ("contract_mismatch", {"received": None}))
        self.assertEqual(self.mutate(lambda b: b.update(contract=3.0))[0], "contract_mismatch")

    def test_unknown_keys_at_every_level(self):
        self.assertInvalid(lambda b: b.update(extra=1), "extra", "unknown_key")
        self.assertInvalid(lambda b: b["services"][0].update(color="x"), "services[0].color", "unknown_key")
        self.assertInvalid(lambda b: b["services"][0]["seats"].update(Drums=1), "services[0].seats.Drums")
        self.assertInvalid(lambda b: b["people"][0].update(nickname="x"), "people[0].nickname")
        self.assertInvalid(lambda b: b["rules"][0].update(relative=True), "rules[0].relative")
        self.assertInvalid(lambda b: b["pins"][0].update(origin="auto"), "pins[0].origin")
        self.assertInvalid(lambda b: b["prior"].update(extra=1), "prior.extra")
        self.assertInvalid(lambda b: b.update(budget={"workers": 8}), "budget.workers")

    def test_shapes_and_ranges(self):
        self.assertInvalid(lambda b: b.update(seed=-1), "seed")
        self.assertInvalid(lambda b: b.update(seed=1.5), "seed", "integer")
        self.assertInvalid(lambda b: b.update(months=["2026-11", "2027-01"]), "months", "not_consecutive")
        self.assertInvalid(lambda b: b.update(months=["2026-13"]), "months[0]", "format")
        self.assertInvalid(lambda b: b.update(months=["2026-11", "2026-12", "2027-01"]), "months", "range")
        self.assertInvalid(lambda b: b.update(request_id="x" * 65), "request_id", "range")
        self.assertInvalid(lambda b: b["services"][0]["seats"].update(Lead=7), "services[0].seats.Lead", "range")
        self.assertInvalid(lambda b: b["people"][0]["carried"].update(DL=10001), "people[0].carried", "range")
        self.assertInvalid(lambda b: b["people"][0]["carried"].update(XL=1), "people[0].carried", "unknown_key")
        self.assertInvalid(lambda b: b["people"][0].update(prev_dl_leads=-1), "people[0].prev_dl_leads")

    def test_service_ids_follow_the_canonical_document_id(self):
        def rename(b, new):
            b["services"][2]["id"] = new
            b["pins"][0]["service"] = new
        body = copy.deepcopy(EXAMPLE)
        rename(body, "a+b/" + "x" * 196)  # 200 characters outside [A-Za-z0-9:._-]: accepted verbatim
        self.assertEqual(parse_request(body).services[2].id, "a+b/" + "x" * 196)
        for bad in ("x" * 201, "with space", "drafts.sundayRole-8f2c"):
            self.assertInvalid(lambda b, bad=bad: rename(b, bad), "services[2].id", "format")

    def test_dates_months_kinds(self):
        self.assertInvalid(lambda b: b["services"][0].update(date="2026-12-06", month="2026-12"),
                           "services[0].date", "not_in_months")
        self.assertInvalid(lambda b: b["services"][0].update(month="2026-12"), "services[0].month", "month_mismatch")
        self.assertInvalid(lambda b: b["services"][0].update(date="2026-11-02"), "services[0].kind", "weekday")
        self.assertInvalid(lambda b: b["services"][1].update(date="2026-11-08"), "services[1].kind", "weekday")
        self.assertInvalid(lambda b: b["services"][2].update(date="2026-11-01"), "services[2].kind", "one_per_date")
        self.assertInvalid(lambda b: b["services"][0].update(time="7:00"), "services[0].time", "format")
        self.assertInvalid(lambda b: b["services"][1]["seats"].update(Choir=1), "services[1].seats.Choir",
                           "saturday_choir")

    def test_specials_must_be_fixed_and_counted(self):
        special = {"id": "sp-1", "date": "2026-11-13", "month": "2026-11", "kind": "special",
                   "fixed": False, "counts": True, "seats": {"Lead": 1, "BGV": 1, "Choir": 0}}
        self.assertInvalid(lambda b: b["services"].append(special), "services[3].fixed", "special_fixed")
        uncounted = dict(special, fixed=True, counts=False)
        self.assertInvalid(lambda b: b["services"].append(uncounted), "services[3].counts", "special_counted")

    def test_id_resolution(self):
        self.assertEqual(self.mutate(lambda b: b["rules"][0].update(person="m-zoe")),
                         ("unknown_person", {"field": "rules[0].person", "person": "m-zoe"}))
        self.assertEqual(self.mutate(lambda b: b["pins"][0].update(service="nope")),
                         ("unknown_service", {"field": "pins[0].service", "service": "nope"}))
        self.assertEqual(self.mutate(lambda b: b["people"][0]["eligibility"].update(nope=["Lead"]))[0],
                         "unknown_service")

    def test_duplicates_and_scoping(self):
        self.assertInvalid(lambda b: b["services"].append(dict(b["services"][0])), "services[3].id", "duplicate")
        self.assertInvalid(lambda b: b["rules"].append(dict(b["rules"][0])), "rules[3].id", "duplicate")
        self.assertInvalid(lambda b: b["rules"].append(dict(b["rules"][2], month="2026-11")), "rules[3].id",
                           "scope_mixed")

    def test_prior_month_and_window(self):
        self.assertInvalid(lambda b: b["prior"].update(month="2026-09"), "prior.month", "prior_month")
        self.assertInvalid(lambda b: b["prior"]["services"][0].update(date="2026-10-11"),
                           "prior.services[0].date", "prior_window")

    def test_cadence_covers_every_month_and_never_meets_an_exact_lead(self):
        self.assertInvalid(lambda b: b["people"][1].update(cadence={}), "people[1].cadence", "cadence_months")
        self.assertInvalid(lambda b: b["rules"].append({"id": "cap-c", "kind": "count", "person": "m-carla",
                                                        "roles": ["Sun.Lead"], "op": "==", "month": "2026-11",
                                                        "value": 1}),
                           "people[1].cadence", "cadence_exact_lead")

    def test_two_exact_counts_over_one_role_key_A38(self):
        second = {"id": "cap-b0", "kind": "count", "person": "m-bruno", "roles": ["Sun.Lead", "Sun.BGV"],
                  "op": "==", "month": "2026-11", "value": 1}
        # ids in codepoint order: "cap-b0" < "cap-b1", so the SECOND is cap-b1, rules[0]
        self.assertInvalid(lambda b: b["rules"].append(second), "rules[0]", "exact_overlap")

    def test_pins(self):
        self.assertEqual(self.mutate(lambda b: b["pins"].append(
            {"service": "sundayRole-8f2c", "date": "2026-11-08", "role": "BGV", "person": "m-bruno"})),
            ("pin_conflict", {"person": "m-bruno", "service": "sundayRole-8f2c"}))
        self.assertEqual(self.mutate(lambda b: b.update(pins=[b["pins"][0]] * 251)),
                         ("too_many_pins", {"count": 251, "cap": 250}))
        self.assertInvalid(lambda b: b["pins"][0].update(date="2026-11-01"), "pins[0].date", "date_mismatch")
        self.assertInvalid(lambda b: b["pins"].append(
            {"service": "p-2026-11-07-sat", "date": "2026-11-07", "role": "Choir", "person": "m-ana"}),
            "pins[1].role", "role_not_in_service")

    def test_exact_duplicate_pins_collapse(self):
        body = copy.deepcopy(EXAMPLE)
        body["pins"] = body["pins"] * 3
        self.assertEqual(len(parse_request(body).pins), 1)

    def test_negative_or_non_integer_values(self):
        self.assertInvalid(lambda b: b["rules"][0].update(value=-1), "rules[0].value", "range")
        self.assertInvalid(lambda b: b["rules"][0].update(value=1.5), "rules[0].value", "integer")

    def test_the_reserved_rule_id(self):
        self.assertInvalid(lambda b: b["rules"][2].update(id="mandatory_lead"), "rules[2].id", "reserved")

    def test_budget_clamps_down_only(self):
        body = copy.deepcopy(EXAMPLE)
        body["budget"] = {"total_seconds": 999, "stage_seconds": 0.0001, "stage_det_limit": 50}
        b = parse_request(body).budget
        self.assertEqual((b.total_seconds, b.stage_seconds), (25.0, 0.05))
        from owt_v3.constants import STAGE_DET_LIMIT
        self.assertEqual(b.stage_det_limit, STAGE_DET_LIMIT)


if __name__ == "__main__":
    unittest.main()
