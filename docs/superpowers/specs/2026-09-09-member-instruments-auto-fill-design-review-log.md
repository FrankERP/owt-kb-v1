# Review log — declared instruments and automatic instrument fill

Artifact: `2026-09-09-member-instruments-auto-fill-design.md`
Skill: `.agents/skills/adversarial-plan-review/` (vendored copy of the canonical skill).
**Status: PAUSED at the churn cap after round 2. No approval has been recorded. Round 3
requires Frank's explicit go-ahead, obtained before it starts.**

Approval, when it comes, is not authorization to implement. Implementation still
requires the plan, the three gates, and a fresh code review of the diff.

## Risk tier

**Standard**, derived from the ladder, not adjusted: a new optional field on
`teamMembers`, a pure client-side filler, and a one-off backfill script guarded by
`--apply`. No production writer contract, serializer, auth/ACL boundary, schema
*migration* (the field is additive; the backfill writes only where the field is absent),
concurrency protocol or irreversible remote action. The CP-SAT solver is not touched.
Requirement for approval: one valid fresh `APPROVED`. The loop ran on Frank's explicit
request («Haz el review loop»), which is the standard-tier trigger.

## Rounds

| Round | Reviewed digest (SHA-256) | Commit | Verdict | Substantive? | Streak after |
|---|---|---|---|---|---|
| 1 | `78d62155602f35d33c16338f6d3a55d986b972e2d906c0e865c5baad328cdfc2` | `24a31bbb` | CHANGES_REQUIRED | yes | 0 |
| 2 | `99046fa40128a45f09d78b5810da3bb0d515b0174643196657ae9fc233d97290` | `93351dae` | CHANGES_REQUIRED | yes | 0 |
| — | `534c32d178fee3be45c144100a41e8d208756775bcf13013f84b850bb1758548` | `763f7c82` | not reviewed | — | — |

Each round used a brand-new `skeptical-reviewer` dispatch given only the reviewer brief,
an immutable scratchpad snapshot (digest verified equal to the canonical file before
dispatch), the repository path, the evidence pointers and the user's original wording.
No reviewer saw this ledger, a prior verdict or a rebuttal.

## Round 1 — three blockers, all verified, all fixed

1. **Filler seated one member on two instrument rows of the same column.** The spec's
   §6.2 exempted "a different instrument row on the same column" citing D4; D4 is
   voice + instrument only. Checked: `candidateRanking.ts:193-196` returns
   `blockedReason: "Ya asignado en …"` for a held seat of the same category, and
   `moveGate.ts:332-334` makes that C2, never forceable. The spec's own D1 and the
   backfill produce multi-instrument members, so the case is real. **Fixed:** the pool is
   `rankCandidates(...)` re-run per placement, filtered on `eligible && !undeclared`, as
   `localFill.ts` does; the filler never re-implements eligibility. §9 test inverted.
2. **Failure-exit `unfilled` filter double-counted instrument seats.** Checked:
   `MonthGenerator.tsx:2947-2950` keeps previous entries unless on a special column;
   instrument entries sit on weekend columns, so every non-success exit (a solver
   refusal is D15's normal failure) would re-append them. **Fixed:** §6.3 drops previous
   entries on a special column OR with the `instrumento:` prefix; wiring test added.
3. **D1 vs §6.2 step 5 contradicted each other on rows nobody declares.** Checked:
   `buildRows` (`plannerModel.ts:301-325`) always seeds five instrument rows, so "one
   marker per empty pool" would mark undeclared rows on every weekend column.
   **Fixed:** rows with zero declarers are skipped and produce no marker.

Non-blocking, adopted: thinnest-pool-first row order and an honest statement that the
≤1 bound is per instrument, not per member total; touched-field discipline for the
PATCH body (checked: `AdminPanel.tsx:334-346` already does it for `ministries`) with a
`!== undefined` guard in the route; a second amber line with its own copy instead of
widening `occupantFitsSeat` (checked: the Tipo copy at `PlannerGrid.tsx:2846` is
Tipo-wired); `origin: "auto"` instrument cells re-rolled on a second Auto; backfill
restricted to `DEFAULT_INSTRUMENT_SEATS`; three false citations corrected (checked: no
member projection in `roles/[id]/route.ts`; no `sanity:deploy-schema` script, the
command is `npx sanity schema deploy`; `CONTEXT.md` does not exist, `docs/DATA_MODEL.md`
does). Not adopted: none.

## Round 2 — one blocker, verified, fixed

1. **Per-column vacate polluted the balance with the previous Auto's stale picks.** The
   round-1 fix placed the `origin: "auto"` vacate inside the per-column loop while the
   count runs over every column of `working`. Verified by tracing the spec's own rules:
   two drummers A and B, A unavailable on Sundays 3–5 — run 1 gives A,B,B,B,B; run 2 on
   identical inputs gives A,A,B,B,B, refuting the spec's own determinism claim. The
   reviewer also confirmed the vacate rule is otherwise safe (stored months load as
   `origin: "manual"`, `storedRoleReadModel.ts:125-148`; Auto exists only in create mode,
   `PlannerGrid.tsx:1971`; human edits stamp `"manual"`, `PlannerGrid.tsx:468,478`).
   **Fixed:** step 0 vacates every auto instrument cell on every weekend column in one
   pass before the loop; the stated property is now idempotence on its own output, with
   the reviewer's case as a named test.

Non-blocking, adopted: custom planner rows («Nuevo instrumento», `PlannerGrid.tsx:1790`)
are outside the member vocabulary, so the filler skips them and the declaration warning
stays silent for them, and D1's "any future one" was removed (a warning naming a remedy
the member form cannot perform is the ADR-0029 defect class); a *declarer* is defined as
Tipo `instrumento` AND the label; the per-cell marker and the count gate on emptiness at
render (checked: no `setUnfilled` in `handleCellsChange`, `MonthGenerator.tsx:2434`);
the backfill skips members with no history rather than writing `[]`; the schema list
lives in `sanity/schemas/instrumentSeats.ts` with no `sanity` import so the test can
import it (checked: `themePrefSchema.test.ts` reads schema files as text); the
`candidateRanking.ts:218` "DELIBERATELY UNCHANGED" comment is amended in the same diff;
citation drift `:2942-2945` → `:2947-2950` corrected. Not adopted: none.

## Churn cap

Two substantive `CHANGES_REQUIRED` rounds. Per the skill, round 3 does not start
without Frank's explicit go-ahead. Recorded in the worklog as a `coordinator-inline`
entry naming the defect class:

> §6.2 restates state and eligibility the planner already owns (`rankCandidates`,
> `origin`, `working`), and each restatement leaves out one rule the existing code
> enforces. Round 1: the same-category block. Round 2: the vacate/count ordering.

The round-2 fix removed the last piece of restated eligibility (the pool is now
`rankCandidates` and nothing else) and the last piece of restated state (vacate happens
once, before any count). Whether that is enough is what round 3 would test; that call is
Frank's.

## Process failures on the author's side

- The round-2 blocker was introduced by the author's round-1 fix (the vacate-and-re-roll
  rule was a non-blocking adoption, placed inside the loop without tracing a second run).
  A fix written in response to a review is not lower-risk than the text it corrects.
- No reviewer claim was accepted without the independent check; every citation fix was
  verified against the file before adoption.

## Post-approval changes

None — there is no approval yet.
