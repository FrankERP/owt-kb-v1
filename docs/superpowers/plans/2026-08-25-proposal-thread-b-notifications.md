# Child B — The thread: notifications

Parent: [`2026-08-25-proposal-thread-roadmap.md`](2026-08-25-proposal-thread-roadmap.md).
Prerequisite: **Child A released and reconciled**
([`…-a-storage-and-ui.md`](2026-08-25-proposal-thread-a-storage-and-ui.md)).
Contracts of reused helpers:
[`2026-08-24-proposal-message-thread.md`](2026-08-24-proposal-message-thread.md)
§"Contracts of what this plan reuses" — **normative, cited not restated**.

**Risk tier: CRITICAL.** Changes an existing production delivery path's source,
audience and consumption semantics. Two sequential fresh `APPROVED` verdicts
required. **This document authorizes nothing.**

## Outcome

Notifications are sourced from the thread rather than from the legacy note
fields, and both directions of the conversation reach their counterpart. The
mirror Child A installed is removed.

## Current behaviour after Child A, and the gap

Child A leaves three things true:

1. `lead_notes` / `admin_notes` are **mirrors** — written on every message so the
   existing email keeps firing unchanged. They are a shim.
2. `queueLeadNotesNotice` is called with its original string signature from
   `POST /api/me/proposals` and from the lead messages route.
3. **An admin's standalone message notifies nobody**, and a lead's message on an
   `approved` proposal notifies nobody. Neither is a regression — no such feature
   existed — but both leave half a conversation silent.

The gap: while the mirror survives, the email's body comes from a field whose only
purpose is to feed it, and the thread's own content is not the source of truth for
delivery. And the two silences above are the half of "conversación" that does not
yet work.

## Scope

### In

- `queueLeadNotesNotice`'s input shape and both its call sites.
- `classifyProposalMessages` replacing `classifyLeadNotes`; `PROPOSAL_QUERY`
  projecting `messages[]`; the legacy-shape drop.
- `notificationOutbox.before` gaining `beforeMessageCount`.
- `proposalNotify`'s "Nueva propuesta" body source.
- The lead→admin push on non-reviewable statuses, and the admin→lead push for
  standalone messages. **Both inherit whatever admin audience exists at the time**
  — this child does not own the ministry-scoping question (see OQ-1).
- Exporting `REVIEWABLE_BEFORE_WRITE` and `ADMIN_RECIPIENTS_QUERY`.
- **Removing the mirror** — `lead_notes` / `admin_notes` stop being written.

### Out

Everything Child A owns. No schema migration. No new writer. No UI beyond
notification-adjacent copy.

### Explicitly not in this delivery

Unread indicators; unsetting the legacy fields; a new `notificationOutbox` kind;
any new email.

## Design

### Removing the mirror

**`POST /api/me/proposals` stops writing `lead_notes` in BOTH branches** — the
patch (`app/api/me/proposals/route.ts:232`) and the create (`:264`).
Unconditionally. The create branch mints `messages: [msg]` instead when a note is
present. The transition stops setting `admin_notes`. The message routes stop
mirroring.

**This is data-loss prevention, not tidiness.** Both branches set
`lead_notes: request.leadNotes`, and `parseProposalSaveRequest` coerces an absent
value to `""` (`proposalWriteRequest.ts:117`). Child A's editor already stopped
*sending* `leadNotes`. So if that line survives past the mirror's removal, **the
first save writes `lead_notes: ""` over every document that carries one**, erasing
the archive. Removing the write and removing the mirror are the same edit and must
land together.

**`parseProposalSaveRequest` keeps ACCEPTING `leadNotes`** — an old bundle from
before Child A may still post it; the route appends it as a `lead_note` message
when it differs from the newest one. Removing the field from the parser is a
later, separate delivery.

### Outbox

**Call sites, authoritatively:** `queueLeadNotesNotice` is called from the lead
messages route **and** from the legacy `leadNotes` compat path in
`POST /api/me/proposals`, each snapshotting `previousStatus` and the lead-message
count PRE-COMMIT in its own handler, and from nowhere else.

