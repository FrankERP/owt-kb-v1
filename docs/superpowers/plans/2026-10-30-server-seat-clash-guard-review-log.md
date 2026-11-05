# Review log — server seat-clash guard plan

Artifact: [`2026-10-30-server-seat-clash-guard.md`](2026-10-30-server-seat-clash-guard.md).
Skill: `.agents/skills/adversarial-plan-review/`. **Approval is not authorization to
implement:** the plan still needs Frank's OK.

## Tier

**Critical**, derived from the ladder, not raised or lowered: the plan changes four production
server writers (`editRole`, `createRole`, `swapRoles`, `copyInstruments`) and the month confirm
that writes the fairness records. Critical = two fresh, sequential `APPROVED` on identical bytes.

## Rounds

| Round | Digest (SHA-256) | Commit | Verdict | Streak |
|---|---|---|---|---|
| 1 | `38ebd5ed8937…` | 8690e09d | CHANGES_REQUIRED (substantive 1) | 0 |
| 2 | `2252edbdf628…` | ae50f8dc | CHANGES_REQUIRED (substantive 2 → cap) | 0 |
| 3 | `79fc77c3c758…` | 46493f90 | APPROVED | 1 |
| 4 | `79fc77c3c758…` | 46493f90 | CHANGES_REQUIRED (substantive 3) | **reset to 0** |
| 5 | `8e88730648ff…` | 8028f507 | CHANGES_REQUIRED (substantive 4) | 0 |
| 6 | `c232751d9ae2…` | 1a1c925f | APPROVED | 1 |
| 7 | `c232751d9ae2…` | 1a1c925f | APPROVED | **2 — done** |

Every round was a fresh reviewer given only the immutable snapshot, the repository and the
owner's words; none saw the ledger or an earlier verdict.

## Blockers, with the evidence checked

- **R1 — Auto can make a clash in normal use, and the guard would refuse it after the fairness
  records were written.** Checked: the v3 pins carry voice rows only (`v3SolveRequest.ts:127-155`),
  the filler keeps hand-placed instrument cells (`instrumentFill.ts:128-130`), ADR-0078 says such
  a clash is caught only by the grid's ⚠, and `runV3ConfirmAttempt` writes records before drafts.
  **Fixed:** D3b, a pre-write clash check in the confirm (v3 and v2).
- **R2 — `apply_schedule` would print «ya pasó… vuelve a correr solve_month» for a clash.**
  Checked: `applySchedule.ts:385-391` re-derives every `refused_guard` cause from `confirmGuard`.
  **Fixed:** a `reason` discriminator set by each guard; callers branch on it.
- **R4 — «Copiar a todo el mes» writes stored columns without C2, so the stored save meets the
  guard in normal use with only «(invalid_request)».** Checked: `PlannerGrid.tsx:1650-1729`
  (`planCopyAcrossColumns` → `withUpdatedCell`, no `rankCandidates`/`seatsClash`), offered at
  1878-1883; the save's notices at `MonthGenerator.tsx:3613-3629`. **Fixed:** the server puts a
  built `sentence` in each `seatClashes` entry and every refusal surface shows it.
- **R5 — in a mixed stored save the reconciliation notice rewrites the line from the refusal
  count alone, losing the sentence.** Checked: `MonthGenerator.tsx:3035-3040` reads only
  `saveKnownFailures`. **Fixed:** `saveClashLines` state and one pure `storedSaveNotice`.

No blocker was refuted.

## Non-blocking items

Adopted before the final approval: MCP surface list; coverage order including
`bootstrapLegacyLock`; unchanged member-read scope; one shared hint constant; `clashingPairs`
shared with the grid; skipping already-created drafts; v3 copy in `v3Copy.ts`; one swap toast
site; `refusalFor` leads with the clash; comment-stripping coverage scan; production FOH
duplicates checked (none); ServicesPanel = copy-instruments only; swap callers corrected; Task 3
test files named; no double print of sentence and `ISSUE_COPY`; «aparece dos veces en Lead»;
names from a members map, never ids; the proposal named as `apply_schedule`'s way out plus
`L.noWriteThisCall`; `normalizeLabel` note; the confirm count lines named as the flag-race
exception; one display-name rule; lowercased seat-id labels; the worship-only client map noted.

Not adopted: making «Copiar a todo el mes» skip or name clashing columns (R4 offered it as an
alternative) — the save line covers every path that reaches PATCH, the copy alone covers one.

## Post-approval changes (un-reviewed)

Plan §7, eight items from R6/R7's non-blocking notes, each checked against the cited code
(`MonthGenerator.tsx:3626/3043/3045`, `proposalEditor.ts:263`, `monthDraftCreate.ts:95-96`,
`v3ConfirmRun.ts:75`, `serviceEditor.ts:~1346`): every stored-save notice carries the clash
lines; v2's line kept out of `V3_LINES`; blank draft slots dropped; `monthReportLines` after
records; `apply_schedule`'s way out depends on whether applying started; a reload hint; an
empty-name fallback; the `notSavedGroup` surface. They fall outside the approved digest. The build
(plan §8) differs from §7.5 and §7.8 where the code showed the note's premise was off; the
merge-range code review covers the implementation.

## Process failures on the author's side

- **The churn cap was exceeded, with the owner's go-ahead each time:** round 3 (2026-10-30
  14:23Z), round 5 (15:20Z), rounds 6–8 as a standing go-ahead (2026-10-31 00:27Z). Four
  substantive rounds in all.
- **The defect class** across rounds 1, 2, 4 and 5: the plan assumed a client path or caller
  already handled the clash ("this path went through C2", "callers know why it refused", "the
  final notice is the one shown"). Each time the remedy was to stop depending on the path —
  the R4 fix (every surface shows the server's sentence) — and R5 found that fix applied to one
  notice and not its twins.
- R3's approval was on a digest that R4 then found a blocker in: one fresh reviewer's
  approval was not enough, which is why critical needs two.
- An early plan commit carried an attribution trailer CLAUDE.md forbids; amended before push.
