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

**Every rule below is stated once.** Where an earlier draft's reasoning is worth
keeping it lives in the review log, not here — the repeated defect on this plan and
its siblings has been the same rule restated in three sections with three values.

## Outcome

Notifications are sourced from the thread rather than from the legacy note
fields, and both directions of the conversation reach their counterpart. The
mirror Child A installed is removed.

## Current behaviour after Child A, and the gap

Child A leaves three things true:

1. `lead_notes` / `admin_notes` are **mirrors** — `lead_notes` on every lead
   message, `admin_notes` **from the transition only** (Child A §1), so the existing
   email keeps firing unchanged. They are a shim.
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
- `classifyProposalMessages` replacing `classifyLeadNotes` as the sweep's classifier;
  `PROPOSAL_QUERY` narrowed and exported.
- `notificationOutbox.before` gaining `beforeMessageCount`.
- `proposalNotify`'s "Nueva propuesta" body source.
- The lead→admin push on **`approved`**, and the admin→lead push for standalone
  messages. **Both inherit whatever admin audience exists at the time** — this child
  does not own the ministry-scoping question (OQ-1).
- Exporting `REVIEWABLE_BEFORE_WRITE` and `ADMIN_RECIPIENTS_QUERY`.
- **Removing the mirror** — `lead_notes` / `admin_notes` stop being written.

### Out

Everything Child A owns. No schema migration. No new writer. No UI beyond
notification-adjacent copy.

### Explicitly not in this delivery

Unread indicators; unsetting the legacy fields; a new `notificationOutbox` kind;
any new email.

## Design

### The projection — stated once, here

**Both new reads use the same GROQ shape:**

```
messages[kind == "lead_note"]{kind, body}
```

Two call sites, and only two: `PROPOSAL_QUERY` (`outboxSweep.ts:203-205`) and
`proposalNotify`'s read (`proposalNotify.ts:138-153`). No other section restates the
shape; the Verification rows **execute** the query rather than quoting it.

- **The filter is there so one predicate is applied once**, not for payload. Filtering
  by `kind` does not move the worst case, which is still 200 × `PROPOSAL_NOTES_MAX`
  when every message is a lead note.
- **The narrowing is the payload win** — `{kind, body}` drops `_key`, `author` and
  `at` from an array read on a deadline-budgeted sweep, and on a path `await`ed
  inline on the member's save request.
- **`kind` is projected** so the shape is uniform and a `.filter()` added later
  still matches. Nothing reads it.
- **Consumers must NOT re-filter.** The array arrives pre-filtered; the classifier's
  parameter is named `leadMessages`, not `afterMessages`, and `proposalNotify` takes
  the **last element of the pre-filtered array** in JS — not a second `kind` filter,
  and not a GROQ negative index.
- **GROQ returns `null`, not `[]`,** when `messages` is absent. Coerce at each call
  site, as `outboxSweep.ts:390` does today.

**The guard is execution, not this paragraph.** `outboxSweep.test.ts:244` routes the
proposal query to a hand-written literal (`:1143`) and nothing compares the two, so a
fixture cannot catch the projection drifting. Phase B therefore **exports
`PROPOSAL_QUERY`** and the verification runs it with `groq-js` — already a
devDependency (`package.json:78`) and already used this way by five suites
(`worshipAudienceScope.test.ts`, `adminMemberVisibility.test.ts`,
`meAvailabilityConflict.test.ts`, `kidsAvailabilityConflict.test.ts`,
`kidsRoutes.test.ts`).

**What that guard prevents, concretely:** narrowing to `{body}` while leaving a
`.filter(kind === "lead_note")` in a consumer. Every element would lack `kind`, the
filter would match nothing, `appended.length` would be 0 for every notice, and **the
debounced admin email would silently stop with every other check green.**

### Removing the mirror

**`POST /api/me/proposals` stops writing `lead_notes` in BOTH branches** — the
patch (`app/api/me/proposals/route.ts:232`) and the create (`:264`).
Unconditionally. The create branch mints `messages: [msg]` instead when a note is
present. The transition stops setting `admin_notes`. The message routes stop
mirroring.

