# ADR-0038: The lexicographic objective's weights use per-tier maxima

**Date:** 2026-09-16 · **Status:** Accepted · **Amended 2026-09-23** — before release, a review found this record's account of `main` partly false; the ceiling moved to CP-SAT's real one, and the trade-off Frank accepted is recorded below

## Context

`compute_priority_weights` builds the solver's lexicographic objective as one weighted
sum: eight priority tiers, each weight chosen to exceed the largest total the tiers below
it can contribute. That is a **product over eight tiers**, and every tier was charged the
same multiplier — `overall_limit`, the month's total slots plus history.

A uniform over-estimate raised to the eighth power overflows. CP-SAT accepts an integer
objective only while its bound stays at or under **INT64_MAX // 2 (4.6e18)**, not INT64_MAX:
it keeps headroom so the sum's max − min cannot overflow. Measured 2026-09-23 on `main`
(`dd04ecad`), 12-person test roster, seed 42, no history:

| Month | Slots | Ladder bound | What ortools 9.15 did on `main` |
|---|---|---|---|
| 4 weeks, 2 Saturdays (fixture default) | 42 | 3.7e18 | integer objective, valid — optimised |
| 4 weeks, Saturday every week | 52 | 2.5e19 | integer objective, valid — optimised |
| 5 weeks, 3 Saturdays | 55 | 5.5e19 | integer objective, `MODEL_INVALID` |
| 6 weeks, 2 Saturdays | 58 | 1.1e20 | integer objective, `MODEL_INVALID` |
| 5 weeks, Saturday every week | 65 | 2.4e20 | integer objective, `MODEL_INVALID` |
| 6 weeks, Saturday every week | 78 | 1.5e21 | **floating-point** objective, accepted — optimised |

The ladder's figure is not what CP-SAT checks, and that is why the pattern looks
irregular. CP-SAT validates the flattened objective against each variable's *declared
domain* (the 52-slot month came to 3.9e18 that way, and fit). And once a single weight
passes int64, ortools quietly builds a **floating-point** objective instead, which CP-SAT
accepts on some months and rejects on others. So every month on `main` lands in one of
three classes — integer-valid, integer `MODEL_INVALID`, or floating-point — and history
moves it between them. Chaining each month's own counts forward (one and two entries on
all six shapes), every history-bearing month got a floating-point objective: accepted and
optimised on the default shape with one or two entries and the every-Saturday shape with
one, `MODEL_INVALID` on the other nine. (The first draft of this record said the outcome
"depended on the reachable domain". It did not.)

What made `MODEL_INVALID` harmful is the failure mode. `create_model_and_solve` returns
`None` on any status that is not `OPTIMAL` or `FEASIBLE`, and `solve_schedule`'s ladder
treats `None` as "this fairness tier is infeasible" and moves on. So a rejected objective
was indistinguishable from a tight fairness tier: the month **fell through to the
objective-less passes and came back with no fairness optimisation at all**, with nothing in
the response to say so.

## Decision

**Weights are computed against each tier's own maximum.** `compute_priority_weights` takes
an optional `tier_maxima` map; `create_model_and_solve` supplies it:

- a per-role spread is bounded by that role's slot count plus its history, not by the
  whole month (a `Sun.Choir` spread cannot exceed the number of Choir slots);
- the two `Sun.Lead` rotation terms by the largest tie-break weight times the `Sun.Lead`
  slot count;
- only the global spread keeps `overall_limit`.

On a **history-free** month the five shapes over the limit then bound at 2.0e16 … 1.1e18,
and none reaches `MODEL_INVALID`.

**History-bearing months are a different story, and per-tier maxima do not save them.**
`build_history_offsets` weights the last three months by `[10, 6, 3]`, so `overall_limit`
and every `ov_r_limit` grow with the history — and production always sends it. **One
history entry is enough** to take the every-Saturday month past the ceiling (8.0e18), two
the default shape (9.6e18). Eight tiers multiplied together do not fit once the offsets are
that large, and no choice of caps rescues it. A first draft that *raised* on the condition
turned "a lopsided month" into "no month at all" — strictly worse for the admin than the
bug, and reachable in exactly the steady state the fairness feature exists to create.

**So the second half of the decision is graceful, REPORTED degradation.**
`compute_priority_weights` raises `ObjectiveTooLarge` once the ladder passes INT64_MAX // 2 —
deliberately not a `ValueError`, because `solve_from_dict` turns those into `ok: false` —
and `create_model_and_solve` catches it, builds that pass with **no objective**, and sets
`objective_skipped`. The response carries `objective_skipped: true`. As a backstop it also
asks CP-SAT's own validator (`model.Validate()`, ~0.1 ms) after building the objective and
drops it the same way if CP-SAT would refuse it: the ladder bounds each tier by what it can
*reach*, CP-SAT by what each variable's domain *allows*, and on the rotation tiers the two
differ by 0.5–10% (measured).

