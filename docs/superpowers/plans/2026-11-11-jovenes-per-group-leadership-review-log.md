# Review log — 2026-11-11-jovenes-per-group-leadership.md

Skill: `.agents/skills/adversarial-plan-review`. Approval is NOT authorization to implement; the
owner's request (Frank, 2026-11-11: «necesitamos que se pueda segmentar el liderato») is, and the
plan's release steps keep every production write behind his explicit consent.

## Tier

**Critical**, derived from the ladder (not raised or lowered): who leads which Jóvenes group
decides who reads a group's drafts and writes its meetings (an auth/ACL boundary), the plan changes
the payload of a production writer (`memberCommit.ts`), and it migrates stored `ministryRoles`.

Author: the plan was drafted by a separate agent (Fable 5.2) at the owner's request; the review
loop and every disposition below are the coordinating session's.

## Rounds

| Round | Reviewed digest | Commit of base | Verdict | Streak |
|---|---|---|---|---|
| 1 | 6ac5ba06…6c01df8 | 3cb5a03a4 | APPROVED | 1 |
| 2 | fd0cd77d…1638a5 | 3cb5a03a4 + edits | APPROVED | 1 (new digest: non-blocking items adopted after round 1) |
| 3 | d8c739c8…5f42 | 3cb5a03a4 + edits | APPROVED | 1 (new digest: non-blocking items adopted after round 2) |
| 4 | d8c739c8…5f42 | same bytes | APPROVED | 2 — done |

Each round was a new reviewer with only the brief, the snapshot path and SHA-256, the evidence
pointers and the owner's requirement. Snapshot and canonical digests were checked equal before
each round and after each verdict. No round raised a blocker, so the churn cap was never in play.

## Blockers

None in any round.

## Non-blocking items

Adopted before round 2 (each verified against the code first):
- `MinistryRole` gaining `leaderOf` breaks the two request bodies typed `MinistryRole[]`
  (`memberEdits.ts`, `MembersPanel.tsx`) → a `MinistryRoleWrite` type in PR 1.
- T3 claimed the chat's before/after shows `leaderOf` in PR 1; it does not until T7 → corrected.
- After the backfill every leader stores `leaderOf` = `groups`, so K1 would have turned any group
  added from the production form into membership → K1 reads a stored `leaderOf` equal to the stored
  groups as legacy.
- K1 keyed on "explicit array"; a present non-array would take the legacy arm → keyed on presence.
- The backfill CHECK was ambiguous → defined as the L1-vs-L2 difference of normalized reads.
- Cloud sessions have no `.env.local` → the backfill runs on the Mac through Remote Control.
- Old Studio drafts can restore older `ministryRoles` → §9; the existing `STUDIO_DRAFT` warning
  (`app/mcp/tools/members.ts:79`) verified.

Adopted before round 3:
- `mcpRoute.test.ts:1695` pins the full tool digest (`663bdcc0`), verified → T5(b)/T7 update it on
  purpose, and each release sends connectors the refresh note.
- The backfill's planning rule ("no array `leaderOf`") would have widened a leader whose present
  non-array value reads as leading nothing → one meaning of "absent" (missing or null) everywhere.
- Re-run the check right before PR 2's preview merge; read with `perspective: "raw"`; import
  `app/ministries.ts` (verified: no imports) rather than re-implement the normalizer.
- The Studio array is read-only (`worshipTeam.ts:96`, verified) → the hand fix is «Personas» only.
- Nobody assigns `adrenalin`/`guerreras` on dev until production has PR 1.
- K1's asymmetry recorded for the ADR (T10).

Declined: showing `leaderOf` in PR 1's displays (display-only; K1 never widens; PR 2 shows it).

Refuted (rounds 2 and 3): "§5.3 misdates the joint-meeting decision as 2026-11-04". Frank answered
both joint-meeting cards on 2026-11-04 (`docs/adr/0081-…md:37,39`;
`2026-10-30-jovenes-events-access.md:21,24`); 2026-11-05 is the plan's approval date.

## Post-approval changes (UN-REVIEWED)

Added after round 4 to the plan as §11 (N1–N11) plus the plan's Status line, from rounds 3–4's
non-blocking notes: the no-revert rule for PR 1's read side, PR 2's chat bodies always sending
`leaderOf`, the no-`_key` hand fix, the L1/L2 switch's lifetime and an equivalence test, the
planner copy, the coverage guard's scope, K1's `null` and 409 wording, two said-aloud narrowings,
`versions.*` in the backfill and its rollback, fixture churn, and one cross-reference. They fall
outside the approved digest; the merge-range code review of each PR checks them.

## Process notes (author's side)

- Non-blocking items were adopted after rounds 1 and 2, each reset the streak; from round 3 they
  were held so round 4 could confirm the same bytes, then folded in as §11.
- Every reviewer citation that drove an edit was checked by reading the cited lines.
