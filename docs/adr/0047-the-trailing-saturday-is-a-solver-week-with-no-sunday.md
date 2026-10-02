# ADR-0047: The trailing Saturday is a solver week with no Sunday

**Date:** 2026-09-30 · **Status:** Accepted

> **Numbering.** ADR numbers follow the order records reach `main`; this is the next free
> number on `main` when written (0046 is the highest). Delivery 1 of 3: the solver. The planner
> does not send `weeks + 1` yet — that is delivery 2, in the companion spec. Spec:
> [`2026-09-29-solver-trailing-saturday-design.md`](../superpowers/specs/2026-09-29-solver-trailing-saturday-design.md)
> (critical tier, two fresh approvals); review log:
> [`…-design-review-log.md`](../superpowers/specs/2026-09-29-solver-trailing-saturday-design-review-log.md).

> **Amended 2026-09-30 (delivery 2):** the planner now sends `weeks + 1`. See
> [ADR-0048](0048-the-saturday-after-the-last-sunday-belongs-to-its-calendar-month.md). It sends the
> trailing Saturday when it is selected and some lead can take it (T5). A request member unavailable
> that day gets `<name> !in week <weeks+1> Sat.*`. Saturday minimums are judged per person against
> the Saturdays sent and their seats (T3/T4). The decision below is unchanged. «The planner does not
> send `weeks + 1` yet» was true when this was written.

## Context

A month-end Saturday whose Sunday falls in the next month — Sat 31 Oct 2026 (Sun 1 Nov), and
31 Jan and 28 Feb 2026, 31 Jul 2027 — is staffed by no month's Auto. The planner links a Saturday
to a solver week only by adjacency to an in-month Sunday (D16), and the next month's planner offers
only its own Saturdays. Frank (2026-09-29): «Quiero que octubre lo trate como un sábado extra sin
domingo»; (2026-09-30) the next run must fill the 31st too. Production and dev share ONE solver
Cloud Function, deployed from `main` with no `preview` rehearsal, so the change has to be provably
inert for every request that does not use it.

## Decision

1. **D1 — a real solver week, not a second solve (Approach A).** `weekends_with_saturday` gains ONE
   legal value, `weeks + 1`, the trailing Saturday (`normalize_weekend_indexes`; `last_week`,
   `gcf/owt_solver_v2.py`). `weeks` keeps its meaning (the number of Sundays) and its `3..6` guard.
   Week `weeks + 1` is staffed in the same model as the month: `Sat.Lead` ×2 and `Sat.BGV` ×3
   (grown by pins, ADR-0041), **no Sunday seats**, appended by `build_slots` after every existing
   slot so none changes its position in the decision variables' insertion order (the seeded
   tie-break reads that order). It is an index, not a new field, on purpose: a solver that predates
   this change refuses `weeks + 1` with a `ValueError` (`ok: false`, 422), so a new planner talking
   to an old solver fails loudly; a new field would be silently ignored by `solve_from_dict`.
2. **D2 — `{weeks-N}` counts Sundays.** `resolve_dsl_templates` is unchanged. A month with four
   Sundays and a trailing Saturday is still a four-week month for relative rules.
3. **D3 — per-week rules bind the trailing Saturday.** Every per-week loop runs to
   `last_week(weeks, sat_weeks)` (`max_week` in `create_model_and_solve`), which is `weeks` for a
   request that does not name the trailing Saturday and `weeks + 1` for one that does: the
   mandatory lead, pair rules, weekly presence, the hard and soft consecutive rules (W`weeks` with
   W`weeks+1`), one seat per service, week exclusions, `diagnose_infeasibility`. The dedicated
   Saturday-lead anchor already iterated `sat_weeks`. Counts, `Sat.* == 1` minimums, spreads and
   absence slack count its seats.
4. **No phantom Sunday.** Week `weeks + 1` carries no Sunday seat, variable, count, availability
   rule or objective term. The soft consecutive penalty skips the Sunday roles in that week only,
   so there is no `asgn[p,Sun.*,W5]` and no `rep[p,Sun.*,W4]`; `build_schedule_view` gives the week a
   `Saturday` entry and no `Sunday` key. A `Sun.*` rule has no terms there and is skipped.
5. **Refusals stay `ValueError` or `RuntimeError` → `ok: false` → 422.** The `ValueError`s: `weeks + 2`
   or more in `weekends_with_saturday`; a week exclusion or a pin naming `weeks + 1` when the request
   does not name the trailing Saturday; a Sunday-role pin in week `weeks + 1` («which has no Sunday
   service»). Every week-range message counts Sundays («the month has 4 Sundays»), never «5 weeks».
   The `RuntimeError` is an INFEASIBLE request, raised from `diagnose_infeasibility`; when that
   request names `weeks + 1` the diagnostic adds one line suggesting it be deselected. The
   `ValueError` refusals carry no such line.