**No blanking hazard remains at B's starting point.** Child A's §2 server rule already
made the `lead_notes` write conditional and omits the field from the patch entirely
otherwise. What remains is only that the mirror has a job that ends: once the outbox
and the submit email read the thread, writing `lead_notes` serves nothing, and a
half-maintained field is worse than no write. Removing the write and removing the
mirror are the same edit and land together.

**`parseProposalSaveRequest` keeps ACCEPTING `leadNotes`** — an old bundle from
before Child A may still post it. The route appends it as a `lead_note` message
**only when it is non-empty AND differs (trimmed) from the newest `lead_note`
body** — both halves, exactly as Child A §2 states them. The comparison target
changes (the newest message rather than the frozen `lead_notes`); the non-empty half
does not. `buildProposalMessage` returns `null` on an empty body
(`proposalMessageWrite.ts:117-118`) so `tsc` backstops it, but the rule is stated
rather than left to the type. **Keep Child A's negative test too**, not only the
positive one: a save carrying no `leadNotes` appends nothing. Removing the field from
the parser is a later, separate delivery.

### Outbox

**Call sites, authoritatively:** `queueLeadNotesNotice` is called from the lead
messages route **and** from the legacy `leadNotes` compat path in
`POST /api/me/proposals`, each snapshotting `previousStatus`, `beforeNotes` and the
lead-message count PRE-COMMIT in its own handler, and from nowhere else.

**Input shape.** `QueueLeadNotesNoticeInput` loses `afterNotes` and gains
`beforeMessageCount: number` — the pre-commit count of `messages` where
**`kind === "lead_note"`**, the same predicate the projection filters on.
`notificationOutbox.before` gains the field. **`beforeNotes` is KEPT** on both the
input and the stored notice; §The cutover seam is why.

**Neither call site may queue when it appended nothing.** Losing `afterNotes` removes
the function's own trimmed-equal early return (`serviceMutationSideEffects.ts:636`) —
`beforeNotes` survives as a stored field but has no counterpart to compare against —
so the callers now carry that responsibility alone. This matters for the compat path
in particular, where an unchanged `leadNotes` appends nothing. A no-append queue still
resets `servedRecipients` and slides the debounce (`outboxNotice.ts:152`).

**Classification** replaces `classifyLeadNotes` in the sweep:

```
classifyProposalMessages({ beforeCount, leadMessages, serviceDate, today, reviewable })
  isPast(serviceDate, today)  -> null   (unchanged)
  !reviewable                 -> null   (unchanged)
  leadMessages = leadMessages ?? []              // see §The projection
  appended = leadMessages.slice(beforeCount)     // ALREADY filtered — do not re-filter
  appended.length === 0       -> null
  -> { kind: "leadNotes", …, notes: appended.map(m => m.body).join("\n\n") }
```

A count-and-slice is sound because the array is append-only *and* Child A's
migration already ran, so no prepend can shift indices under a queued notice.

**This closes one of Child A's named gaps.** Today `queueLeadNotesNotice` returns
early on `before.trim() === after.trim()` (`serviceMutationSideEffects.ts:636`), which
is why Child A §1 lists "a repeated identical message sends no email" as an accepted
gap. Dropping `afterNotes` removes that comparison, so a repeat now queues and emails.
An improvement, and intended — but it is a behaviour change against a sibling's stated
baseline, so Child A's gap list is **superseded** here rather than contradicted.

`LineKind`, `LINE_PREF.leadNotes`, `NOTICE_KINDS` and the stored `kind` value
`"leadNotes"` are **all unchanged** — renaming the wire value would orphan
in-flight documents for no benefit. Only the meaning changes.

**In-flight legacy notices:**
`typeof notice.before?.beforeMessageCount !== "number"` ⇒ **drop** (return `[]`).
`typeof`, not truthiness — `beforeMessageCount: 0` is the legitimate first-message
case. Dropping is safe and verified: `classifiedIds.add` precedes classification
(`outboxSweep.ts:734`), `partitionClaimed` routes a classified notice with no
pending recipients to `toConsume` (`:506-535`), and the `finally` deletes it
(`:886-890`). It does not crash, wedge or re-pend.

