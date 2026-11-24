# Review log: 2026-10-24-owt-mcp-admin-parity-f2-deletes.md

**Tier: critical**, derived from the ladder, not raised or lowered by judgment. The plan extracts and
reaches a production writer that DELETES documents (an irreversible remote action) from the chat and
from the card, with notification side effects. The whole plan is the slice that owns that contract.

Approval is not authorization to implement. Frank asked for phase 2 on 2026-10-24 at 00:27Z («Dale con
la fase 2») and chose the two open questions at 00:51Z (the card deletes too; past services stay in
`/admin`). He gave the go-ahead to continue past the churn cap at 00:51Z («Sigue revisando»).

## Rounds

| Round | Digest reviewed | Verdict | Streak |
|---|---|---|---|
| 1 | `bcfcef37…85ee5` | CHANGES_REQUIRED | 0 |
| 2 | `e5024eb6…bfff58` | CHANGES_REQUIRED | 0 |
| 3 | `deecc703…1cce7` | APPROVED | 1 |
| 4 | `deecc703…1cce7` (same snapshot) | CHANGES_REQUIRED | 0 (reset) |
| 5 | `9e00f5d5…ee4c2a` | APPROVED | 1 |
| 6 | `9e00f5d5…ee4c2a` (same snapshot) | APPROVED | 2 |

Canonical and snapshot digests matched before and after every verdict. Between rounds 2 and 3 the plan
also took Frank's two decisions (the card twin D8 and the card slice T5; D5 confirmed).

### Round 1: two blockers, both fixed

1. The echoed line had no single source: the check could render from `adminRolesQuery` (dereferenced,
   dangling refs dropped, `published` coalesced) while the save read `ROLE_PROJECTION` (raw `_ref`s), so
   every published delete could refuse on a line mismatch; and the count of notified people was not the
   notice audience. Evidence checked: `serviceReadQueries.ts` (`adminRolesQuery` vs `ROLE_PROJECTION`),
   `normalizeStoredSeats` dropping label-less slots, `outboxSweep.ts` `wantsNotification`. Fix: both tools
   render from the writer's own read (`loadCanonicalRolesByIds` + raw overlays); N from the notice
   builder's functions; wording «se avisa a hasta N personas».
2. Raw draft overlays were invisible to the check, so a service the save refuses could be previewed as
   deletable. Evidence: `loadCanonicalRole` pairs the canonical read with `runRaw`. Fix:
   `loadRawRoleDraftIdsForBaseIds` in the check.

Non-blocking adopted: the check's time budget, the 31-per-call note, exporting `byDateThenType`, the D7
citation, the unresolved-write divergence (D9), recovery (D10), D8 wording, special disambiguation, a
full-size prompt observation in the proof.

### Round 2: one blocker, fixed

The live proof's step (1) offered a VALID delete of a real full month, guarded only by Frank declining the
prompt, which this repo documents as a hint that «Siempre permitir» removes (`docs/MCP.md`). Fix:
throwaways first; the full-size prompt only with a call the server refuses.

Non-blocking adopted: a list token (HMAC over the whole list) and «never Siempre permitir»; dropping the
circular «a MAC adds nothing» claim; `DELIVERY_CAPABLE_IMPORTS`; `storedRoleDate` mapping; bounded
check concurrency; a strict reader (a failed read is not «gone»); D10's limits; today's services in Q2.

## Churn cap reached

Rounds 1 and 2 were both substantive. Frank's go-ahead for round 3 was asked and given (00:51Z).

### Round 3: approved. Round 4: one blocker, fixed

Round 4 found that «a token from another check» in the proof could be a VALID token, because the list
token is deterministic in (month, list): re-running the check yields the same token, so the «refused»
call against a real month could delete it. **Same defect class as round 2: the live proof touching a real
month.** Following the skill («the defect is the method»), the fix consolidated instead of patching a
third construction: the proof now runs ONLY over throwaway services, and no real service is ever named in
a destructive call. Round 3's own non-blocking note had already called that construction weak; the
author did not act on it before round 4 (a process slip, recorded here).

Non-blocking adopted (rounds 3 and 4): `not_found` re-read strictly before «ya no existe»; «repite» offered
once; lost notices named in the answer; strict reads in the check too; NFC before the token; the token
in the schema; the `PROTECTED_RUNTIME_WRITERS` entry moves; `validateRole` failures listed as kept; the
whole-month note under `focus`; N via `seatAssignees`; a count of published services left out; T5/T6
order; legacy weekend services take two rounds; a published throwaway in the proof.

### Rounds 5 and 6: approved

Two fresh reviewers, one after the other, approved the same snapshot
(`9e00f5d55455be36dfe3cdf9e83dca3868d430d935bb0d346eb9cb5a1eee4c2a`). The critical tier's requirement is met.

## Post-approval changes (UN-REVIEWED)

From rounds 5 and 6's non-blocking items; none changes the writer, the token, the refusals or the trust
boundary, and the merge-range code review covers them:
- N is `.length` (the array `seatAssignees` returns), not `.size`.
- D2 names the strict variant: beside `run`/`runRaw`, on the same pinned clients, overlay read included.
- «revisa de nuevo» wins over «repite» when one run produces both.
- The line renderer takes only the role.
- One copy for a failed upsert («borrado, pero no se pudo avisar a: …»), with names from a member read
  done before any delete (fallback «a N personas»); a «sin confirmar» on a published service names who
  may not have been told.
- The proof: publishing the throwaway needs `save_service_edits` and `publish_service` (leg skipped if
  readiness refuses); weekend lock paths are proven by tests only; no permission prompt on the first
  chat call stops the release for Frank's decision; `check_service_deletes` has no card `resourceUri`, and
  check logs cannot tell the card from the model (said in the ADR).

Declined: re-reading inside `deleteRole` after a non-conflict throw to queue notices for a commit that
landed. It changes the shared writer's behaviour (outside the approved bytes) for a gap `/admin` and phase
1 share; the answer names the people instead.
