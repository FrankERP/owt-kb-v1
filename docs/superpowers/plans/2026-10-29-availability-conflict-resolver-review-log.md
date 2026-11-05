# Review log — availability conflict resolver plan

**Approval is not authorization to implement.** The build follows the release order in CLAUDE.md
(gates → one code review → preview → PR → production), and the implementation gets its own code
review.

## Risk tier

**Critical**, derived from the ladder (not raised or lowered): through revision 7 the plan was a new
automated production writer of role documents with a member-triggered mutation boundary; from
revision 8 it is a new server writer of `availabilityConflict` records plus an admin email (triggered
by a member's availability save and a cron tick) and a new admin write path into roles («Aplicar»,
through the unchanged `editRole`). Both shapes are on the critical ladder, so two consecutive fresh
approvals on byte-identical bytes were required.

## Rounds

| Round | Digest (sha-256, first 8) | Commit | Verdict | Go-ahead |
|---|---|---|---|---|
| 1 | 6df21a01 | uncommitted (base 8a61f9f) | CHANGES_REQUIRED | — |
| 2 | 9f22f1dd | uncommitted | CHANGES_REQUIRED — churn cap reached | — |
| 3 | b0dd7007 | 7a95b86 | CHANGES_REQUIRED | Frank 2026-10-29 23:54Z |
| 4 | d6683810 | 600a6aa | CHANGES_REQUIRED | Frank 2026-10-30 01:00Z |
| 5 | daab6158 | c586970 | CHANGES_REQUIRED | Frank 2026-10-30 01:13Z (rounds 5–7) |
| 6 | be92f846 | 51d334b | CHANGES_REQUIRED | (same) |
| 7 | ba44346c | 64011d2 | CHANGES_REQUIRED — go-ahead exhausted, escalated | (same) |
| 8 | 2fc380cd | d8c6dc7 | CHANGES_REQUIRED | Frank 2026-10-30 13:54Z («Solo propuestas por ahora»: new, simpler design; new cycle) |
| 9 | 55424efe | 712d527 | CHANGES_REQUIRED — churn cap reached again | (same) |
| 10 | 78d5fa24 | 0cc5dae | **APPROVED** (streak 1) | Frank 2026-10-30 14:32Z (up to 3 more rounds) |
| 11 | 78d5fa24 | 0cc5dae | **APPROVED** (streak 2) — plan approved | (same) |

Every round used a fresh `general-purpose` reviewer with only the brief, the immutable snapshot and
its digest, the evidence pointers and Frank's verbatim requirement. Every digest was unchanged at
the end of its round.

## Blockers and dispositions (each verified against the code before acting)

- **R1** B1 `auto`/`applied` → `gone` on the next sweep made the «never twice» rule dead — fixed
  (explicit transition table, per-event email). B2 an `editRole` throw after commit left an unrecorded
  change — fixed (later replaced, R2).
- **R2** B1 an implicit `kept` silenced real conflicts (copy-instruments and hand picks re-seat; the
  picker never refuses unavailability, `pickJudge.ts:78-80`) — fixed (`kept` only by «Mantener»).
  B2 picker order instead of the fillers' (`localFill.ts:166-205`, `instrumentFill.ts`) — fixed.
  B3 `createIfNotExists` races, ownerless pending record (`setlistSaveCommit.ts:225`) — fixed (role +
  record in one transaction, `create`).
- **R3** B1 a GitHub `schedule` trigger is what ADR-0032 rejected (3.3% delivery) — fixed (ride the
  Cloud Scheduler flush tick). B2 an incoherent inventory read as «conflict gone»
  (`storedMonthBoard.ts:66-68`) — fixed (no transitions on a non-judgeable read).
- **R4** B1 a due-but-unsent email was never re-sent by the tick — fixed.
- **R5** B1 a stale board across picks in one sweep — fixed (working board).
- **R6** B1 two absent people in one draft: one write vs one record per identity — fixed.
- **R7** B1 a proposed pick folded into the working board leaked into a later automatic write — not
  patched: the defect class of rounds 5–7 was the method (automatic draft writes and proposals sharing
  one sweep). Escalated to Frank, who chose proposals only.
- **R8** B1 adding the raw month verdict to `MonthCheck` would put member ids and rule ids on four MCP
  answers (`serviceEditor.ts:909,1038`, `proposalEditor.ts:566,694`; ADR-0062) — fixed (separate
  `monthCheckVerdict`).
- **R9** B1 «Mantener» stayed sticky after the conflict ended, so a re-marked date was never proposed
  — fixed (`kept` + not C → `gone`).

No blocker was refuted.

## Non-blocking items

Adopted before approval: listed in the private ledger per round (among them: read token fail-closed,
delivery-blocked claims, kill switch, `coalesce(week, date)`, the `emailProposals` field, records read
before roles, a past-date guard on «Aplicar», `draftGatingCoverage` exemption).

Declined: an admin alert after repeated blocked sweeps (rounds 4, 10, 11) — recorded as an accepted
cost in ADR-0078 and told to Frank; the panel shows «No se pudo revisar».

## Process failures (author's side)

- The churn cap was reached three times (after rounds 2, 4/7 and 9); each continuation had Frank's
  explicit go-ahead BEFORE the next round, recorded above.
- Rounds 1–7 kept patching one design whose defect class (automatic writes sharing a sweep with
  proposals) was visible by round 5; the escalation that ended it came at round 7, later than it
  should have.
- Plan commits before round 8 carried Co-Authored-By trailers that CLAUDE.md forbids; later commits
  do not.

## Post-approval changes

Listed in §12 of the plan, marked UN-REVIEWED; the implementation's code review covers them.