**`proposalNotify.ts:138-153`** takes the body of the newest `lead_note` message,
empty when there is none, under §The projection's rules. Semantic drift to accept:
today `lead_notes` on submit is what the lead saved *with that submission*; the newest
message may be days older. Still their most recent word — but the framing must not
imply "notes attached to this submission".

**Redeploy the Sanity schema** — `notificationOutbox` gains a field. The Content
Lake stores undeclared fields so nothing breaks without it, but the manifest would
be stale.

### The cutover seam

A deploy has two seams running in opposite directions. **One is closed by keeping
`beforeNotes`; the other is drained by a pre-check.**

**Closed — new route queues, OLD sweep flushes.** This is the case the parent carries
(roadmap `:259-264`, "Child B names and owns it"). During Phase B's deploy nothing
writes `lead_notes` any more, so the stored value is **frozen**. The notice carries
`beforeNotes` = that same frozen value, snapshotted pre-commit. A still-warm old sweep
reads `notice.before?.beforeNotes ?? ""` (`outboxSweep.ts:389`), compares it against
the live `lead_notes`, finds them equal, and `classifyLeadNotes` returns `null`
(`outboxClassify.ts:103`). **Nothing is emailed and the notice is consumed** — which
means the lead's message in that window is stored and rendered but **silent**. That is
the same disposition the parent already accepted for in-flight legacy notices: no
stale content, at the cost of one message going unannounced inside a deploy window.

Keeping `beforeNotes` costs one string per notice. It also keeps in-flight legacy
documents readable, and it closes the identical seam on a **revert**: a reverted sweep
meets `{beforeMessageCount, beforeNotes}` notices and drops them by the same equality.

**Accepted, and drained — OLD route queues, new sweep flushes.** A pre-deploy route
instance queues a `{beforeNotes}`-only notice and the new sweep drops it for want of
`beforeMessageCount`. This residual is the one the parent already decided to accept.
Because `before` is written only by `createIfNotExists`, such a notice absorbs **every
subsequent lead message on that proposal** until it flushes — up to its `deadline`,
creation + `NOTIFY_MAX_WINDOW_MINUTES` (60), not just the deploy instant, and all of
them are then dropped unemailed. **Hence the Phase B pre-check:** assert
`count(*[_type == "notificationOutbox" && kind == "leadNotes"]) == 0` immediately
before cutover, and wait for the sweep if it is not. Production holds zero outbox
documents at rest, so this is normally a no-op — which is exactly why it is cheap to
require rather than to reason about. **Applied again before any revert.**

**`classifyLeadNotes` survives Phase B with no caller, deliberately.** The legacy
branch drops rather than classifies, so nothing in the post-B tree calls it. It is
retained — with a comment saying why — because a revert restores its caller, and
because it is the function a still-warm pre-deploy sweep runs during the window above.
Deleting it as dead code would silently remove the revert path's classifier. Its
existing tests stay green and unchanged.

### Notifications, both directions

| Direction | Trigger | Channel |
|---|---|---|
| lead → admin, `pending`/`changes_requested` | a `lead_note` message | the existing debounced `leadNotes` outbox email |
| lead → admin, `approved` | a `lead_note` message | **push to ADMINS** — see §Push below |
| lead → admin, `draft` | — | **nothing** — a draft is not in front of admins yet |
| admin → lead, **standalone message only** | an `admin_change_request` via the admin messages route | push via `notifyProposalReview(doc, push)` with NEW copy |
| admin → lead, **via a transition** | `request_changes` / `reopen` | **unchanged** — the transition already calls `notifyProposalReview(doc, REVIEW_PUSH[action])` (`admin/proposals/[id]/route.ts:532`). Do not add a second call, and do not replace `Cambios solicitados` with `Nuevo mensaje` |
| lead → admin, first submission | unchanged | `notifyProposalPending` |

**The `approved` row exists because the composer stays open there** (decision 5)
while both outbox gates are `{pending, changes_requested}`. Most proposals are
approved, so without it a lead could post where the admin never learns.

#### Push

**The lead→admin call**, inline in the lead messages route (OQ-2):

