# Pinned assignments in the CP-SAT solver — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `gcf/owt_solver_v2.py` accepts an optional `pinned` array, honours every pin as a fixed
variable, relaxes only the rules the pins force (per instance, under a proven ceiling), and reports
`pinned_honored`, `pin_violations` and `violation_ceiling_proven` — while a request with no pins
builds a byte-identical Stage A model to today's.

**Architecture:** A pin `(person, role, week)` is `sum(x[P, slots of (R, W)]) == 1`. Four enabling
changes make that possible (scoped candidacy appended after the shuffle, rows that grow to fit
their pins, pinned-only people unioned into `all_people` after `pools` and kept out of every
fairness group, service-keyed per-person pin slack on the three hard spreads). Under pins, six
constraint families go soft with one boolean per instance; a violation-only **solve 0** runs
first and its minimum becomes a hard ceiling on every later stage. The report is re-evaluated
against the returned assignment, never read off the booleans.

**Tech Stack:** Python 3.12, OR-Tools CP-SAT `ortools==9.15.6755` (pinned in `gcf/requirements.txt`),
stdlib `unittest`. TypeScript types only on the app side.

**Spec:** `docs/superpowers/specs/2026-09-15-solver-pinned-assignments-design.md` (critical tier).
Its review log `…-review-log.md` records 13 rounds with no `APPROVED`; **Frank authorized
implementation on 2026-09-25 without plan approval** («Arranca la implementación del spec del
solver»), so the fresh code review of the diff is the load-bearing gate (Task 7). Read the spec's
§4 grammar table and §5.2 table before touching the model.

## Global Constraints

- **Pinless inertness:** a request with no `pinned` key (or `pinned: []`) builds a Stage A model
  whose `sha256(str(model.Proto()))` equals the literal frozen in Task 1. **A red fingerprint in
  the solver PR is a FINDING, never a literal to re-capture** (spec §7, §9).
- **`n_viol` and its `_eq` are built only when `soft`** (`soft = relaxation_enabled(pins)` = `bool(pins)`).
- **`build_slots` keeps `Sun.BGV`/`Sun.Choir` interleaved**, one loop to the larger count.
- **Pin-granted candidacy is APPENDED** after the shuffled eligible names, sorted, and only when not already eligible.
- **`pinned` cap = 100, REJECTED over it, never truncated.** Every refusal is a `ValueError`.
- **`pin_violations` grammar (spec §4, normative, verbatim):**
  count `<person>: <source>` · presence `W<n>: <source>` · pair `W<n> <Sun|Sat>: <source>` ·
  consecutive `W<n>-<n+1> <person>: <source>` · `builtin:mandatory_lead:W<n>:<Sun|Sat>` ·
  `builtin:sat_anchor:W<n>`. `Sun`/`Sat` mapped from `SUNDAY_SERVICE`/`SATURDAY_SERVICE`, never
  interpolated; `<person>` from the parsed rule object, never from `source`.
- **`pinned_honored` is emitted on EVERY response** (`0` without pins), derived from the assignment.
  **`violation_ceiling_proven` is ABSENT on a pinless request**; `pin_violations` is `[]` there.
- **Nothing asserts the three `*_fairness_relaxed` flags, the pinned person's own total, or
  equivalence with a DSL rule** (spec §7).
