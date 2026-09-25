# Review log — pinned assignments in the CP-SAT solver (solver half)

Artifact: `2026-09-15-solver-pinned-assignments-design.md`
Skill: `.agents/skills/adversarial-plan-review/` (vendored copy of the canonical skill).
**Status: open — TEN rounds done, no approval yet. Frank's cap of 10 is reached.** Current
canonical digest `980bf729…`, commit `2baf458c`. Critical tier needs **two sequential fresh
`APPROVED` verdicts on byte-identical text**, so the earliest possible completion from here is
rounds 11 and 12 with no changes between them.

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
| 1 | `0fbf5e90307991c6…` | `9c997722` | CHANGES_REQUIRED | yes — the share guarantee was a tendency, not a property |
| 2 | `648c766f28bd6b9c…` | `b13372af` | CHANGES_REQUIRED | yes — `pin_violations` grammar: subject elision + three marker spellings |
| 3 | `d61125336892dbde…` | `bce56492` | CHANGES_REQUIRED | yes — entries must be derived from the assignment, not the booleans |
| 4 | `9c1fb2f46c85380f…` | `fcac6999` | CHANGES_REQUIRED | yes — §7 asserted an equality the mechanism is built to break |
| 5 | `4190ceb3eb5e48ed…` | `c274f894` | CHANGES_REQUIRED | yes — non-minimal ceiling; a fingerprint API that does not exist |
| 6 | `02b25fc367fcad81…` | `200f5ec6` | CHANGES_REQUIRED | yes — the response was a field short of what §5.2 required |
| 7 | `0a5b4700ba4072db…` | (r7 fixes) | CHANGES_REQUIRED | yes — the golden re-capture rule defeated itself |
| 8 | `23aa1650db99d178…` | (r8 fixes) | CHANGES_REQUIRED | yes — the fairness promise had an undisclosed `fairness_exempt` carve-out |
| 9 | `5c90b6cc0bd623fe…` | `7ade9b56` | CHANGES_REQUIRED | yes — **the per-role slack was keyed on the wrong axis** |
| 10 | `9988cfda0c913a86…` | `2baf458c` | CHANGES_REQUIRED | yes, but **editorial only** — stale prose from the round-9 rewrite |

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

## Rounds 2–10

**Every round from 3 onward patched a copy of `owt_solver_v2.py` and executed it**, and from
round 8 onward reviewers were implementing the full §5.1 + §5.2 mechanism rather than sampling it.

### The one that mattered most: round 9

The per-role hard-spread slack counted pins **by role**. The per-service occupancy limit
(`:754-765`) gives each person one seat per service per week, so a pin in *any* Sunday role
zeroes them in *every other* Sunday role that week — and counting only `Sun.Lead` pins toward the
`Sun.Lead` spread left a lead-pool member pinned into Choir with **zero** slack on the very
spread their pins tighten.

Measured on the spec's own fixture, four pins in a Sunday row every week: **every**
Sunday-lead-pool member collapsed the fairness ladder to the fairness-free `stage_a` on all four
seeds, leaving a member on **zero services**. Every support member was fine.

Two earlier drafts had misread the discriminator as the row's seat count, and the support half
passed under the broken mechanism — so a suite written from either draft would have been green on
a design that dropped someone out of the month. The reviewer proposed keying the slack on the
**service** a pin occupies, implemented it, and executed it; the author reproduced it
independently, confirmed the collapse vanishes on every seed and row, and re-ran byte-identity,
the 52-pin round trip, both relaxation reproductions and the pinned-only guard on the new form.

### What the rounds fixed, in one line each

- **1** — "a pinned service counts toward that person's share" was a tendency of the soft
  objective, not a property; `fairness_exempt` (which the seed uses for two people) removes it.
- **2** — `pin_violations` declared a contract and failed it twice: a count rule's `source` is
  subject-elided for exactly the shipped seed shape, and the `builtin:` literal was spelled three
  ways in one file with the client implementing the one §4 forbade.
- **3** — the one-directional booleans permit `v = 1` on a satisfied constraint; entries are now
  re-evaluated against the returned assignment.
- **4** — §7 asserted that a pin matches the equivalent DSL rule, which the slack exists to break.
- **5** — the ceiling was not provably minimal (a third, violation-only solve now sets it), and
  the fingerprint named `model.Proto().SerializeToString()`, which does not exist on the pinned
  ortools — with a measurement attributed to it that could not have been taken.
- **6** — the response was a field short: `violation_ceiling_proven`.
- **7** — the golden re-capture rule permitted re-capture inside `gcf/**` PRs, i.e. inside the
  very PR whose preview-less safety rests on the golden.
- **8** — the fairness promise did not hold for an un-pinned `fairness_exempt` member (measured:
  3→2 from a *single* pin), and the saturation table shipped with no fixture.
- **9** — the slack axis, above.
- **10** — three paragraphs describing the rejected design survived the round-9 rewrite as if they
  described the adopted one, which would have turned §7's failing control into specified
  behaviour. Plus: `n_viol` must be built only when `soft`, or the pinless fingerprint reddens on
  every seed and the delivery stalls under §7's own no-re-capture rule.

### Verified sound, by execution, in round 10

Service-keyed slack; the ceiling (0/40 randomised pin loads collapse with it, 25 violation
booleans set without it); Stage A byte-identity across budgets and seeds; the 52-pin full-board
round trip; pinned-only isolation (ADR-0029); all five blocking-mechanism reproductions naming
exactly the forced rule; the parser elision table; the 65-slot `MODEL_INVALID` finding; the CI gap.

## Two things that need Frank, not another round

1. **ADR-0010.** It records his requirement in his own words — *"it has to be hard because if
   it's soft in fairness it will always choose people like Frank, Mkz or Gaby"* — for the
   pair-exclusion family this design makes soft. The minimal ceiling confines breakage to what
   the pins force, which is the narrowest reading of E3, but the hard-vs-soft call is his, and it
   is needed **before** implementation: if it goes the other way, the mechanism needs a pair-rule
   carve-out, which is a different design rather than an edit.
2. **A pre-existing defect found along the way, out of this scope.** A five-week month with a
   Saturday every week (65 slots) returns `MODEL_INVALID` on its optimising pass **today, with no
   pins**, and the ladder falls through to the objective-less passes without saying so. Reproduced
   on the shipped solver; four- and six-week fixtures do not. Worth its own issue.

## Churn cap

Frank set the cap at 10 for this loop and it is reached. Ten substantive rounds, no approval.
**The character of the findings changed decisively at the end:** rounds 1–9 each found a
mechanism or contract defect; round 10 found none — its sole blocker was prose left behind by the
round-9 rewrite, and every executable claim it checked passed. That is the first round whose
findings were entirely editorial, and it is the signal that the design has stopped moving.
