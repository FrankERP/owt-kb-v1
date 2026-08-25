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
the only path. Child B removes the textarea along with the mirror.

**The submit email is byte-identical on a FIRST submission only, and that is a
Child-A-owned behaviour change that must be named rather than glossed.**
`notifyProposalSubmitted` is not first-submission-only: it fires on **every** save
committed as `pending` (`app/api/me/proposals/route.ts:298-304`, with no
`previousStatus` check), and a lead may re-save while `pending` or re-submit from
`changes_requested` — the route refuses only `approved` (`:160-167`), and one
production proposal is in `changes_requested` right now. On those later
submissions the email carries the **mirror** — the newest thread message, possibly
older than this submission — instead of what the lead attached to this one.

Accepted, and named under invariant 8. The email still fires, to the same
audience, with a populated notes block; what shifts is its *meaning*, from "the
note attached to this submission" to "the lead's most recent word to the admins".
A lead who posts before submitting gets the same result as today. The alternative
— keeping the textarea alongside the thread composer on every save — would put two
private-note inputs on one screen, which is worse.

**Scope of the property, stated precisely:** Child A modifies no file under
`app/utils/outbox*` or `proposalNotify.ts`, and **regresses no notification** —
every signal that fires today still fires, to the same audience. It does not claim
that every body is byte-identical: the submit email's body drifts as described
above from the second submission onward.

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

   *Known exception, pre-existing:* the transition writes
   `admin_notes: request.adminNotes` unconditionally (`admin/proposals/[id]/route.ts:500`),
   so an empty `reopen` blanks it **today**. Child A preserves that behaviour
   verbatim rather than fixing it; it becomes harmless once the content also lives
   in `messages[]`. Do not read invariant 7 as a claim that the field is
   append-only today.
8. **Neither child may regress an existing notification.** A *new* gap in a *new*
   feature is acceptable and must be named; silently retiring something that
   fires today is not.

## Non-goals for both

- Any unread indicator, derived or stored (decision 3).
- Pastor notes. The `kind`/`author_role` enums reserve `pastor_note` and
  `system`; neither child mints them.
- Unsetting the legacy fields.
- Editing or deleting a posted message. Every message is permanent.

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

The split is correct only if all of these hold after Child B:

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
- `lead_notes` and `admin_notes` are byte-identical to their pre-Child-A values
  on every document that is not touched by the mirror, and the mirror's writes
  are the only changes to them. **This check runs at the end of Child A, not
  after Child B** — the blanking hazard is created by Child A's client change, so
  its guard cannot be scheduled a release later.

## Requirement-to-plan coverage

| Requirement | Primary | Dependent |
|---|---|---|
| `messages[]` schema and pure model | **shipped** (Phases 0–1) | — |
| Migrate `lead_notes`/`admin_notes` into the thread | **A** | — |
| Lead and admin message write routes | **A** | — |
| Transition appends its change-request as a message | **A** | — |
| Thread UI on both surfaces, service-date composer gate | **A** | — |
| Reads/projections carry `messages` | **A** | B (adds none) |
| Revision handling (`_rev` attestation, per-surface) | **A** | — |
| Debounced lead-notes email keeps firing, unchanged | **A** (via the mirror) | **B** (re-sources it) |
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
