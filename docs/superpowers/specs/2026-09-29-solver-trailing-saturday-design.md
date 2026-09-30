# The trailing Saturday in the CP-SAT solver — design spec (delivery 1 of 3)

**Date:** 2026-09-29 · **Status:** APPROVED at critical tier — two fresh approvals on digest
`d7c4b0dd…841a` (commit `6a8a3bdd`); the items marked «(post-approval)» were added after it and are
un-reviewed. Review log: `2026-09-29-solver-trailing-saturday-design-review-log.md` ·
**Risk tier: critical** — it changes the constraint model and the request contract of the
production solver, which Cloud Build deploys from `main` to ONE Cloud Function serving
production and dev with no `preview` rehearsal. Requirement: two sequential fresh `APPROVED`
verdicts on byte-identical text before implementation; the churn cap applies.

Companion: `2026-09-29-planner-trailing-saturday-and-fill-empty-design.md` (deliveries 2 and 3,
standard tier). This file owns the solver contract only; the planner decides when to send it.

**Contracts, not prescriptions.** This spec states what the solver must do and must never do.
Line numbers, helper names and loop shapes belong to the plan.

## 1. The brief

A month-end Saturday whose Sunday falls in the next month — Sat 31 Oct 2026 (Sun 1 Nov),
also 31 Jan and 28 Feb 2026, 31 Jul 2027 — is staffed by no month's Auto today. The planner
links a Saturday to a solver week only by adjacency to an in-month Sunday (D16,
`docs/superpowers/plans/2026-07-29-planner-grid.md`), and the next month's planner offers only
its own Saturdays. Frank (2026-09-29): «Quiero que octubre lo trate como un sábado extra sin
domingo» — the month it belongs to on the calendar staffs it.

Measured on the investigation (scratchpad prototype, real October 2026 data): every month that
ends on a Saturday has exactly four Sundays, and its trailing Saturday is always last Sunday + 6.

## 2. Decisions (Frank, 2026-09-29)

- **D1 — Approach A.** The trailing Saturday is a real solver week staffed in the same model as
  the rest of the month, not a second solve and not a local greedy fill (both rejected; the
  design panel's dossier is summarised in §9).
- **D2 — `{weeks-N}` counts Sundays.** A month with four Sundays and a trailing Saturday is still
  a four-week month for relative rules.
- **D3 — Per-week rules apply to the trailing Saturday.** It is a week: mandatory lead, pair
  rules, weekly presence, consecutive rules (against the last Sunday's week), one seat per
  service, week exclusions and the dedicated Saturday-lead anchor all bind there.
- Decisions about WHEN the planner sends it (no possible lead, unreachable minimums, selection)
  are the companion spec's.

## 3. The request contract

`weekends_with_saturday` keeps its meaning and gains ONE legal value: **`weeks + 1`**, the
trailing Saturday. `weeks` keeps its meaning — the number of Sundays — and its `3..6` guard is
unchanged.

- `weeks + 1` is the ONLY index above `weeks` that is accepted; anything larger is refused as
  today, with a message that names the legal range and what `weeks + 1` means.
- **Why an index and not a new field.** The deployed solver refuses `weeks + 1` with a
  `ValueError` (`ok: false`), so a planner that sends it to a solver predating this change fails
  loudly and visibly (`solverRefusalMessage` shows the reason). A new field would be silently
  ignored by `solve_from_dict`, and the planner — which no longer drops a person's Saturday minimum
  once the trailing Saturday is staffable **by that person** (companion T3; post-approval wording) —
  would send a `Sat.* == 1` that an old solver cannot satisfy,
  sinking the whole month under a misleading diagnostic: the October 2026 outage again.
- A week exclusion (`<name> !in week N <pattern>`) may name `weeks + 1` **only when the request
  names the trailing Saturday**; otherwise it is refused as today.
- `pinned` (ADR-0041): a pin may name week `weeks + 1` **only for a Saturday role and only when the
  request names the trailing Saturday**. A Sunday role in that week is refused with a message
  saying the week has no Sunday service.

## 4. The response contract

- `schedule["<weeks + 1>"]` holds a `Saturday` entry and **no `Sunday` key**. Every other week is
  unchanged.
- `unfilled_seats` entries for it read `W<weeks+1> Saturday Sat.<Role> #<n>`, the existing format.
- `pin_violations` entries follow ADR-0041's grammar unchanged; a consecutive entry spanning the
  last Sunday's week and the trailing Saturday reads `W<weeks>-<weeks+1> <person>: <source>`;
  builtin markers read `…:W<weeks+1>:Sat` and `builtin:sat_anchor:W<weeks+1>`.
- `total_counts` / `role_counts` include the trailing Saturday's seats.
- No new response field. The deploy check (§7) reads the schedule itself.

## 5. The model

For a request naming the trailing Saturday:

- **Seats.** Week `weeks + 1` has the Saturday seats a Saturday has today (2 Lead, 3 BGV, grown by
  pins as ADR-0041 allows) and **no Sunday seats**. There is no phantom Sunday of any kind: no Sunday
  seat, variable, count, availability rule or objective term for that week.
- **Every per-week mechanism runs over it** (D3). Where a mechanism iterates weeks, the trailing
  week is included; where it iterates services, it sees only the Saturday. The soft relaxation of
  ADR-0041 (under pins) covers the trailing week's instances like any other.
- **Counts.** Month totals, per-role counts, DSL count rules (`Sat.* == 1` is satisfiable by the
  trailing Saturday), fairness spreads and absence slack count its seats. A member fully excluded
  from it earns a service of absence slack, as for any Saturday.
- **Templates.** `{weeks-N}` resolves against `weeks` (Sundays), per D2.
- **Diagnostics.** `diagnose_infeasibility` examines the trailing week and names it
  («Week 5 Saturday: no one available to lead (Sat.Lead)»).

**Invariant — a request that does not name the trailing Saturday builds the model it builds
today, byte for byte.** Pinned or not, with or without history. This is the property the
preview-less release rests on (§7).

**Placement constraint, stated because it is load-bearing:** the trailing week's slots must be
created after every existing slot, so no existing slot changes its position in the decision
variables' insertion order (the seeded tie-break reads that order; the soft consecutive penalty
creates variables per week). The prototype showed that bounding every per-week loop by "the last
week the request names" satisfies the invariant; an unconditional `weeks + 2` bound does not.

**(post-approval)** That bound alone still creates phantom Sunday variables: the soft consecutive
penalty's per-role loop makes `asgn[p,Sun.*,W<weeks+1>]` fixed to 0 and their `rep` terms (42
variables measured in review round 2). The no-phantom contract above therefore also requires that
loop to **skip the Sunday roles in week `weeks + 1` only** — skipping absent roles in every week
would change today's models (a Saturday-less week already carries empty Saturday-role variables).

