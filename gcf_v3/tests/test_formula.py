"""The shared realised formula (spec §6.2–§6.4, §6.6; C2 LG-4, LG-7–LG-11), hand-computed.

These cases mirror C2's FX-4 shapes so the formula is guarded before the golden fixture
asserts it (test_golden.py). Names are fictitious.
"""

import unittest
from fractions import Fraction

from owt_v3.formula import FMonth, FPresence, FService, realised

M = "2026-10"


def svc(sid, date, lead=(), bgv=(), choir=(), time=None, weekend=True):
    day = "Sun" if date in ("2026-10-04", "2026-10-11", "2026-10-18", "2026-10-25") else "Sat"
    return FService(id=sid, date=date, time=time, month=M, day=day, weekend=weekend,
                    keys=tuple(f"{day}.{r}" for r in ("Lead", "BGV", "Choir")),
                    seats={"Lead": tuple(lead), "BGV": tuple(bgv), "Choir": tuple(choir)})


def month(status, exact=None, cadence=(), exempt=None, presence=(), away=()):
    """status: {person: {role key: "in"}}; away: {(person, date)} unavailable.

    Everyone is exempt unless `exempt` says otherwise, so the floor seat (LG-11) stays out of
    the cases that are not about it: in a small month every share is below 1.
    """
    exact = exact or {}
    exempt = set(status) if exempt is None else set(exempt)

    def base_in(p, s, k):
        return status.get(p, {}).get(k) == "in" and (p, s.date) not in set(away)
    return FMonth(listed=frozenset(status), exact={p: frozenset(v) for p, v in exact.items()},
                  cadence=frozenset(cadence), exempt=frozenset(exempt), presence=tuple(presence),
                  base_in=base_in)


def ins(*keys):
    return {k: "in" for k in keys}


def totals(res):
    share, recv = {}, {}
    for (m, p, line), v in res.share.items():
        share[(p, line)] = share.get((p, line), Fraction(0)) + v
    for (m, p, line), v in res.received.items():
        recv[(p, line)] = recv.get((p, line), 0) + v
    return share, recv


class Populations(unittest.TestCase):
    def test_uneven_division_conserves(self):
        fm = month({p: ins("Sun.BGV") for p in ("m-ana", "m-bea", "m-cris")})
        res = realised([svc("s1", "2026-10-04", bgv=("m-ana", "m-bea"))], {M: fm})
        share, recv = totals(res)
        self.assertEqual(share[("m-cris", "BGV")], Fraction(2, 3))
        self.assertEqual(recv[("m-ana", "BGV")], 1)
        self.assertTrue(res.conservation)
        self.assertIn(("s1", "Sun.BGV", Fraction(2), 2), res.conservation)
        for sid, line, shared, recorded in res.conservation:
            self.assertEqual(shared, recorded)
        # independent cross-check: total share per line == total received seats per line
        by_line_share, by_line_recv = {}, {}
        for (m, p, line), v in res.share.items():
            by_line_share[line] = by_line_share.get(line, Fraction(0)) + v
        for (m, p, line), v in res.received.items():
            by_line_recv[line] = by_line_recv.get(line, 0) + v
        for line, v in by_line_recv.items():
            self.assertEqual(by_line_share[line], v)

    def test_exact_half(self):
        people = [f"m-{n}" for n in ("ana", "bea", "cris", "dario", "ema", "fede", "gala", "iris")]
        fm = month({p: ins("Sun.Choir") for p in people})
        share, recv = totals(realised([svc("s1", "2026-10-11", choir=("m-ana",))], {M: fm}))
        self.assertEqual(share[("m-ana", "CORO")], Fraction(1, 8))

    def test_exact_role_holder_leaves_the_other_populations_there(self):
        fm = month({"m-ana": {"Sun.Lead": "in"}, "m-bea": ins("Sun.Lead", "Sun.BGV")},
                   exact={"m-ana": ["Sun.BGV"]})
        res = realised([svc("s1", "2026-10-04", lead=("m-bea",), bgv=("m-ana",))], {M: fm})
        share, _ = totals(res)
        self.assertNotIn(("m-ana", "DL"), share)  # LG-8 (vii): she holds an exact BGV seat at s
        self.assertIn({"service": "s1", "role": "BGV", "key": "Sun.BGV", "person": "m-ana", "reason": "exact"},
                      res.set_asides)

    def test_cadence_holder_has_no_dl_line(self):
        fm = month({"m-ana": ins("Sun.Lead"), "m-bea": ins("Sun.Lead")}, cadence=["m-ana"])
        res = realised([svc("s1", "2026-10-04", lead=("m-ana", "m-bea"))], {M: fm})
        share, recv = totals(res)
        self.assertEqual(share[("m-bea", "DL")], 1)
        self.assertNotIn(("m-ana", "DL"), share)
        self.assertEqual(res.set_asides[0]["reason"], "cadence")