```
sendPush(adminIds, "proposals", {
  title: "Nuevo mensaje",
  body:  "<Autor> escribió en la propuesta del <fecha>",
  path:  "/admin",
})
```

- **`adminIds`** from the exported `ADMIN_RECIPIENTS_QUERY`, author filtered out.
- **`path: "/admin"`**, matching the existing admin push (`proposalNotify.ts:160`).
  `notifyProposalReview` hardcodes `/me`, which is the lead's surface and wrong here.
- **`<fecha>` is rendered at local noon** — `new Date(iso.slice(0,10) + "T12:00:00")`,
  the CLAUDE.md invariant; a bare `new Date(iso)` day-flips in America/Mexico_City.
  There is no shared util; the nearest precedent is `proposalNotify.ts:44`. This is
  the first push body in the repo to carry a service date.
- **The copy must be new.** Reusing `REVIEW_PUSH.request_changes` would push
  "Cambios solicitados — Revisaron la propuesta y pidieron cambios" when an admin
  merely asked a question.

**Do not reach for `notifyProposalReview` when the recipients are ADMINS.** Its
audience is lead + contributors. It *is* the right helper for the two rows whose
recipient is the **lead** — read who receives, not the arrow's direction. Its `path`
is `/me`, the member home, not the proposal surface `/me/propose/[roleId]` that
`proposalNotify.ts:169` uses for co-leads: inherited and left as is, but looser than
the `/admin` the lead→admin row specifies.

**Exclude the author from BOTH pushes — one stated mechanism each.** A lead who is
also an `admin` would otherwise be pushed about their own message, and the hazard
exists in both directions: `proposalReviewRecipients` does not filter, and
`ADMIN_RECIPIENTS_QUERY` has no author filter either.

- **admin → lead:** add an **optional third parameter** to `notifyProposalReview`,
  `excludeIds?: readonly string[]`, and pass the author. **Apply the filter BEFORE
  the empty-audience guard** (`serviceMutationSideEffects.ts:746`) — otherwise a
  proposal whose only recipient is the author passes the guard and pushes them.
  "Filter in the route" is not implementable: the helper resolves its own recipients
  internally and exposes no hook (`serviceMutationSideEffects.ts:740-750`), so a
  route-side filter would mean re-implementing `proposalReviewRecipients` +
  `sendPush`, a second copy of the audience rule. **Adding the parameter changes
  neither existing call site**: both pass exactly two arguments
  (`admin/proposals/[id]/route.ts:379`, `:532`).
- **lead → admin:** filter the author out of `adminIds` in the route, before
  `sendPush`. There is no shared helper to extend there.

`REVIEWABLE_BEFORE_WRITE` and `REVIEWABLE_STATUSES` are **unchanged** — the email
keeps today's audience and timing. The push is a separate additive call, fired only
when the status is one the outbox will not cover. **One signal per message, never
both.**

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

- Export `REVIEWABLE_BEFORE_WRITE`, `ADMIN_RECIPIENTS_QUERY` and `PROPOSAL_QUERY`.
  **Do not collapse `REVIEWABLE_STATUSES` into the side-effects module** — it already
  imports `sweepOutbox` (`serviceMutationSideEffects.ts:71`), so that direction closes
  an import cycle. Put the shared set in a leaf or export from `outboxSweep`. They are
  semantically different predicates (before-write vs at-flush) that coincide today.
- `classifyProposalMessages` beside `classifyLeadNotes`, unused.
- **Verification:** gate + unit tests. No behaviour change.

### Phase B — The notification cutover (one deploy)

Splitting this produces either a dead notification or a mass mis-send.

- Input shape, both call sites, both narrowed reads (§The projection), the
  legacy-shape drop, `proposalNotify`'s body source.
- Both pushes.
- **The mirror is removed in this same deploy**, including `POST /api/me/proposals`
  ceasing to write `lead_notes` in both branches and the transition ceasing to set
  `admin_notes`.
- **Copy:** the `leadNotes` email subject → "Mensajes de la propuesta" (OQ-3), and the
  member-facing preference hint at `app/components/ui/EmailPrefToggles.tsx:68`
  ("Notas del líder y propuestas nuevas.") → "Mensajes de la propuesta y propuestas
  nuevas." Same phase as the write removal: it is the toggle that gates the mail whose
  body is changing.