**(post-approval)** A stored rule `<name> !in week <weeks+1> …` is refused today in a four-Sunday
month; once the request names the trailing Saturday it binds that Saturday — the same reading every
other week number has, stated because it changes what a stored rule does.

## 6. Errors

- `weeks + 2` or larger in `weekends_with_saturday`: `ValueError`, as today, message updated. Every
  week-range message counts Sundays («the month has 4 Sundays; 5 is the Saturday after the last
  one»), never "the month has 5 weeks" (post-approval).
- A week exclusion or pin naming `weeks + 1` without the trailing Saturday: `ValueError`.
- A Sunday-role pin in week `weeks + 1`: `ValueError` naming the missing Sunday service.
- A trailing Saturday nobody can lead: the mandatory-lead constraint is hard on the pinless path,
  so the month is refused exactly like an in-month Saturday nobody can lead today, with the
  diagnostic naming week `weeks + 1`. The companion spec's pre-flight keeps the planner from sending
  such a Saturday (Frank: «31 a mano, con aviso»); the solver does not special-case it.
- **(post-approval)** Whenever a request that names `weeks + 1` is refused as infeasible, the
  diagnostic adds one line naming the trailing Saturday and suggesting it be deselected: the anchor,
  a cap, a pair or a consecutive rule can sink a month that solves without it (reproduced in review:
  dedicated leads capped `Sat.Lead <= 2` solve with four Saturdays and are refused with five), and
  T5 checks only eligibility and availability. Text only; the model is untouched.
- All refusals stay `ValueError` / `RuntimeError` → `ok: false` → 422; none may become a 500.

## 7. Tests, inertness and release

**Step zero — freeze a history-bearing fixture first.** The inertness guards
(`gcf/test_inertness.py`) run with `history: []`, and every production request since ADR-0042
carries derived history (which also drives `objective_skipped`, ADR-0038). Before the solver
change, a separate PR adds a history-bearing frozen fixture (fictitious names) to
`test_inertness.py`, captured from the pre-change solver, with the same governance as #100
(`docs/CI.md`). The «Auto-solver servicios especiales fairness» session plans the same fixture for
its objective work; whichever lands first, the other reuses it.

**(post-approval)** Step zero is amended, not dropped. ADR-0046 (#120) made production requests
history-free (`history: []`), so the history-free literals already match the shape production
sends. What step zero must guarantee is that the fingerprints come from the pre-change solver, and
a fixture committed first in the delivery's own branch, on the unchanged solver, gives that
guarantee and is auditable from commit order; a separate PR would only add a Cloud Build redeploy
of identical code. So the identity fingerprints — eight shapes, **with and without history**,
pinned and pinless — were captured in this branch's first commits (`8408e3de`; the two pinned
shapes' Stage A entries re-captured in `eaa62893` after the hash left out Solve 0's
`solution_hint`), both before the first solver change (`70b6cc87`). Plan ruling P1.

**Required tests (python, in the `gates` job):**
- All existing `STAGE_A_FINGERPRINTS`, `LADDER_FINGERPRINTS` and `GOLDEN_SCHEDULE` literals stay
  green, plus the new history-bearing one. A red one inside this PR is a finding, never a
  re-capture.
