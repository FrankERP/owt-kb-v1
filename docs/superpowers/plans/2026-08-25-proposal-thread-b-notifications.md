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
- `classifyProposalMessages` as the sweep's classifier for `{beforeMessageCount}`
  notices. **`classifyLeadNotes` is NOT removed** — it keeps the sweep's legacy branch
  (§Outbox) and leaves with it in a follow-up;
  `PROPOSAL_QUERY` narrowed and exported.
- `notificationOutbox.before` gaining `beforeMessageCount`.
- `proposalNotify`'s "Nueva propuesta" body source.
- The lead→admin push on **`approved`**, and the admin→lead push for standalone
  messages. **Both inherit whatever admin audience exists at the time** — this child
  does not own the ministry-scoping question (OQ-1).
- Exporting `ADMIN_RECIPIENTS_QUERY`. **`REVIEWABLE_BEFORE_WRITE` is NOT exported** —
  the predecessor's contract said the lead messages route needed it to choose
  push-vs-email, but the resolved gate is `status === "approved"`, so nothing imports
  it. It stays module-private.
- **Removing the mirror** — `lead_notes` / `admin_notes` stop being written.

### Out

Everything Child A owns. No schema migration. No new writer. No UI beyond
notification-adjacent copy.

### Explicitly not in this delivery

Unread indicators; unsetting the legacy fields; a new `notificationOutbox` kind;
any new email.

## Design

### The projection — stated once, here

**Both new reads interpolate ONE exported fragment.** Not "both use the same shape" —
an earlier draft said that, and the shape was then written out separately in each
query, which is three copies of the predicate (two GROQ, one JS) with only two of them
pinned to anything.

```
// exported, one definition
export const LEAD_NOTE_MESSAGES = `messages[kind == "lead_note"]{kind, body}`;

// PROPOSAL_QUERY, in full
*[_type == "setlistProposal" && _id == $proposalId][0]{
  _id, status, service_date,
  "leadMessages": ${LEAD_NOTE_MESSAGES}
}
```

`proposalNotify`'s read — `SUBMITTED_NOTIFY_QUERY`
(`proposalNotifyQueries.ts:54`), extracted from an inline literal by Phase A —
interpolates the same constant. **The predicate now
exists exactly twice**: this fragment, and the JS copy the queue side applies.

`status` and `service_date` must survive `PROPOSAL_QUERY`: the classifier needs
`status` for `reviewable`, and the live-date-wins rule (`outboxSweep.ts:381`) needs
`service_date`. **`lead_notes` does NOT** — nothing in the SWEEP reads it after B, the
legacy branch included, which classifies against the thread (§Outbox). Scoped to the
sweep deliberately: `me/proposals/route.ts:207` still reads the stored field to
snapshot `beforeNotes`, and must, or `beforeNotes` becomes `""`, the old sweep sees
`"" ≠ live lead_notes`, and it mails the stale archive — the failure this design exists
to prevent.

- **The filter is there so one predicate is applied once**, not for payload. Filtering
  by `kind` does not move the worst case, which is still 200 × `PROPOSAL_NOTES_MAX`
  when every message is a lead note.
- **The narrowing is the payload win** — `{kind, body}` drops `_key`, `author` and
  `at` from an array read on a deadline-budgeted sweep, and on a path `await`ed
  inline on the member's save request.
- **`kind` is projected** so the shape is uniform and a `.filter()` added later
  still matches. Nothing reads it.
- **Consumers of THIS projection must NOT re-filter.** The array arrives pre-filtered;
  the classifier's parameter is named `leadMessages`, not `afterMessages`, and
  `proposalNotify` takes the **last element of the pre-filtered array** in JS — not a
  second `kind` filter, and not a GROQ negative index.
- **The queue side is not a consumer of this projection** and applies the predicate
  itself, in JS, over `PROPOSAL_PROJECTION`'s full `messages` array (§Outbox).
- **The two remaining copies are CROSS-PINNED.** Export the JS `kind === "lead_note"`
  test, have the queue side call it, and assert in one place that filtering a mixed
  fixture with it yields the same `body` sequence the `groq-js`-executed fragment
  returns. **Compare bodies, or map both sides to `{kind, body}`** — the GROQ side
  returns `{kind, body}` while the JS side holds whole message objects
  (`{_key, _type, author, author_role, kind, body, at}`), so a naive deep-equal cannot
  be written. Child A recorded why this matters: "Two suites each pinning their own
  hardcoded list is what let `_type` ship on one side only with `npm test` green" (§3).
- **GROQ returns `null`, not `[]`,** when `messages` is absent. Coerce at each call
  site. (`outboxSweep.ts:384` coerces the same GROQ `null` for a *string* field — the
  same reflex, not the same type.)

**The guard is execution, not this paragraph.** `outboxSweep.test.ts:244` routes the
proposal query to a hand-written literal (`:1143`) and nothing compares the two, so a
fixture cannot catch the projection drifting. **Phase A** exports the fragment and
both queries (see Phases), and the verification runs the fragment with `groq-js` — already a
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
Unconditionally. The create branch already mints `messages: [msg]` when a note is
present — that is Child A §4; B only removes the `lead_notes` write beside it. The transition stops setting `admin_notes`. The message routes stop
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
(`proposalMessageWrite.ts:158` on this plan's branch; `:128-129` on
`feat/proposal-messages-migration`, which already carries Child A Phase A's `_type`
addition) so `tsc` backstops it, but the rule is stated
rather than left to the type. **Keep Child A's negative test too**, not only the
positive one — and **extend it**: a save carrying no `leadNotes` appends nothing **and
queues no notice**. Post-B those are independent, because dropping `afterNotes`
removed `queueLeadNotesNotice`'s own trimmed-equal guard and left the callers holding
it alone. A spurious notice is bounded (it classifies to `null` and is consumed) but
it resets `servedRecipients` and slides a real debounce. Removing the field from
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
the function's own trimmed-equal early return (`serviceMutationSideEffects.ts:658`) —
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
early on `before.trim() === after.trim()` (`serviceMutationSideEffects.ts:658`), which
is why Child A §1 lists "a repeated identical message sends no email" as an accepted
gap. Dropping `afterNotes` removes that comparison, so a repeat now queues and emails.
An improvement, and intended — but it is a behaviour change against a sibling's stated
baseline, so Child A's gap list is **superseded** here rather than contradicted.