- **The pre-cutover backlog check** (§The cutover seam), immediately before the
  deploy, and again before any revert.
- Redeploy the Sanity schema.
- **The e2e edits** below, which CI does not run.
- **Verification:** gate + the table below; manual walkthrough on `preview`, which
  writes REAL data.

### Phase C — Docs

`docs/NOTIFICATIONS.md` (+ both pushes and the new body source);
`docs/API_REFERENCE.md`; `docs/DATA_MODEL.md:184`, which still describes `lead_notes`
as the live "Notas del líder" when this delivery makes both legacy fields write-free
archives; `docs/superpowers/specs/2026-07-27-service-notification-emails-design.md:774`,
which still describes `emailProposals` as gating "Notas del líder"; the parent roadmap
marked delivered.

## Acceptance criteria

1. A lead's message on `pending`/`changes_requested` produces the same email
   admins get today — same audience, same debounce, same preference key — with the
   body from the thread. **No manual check can reach this**: production has zero
   proposals in `pending` or `changes_requested`, so the path is unreachable by hand
   on `preview`. **It rests on two suites:** `setlistNoticeQueueing.test.ts` proves the
   queue side, and the `outboxSweep.test.ts` rows below prove the audience, the
   preference key and the thread-sourced body. "Same audience" is not assertable at
   queue time at all — the notice stores `knownRecipients: []` and the admin set
   resolves at flush (`outboxSweep.ts:263`).
   Named under parent invariant 8, as Child A names the same gap for itself.
2. A lead's message on an `approved` future-dated proposal reaches admins by push.
3. An admin's standalone message reaches the lead by push; a `request_changes`
   produces **exactly one** push.
4. **No message produces both an email and a push.** Stated as email-XOR-push,
   not as "never notified twice" — the outbox's re-pend path can legitimately re-send
   a joined body. **Two exceptions, both named:**

   **(a) The send-budget re-pend** (`outboxSweep.ts:851-867` with `:531-534`) — not
   `emailLimit`; an oversized notice is selected alone and deliberately exceeds the
   budget rather than splitting (`:625-631`). Across those sweeps a new message clears
   `servedRecipients` (`outboxNotice.ts:152`) while `before.beforeMessageCount` is
   preserved, so an admin already served receives the joined body again, including a
   message they had. Today they would receive only the newest note. Harmless and
   inherent to the debounce.

   **(b) A status round-trip inside one window.** `before` is written only by
   `createIfNotExists`, so a notice queued while `pending` holds
   `beforeMessageCount = N` for its whole window. Lead posts M1 on `pending` (notice
   queued) → admin approves → lead posts M2 on `approved` → **push** → admin reopens →
   the flush now finds a reviewable status and emails `slice(N)` = `[M1, M2]`. **M2
   gets both.** Four events inside 60 minutes, so rare, and the harm is one redundant
   notification.
5. `lead_notes` and `admin_notes` are byte-identical to their values at the end of
   Child A. Nothing blanks them.
6. In-flight legacy outbox notices are dropped and consumed, never crashing the
   sweep.
7. **No stale content is emailed during the deploy window** (parent roadmap
   `:259-264`), by the mechanism in §The cutover seam.

## Verification