**Input shape.** `QueueLeadNotesNoticeInput` loses `beforeNotes`/`afterNotes` and
gains `beforeMessageCount: number` — the pre-commit count of `messages` where
**`kind === "lead_note"`**, the same predicate the classifier slices on. One
predicate, named once. `notificationOutbox.before` gains the field;
**`beforeNotes` stays in the schema** so in-flight legacy documents remain
readable.

**Classification** replaces `classifyLeadNotes`:

```
classifyProposalMessages({ beforeCount, afterMessages, serviceDate, today, reviewable })
  isPast(serviceDate, today)  -> null   (unchanged)
  !reviewable                 -> null   (unchanged)
  appended = afterMessages.filter(kind === "lead_note").slice(beforeCount)
  appended.length === 0       -> null
  -> { kind: "leadNotes", …, notes: appended.map(m => m.body).join("\n\n") }
```

A count-and-slice is sound because the array is append-only *and* Child A's
migration already ran, so no prepend can shift indices under a queued notice.

`LineKind`, `LINE_PREF.leadNotes`, `NOTICE_KINDS` and the stored `kind` value
`"leadNotes"` are **all unchanged** — renaming the wire value would orphan
in-flight documents for no benefit. Only the meaning changes.

**A cutover-window case the parent's integration acceptance does not reach:**
during this child's deploy, a new route queuing `{beforeMessageCount}` against a
still-warm OLD `classifyLeadNotesNotice` yields `before = ""` (`outboxSweep.ts:389`)
compared against a now-unmirrored stale `lead_notes` — which classifies as changed
and emails stale content. It is neither "lost" nor "notified twice", so the parent's
bullet does not cover it. Bounded by the deploy window and by production carrying
zero outbox documents at rest; name it in this child's verification rather than
assuming the parent caught it.

**In-flight legacy notices:**
`typeof notice.before?.beforeMessageCount !== "number"` ⇒ **drop** (return `[]`).
`typeof`, not truthiness — `beforeMessageCount: 0` is the legitimate first-message
case. Dropping is safe and verified: `classifiedIds.add` precedes classification
(`outboxSweep.ts:734`), `partitionClaimed` routes a classified notice with no
pending recipients to `toConsume` (`:506-535`), and the `finally` deletes it
(`:886-890`). It does not crash, wedge or re-pend.

**`proposalNotify.ts:138-153`** takes the body of the newest `kind == "lead_note"`
message, empty when there is none. Take the last matching element **in JS**, not
with a GROQ negative index. Semantic drift to accept: today `lead_notes` on submit
is what the lead saved *with that submission*; the newest message may be days
older. Still their most recent word — but the framing must not imply "notes
attached to this submission".

**Redeploy the Sanity schema** — `notificationOutbox` gains a field. The Content
Lake stores undeclared fields so nothing breaks without it, but the manifest would
be stale.

### Notifications, both directions

| Direction | Trigger | Channel |
|---|---|---|
| lead → admin, `pending`/`changes_requested` | a `lead_note` message | the existing debounced `leadNotes` outbox email |
| lead → admin, `approved` | a `lead_note` message | **push to ADMINS** — `sendPush(adminIds, "proposals", …)`, `adminIds` from the exported `ADMIN_RECIPIENTS_QUERY` |
| lead → admin, `draft` | — | **nothing** — a draft is not in front of admins yet |
| admin → lead, **standalone message only** | an `admin_change_request` via the admin messages route | push via `notifyProposalReview(doc, push)` with NEW copy |
| admin → lead, **via a transition** | `request_changes` / `reopen` | **unchanged** — the transition already calls `notifyProposalReview(doc, REVIEW_PUSH[action])` (`admin/proposals/[id]/route.ts:532`). Do not add a second call, and do not replace `Cambios solicitados` with `Nuevo mensaje` |
| lead → admin, first submission | unchanged | `notifyProposalPending` |

**The `approved` row exists because the composer stays open there** (decision 5)
while both outbox gates are `{pending, changes_requested}`. Most proposals are
approved, so without it a lead could post where the admin never learns.

