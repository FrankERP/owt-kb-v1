# ADR-0036: The lexicographic objective's weights use per-tier maxima

**Date:** 2026-09-16 · **Status:** Accepted

## Context

`compute_priority_weights` builds the solver's lexicographic objective as one weighted
sum: eight priority tiers, each weight chosen to exceed the largest total the tiers below
it can contribute. That is a **product over eight tiers**, and every tier was charged the
same multiplier — `overall_limit`, the month's total slots plus history.

A uniform over-estimate raised to the eighth power overflows. Measured on the 12-person
production-shaped roster, the objective's upper bound was:

| Month | Slots | Objective bound | int64 ceiling |
|---|---|---|---|
| 4 weeks, Saturday every week | 52 | 3.2e19 | 9.2e18 |
| 5 weeks, 3 Saturdays | 55 | 6.9e19 | " |
| 6 weeks, 2 Saturdays | 58 | 1.4e20 | " |
| 5 weeks, Saturday every week | 65 | 3.0e20 | " |
| 6 weeks, Saturday every week | 78 | 1.9e21 | " |

**Every shape was over, including the ordinary four-week month.** Whether ortools actually
rejected the model depended on the *reachable* domain rather than this bound, so it fired
irregularly — `MODEL_INVALID` on the 55-, 58- and 65-slot shapes, not on 52 or 78 — which
is why it went unnoticed.

What made it harmful is the failure mode. `create_model_and_solve` returns `None` on any
status that is not `OPTIMAL` or `FEASIBLE`, and `solve_schedule`'s ladder treats `None` as
"this fairness tier is infeasible" and moves on. So a rejected objective was
indistinguishable from a tight fairness tier: the month **fell through to the
objective-less passes and came back with no fairness optimisation at all**, with nothing in
the response to say so. The admin saw a legal but lopsided month and no diagnostic.

## Decision

**Weights are computed against each tier's own maximum.** `compute_priority_weights` takes
an optional `tier_maxima` map; `create_model_and_solve` supplies it:

- a per-role spread is bounded by that role's slot count plus its history, not by the
  whole month (a `Sun.Choir` spread cannot exceed the number of Choir slots);
- the two `Sun.Lead` rotation terms by the largest tie-break weight times the `Sun.Lead`
  slot count;
- only the global spread keeps `overall_limit`.

On a **history-free** month the same five shapes then bound at 2.6e16 … 1.4e18, three
orders of magnitude below the old figures, and none reaches `MODEL_INVALID`.

**History-bearing months are a different story, and per-tier maxima do not save them.**
`build_history_offsets` weights the last three months by `[10, 6, 3]`, so `overall_limit`
and every `ov_r_limit` grow with the history — and production always sends it. Measured by
chaining a month's own counts forward: **two history entries are enough** to push the
default shape back over int64 (1.0e19). Eight tiers multiplied together simply do not fit
once the offsets are that large; no choice of caps rescues it, and a first draft of this
change that *raised* on the condition turned "a lopsided month" into "no month at all" —
strictly worse for the admin than the bug, and reachable in exactly the steady state the
fairness feature exists to create.

**So the second half of the decision is graceful, REPORTED degradation.**
`compute_priority_weights` raises `ObjectiveTooLarge` — deliberately not a `ValueError`,
because `solve_from_dict` turns those into `ok: false` — and `create_model_and_solve`
catches it, builds that pass with **no objective**, and sets `objective_skipped`. The
response carries `objective_skipped: true`.

The schedule is legal and fully constrained; it is simply not fairness-optimised. That is
the same outcome as before this change — and that is the point: **the outcome was never
the bug, the silence was.**

## Alternatives rejected

- **Sequential (true) lexicographic optimisation** — minimise tier 1, fix it as a
  constraint, minimise tier 2, and so on. This is what the weighted sum approximates, and
  it cannot overflow by construction. Rejected on budget: it is eight solves per fairness
  tier on a ~0.33-vCPU Cloud Run container already working against a 40 s ceiling.
- **Clamping the weights to fit int64.** Silently converts the strict ordering into an
  approximate one — the tiers stop dominating each other and the solver may trade lead
  fairness for a tie-break. That is the same class of silent degradation this ADR removes.
- **Shrinking the tier count.** Each tier encodes a priority someone asked for; dropping
  one is a product decision, not a fix for an arithmetic bug.

## Consequences

- **Boards change on history-free months.** Those that were falling through now optimise,
  so their rosters differ — better distributed, but different. The 55-, 58- and 65-slot
  fixtures went from a fairness-free fall-through to solving at the tightest tier.
- **Months with two or more history entries still run unoptimised**, now with
  `objective_skipped: true` in the response instead of nothing. Fixing *those* needs a
  different mechanism — splitting the ladder across two sequential solves, so no single
  weighted sum has to hold all eight tiers — which is scoped as follow-on work rather than
  smuggled into a bug fix.
- `gcf/test_owt_solver_v2.py::ObjectiveFitsInt64` guards all five shapes, asserts the
  ladder stays lexicographic under the smaller caps, and asserts the loud failure.
- Anything that froze a solver output as a golden must re-capture it; the model
  construction is unchanged, so a Stage A model fingerprint is not affected.
- `objective_skipped` is a new response field. No client reads it yet; surfacing it in the
  planner is worth doing and is not in this change.