`LineKind`, `LINE_PREF.leadNotes`, `NOTICE_KINDS` and the stored `kind` value
`"leadNotes"` are **all unchanged** — renaming the wire value would orphan
in-flight documents for no benefit. Only the meaning changes.

**In-flight legacy notices are CLASSIFIED, not dropped — against the THREAD, not
against `lead_notes`.**
`typeof notice.before?.beforeMessageCount !== "number"` ⇒ hand the notice to the
surviving `classifyLeadNotes` with `before` = `notice.before.beforeNotes` and
**`after` = the newest `lead_note` body** (empty when there is none). `typeof`, not
truthiness — `beforeMessageCount: 0` is the legitimate first-message case and takes
the new path.

**Why `after` is the newest message and not the live field.** Post-B nothing writes
`lead_notes`, so comparing against it compares a snapshot to a **frozen** value. That
matters because `before` is written only by `createIfNotExists`
(`outboxNotice.ts:127-146`) and the notice id is deterministic per proposal
(`serviceMutationSideEffects.ts:661`): a notice minted by pre-B code keeps its legacy
shape for its whole ≤60-minute window **even as B's route queues onto it**. Compared
against a frozen field it would email the pre-release message and silently swallow
every message appended after — the exact "loses a real message with no signal"
property that made dropping unacceptable, reintroduced one layer down. The newest
`lead_note` body is precisely what the mirror used to hold, so this branch reproduces
today's semantics exactly: one email carrying the lead's most recent word.

**Two consequences.** `lead_notes` therefore does **not** need to survive in
`PROPOSAL_QUERY` — the branch reads the thread like everything else. And an earlier
draft's plain "drop" is rejected for the reason above: safe (`classifiedIds.add`
precedes classification, `outboxSweep.ts:728`; `partitionClaimed` routes to
`toConsume`, `:500-532`; the `finally` at `:871` deletes via `consume` at `:882`) but not correct, because a
notice classified to `[]` contributes no pending recipients and `countLost` (`:884`)
reports nothing.

**One named low-probability case:** a legacy notice with a non-empty `beforeNotes` on a
proposal with **zero** `lead_note` messages gives `before = "X"`, `after = ""`, which
differs — so `classifyLeadNotes` returns a line with `notes: ""` and `renderLine` emits
a `leadNotes` section with nothing in it (`notificationEmail.ts:183`). Child A's Phase D
step 9 is designed so that combination does not exist. Named rather than guarded.

The branch, the legacy `beforeNotes` field and `classifyLeadNotes` leave together in a
follow-up, once no legacy notice can exist — provable rather than assumed.

**`proposalNotify.ts:138-141`** takes the body of the newest `lead_note` message,
empty when there is none, under §The projection's rules. Semantic drift to accept:
today `lead_notes` on submit is what the lead saved *with that submission*; the newest
message may be days older. Still their most recent word — but the framing must not
imply "notes attached to this submission".

**Redeploy the Sanity schema** — `notificationOutbox` gains a field. The Content
Lake stores undeclared fields so nothing breaks without it, but the manifest would
be stale.

### The cutover seam

**The window is not a deploy — it is the whole preview→main release, and both
versions share one dataset.** CLAUDE.md mandates: merge to `preview`, push, verify the
dev alias, *then* open the PR, wait for `gates`, merge. For that entire span `preview`
runs Child B while production runs the old code, and **`preview` writes the REAL Sanity
dataset**, which is where `notificationOutbox` lives. `commitUpserts` sweeps inline
(`serviceMutationSideEffects.ts:513`) and `DUE_NOTICES_QUERY` (`outboxSweep.ts:179`)
selects every due notice in the dataset with no environment scoping. **Precisely:** a
write reaches `commitUpserts` only through a `queue*Notice` `after()` block, so it is a
write that *commits an outbox upsert* that sweeps — narrower than "every write", and
still enough, because the walkthrough Phase B schedules is exactly such a write — so **any write through `preview` runs B's sweep over
production's outbox.** Reasoning about "a still-warm instance" would understate this by
orders of magnitude.

Two directions. **One is closed by mechanism; the other only by procedure** — and
saying so plainly is the point, because an earlier draft claimed both were mechanical:

**New route queues, OLD sweep flushes — no stale text, but a silent message.** This is
the case the parent carries. A message posted through `preview` queues a notice
carrying `beforeNotes` = the stored `lead_notes` snapshotted pre-commit. Production's
old sweep reads `notice.before?.beforeNotes ?? ""` (`outboxSweep.ts:383`) and compares
it against the live `lead_notes`. **The two agree because the NEW route did not
mirror** — not because production is still mirroring — so `classifyLeadNotes` returns
`null` (`outboxClassify.ts:103`).

**That is a real loss, and the plan does not pretend otherwise.** The notice yields no
pairs, `partitionClaimed` routes it to `toConsume` (`:500-532`), the `finally` deletes
it (the `finally` at `:871`, via `consume` at `:882`), and `countLost` (`:535`, called at `:884`) counts nothing because no
pending entry exists for it. No email, notice destroyed, `report.lost` silent — the
exact property §Outbox calls unacceptable when it rejects drop-and-consume. The parent
names it in the same terms (roadmap, "the residual is silence, not staleness").

**Nothing in the mechanism prevents it; release-procedure step 3 does** — and that
step holds even when the pre-check has just returned zero, because the notice at risk
is one this window creates, not one the check could have seen. Keeping `beforeNotes`
still earns its place: it is what makes the failure *silence* rather than a stale-text
email, and it closes the seam identically on a **revert**.

**OLD route queues, new sweep flushes — closed by mechanism.** B's sweep classifies a
legacy notice against the thread rather than dropping it (the rule and its reasoning
are in §Outbox; not restated here). Nothing is lost in this direction, including
messages appended onto a legacy notice after the release.

**This supersedes a decision in the approved parent.** The parent's two seam bullets
accepted the seam and specified drop-and-consume, justified by a notice "queued
minutes before B's deploy". The window is not minutes, so that premise is false and
**both** bullets were corrected in the same delivery, and the corrections are recorded
in the parent's review log under "Corrections made during Child B's review", replacing
its standing "Child B drop-and-consumes" entry. A child may not silently outperform
**or silently undershoot** an invariant its parent declares — and this child does both:
better than the parent on the mechanism direction, worse on the procedure one.

