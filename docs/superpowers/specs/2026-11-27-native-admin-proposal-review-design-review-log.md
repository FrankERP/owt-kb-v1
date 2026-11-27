# Review log: 2026-11-27-native-admin-proposal-review-design.md

Process: `.agents/skills/adversarial-plan-review/SKILL.md`. Approval is not authorization to
implement. The owner asked for the work itself («Dale, no te detengas», 2026-11-27 21:04Z, on
starting weekly admin), which is the implementation's authorization. The production release is
still his decision on a card.

## Tier

**Critical**, derived from the ladder, not raised or lowered. The plan adds the native app's doors
onto two production writers: `reviewProposal`, which publishes a service's setlist and notifies
people, and the admin's proposal-thread append. Each door is a mutation trust boundary.

## Rounds

| Round | Digest (SHA-256) | Commit | Verdict | Streak |
|---|---|---|---|---|
| 1 | `9402f5fc8b5ca8ac0cc4126d73b033df1d4e3ebd4a30d443dbcd6b799338e11f` | c2c1bc03 | CHANGES_REQUIRED | 0 |
| 2 | `d6e49a9d16ed5fcf2bb556c1368a5a175aa2f468f32a0d69fba99f8f04472bd4` | 6dc0b6dc | CHANGES_REQUIRED | 0 |
| 3 | `ec81c7468367695ec0aa2bfe69d76ba1e11c4ce8c8ef813664779aaebf5ef99e` | 38abb174 | CHANGES_REQUIRED | 0 |
| 4 | `56a1ec70abe1362c41d0b590a79ca1a81f2e373cc9172aeb37bc887e146ec48a` | 9c469a4e | APPROVED | 1 |
| 5 | `56a1ec70abe1362c41d0b590a79ca1a81f2e373cc9172aeb37bc887e146ec48a` | 9c469a4e | APPROVED | 2 |

- Every round used a fresh reviewer, run one at a time, on Fable 5.2.
- Each reviewer saw only the brief, the immutable snapshot, the evidence pointers and the owner's
  requirement. None saw an earlier round, a rebuttal or the round count.
- Canonical file and snapshot were byte-identical before and after every round.

## Churn cap

Rounds 1 and 2 each had a verified substantive blocker, which reached the cap. The owner chose
«Sí, sigue revisando» on a card (2026-11-27 22:12Z), whose consequence read «Corro hasta dos
revisiones más (una nueva y la que confirma)». Round 3 found a third verified blocker; round 4
approved the corrected plan. Since round 5 was beyond the two the card covered, the owner was asked
again and chose «Sí, corre la confirmación» (22:24Z).

**The defect class all three blockers share:** the rules of the open detail's state machine
(which revision a decision carries, and when a list read may change what is on screen) were left
partly implicit. Round 1: a message's read-back revision was adopted. Round 2: an unrequested
reload swapped content and revision silently. Round 3: the change check after the admin's own
decision was unspecified, so the status it compares would have raised the notice after every
decision. The remedy each time was one stated rule, not a patch, and round 3's fix bounded the
last implicit rule.

## Blockers

1. **R1, the read-back revision.** `finishMessage` adopted the answer's `rev`. That revision is
   read after an append that asserts none, so a lead's save could fold into it while the screen
   showed the old songs, and the next «Aprobar» would publish content never shown. Verified in
   the admin messages route (append without `ifRevisionId`, read-back after commit) and
   `proposalSaveCommit.ts`. Fixed: `heldRev` comes only from a list read.
2. **R2, the unrequested reload.** The foreground, launch and pull reloads replaced content and
   `heldRev` together with no notice, absorbing the writer's 409. Verified; the foreground reload
   was the author's own addition. Fixed: every list read that lands on an open detail compares the
   content fingerprint and holds every decision until «Ya la revisé»; the approval confirmation
   lists the songs it publishes.
3. **R3, the admin's own decision.** The fingerprint includes the status, and the plan did not say
   what the reload after a landed decision compares, so every decision would raise «La propuesta
   cambió» and teach the admin to dismiss it. Verified, including that the implementation had
   invented an unreviewed rule for it. Fixed: a landed decision arms the status its answer
   reported; the next landed read compares the status with that one (so another admin's decision
   in between still raises the notice); songs, notes, pastor's message and service are always
   compared; one landed read disarms it.

## Non-blocking items

Adopted before an approval (covered by the later rounds): the 409 split into `conflict` and
`blocked`; the admin's own `failed` message wording; past-dated rows leaving the list stated;
reopen covered by tests only; sheets record the revision they opened on; the GET door names no
writer module; one `appRefusal`; the lock and blocked semantics; the 401 row; `orderedMessages`;
«Canción sin título»; «Ya estaba aplicado.»; no «Todas» tab; the lead-and-contributors audience;
the service on screen in the fingerprint; the decision-body contract fixture
(`native/contract/proposal-decision-bodies.json`); the narrower list window stated in plain terms;
the `playKey` premise corrected.

After the final approval (rounds 4 and 5), **not reviewed by a plan round**; the diff review
covers them:

- The fingerprint names `songId`: already true in code (`AdminProposal.Song` is compared whole).
  The plan text says «the songs in order with their keys and medleys».
- Out-of-order list reads: `AppModel` numbers each read and lands only the newest, and a read
  landing while a decision is in flight is refused by `apply`, so an older read cannot spend the
  armed status or put an older row back.
- The 30-second revoked-grant window is accepted again for these doors (ADR-0091 addendum).
- The PATCH door test asserts the raw body reaches `reviewProposal` unchanged, `rev` included.
- Release order: the server reaches production before the TestFlight build that calls it (the
  project's release order), and a green `ios.yml` run on the final commit is required. Rollback is
  a revert: the doors are additive and D1/D2 are moves with no data change.
- Accepted, told to the owner: a lead's new thread message is absorbed by a reload with no notice
  (the thread is not part of the fingerprint; publish safety is intact); after approving a
  past-dated row the «Setlist publicado» note is followed by «Esta propuesta ya no está en la
  lista.»; an approved or draft row with an unusable date is hidden on the phone.
- Not adopted: refusing an empty note for «Pedir cambios» at the door (the web's parity, and the
  fixture guards the spelling); `bootstrap_outcome_unknown` wording; a sentence in the approval
  confirmation about the team message being replaced (the web does not say it either; a candidate
  for the follow-up).

## Implementation deviations from the approved plan

- A decision sheet stays open on `failed` and `invalid` with the reason, and closes on every other
  outcome; the typed note is kept per action (`keptNotes`) when the sheet closes without sending.
- `apply` is refused while a decision or a message is in flight, and the detail applies again when
  the flight ends (the plan's `canReload`, applied to every list read rather than only «Recargar»).

## Author-side process notes

- The round-2 blocker was introduced by the author: the plan's foreground reload was added in
  response to a round-1 non-blocking note without asking what it did to the revision rule.
- The round-3 blocker was also visible in the author's own implementation, which carried a rule
  (`ownStatusChange`) the plan did not contain. A rule invented while implementing a critical
  state machine should have gone back into the plan before the next round, not into the code.