class Presence(unittest.TestCase):
    def test_sole_available_member_leaves_every_normal_population(self):
        rule = FPresence("pr-1", ("Sun.BGV",), ("m-ana", "m-bea"), False)
        fm = month({"m-ana": ins("Sun.Lead", "Sun.BGV"), "m-bea": ins("Sun.BGV"), "m-cris": ins("Sun.Lead", "Sun.BGV")},
                   presence=[rule], away=[("m-bea", "2026-10-04")])
        res = realised([svc("s1", "2026-10-04", lead=("m-cris",), bgv=("m-ana",))], {M: fm})
        share, recv = totals(res)
        self.assertNotIn(("m-ana", "DL"), share)
        self.assertEqual(share[("m-ana", "P:pr-1")], 1)
        self.assertEqual(recv[("m-ana", "P:pr-1")], 1)

    def test_exclusive_members_leave_the_rule_roles_only(self):
        rule = FPresence("pr-1", ("Sun.BGV",), ("m-ana", "m-bea"), True)
        fm = month({"m-ana": ins("Sun.Lead", "Sun.BGV"), "m-bea": ins("Sun.BGV"), "m-cris": ins("Sun.BGV")},
                   presence=[rule])
        res = realised([svc("s1", "2026-10-04", bgv=("m-bea", "m-cris"))], {M: fm})
        share, recv = totals(res)
        self.assertEqual(share[("m-cris", "BGV")], 1)  # the only normal BGV member; pool 1
        self.assertEqual(share[("m-ana", "P:pr-1")], Fraction(1, 2))
        self.assertIn(("m-ana", "DL"), share)

    def test_presence_seat_is_never_a_fixed_seat(self):
        rule = FPresence("pr-1", ("Sun.BGV",), ("m-ana", "m-bea"), False)
        fm = month({"m-ana": {}, "m-bea": ins("Sun.BGV"), "m-cris": ins("Sun.BGV"), "m-dario": ins("Sun.BGV")},
                   exact={"m-ana": ["Sun.BGV"]}, presence=[rule], exempt=())
        res = realised([svc("s1", "2026-10-25", bgv=("m-cris", "m-bea", "m-ana"))], {M: fm})
        share, recv = totals(res)
        reasons = {(a["person"], a["reason"]) for a in res.set_asides}
        self.assertIn(("m-ana", "exact"), reasons)
        self.assertEqual(recv[("m-bea", "P:pr-1")], 1)  # the next member's seat is the presence seat
        self.assertNotIn((M, "m-ana"), res.floor_seat)
        self.assertIn(("m-cris", "floor"), reasons)  # share 1/2 < 1, a received seat, no fixed seat

    def test_a_cadence_holders_dl_seat_is_never_the_presence_seat(self):
        rule = FPresence("pr-1", ("Sun.Lead",), ("m-ana", "m-bea"), False)
        fm = month({"m-ana": ins("Sun.Lead"), "m-bea": ins("Sun.Lead"), "m-cris": ins("Sun.Lead")},
                   cadence=["m-ana"], presence=[rule])
        res = realised([svc("s1", "2026-10-04", lead=("m-ana", "m-bea"))], {M: fm})
        _, recv = totals(res)
        self.assertIn(("m-ana", "cadence"), {(a["person"], a["reason"]) for a in res.set_asides})
        self.assertEqual(recv.get(("m-bea", "P:pr-1")), 1)  # the next member's seat is the presence seat

    def test_presence_seat_ties_break_by_member_id_not_array_order(self):
        rule = FPresence("pr-1", ("Sun.BGV",), ("m-ana", "m-bea"), False)
        fm = month({"m-ana": ins("Sun.BGV"), "m-bea": ins("Sun.BGV"), "m-cris": ins("Sun.BGV")}, presence=[rule])
        res = realised([svc("s1", "2026-10-04", bgv=("m-bea", "m-ana"))], {M: fm})
        _, recv = totals(res)
        self.assertEqual(recv.get(("m-ana", "P:pr-1")), 1)
        self.assertEqual(recv.get(("m-bea", "BGV")), 1)