### Release procedure (Phase B)

Child A's Phase D carries an equivalent list; B needs its own because it is B's code
that meets production's outbox.

0. **Gates green, then a FRESH CODE REVIEW of `main...feature`** — the range the PR
   merges, not this plan. Fix what it finds, then **re-verify the fix** (a scoped
   review of the fix range plus a gates re-run on the final tree). CLAUDE.md states
   this in capitals for production releases and makes it auditable: the last entry
   before a merge must be a verification, not a fix. Child A's Phase D carries the
   same step; an earlier draft of this list restated CLAUDE.md's alias checks and
   dropped this one.
1. **Pre-check:** `count(*[_type == "notificationOutbox" && kind == "leadNotes"])`
   must be `0`. If it is not, wait for the sweep to drain it — do not proceed, and do
   NOT delete notices by hand. Production holds zero at rest, so this is normally a
   no-op; it bounds the pre-cutover backlog, a different hazard from the window.
2. Merge into `preview`, push, and **verify the dev alias moved** — the target domain
   in the deployment's `alias` array and `meta.githubCommitSha` equal to the pushed
   commit. A green build is not this check.
3. **Do not post a thread message through `preview` yet — and do not relax this
   because step 1 found the outbox empty.** A message posted here mints a notice that
   production's old sweep classifies as unchanged, so it is consumed with no email and
   `report.lost` stays 0. The pre-check cannot see a notice this window has not created
   yet. A write through `preview` also sweeps the production outbox, which is why Child
   A defers its own walkthrough. Phase B's walkthrough runs *after* step 5.
4. Re-run the same pre-check — same query, same `0`, same "wait, never delete" — then
   open the PR, wait for `gates`, merge.
5. Verify the production alias the same way as step 2.
6. Walkthrough on `preview`, which writes REAL data and emails the REAL team.

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

- **Disposal: `fireAndForget`** — exported by Phase A
  (`serviceMutationSideEffects.ts:128`; it was module-private) — as
  `notifyProposalReview` uses it (`serviceMutationSideEffects.ts:770`), not a bare `void` like
  `proposalNotify.ts:150`. **The reason is rejection handling, not latency:** the push
  fires only on `approved`, where `queueLeadNotesNotice` returns on the `REVIEWABLE_BEFORE_WRITE` guard and no sweep
  runs, so an earlier draft's "~14 s inline sweep" argument does not apply on this
  path. The two precedents disagree, so the choice is made here.
- **`<Autor>`** is the author name the message route has already resolved for its own
  response (Child A §5) — **not a second read**.
- **`adminIds`** from the exported `ADMIN_RECIPIENTS_QUERY`, author filtered out.
  That query carries no ministry or active-member filter, and Phase B makes this its
  third consumer. **Inherited unfiltered — the rule, not a copy of it: Phase A collapsed the two
  copies into this one constant — and not introduced here** — it is part of FrankERP/owt-kb-v1#8 (OQ-1), and is recorded so a
  later reviewer does not re-litigate it as new.
- **`path: "/admin"`**, matching the existing admin push (`proposalNotify.ts:153`).
  `notifyProposalReview` hardcodes `/me`, which is the lead's surface and wrong here.
- **`<fecha>` is rendered at local noon** — `new Date(iso.slice(0,10) + "T12:00:00")`,
  the CLAUDE.md invariant; a bare `new Date(iso)` day-flips in America/Mexico_City.
  There is no shared util. The formatting precedent to copy is `proposalNotify.ts:45`;
  the precedent NOT to copy is `assignmentPush` (`serviceMutationSideEffects.ts:152`),
  which interpolates the raw stored value into a push body with no rendering at all.
  This is not the first push body to carry a service date — it is the first to render
  one correctly.
- **The copy must be new.** Reusing `REVIEW_PUSH.request_changes` would push
  "Cambios solicitados — Revisaron la propuesta y pidieron cambios" when an admin
  merely asked a question.

**Do not reach for `notifyProposalReview` when the recipients are ADMINS.** Its
audience is lead + contributors. It *is* the right helper for the two rows whose
recipient is the **lead** — read who receives, not the arrow's direction. Its `path`
is `/me`, the member home, not the proposal surface `/me/propose/[roleId]` that
`proposalNotify.ts:162` uses for co-leads: inherited and left as is, but looser than
the `/admin` the lead→admin row specifies.

**Exclude the author from BOTH pushes — one stated mechanism each.** A lead who is
also an `admin` would otherwise be pushed about their own message, and the hazard
exists in both directions: `proposalReviewRecipients` does not filter, and
`ADMIN_RECIPIENTS_QUERY` has no author filter either.

- **admin → lead:** add an **optional third parameter** to `notifyProposalReview`,
  `excludeIds?: readonly string[]`, and pass the author. **Apply the filter BEFORE
  the empty-audience guard** (`serviceMutationSideEffects.ts:768`) — otherwise a
  proposal whose only recipient is the author passes the guard and pushes them.
  "Filter in the route" is not implementable: the helper resolves its own recipients
  internally and exposes no hook (`serviceMutationSideEffects.ts:762-771`), so a
  route-side filter would mean re-implementing `proposalReviewRecipients` +
  `sendPush`, a second copy of the audience rule. **Adding the parameter changes
  neither existing call site**: both pass exactly two arguments
  (`admin/proposals/[id]/route.ts:379`, `:532`).
- **lead → admin:** filter the author out of `adminIds` in the route, before
  `sendPush`. There is no shared helper to extend there.

`REVIEWABLE_BEFORE_WRITE` and `REVIEWABLE_STATUSES` are **unchanged and stay
module-private** (Phase A says so once, for both) — the email
keeps today's audience and timing. The push is a separate additive call, fired only
when the status is **`approved`** — necessary and sufficient, matching the table row
and the `draft` verification. ("A status the outbox will not cover" is a *necessary*
condition only; read as sufficient it would push on `draft`.) **One signal per
message, never both.**

**These pushes are not debounced.** N messages, N pushes. Acceptable at this team's
volume; if it becomes noise the fix is a push debounce, not a wider email.

