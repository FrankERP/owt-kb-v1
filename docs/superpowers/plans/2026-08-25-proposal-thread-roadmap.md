# Delivery roadmap: proposal message thread

Parent scope artifact. Two child implementation plans, reviewed and delivered in
order. **This document authorizes nothing.**

## Original request

> "También pensé que sería bueno poder ver el historial o 'conversación' de las
> notas de cada propuesta. Quizá podríamos cambiar nuestro modelo de notas a un
> pequeño 'chat' dentro de la propuesta en el que quede guardado un historial de
> mensajes."

Settled with Frank, each asked and answered explicitly:

1. **Replace, not add.** The private lead↔admin channel becomes the thread;
   `team_notes` — the note for the whole team — stays a separate field.
2. **Participants:** the proposal's lead plus `admin`/`super-admin`.
   **No new emails.**
3. **Read state:** real read marks, not a derived indicator. Deferred to its own
   later delivery, so neither child ships an unread indicator.
4. **Admin→lead signal:** a push. A push is not an email, so (2) stands.
5. **The composer closes when the SERVICE has passed**, not when the proposal is
   approved.

## Why this is split

The single-plan version of this work took five adversarial review rounds and
never reached an approval. **Six of its nine blockers were on the
outbox/notification surface**, and two more were caused by fixes to that surface
rippling into the write path. The storage-and-UI half was never the difficulty.

The split is not "the document is long". It is that these are two outcomes with
different acceptance contracts, different failure modes, different rollback
boundaries, and — decisively — **different data-migration and delivery trust
boundaries**:

- **Child A** crosses a data-migration boundary: a one-shot `--apply` against the
  single production dataset, plus two new writers.
- **Child B** crosses a delivery boundary: it changes when and to whom an
  existing production email fires, and adds pushes.

They can be sequenced without duplicating authority, because of one property
established from the code and confirmed below.

## The property that makes the split safe

**`queueLeadNotesNotice` and `QueueLeadNotesNoticeInput` are exported with their
current signature** (`app/utils/serviceMutationSideEffects.ts:614`, `:629`).

So Child A's new lead-messages route can call the *existing, unmodified*
notification function with its *existing* string-based contract — provided Child A
also keeps `lead_notes` written as a mirror of the newest lead message. The
result for the **debounced `leadNotes` outbox path**: Child A changes nothing and
touches no module under `app/utils/outbox*`.

**`lead_notes` has a SECOND consumer, and the mirror alone does not cover it.**
`notifyProposalSubmitted` re-reads `lead_notes` off the committed proposal and puts
it in the "Nueva propuesta" admin email (`app/utils/proposalNotify.ts:145`, `:153`).
Today that value is what the lead typed into the "Notas privadas para revisión"
textarea **with that submission** (`ProposalEditor.tsx:714-720` → `:350` →
`route.ts:232`/`:264`).

If Child A simply deleted that textarea, a first submission would commit
`lead_notes = ""` and mail admins a submission with no notes — and the lead would
have **no way at all** to say something with their first submission, because the
thread composer needs a proposal document that does not exist yet. That is a
regression in both the notification and the interaction, and it would have
violated invariant 8.

**Therefore Child A keeps the textarea for the pre-first-save case only** (see its
§"The submission note"). Its content is written to `lead_notes` *and* appended as
the first `lead_note` message. Once the proposal exists, the thread composer is
the only path.

**The pre-first-save textarea outlives BOTH children.** An earlier draft said Child
B removes it with the mirror; that is wrong on three counts. Child B disclaims it
("No UI beyond notification-adjacent copy") and keeps consuming the note. The
coverage table below needs it to survive, since B's new body source is "the newest
`lead_note` message" and on a first submission the textarea is what mints that
message. And removing it would reintroduce the exact regression this section
forbids — **the reason it exists is permanent, not Child-A-specific**: no thread
composer can exist before the proposal document does, so without the textarea a
first submission has no private-note input at all and mails admins an empty notes
block.

What Child B actually removes is the `lead_notes` **write**. The textarea then
feeds `messages[]` only. Retiring it would need its own coverage row, an owner, and
a named replacement path for the first-submission note; none exists, so it is not
scheduled.

