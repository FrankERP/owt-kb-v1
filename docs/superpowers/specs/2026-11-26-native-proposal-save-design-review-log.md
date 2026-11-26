# Review log: native app slice W1 (a lead proposes the setlist)

Artifact: `2026-11-26-native-proposal-save-design.md`. Process: `.agents/skills/adversarial-plan-review`.
Every reviewer was fresh, run one at a time on an immutable snapshot, and saw only the brief and
the cold packet. Approval is not authorization to implement.

## Tier

**Critical**, derived from the ladder: the artifact moves a production writer (the lead's
`setlistProposal` save) and opens a second mutation door to it (the native app's bearer-token
door, an auth/trust boundary).

## Rounds

| Round | Digest (SHA-256, first 8) | Verdict | Streak | Substantive |
|---|---|---|---|---|
| 1 | dd8904c0 | CHANGES_REQUIRED | 0 | yes (1) |
| 2 | 21ec35d1 | CHANGES_REQUIRED | 0 | yes (2), churn cap reached |
| 3 | a8d05ae7 | CHANGES_REQUIRED | 0 | yes, run on Frank's go-ahead (2026-11-26 15:33Z) |
| 4 | 2ad6730f | APPROVED | 1 | n/a (PR 1 applied on the branch first, on Frank's choice at 15:41Z) |
| 5 | 2ad6730f | CHANGES_REQUIRED | reset to 0 | yes |
| 6 | 678f8b63 | APPROVED | 1 | n/a (pair run on Frank's go-ahead at 15:59Z) |
| 7 | 678f8b63 | CHANGES_REQUIRED | reset to 0 | yes |

Final spec digest after round 7's fixes: a815bea0 (not reviewed).

## Blockers and dispositions (each verified in the tree before acting)

- **R1-1** `appAuthStatic.test.ts` forbids `export const POST` under `app/api/app/v1`, while
  `srVerificationRunContext.test.ts` requires exactly that form for a route importing a
  delivery-capable module. Verified (`appAuthStatic.test.ts:96`, `srVerificationRunContext.test.ts:644-659`,
  `serviceCommitCallers.test.ts:266`). Fixed: `appAuthStatic` narrowed to accept only
  `export const METHOD = withVerificationRunContext(<local async function>)` whose first statement is
  the guard.
- **R1-2** The move changes guard registries the plan did not list. Verified
  (`protectedReadAudit.ts:304`, its test's unused-exemption and migrated-read checks,
  `EXPECTED_CALLERS`). Fixed: registry edits listed per PR.
- **R2-1** A read helper receiving its client as a parameter is invisible to `protectedReadAudit`.
  Verified (`protectedReadAudit.ts:884-900`). Fixed: helpers import `operationalClient` themselves.
- **R2-2** The native editor dropped «Tonos anteriores». Verified (`api/me/songs/route.ts:63`,
  `ProposalEditor.tsx:394,732`, `appSongs.ts:20`). Fixed: D3b.
- **R3-1** `seatClashGuardCoverage.test.ts` requires every `*Commit.ts` classified. Verified (:7-8,
  :66-69). Fixed.
- **R3-2** Moving the history read leaves `/api/me/songs` without a canonical read in the migrated
  list. Verified (test :669, :682). Fixed: the list swaps in `songPreviousKeys.ts`.
- **R5-1** D5 contradicted itself on a failed or lost save: read literally, the lead's draft was
  replaced, or a re-read revision adopted silently could overwrite a co-lead. Verified (server
  compares id + revision only, `proposalSaveCommit.ts:131`; web keeps `rev` on error,
  `ProposalEditor.tsx:442-472`). Fixed: one rule, `ProposalDraftState` with XCTest cases.
- **R7-1** No test binds the Swift save body to `parseProposalSaveRequest`, which ignores unknown
  keys; a missing `teamNotes` would erase stored team notes (`proposalSaveCommit.ts:278`). Verified.
  Fixed: D7b, a shared body fixture tested on both sides.

No blocker was refuted. Non-blocking items adopted are folded into the spec; none was declined
except persisting the draft across an app kill (stated as a known limit).

## Process failures on the author's side

- The plan's first three versions enumerated the repository's static guards by reading, and each
  round found more. The remedy (Frank's choice, round 4) was to apply the move on the branch and
  let the gates enumerate them: five failures, all named, nothing else.
- Round 4 raised the D5 problem as non-blocking; I held it to keep the digest for the confirming
  round, and round 5 made it a blocker. A non-blocking note that names lost work deserved
  verification as a possible blocker at once.

## Outcome

The loop ended **without** two approvals on one digest. Every reviewer from round 3 to round 7
verified D1 (the writer move, PR 1) against the code with no finding; every later blocker was in
PR 2's client contract, which has no code yet. Frank chose (2026-11-26 16:11Z, decision card
«Separar: primero el paso 1») to release PR 1 through the normal path (one code review of the
merge range, preview, his go-ahead for production) and to review PR 2's design again when its code
exists.

## Post-approval changes

None: no digest was approved and left standing.