**The flag means "no lexicographic objective ran", not "the ladder overflowed."** Stage A
and the relaxation ladder's `optimize=False` passes build no objective either, and
`solve_schedule` can return from any of them. A flag scoped to the overflow would report
"the objective ran" for months where it did not — the same silence, one path over.

Once a pass's objective is skipped, it admits exactly the assignments its `optimize=False`
sibling does. When it **proves** the tier infeasible the ladder moves on without running
the sibling, which could only prove it again. A pass that merely timed out still hands
over, because the sibling searches differently.

## The trade-off (accepted 2026-09-23)

This is **not** "the same outcome as before, now reported". On the months `main` gave a
floating-point objective and CP-SAT accepted it — the default shape with two history
entries, the every-Saturday shape with one — `main` optimised fairness. This change runs
those months with no objective, and fairness is **measurably worse**: the 2026-09-23 review
measured the `Sun.Lead` spread at 10.9 against `main`'s 10.3 over 10 seeds. What it buys is
the report: `objective_skipped: true` on every month that was not optimised, including the
`MODEL_INVALID` months `main` left unoptimised in silence. Frank accepted that exchange on
2026-09-23 — lose `main`'s implicit float optimisation on those months, gain the report —
and chose not to build an explicit floating-point objective in this change.

## Alternatives rejected

- **Sequential (true) lexicographic optimisation** — minimise tier 1, fix it as a
  constraint, minimise tier 2, and so on. This is what the weighted sum approximates, and
  it cannot overflow by construction. Rejected on budget: it is eight solves per fairness
  tier on a ~0.33-vCPU Cloud Run container already working against a 40 s ceiling.
- **An explicit floating-point objective — deferred, not rejected on merit.** Building
  deliberately the objective `main` fell into by accident would keep the float-optimised
  months optimised. It is its own piece of work: CP-SAT converts a floating-point
  objective to an integer one internally, within its own precision limits, so whether the
  strict tier ordering survives has to be measured — and on `main` CP-SAT refused the
  floating-point objective on nine of the twelve history-bearing months measured. Not in
  this change.
- **Clamping the weights to fit.** Silently converts the strict ordering into an
  approximate one — the tiers stop dominating each other and the solver may trade lead
  fairness for a tie-break. That is the same class of silent degradation this ADR removes.
- **Shrinking the tier count.** Each tier encodes a priority someone asked for; dropping
  one is a product decision, not a fix for an arithmetic bug.

## Consequences

- **Boards change on history-free months.** The 55-, 58- and 65-slot months went from a
  fairness-free fall-through to solving at the tightest tier. The rest optimise under
  different weights, and the 78-slot month under an integer objective instead of a float one,
  so their rosters can differ too.
- **Months whose ladder passes INT64_MAX // 2 run unoptimised**: one history entry on a
  four-week month with a Saturday every week, two on the default shape. They now carry
  `objective_skipped: true`, and some of them were optimised on `main` (see the trade-off).
  Fixing them needs a different mechanism — splitting the ladder across sequential solves,
  or the explicit floating-point objective above — scoped as follow-on work rather than
  smuggled into a bug fix.
- `gcf/test_owt_solver_v2.py::ObjectiveWeightLadder` guards all six shapes plus a
  history-bearing one that sits between INT64_MAX // 2 and INT64_MAX. It checks that the
  guard itself fires there, and that the validator backstop catches a ladder pushed past it.
  It chains three months of history forward on four shapes and asserts both directions of
  `objective_skipped`, including an `optimize=False` return. It checks that an objective-less
  tier is never proved infeasible twice while a timed-out one still hands over, that the
  ladder stays lexicographic under the smaller caps, and that a partial tier map degrades
  rather than failing the month.
- **CI now runs it.** `gates` gained a `python -m unittest discover -s gcf -t gcf` step
  (roughly 150–180 s in CI); before this change a `gcf/**`-only PR went green on a job that never
  opened the file, on code that deploys to the Cloud Function from `main` with no
  `preview` rehearsal.
- Anything that froze a solver output as a golden must re-capture it; the model
  construction is unchanged, so a Stage A model fingerprint is not affected.
- `objective_skipped` is a new response field. No client reads it yet; surfacing it in the
  planner is worth doing and is not in this change.