**Do not reach for `notifyProposalReview` when the recipients are ADMINS.** Its
audience is lead + contributors. There is **no reusable admin-push helper** — this
needs a small new one or an inline `sendPush`. Pick one and say which. (It *is* the
right helper for the rows whose recipient is the lead — read the recipient column,
not the arrow.)

**Exclude the author** from the recipient set: a lead who is also an `admin` would
otherwise be pushed about their own message. `notifyProposalReview` takes no
exclusion parameter and `proposalReviewRecipients` does not filter, so **filter in
the route** rather than changing that helper, which would alter its two existing
transition call sites for no reason.

`REVIEWABLE_BEFORE_WRITE` and `REVIEWABLE_STATUSES` are **unchanged** — the email
keeps today's audience and timing. The push is a separate additive call, fired only
when the status is one the outbox will not cover. **One signal per message, never
both.**

**Push copy must be new.** Reusing `REVIEW_PUSH.request_changes` would push
"Cambios solicitados — Revisaron la propuesta y pidieron cambios" when an admin
merely asked a question. Say a message arrived: `Nuevo mensaje` /
`<Autor> escribió en la propuesta del <fecha>`.

**These pushes are not debounced.** N messages, N pushes. Acceptable at this team's
volume; if it becomes noise the fix is a push debounce, not a wider email.

**Preference axis:** `sendPush` gates on `notifPrefs.proposals` via `optedIn`,
**not** on `wantsNotification`, which reads `emailProposals`. Independent. Do not
"unify" them here.

**Accepted gap:** a lead posts while `pending` → a notice is queued and no push
fires. If an admin approves inside the 15–60 min debounce, the flush finds
`REVIEWABLE_STATUSES.has("approved") === false` (`outboxSweep.ts:393`), classifies
to `null`, and consumes it. No email, no push. Rare, non-destructive, and closing
it would mean firing a push the email was meant to cover or widening the flush
gate. Named rather than fixed.

**Knowing what queuing costs:** `commitUpserts` also runs `sweepOutbox`
unconditionally, so posting can send another member's pending email inline. The
messages route is a latency-variable path; the tests must not assume queuing is
cheap.

**Volume, named rather than assumed:** the debounced email moves from "the notes
field changed on a save" to "a lead posted a message", and chat invites far more
frequent posting. Production runs `NOTIFY_FLUSH_EMAIL_LIMIT=2` against a measured
14 413 ms/send. Watch `report.lost` after the release.

## Phases

Every phase ends with `npx tsc --noEmit`, `npm test`, `npx eslint .` at 0 errors.

### Phase A — Exports and the pure classifier

- Export `REVIEWABLE_BEFORE_WRITE` and `ADMIN_RECIPIENTS_QUERY`. **Do not collapse
  `REVIEWABLE_STATUSES` into the side-effects module** — it already imports
  `sweepOutbox` (`serviceMutationSideEffects.ts:71`), so that direction closes an
  import cycle. Put the shared set in a leaf or export from `outboxSweep`. They are
  semantically different predicates (before-write vs at-flush) that coincide today.
- `classifyProposalMessages` beside `classifyLeadNotes`, unused.
- **Verification:** gate + unit tests. No behaviour change.

### Phase B — The notification cutover (one deploy)

Splitting this produces either a dead notification or a mass mis-send.

- Input shape, both call sites, `PROPOSAL_QUERY`, the legacy-shape drop,
  `proposalNotify`'s body source.
- Both pushes.
- **The mirror is removed in this same deploy**, including `POST /api/me/proposals`
  ceasing to write `lead_notes` in both branches and the transition ceasing to set
  `admin_notes`.
- Redeploy the Sanity schema.
- **Verification:** gate + the table below; manual walkthrough on `preview`, which
  writes REAL data.

### Phase C — Docs

`docs/NOTIFICATIONS.md` (+ both pushes and the new body source);
`docs/API_REFERENCE.md`; the parent roadmap marked delivered.

## Acceptance criteria

1. A lead's message on `pending`/`changes_requested` produces the same email
   admins get today — same audience, same debounce, same preference key — with the
   body from the thread.
2. A lead's message on an `approved` future-dated proposal reaches admins by push.
3. An admin's standalone message reaches the lead by push; a `request_changes`
   produces **exactly one** push.