**Preference axis:** `sendPush` gates on `notifPrefs.proposals` via `optedIn`,
**not** on `wantsNotification`, which reads `emailProposals`. Independent. Do not
"unify" them here.

**Accepted gap:** a lead posts while `pending` → a notice is queued and no push
fires. If an admin approves inside the 15–60 min debounce, the flush finds
`REVIEWABLE_STATUSES.has("approved") === false` (`outboxSweep.ts:387`), classifies
to `null`, and consumes it. No email, no push. Rare, non-destructive, and closing
it would mean firing a push the email was meant to cover or widening the flush
gate. Named rather than fixed.

**Knowing what queuing costs:** `commitUpserts` also runs `sweepOutbox`
unconditionally, so posting can send another member's pending email inline. The
messages route is a latency-variable path; the tests must not assume queuing is
cheap.

**Email body size, bounded but named:** `notes` becomes a join of every lead message
appended within the window, not a single ≤`PROPOSAL_NOTES_MAX` note. The bound is the
60-minute `deadline` and, absolutely, `PROPOSAL_MESSAGES_MAX` × `PROPOSAL_NOTES_MAX` =
200 × 4000 ≈ **800 KB in one HTML email** — a ceiling no realistic window reaches, but
the honest one. **Not** `outboxSweep.ts:619-625`, which an earlier draft cited here:
that guard is `recipients.length > emailLimit`, a recipient-count rule unrelated to
body size (criterion 4a uses it correctly). No new guard is proposed; the ceiling is
stated so it is a decision rather than an oversight.

**Volume — B's increment is narrow, and the big shift is Child A's.** The move from
"the notes field changed on a save" to "a lead posted a message" lands with **Child
A**, whose messages route already calls `queueLeadNotesNotice` on every lead message;
the parent assigns that risk there explicitly and says to watch `report.lost` after
**A's** release (roadmap `:123-128`). **B's own increment is one thing:** dropping
`afterNotes` removes the trimmed-equal guard, so a repeated identical message now
queues where today it does not. Production runs `NOTIFY_FLUSH_EMAIL_LIMIT=2` against a
measured 14 413 ms/send, so watch `report.lost` after both releases — but B is not
where the occasions multiplied.

## Phases

Every phase ends with `npx tsc --noEmit`, `npm test`, `npx eslint .` at 0 errors.

### Phase A — Exports and the pure classifier

- Export, in one place each: the **`LEAD_NOTE_MESSAGES` GROQ fragment** and the **JS
  `kind === "lead_note"` predicate** (§The projection cross-pins them);
  `PROPOSAL_QUERY`; `ADMIN_RECIPIENTS_QUERY`; `fireAndForget` (was module-private;
  **exported by Phase A**, `serviceMutationSideEffects.ts:128`, for the inline push); and
  **`proposalNotify`'s proposal read**, today an inline composite template literal
  — **DONE in Phase A**: extracted as `SUBMITTED_NOTIFY_QUERY`
  (`proposalNotifyQueries.ts:54`) and already executed with `groq-js` by
  `leadNoteProjection.test.ts`.
  **Not `REVIEWABLE_BEFORE_WRITE` and not `REVIEWABLE_STATUSES`** — both stay
  module-private. The predecessor's contract had the lead messages route importing the
  first to choose push-vs-email, and inherited advice said to relocate the second to
  avoid an import cycle (`serviceMutationSideEffects.ts:71` already imports
  `sweepOutbox`). The resolved push gate is `status === "approved"`, so **nothing
  consumes either** and the cycle never arises. They remain semantically different
  predicates (before-write vs at-flush) that coincide today.
- `classifyProposalMessages` beside `classifyLeadNotes`, unused.
- **Verification:** gate + unit tests. No behaviour change.

### Phase B — The notification cutover (one deploy)

Splitting this produces either a dead notification or a mass mis-send.

- Input shape, both call sites, both narrowed reads (§The projection), the
  legacy-shape **tolerance branch**, `proposalNotify`'s body source.
- Both pushes.
- **The mirror is removed in this same deploy**, including `POST /api/me/proposals`
  ceasing to write `lead_notes` in both branches and the transition ceasing to set
  `admin_notes`.
- **Copy:** the `leadNotes` subject → "Mensajes de la propuesta" (OQ-3). `SUBJECT`
  (`notificationEmail.ts:18`) feeds **both** the subject line and the in-body header via
  `headerLine` (`:32`, used at `:176` and `:196`), so this is one constant and two
  visible strings, not a subject-only change. And the
  member-facing preference hint at `app/components/ui/EmailPrefToggles.tsx:68`
  ("Notas del líder y propuestas nuevas.") → "Mensajes de la propuesta y propuestas
  nuevas." Same phase as the write removal: it is the toggle that gates the mail whose
  body is changing.
- **The release procedure** in §Release procedure, in order — including the two
  outbox pre-checks and both alias verifications.
- Redeploy the Sanity schema.
- **The e2e edits** below, which CI does not run.
- **Verification:** gate + the table below, then the walkthrough at **step 6** of the
  release procedure — after the production release, not before it, because a write
  through `preview` sweeps the production outbox.

### Phase C — Docs

`docs/NOTIFICATIONS.md` (+ both pushes and the new body source);
`docs/API_REFERENCE.md`; `docs/DATA_MODEL.md:184`, which still describes `lead_notes`
as the live "Notas del líder" when this delivery makes both legacy fields write-free
archives; `docs/superpowers/specs/2026-07-27-service-notification-emails-design.md:774`,
which still describes `emailProposals` as gating "Notas del líder" (`:585` in the same
spec and `docs/superpowers/plans/2026-07-27-service-notification-emails.md:1399` carry
the old subject too, but both are historical records of a shipped delivery and are
deliberately left alone); the parent roadmap
marked delivered.

## Acceptance criteria