**The submit email is byte-identical on a FIRST submission only, and that is a
Child-A-owned behaviour change that must be named rather than glossed.**
`notifyProposalSubmitted` is not first-submission-only: it fires on **every** save
committed as `pending` (`app/api/me/proposals/route.ts:298-304` calls
`notifyProposalPending`, which wraps it at `serviceMutationSideEffects.ts:712`, with
no `previousStatus` check), and a lead may re-save while `pending` or re-submit from
`changes_requested` — the route refuses only `approved` (`:160-167`). **Note the
live dataset has ZERO proposals in `pending` or `changes_requested`** (13 `approved`,
1 `draft`), so the drift is reachable but not currently exercised — and, as Child A
§1 records, the Phase D walkthrough cannot exercise the mirror→email path at all. On those later
submissions the email carries the **mirror** — the newest thread message, possibly
older than this submission — instead of what the lead attached to this one.

Accepted, and named under invariant 8. The email still fires, to the same
audience, with a populated notes block; what shifts is its *meaning*, from "the
note attached to this submission" to "the lead's most recent word to the admins".
A lead who posts before submitting gets the same result as today. The alternative
— keeping the textarea alongside the thread composer on every save — would put two
private-note inputs on one screen, which is worse.

**Scope of the property, stated precisely — and narrower than an earlier draft
claimed:**

- Child A **modifies no file** under `app/utils/outbox*` or `proposalNotify.ts`, and
  the stored notice shape is unchanged.
- It **regresses exactly one notification**, named in Child A criterion 5 and in the
  coverage table below: a pre-deploy client that *clears* the textarea queues a
  notice today and will not after. Every other signal still fires, to the same
  audience. The earlier unqualified "regresses no notification" contradicted this
  document's own coverage table.
- It does **not** claim every body is byte-identical: the submit email drifts from
  the second submission onward, as described above.
- **The queuing OCCASIONS change, and that is Child A's risk, not Child B's.** The
  debounced email moves from "the notes field changed on a save" to "a lead posted a
  chat message", which multiplies entry points into `commitUpserts`' unconditional
  inline `sweepOutbox` (`serviceMutationSideEffects.ts:491`) — measured at ~14.4 s
  per send against `NOTIFY_FLUSH_EMAIL_LIMIT=2`. Child B names the volume shift, but
  it lands with Child A. Watch `report.lost` after Child A's release, not Child B's.
  **Conservative rather than currently firing:** `queueLeadNotesNotice` returns
  before `commitUpserts` unless the pre-write status is `pending`/`changes_requested`
  (`:632`), and the dataset has zero such proposals today — so the mechanism is
  reachable but dormant until a proposal is submitted.

Child B then moves the call, changes the input shape, rewrites classification,
adds the pushes, and stops the mirror — with the thread already populated,
rendered, and proven in production.

**The end state is unchanged from the settled decision:** `messages[]` replaces
`lead_notes`/`admin_notes` as the private channel. The mirror is a sequencing
device that exists only between the two releases, not a return to "add
alongside".

## Invariants both children preserve

1. `APPROVAL_RECEIPT_VERSION` and `APPROVAL_APP_MARKER` are frozen. Not one byte.
2. `canonicalizeApprovalInput`'s field set is unchanged; `messages[]` is never
   added to `ApprovalInput`.
3. `transitionFingerprint`'s digest input is unchanged, including the key name
   `adminNotes`.
4. `team_notes` is untouched — still a single field, still copied onto the live
   setlist on approval, still rendered to the whole team.
5. Every Sanity array-of-object write carries a `_key`, and every patch that
   appends is preceded by `setIfMissing`.
6. `before` for any outbox notice is captured PRE-COMMIT and threaded into
   `after()`.
7. **Neither child may blank `lead_notes` or `admin_notes`** — not by `unset` and
   not by writing `""` over a value. This is stated as blanking rather than
   unsetting because the live hazard is the latter: `parseProposalSaveRequest`
   coerces an absent `leadNotes` to `""` (`proposalWriteRequest.ts:117`) and both
   save branches write it unconditionally (`app/api/me/proposals/route.ts:232`,
   `:264`), so the moment a client stops sending the field, the next save erases
   the archive. Removing the fields entirely is a third, separately consented
   delivery.

   *Known exception, and Child A WIDENS it — read this before holding either child
   to the rule.* The transition writes `admin_notes: request.adminNotes`
   unconditionally (`admin/proposals/[id]/route.ts:500`), and an absent
   `adminNotes` coerces to `""` (`proposalWriteRequest.ts:165`). **Today that
   rarely bites**, because the composer is seeded from the stored value
   (`ProposalsPanel.tsx:106`) and `handleReopen` sends `adminNotes.trim() || undefined`
   (`:143`), so a note-less reopen re-sends the existing text and preserves it.

   **Child A §6 seeds that composer EMPTY** — necessarily, or an admin re-sends a
   stale legacy note as a fresh bubble — so a note-less reopen now sends `undefined`
   and blanks the field. That is a **new trigger**, not the pre-existing one, and it
   is reachable on real data: 4 published proposals carry non-empty `admin_notes`
   and 13 are `approved`, which is where "Reabrir" is offered.

   **Accepted, and Child A criterion 4 owns it.** The content lives in `messages[]`
   and `admin_notes` has no notification consumer. But the shared rollback story is
   correspondingly weaker for such a document: reverting the code leaves its
   change-request text only in the now-inert `messages[]`. Do not read invariant 7
   as a claim that either field is append-only today.
