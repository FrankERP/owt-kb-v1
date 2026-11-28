# Review log: native «Mensajes del servicio» (A-W2)

Artifact: `2026-11-28-native-service-messages-design.md`.
Process: `.agents/skills/adversarial-plan-review/` — sequential fresh reviewers, each given only
the brief, the immutable snapshot and evidence pointers.

## Tier

**Critical**, derived from the ladder, not judged: the slice adds a second mutation door onto five
production writers (`serviceThreadCommit.ts`), three of which notify the leads, and one of which
(the thread message POST) has no idempotency. Two fresh approvals on identical bytes were required.

## Rounds

| Round | Reviewed digest | Commit | Verdict | Streak |
| --- | --- | --- | --- | --- |
| 1 | `60377ea0…afde965` | 89cc765c | CHANGES_REQUIRED | 0 |
| 2 | `49bdade4…9746b` | eb69e950 | APPROVED | 1 |
| 3 | `49bdade4…9746b` (same snapshot) | eb69e950 | APPROVED | 2, done |

The canonical file's digest was checked unchanged after round 3 before any amendment was added.

## Round 1 blocker

- **The two threads were merged on the server, while write answers carry only the service
  thread.** After any POST, PATCH or DELETE the leads' replies (in the proposal's thread) would
  vanish until a reload, and an admin who sees the chat change under them may retype: a duplicate
  plus a second email. **Verified:**
  - `messagesOf` keeps stored keys unprefixed (`appProposalEditor.ts`);
  - the web dialog replaces only the service list after a write (`ServiceMessagesDialog.tsx`);
  - both existing app doors send the threads apart.

  **Fixed:** D2 sends `serviceMessages` and `proposalMessages`, a client rule says what each answer
  replaces, and an XCTest was added.

Round 1 non-blocking notes, all checked against the code and adopted before round 2:
- `appRefusal` carries only `error`, `conflict` and `details.issues`, so the phone's copy now
  branches on those;
- a team-notes resend is refused as `revision_mismatch`;
- the `routeMatcher.test.ts` `PUBLIC_ROUTES` entries;
- AGENTS.md, `docs/API_REFERENCE.md` and the `protectedReadAudit.ts` caller sentence;
- service wording for the outbox's refusals;
- the SR-scan substring rule for the GET's source;
- a services-list reload after a save;
- the verify read adopted on screen;
- reuse of `loadActorName` instead of a third name helper (an empty name already reads «Un
  admin»);
- the narrowing named for Frank.

## Rounds 2 and 3

No blockers. Their non-blocking notes were adopted AFTER the confirming approval, as the spec's
«Post-approval amendments» A1–A10, **un-reviewed by a plan round**: the merge-range code review
checks them in the diff. Each was checked against the cited code before adoption. In particular:
- `isMessageKey` accepts `s0`, so A4 computes `editable` from the stored `_key`;
- neither the pastor's-message writer nor the team-notes writer checks `isThreadOpen`, which
  corrects the narrowing's «only reading is lost» in A9;
- `appServices.ts` drops a published service with nobody seated and no songs (A9);
- `ConversationThread`'s outbox is view state, so the sheet must not be dismissable mid-send
  (A1).

Declined: none. The reviewer's suggested live POST on dev became A10's «no live write», the A-W1
rule: dev writes to the real dataset and mails real leads.

## Process notes (author side)

- The round 1 blocker was the author's own construction: D2 merged the threads for convenience
  and D3 was then written per writer, without checking what the screen needs after a write.
- No churn cap was reached: one round with verified blockers.