1. A lead's message on `pending`/`changes_requested` produces the same email
   admins get today — same audience, same debounce, same preference key — with the
   body from the thread — "same" meaning that enumeration, not byte-identity, since
   Phase B changes the subject (OQ-3). **No acceptable manual check reaches this**:
   production has zero proposals in `pending` or `changes_requested`, so reaching the
   path by hand would mean submitting a real proposal on `preview`, which writes the
   real dataset and emails the real admin team. **It rests on two suites:** `setlistNoticeQueueing.test.ts` proves the
   queue side, and the `outboxSweep.test.ts` rows below prove the thread-sourced body.
   **The audience and the preference key are pinned by two EXISTING assertions, in
   different suites.** Audience: `outboxSweep.test.ts:1143-1150`, which emails two
   admins — in a suite this delivery breaks, so carrying it forward is a Phase B task.
   Preference key: **`outboxClassify.test.ts:151`**, which pins
   `LINE_PREF.leadNotes === "proposals"` and stays green — **not** `:1143-1150`, whose
   fixture uses `notifPrefs: {}` against an opt-out default of true
   (`notifyPrefs.ts:25-30`), so any key or none passes it. None of the rows below
   asserts either. "Same audience" is not assertable at
   queue time at all — the notice stores `knownRecipients: []` and the admin set
   resolves at flush (`outboxSweep.ts:257`).
   Named under parent invariant 8, as Child A names the same gap for itself.
2. A lead's message on an `approved` future-dated proposal reaches admins by push.
3. An admin's standalone message reaches the lead by push; a `request_changes`
   produces **exactly one** push.
4. **No message produces both an email and a push**, scoped to **B's own signals** —
   the `leadNotes` outbox email versus the two new pushes. Stated as email-XOR-push
   rather than "never notified twice", because the outbox's re-pend path can
   legitimately re-send a joined body. **Three exceptions, all named:**

   **(a) The send-budget re-pend** (`outboxSweep.ts:851-861` with `:525-528`) — not
   `emailLimit`; an oversized notice is selected alone and deliberately exceeds the
   budget rather than splitting (`outboxSweep.ts:619`). Across those sweeps a new message clears
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

   **(c) A re-submit, which is outside B's scope and unchanged by it.** A save
   committing `pending` fires `notifyProposalSubmitted`, which pushes admins
   (`proposalNotify.ts:150`) **and** emails them a notes block (`proposalNotify.ts:184`) that post-B is
   the newest `lead_note`. So a message posted while `changes_requested`, followed by
   a re-submit, reaches admins by push and by email. Identical to today's behaviour in
   every respect — the body's source changes, the fan-out does not — which is why the
   criterion is scoped to B's own signals rather than to every notification the app
   sends.
5. `lead_notes` and `admin_notes` are byte-identical to their values at the end of
   Child A. Nothing blanks them.
6. **Legacy notices queued by PRODUCTION's route are classified against the thread
   and emailed with the lead's most recent word** — the semantics the mirror produces
   today — never dropped, never crashing the sweep. Stated of that direction only, and
   deliberately **not** as "no message from either version is lost": a message posted
   through `preview` before production serves the new code is consumed silently (§The
   cutover seam). No stale content; one silent message; release-procedure step 3 is the
   whole mitigation.
7. **No stale content is emailed during the deploy window** (parent roadmap
   `:259-264`), by the mechanism in §The cutover seam.

## Verification

