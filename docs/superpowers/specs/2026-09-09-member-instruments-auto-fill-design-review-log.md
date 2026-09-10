# Review log — declared instruments and automatic instrument fill

Artifact: `2026-09-09-member-instruments-auto-fill-design.md`
Skill: `.agents/skills/adversarial-plan-review/` (vendored copy of the canonical skill).
**Status: APPROVED — round 4, digest `d4a0fe34…`, one valid fresh `APPROVED`, which is
the standard-tier requirement.** Rounds 3 and 4 ran past the churn cap on Frank's explicit
go-ahead each time («Sí, lanza la ronda 3», 13:55 CST; «Por persona, lanza la ronda 4»,
14:42 CST, 2026-09-09).

Approval is not authorization to implement; the implementation was separately code-reviewed on the merge range and released 2026-09-10 (PR #57). Implementation still
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
| 3 | `534c32d178fee3be45c144100a41e8d208756775bcf13013f84b850bb1758548` | `763f7c82` | CHANGES_REQUIRED | yes | 0 |
| — | `a59b286584e71005e9e44b532fd728e9b56b3babac06685fe50fbb53248500be` | `d29a3b2d` | not reviewed (superseded before dispatch by Frank's per-person confirmation) | — | — |
| 4 | `d4a0fe3427c56bcc781503fdc0864360c7b5e968464e4597a76e174420cda390` | `f9d410ac` | **APPROVED** | — | 1 |

Canonical file digest re-checked after the round-4 verdict: `d4a0fe34…`, identical.

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

## Round 3 — two blockers, verified, fixed

1. **The render-time `occupants.length === 0` gate (a round-2 adoption) would hide
   markers for partially filled multi-target rows.** Checked: `unfilled` is one entry per
   missing SLOT — the solver emits one string per slot (`owt_solver_v2.py:987-990`),
   `mapUnfilledSeats` pushes one per string (`plannerModel.ts:966-984`), `localFill.ts:289-291`
   loops `current.length..target`. A Coro with one of three seated has two entries and a
   non-empty cell. **Fixed:** the gate is scoped to `instrumento:` rows (target 1); the
   wiring test carries a partially filled Coro.
2. **The stated per-instrument ≤1 guarantee was false under the per-member total
   ordering once anyone declares two instruments.** Verified by re-tracing the
   reviewer's case (X Keys+Drums, Y Drums, Z and W Keys): Keys ends Z 3, W 2, X 0; totals
   end X 3, Y 2, Z 3, W 2. **Fixed:** §6.2 now states the delivered property as
   per-member total balance, shows the trace, notes that per-row counting is a one-line
   alternative, and asks Frank to confirm the reading at spec review; the trace is a
   named test. D2 cross-references it.

Non-blocking, adopted: the "no test imports a schema module" rationale corrected
(checked: `migrateProposalMessages.test.ts:21` does); vacate rule worded on the per-CELL
`origin` (checked: `plannerModel.ts:82`); row tie-break "then `rows` order";
`MemberOption` (`serviceCardModel.ts:96`) gains the field; the create form posts it
(checked: `AdminPanel.tsx:839-844` destructures named fields); backfill follows
`backfill-legacy-seat-arrays.mjs` (backup + `_rev` guard) with `setIfMissing`, pure logic
in `scripts/lib/`, and runs before the preview push since Sanity is schemaless. Not
adopted: none.

## Round 4 — APPROVED

The reviewer traced the per-member-total case by hand and reproduced the spec's numbers,
confirmed idempotence on own output by enumerating every producer of `origin: "auto"`
(`applySolveResponse` voice rows only, `fillColumn` lead/bgv only, every human path
through `withUpdatedCell` stamping `"manual"`), confirmed the scoped render gate against
the three producers of `unfilled`, confirmed the D6/PATCH/backfill contract, and checked
that existing fixtures (no member with `instruments`) keep their Auto assertions because
every instrument row has zero declarers. No blocker.

Six non-blocking items, all adopted **after** the approval and listed in the spec's §12
as un-reviewed. Each citation was checked before adoption: `handleAdd` is at
`AdminPanel.tsx:831` (there is no `handleCreate`); availability is read at
`candidateRanking.ts:200`; `mapUnfilledSeats` starts at `plannerModel.ts:958`;
`seatModel.ts:45` canonicalizes `console`.

## Churn cap

Three substantive `CHANGES_REQUIRED` rounds. Rounds 3 and 4 each ran only after Frank's
explicit go-ahead, obtained in advance and recorded above. Recorded in the worklog as a `coordinator-inline`
entry naming the defect class:

> §6.2 restates state and eligibility the planner already owns (`rankCandidates`,
> `origin`, `working`), and each restatement leaves out one rule the existing code
> enforces. Round 1: the same-category block. Round 2: the vacate/count ordering.

Round 3 found a different class: two of its findings were **claims the spec made
about behaviour it does not own** — a render gate written without checking the shape of
the `unfilled` state it filters, and a fairness guarantee stated for a property the
ordering does not compute. Both were the author's, one of them a round-2 adoption.

## Process failures on the author's side

- The round-2 blocker was introduced by the author's round-1 fix (the vacate-and-re-roll
  rule was a non-blocking adoption, placed inside the loop without tracing a second run).
  A fix written in response to a review is not lower-risk than the text it corrects.
- The round-3 blocker 1 was likewise introduced by the author's round-2 adoption (the
  emptiness gate), written without reading how `unfilled` is populated. Two of three
  rounds found a defect in the previous round's fix — the same lesson CLAUDE.md records
  for code fixes applies to spec fixes.
- The round-3 blocker 2 was a guarantee the author asserted twice (rounds 1 and 2)
  without tracing a multi-instrument case, even after round 1's non-blocking note named
  exactly that coupling.
- No reviewer claim was accepted without the independent check; every citation fix was
  verified against the file before adoption.

## Post-approval changes (un-reviewed)

Adopted after the round-4 `APPROVED` on `d4a0fe34…`, so outside that approval — spec §12
lists them: create path posts `instruments` only when touched and non-empty; "known
name" defined as `DEFAULT_INSTRUMENT_SEATS` membership; per-row declarer count as a
`rankCandidates` filter; per-cell `origin` promotion corollary; «sin declarar» in its own
element; three citation corrections. Current canonical digest after these edits is
recorded in the commit that carries them.
