# Review log — pinned assignments in the CP-SAT solver (solver half)

Artifact: `2026-09-15-solver-pinned-assignments-design.md`
Skill: `.agents/skills/adversarial-plan-review/` (vendored copy of the canonical skill).
**Status: open — round 1 done, no approval yet.** Current canonical digest `648c766f…`,
commit `05b5159c`.

## Risk tier

**Critical**, derived from the ladder and not adjusted: this changes the request contract and
the hard constraints of a production solver deployed by an irreversible remote release action
(a Cloud Build trigger on `main` filtered to `gcf/**`), serving **both** environments from one
Cloud Function — the solver half never reaches `preview` first. Requirement: **two sequential
fresh `APPROVED` verdicts on byte-identical text.**

## Prior art

This file was split out of `2026-09-10-solver-fill-empty-only-design.md` on 2026-09-15 after
eleven rounds on the combined artifact. That log
(`2026-09-10-solver-fill-empty-only-design-review-log.md`) records how the design got here,
including two mechanism rewrites. **Numbering restarts at 1** and no reviewer is shown either
log.

## Rounds

| Round | Reviewed digest (SHA-256, prefix) | Commit | Verdict | Substantive? |
|---|---|---|---|---|
| 1 | `0fbf5e90307991c6…` | `9c997722` | CHANGES_REQUIRED | yes (1 blocker, reproduced and extended) |

## Round 1 — the share guarantee was a tendency

The reviewer patched a scratch copy of `owt_solver_v2.py` with the whole §5 mechanism and
executed it. Independently confirmed: the budget-stability table reproduces exactly; the golden
precondition discriminates (seeds 1/42/2024 `OPTIMAL`, seed 7 `FEASIBLE`); inertness holds byte
for byte on four seeds; pins are honoured and cannot make the month infeasible; the full-board
round-trip reproduces the un-pinned roster; the ADR-0029 isolation holds; instance-scoped
relaxation names exactly one week and leaves the others intact; a pinned-but-unavailable member
produces an **empty** `pin_violations`. They also measured that pinned runs are **faster** than
un-pinned ones (2.9 s against 4.5 s over 20 runs), refuting a solve-budget worry the spec
carried.

**The blocker: §5.1's "a pinned service counts toward that person's share" is false as a
guarantee.** The hard upper bound is `t[p] <= gmax + n[p]` — it *permits* a pinned person a
full solver-chosen share **on top of** their pins. Only the soft `overall_spread` objective
holds them down. The reviewer framed this as "a tendency, not a property".

**The author's reproduction was worse than the report.** `fairness_exempt` — which the shipped
seed uses for two people — removes a person from the fairness groups and therefore from the
soft term too. On a twelve-person month whose baseline gives Rachel 6: make her exempt, pin her
into `Sun.Choir` twice, and she returns with **8**. The pins bought nothing and she took a full
share besides. Un-exempt, the same month holds her at 5. So the containment is not merely a
tendency — it is *removable by an ordinary rule the team already uses*.

**A fix was implemented and rejected on evidence.** Capping the upper bound at
`max(gmax, n[p])` via `AddMaxEquality` does contain the exempt case (5 pins: 6 against the
slack form's 8), but it does not address the ladder behaviour below, and it puts a max-equality
per pinned person on the hardest constraint in the model for a guarantee the objective already
delivers wherever anyone is watching. Recorded in the spec as rejected so the next reader does
not spend the same afternoon.

**A second finding, chased down before it was written up.** Four pins on one row of a four-week
month collapse the fairness ladder to the fairness-free `stage_a` (reported limit
`len(slots) + 1`), spreading the month 1–8 instead of 4–5; three pins solve at tier 1. That
looked like a defect of this design. It is not: the **shipped** solver with **no pins at all**
and an ordinary DSL floor, `Rachel Sun.Choir >= 4`, produces the identical collapse. A pin
behaves exactly like the equivalent hard rule, which is the property this design wants, and the
ladder's limit predates the delivery.

The consequence is the part that matters, and it changed a test: **"no reported limit equals
`len(slots) + 1`" is not a valid pass condition**, because the shipped solver already fails it.
§7's heavy-pin guard is now **differential** — the pinned month must match the month the
equivalent DSL rule produces — which tests the property this design owns rather than a bound
neither version has.

**Also fixed:** §4 now *specifies* the `pin_violations` grammar for all six families and both
builtins instead of exemplifying it. This half ships first and irreversibly, the client renders
an unknown marker with a generic fallback, and a mismatch would show that generic line forever
with both suites green. §4 also states what the three existing `*_fairness_relaxed` fields mean
under pins — their literal meaning is unchanged, but they no longer imply a balanced
distribution — and leaves them alone deliberately, because redefining a field an already
deployed client reads is the silent contract change that section exists to prevent. Every
fairness test now asserts the realized spread, never the flag.

Non-blocking, adopted: the count-rule containment number is no longer asserted (the seed's own
cap shape, `Gaby Sun.BGV <= {weeks-2}`, gave one more than the pins on a `FEASIBLE` solve, and
production's 5 s cap on ~0.33 vCPU makes optimality less likely still); cross-role displacement
named as a third fairness mechanism the table does not cover; four citation corrections.

## Process note

The split is paying for itself: on a spec 40% smaller, round 1 reached the mechanism deeply
enough to execute it and to surface a false guarantee that eleven rounds on the combined
artifact had not. Two of the three findings above were produced by the author following the
reviewer's thread rather than by the report itself — which is what a review is for.