| Requirement | Test | Failure it detects |
|---|---|---|
| **Neither branch of `POST /api/me/proposals` writes `lead_notes`, and the stored value survives** | `proposalWriteRoutes.test.ts` — assert absence of the key on BOTH the patch and the **create** payload, then re-read a document that has a value and show it byte-unchanged. The create branch is exercised (`:425`, `:458`, `:495`) but only through `toMatchObject`, which cannot see a surviving field — it needs an explicit `expect(created).not.toHaveProperty("lead_notes")`, the form `:703` already uses on the setlist create | A half-removed mirror: the create path still seeding a field nothing maintains |
| **The transition stops setting `admin_notes`** | `proposalWriteRoutes.test.ts` — the transition `set` has no `admin_notes` key | Silently blanking the admin archive, which an empty `reopen` does today |
| **The notice carries BOTH snapshot fields, on BOTH call sites** | `setlistNoticeQueueing.test.ts` — same id, kind and timing as today, **and `before` asserted explicitly**: `beforeNotes` equal to the stored pre-commit `lead_notes`, `beforeMessageCount` equal to the pre-commit `kind == "lead_note"` count — **on a fixture whose thread carries at least one `admin_change_request`.** Without that the row passes by construction: on an all-lead-note thread `count(all) === count(lead_note)`, so a queue side counting the whole array satisfies it. The failure it must catch is total: with `T` total and `L` lead notes pre-commit, `leadMessages.slice(T)` over a post-commit array of length `L+1` is **empty whenever `T > L`** — every admin stops receiving the debounced email on exactly the proposals that have been through a review cycle, `null` classification, notice consumed, `countLost` (`outboxSweep.ts:884`) at 0, every test green. Mixed threads are the NORMAL shape of a `changes_requested` proposal: Child A's migration mints an `admin_change_request` for every document carrying `admin_notes`, and the transition appends one on each `request_changes`/`reopen`. On the compat path (`:717` already pins `beforeNotes`) **and on the lead messages route, which has no such pin today**. Not audience — not assertable at queue time (criterion 1). **This row is what protects the cutover seam**, because the seam is closed by the queue writing `beforeNotes` | Retiring the debounced email by refactor; or a later cleanup dropping `beforeNotes` as dead weight because nothing pinned it |
| **The cutover seam end-to-end** | `setlistNoticeQueueing.test.ts` — queue through the **new** route, then pass the resulting notice's `before.beforeNotes` and the unchanged stored `lead_notes` to `classifyLeadNotes`, expecting `null`. **The fixture's stored `lead_notes` must be NON-EMPTY** (`setlistNoticeQueueing.test.ts` already uses `"Nota original"`) — with an empty one both sides are `""` and the row passes whether or not the route wrote anything. Composes the row above with the surviving pure function, so it fails if the route stops writing the field. **A bare `classifyLeadNotes({before:"x", after:"  x  "}) === null` is NOT this row** — `outboxClassify.test.ts:130` already makes it, and it passes whether or not the route writes anything | Criterion 7 regressing to a stale-content email during a deploy |
| An old-shape save lands and queues | `setlistNoticeQueueing.test.ts` — a save carrying `leadNotes` appends a message and produces an outbox document | A pre-Child-A bundle's note discarded behind a success toast |
| **A `{beforeMessageCount}` notice classifies and emails** | `outboxSweep.test.ts` — **execute the exported `PROPOSAL_QUERY` with `groq-js`** over a `setlistProposal` carrying both `lead_note` and `admin_change_request` messages, feed the result to `classifyProposalMessages`, and **assert the resulting `notes` equals the lead bodies exactly** — not merely "non-empty", which still passes if someone drops the `[kind == "lead_note"]` filter, misaligning `slice(beforeCount)` and mailing admins their own change-request text | The flush path silently classifying to `null` — the debounced email dying with every other check green |
| **The submit email's body is the lead's last word, not the admin's** | `proposalNotify.test.ts` — **a fixture whose NEWEST message is an `admin_change_request`**: assert the notes block equals the lead's last `body` and does **not** contain the admin's text. `:186` alone is `expect(html).toContain("Notas del líder")` — the section label, rendered whenever `notes` is non-empty (`proposalNotify.ts:62`) — so on an all-lead-note fixture it passes even if the filter is missing entirely. **This is the twin of the count row's defect**, and this path is worse: `notifyProposalSubmitted` fires on every save committed `pending` (`me/proposals/route.ts:298-306`), so a re-submit from `changes_requested` is routine, and the newest message there IS the transition's change request. Execute the fragment with `groq-js` here too | Child A criterion 6's guarantee (the email "always fires … with the notes block it would have had") silently becoming an empty block |
| **A legacy notice is CLASSIFIED against the THREAD** | `outboxSweep.test.ts` — a `{beforeNotes}`-only notice with no `beforeMessageCount`, on a proposal whose thread has gained messages **since** that notice was minted, emails the admin audience with the **newest `lead_note` body**. Two things must be asserted, and the second is the one an obvious implementation gets wrong: **(a)** an email is sent at all — a dropped notice contributes no pending recipients, so `countLost` (`outboxSweep.ts:884`) stays silent and an "it did not crash" assertion passes while a message vanishes; **(b)** the body is the newest message, **not** the frozen `lead_notes`. `before` is `createIfNotExists`-only (`outboxNotice.ts:127-146`) on a deterministic id (`serviceMutationSideEffects.ts:661`), so a pre-B notice keeps its legacy shape while B queues onto it — classify against the frozen field and every message appended after the release is swallowed | Losing a real message during the multi-hour preview→main window, with no signal anywhere |
| `beforeMessageCount: 0` is not dropped | `outboxSweep.test.ts` | A truthiness check killing the first-message case |
| Only lead messages queue a notice | `setlistNoticeQueueing.test.ts` | Admins mailed their own change-request |
| **The email-XOR-push split, pinned on BOTH branches** (criteria 2 and 4) | `proposalMessageRoutes.test.ts` — a `lead_note` on `pending` **and** on `changes_requested` produces exactly one `leadNotes` outbox upsert and **zero** `sendPushMock` calls; the same post on an `approved` future-dated proposal produces **zero** outbox upserts and exactly one `sendPushMock` call to the admin id set. **Nothing else pins this.** The four rows below assert the recipient set, the author filter, the transition count and the `draft` case — a push gated on `status !== "draft"`, or on `!REVIEWABLE_BEFORE_WRITE.has(previousStatus)` — **both wrong, and the second wrongly appeared in an earlier draft of this row as the correct gate**: that set is `{pending, changes_requested}`, so its negation includes `draft`. The gate is `status === "approved"`, nothing else. Either mistake passes every one of the rows below while double-notifying admins on the two reviewable statuses, which is exactly what criterion 4 forbids. And there is no manual fallback: production holds zero proposals in either status | The delivery's headline invariant failing silently on the only branch no human can reach |
| The admin push reaches ADMINS | `proposalMessageRoutes.test.ts` — assert the recipient set | Pushing the lead about their own message |
| The author is excluded (lead→admin) | `proposalMessageRoutes.test.ts` — a lead who is also an admin | Self-notification |
| **The admin→lead push exists, reaches the LEAD, and carries the new copy** (criterion 3) | `proposalMessageRoutes.test.ts` — an `admin_change_request` via the admin messages route calls `notifyProposalReview`, whose recipients are `doc.lead` + contributors, with title `Nuevo mensaje` — **assert the copy, not just the call**. Reusing `REVIEW_PUSH.request_changes` would push "Cambios solicitados — Revisaron la propuesta y pidieron cambios" when an admin merely asked a question, and no other row would notice | Half the conversation staying silent, or answering a question with a change-request alarm |
| **`excludeIds` is applied BEFORE the empty-audience guard** | `proposalMessageRoutes.test.ts` — a fixture whose **only** review recipient is the posting admin: assert `sendPushMock` is NOT called. This is the one case that distinguishes filter-before-guard from filter-after-guard; `serviceMutationSideEffects.ts:767` resolves recipients and `:768` returns on empty, so a filter placed after it is a no-op precisely here. The "lead who is also an admin" row above cannot catch it — it exercises the route-side filter on the other direction | An admin pushed about their own message, on the single-recipient proposal |
| `request_changes` pushes exactly once | `proposalWriteRoutes.test.ts` — count **`sendPushMock`** calls on the transition, the mechanism the suite already uses (`:39` mocks `@/app/utils/push`; `:710` and `:946` assert on it). **Do NOT add a wholesale `serviceMutationSideEffects` mock** — no suite in the repo has one, `notifyProposalReview` runs through to `sendPush` for real, and mocking the module would make the existing negative assertions at `:796`, `:892` and `:969` pass vacuously, retiring three push guards on the delivery whose subject is push fan-out | A double push from adding a second call site — or the guards being silently vacated by the fix |
| A `draft` message pushes nothing | `proposalMessageRoutes.test.ts` | Notifying admins about work not in front of them |