**The invariant.** A request that does not name the trailing Saturday builds the model it built
before, byte for byte, pinned or not, with or without history. It is proven by frozen literals in
`gcf/test_inertness.py` (`docs/CI.md` has the governance table): the three existing ones
(`STAGE_A_FINGERPRINTS`, `LADDER_FINGERPRINTS`, `GOLDEN_SCHEDULE`) stay green, plus
`IDENTITY_FINGERPRINTS` — Stage A and every later solve, over eight shapes (no, some and all
Saturdays; five Sundays; week exclusions; history; pins; pins with history). Those were **captured on
the unchanged solver**: commit `8408e3de`, with the two pinned shapes' Stage A entries re-captured in
`eaa62893` once the hash left out `solution_hint` (under pins it is Solve 0's tie-broken solution,
which the machine breaks) — both before the first solver change, `70b6cc87`, so commit order is the
audit. PR #121's Linux CI runs on both passed without a re-capture, so the literals are
machine-independent. `TRAILING_FINGERPRINTS` (`w4-trailing`, Saturdays `[2, 4, 5]`) freezes one
request that names the trailing Saturday, captured (on macOS) on the first solver that staffs it;
the Linux run on `8534eabd`, which added it, passed as well. A red literal in a PR that claims
non-trailing requests unchanged is a finding, never a re-capture.

**Where this departs from the spec's step zero.** §7 asked for a separate PR adding a
history-bearing fixture before the solver change. Ruling P1 of the plan put it in this branch's
first commits instead: ADR-0046 made production requests history-free, so the history-free literals
already match the production shape, and first commits on the unchanged solver give the same
guarantee (captured before the change) auditable from commit order, without a second Cloud Build
redeploy of identical code. The spec's §7 is amended to say so.

## Rejected

- **A local greedy fill** (the specials' filler). It knows no Saturday-lead pool (it seated a member
  in no pool as Lead in the prototype) and treats caps and presence as non-goals.
- **Two solves, the second pinning the solved Sundays («freeze and extend»).** No solver change, but
  per-person floors and a phantom Sunday week complicate the planner, it collides with «Solo llenar
  vacíos» (pins twice), and its acceptance test rejected the fill on real October data.
- **Remapping onto a deselected in-month Saturday.** Needs a free host week (false with the default
  all-Saturdays selection) and silently moves stored «Sem 4» Saturday rules onto the 31st.
- **Folding the 31st into the next month's week 1.** Frank chose the calendar month.
- **A client-side virtual week that discards a phantom Sunday.** D16 removed exactly this: phantom
  Sunday counts distorted fairness and history.
- **A `weeks + 2` bound on every per-week loop**, or **skipping absent roles in every week** of the
  soft consecutive loop. Both change the models of requests that do not name the trailing Saturday
  (a Saturday-less week already carries empty Saturday-role variables), which the invariant forbids;
  the prototype showed that bounding by «the last week the request names» does not.
- **A vendored copy of the old solver under `gcf/` as the differential oracle.** Cloud Build deploys
  `--source=gcf`, so it would ship. Frozen literals carry the same proof.

## Consequences

- **A stored `<name> !in week <weeks+1> …` rule changes meaning:** refused today in a four-Sunday
  month, it binds the 31st once the request names it.
- **`{weeks}` resolves against the Sundays (D2).** `X Sat.Lead <= {weeks}` on every dedicated
  Saturday lead can sink a month with one more Saturday, because the anchor wants a dedicated lead on
  each one. Real October 2026 has no such cap; the refusal's hint names the way out.
- **The mandatory lead stays hard on the pinless path.** A trailing Saturday nobody can lead sinks
  the month, exactly like an in-month Saturday nobody can lead (under pins it goes soft:
  `builtin:mandatory_lead:W5:Sat`). The planner's pre-flight (delivery 2) keeps it from sending one:
  that is T5 in ADR-0048. It is advisory: the dedicated-lead anchor and zero maximums are outside it.
- **What the frozen history shapes do not reach:** neither history shape hits `objective_skipped`,
  so a month whose real history overflows the objective is not frozen by a literal. The spec's
  reviewers checked the real October 2026 request (28 shapes, 0 mismatches) with their own harness,
  but on the throwaway prototype, not on this code; since ADR-0046 the planner sends no history.
- **Release is production-first and preview-less:** merge, then the deploy check in
  `docs/SOLVER_AND_INFRA.md` («Verifying a Cloud Function deploy», step 3 sends a trailing smoke
  request; `ok: false` means the old revision still serves, so redeploy). Rollback is one-sided: the
  planner stops sending `weeks + 1` first, then the function if ever both.
- **The python gate grows by about 29 s** (the `TrailingSaturday` class, 15 tests, and the fixture).
