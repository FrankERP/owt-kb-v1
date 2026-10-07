"""A TEST-ONLY X1 (C2 CAD-1) that drives the acceptance chain. Never shipped, never
imported by `owt_v3`: the production X1 is C2's TypeScript alone (F7).

Before any chain runs, `check_against_fixture` replays the golden fixture's `cadence`
cases through this double and refuses to run on a mismatch (spec §12.2, §12.3) — a
harness error, never an assertion about X1 itself (A18).
"""

import json
import os

FIXTURE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "fixtures", "fairness", "golden.json")


class HarnessError(Exception):
    """The acceptance harness cannot run (fixture missing, or its X1 double disagrees)."""


def cadence_states(led_previous, months):
    """CAD-1: [{month, state, reason}] for 1–2 months of {month, eligible, availableCountedSundays}."""
    out, led = [], led_previous
    for i, m in enumerate(months):
        if not m["eligible"]:
            state, reason = "off", "not_eligible"
        elif led:
            state, reason = "off", "led_previous_month" if i == 0 else "assumed_led_previous_month"
        elif m["availableCountedSundays"] == 0:
            state, reason = "off", "no_available_sunday"
        else:
            state, reason = "on", "on"
        out.append({"month": m["month"], "state": state, "reason": reason})
        led = state == "on"
    return out


def wire_state(entry):
    """A14 / C5-5: reason `not_eligible` is `out`; every other state is sent as is."""
    return "out" if entry["reason"] == "not_eligible" else entry["state"]


def check_against_fixture(path=FIXTURE):
    """Replay every `cadence` case of IF2-29 through the double; raise HarnessError on any miss."""
    if not os.path.exists(path):
        raise HarnessError("fixtures/fairness/golden.json is missing — the harness needs C2's fixture")
    with open(path, encoding="utf-8") as f:
        fixture = json.load(f)
    cases = [c for c in fixture.get("cases", []) if c.get("kind") == "cadence"]
    if not cases:
        raise HarnessError("the golden fixture has no cadence cases")
    for case in cases:
        got = cadence_states(case["input"]["ledCountedSundayPreviousMonth"], case["input"]["months"])
        if got != case["expected"]:
            raise HarnessError("the test double disagrees with the fixture (cadence case "
                               f"{cases.index(case) + 1} of {len(cases)})")
    return len(cases)