4. No message is notified twice.
5. `lead_notes` and `admin_notes` are byte-identical to their values at the end of
   Child A. Nothing blanks them.
6. In-flight legacy outbox notices are dropped and consumed, never crashing the
   sweep.

## Verification

| Requirement | Test | Failure it detects |
|---|---|---|
| **The archive is never overwritten** | `proposalWriteRoutes.test.ts` — the save mutation `set` has **no** `lead_notes` key; re-read a document with a value and show it byte-unchanged | Blanking `lead_notes` when the editor stops sending it |
| **The transition stops setting `admin_notes`** | `proposalWriteRoutes.test.ts` — the transition `set` has no `admin_notes` key | Silently blanking the admin archive, which an empty `reopen` does today |
| The email still fires, same shape | `setlistNoticeQueueing.test.ts` — before/after Child B, a lead message on `pending` produces an equivalent outbox document | Retiring the debounced email by refactor |
| An old-shape save lands and queues | `setlistNoticeQueueing.test.ts` — a save carrying `leadNotes` appends a message and produces an outbox document | A pre-Child-A bundle's note discarded behind a success toast |
| Legacy notice is dropped and consumed | `outboxSweep.test.ts` — a `{beforeNotes}` notice with no `beforeMessageCount` | An empty-body email to admins; a wedged claim |
| `beforeMessageCount: 0` is not dropped | `outboxSweep.test.ts` | A truthiness check killing the first-message case |
| Only lead messages queue a notice | `setlistNoticeQueueing.test.ts` | Admins mailed their own change-request |
| The admin push reaches ADMINS | `proposalMessageRoutes.test.ts` — assert the recipient set | Pushing the lead about their own message |
| The author is excluded | `proposalMessageRoutes.test.ts` — a lead who is also an admin | Self-notification |
| `request_changes` pushes exactly once | `proposalWriteRoutes.test.ts` — count `sendPush` calls | A double push from adding a second call site |
| A `draft` message pushes nothing | `proposalMessageRoutes.test.ts` | Notifying admins about work not in front of them |

**Suites that will break:** `outboxSweep.test.ts`, `outboxClassify.test.ts`,
`serviceMutationSideEffects.test.ts`, `proposalNotify.test.ts`,
`setlistNoticeQueueing.test.ts`, `proposalWriteRoutes.test.ts`, and if the email
subject changes, `emailTemplateGallery.test.ts` / `notificationEmail.test.ts`.

## Safe ending state and rollback

**Safe ending state:** the thread is the sole source for both notification
directions; the legacy fields are a frozen archive nothing writes.

**Rollback: revert the code**, which restores the mirror going forward and returns
the email to reading `lead_notes`. **What revert does not recover:** messages
posted while Child B was live were not mirrored, so `lead_notes` is stale until
the next post refreshes it — the *email body* regresses, not the thread, which
Child A still renders in full. No message is lost. That asymmetry is why Child B
ships second: its worst case is a stale email, not missing history.

## Open questions

| # | Question | Recommendation | Blocking? |
|---|---|---|---|
| OQ-1 | ~~Ministry-filter the admin audience?~~ | **RESOLVED 2026-08-25: its own independent delivery.** Frank's call. It is a pre-existing defect across every proposal notification, not something this child introduced, and scoping it correctly means touching `proposalNotify`, `outboxSweep` and the kids surfaces together. This child neither fixes nor worsens the rule; it inherits whatever the audience is at the time. Tracked as FrankERP/owt-kb-v1#8 | Closed |
| OQ-2 | New admin-push helper, or inline `sendPush`? | Either; state which | No |
| OQ-3 | Does the `leadNotes` email subject change to "Mensajes de la propuesta"? | Yes — "Notas del líder" is wrong once the thread carries admin replies | No |

## Terminal state

`READY_FOR_ADVERSARIAL_REVIEW` — OQ-1 was resolved on 2026-08-25 by making
ministry-scoped notifications an independent delivery. This child inherits the
audience rule rather than owning it.

Review order: the parent, then Child A, then this. Plan approval is not
authorization to implement.