- A differential identity check over a spread of request shapes WITHOUT a trailing Saturday —
  pinned and pinless, with and without history, with a week exclusion, with no, some and all
  Saturdays: every solve's model and parameters identical to the pre-change solver. **Mechanism
  (post-approval):** the per-shape fingerprints are frozen as literals in the step-zero PR, captured
  from the pre-change solver under `test_inertness.py`'s governance — never a vendored copy of the
  old solver under `gcf/`, which Cloud Build would deploy (`--source=gcf`).
- Trailing seats exist with no Sunday; `schedule["5"]` has only `Saturday`; unfilled seats map.
- `weeks + 2` refused; a week-5 exclusion refused without the trailing Saturday and applied with it;
  a Sunday pin in week 5 refused and a Saturday pin honoured.
- `Sat.* == 1` satisfied by the trailing Saturday; a pair rule and a presence rule bind there; the
  consecutive rule binds weeks 4–5 and reports `W4-5 …` under pins; one seat per service holds.
- The anchor binds the trailing Saturday; the diagnostic names week 5.
- (post-approval) A full `!in week 5 *.*` earns exactly one service of absence slack (not two); under
  pins, `builtin:mandatory_lead:W5:Sat` and `builtin:sat_anchor:W5` are reported; the soft
  consecutive loop creates no `Sun.*` variable for week 5; a refused trailing request carries the
  deselect hint.
- After review: a trailing-Saturday frozen fixture joins `test_inertness.py`, so later changes to
  this path are measured against it.

**Release (production-first, like #102):** the solver PR merges and deploys before any planner
code sends `weeks + 1`. Deploy check, recorded in `docs/SOLVER_AND_INFRA.md`:
1. `gcloud functions describe owt-solver --gen2 --region=us-central1` — `updateTime` after the
   merge, state `ACTIVE`.
2. The documented pinless smoke request (`ok: true`, `pinned_honored` present).
3. One smoke request naming the trailing Saturday (fictitious names): `ok: true` and
   `schedule["5"]` present with only `Saturday`. An old revision answers it `ok: false` — the
   deploy did not land; redeploy (post-approval wording).
4. (post-approval) `docs/SOLVER_AND_INFRA.md` «Input / output (JSON)» documents the new legal index,
   and the PR adds an ADR (next free number at merge) for «a solver week with no Sunday», carrying §9.

**Rollback** is one-sided: the planner stops sending `weeks + 1`; the solver's non-trailing path is
unchanged by the invariant. Revert the planner first, then the function, if ever both.

## 8. Known limits, stated

- **Unoptimised on real months.** On history-bearing months the fairness objective is skipped today
  (`ObjectiveTooLarge`, measured 240/240 on October 2026 by the fairness session), so the trailing
  Saturday — like every seat — is a legal first-found draw until that is fixed. This change adds
  Saturday slots and so raises the bound slightly; the fairness session includes a trailing shape in
  its measurements.
- **Presence rules on patterns that include Saturday roles** (`*.BGV each_week`) must now be met on
  the trailing Saturday by itself (D3). A rule on `Sun.*` has no terms there and is skipped, as the
  solver already skips a week with no terms.
- **(post-approval) `{weeks}` on a Saturday-lead cap.** D2 resolves it against the Sundays while a
  month with a trailing Saturday has one more Saturday, and the anchor wants a dedicated lead on
  every Saturday: `X Sat.Lead <= {weeks}` on every dedicated Saturday lead can sink the month. Real
  October 2026 has no such cap; the refusal's deselect hint (§6) names the way out.
- **The MCP P4 plan** (`2026-09-28-owt-mcp-p4-solve-apply.md`, approved critical tier) mirrors the
  planner's week mapping and pins October's 31st as unaddressable. It is not touched here; the
  companion spec records the amendment it needs before P4 is implemented.

## 9. Rejected, with the evidence that decided it

- **Local greedy fill (the specials' filler).** It knows no Saturday-lead pool (it seated a member in
  no pool as Lead in the prototype), treats caps and presence as non-goals, and cannot see the
  month's fairness.
- **Two solves, the second pinning the solved Sundays («freeze and extend»).** No solver change, but
  per-person floors and a phantom Sunday week complicate the planner, it collides with «Solo llenar
  vacíos» (pins twice), and its acceptance test rejected the fill on real October data.
- **Remap onto a deselected in-month Saturday.** Cheapest, but needs a free host week (false with the
  default all-Saturdays selection) and silently moves stored «Sem 4» Saturday rules onto the 31st.
- **Folding the 31st into the next month's week 1.** Frank chose the calendar month.
- **A client-side virtual week that discards a phantom Sunday.** D16 removed exactly this: phantom
  Sunday counts distorted fairness and history.

## 10. Out of scope

Everything the planner does (when it sends `weeks + 1`, per-person minimums, notices, the «Fuera del
alcance de Auto» surface, «Solo llenar vacíos») — the companion spec. The objective overflow — the
fairness session. Stored-mode weekend Auto — unchanged.
