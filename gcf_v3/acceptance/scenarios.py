"""Scenario set P (spec §12.3): pins, rule breaks, clamps and edge cases on the
fictitious world. Each scenario returns [(name, passed)] plus the runs it made; names
are fixed strings (no identifier), so they can go into `summary.json` as they are.

Every scenario must complete (no `ok: false`, except P15's honest `timeout`) and name
exactly the expected breaks, misses and notices, each with the expected cause.
"""

NOV, DEC = "2026-11", "2026-12"
SUNDAYS_NOV = ("2026-11-01", "2026-11-08", "2026-11-15", "2026-11-22", "2026-11-29")
SUNDAYS_DEC = ("2026-12-06", "2026-12-13", "2026-12-20", "2026-12-27")


def sun(date):
    return f"w-{date}-sun"


def sat(date):
    return f"w-{date}-sat"


def pin(date, role, person, kind="sun"):
    return {"service": f"w-{date}-{kind}", "date": date, "role": role, "person": person}


def all_dates(month):
    from .world import month_dates
    return list(month_dates(month))


def _codes(resp, key):
    return sorted((x["code"], x.get("rule"), x["cause"]) for x in resp[key]) if key == "violations" else \
        sorted((x["code"], x["person"], x["cause"]) for x in resp[key])


def _missed(resp, person=None, code=None):
    return [m for m in resp["missed"] if (person is None or m["person"] == person)
            and (code is None or m["code"] == code)]


def _line(resp, person, line):
    for p in resp["fairness"]["people"]:
        if p["person"] == person:
            return p["lines"].get(line)
    return None