**Suites that will break:** `outboxSweep.test.ts`,
`serviceMutationSideEffects.test.ts`, `proposalNotify.test.ts`,
`setlistNoticeQueueing.test.ts`, `proposalWriteRoutes.test.ts`, and
**`notificationOutboxSchema.test.ts`** (`:49-54` pins `before`'s field names to
exactly `["beforeNotes","beforeRoles","beforeSongs"]`; adding `beforeMessageCount`
makes the set **four**, since `beforeNotes` is kept — **and its test title, "stores
before-snapshots as three typed fields", changes with the assertion**). Two types enumerate those same
three fields and both gain the new one — `UpsertInput.before` (`outboxNotice.ts:78`)
and `StoredNotice.before` (`outboxSweep.ts:142`); `tsc` catches both.

**`outboxClassify.test.ts` does NOT break** — it gains coverage for
`classifyProposalMessages` while its existing `classifyLeadNotes` assertions
(including `:130`) stay green and unchanged, because that function survives.

**The OQ-3 subject change breaks exactly one assertion:** `outboxSweep.test.ts:1149`,
the only place that subject is asserted. `notificationEmail.test.ts`'s two subject
assertions (`:28` `"Nueva asignación — Domingo 9 ago"`, `:37` the grouped
`"Novedades de tus servicios"`) touch neither, and `emailTemplateGallery.test.ts`'s two "Notas del
líder" occurrences are a gallery entry *title* (`:127`, a literal, unaffected) and an
assertion on `13-proposal.html` (`:241`), which is `proposalNotify`'s section label
rather than the outbox subject. Neither breaks.

**One accepted copy drift:** `proposalNotify`'s section label stays "Notas del líder"
(`proposalNotify.ts:64`) — which is exactly what keeps `emailTemplateGallery.test.ts:241`
green — while the outbox subject and the preference hint become "Mensajes de la
propuesta". A member therefore sees two names for one thread. Deliberate: renaming the
label is a third copy change with its own blast radius, and it belongs with the
follow-up that removes the legacy branch.

**`e2e/service-readiness/zero-delivery.spec.ts` needs no row for the two new pushes**, despite its
stated contract of invoking every delivery trigger: `deliveryFirewall.ts` gates at the
transport, in front of `push.ts`'s provider call, so a new `sendPush` caller cannot
bypass it. Stated so a later reader does not read the absence as an omission.

**E2E, which CI does not run** (`ci.yml:6-7`) and which therefore surfaces late:
`e2e/service-readiness/proposal-lifecycle.spec.ts:104` asserts
`afterRequest?.admin_notes` contains the change-request note — this child removes
that write. It is the **only** `admin_notes` assertion in the e2e tree.
`scripts/lib/sr-verification.mjs:938` merely *seeds* that field and nothing asserts on
the seeded value, so removing the write does not break it — post-B the fixture should
seed a message instead, which is a correctness edit rather than a repair.
**Owner: Phase B** for both, alongside the write removal. Child A's Phase E
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
`e2e/service-readiness/proposal-lifecycle.spec.ts:104` reads it again — it is the
only `admin_notes` assertion in the e2e tree, while `scripts/lib/sr-verification.mjs:938`
only *seeds* the field — so a revert must also revert those two edits, or the e2e asserts against a field the reverted code has started
writing from a different starting value.

That asymmetry is why Child B ships second: its worst case is a stale email, not
missing history.

## Open questions

| # | Question | Recommendation | Blocking? |
|---|---|---|---|
| OQ-1 | ~~Ministry-filter the admin audience?~~ | **RESOLVED 2026-08-25: its own independent delivery.** Frank's call. It is a pre-existing defect across every proposal notification, not something this child introduced, and scoping it correctly means touching `proposalNotify`, `outboxSweep` and the kids surfaces together. This child introduces no new defect class, but it does **widen how often the existing one fires** — a new per-message push fan-out over the un-scoped `ADMIN_RECIPIENTS_QUERY`, where today the audience is resolved on transitions and submissions only. Currently inert: all five `admin`/`super-admin` members have `ministries` absent, which the storage contract reads as worship. It inherits the audience rule rather than owning it. Tracked as FrankERP/owt-kb-v1#8 | Closed |
| OQ-2 | ~~New admin-push helper, or inline `sendPush`?~~ | **DECIDED: inline `sendPush` in the lead messages route.** There is one caller, and a helper wrapping a one-line fan-out would be a third place the admin audience is written down — and that duplication is now **gone**: Phase A made `ADMIN_RECIPIENTS_QUERY` one exported constant (`proposalNotifyQueries.ts:32`) that both the sweep and the submit email read, so a helper would reintroduce a second place rather than avoid a third. Calling `sendPush` directly adds no copy at all | Closed |
| OQ-3 | ~~Does the `leadNotes` email subject change?~~ | **DECIDED: yes, to "Mensajes de la propuesta", in Phase B.** "Notas del líder" is wrong once the thread carries admin replies | Closed |

## Implementation record — slice 1

**How this plan is being implemented, and under what authority.** The plan is
NOT approved and its review was stopped at round 13 (see the review log). Frank's
decision, 2026-08-26, was to implement in slices and let the DIFF review find
what plan review cannot — the evidence being that Child A's Phase A found three
defects four plan-review rounds had missed, and its Phase C diff review found
six more. **This section records that decision rather than claiming an approval
that does not exist.**

**Risk tier is unchanged: CRITICAL.** Slicing the implementation does not retier
the delivery. What changes is where the review budget is spent: a fresh code
review of each slice's diff, instead of a fourteenth plan round.

**Phase B's "one deploy" rule is intact.** It governs what reaches production
together, not how the branch is written. No slice deploys on its own; the whole
branch ships as one release, in the §Release procedure order.

### Slice 1 — the outbox source cutover (`feat/proposal-thread-b1-outbox-source`)

In: `queueLeadNotesNotice`'s input shape and both call sites;
`notificationOutbox.before.beforeMessageCount`; `PROPOSAL_QUERY` narrowed to the
thread; `classifyProposalMessages` in the sweep with the legacy-tolerance branch.

Out, deliberately, and each its own later slice: the mirror removal, both
pushes, `proposalNotify`'s body source, the subject and preference-hint copy, the
e2e fixtures, the docs sweep.

**One coupling this slice discovered, which the plan's Verification table does
not state.** The seam row — "queue through the new route, then pass the notice's
`before.beforeNotes` and the unchanged stored `lead_notes` to `classifyLeadNotes`,
expecting `null`" — **cannot be written in this slice.** It presumes the mirror is
gone; while the route still writes `lead_notes`, the stored value CHANGES and the
expectation is not `null`. The row belongs with the mirror-removal slice and moves
there. The seam is closed by the queue writing `beforeNotes`, which IS pinned
here, in three suites.

**One finding declined, with its reason.** The post-review diff review found that
the legacy branch can emit a `leadNotes` email with an empty body: a pre-cutover
notice with a non-empty `beforeNotes` on a proposal with ZERO `lead_note`
messages gives `before = "X"`, `after = ""`, which differ, so `classifyLeadNotes`
returns a line and `renderLine` emits a section with nothing under it. **This is
the case §Outbox already names and declines to guard**, and the proposed
one-liner (`if (!leadMessages.length) return [];`) reintroduces drop-and-consume
into the one branch whose rewrites produced six consecutive fix-induced defects.
Child A's Phase D step 9 is designed so the combination does not exist. Declined,
not overlooked.

### Slice 2 — removing the mirror (`feat/proposal-thread-b2-remove-mirror`)

Branches off slice 1's verified head. In: the four mirror writes — the lead
message route, both branches of `POST /api/me/proposals`, and the
`request_changes` transition's `admin_notes`; the append predicate's comparison
target; the two e2e fixtures; the docs this makes stale.

Out, still: both pushes, the subject and preference-hint copy.

**`proposalNotify`'s body source MOVED INTO THIS SLICE, and the diff review is
what forced it.** The plan lists it under Phase B without saying it is coupled to
the mirror removal. It is: the create stops writing `lead_notes`, so a submit
email still sourcing from that field renders an EMPTY notes block on every first
submission carrying a note — the one flow the field existed for — and a frozen
pre-cutover note on every resubmit, because `notifyProposalSubmitted` fires on
every save committed `pending`. `notesBlock` renders nothing at all for an empty
value, so the regression is invisible rather than obvious, and nothing caught it:
`proposalNotify.test.ts` hand-seeded `lead_notes` in its own fixture and passed
regardless of what the route wrote.

Splitting them would have created a co-ship constraint enforced by nothing but a
sentence in an unapproved plan. They land together instead.

**The append predicate's comparison target had to move, and the plan says so in
§Removing the mirror without saying why it is forced.** It compared against the
stored `lead_notes`, which was live only because this route mirrored it. Frozen,
that comparison is wrong in a way that produces duplicates: a lead who posts
through the thread and then saves compares their new text against a stale
archive, finds it different, and mints a second copy of the message they just
posted. It now reads the newest `lead_note` message.

**Two test fixtures described a document production does not have.**
`proposalWriteRoutes.test.ts` and `setlistNoticeQueueing.test.ts` both seeded
`lead_notes` with an EMPTY thread. Child A's `--apply` minted a `lead_note` for
every document carrying that field, so post-migration that shape does not exist —
and once the predicate reads the thread, a fixture without the migrated message
tests a first submission while claiming to test an unchanged note. Both now seed
the migrated message under its deterministic key.

**The seam row is now written**, in `setlistNoticeQueueing.test.ts`: queue
through the new route, then feed the notice's `beforeNotes` and the still-stored
`lead_notes` to the surviving `classifyLeadNotes` and expect `null`. Slice 1
could not write it — while the route mirrored, the stored value moved. The
fixture's stored value is deliberately non-empty, or both sides are `""` and the
row passes whether or not the route wrote anything.

**Criterion 5 is pinned rather than asserted in prose.** Three assertions now
read a stored legacy value back and show it byte-unchanged after a write that
would previously have moved it, on the patch, the transition and the message
route.

### Slice 3 — both pushes and the copy (`feat/proposal-thread-b3-pushes`)

In: the lead→admin push on `approved`; the admin→lead push for a standalone
message, via `notifyProposalReview`'s new optional `excludeIds`; the author
excluded in both directions; the `leadNotes` subject and the preference hint.
With this the delivery is feature-complete — nothing of Child B is left unbuilt.

**§Push's "not a second read" instruction IS satisfiable, and the first attempt
here got it wrong in both directions.** The name the plan points at — the one the
route resolved for its response — is the POST-COMMIT read-back, which is
deliberately guarded and null on failure, so it genuinely cannot be relied on.
The first implementation concluded the instruction was un-followable and added a
second Sanity read, which the diff review corrected: the author IS the caller, and
the session already carries a usable name. `alias` is `teamMembers.alias`; `name`
is `member_name` except on web Google SSO, where it is the Google profile name.
Neither is refreshed — both are snapshotted at sign-in. Cosmetic either way: the
push names the right person. No read at all.

That also removed a real hazard rather than just a query. The added read sat in a
`Promise.all` beside the audience read, so a transient failure on the COSMETIC
half rejected the whole thing and NO push was sent — a decorative field able to
silence the delivery. The nameless fallback remains as defence rather than for a known
trigger — NOT impersonation, whose branch sets both fields from the target — and
is pinned by a session carrying neither.

**The email-XOR-push invariant is proved by TWO suites composed, and it has to
be.** `proposalMessageRoutes.test.ts` mocks `queueLeadNotesNotice`, so the
outbox gate inside that helper is not observable there — the route calls it
unconditionally on every status. That suite pins the push and the status handed
to the helper; `serviceMutationSideEffects.test.ts` pins that those statuses
queue nothing. **Until this slice only the POSITIVE case was covered there**
(`previousStatus: "pending"`), so the half the invariant leans on was unpinned.

**Both pushes are fired INSIDE `after()`.** `fireAndForget`'s own doc requires it
of every new caller — an unawaited promise can be killed when the response
returns — and the first implementation broke that rule on both. It matters most
on the lead path: on `approved`, `queueLeadNotesNotice` returns on its status
gate BEFORE registering its own `after()`, so the push is the handler's ONLY
deferred work and nothing else holds the invocation open. The suite now mocks and
drains `after()`, with one row that asserts the push has NOT happened when the
response is written and HAS after the drain — otherwise every push assertion in
that file was passing only because the handler happened to await a read-back
afterwards, which is the coupling this fix removes.

**Neither branch of the XOR is reachable by hand**, in either direction:
production holds zero proposals in `pending` or `changes_requested`, so the email
branch cannot be exercised without submitting a real proposal on `preview`, which
writes the real dataset and mails the real admin team.

## Terminal state

`READY_FOR_ADVERSARIAL_REVIEW` — all three open questions are closed.

Review order: the parent, then Child A, then this. Plan approval is not
authorization to implement.