8. **Neither child may regress an existing notification.** A *new* gap in a *new*
   feature is acceptable and must be named; silently retiring something that
   fires today is not.

## Non-goals for both

- Any unread indicator, derived or stored (decision 3).
- Pastor notes. The `kind`/`author_role` enums reserve `pastor_note` and
  `system`; neither child mints them.
- Unsetting the legacy fields.
- Editing or deleting a posted message. Every message is permanent.
- **Any new email.** Settled decision 2, restated here so both children inherit it
  from the parent rather than only from Child B's own scope section. The admin→lead
  and lead→admin signals Child B adds are **pushes**, which is why they do not
  breach it.

## Status

| | |
|---|---|
| Phases 0–1 (schema + pure modules) | **Shipped to production**; the `setlistProposal` schema is deployed to the Content Lake |
| Child A, Phase A (migration script, dry-run) | **Implemented and on `preview`** — `f1ebdf13`. Two code reviews. Dry-run: 8 documents / 10 messages / 0 aborts. **`--apply` has NEVER run; no production document has been written** |
| Child A, Phases B–E | **APPROVED** — two sequential fresh verdicts on digest `5713a9cc…`; see its [review log](2026-08-25-proposal-thread-a-storage-and-ui-review-log.md). Not authorized to implement |
| Child B | Not yet reviewed |
| `FrankERP/owt-kb-v1#8` | Ministry-scoping the notification audience — open, owned by neither child |

## Sequencing

```
Child A — the thread          (migration, write routes, reads, UI)
   ↓  outputs: populated messages[], mirrors maintained, thread live
Child B — notifications       (outbox source, pushes, stop mirroring)
   ↓
later  — read marks (R3), then the legacy-field cleanup
```

**Child B must not start before Child A is released and reconciled.** Its whole
premise is that the thread is already the record; running it against a
half-populated thread reintroduces exactly the coupling this split removes.

## Shared contracts

Both children depend on the behaviour of existing helpers. That table was
extracted by an independent read-only pass on 2026-08-25 and verified row by row
by two later reviewers. It lives in
[`2026-08-24-proposal-message-thread.md`](2026-08-24-proposal-message-thread.md)
under "Contracts of what this plan reuses" and is **normative for both children**
— they cite it rather than restating it, so a correction lands in one place.

The three that most often get assumed wrong:

- `notifyProposalReview`'s audience is the lead plus contributors. **Admins are
  not in it.**
- `sendPush` gates on `notifPrefs.proposals` via `optedIn`; `wantsNotification`
  gates on `emailProposals`. Independent axes.
- `commitUpserts` also runs `sweepOutbox` unconditionally, so queuing a notice
  can send another member's email inline.

## Integration acceptance

The split is correct only if all of these hold. **Most are checked after Child B;
the two `lead_notes`/`admin_notes` bullets are checked at the end of Child A**, for
the reason their own text gives — Child A creates those hazards, so their guards
cannot be scheduled a release later.

- A lead's message on a `pending`/`changes_requested` proposal produces exactly
  the email admins get today — same audience, same debounce, same preference key
  — with the body sourced from the thread rather than `lead_notes`.
- A lead's message on an `approved` future-dated proposal reaches admins by push.
- An admin's message reaches the lead by push, and a `request_changes` produces
  exactly one push, not two.
- No message posted between Child A's release and Child B's release is **lost**,
  and none is **notified twice**. One narrow exception, by Child B's deliberate
  design: an in-flight legacy `{beforeNotes}` outbox notice queued minutes before
  B's deploy is dropped and consumed, so that one message is stored and rendered
  but never emailed. Either accept that seam or have B drain the outbox before
  cutover.