class SecondSeat(unittest.TestCase):
    def test_second_seat_changes_nothing_but_itself(self):
        status = {p: ins("Sun.Lead", "Sun.BGV") for p in ("m-ana", "m-bea", "m-cris", "m-dario")}
        with_second = realised([svc("s1", "2026-10-18", lead=("m-ana", "m-bea"), bgv=("m-ana", "m-cris"))],
                               {M: month(status)})
        without = realised([svc("s1", "2026-10-18", lead=("m-ana", "m-bea"), bgv=("m-cris",))], {M: month(status)})
        self.assertEqual(totals(with_second)[1], totals(without)[1])
        self.assertIn({"service": "s1", "role": "BGV", "key": "Sun.BGV", "person": "m-ana",
                       "reason": "second_seat"}, with_second.set_asides)

    def test_a_second_seat_cancels_no_floor(self):
        crowd = {f"m-x{i}": ins("Sun.Lead", "Sun.BGV") for i in range(8)}
        crowd["m-ana"] = {"Sun.Lead": "in"}
        res = realised([svc("s1", "2026-10-18", lead=("m-ana",), bgv=("m-ana",))],
                       {M: month(crowd, exact={"m-ana": ["Sun.BGV"]}, exempt=())})
        # her BGV seat (exact for her) is a SECOND seat: invisible to «no fixed seat», so her Lead floors
        self.assertEqual(res.floor_seat[(M, "m-ana")], ("s1", "Lead"))

    def test_a_repeated_entry_counts_once(self):
        status = {p: ins("Sun.Choir") for p in ("m-ana", "m-bea")}
        res = realised([svc("s1", "2026-10-04", choir=("m-ana", "m-ana"))], {M: month(status)})
        self.assertEqual(totals(res)[1][("m-ana", "CORO")], 1)


class FloorSeat(unittest.TestCase):
    def status(self):
        crowd = {f"m-x{i}": ins("Sat.BGV", "Sun.BGV") for i in range(9)}
        crowd["m-ana"] = ins("Sat.BGV", "Sun.BGV")
        return crowd

    def test_time_breaks_a_same_date_same_role_tie(self):
        a = svc("b", "2026-10-03", bgv=("m-ana",), time="20:00", weekend=False)
        b = svc("a", "2026-10-03", bgv=("m-x1",), time=None, weekend=False)
        c = svc("c", "2026-10-03", bgv=("m-x2",), time="19:00", weekend=False)
        d = svc("d", "2026-10-03", bgv=("m-ana",), time="19:00", weekend=False)
        res = realised([a, b, c], {M: month(self.status(), exempt=())})
        self.assertEqual(res.floor_seat[(M, "m-ana")], ("b", "BGV"))
        res = realised([a, b, d], {M: month(self.status(), exempt=())})
        self.assertEqual(res.floor_seat[(M, "m-ana")], ("d", "BGV"))  # 19:00 before 20:00 and before none

    def test_an_exact_or_cadence_seat_skips_the_floor_but_outside_population_does_not(self):
        status = self.status()
        status["m-ana"] = {"Sun.BGV": "in"}  # not in Sun.Lead: her Lead seat is outside the population
        two = [svc("s1", "2026-10-04", lead=("m-ana",)), svc("s2", "2026-10-11", bgv=("m-ana",))]
        res = realised(two, {M: month(status, exempt=())})
        self.assertEqual(res.floor_seat[(M, "m-ana")], ("s2", "BGV"))  # outside_population cancels nothing
        res = realised(two, {M: month(status, exempt=(), exact={"m-ana": ["Sun.Lead"]})})
        self.assertNotIn((M, "m-ana"), res.floor_seat)  # an exact seat she holds cancels the floor
        res = realised(two, {M: month(status, exempt=(), cadence=["m-ana"])})
        self.assertNotIn((M, "m-ana"), res.floor_seat)  # so does a cadence holder's DL-mapped seat

    def test_floor_override_is_the_models_view(self):
        res = realised([svc("s1", "2026-10-04", bgv=("m-ana",))], {M: month(self.status(), exempt=())},
                       floor_override={M: frozenset()})
        self.assertEqual(res.floor_seat, {})


if __name__ == "__main__":
    unittest.main()