- The CI gate is **`python -m unittest discover -s gcf -t gcf -v`** (already in `gates` since
  #76). The spec's pytest wording (`-s`, `pythonpath`, `pip install pytest`) is stale — do not
  add pytest. `docs/CI.md` already documents the step.
- Conventional commits, body explains the why, **no `Co-Authored-By` or any AI attribution**.
- Local python: the scratch venv at
  `$SP/venv/bin/python` where
  `SP=/private/tmp/claude-501/-Users-frankrocha-Documents-Builds-owt-kb-v1--claude-worktrees-app-outage-b00569/d9a5efe2-012a-4526-bc29-1717a74699db/scratchpad`
  (ortools 9.15.6755 installed from `gcf/requirements.txt`). Run the suite from the repo root:
  `$SP/venv/bin/python -m unittest discover -s gcf -t gcf -v`.

## Line map (current `origin/main`, `gcf/owt_solver_v2.py`, 1458 lines)

| What | Lines |
|---|---|
| constants, `SUNDAY_SERVICE`/`SATURDAY_SERVICE` | 51-84 |
| `ScheduleConfig` | 101-121 |
| `SolveResult` | 164-179 |
| `validate_config` | 467-487 |
| `build_slots` | 566-580 |
| `build_candidate_map` | 583-600 |
| `create_model_and_solve` signature | 678-705 |
| mandatory lead | 745-750 |
| `empty_target` | 767-768 |
| week exclusion | 770-780 |
| Saturday anchor | 782-799 |
| pair | 801-812 |
| presence (`excluded_pwr`) | 814-832 |
| consecutive | 834-842 |
| occupancy | 844-854 |
| global spread loops | 873-887 |
| Sun.Lead hard spread | 935-957 |
| Sun.BGV hard spread | 959-974 |
| count rules | 976-987 |
| objective branches | 989-1093 |
| post-solve | 1108-1139 |
| `solve_schedule` | 1190-1285 |
| `solve_from_dict` | 1335-1386 |

## File structure

| File | Responsibility |
|---|---|
| `gcf/test_inertness.py` (new, Task 1, own PR) | Stage A fingerprint ×3 seeds, output golden (seed 42, OPTIMAL precondition), objective-coefficient count |
| `gcf/owt_solver_v2.py` (Tasks 2-5) | the mechanism |
| `gcf/test_pinned_assignments.py` (new, Tasks 2-5) | every §7 claim about pins |
| `app/api/admin/solve/route.ts` (Task 6) | `SolveRequest.pinned`, three `SolveResponse` fields — types only |
| `docs/SOLVER_AND_INFRA.md`, `docs/CI.md`, `docs/adr/0041-…md`, `docs/adr/README.md`, the spec review log (Task 6) | docs in the same delivery |

---

### Task 1: Inertness goldens — step zero, its own PR, merged before the pin PR

The spec's §9 step zero was "land the python gate first"; the gate itself shipped with #76. What
is still missing is the guard it was for: nothing freezes today's pinless model. This task adds
it on a branch off `origin/main`, so the pin PR's CI proves the pinless path unchanged against a
literal captured from the *old* code.

**Files:**
- Create: `gcf/test_inertness.py`
- Modify: `docs/CI.md` (a short "Solver inertness goldens" section with the governance table)

- [ ] **Step 1: Branch off main, confirm no gcf drift**

```bash
cd /Users/frankrocha/Documents/Builds/owt-kb-v1/.claude/worktrees/app-outage-b00569
git fetch origin && git switch -c claude/solver-inertness-goldens origin/main
git diff origin/main --stat -- gcf/   # must print nothing
```

- [ ] **Step 2: Compute the machine-independent literals locally**

The fingerprint and the coefficient count depend only on `config.seed` and the model build
(spec §7); ortools is pinned identically in CI. Pre-fill them; the CI run confirms.

```bash
cd gcf && $SP/venv/bin/python - <<'EOF'
import hashlib
from ortools.sat.python import cp_model
import owt_solver_v2 as mod
from test_owt_solver_v2 import make_config
orig = cp_model.CpSolver.Solve
for seed in (1, 42, 2024):
    seen = []
    def rec(self, model):
        seen.append((hashlib.sha256(str(model.Proto()).encode()).hexdigest(),
                     len(model.Proto().objective.vars)))
        return orig(self, model)
    cp_model.CpSolver.Solve = rec
    mod.solve_from_dict(make_config(seed=seed))
    cp_model.CpSolver.Solve = orig
    first_objective = next(n for _, n in seen[1:] if n > 1)
    print(seed, seen[0][0], first_objective)
EOF
```

Expected: three distinct 64-hex hashes; coefficient counts 574 / 568 / 578 (measured 2026-09-25).

- [ ] **Step 3: Write `gcf/test_inertness.py` with the golden in capture mode**

```python
"""
Inertness guards for the pinned-assignments delivery (spec
docs/superpowers/specs/2026-09-15-solver-pinned-assignments-design.md §7, §9).

The solver serves production AND dev from one Cloud Function, deployed from `main`
with no `preview` rehearsal. What makes a solver change safe to ship that way is that
a request with no `pinned` key builds the SAME MODEL it built before — these literals
were frozen from the pre-change code, so the change is measured against the past, not
against itself.

GOVERNANCE — the two goldens move for different reasons (spec §7):

  | literal                | moves when                 | legitimate re-capture                         |
  | STAGE_A_FINGERPRINTS   | the model construction     | a runner-image or ortools pin bump, in a PR    |
  |                        |                            | that changes nothing else                      |
  | GOLDEN_SCHEDULE        | the model OR the objective | the above, plus a deliberate, reviewed         |
  |                        |                            | objective change                               |

A red fingerprint inside a solver PR is a FINDING — the pinless path moved — and is
explained, never re-captured. Re-capture procedure: set the literal to None, push, read
the value from the CI log (the skip message), commit it, un-skip.
"""

import hashlib
import json
import unittest

from ortools.sat.python import cp_model

import owt_solver_v2 as mod
from test_owt_solver_v2 import make_config

# sha256(str(model.Proto())) of the FIRST solve — Stage A — on make_config(seed=s).
# str(), not SerializeToString(): CpModel.Proto() on ortools 9.15.6755 is a pybind
# proto with no SerializeToString.
STAGE_A_FINGERPRINTS = {
    1: "<64-hex from Step 2>",
    42: "<64-hex from Step 2>",
    2024: "<64-hex from Step 2>",
}

# Objective terms of the first OPTIMISING pass on make_config(seed=42). Per seed,
# because CP-SAT drops zero-coefficient tie-break terms from the proto. It catches a
# violation term with a NONZERO coefficient leaking into the pinless objective; a
# zero-coefficient leak is invisible to it (and to everything else) by construction.
OBJECTIVE_TERMS_SEED_42 = 568

# The schedule make_config(seed=42) returns, captured on the CI runner. None = capture mode.
GOLDEN_SCHEDULE = None


class _StopAfterStageA(Exception):
    """Raised from the Solve patch once Stage A's model is hashed: the rest is not needed."""


def _stage_a_hash(seed):
    original = cp_model.CpSolver.Solve
    captured = {}

    def capture(solver_self, model):
        captured["hash"] = hashlib.sha256(str(model.Proto()).encode()).hexdigest()
        raise _StopAfterStageA

    cp_model.CpSolver.Solve = capture
    try:
        mod.solve_from_dict(make_config(seed=seed))
    except _StopAfterStageA:
        pass
    finally:
        cp_model.CpSolver.Solve = original
    return captured["hash"]


class PinlessModelIsUnchanged(unittest.TestCase):
    """The primary guard: model identity, not output identity (spec §9)."""

    def test_stage_a_fingerprint(self):
        for seed, expected in STAGE_A_FINGERPRINTS.items():
            with self.subTest(seed=seed):
                self.assertEqual(
                    _stage_a_hash(seed), expected,
                    "the pinless Stage A model changed — this is a finding, not a literal "
                    "to update (see the module docstring)")


class PinlessOutputGolden(unittest.TestCase):
    """The second guard — weaker, because a tie can resolve differently across CPUs."""

    @classmethod
    def setUpClass(cls):
        solves = []
        original = cp_model.CpSolver.Solve

        def record(solver_self, model):
            status = original(solver_self, model)
            solves.append((solver_self.StatusName(status), len(model.Proto().objective.vars)))
            return status

        cp_model.CpSolver.Solve = record
        try:
            cls.res = mod.solve_from_dict(make_config(seed=42))
        finally:
            cp_model.CpSolver.Solve = original
        cls.solves = solves

    def test_the_returning_solve_proved_optimality(self):
        """
        The precondition that makes a golden meaningful: the time limit did not bind.
        If a loaded runner trips this, RAISE THE FIXTURE'S BUDGET — never drop the
        assertion or the golden (spec §7).
        """
        self.assertTrue(self.res["ok"], self.res.get("error"))
        self.assertEqual(self.solves[-1][0], "OPTIMAL", f"solves: {self.solves}")

    def test_schedule_matches_the_golden(self):
        schedule = json.dumps(self.res["schedule"], sort_keys=True)
        if GOLDEN_SCHEDULE is None:
            self.skipTest(f"capture: statuses={self.solves} schedule={schedule}")
        self.assertEqual(self.res["schedule"], GOLDEN_SCHEDULE)

    def test_objective_term_count(self):
        optimising = [n for _status, n in self.solves[1:] if n > 1]
        self.assertTrue(optimising, f"no optimising pass ran: {self.solves}")
        self.assertEqual(optimising[0], OBJECTIVE_TERMS_SEED_42)

    def test_new_response_fields_absent_or_inert(self):
        """Before the pin change: absent. After it: pinned_honored 0, pin_violations empty,
        violation_ceiling_proven absent. Either way nothing here may say a pin mattered."""
        self.assertEqual(self.res.get("pinned_honored", 0), 0)
        self.assertEqual(self.res.get("pin_violations", []), [])
        self.assertNotIn("violation_ceiling_proven", self.res)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 4: Run locally**

Run: `$SP/venv/bin/python -m unittest discover -s gcf -t gcf -v 2>&1 | tail -20`
Expected: all pass, `test_schedule_matches_the_golden` SKIPPED with a `capture:` message.

- [ ] **Step 5: `docs/CI.md` section, commit, push, open the PR**

Add under the existing solver-step description:

```markdown
### Solver inertness goldens (`gcf/test_inertness.py`)

The Cloud Function deploys from `main` with no `preview` rehearsal, so a solver change is safe
only if a request with no `pinned` key builds the model it built before. Two literals freeze that:

| Literal | Moves when | Legitimate re-capture |
|---|---|---|
| `STAGE_A_FINGERPRINTS` | the model construction changes | a runner-image or ortools pin bump, in a PR that changes nothing else |
| `GOLDEN_SCHEDULE` | the model **or** the objective changes | the above, plus a deliberate, reviewed objective change |

A red fingerprint inside a solver PR is a finding, never a literal to update. Re-capture: set the
literal to `None`, push, read it from the test's skip message in this job's log, commit it.
```

```bash
git add gcf/test_inertness.py docs/CI.md
git commit -m "test(solver): freeze the pinless Stage A model before pins land

The pinned-assignments delivery changes build_slots, build_candidate_map,
validate_config and all three hard spreads, and ships to production with no
preview rehearsal. Its safety argument is that a pinless request builds the
same model as today — which needs a literal captured from today's code, not
from the change. Output golden lands in capture mode; the runner fills it."
git push -u origin claude/solver-inertness-goldens
gh pr create --base main --title "test(solver): freeze the pinless Stage A model before pins land" --body "<why; note: a gcf/** PR fires Cloud Build with identical solver source — harmless>"
```

- [ ] **Step 6: Read the capture from the CI log, commit the literal**

```bash
gh run list --branch claude/solver-inertness-goldens --limit 1
gh run view <run-id> --log | grep -o 'capture: .*' | head -1
```

Confirm the log's statuses end in `OPTIMAL` and the fingerprints passed (they were pre-filled).
Paste the schedule JSON as the `GOLDEN_SCHEDULE` dict literal, commit
(`test(solver): commit the output golden the CI runner captured`), push, wait for green.

- [ ] **Step 7: Release it the CLAUDE.md way**

Fresh code review of the PR diff (read-only `code-reviewer` agent) → merge the branch into
`preview`, push, verify the dev alias (`alias` + `meta.githubCommitSha`) → Frank merges the PR →
`gcloud functions describe owt-solver --gen2 --region=us-central1 --format='value(updateTime)'`
is after the merge (identical source; this proves only that Cloud Build still works).

---

### Task 2: The request contract — `pinned` parsed, validated, and the handshake emitted

**Files:**
- Modify: `gcf/owt_solver_v2.py` (constants, `ScheduleConfig`, `SolveResult`, new `parse_pins`,
  `validate_config`, `solve_schedule` call site, `solve_from_dict`)
- Create: `gcf/test_pinned_assignments.py`

**Interfaces:**
- Produces: `Pin = Tuple[str, str, int]` (person, role, week); `PINNED_CAP = 100`;
  `SERVICE_TOKEN`; `service_of(role) -> str`; `parse_pins(raw, weeks, weekends_w_sat) -> List[Pin]`;
  `validate_config(config) -> (all_people, pools, pins, pinned_only)`;
  `SolveResult.pinned_honored/pin_violations/violations_used/violation_ceiling_proven`;
  `ScheduleConfig.pinned: List[Dict] | None = None`.

- [ ] **Step 1: Write the test file skeleton and the Task 2 tests**

```python
"""
Pinned assignments — docs/superpowers/specs/2026-09-15-solver-pinned-assignments-design.md.

Each test is a claim §5 makes, run against the real solver. Run from the repo root the
way CI does:  python -m unittest discover -s gcf -t gcf -v

What these tests deliberately never assert (spec §7): the three *_fairness_relaxed
flags, a pinned person's own total, or equivalence between a pin and a DSL rule.
"""

import unittest

from ortools.sat.python import cp_model

import owt_solver_v2 as mod
from owt_solver_v2 import solve_from_dict

# §5.1's fixture, verbatim: 12 people, four weeks, a Saturday every week, no rules —
# 52 slots, baseline totals [4,4,4,4,4,4,4,4,5,5,5,5], limits (1, 1, 1).
SUNDAY_LEADS = ["Hugo", "Niza", "Lucia", "Rachel"]
SATURDAY_LEADS = ["Tono"]
SUPPORT = ["Jakey", "Gaby", "Liu", "Marianne", "Vale", "Dani", "Pau"]
EVERYONE = SUNDAY_LEADS + SATURDAY_LEADS + SUPPORT
BIG = 52 + 1   # solve_schedule's `big`: a reported limit this size is the stage_a fall-through

SEAT = {"Sun.Lead": ("Sunday", "Lead"), "Sun.BGV": ("Sunday", "BGV"),
        "Sun.Choir": ("Sunday", "Choir"), "Sat.Lead": ("Saturday", "Lead"),
        "Sat.BGV": ("Saturday", "BGV")}
ROLE = {v: k for k, v in SEAT.items()}


def fixture(seed=42, rules=(), pinned=None, **overrides):
    data = dict(
        weeks=4, weekends_with_saturday=[1, 2, 3, 4],
        sunday_leads=list(SUNDAY_LEADS), saturday_leads=list(SATURDAY_LEADS),
        support=list(SUPPORT), dsl_rules=list(rules), history=[],
        seed=seed, solver_max_time_seconds=5,
    )
    if pinned is not None:
        data["pinned"] = pinned
    data.update(overrides)
    return data


def pin(person, role, week):
    return {"person": person, "role": role, "week": week}


def unavailable(person, week):
    """How plannerModel compiles an unavailable weekend: both services, hard."""
    return [f"{person} !in week {week} Sun.*", f"{person} !in week {week} Sat.*"]


def seated(res, week, role):
    service, seat = SEAT[role]
    return res["schedule"][str(week)].get(service, {}).get(seat, [])


def cells_of(res, person):
    return sorted((int(w), ROLE[(svc, seat)])
                  for w, services in res["schedule"].items()
                  for svc, seats in services.items()
                  for seat, names in seats.items() if person in names)


def instrumented(data):
    """solve_from_dict plus the returned SolveResult and every pass's (kwargs, result)."""
    captured, seen = {}, []
    orig_schedule, orig_pass = mod.solve_schedule, mod.create_model_and_solve

    def schedule(config):
        captured["result"] = orig_schedule(config)
        return captured["result"]

    def one_pass(**kwargs):
        result = orig_pass(**kwargs)
        seen.append((kwargs, result))
        return result

    mod.solve_schedule, mod.create_model_and_solve = schedule, one_pass
    try:
        res = solve_from_dict(data)
    finally:
        mod.solve_schedule, mod.create_model_and_solve = orig_schedule, orig_pass
    return res, captured.get("result"), seen


class RequestValidation(unittest.TestCase):
    """§6: every refusal is a ValueError, so it reaches the caller as ok:false, never a 500."""

    def refused(self, pinned, **overrides):
        res = solve_from_dict(fixture(pinned=pinned, **overrides))
        self.assertFalse(res["ok"], "expected a refusal")
        return res["error"]

    def test_malformed_entries_are_refused(self):
        for bad in (["Hugo"], [{"role": "Sun.Lead", "week": 1}],
                    [{"person": "Hugo", "role": "Sun.Lead", "week": "1"}],
                    [{"person": 7, "role": "Sun.Lead", "week": 1}],
                    [{"person": "  ", "role": "Sun.Lead", "week": 1}],
                    [{"person": "Hugo", "role": "Sun.Lead", "week": True}],
                    {"person": "Hugo", "role": "Sun.Lead", "week": 1}):
            with self.subTest(bad=bad):
                self.refused(bad)

    def test_over_the_cap_is_refused_not_truncated(self):
        pins = [pin(f"P{i}", "Sun.Choir", 1) for i in range(mod.PINNED_CAP + 1)]
        self.assertIn(str(mod.PINNED_CAP), self.refused(pins))

    def test_the_cap_itself_parses(self):
        pins = [pin(f"P{i}", "Sun.Choir", 1) for i in range(mod.PINNED_CAP)]
        self.assertEqual(len(mod.parse_pins(pins, 4, [1, 2, 3, 4])), mod.PINNED_CAP)

    def test_unknown_role(self):
        self.assertIn("Sun.Coro", self.refused([pin("Hugo", "Sun.Coro", 1)]))

    def test_week_outside_the_month(self):
        for week in (0, 5):
            with self.subTest(week=week):
                self.assertIn(f"week {week}", self.refused([pin("Hugo", "Sun.Lead", week)]))

    def test_saturday_pin_on_a_week_without_saturday(self):
        err = self.refused([pin("Tono", "Sat.Lead", 1)], weekends_with_saturday=[2, 4])
        self.assertIn("week 1", err)

    def test_two_pins_one_person_one_service(self):
        err = self.refused([pin("Hugo", "Sun.Lead", 2), pin("Hugo", "Sun.BGV", 2)])
        self.assertIn("Hugo", err)
        self.assertIn("Sunday", err)

    def test_one_person_on_both_services_of_a_weekend_is_fine(self):
        res = solve_from_dict(fixture(pinned=[pin("Hugo", "Sun.Lead", 2), pin("Hugo", "Sat.Lead", 2)]))
        self.assertTrue(res["ok"], res.get("error"))
        self.assertEqual(res["pinned_honored"], 2)

    def test_exact_duplicates_collapse(self):
        res = solve_from_dict(fixture(pinned=[pin("Gaby", "Sun.BGV", 1)] * 2))
        self.assertTrue(res["ok"], res.get("error"))
        self.assertEqual(res["pinned_honored"], 1)
        self.assertEqual(len(seated(res, 1, "Sun.BGV")), 3, "a duplicate grew the row")


class PinlessResponse(unittest.TestCase):
    """§4: pinned_honored always present (the deploy check reads it); the other two inert."""

    def test_fields_on_a_pinless_request(self):
        for data in (fixture(), fixture(pinned=[])):
            with self.subTest(pinned=data.get("pinned")):
                res = solve_from_dict(data)
                self.assertTrue(res["ok"], res.get("error"))
                self.assertEqual(res["pinned_honored"], 0)
                self.assertEqual(res["pin_violations"], [])
                self.assertNotIn("violation_ceiling_proven", res)

    def test_no_solve_zero_without_pins(self):
        _res, _result, seen = instrumented(fixture())
        self.assertFalse(any(k.get("violation_objective_only") for k, _ in seen))
        self.assertTrue(seen[0][0].get("empty_objective_only"), "Stage A must be the first solve")
```

- [ ] **Step 2: Run to verify failure**

Run: `$SP/venv/bin/python -m unittest gcf.test_pinned_assignments -v` from the repo root won't
resolve the bare import — use `cd gcf && $SP/venv/bin/python -m unittest test_pinned_assignments -v`.
Expected: FAIL/ERROR (`PINNED_CAP`, `parse_pins`, `pinned_honored` missing; unknown key ignored).

- [ ] **Step 3: Implement**

Imports: `from dataclasses import dataclass, field` and add `Callable` to the `typing` import.

After `SATURDAY_SERVICE = "Saturday"`:

```python
# pin_violations' service token. It matches the `pinned.role` prefixes a reader compares
# an entry against (`Sun.Lead`, `Sat.BGV`), not unfilled_seats' Sunday/Saturday — so it
# is MAPPED from the service constants, never interpolated (spec §4).
SERVICE_TOKEN = {SUNDAY_SERVICE: "Sun", SATURDAY_SERVICE: "Sat"}

# Longest `pinned` array accepted. Over it the request is REFUSED, never truncated: a
# dropped pin is a seat the admin asked to keep (spec §6). Rows grow to fit their pins,
# so this is what bounds what one request can make the solver allocate.
PINNED_CAP = 100

# (person, role, week) — one seat already decided on the board.
Pin = Tuple[str, str, int]
```

`ScheduleConfig`, after `discourage_consecutive_role_repeats`:

```python
    # Seats already on the board that the solver must keep (spec 2026-09-15). The raw
    # request array; validate_config parses and checks it.
    pinned: List[Dict] | None = None
```

`SolveResult`, after `objective_skipped`:

```python
    # Pinned assignments. All three per-pass values are derived from THIS pass's
    # assignment — never echoed from the request, never read off a violation boolean.
    pinned_honored: int = 0
    pin_violations: List[str] = field(default_factory=list)
    violations_used: int | None = None    # n_viol's value; None when no pins
    # Set by solve_schedule, not by a pass: did solve 0 prove its minimum? None on a
    # pinless request, where the response omits the field.
    violation_ceiling_proven: bool | None = None
```

After `is_eligible`:

```python
def service_of(role_type: str) -> str:
    return SATURDAY_SERVICE if role_type in SATURDAY_ROLES else SUNDAY_SERVICE


def parse_pins(raw, weeks: int, weekends_w_sat: Sequence[int]) -> List[Pin]:
    """
    Shape- and range-check the request's `pinned` array (spec §6). Every refusal is a
    ValueError, because solve_from_dict turns those into `ok: false`; a TypeError or
    KeyError would escape it and reach the admin as an HTTP 500.

    Exact duplicates collapse (the pin set is a set); two DIFFERENT pins for one person
    in one service are refused — the one-seat-per-service limit makes them unsatisfiable
    together, and two `== 1` constraints against it would fail the month instead.
    """
    if raw is None:
        return []
    if not isinstance(raw, list):
        raise ValueError("pinned must be a list of {week, role, person} objects.")
    if len(raw) > PINNED_CAP:
        raise ValueError(
            f"pinned has {len(raw)} entries; at most {PINNED_CAP} are accepted.")
    sat_weeks = set(normalize_weekend_indexes(weeks, weekends_w_sat))
    pins: List[Pin] = []
    seen: Set[Pin] = set()
    seat_in_service: Dict[Tuple[str, int, str], str] = {}
    for i, entry in enumerate(raw):
        if not isinstance(entry, dict):
            raise ValueError(f"pinned[{i}] must be an object with week, role and person.")
        week, role, person = entry.get("week"), entry.get("role"), entry.get("person")
        if isinstance(week, bool) or not isinstance(week, int):
            raise ValueError(f"pinned[{i}].week must be an integer, got {week!r}.")
        if role not in ALL_ROLE_TYPES:
            raise ValueError(f"pinned[{i}] names an unknown role {role!r}; roles are {ROLE_ORDER}.")
        if not isinstance(person, str) or not person.strip():
            raise ValueError(f"pinned[{i}].person must be a non-empty name, got {person!r}.")
        if not 1 <= week <= weeks:
            raise ValueError(
                f"pinned[{i}] references week {week}, but the month has {weeks} weeks.")
        if role in SATURDAY_ROLES and week not in sat_weeks:
            raise ValueError(
                f"pinned[{i}] pins {role} in week {week}, which has no Saturday service.")
        key = (person, role, week)
        if key in seen:
            continue
        service = service_of(role)
        other = seat_in_service.get((person, week, service))
        if other is not None:
            raise ValueError(
                f"pinned seats {person} twice in week {week}'s {service} service "
                f"({other} and {role}); one person holds one seat per service.")
        seat_in_service[(person, week, service)] = role
        seen.add(key)
        pins.append(key)
    return pins
```

`validate_config` — replace the tail from `known = set(all_people)`:

```python
    # Pins join all_people only AFTER pools exist: three of the five pools are
    # set(all_people), so an earlier union would make a pinned person a BGV and Choir
    # candidate in every service of the month (spec §5.1 — reproduced: one pin became
    # four services). They join no pool; the pin itself grants candidacy, only where it
    # points. The exclusivity guard above compares the three lists and is untouched.
    pins = parse_pins(config.pinned, config.weeks, config.weekends_w_sat)
    pinned_only = {p for p, _, _ in pins} - set(all_people)
    if pinned_only:
        all_people = sorted(set(all_people) | pinned_only)

    # After the union, so a DSL clause may name a pinned-only person and both
    # parse_dsl_rules call sites see the same set.
    known = set(all_people)
    parse_dsl_rules(config.dsl_restrictions, known)
    return all_people, pools, pins, pinned_only
```

Signature: `-> Tuple[List[str], Dict[str, Set[str]], List[Pin], Set[str]]`.

`solve_schedule`: `all_people, pools, pins, pinned_only = validate_config(config)`.

`create_model_and_solve` — new keyword parameters after `pass_info` (all later tasks use them):

```python
    pins: Sequence[Pin] = (),
    soft: bool = False,
    violation_objective_only: bool = False,
    violation_target: int | None = None,
```

and add `pins=pins` to `common` in `solve_schedule`. Post-solve, after `assignments` is built:

```python
    # Derived from the solved assignment, never echoed from the request: a pin counts
    # only if the person really holds a slot of that role that week (spec §4).
    pinned_honored = sum(
        1 for person, role, week in pins
        if any(s.role_type == role and s.week == week for s in assignments[person]))
```

and pass `pinned_honored=pinned_honored` to `SolveResult(...)`.

`solve_from_dict`: add `pinned=data.get("pinned"),` to the `ScheduleConfig(...)` call, then build
the response in a variable:

```python
    response = {
        ...every existing key unchanged...,
        # Emitted on EVERY response, 0 without pins: its PRESENCE is how the client and the
        # deploy check tell this solver from one that silently ignores `pinned` (§4, §9).
        "pinned_honored": result.pinned_honored,
        # The rules the pins forced aside, in §4's normative grammar. Empty without pins.
        "pin_violations": list(result.pin_violations),
    }
    # Absent without pins: solve 0 never ran and there is nothing to prove.
    if result.violation_ceiling_proven is not None:
        response["violation_ceiling_proven"] = result.violation_ceiling_proven
    return response
```

- [ ] **Step 4: Run** `cd gcf && $SP/venv/bin/python -m unittest test_pinned_assignments -v`.
Expected: `RequestValidation` and `PinlessResponse` PASS except any case needing Task 3 (pins are
parsed but not yet modelled — `test_one_person_on_both_services…` and `test_exact_duplicates…`
report `pinned_honored` 0 until Task 3; that is expected, note it and move on).

- [ ] **Step 5: Fingerprint check, then commit**

Run `test_inertness` against this tree (copy it from the Task 1 branch if not yet merged:
`git show claude/solver-inertness-goldens:gcf/test_inertness.py > gcf/test_inertness.py`, do not
commit it here). Expected: fingerprints green.

```bash
git add gcf/owt_solver_v2.py gcf/test_pinned_assignments.py
git commit -m "feat(solver): accept and validate a pinned array"
```

---

### Task 3: A pin is a fixed variable — candidacy, rows, pinned-only people, week exclusion

**Files:** Modify `gcf/owt_solver_v2.py` (`build_slots`, `build_candidate_map`, `solve_schedule`
fairness groups, `create_model_and_solve` pin constraint and week exclusion); append tests.

**Interfaces:** Consumes `Pin`, `pins` kwarg. Produces `build_slots(config, pins=())`,
`build_candidate_map(..., seed, pins=())`.

- [ ] **Step 1: Append the tests**

```python
class PinsAreSeated(unittest.TestCase):

    def test_a_pin_is_seated_and_counted(self):
        res = solve_from_dict(fixture(pinned=[pin("Gaby", "Sun.BGV", 1)]))
        self.assertTrue(res["ok"], res.get("error"))
        self.assertIn("Gaby", seated(res, 1, "Sun.BGV"))
        self.assertEqual(res["pinned_honored"], 1)
        self.assertEqual(res["pin_violations"], [])

    def test_a_pin_beats_unavailability_on_its_own_row_only(self):
        """E3's guaranteed collision, end to end — and the other service stays excluded."""
        rules = unavailable("Gaby", 2)
        without = solve_from_dict(fixture(rules=rules))
        self.assertTrue(without["ok"], without.get("error"))
        self.assertEqual([c for c in cells_of(without, "Gaby") if c[0] == 2], [])

        res = solve_from_dict(fixture(rules=rules, pinned=[pin("Gaby", "Sun.Choir", 2)]))
        self.assertTrue(res["ok"], res.get("error"))
        self.assertEqual([c for c in cells_of(res, "Gaby") if c[0] == 2], [(2, "Sun.Choir")])
        self.assertEqual(res["pin_violations"], [], "a week exclusion is scoped, not relaxed")

    def test_a_pinned_person_in_no_pool_is_seated_only_at_the_pin(self):
        """The reproduced KeyError at assignments[person], kept as a guard — and the union's
        placement: before `pools` it granted one pinned person three extra services."""
        without = solve_from_dict(fixture())
        self.assertNotIn("Zoe", without["total_counts"])
        res = solve_from_dict(fixture(pinned=[pin("Zoe", "Sun.Choir", 3)]))
        self.assertTrue(res["ok"], res.get("error"))
        self.assertEqual(cells_of(res, "Zoe"), [(3, "Sun.Choir")])
        self.assertEqual(res["total_counts"]["Zoe"], 1)
        self.assertEqual(sum(res["role_counts"]["Zoe"].values()), 1)

    def test_over_pinning_grows_the_row(self):
        res = solve_from_dict(fixture(pinned=[pin(p, "Sun.Lead", 1) for p in SUNDAY_LEADS]))
        self.assertTrue(res["ok"], res.get("error"))
        self.assertEqual(sorted(seated(res, 1, "Sun.Lead")), sorted(SUNDAY_LEADS))
        self.assertEqual(res["pinned_honored"], 4)
        self.assertFalse([u for u in res["unfilled_seats"] if u.startswith("W1 Sunday Sun.Lead")])
        self.assertLessEqual(len(seated(res, 2, "Sun.Lead")), 2, "only the pinned row grows")

    def test_growth_keeps_the_bgv_choir_interleave(self):
        cfg = mod.ScheduleConfig(weeks=3, weekends_w_sat=[], sunday_leads_pool=["A"],
                                 saturday_leads_pool=[], support_pool=[], dsl_restrictions=[],
                                 history=[])
        pins = [(f"P{i}", "Sun.Choir", 1) for i in range(5)]
        week1 = [s.key for s in mod.build_slots(cfg, pins) if s.week == 1]
        self.assertEqual(week1, [
            "W1.Sun.Lead.1", "W1.Sun.Lead.2",
            "W1.Sun.BGV.1", "W1.Sun.Choir.1", "W1.Sun.BGV.2", "W1.Sun.Choir.2",
            "W1.Sun.BGV.3", "W1.Sun.Choir.3", "W1.Sun.Choir.4", "W1.Sun.Choir.5"])

    def test_granted_candidacy_is_appended_after_the_shuffle(self):
        slots = [mod.Slot(1, "Sunday", "Sun.Lead", 1)]
        pools = {"Sun.Lead": {"A", "B", "C"}}
        forbidden = {p: set() for p in ("A", "B", "C", "Z")}
        grown = mod.build_candidate_map(["A", "B", "C", "Z"], pools, forbidden, slots, 7,
                                        [("Z", "Sun.Lead", 1), ("A", "Sun.Lead", 1)])
        self.assertEqual(grown["W1.Sun.Lead.1"][-1], "Z")
        self.assertEqual(grown["W1.Sun.Lead.1"].count("A"), 1, "an eligible pin is not appended twice")


class PinnedOnlyPeopleStayOutOfFairness(unittest.TestCase):
    """§5.1: a person the solver cannot place anywhere must not set gmin for everyone."""

    def first_pass(self, data):
        _res, _result, seen = instrumented(data)
        return seen[0][0]

    def test_excluded_from_strict_and_relaxed(self):
        # The DSL names a pinned-only person — legal because `known` is built after the union.
        kw = self.first_pass(fixture(rules=unavailable("Zoe", 1), pinned=[pin("Zoe", "Sun.Choir", 3)]))
        self.assertNotIn("Zoe", kw["global_fairness_people"])
        self.assertNotIn("Zoe", kw["global_fairness_slack"])

    def test_excluded_from_the_collapse_rebuild(self):
        # Every pool member but Hugo carries slack, so `strict` falls below two and is rebuilt.
        rules = [f"{p} fairness_slack 1" for p in EVERYONE if p != "Hugo"]
        kw = self.first_pass(fixture(rules=rules, pinned=[pin("Zoe", "Sun.Choir", 3)]))
        self.assertEqual(kw["global_fairness_slack"], {}, "the collapse branch was not reached")
        self.assertEqual(sorted(kw["global_fairness_people"]), sorted(EVERYONE))
```

- [ ] **Step 2: Run to verify failure** — expected: pins not seated, `KeyError` on Zoe, signature errors.

- [ ] **Step 3: Implement**

`build_slots` (replace whole function):

```python
def build_slots(config: ScheduleConfig, pins: Sequence[Pin] = ()) -> List[Slot]:
    """
    Every seat of the month. A row holds max(default, pins in that row): pin three leads
    where there are two seats and the row grows to three, so over-pinning is never an
    infeasibility; it never shrinks (spec §5.1).

    Sun.BGV and Sun.Choir are emitted INTERLEAVED, one loop to the larger count, each row
    appending only while its own count allows. The pinless inertness fingerprint depends
    on it: slot order is x's insertion order, which the seeded tie-break reads, so
    rewriting this per role changes the board of every un-pinned month.
    """
    per_row: Dict[Tuple[str, int], int] = defaultdict(int)
    for _person, role, week in pins:
        per_row[(role, week)] += 1

    def seats(role: str, week: int, default: int) -> int:
        return max(default, per_row.get((role, week), 0))

    slots: List[Slot] = []
    sat_weeks = set(normalize_weekend_indexes(config.weeks, config.weekends_w_sat))
    for week in range(1, config.weeks + 1):
        for i in range(1, seats("Sun.Lead", week, 2) + 1):
            slots.append(Slot(week, SUNDAY_SERVICE, "Sun.Lead", i))
        n_bgv, n_choir = seats("Sun.BGV", week, 3), seats("Sun.Choir", week, 3)
        for i in range(1, max(n_bgv, n_choir) + 1):
            if i <= n_bgv:
                slots.append(Slot(week, SUNDAY_SERVICE, "Sun.BGV", i))
            if i <= n_choir:
                slots.append(Slot(week, SUNDAY_SERVICE, "Sun.Choir", i))
        if week in sat_weeks:
            for i in range(1, seats("Sat.Lead", week, 2) + 1):
                slots.append(Slot(week, SATURDAY_SERVICE, "Sat.Lead", i))
            for i in range(1, seats("Sat.BGV", week, 3) + 1):
                slots.append(Slot(week, SATURDAY_SERVICE, "Sat.BGV", i))
    return slots
```

`build_candidate_map` — add `pins: Sequence[Pin] = ()` and:

```python
    # A pin grants candidacy in its own (role, week) and nowhere else, so a pinned person
    # in no pool — or whose Tipo was cleared (ADR-0029) — is seated exactly where the admin
    # seated them. APPENDED after the shuffled eligibles, sorted, and only when not already
    # eligible: inserting into the shuffle would move other people's draws, and a second
    # entry for one person would be counted twice by `filled`.
    granted: Dict[Tuple[str, int], List[str]] = defaultdict(list)
    for person, role, week in pins:
        granted[(role, week)].append(person)
    for slot in slots:
        eligible = [p for p in people if is_eligible(p, slot.role_type, pools, forbidden)]
        for p in sorted(granted.get((slot.role_type, slot.week), ())):
            if p not in eligible:
                eligible.append(p)
        result[slot.key] = eligible
```

(keep the existing comment about empty candidate lists.)

`solve_schedule` — fairness groups:

```python
    # Pinned-only people are outside every fairness group: the solver cannot choose them
    # anywhere, so letting one set gmin would cap everyone else (spec §5.1). That holds in
    # `relaxed` (an absence exclusion would put them there) and in the collapse rebuild,
    # which would otherwise read them back in from all_people on exactly the thin months
    # where it fires. The per-role groups need nothing: is_eligible reads the pools.
    fairness_people = [p for p in all_people if p not in pinned_only]
    strict = [p for p in fairness_people if p not in fairness_exempt and combined_slack.get(p, 0) == 0]
    relaxed = {p: combined_slack[p] for p in fairness_people
               if p not in fairness_exempt and combined_slack.get(p, 0) > 0}
    if len(strict) < 2:
        strict = [p for p in fairness_people if p not in fairness_exempt]
        relaxed = {}
```

`slots = build_slots(config, pins)`; `candidates = build_candidate_map(all_people, pools, forbidden, slots, config.seed, pins)`.

`create_model_and_solve` — right after the `filled` loop:

```python
    pin_set = set(pins)
    # A pin is a fixed variable, not a removed seat (spec §5): every mechanism below that
    # counts people or iterates slots — totals, role counts, DSL caps, the Saturday anchor,
    # weekly presence, `filled`, occupancy, the consecutive penalty, the response view —
    # sees it with no further code.
    for person, role, week in pins:
        model.Add(sum(x[(person, s.key)] for s in slots
                      if s.week == week and s.role_type == role) == 1)
```

Week exclusion — inside `if slot.week == rule.week and slot.role_type in rule.role_types:`,
before the `x` check:

```python
                # Not applied to a pinned person's own row: the pin overrides their
                # unavailability there and only there — every other slot that week stays
                # excluded, so a Sunday pin does not free them for Saturday (spec §5.2).
                if (rule.person, slot.role_type, slot.week) in pin_set:
                    continue
```

- [ ] **Step 4: Run** the new classes + Task 2's; all PASS. Run `test_inertness` (fingerprint green)
and `test_owt_solver_v2` (unchanged, green).

- [ ] **Step 5: Commit** `feat(solver): seat pins as fixed variables with scoped candidacy`

---

### Task 4: Service-keyed pin slack on the three hard spreads

**Files:** Modify `gcf/owt_solver_v2.py` (new `pin_slack`, global loops, Sun.Lead, Sun.BGV); append tests.

**Interfaces:** Produces `pin_slack(pins, spread_role: str | None) -> Dict[str, int]` — module-level
so the control can swap it.

- [ ] **Step 1: Append the tests**

```python
def baseline_band(seed):
    res = solve_from_dict(fixture(seed=seed))
    assert res["ok"], res.get("error")
    return min(res["total_counts"].values()), max(res["total_counts"].values())


class FairnessUnderPins(unittest.TestCase):
    """
    §5.1/§7: the un-pinned members IN THE FAIRNESS GROUPS stay inside the un-pinned
    baseline's spread. The fixture has no fairness_exempt member, so that is everyone
    un-pinned; an exempt member would be outside every bound and asserted nothing about.
    """

    @classmethod
    def setUpClass(cls):
        cls.band = {seed: baseline_band(seed) for seed in (1, 42)}

    def assert_group_holds(self, data, pinned_people, seed):
        res, result, _ = instrumented(data)
        self.assertTrue(res["ok"], res.get("error"))
        self.assertEqual(res["pinned_honored"], len(data["pinned"]))
        self.assertNotEqual(result.fairness_limit_used, BIG, "fell through to the fairness-free stage_a")
        lo, hi = self.band[seed]
        for p in EVERYONE:
            if p not in pinned_people:
                self.assertTrue(lo <= res["total_counts"][p] <= hi,
                                f"{p}: {res['total_counts'][p]} outside baseline [{lo}, {hi}]")

    def test_skewed_partial_pin_leaves_everyone_else_alone(self):
        for row in ("Sun.Lead", "Sun.BGV", "Sun.Choir"):
            for k in (1, 2, 3):
                with self.subTest(row=row, pins=k):
                    pins = [pin("Rachel", row, w) for w in range(1, k + 1)]
                    self.assert_group_holds(fixture(seed=42, pinned=pins), {"Rachel"}, 42)
        with self.subTest(seed=1):
            pins = [pin("Rachel", "Sun.Lead", w) for w in (1, 2, 3)]
            self.assert_group_holds(fixture(seed=1, pinned=pins), {"Rachel"}, 1)

    def test_a_full_row_pin_for_a_lead_pool_member_and_a_support_member(self):
        """Pool membership is the discriminator, not the row's seat count (§5.1)."""
        for row in ("Sun.Lead", "Sun.BGV", "Sun.Choir"):
            for person in ("Hugo", "Vale"):
                with self.subTest(row=row, person=person):
                    pins = [pin(person, row, w) for w in range(1, 5)]
                    self.assert_group_holds(fixture(seed=42, pinned=pins), {person}, 42)

    def test_role_keyed_slack_is_a_failing_control(self):
        """
        The rejected role-keyed slack MUST collapse the lead-pool case, or the guard above
        proves nothing. Three-seat rows only: measured, Sun.Lead does not collapse under
        either form, so a control there fails to fail — never weaken this to make it pass.
        """
        def role_keyed(pins, spread_role):
            counts = {}
            for person, role, _week in pins:
                if spread_role is None or role == spread_role:
                    counts[person] = counts.get(person, 0) + 1
            return counts

        original = mod.pin_slack
        mod.pin_slack = role_keyed
        try:
            for row in ("Sun.BGV", "Sun.Choir"):
                with self.subTest(row=row):
                    pins = [pin("Hugo", row, w) for w in range(1, 5)]
                    res, result, _ = instrumented(fixture(seed=42, pinned=pins))
                    self.assertTrue(res["ok"], res.get("error"))
                    self.assertEqual(result.fairness_limit_used, BIG,
                                     "role-keyed slack did not collapse: the control is vacuous")
        finally:
            mod.pin_slack = original

    def test_heavy_pin_load_keeps_absence_slack(self):
        """30 pins on 12 people — where routing pins through combined_slack would have emptied
        `strict` and discarded every absence's slack (the rejected design, §5.1)."""
        rules = unavailable("Marianne", 2)
        base = solve_from_dict(fixture(rules=rules))
        self.assertTrue(base["ok"], base.get("error"))
        pins = [pin(p, ROLE[(svc, seat)], int(w))
                for w, services in sorted(base["schedule"].items(), key=lambda t: int(t[0]))
                for svc, seats in services.items() for seat, names in seats.items()
                for p in names if p != "Marianne"][:30]
        self.assertEqual(len(pins), 30)
        res, _result, seen = instrumented(fixture(rules=rules, pinned=pins))
        self.assertTrue(res["ok"], res.get("error"))
        self.assertEqual(seen[0][0]["global_fairness_slack"].get("Marianne"), 2)
```

- [ ] **Step 2: Run to verify failure** — `AttributeError: pin_slack` in the control; expect the
lead-pool full-row cases on `Sun.BGV`/`Sun.Choir` to fail too.

- [ ] **Step 3: Implement**

After `service_of`:

```python
def pin_slack(pins: Sequence[Pin], spread_role: str | None) -> Dict[str, int]:
    """
    Per-person slack a pin earns on one HARD spread (spec §5.1). `None` is the global
    spread, where every pin counts. Otherwise the person's pins in the SERVICE that
    `spread_role` belongs to — the service, not the role: one seat per service means a
    pin in any Sunday role zeroes the person in every other Sunday role that week, so a
    role-keyed count gave a lead-pool member pinned into Choir no slack on the very
    spread the pin tightens, and the month fell through to the fairness-free stage_a with
    a member on zero services (measured on four seeds).

    Slack, not subtraction: `t <= max + n`, `t >= min - n` lets the pins count as service
    already performed; `t - n` bounded by max/min would demand a full share on top of them.
    """
    counts: Dict[str, int] = defaultdict(int)
    for person, role, _week in pins:
        if spread_role is None or service_of(role) == service_of(spread_role):
            counts[person] += 1
    return dict(counts)
```

Global loops:

```python
        g_pins = pin_slack(pins, None)
        for p in global_fairness_people:
            model.Add(total_vars[p] <= gmax + g_pins.get(p, 0))
            model.Add(total_vars[p] >= gmin - g_pins.get(p, 0))
        for p, slack in global_fairness_slack.items():
            # Adds to their absence / authored slack; it does not replace it.
            model.Add(total_vars[p] <= gmax + slack + g_pins.get(p, 0))
            model.Add(total_vars[p] >= gmin - slack - g_pins.get(p, 0))
```

Sun.Lead: before the loop `sl_pins = pin_slack(pins, "Sun.Lead")`; in it
`rslack = role_fairness_slack.get((p, "Sun.Lead"), 0) + sl_pins.get(p, 0)`.
Sun.BGV: `sb_pins = pin_slack(pins, "Sun.BGV")`; `rslack = role_fairness_slack.get((p, "Sun.BGV"), 0) + sb_pins.get(p, 0)`.

The soft terms (`ov_total`, `overall_spread`, `role_spread_vars`) are deliberately unchanged.

- [ ] **Step 4: Run** — FairnessUnderPins PASS, **fingerprint green** (the spec claims
`t <= g + 0` serialises identically to `t <= g`; if it does not, emit the `+ n` only when
`n` is nonzero and record the finding). All earlier suites green.

- [ ] **Step 5: Commit** `feat(solver): give pins service-keyed slack on the hard spreads`

---

### Task 5: Soft relaxation under pins, the report, and the proven ceiling

**Files:** Modify `gcf/owt_solver_v2.py` (new `relaxation_enabled`; lead, anchor, pair, presence,
consecutive, count; `n_viol`; objective branches; post-solve; `solve_schedule` solve 0 and ceiling);
append tests.

**Interfaces:** Produces `relaxation_enabled(pins) -> bool` (module-level, swappable by the
rules-stay-hard control); `create_model_and_solve(..., soft, violation_objective_only, violation_target)`;
`SolveResult.pin_violations`, `.violations_used`, `.violation_ceiling_proven`.

- [ ] **Step 1: Append the tests**

```python
# ─── Blocking-mechanism cases (§7) ─────────────────────────────────────────────
# Each starts from what an admin does — move one person into another role — and each
# names an instance that is FORCED: the only one that can give. `violation_target`
# bounds the count, not the identity, so a case with two equally-minimal sets would
# flake on the seed. Each returns (request, expected pin_violations).

def occupancy_case():
    """Round 5's one-pin reproduction: Hugo pinned to lead the week Jakey is out."""
    rules = ["any_of(Hugo,Jakey) on Sun.BGV each_week"] + unavailable("Jakey", 3)
    return (fixture(rules=rules, pinned=[pin("Hugo", "Sun.Lead", 3)]),
            ["W3: any_of(Hugo,Jakey) on Sun.BGV each_week"])


def cap_case():
    """Round 6's two-pin reproduction, authored in the seed's MERGED shape: every clause
    after the first is subject-elided in `source`, so the person comes from the rule
    object. The template resolves before parsing, so the entry shows 2, not {weeks-2}."""
    rules = ["Gaby !in Sat.* & !in Sun.Choir & Sun.BGV <= {weeks-2} & fairness_slack 1",
             "any_of(Gaby,Jakey) on Sun.BGV each_week"] + unavailable("Jakey", 3) + unavailable("Jakey", 4)
    return (fixture(rules=rules, pinned=[pin("Gaby", "Sun.BGV", 1), pin("Gaby", "Sun.BGV", 2)]),
            ["Gaby: Sun.BGV <= 2"])


def pair_case():
    """Round 6's pair reproduction. Two presence rules both need Liu in W2, so waiving
    presence costs two and the pair is the one instance that can give."""
    rules = (["Liu !with Vale on *.Choir",
              "any_of(Liu,Marianne) on Sun.Choir each_week",
              "any_of(Liu,Dani) on Sun.Choir each_week"]
             + unavailable("Marianne", 2) + unavailable("Dani", 2))
    return (fixture(rules=rules, pinned=[pin("Vale", "Sun.Choir", 2)]),
            ["W2 Sun: Liu !with Vale on *.Choir"])


def anchor_case():
    """The only dedicated Saturday lead pinned into Sat.BGV."""
    return fixture(pinned=[pin("Tono", "Sat.BGV", 2)]), ["builtin:sat_anchor:W2"]


def full_row_case():
    """A row pinned full leaves the group no seat that week."""
    return (fixture(rules=["any_of(Liu,Marianne) on Sun.Choir each_week"],
                    pinned=[pin(p, "Sun.Choir", 1) for p in ("Vale", "Dani", "Pau")]),
            ["W1: any_of(Liu,Marianne) on Sun.Choir each_week"])


def unreachable_bound_case(op):
    """Two Sunday pins elsewhere leave Liu two Choir Sundays; the rule wants three."""
    return (fixture(rules=[f"Liu Sun.Choir {op} 3"],
                    pinned=[pin("Liu", "Sun.BGV", 1), pin("Liu", "Sun.BGV", 2)]),
            [f"Liu: Liu Sun.Choir {op} 3"])


def no_lead_case():
    """Every lead-pool member pinned into other roles of W4's Sunday."""
    return (fixture(pinned=[pin("Hugo", "Sun.BGV", 4), pin("Niza", "Sun.BGV", 4),
                            pin("Lucia", "Sun.Choir", 4), pin("Rachel", "Sun.Choir", 4)]),
            ["builtin:mandatory_lead:W4:Sun"])


def pair_both_services_case():
    """One rule relaxed on both services of one week: two instances, two distinct entries."""
    return (fixture(rules=["Hugo !with Niza on *.BGV"],
                    pinned=[pin("Hugo", "Sun.BGV", 2), pin("Niza", "Sun.BGV", 2),
                            pin("Hugo", "Sat.BGV", 2), pin("Niza", "Sat.BGV", 2)]),
            ["W2 Sun: Hugo !with Niza on *.BGV", "W2 Sat: Hugo !with Niza on *.BGV"])


def consecutive_case():
    """Merged shape again: the person comes from the rule object, not from `source`."""
    return (fixture(rules=["Rachel !in Sat.* & !consecutive on *.Lead"],
                    pinned=[pin("Rachel", "Sun.Lead", 2), pin("Rachel", "Sun.Lead", 3)]),
            ["W2-3 Rachel: !consecutive on *.Lead"])


CASES = {
    "occupancy": occupancy_case, "cap": cap_case, "pair": pair_case, "anchor": anchor_case,
    "full_row": full_row_case, "gte": lambda: unreachable_bound_case(">="),
    "eq": lambda: unreachable_bound_case("=="), "no_lead": no_lead_case,
    "pair_both_services": pair_both_services_case, "consecutive": consecutive_case,
}


def rules_stay_hard(data):
    original = mod.relaxation_enabled
    mod.relaxation_enabled = lambda pins: False
    try:
        return solve_from_dict(data)
    finally:
        mod.relaxation_enabled = original


class PinsBeatRules(unittest.TestCase):

    def assert_pins_seated(self, res, pinned):
        for p in pinned:
            self.assertIn(p["person"], seated(res, p["week"], p["role"]), p)

    def test_each_mechanism_names_exactly_the_rule_that_gave(self):
        for name, build in CASES.items():
            with self.subTest(case=name):
                data, expected = build()
                res = solve_from_dict(data)
                self.assertTrue(res["ok"], res.get("error"))
                self.assertEqual(res["pinned_honored"], len(data["pinned"]))
                self.assert_pins_seated(res, data["pinned"])
                self.assertCountEqual(res["pin_violations"], expected)
                self.assertTrue(res["violation_ceiling_proven"])

    def test_rules_stay_hard_control(self):
        """With the booleans off, the same reproductions must FAIL — this is what proves the
        suite discriminates a working relaxation from a vacuous one."""
        for build in (occupancy_case, cap_case, pair_case):
            with self.subTest(case=build.__name__):
                data, _ = build()
                self.assertFalse(rules_stay_hard(data)["ok"])

    def test_nothing_left_to_lead_with_leaves_the_seat_unfilled(self):
        data, _ = no_lead_case()
        res = solve_from_dict(data)
        self.assertEqual(seated(res, 4, "Sun.Lead"), [])
        self.assertIn("W4 Sunday Sun.Lead #1", res["unfilled_seats"])
        self.assertIn("W4 Sunday Sun.Lead #2", res["unfilled_seats"])

    def test_a_relaxation_stays_inside_its_own_week(self):
        res = solve_from_dict(occupancy_case()[0])
        for week in (1, 2, 4):
            self.assertTrue({"Hugo", "Jakey"} & set(seated(res, week, "Sun.BGV")),
                            f"presence also failed in W{week}")
        res = solve_from_dict(pair_case()[0])
        for week in (1, 3, 4):
            self.assertFalse({"Liu", "Vale"} <= set(seated(res, week, "Sun.Choir")),
                             f"pair also failed in W{week}")
        res = solve_from_dict(consecutive_case()[0])
        self.assertNotIn("Rachel", seated(res, 1, "Sun.Lead"))
        self.assertNotIn("Rachel", seated(res, 4, "Sun.Lead"))

    def test_a_pinned_unavailable_group_member_breaks_nothing(self):
        """excluded_pwr is scoped for pins: without it, Jakey's pin would not count toward
        the rule it satisfies and E3's headline case would report a conflict."""
        rules = ["any_of(Hugo,Jakey) on Sun.BGV each_week"] + unavailable("Jakey", 3)
        res = solve_from_dict(fixture(rules=rules, pinned=[pin("Jakey", "Sun.BGV", 3),
                                                           pin("Hugo", "Sun.Lead", 3)]))
        self.assertTrue(res["ok"], res.get("error"))
        self.assertEqual(res["pin_violations"], [])

    def test_pins_that_satisfy_rules_relax_nothing(self):
        cap = "Gaby !in Sat.* & !in Sun.Choir & Sun.BGV <= {weeks-2} & fairness_slack 1"
        for label, rules, pins in (
            ("anchor", [], [pin("Tono", "Sat.Lead", 1)]),
            ("presence", ["any_of(Hugo,Jakey) on Sun.BGV each_week"],
             [pin("Jakey", "Sun.BGV", w) for w in range(1, 5)]),
            ("cap", [cap], [pin("Gaby", "Sun.BGV", 1)]),
        ):
            with self.subTest(case=label):
                res = solve_from_dict(fixture(rules=rules, pinned=pins))
                self.assertTrue(res["ok"], res.get("error"))
                self.assertEqual(res["pin_violations"], [])
                if label == "cap":
                    self.assertLessEqual(res["role_counts"]["Gaby"]["Sun.BGV"], 2)

    def test_observation_two_pins_on_a_cap_of_one_give_exactly_two_not_a_bound(self):
        """An OBSERVATION of the objective, not a property of the model (§5.2): the relaxed
        cap stops binding and the per-role spread term is what holds Gaby at her pins."""
        res = solve_from_dict(fixture(rules=["Gaby Sun.BGV <= 1"],
                                      pinned=[pin("Gaby", "Sun.BGV", 1), pin("Gaby", "Sun.BGV", 2)]))
        self.assertEqual(res["pin_violations"], ["Gaby: Gaby Sun.BGV <= 1"])
        self.assertEqual(res["role_counts"]["Gaby"]["Sun.BGV"], 2)


def presence_failures(res):
    """The occupancy case's rule, evaluated independently of the solver."""
    return {f"W{w}: any_of(Hugo,Jakey) on Sun.BGV each_week"
            for w in range(1, 5) if not {"Hugo", "Jakey"} & set(seated(res, w, "Sun.BGV"))}


class ViolationCeiling(unittest.TestCase):
    """§5.2: solve 0 runs first and its minimum is a hard ceiling on every later stage."""

    def patch_first_solve(self, status_for):
        original = cp_model.CpSolver.Solve
        calls = []

        def patched(solver_self, model):
            calls.append(1)
            if len(calls) == 1:
                return status_for(original, solver_self, model)
            return original(solver_self, model)

        cp_model.CpSolver.Solve = patched
        self.addCleanup(setattr, cp_model.CpSolver, "Solve", original)

    def test_solve_zero_runs_first_and_bounds_every_later_stage(self):
        res, _result, seen = instrumented(occupancy_case()[0])
        first, solve0 = seen[0]
        self.assertTrue(first.get("violation_objective_only"))
        self.assertIsNone(first.get("empty_target"))
        self.assertEqual(solve0.violations_used, 1)
        for kwargs, _ in seen[1:]:
            self.assertEqual(kwargs.get("violation_target"), 1, "a stage ran without the ceiling")
        self.assertLessEqual(len(res["pin_violations"]), solve0.violations_used)
        self.assertTrue(res["violation_ceiling_proven"])

    def test_no_solution_from_solve_zero_means_no_ceiling_and_an_honest_report(self):
        """The regime a slow container reaches: nothing bounds the stages, so the report is
        all that is left — every entry must be a real failure and every failure an entry."""
        self.patch_first_solve(lambda original, s, m: cp_model.UNKNOWN)
        res, _result, seen = instrumented(occupancy_case()[0])
        self.assertTrue(res["ok"], res.get("error"))
        self.assertFalse(res["violation_ceiling_proven"])
        for kwargs, _ in seen[1:]:
            self.assertIsNone(kwargs.get("violation_target"))
        self.assertEqual(set(res["pin_violations"]), presence_failures(res))
        self.assertIn("W3: any_of(Hugo,Jakey) on Sun.BGV each_week", res["pin_violations"])

    def test_a_feasible_solve_zero_still_bounds_but_is_not_proven(self):
        def feasible(original, s, m):
            status = original(s, m)
            return cp_model.FEASIBLE if status == cp_model.OPTIMAL else status
        self.patch_first_solve(feasible)
        res, _result, seen = instrumented(occupancy_case()[0])
        self.assertTrue(res["ok"], res.get("error"))
        self.assertFalse(res["violation_ceiling_proven"])
        for kwargs, _ in seen[1:]:
            self.assertEqual(kwargs.get("violation_target"), 1)

    def test_the_stage_a_fall_through_carries_the_ceiling(self):
        """Earlier drafts said the fall-through escaped the ceiling. Solve 0 runs before
        Stage A, so it does not — and this is the path production reaches and CI does not."""
        data = occupancy_case()[0]
        data["solver_total_budget_seconds"] = 1
        res, result, seen = instrumented(data)
        self.assertTrue(res["ok"], res.get("error"))
        self.assertEqual(result.fairness_limit_used, BIG, "the fall-through did not happen")
        self.assertTrue(res["violation_ceiling_proven"])
        self.assertEqual(len(res["pin_violations"]), seen[0][1].violations_used)
```

- [ ] **Step 2: Run to verify failure** — `relaxation_enabled` missing; cases return `ok: false`
(the mandatory-lead diagnostic — the wrong cause, as the spec records).

- [ ] **Step 3: Implement the booleans (inside `create_model_and_solve`)**

After `pin_set` / the pin loop:

```python
    # Under pins, every constraint a pin could contradict goes SOFT (spec §5.2): one
    # boolean per constraint INSTANCE — per week, per service where the rule is — that
    # may be 1 only while that instance is broken, and their count is bounded by the
    # ceiling solve 0 found. `relaxable` pairs each instance with the x-keys it sums and
    # the predicate that sum must meet: the report is re-evaluated against the returned
    # assignment, never read off the booleans, which are one-directional and may sit at
    # 1 on a constraint that holds. Without pins none of this is built.
    violations: List[cp_model.IntVar] = []
    relaxable: List[Tuple[str, List[Tuple[str, str]], Callable[[int], bool]]] = []

    def relaxed(entry: str, keys: Sequence[Tuple[str, str]], holds: Callable[[int], bool]):
        v = model.NewBoolVar(f"viol[{len(violations)}]")
        violations.append(v)
        relaxable.append((entry, list(keys), holds))
        return v
```

Mandatory lead:

```python
    for week in range(1, config.weeks + 1):
        for _service, lead_role in (("Sunday", "Sun.Lead"), ("Saturday", "Sat.Lead")):
            lead_slots = [s for s in slots if s.week == week and s.role_type == lead_role]
            if lead_slots:
                if soft:
                    # E3 honestly: an admin who pinned every lead-pool member elsewhere
                    # has built a leaderless service; it comes back as a «Sin cubrir»
                    # seat plus this marker instead of failing the whole month.
                    v = relaxed(
                        f"builtin:mandatory_lead:W{week}:{SERVICE_TOKEN[service_of(lead_role)]}",
                        [(p, s.key) for s in lead_slots for p in candidates[s.key]],
                        lambda n: n >= 1)
                    model.Add(sum(filled[s.key] for s in lead_slots) >= 1 - v)
                else:
                    model.Add(sum(filled[s.key] for s in lead_slots) >= 1)
```

Saturday anchor:

```python
    for week in sat_weeks:
        sat_lead_slots = [s for s in slots if s.week == week and s.role_type == "Sat.Lead"]
        dedicated_keys = [
            (p, s.key)
            for s in sat_lead_slots
            for p in candidates[s.key]
            if p in dedicated_sat_leads
        ]
        dedicated_terms = [x[k] for k in dedicated_keys]
        # A dedicated lead unavailable that week but pinned to lead it still anchors it.
        available_dedicated = {
            p for p in dedicated_sat_leads
            if not any(r.person == p and r.week == week for r in dsl_week_exclusion_rules)
            or (p, "Sat.Lead", week) in pin_set
        }
        if dedicated_terms and available_dedicated:
            # (keep the existing "== 1" history comment here)
            if soft:
                v = relaxed(f"builtin:sat_anchor:W{week}", dedicated_keys, lambda n: n >= 1)
                model.Add(sum(dedicated_terms) >= 1 - v)
            else:
                model.Add(sum(dedicated_terms) >= 1)
```

Pair (`for service, svc_slots in by_service.items():`):

```python
                lt_keys = [(rule.left, s.key) for s in svc_slots if (rule.left, s.key) in x]
                rt_keys = [(rule.right, s.key) for s in svc_slots if (rule.right, s.key) in x]
                lt = [x[k] for k in lt_keys]
                rt = [x[k] for k in rt_keys]
                if lt and rt:
                    if soft:
                        # Big-M from this instance's own lists: too small is a silent
                        # infeasibility on a pinned month.
                        n = len(lt) + len(rt) - 1
                        v = relaxed(f"W{week} {SERVICE_TOKEN[service]}: {rule.source}",
                                    lt_keys + rt_keys, lambda c: c <= 1)
                        model.Add(sum(lt) + sum(rt) <= 1 + n * v)
                    else:
                        model.Add(sum(lt) + sum(rt) <= 1)
```

Presence:

```python
    for rule in dsl_weekly_presence_rules:
        for week in range(1, config.weeks + 1):
            keys = [
                (p, s.key)
                for p in rule.people
                for s in slots
                if s.week == week and s.role_type in rule.role_types
                and (p, s.key) in x
                # A pinned member satisfies the rule even while unavailable — the pin
                # overrides the exclusion on that row — so they stay in the terms. The
                # tuple orders differ on purpose: excluded_pwr is (person, week, role),
                # pin_set is (person, role, week).
                and ((p, week, s.role_type) not in excluded_pwr
                     or (p, s.role_type, week) in pin_set)
            ]
            terms = [x[k] for k in keys]
            if terms:
                if soft:
                    v = relaxed(f"W{week}: {rule.source}", keys, lambda n: n >= 1)
                    model.Add(sum(terms) >= 1 - v)
                else:
                    model.Add(sum(terms) >= 1)
```

Consecutive:

```python
    for rule in dsl_consecutive_rules:
        for week in range(1, config.weeks):
            k1 = [(rule.person, s.key) for s in slots
                  if s.week == week and s.role_type in rule.role_types and (rule.person, s.key) in x]
            k2 = [(rule.person, s.key) for s in slots
                  if s.week == week + 1 and s.role_type in rule.role_types and (rule.person, s.key) in x]
            w1 = [x[k] for k in k1]
            w2 = [x[k] for k in k2]
            if w1 and w2:
                if soft:
                    n = len(w1) + len(w2) - 1   # its own lists, not the pair rule's
                    v = relaxed(f"W{week}-{week + 1} {rule.person}: {rule.source}",
                                k1 + k2, lambda c: c <= 1)
                    model.Add(sum(w1) + sum(w2) <= 1 + n * v)
                else:
                    model.Add(sum(w1) + sum(w2) <= 1)
```

Count rules (after `expr = ...`):

```python
        if soft:
            # One boolean per RULE — role_vars are month totals, so the rule has one
            # instance — and one for both halves of an `==`, so it reports as one relaxed
            # rule. B covers `>=`, whose bound can exceed the slot count.
            bound = max(rule.value, total_slots)
            keys = [(rule.person, s.key) for s in slots
                    if s.role_type in rule.role_types and (rule.person, s.key) in x]
            target = rule.value
            holds = {"==": lambda n, t=target: n == t,
                     ">=": lambda n, t=target: n >= t,
                     "<=": lambda n, t=target: n <= t}[rule.operator]
            v = relaxed(f"{rule.person}: {rule.source}", keys, holds)
            if rule.operator in ("==", ">="):
                model.Add(expr >= rule.value - bound * v)
            if rule.operator in ("==", "<="):
                model.Add(expr <= rule.value + bound * v)
        elif rule.operator == "==":
            model.Add(expr == rule.value)
        elif rule.operator == ">=":
            model.Add(expr >= rule.value)
        else:
            model.Add(expr <= rule.value)
```

After the count-rules loop, before the objective:

```python
    n_viol = None
    if soft:
        # ONLY under pins. Built unconditionally it would add a variable and an equality
        # to the pinless Stage A model and redden the inertness fingerprint (spec §5.2).
        n_viol = model.NewIntVar(0, len(violations), "n_viol")
        _eq(model, n_viol, violations)
        if violation_target is not None:
            # The ceiling. A constraint, never an objective term: half the ladder runs
            # optimize=False with no objective at all, and a tier above Sun.Lead would
            # multiply the weight ladder past int64 (spec §5.2).
            model.Add(n_viol <= violation_target)
```

Objective chain — replace `if empty_objective_only:` with:

```python
    if violation_objective_only:
        # Solve 0: the fewest rules the pins force, and nothing else.
        model.Minimize(n_viol)
    elif empty_objective_only:
        # Stage A (comment unchanged). Under pins, breaking one fewer rule beats filling
        # any number of seats — belt and braces inside the box solve 0 already fixed.
        if soft:
            model.Minimize((max_weighted_empty + 1) * n_viol + weighted_empty)
        else:
            model.Minimize(weighted_empty)
    elif optimize:
```

Post-solve, after `pinned_honored`:

```python
    pin_violations = [
        entry for entry, keys, holds in relaxable
        if not holds(sum(solver.Value(x[k]) for k in keys))
    ]
```

and pass `pin_violations=pin_violations`,
`violations_used=int(solver.Value(n_viol)) if n_viol is not None else None` to `SolveResult`.

- [ ] **Step 4: Implement solve 0 and the ceiling (`solve_schedule`)**

After `candidates = …`:

```python
def relaxation_enabled(pins: Sequence[Pin]) -> bool:        # module level, near pin_slack
    """
    Whether this request's contradictable constraints go soft (spec §5.2). Only a pin can
    contradict a rule, so a pinless request builds today's model exactly. A function, not
    an inline bool(pins), so the rules-stay-hard control can switch it off and watch the
    pinned reproductions fail.
    """
    return bool(pins)
```

```python
    soft = relaxation_enabled(pins)
    common = dict(..., pins=pins, soft=soft)          # extend the existing dict
    big = len(slots) + 1
    deadline = …; def solve_time(): …                 # unchanged

    # Solve 0 (spec §5.2), under pins only: the fewest rules the pins force, found FIRST
    # with nothing inherited — no empty_target, loose fairness limits, no objective but
    # the count. Its value is a hard ceiling on every later stage, Stage A and the
    # stage_a fall-through included, so no stage can buy fill or fairness with one more
    # broken rule. It ranks nothing by fairness, which is how ADR-0010's requirement
    # holds: the NUMBER of rules set aside is never increased for fairness.
    violation_target: int | None = None
    ceiling_proven: bool | None = None
    if soft:
        solve0_info: Dict[str, object] = {}
        solve0 = create_model_and_solve(
            **common, fairness_limit=big, sun_lead_limit=big, sun_bgv_limit=big,
            optimize=False, violation_objective_only=True,
            max_time_override=solve_time(), pass_info=solve0_info,
        )
        # A FEASIBLE solve 0 still sets a (possibly slack) ceiling; only OPTIMAL proves it
        # minimal. No solution at all — reachable at 1 s on the production container —
        # leaves no ceiling anywhere, and the month still comes back.
        if solve0 is not None:
            violation_target = solve0.violations_used
        ceiling_proven = solve0_info.get("status") == cp_model.OPTIMAL
    common["violation_target"] = violation_target

    def finish(result: SolveResult) -> SolveResult:
        result.violation_ceiling_proven = ceiling_proven
        return result
```

Replace every `return stage_a` / `return result` in `solve_schedule` with `return finish(stage_a)` /
`return finish(result)`. Stage A keeps its `RuntimeError` on `None`.

- [ ] **Step 5: Run** — all of `test_pinned_assignments` PASS; `test_inertness` fingerprint
**green**; `test_owt_solver_v2` green. If a `CASES` entry fails on a second instance, it was not
forced: redesign the case, never loosen the assertion.

- [ ] **Step 6: Measure solve 0 (spec §5.2's one unmeasured claim)**

At `solver_num_search_workers=1`, 5 s cap, on each `CASES` request and the heavy-load request:
record solve 0's wall time and status. Laptop numbers, labelled as such; they go in the ADR and
`docs/SOLVER_AND_INFRA.md`. If it does not prove `OPTIMAL` routinely, stop and report — the spec
calls that a design signal.

- [ ] **Step 7: Commit** `feat(solver): let pins beat rules under a proven violation ceiling`

---

### Task 6: Types and documentation in the same delivery

**Files:**
- Modify: `app/api/admin/solve/route.ts` — `SolveRequest.pinned?` (spec §4 block verbatim, plus
  `solver_total_budget_seconds?` is NOT added — out of scope); `SolveResponse`:

```ts
  /**
   * How many `pinned` entries the returned schedule actually holds — derived from the
   * solved assignment, never echoed. Present on EVERY response of a pin-aware solver
   * (0 without pins): its presence is the handshake that tells this solver from one that
   * silently ignores `pinned`.
   */
  pinned_honored?: number;
  /**
   * Rules the solver set aside to honour the pins, one entry per relaxed instance, in the
   * solver spec's §4 grammar: `<person>: <source>`, `W<n>: <source>`,
   * `W<n> <Sun|Sat>: <source>`, `W<n>-<n+1> <person>: <source>`,
   * `builtin:mandatory_lead:W<n>:<Sun|Sat>`, `builtin:sat_anchor:W<n>`.
   */
  pin_violations?: string[];
  /**
   * True iff the violation-only solve proved its minimum, i.e. the relaxations are exactly
   * what the pins force. Absent when the request had no pins.
   */
  violation_ceiling_proven?: boolean;
```

- Modify: `docs/SOLVER_AND_INFRA.md` — input keys gain `pinned`; output gains the three fields
  (with the absence rules); a **"Pinned assignments"** subsection under Key behaviors: fixed
  variable, the four enabling changes, service-keyed slack, the six soft families, solve 0 → A → B
  ordering and the ceiling, what the report is derived from, the solve-0 measurement from Task 5
  Step 6; and under §2 CI/CD a **"Verifying a Cloud Function deploy"** procedure (spec §9: `gcloud
  functions describe owt-solver --gen2 --region=us-central1` `updateTime` after the merge, then one
  pinless smoke request asserting `ok: true` and the PRESENCE of `pinned_honored`; the revert
  trigger; the two-revert order).
- Create: `docs/adr/0041-pins-are-fixed-variables-and-rules-go-soft-under-a-ceiling.md` (recheck the
  number: `ls docs/adr | tail -3`; `adrIndex.test.ts` needs consecutive numbering) and add it to
  `docs/adr/README.md`'s index. Content per spec §8: the decision; five rejected designs each with the
  execution that killed it (remove-the-seat; routing through `combined_slack`; subtraction — 7 vs 4–5,
  4 of 8 Sunday leads; the two enumerations of exemptions — the one- and two-pin reproductions);
  role-keyed slack (collapse on four seeds); the `max(gmax, n[p])` cap (built, not adopted); the
  limit of the guarantee (`fairness_exempt`, Rachel 8); Frank's 2026-09-16 ADR-0010 ruling and the
  reconciliation (the NUMBER is never increased for fairness; fairness still picks which instance
  among equal-size sets); the solve-0 measurement.
- Modify: `docs/superpowers/specs/2026-09-15-solver-pinned-assignments-review-log.md` — rounds 11–13
  in one line each, and "Implementation authorized by Frank 2026-09-25 without an APPROVED verdict;
  the fresh diff review is the load-bearing gate."

- [ ] **Step 1:** Make the edits above.
- [ ] **Step 2:** `npx tsc --noEmit && npm test && npx eslint .` — all green (the ADR index test runs in `npm test`).
- [ ] **Step 3:** Commit `docs(solver): document pinned assignments and record ADR-0041`.

---

### Task 7: Gates, fresh code review, release

- [ ] **Step 1:** Merge `origin/main` (with Task 1's goldens) into `solver-pinned-assignments`;
  confirm `gcf/test_inertness.py` came from main, untouched by this branch.
- [ ] **Step 2: Four gates** — `npx tsc --noEmit`, `npm test`, `npx eslint .` (0 errors),
  `python -m unittest discover -s gcf -t gcf -v`.
- [ ] **Step 3: Fresh code review** — dispatch a `code-reviewer` agent (read-only, strongest
  model, high effort) on `origin/main...HEAD`, with the spec, this plan, and the docs-audit and
  worklog-completeness checklists. One reviewer at a time.
- [ ] **Step 4:** Fix findings; **re-verify** — a scoped fresh review of the fix range plus the
  four gates on the final tree. The last worklog entry before the merge is a verification.
- [ ] **Step 5:** Merge into `preview`, push, verify `dev-owt-backstage.vercel.app` is in the
  deployment's `alias` and `meta.githubCommitSha` is the pushed commit (one authoritative
  `get_deployment` query, or the `deploy-verifier` agent).
- [ ] **Step 6:** Open the PR to `main`; wait for `gates`. **Frank merges** (production release —
  the Cloud Function deploys from it with no rehearsal).
- [ ] **Step 7:** Verify: production alias + SHA; `gcloud functions describe owt-solver --gen2
  --region=us-central1 --format='value(updateTime)'` after the merge; the pinless smoke request
  needs the API key — hand Frank the exact command, never handle the value.
- [ ] **Step 8:** Close the cycle (`finish-cycle`): worklog entries, memory update (instruments
  auto-fill delivery 2 → solver half released; client half next), `git worktree prune`.
