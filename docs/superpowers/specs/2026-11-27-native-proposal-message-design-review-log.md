# Review log: 2026-11-27-native-proposal-message-design.md

Process: `.agents/skills/adversarial-plan-review/SKILL.md`. Approval is not authorization to
implement. The owner asked for the fix itself (2026-11-27 19:38Z), which is the implementation's
authorization. The production release is still his decision on a card.

## Tier

**Critical**, derived from the ladder, not raised or lowered. The plan adds a second door, the
native app's, onto a production writer: the lead's proposal-thread append. That door is a
mutation trust boundary.

## Rounds

| Round | Digest (SHA-256) | Base commit | Verdict | Streak |
|---|---|---|---|---|
| 1 | `2a799363986aed9b8890d03e59643dc6e78ab3e6a2ded8454a2ee24ad7888ae6` | 10b1e411 | APPROVED | 1 |
| 2 | `2a799363986aed9b8890d03e59643dc6e78ab3e6a2ded8454a2ee24ad7888ae6` | 10b1e411 | APPROVED | 2 |

- Each round used a fresh reviewer, run one at a time.
- Both reviewers saw only the brief, the immutable snapshot, the evidence pointers and the owner's
  verbatim requirement.
- The canonical file and the snapshot were byte-identical before and after both rounds.
- The streak never reset.

## Blockers

None in either round.

## Non-blocking items

All are adopted in the implementation **after** the final approval, so the approval does not
cover them. The diff review covers them instead.

**Duplicates and lost answers**
- «Recargar» while a message is posting would reset the in-flight flag, and a second «Enviar»
  would then store a permanent duplicate. Adopted: «Recargar» is disabled while posting. This has
  an XCTest.

**Clearer error wording**
- 404 and 409 from the writer were folded into the «revisa tu conexión» wording. Adopted: they get
  a separate outcome and wording, because a retry cannot fix them.
- `messages_full` was folded into «no es válido». Adopted: it gets its own wording.

**Revision adoption**
- `finishMessage` now also requires the observed id to equal the id the post was sent to.
  Adopted, with an XCTest.
- The XCTest list gains a case: «a post with no read-back revision leaves `observed` as it was».
  Adopted.

**Missing registry**
- `routeMatcher.test.ts` lists every `/api/app/v1/*` route. Adopted: the new route gets its entry.

**Author name**
- The read goes through `serverClient`, the client `authorize/page.tsx` uses for the same
  projection. Adopted, with a door test that the name reaches the writer.
- The app reads the author name live, while the web uses the sign-in snapshot. This is cosmetic,
  and recorded in the ADR-0091 addendum.

**Composer**
- The length check counts the raw text, as the server does before trimming. Adopted.
- The placeholder says where the message goes: «Solo la ven los líderes y los admins». Adopted.
- On a «borrador» a message notifies nobody (web parity). The owner is told explicitly.

**Door tests**
- A 2xx answer must carry no `message`, no `ok` and no `author`. Adopted.
- The 404 for a malformed id must come before the fresh access read. Adopted.

**Not adopted**
- An optimistic local bubble when the read-back fails. The web keeps the thread as shown and does
  the same; parity was the requirement.

## Author-side process notes

None. Neither round's verdict needed rebutting, and no claim was taken without checking it. Both
reviewers' VERIFIED lists agreed with the author's own reading of `route.ts`.

## Post-approval changes (not reviewed)

The non-blocking adoptions listed above. They change the implementation only, not the plan file.