- **`lead_notes` is byte-identical to its pre-Child-A value on every document the
  mirror did not write, and every mirror write carries a real non-empty message
  body.** Stated as "non-empty body" rather than "the mirror's writes are the only
  changes", because Child A defines the transition **as** the `admin_notes` mirror —
  so the looser wording would make the blanking write pass by construction, which is
  exactly the check failing to check.
- **`admin_notes` likewise, except for the note-less-`reopen` trigger invariant 7
  names.** At the end-of-Child-A check that count is necessarily zero, since no
  reopen has happened yet — so the check there is that it IS zero. The ongoing
  guard is the Verification row in Child A asserting the standalone admin route
  never writes `admin_notes`; blanking may only ever come from a transition.
- **Both checks run at the end of Child A, not after Child B** — the hazard is
  created by Child A's client change, so its guard cannot be scheduled a release
  later.

## Requirement-to-plan coverage

| Requirement | Primary | Dependent |
|---|---|---|
| `messages[]` schema and pure model | **shipped** (Phases 0–1) | — |
| Deploy the `setlistProposal` schema (the `proposal_message` type) to the Content Lake | **done** with Phases 0–1 — recorded here because `docs/DATA_MODEL.md:611-614` makes it a required step and Child B owns the equivalent for `notificationOutbox`, so its absence would read as an omission | — |
| Migrate `lead_notes`/`admin_notes` into the thread | **A** | — |
| Lead and admin message write routes | **A** | — |
| Transition appends its change-request as a message | **A** | — |
| Thread UI on both surfaces, service-date composer gate | **A** | — |
| Reads/projections carry `messages` | **A** | B (adds none) |
| Revision handling (`_rev` attestation, per-surface) | **A** | — |
| Debounced lead-notes email keeps firing, **with one named exception** | **A** (via the mirror; the exception is a pre-deploy client CLEARING the note, which stops queuing — an existing signal retired, recorded against invariant 8 in Child A criterion 5) | **B** (re-sources it) |
| "Nueva propuesta" submit email keeps carrying the lead's note | **A** (via the retained submission textarea) | **B** (re-sources it) |
| `lead_notes` is never blanked to `""` by a client that stopped sending it | **A** | **B** (removes the field write entirely) |
| A pre-deploy bundle's `leadNotes` is not discarded | **A** — it opens the window, so it owns the guard | **B** (keeps the same rule for pre-A bundles) |
| Outbox source moves from `lead_notes` to the thread | **B** | — |
| lead→admin push on non-reviewable statuses | **B** | — |
| admin→lead push for standalone messages | **B** | — |
| Stop mirroring `lead_notes`/`admin_notes` | **B** | — |
| `proposalNotify` body source | **B** | — |
| Export `REVIEWABLE_BEFORE_WRITE`, `ADMIN_RECIPIENTS_QUERY` | **B** | — |
| Read marks / unread indicator | *neither* — later delivery | — |
| Unset the legacy fields | *neither* — later delivery | — |

Every requirement has exactly one primary owner. The only intentionally
cross-cutting row is the existing email: **A** must keep it firing byte-for-byte,
**B** changes where its body comes from. That is stated in both children's
acceptance criteria on purpose, because it is the seam where a regression would
hide.

## Risk tiers

| | Tier | Triggers |
|---|---|---|
| Child A | **CRITICAL** | Schema/data migration against the single production dataset; two new production writers; a concurrency-protocol change on an existing guarded writer |
| Child B | **CRITICAL** | Changes an existing production delivery path's source, audience and consumption semantics |

Both need two sequential fresh `APPROVED` verdicts on byte-identical text.
**Review the parent first, then Child A, then Child B.**

## Open questions

| # | Question | Recommendation | Blocking? |
|---|---|---|---|
| OQ-1 | ~~Should the admin notification audience be ministry-filtered?~~ | **RESOLVED 2026-08-25: an independent delivery**, tracked separately. Neither child owns it; both inherit the audience rule in force at the time. Tracked as FrankERP/owt-kb-v1#8 | Closed |
| OQ-2 | Is Child B worth doing at all, or is the thread plus today's email good enough? | Do it — but not for the reason an earlier draft of this table gave. After Child A the mirror *is* what keeps `lead_notes` current, so there is no staleness to fix. The real reasons are the three silences Child A leaves: an admin's standalone message notifies nobody, a lead's message on an `approved` proposal notifies nobody, and a repeated identical message sends no email because the outbox compares trimmed strings | No — decide before B |

## Terminal state

`READY_FOR_ADVERSARIAL_REVIEW`

Review readiness is not approval, and plan approval is not authorization to
implement.