def scenario_runs(env, seed):
    """Yield (scenario id, [(check name, bool)], [(request, response)])."""
    # P1 — the presence pair, both pinned to one Sunday's BGV: a pair break caused by pins
    req, resp = env.run([NOV], seed, {"pins": [pin(SUNDAYS_NOV[1], "BGV", "m-gala"),
                                               pin(SUNDAYS_NOV[1], "BGV", "m-hector")]})
    yield "P1", [("ok", resp["ok"]),
                 ("pair_pins", resp["ok"] and _codes(resp, "violations") == [("pair", "pair-bgv", "pins")]),
                 ("ceiling_1", resp["ok"] and resp["violation_ceiling"]["value"] == 1)], [(req, resp)]
    # P2 — the fixed-count lead pinned on three Sundays: a count break caused by pins
    p2 = [pin(SUNDAYS_NOV[0], "Lead", "m-dario"), pin(SUNDAYS_NOV[2], "Lead", "m-dario"),
          pin(SUNDAYS_NOV[4], "Lead", "m-dario")]
    req, resp = env.run([NOV], seed, {"pins": p2})
    yield "P2", [("ok", resp["ok"]),
                 ("count_pins", resp["ok"] and _codes(resp, "violations") == [("count", "cap-fixed", "pins")])], \
        [(req, resp)]
    # P3 — both: the ceiling is 2
    req, resp = env.run([NOV], seed, {"pins": p2 + [pin(SUNDAYS_NOV[1], "BGV", "m-gala"),
                                                    pin(SUNDAYS_NOV[1], "BGV", "m-hector")]})
    yield "P3", [("ok", resp["ok"]),
                 ("ceiling_2", resp["ok"] and resp["violation_ceiling"]["value"] == 2),
                 ("both_pins", resp["ok"] and _codes(resp, "violations") == [
                     ("count", "cap-fixed", "pins"), ("pair", "pair-bgv", "pins")])], [(req, resp)]
    # P4 — a stored Sunday with 3 Leads (fixed) and a board Sunday pinned with 3 Leads (row grows)
    stored = {"id": "st-2026-11-08", "date": SUNDAYS_NOV[1], "kind": "sunday", "counts": True,
              "seats": {"Lead": ["m-ema", "m-fede", "m-kike"], "BGV": ["m-lola"], "Choir": []}}
    req, resp = env.run([NOV], seed, {"stored_add": [stored], "pins": [
        pin(SUNDAYS_NOV[3], "Lead", p) for p in ("m-cris", "m-gala", "m-ines")]})
    yield "P4", [("ok", resp["ok"]),
                 ("fixed_is_pins", resp["ok"] and resp["assignments"]["st-2026-11-08"]["Lead"] == [
                     "m-ema", "m-fede", "m-kike"]),
                 ("row_grew", resp["ok"] and len(resp["assignments"][sun(SUNDAYS_NOV[3])]["Lead"]) == 3)], \
        [(req, resp)]
    # P5 — a cadence member pinned on a Sunday in her off month
    req, resp = env.run([NOV], seed, {"pins": [pin(SUNDAYS_NOV[1], "Lead", "m-ana")]})
    cad = [c for c in resp.get("cadence", []) if c["person"] == "m-ana" and c["month"] == NOV]
    yield "P5", [("ok", resp["ok"]),
                 ("off_led_pins", resp["ok"] and [(m["code"], m["cause"]) for m in _missed(resp, "m-ana")]
                  == [("cadence_off_led", "pins")]),
                 ("no_compensation_owed", bool(cad) and cad[0]["compensation"] == "not_applicable")], [(req, resp)]
    # P6 — a regular pinned as Lead on all five Sundays: cap and consecutive misses caused by pins
    # Her never-together partner on Lead is away those Sundays (he could not lead beside her), so he
    # is off the DL line; the other DL members fit the two Sunday seats she leaves.
    ov = {"pins": [pin(d, "Lead", "m-ines") for d in SUNDAYS_NOV], "unavailable": {"m-jose": list(SUNDAYS_NOV)}}
    req, resp = env.run([NOV], seed, ov)
    mine = _missed(resp, "m-ines") if resp["ok"] else []
    yield "P6", [("ok", resp["ok"]),
                 ("cap_pins", any(m["code"] == "sunday_cap_exceeded" and m["cause"] == "pins" for m in mine)),
                 ("consecutive_pins", sum(1 for m in mine if m["code"] == "consecutive_sundays") >= 4
                  and all(m["cause"] == "pins" for m in mine)),
                 ("others_met", resp["ok"] and len(resp["missed"]) == len(mine))], [(req, resp)]
    # P7 — a pin on someone not eligible for that role is honoured, and its seat set aside
    req, resp = env.run([NOV], seed, {"pins": [pin(SUNDAYS_NOV[1], "Choir", "m-olga")]})
    coro = _line(resp, "m-olga", "CORO") if resp["ok"] else None
    yield "P7", [("ok", resp["ok"]),
                 ("honored", resp["ok"] and resp["pins"] == {"requested": 1, "honored": 1}
                  and "m-olga" in resp["assignments"][sun(SUNDAYS_NOV[1])]["Choir"]),
                 ("set_aside", resp["ok"] and (coro is None or coro["seats"] == 0))], [(req, resp)]
    # P8 — `==` above availability clamps: a one-BGV singer away all month; the fixed-count lead on one Sunday
    ov = {"unavailable": {"m-lola": all_dates(NOV), "m-dario": [d for d in SUNDAYS_NOV if d != SUNDAYS_NOV[2]]}}
    req, resp = env.run([NOV], seed, ov)
    clamps = sorted((n["params"]["rule"], n["params"]["value"], n["params"]["available"])
                    for n in resp.get("notices", []) if n["code"] == "exact_clamped")
    yield "P8", [("ok", resp["ok"]),
                 ("clamped", clamps == [("cap-fixed", 2, 1), ("cap-lola", 1, 0)]),
                 ("no_break", resp["ok"] and not resp["violations"])], [(req, resp)]
    # P9 — the presence pair both unavailable on one Sunday: the rule does not apply there
    req, resp = env.run([NOV], seed, {"unavailable": {p: [SUNDAYS_NOV[1]] for p in ("m-gala", "m-hector")}})
    na = [n["params"] for n in resp.get("notices", []) if n["code"] == "presence_not_applicable"]
    yield "P9", [("ok", resp["ok"]),
                 ("not_applicable", na == [{"rule": "pres-pair", "service": sun(SUNDAYS_NOV[1])}])], [(req, resp)]
    # P10 — exactly one presence member available on a Sunday: F6 moves her shares
    base_req, base = env.run([NOV], seed, {"available": {"m-hector": [SUNDAYS_NOV[1]], "m-gala": [SUNDAYS_NOV[1]]}})
    req, resp = env.run([NOV], seed, {"unavailable": {"m-gala": [SUNDAYS_NOV[1]]},
                                      "available": {"m-hector": [SUNDAYS_NOV[1]]}})
    moved = False
    if resp["ok"] and base["ok"]:
        before, after = _line(base, "m-hector", "CORO"), _line(resp, "m-hector", "CORO")
        sub_b, sub_a = _line(base, "m-hector", "P:pres-pair"), _line(resp, "m-hector", "P:pres-pair")
        moved = after["planned"] < before["planned"] and sub_a["planned"] > sub_b["planned"]
    yield "P10", [("ok", resp["ok"] and base["ok"]), ("shares_moved", moved)], [(base_req, base), (req, resp)]
    # P11 — a counted Sunday-dated special as a fixed service, plus pins on Saturdays
    special = {"id": "sp-2026-11-15-camp", "date": SUNDAYS_NOV[2], "kind": "special", "counts": True,
               "time": "19:00", "seats": {"Lead": ["m-kike"], "BGV": ["m-rosa"], "Choir": []}}
    req, resp = env.run([NOV], seed, {"specials": [special], "pins": [
        pin("2026-11-14", "Lead", "m-jose", "sat"), pin("2026-11-28", "BGV", "m-olga", "sat")]})
    yield "P11", [("ok", resp["ok"]),
                  ("special_is_pins", resp["ok"] and resp["assignments"]["sp-2026-11-15-camp"] == {
                      "Lead": ["m-kike"], "BGV": ["m-rosa"], "Choir": []}),
                  ("no_rule_on_special", resp["ok"] and all(
                      v.get("service") != "sp-2026-11-15-camp" for v in resp["violations"])),
                  ("pins_honored", resp["ok"] and resp["pins"]["honored"] == resp["pins"]["requested"])], \
        [(req, resp)]
    # P12 — a newcomer and a promotion, both via dl_since: no spurious dl_floor_missed
    newcomer = {"id": "m-tomas", "name": "Tomas", "roles": ["Sun.Lead", "Sat.Lead", "Sun.BGV", "Sat.BGV",
                                                            "Sun.Choir"],
                "since": {k: NOV for k in ("Sun.Lead", "Sat.Lead", "Sun.BGV", "Sat.BGV", "Sun.Choir")},
                "exempt": False, "cadence": False, "unavailable": []}
    ov = {"members_add": [newcomer],
          "roles_override": {"m-rosa": ["Sun.Lead", "Sun.BGV", "Sat.BGV", "Sun.Choir"]},
          "since_override": {"m-rosa": {"Sun.Lead": NOV}}}
    req, resp = env.run([NOV, DEC], seed, ov)
    yield "P12", [("ok", resp["ok"]),
                  ("no_spurious_floor", resp["ok"] and not any(
                      m["code"] == "dl_floor_missed" and m["person"] in ("m-tomas", "m-rosa") for m in resp["missed"]))], \
        [(req, resp)]
    # P13 — all three cadence members unavailable in their next «on» month: X1 shifts them, gaps <= 2
    ov = {"unavailable": {"m-cris": list(SUNDAYS_NOV), "m-ana": list(SUNDAYS_DEC), "m-bea": list(SUNDAYS_DEC)}}
    runs, chain = env.chain_runs([NOV, DEC, "2027-01", "2027-02", "2027-03", "2027-04"], 1, seed, ov)
    gaps_ok = all(r["ok"] for _, r in runs)
    if gaps_ok:
        for person in ("m-ana", "m-bea", "m-cris"):
            gap = longest = 0
            for _, r in runs:
                for c in r["cadence"]:
                    if c["person"] == person:
                        gap = 0 if c["sundays"] else gap + 1
                        longest = max(longest, gap)
            gaps_ok = gaps_ok and longest <= 2
    yield "P13", [("ok", all(r["ok"] for _, r in runs)), ("gaps_le_2", gaps_ok),
                  ("met", all(c["met"] for _, r in runs if r["ok"] for c in r["cadence"]))], runs
    # P14 — a month planned before the previous one is stored: no spurious floor miss
    req, resp = env.run(["2027-01"], seed, {})
    yield "P14", [("ok", resp["ok"]), ("prior_empty", req["prior"]["has_services"] is False),
                  ("no_floor_miss", resp["ok"] and not any(m["code"] == "dl_floor_missed" for m in resp["missed"]))], \
        [(req, resp)]
    # P15 — tiny stage limits: honest statuses (unproven / not_run / timeout), never a false «proven»
    req, resp = env.run([NOV, DEC], seed, {"budget": {"stage_det_limit": 0.001, "stage_seconds": 0.05,
                                                      "total_seconds": 1}})
    if resp["ok"]:
        honest = all(s["status"] != "proven" or s["limit"] == "none" for s in resp["stages"]) and \
            resp["reproducible"] == all(s["status"] == "proven" for s in resp["stages"]) and \
            any(s["status"] != "proven" for s in resp["stages"])
    else:
        honest = resp["code"] == "timeout" and resp["params"]["stage"] in ("rules", "fill")
    yield "P15", [("honest", honest)], [(req, resp)]
    # P16 — one presence rule id with different members per month (a record-bound month beside another)
    rules = [{"id": "pres-pair", "kind": "presence", "persons": ["m-gala", "m-hector"], "roles": ["Sun.BGV"],
              "exclusive": True, "month": NOV},
             {"id": "pres-pair", "kind": "presence", "persons": ["m-gala", "m-kike"], "roles": ["Sun.BGV"],
              "exclusive": False, "month": DEC}]
    req, resp = env.run([NOV, DEC], seed, {"rules_drop": ["pres-pair"], "rules_add": rules})
    yield "P16", [("ok", resp["ok"]),
                  ("nov_member", resp["ok"] and _line(resp, "m-hector", "P:pres-pair") is not None),
                  ("dec_member", resp["ok"] and _line(resp, "m-kike", "P:pres-pair") is not None)], [(req, resp)]
