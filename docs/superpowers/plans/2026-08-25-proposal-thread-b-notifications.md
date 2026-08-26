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
  projecting **`messages[kind == "lead_note"]{body}`** — filtered and narrowed, not
  the whole array: the classifier slices exactly that, and a wholesale projection
  would pull up to 200 × `PROPOSAL_NOTES_MAX` into a sweep that runs on a deadline
  budget and has overrun it before. The legacy-shape drop.
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

**The action is right; the hazard as an earlier draft stated it is already closed
by Child A.** That draft cited `route.ts:232`/`:264` writing `lead_notes`
unconditionally with `parseProposalSaveRequest` coercing an absent value to `""`
(`proposalWriteRequest.ts:117`) — true of **pre-Child-A** code. Child A's §2 server
rule already makes that write conditional and omits the field from the patch
entirely otherwise, so the blanking cannot happen from B's actual starting point.

What remains is simply that the mirror has a job that ends: once the outbox and the
submit email read the thread, writing `lead_notes` serves nothing, and leaving a
half-maintained field is worse than removing the write. Removing the write and
removing the mirror are the same edit and land together.

**`parseProposalSaveRequest` keeps ACCEPTING `leadNotes`** — an old bundle from
before Child A may still post it. The route appends it as a `lead_note` message
**only when it is non-empty AND differs (trimmed) from the newest `lead_note`
body** — both halves, exactly as Child A §2 states them. The comparison target
changes (the newest message rather than the frozen `lead_notes`); the non-empty half
does not. `buildProposalMessage` returns `null` on an empty body
(`proposalMessageWrite.ts:112`) so `tsc` backstops it, but the rule is stated rather
than left to the type. **Keep Child A's negative test too**, not only the positive
one: a save carrying no `leadNotes` appends nothing. Removing the field from the
parser is a later, separate delivery.

### Outbox

**Call sites, authoritatively:** `queueLeadNotesNotice` is called from the lead
messages route **and** from the legacy `leadNotes` compat path in
`POST /api/me/proposals`, each snapshotting `previousStatus` and the lead-message
count PRE-COMMIT in its own handler, and from nowhere else.

**Neither call site may queue when it appended nothing.** Losing
`beforeNotes`/`afterNotes` also removes the function's own trimmed-equal early
return (`serviceMutationSideEffects.ts:636`), so the callers now carry that
responsibility alone — and this matters for the compat path in particular, where an
unchanged `leadNotes` appends nothing. A no-append queue still resets
`servedRecipients` and slides the debounce (`outboxNotice.ts:152`).

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

**This silently closes one of Child A's named gaps — state it rather than let it
fall out.** Today `queueLeadNotesNotice` returns early on
`before.trim() === after.trim()` (`serviceMutationSideEffects.ts:636`), which is why
Child A §1 lists "a repeated identical message sends no email" as an accepted gap.
Dropping `beforeNotes`/`afterNotes` removes that comparison, so a repeat now queues
and emails. An improvement, and intended — but it is a behaviour change against a
sibling's stated baseline, and Child A's gap list should be read as superseded here
rather than contradicted.

`LineKind`, `LINE_PREF.leadNotes`, `NOTICE_KINDS` and the stored `kind` value
`"leadNotes"` are **all unchanged** — renaming the wire value would orphan
in-flight documents for no benefit. Only the meaning changes.

**Close the legacy seam outright rather than accepting it.** Because `before` is
written only by `createIfNotExists`, a pre-cutover `{beforeNotes}` notice absorbs
**every subsequent lead message on that proposal** until it flushes — up to its
`deadline`, creation + `NOTIFY_MAX_WINDOW_MINUTES` (60), not just the deploy
instant. All of them are then dropped unemailed. **Phase B gains a pre-check:**
assert `count(*[_type == "notificationOutbox" && kind == "leadNotes"]) == 0`
immediately before cutover and wait for the sweep if it is not. Production holds
zero outbox documents at rest, so this is normally a no-op — which is exactly why
it is cheap to require rather than to reason about.

**The rollback has the mirror image and it is not closed:** reverting puts the OLD
classifier in front of `{beforeMessageCount}` notices, which read
`beforeNotes ?? ""` (`outboxSweep.ts:389`) against a now-stale `lead_notes` and
email stale content. Same pre-check, applied before a revert.

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
| lead → admin, `approved` | a `lead_note` message | **push to ADMINS** — `sendPush(adminIds, "proposals", { …, path: "/admin" })`, `adminIds` from the exported `ADMIN_RECIPIENTS_QUERY`, author filtered out. **`path: "/admin"`**, matching the existing admin push (`proposalNotify.ts:160`) — `notifyProposalReview` hardcodes `/me`, which is the lead's surface and wrong for this row |
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
right helper for the two rows whose recipient is the **lead** — read who receives,
not the arrow's direction.)

**Exclude the author from BOTH pushes — one stated mechanism each.** A lead who is
also an `admin` would otherwise be pushed about their own message, and the hazard
exists in both directions: `proposalReviewRecipients` does not filter, and
`ADMIN_RECIPIENTS_QUERY` has no author filter either.

- **admin → lead:** add an **optional third parameter** to `notifyProposalReview`,
  `excludeIds?: readonly string[]`, and pass the author. "Filter in the route" is
  not implementable — the helper resolves its own recipients internally and exposes
  no hook (`serviceMutationSideEffects.ts:740-752`), so a route-side filter would
  mean re-implementing `proposalReviewRecipients` + `sendPush`, a second copy of the
  audience rule. **Adding the parameter changes neither existing call site**: both
  pass exactly two arguments (`admin/proposals/[id]/route.ts:379`, `:532`).