| Requirement | Test | Failure it detects |
|---|---|---|
| **The archive is never overwritten** | `proposalWriteRoutes.test.ts` — the save mutation `set` has **no** `lead_notes` key; re-read a document with a value and show it byte-unchanged | Blanking `lead_notes` when the editor stops sending it |
| **Neither branch of `POST /api/me/proposals` writes `lead_notes`** | `proposalWriteRoutes.test.ts` — assert absence of the key on BOTH the patch and the **create** payload. The create branch is exercised (`:425`, `:458`, `:495`) but only through `toMatchObject`, which cannot see a surviving field — it needs an explicit `expect(created).not.toHaveProperty("lead_notes")`, the form `:703` already uses on the setlist create | A half-removed mirror: the create path still seeding a field nothing maintains |
| **The transition stops setting `admin_notes`** | `proposalWriteRoutes.test.ts` — the transition `set` has no `admin_notes` key | Silently blanking the admin archive, which an empty `reopen` does today |
| **The notice carries BOTH snapshot fields, on BOTH call sites** | `setlistNoticeQueueing.test.ts` — same id, kind and timing as today, **and `before` asserted explicitly**: `beforeNotes` equal to the stored pre-commit `lead_notes`, `beforeMessageCount` equal to the pre-commit `kind == "lead_note"` count. On the compat path (`:716` already pins `beforeNotes`) **and on the lead messages route, which has no such pin today**. Not audience — not assertable at queue time (criterion 1). **This row is what protects the cutover seam**, because the seam is closed by the queue writing `beforeNotes` | Retiring the debounced email by refactor; or a later cleanup dropping `beforeNotes` as dead weight because nothing pinned it |
| **The cutover seam end-to-end** | `setlistNoticeQueueing.test.ts` — queue through the **new** route, then pass the resulting notice's `before.beforeNotes` and the unchanged stored `lead_notes` to `classifyLeadNotes`, expecting `null`. Composes the row above with the surviving pure function, so it fails if the route stops writing the field. **A bare `classifyLeadNotes({before:"x", after:"  x  "}) === null` is NOT this row** — `outboxClassify.test.ts:123-125` already makes it, and it passes whether or not the route writes anything | Criterion 7 regressing to a stale-content email during a deploy |
| An old-shape save lands and queues | `setlistNoticeQueueing.test.ts` — a save carrying `leadNotes` appends a message and produces an outbox document | A pre-Child-A bundle's note discarded behind a success toast |
| **A `{beforeMessageCount}` notice classifies and emails** | `outboxSweep.test.ts` — **execute the exported `PROPOSAL_QUERY` with `groq-js`** over a `setlistProposal` carrying both `lead_note` and `admin_change_request` messages, feed the result to `classifyProposalMessages`, and **assert the resulting `notes` equals the lead bodies exactly** — not merely "non-empty", which still passes if someone drops the `[kind == "lead_note"]` filter, misaligning `slice(beforeCount)` and mailing admins their own change-request text | The flush path silently classifying to `null` — the debounced email dying with every other check green |
| **The submit email's body comes from the thread** | `proposalNotify.test.ts` — its fixture moves from `lead_notes` to `messages`, and `:186` pins a non-empty notes block. **Execute that query with `groq-js`** too: a hand-written fixture cannot catch this projection drifting either, and it is the same one line on a path `await`ed inline on the member's save request | Child A criterion 6's guarantee (the email "always fires … with the notes block it would have had") silently becoming an empty block |
| Legacy notice is dropped and consumed | `outboxSweep.test.ts` — a `{beforeNotes}` notice with no `beforeMessageCount` | An empty-body email to admins; a wedged claim |
| `beforeMessageCount: 0` is not dropped | `outboxSweep.test.ts` | A truthiness check killing the first-message case |
| Only lead messages queue a notice | `setlistNoticeQueueing.test.ts` | Admins mailed their own change-request |
| The admin push reaches ADMINS | `proposalMessageRoutes.test.ts` — assert the recipient set | Pushing the lead about their own message |
| The author is excluded | `proposalMessageRoutes.test.ts` — a lead who is also an admin | Self-notification |
| `request_changes` pushes exactly once | `proposalWriteRoutes.test.ts` — count **`sendPushMock`** calls on the transition, the mechanism the suite already uses (`:39` mocks `@/app/utils/push`; `:710` and `:946` assert on it). **Do NOT add a wholesale `serviceMutationSideEffects` mock** — no suite in the repo has one, `notifyProposalReview` runs through to `sendPush` for real, and mocking the module would make the existing negative assertions at `:796`, `:892` and `:969` pass vacuously, retiring three push guards on the delivery whose subject is push fan-out | A double push from adding a second call site — or the guards being silently vacated by the fix |
| A `draft` message pushes nothing | `proposalMessageRoutes.test.ts` | Notifying admins about work not in front of them |

