# Review log: solver rules name a person by member id (C1)

Artifact: `2026-11-20-solver-rules-by-member-id.md`. Process: `.agents/skills/adversarial-plan-review/`.
**Approval is not authorization to implement.** Implementation waits for Frank's approval of the plan,
and the data migration for his explicit consent after a dry run.

## Tier

**Critical**, derived from the ladder (not raised or lowered): the plan changes a production writer's
payload and module boundary (`solverConfigCommit.ts`: the rules POST and the MCP rule tools) and is a
data migration of production rules. Two sequential fresh approvals on identical bytes required.

## Rounds

| # | Digest (SHA-256, first 12) | Commit | Verdict | Streak |
|---|---|---|---|---|
| 1 | `4d1f66e9acab` | 76b7a05c | CHANGES_REQUIRED (substantive) | 0 |
| 2 | `c56ea6bae9cf` | 71357608 | CHANGES_REQUIRED (substantive) — **churn cap reached** | 0 |
| 3 | `687d83e76a03` | a23c4099 | CHANGES_REQUIRED (substantive), run with Frank's go-ahead | 0 |
| 4 | `96fb1ce5678b` | 7155cc93 + test-list tidy | APPROVED | 1 |
| 5 | `96fb1ce5678b` (same bytes) | same | CHANGES_REQUIRED (substantive) — streak reset | 0 |
| 6 | `dac676f929f6` | ddf11246 + test-list tidy | APPROVED | 1 |
| 7 | `dac676f929f6` (same bytes) | same | APPROVED | **2 — requirement met** |

Approved digest: `dac676f929f6a893995bbedbb084e1936b09ff119ea2cb8d15c11e6872c74863`.
Each round was one fresh reviewer given only `reviewer-brief.md`, the immutable snapshot path and
digest, evidence pointers and Frank's requirement; none saw earlier reviews.

## Blockers and dispositions (each verified against the code before acting)

**Round 1** (design: ids in memory, a label at every printer; two PRs; canonicalize on save)
1. Save-time canonicalization would convert all production rules at the first save after PR 2 reached
   `preview`, before any dry run or consent. Verified: both writers write all six fields
   (`solverConfigCommit.ts:89-97, 205-212`). **Fixed** (no save rewrites untouched rules).
2. Printer inventory incomplete: ids would reach people and the MCP wire. Verified:
   `ruleEnforcement.ts:443,656`, `v3RuleIds.ts:78-92` interpolate raw tokens. **Fixed** (table + canary).
3. The migration script cannot import the `server-only` writer. Verified: `fairnessMonthCommit.ts:21`,
   comment at `reconstructRun.ts:166`. **Fixed** (non-`server-only` writer core, C4 precedent).

**Round 2**
1. More printers missed: `fairnessPreviewModel.ts:397-412` `resolverLines`, `availabilityConflicts.ts:608`
   via `ruleCopy.conflictSentence`, rename warning lines, `v3MonthSources.ts:94` →
   `V3_RESOLVER_REFUSAL` (`v3Copy.ts:322-330`). Verified. **Fixed by redesign** (below).

**Churn cap.** After round 2 (two substantive rounds) the loop stopped. The defect class both rounds
found was the same: *a stored id reaches a printer the inventory missed*. That was read as the method
being the defect, so the plan was rewritten: ids live only in storage; one read translation
(`rulePeopleToNames`) and one write translation (`rulePeopleToIds`); a document marker set only by the
consented migration. Frank's go-ahead was obtained before round 3 (decision card, 2026-11-20 19:13Z),
again before round 4 (19:24Z, covering rounds until two approvals unless a new serious blocker), and
again before round 6 after round 5's blocker (19:44Z).

**Round 3** (new design)
1. The write translation followed the STORED mode, so the migration would write names unchanged and
   the rollback would write ids. Verified against the plan's §3.2/§4.1 text. **Fixed** (target mode).
2. The roster projection lacked `ministries`, which `resolveRulePersonId` reads as worship when absent
   (`sundayCadence.ts:21-28`). Verified. **Fixed** (one roster query with `ministries` and drafts filter).
3. The lossless gate would compare the names view with its own re-parse, hiding coercions
   (`solverConfigCommit.ts:146-154` compares raw). Verified. **Fixed** (still compares raw fields).

**Round 5** (confirming round 4's approval)
1. In id mode the rename warning, built from a post-rename names view and compared with the
   pre-rename roster, would flag the renamed person's own rules, and `/me` refuses an alias change on
   any such line (`memberCommit.ts:309-313`, `memberRuleRename.ts:96-112`). Verified. **Fixed**: in id
   mode `planRuleRename` and `orphanRuleWarnings` return nothing, with tests.

No blocker in any round was refuted; every one survived verification.

## Non-blocking items

Adopted before the final approval (reviewed): normalised, deterministic labels; refusal codes the panel
shows; a `not_worship` reason; total `--to-names`; migration runbook (no pending MCP proposal); older
deployments named as readers; no version bump (justified); coverage test; schema field; dry-run checks.

Adopted after the final approval, **un-reviewed**, listed in the plan's §9 (rounds 6–7 notes):
names-mode label rule, normalisation-mismatch reason, writer dedupe, refusal discriminator and copy,
v3 copy variants, POST echo in the canary, `studioProtection` field list, dry-run respelling list and
fingerprint scope, names-mode roster failure, ADR additions (Sanity references, existence oracle, grid
silence, suffix drift).

Declined: a label-map fingerprint echoed by clients to close the name-swap race (round 3): it needs a
client-contract change and the swap case is no worse than today; recorded as a known limit.

## Process notes (author side)

- Rounds 1 and 2 were spent on a design whose defect class (unbounded printer inventory) should have
  been seen in self-review; the redesign came only after the cap.
- The author's own edits left stale cross-references twice (the tests list after rounds 3 and 5),
  fixed before the next snapshot.
- Production premises (§1.6: 13 rule names, each resolving to one member) were taken as stated by
  every reviewer; they come from a read-only query on 2026-11-20 and are re-checked by the dry run.