- **lead → admin:** filter the author out of `adminIds` in the route, before
  `sendPush`. There is no shared helper to extend there.

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
   body from the thread. **No manual check can reach this**: production has zero
   proposals in `pending` or `changes_requested`, so the path is unreachable by hand
   on `preview` and this criterion rests entirely on `setlistNoticeQueueing.test.ts`.
   Named under parent invariant 8, as Child A names the same gap for itself.
2. A lead's message on an `approved` future-dated proposal reaches admins by push.
3. An admin's standalone message reaches the lead by push; a `request_changes`
   produces **exactly one** push.
4. **No message produces both an email and a push.** Stated as email-XOR-push,
   not as "never notified twice": the outbox's re-pend path can legitimately re-send
   a joined body. With 5 admins and `NOTIFY_FLUSH_EMAIL_LIMIT=2` a notice needs
   three sweeps, and a new message in between clears `servedRecipients`
   (`outboxNotice.ts:152`) while `before.beforeMessageCount` is preserved — so an
   admin already served receives the joined body again, including a message they
   had. Today they would receive only the newest note. Harmless, inherent to the
   debounce, and not what this criterion is about.
5. `lead_notes` and `admin_notes` are byte-identical to their values at the end of
   Child A. Nothing blanks them.
6. In-flight legacy outbox notices are dropped and consumed, never crashing the
   sweep.

## Verification

| Requirement | Test | Failure it detects |
|---|---|---|
| **The archive is never overwritten** | `proposalWriteRoutes.test.ts` — the save mutation `set` has **no** `lead_notes` key; re-read a document with a value and show it byte-unchanged | Blanking `lead_notes` when the editor stops sending it |
| **The transition stops setting `admin_notes`** | `proposalWriteRoutes.test.ts` — the transition `set` has no `admin_notes` key | Silently blanking the admin archive, which an empty `reopen` does today |
| The email still fires, same audience and timing | `setlistNoticeQueueing.test.ts` — before/after Child B, a lead message on `pending` produces an outbox document with the **same id, kind, audience and timing**. Not "the same shape": `before` deliberately changes from `{beforeNotes}` to `{beforeMessageCount}` | Retiring the debounced email by refactor |
| An old-shape save lands and queues | `setlistNoticeQueueing.test.ts` — a save carrying `leadNotes` appends a message and produces an outbox document | A pre-Child-A bundle's note discarded behind a success toast |
| Legacy notice is dropped and consumed | `outboxSweep.test.ts` — a `{beforeNotes}` notice with no `beforeMessageCount` | An empty-body email to admins; a wedged claim |
| `beforeMessageCount: 0` is not dropped | `outboxSweep.test.ts` | A truthiness check killing the first-message case |
| Only lead messages queue a notice | `setlistNoticeQueueing.test.ts` | Admins mailed their own change-request |
| The admin push reaches ADMINS | `proposalMessageRoutes.test.ts` — assert the recipient set | Pushing the lead about their own message |
| The author is excluded | `proposalMessageRoutes.test.ts` — a lead who is also an admin | Self-notification |
| `request_changes` pushes exactly once | `proposalWriteRoutes.test.ts` — count **`sendPushMock`** calls on the transition, the mechanism the suite already uses (`:39` mocks `@/app/utils/push`; `:710` and `:946` assert on it). **Do NOT add a wholesale `serviceMutationSideEffects` mock** — no suite in the repo has one, `notifyProposalReview` runs through to `sendPush` for real, and mocking the module would make the existing negative assertions at `:796`, `:892` and `:969` pass vacuously, retiring three push guards on the delivery whose subject is push fan-out | A double push from adding a second call site — or the guards being silently vacated by the fix |
| A `draft` message pushes nothing | `proposalMessageRoutes.test.ts` | Notifying admins about work not in front of them |

**Suites that will break:** `outboxSweep.test.ts`, `outboxClassify.test.ts`,
`serviceMutationSideEffects.test.ts`, `proposalNotify.test.ts`,
`setlistNoticeQueueing.test.ts`, `proposalWriteRoutes.test.ts`,
**`notificationOutboxSchema.test.ts`** (`:49-54` pins `before`'s field names to
exactly `["beforeNotes","beforeRoles","beforeSongs"]`, so `beforeMessageCount`
breaks it), and if the email subject changes, `emailTemplateGallery.test.ts` /
`notificationEmail.test.ts`.

**E2E, which CI does not run** (`ci.yml:6-7`) and which therefore surfaces late:
`e2e/service-readiness/proposal-lifecycle.spec.ts:104` asserts
`afterRequest?.admin_notes` contains the change-request note — this child removes
that write — and `scripts/lib/sr-verification.mjs:938` seeds the same field.

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
| OQ-2 | ~~New admin-push helper, or inline `sendPush`?~~ | **DECIDED: inline `sendPush` in the lead messages route.** There is one caller, and a helper wrapping a one-line fan-out would be a third place the admin audience is written down — `ADMIN_RECIPIENTS_QUERY` and `proposalNotify.ts:143` already duplicate it with no sync guard. Exporting the query and calling `sendPush` directly adds no fourth copy | Closed |
| OQ-3 | Does the `leadNotes` email subject change to "Mensajes de la propuesta"? | Yes — "Notas del líder" is wrong once the thread carries admin replies | No |

## Terminal state

`READY_FOR_ADVERSARIAL_REVIEW` — OQ-1 was resolved on 2026-08-25 by making
ministry-scoped notifications an independent delivery. This child inherits the
audience rule rather than owning it.

Review order: the parent, then Child A, then this. Plan approval is not
authorization to implement.