**Suites that will break:** `outboxSweep.test.ts`,
`serviceMutationSideEffects.test.ts`, `proposalNotify.test.ts`,
`setlistNoticeQueueing.test.ts`, `proposalWriteRoutes.test.ts`, and
**`notificationOutboxSchema.test.ts`** (`:49-54` pins `before`'s field names to
exactly `["beforeNotes","beforeRoles","beforeSongs"]`; adding `beforeMessageCount`
makes the set **four**, since `beforeNotes` is kept). Two types enumerate those same
three fields and both gain the new one — `UpsertInput.before` (`outboxNotice.ts:78`)
and `StoredNotice.before` (`outboxSweep.ts:141`); `tsc` catches both.

**`outboxClassify.test.ts` does NOT break** — it gains coverage for
`classifyProposalMessages` while its existing `classifyLeadNotes` assertions
(including `:123-125`) stay green and unchanged, because that function survives.

**The OQ-3 subject change breaks exactly one assertion:** `outboxSweep.test.ts:1149`,
the only place that subject is asserted. `notificationEmail.test.ts` asserts subjects
only for `assigned` (`:26-37`), and `emailTemplateGallery.test.ts`'s two "Notas del
líder" occurrences are a gallery entry *title* (`:127`, a literal, unaffected) and an
assertion on `13-proposal.html` (`:241`), which is `proposalNotify`'s section label
rather than the outbox subject. Neither breaks.

**E2E, which CI does not run** (`ci.yml:6-7`) and which therefore surfaces late:
`e2e/service-readiness/proposal-lifecycle.spec.ts:104` asserts
`afterRequest?.admin_notes` contains the change-request note — this child removes
that write — and `scripts/lib/sr-verification.mjs:938` seeds the same field.
**Owner: Phase B**, alongside the write removal that breaks them. Child A's Phase E
already edits `:104` for its own reason; if A has shipped, B is amending that edit
rather than making it. Phase C is docs-only and must not inherit this.

## Safe ending state and rollback

**Safe ending state:** the thread is the sole source for both notification
directions; the legacy fields are a frozen archive nothing writes.

**Rollback: revert the code**, which restores the mirror going forward and returns
the email to reading `lead_notes`. Run the backlog pre-check first (§The cutover
seam). **What revert does not recover:** messages posted while Child B was live were
not mirrored, so `lead_notes` is stale until the next post refreshes it — the *email
body* regresses, not the thread, which Child A still renders in full. No message is
lost.

**`admin_notes` has the same staleness and one consequence `lead_notes` does not:** a
revert restores the transition's `admin_notes` write, and
`e2e/service-readiness/proposal-lifecycle.spec.ts:104` plus
`scripts/lib/sr-verification.mjs:938` read it again — so a revert must also revert
those two edits, or the e2e asserts against a field the reverted code has started
writing from a different starting value.

That asymmetry is why Child B ships second: its worst case is a stale email, not
missing history.

## Open questions

| # | Question | Recommendation | Blocking? |
|---|---|---|---|
| OQ-1 | ~~Ministry-filter the admin audience?~~ | **RESOLVED 2026-08-25: its own independent delivery.** Frank's call. It is a pre-existing defect across every proposal notification, not something this child introduced, and scoping it correctly means touching `proposalNotify`, `outboxSweep` and the kids surfaces together. This child neither fixes nor worsens the rule; it inherits whatever the audience is at the time. Tracked as FrankERP/owt-kb-v1#8 | Closed |
| OQ-2 | ~~New admin-push helper, or inline `sendPush`?~~ | **DECIDED: inline `sendPush` in the lead messages route.** There is one caller, and a helper wrapping a one-line fan-out would be a third place the admin audience is written down — `ADMIN_RECIPIENTS_QUERY` and `proposalNotify.ts:143` already duplicate it with no sync guard. Exporting the query and calling `sendPush` directly adds no fourth copy | Closed |
| OQ-3 | ~~Does the `leadNotes` email subject change?~~ | **DECIDED: yes, to "Mensajes de la propuesta", in Phase B.** "Notas del líder" is wrong once the thread carries admin replies | Closed |

## Terminal state

`READY_FOR_ADVERSARIAL_REVIEW` — all three open questions are closed.

Review order: the parent, then Child A, then this. Plan approval is not
authorization to implement.
