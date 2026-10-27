# Review log — multi-ministry phase 1, access model (PRs 2 and 3)

Artifact: `2026-10-27-multi-ministry-phase1-access.md`. Procedure:
`.agents/skills/adversarial-plan-review/SKILL.md`, reviewers one at a time, each fresh, each given the
same cold packet (immutable snapshot + SHA-256, read-only repo, evidence pointers, Frank's verbatim
requirement), never this ledger or an earlier verdict.

**Approval is not authorization to implement.** Frank's «Dale» (2026-10-27 23:20Z) started the work;
each PR still goes through the gates, one fresh code review and the release order.

## Risk tier

**Critical**, derived from the ladder, not raised or lowered: the slice changes an auth/ACL boundary
(`requireMinistryMember`/`requireMinistryManager`, called by every Kids route and every worship page)
and a production writer of permissions (members POST/PATCH). Critical needs two consecutive fresh
`APPROVED` on byte-identical bytes.

## Rounds

| Round | Digest (SHA-256) | Commit of the repo | Verdict | Streak |
|---|---|---|---|---|
| 1 | `20df75ae…0e14` | 93ed813e + uncommitted docs | CHANGES_REQUIRED (substantive) | 0 |
| 2 | `96710f7c…a890` | 93ed813e + uncommitted docs | CHANGES_REQUIRED (substantive) | 0 |
| — | churn cap reached; Frank's go-ahead for round 3, decision card, 2026-10-27 23:44:06Z («Sí, sigue revisando») | | | |
| 3 | `35091708…e449` | a661f9ae | APPROVED | 1 |
| 4 | `35091708…e449` | a661f9ae | APPROVED | 2 → approved |

## Blockers and dispositions

**Round 1**

1. *Registering `jovenes` in `MINISTRIES` (PR 2) makes it writable and offered before PR 3.* Verified:
   `validateMinistryWrite` checks `ministries` against `ALL_MINISTRY_IDS` (`app/ministries.ts`), the
   form's pills and `MINISTRY_SCOPES` read the same list (`MembersPanel.tsx:140,169-175,510`), the Studio
   lists its options by hand (`worshipTeam.ts`), and `ministries.test.ts:8` pins the registry. **Fixed:**
   `ASSIGNABLE_MINISTRY_IDS` (worship, kids in PR 2; `jovenes` added in PR 3) for every write and offer
   site; a PR 2 test that both routes reject `["jovenes"]`.
2. *The worship-role rule misses a role-only PATCH.* Verified: PATCH is touched-field
   (`app/api/admin/members/[id]/route.ts:93-98`), so a body with `role` alone never met a rule keyed on
   `ministries`. **Fixed:** the rule judges the resulting state whenever role or ministries change,
   reading the stored values; an unchanged re-send still saves (the form always sends `role`).

**Round 2**

1. *The PR 3 dev check (make the Verificador bot Jóvenes-only) is an unconsented write to the dataset
   production reads, names no writer, and its obvious shape contradicts the plan's own rule.* Verified:
   the bot is seeded `role: "admin"`, `["worship"]`, manages kids (`scripts/lib/dev-verify/seedDoc.ts`);
   the runner aborts every non-GET (`docs/DEV_VERIFY.md` «Why it cannot write»); `/admin` is role-gated.
   **Fixed:** phase 1 writes no one's data to test; Jóvenes-only isolation is proven by tests; a
   dedicated Jóvenes bot, seeded by a guarded script with Frank's consent, waits for phase 3.

Rounds 3 and 4: no blockers.

## Non-blocking items

Adopted before approval (from rounds 1–2): the `$all => { ministryRoles }` conditional projection; no
patch sets and unsets the same path; only admins and leaders registered after PR 3; a read-only count
of unknown ministry ids before PR 2 (§4.0); a Studio `role` validation and the documented stale-level
revival; `ifRevisionId`/409 on the stored-state read; `accessFromDoc` extracted so the equivalence test
runs the real normalization; `ministries.test.ts` lines 6–8; the form strips `_key`; worship-admin
noise noted for phase 3.

Adopted after approval (rounds 3–4), as §8 of the plan: listed under «Post-approval changes» below.

Not adopted: none.

## Process failures on the author's side

- **Round 2's blocker was introduced by the author** while adopting a round-1 non-blocking suggestion
  (a Jóvenes-only dev check on the bot) without checking the bot's seeded role or who could write it.
- **The churn cap was reached** after round 2. It was not exceeded: the loop stopped, Frank was asked
  on a decision card before round 3, and his answer is recorded above. The two rounds found different
  defect classes (round 1: write-side gating of a newly registered value; round 2: an operational
  verification step touching real data), not one class twice; the access design itself was not
  challenged in rounds 2–4.

## Post-approval changes (NOT reviewed)

Approval covers digest `35091708…e449` only. After it, the plan changed in two places, both outside
that approval:

1. The status line (records the approval).
2. A new §8, «Post-approval amendments», adopting the non-blocking notes of rounds 3–4: test files that
   change on purpose; Vercel rollback/promotion named beside a revert; the form shows the server's
   error text; unticking Jóvenes removes its item; the Jóvenes scope only for the super-admin;
   `levelIn`/`groupsIn` non-member values; PR 3's stop condition on non-worship admins; the
   `managesMinistries` count is a sanity check; the mixed dev/production window; PR 3's visual check is
   Frank's and saving there is real; `ministryRoles` items carry `_type`.

The approved body is otherwise byte-identical to the reviewed snapshot (checked with `diff`). The code
review of PRs 2 and 3 covers §8.
