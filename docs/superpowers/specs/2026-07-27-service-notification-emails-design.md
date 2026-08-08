# Service notification emails — design

**Date:** 2026-07-27
**Status:** approved (design), not implemented

## Problem

Three gaps in member-facing email:

1. **Setlist.** When a service's setlist appears or changes, members who serve
   that service get a push and no email. The proposal-approval path writes the
   live setlist and sends nothing about it at all.
2. **Role changes.** Being *added* to a published service emails the member.
   Being **removed** is silent by design (`serviceMutationSideEffects.ts` §7),
   and a **role change inside the same service** (BGV → Líder, guitarra → bajo)
   is also silent, because `addedAssignees()` diffs member ids, not seats.
3. **Lead notes on a proposal.** A lead can edit `lead_notes` — the notes only
   admins see — on a proposal already awaiting review, and no admin is told.

## The organizing idea

Every one of these is *"something changed; tell the people it affects"*, and
every one of them is produced by an admin or lead making a burst of small edits.
Sending on each edit trains the team to dismiss the emails, which costs more
than the missing notification did.

So all three share one mechanism: a **debounced outbox**. A change queues a
notice; the notice sends once its subject has been quiet for 15 minutes; a
recipient with several pending notices gets one grouped email.

## A product decision worth recording

**Unpublishing a service does not notify its participants.** From a member's
side, a service disappearing from their schedule looks identical to being removed
from it, and *"eliminado de un servicio"* is in the requirement verbatim — so
this was raised as a real question rather than assumed. The user's call is to
keep it silent, consistent with today's behaviour.

The reasoning that supports it: unpublishing is overwhelmingly *"that was wrong,
let me fix it and republish"*, not *"you are off this service"*. Notifying would
mail the team about an admin's correction. Removal from a service is expressed by
removing the seat, which does notify (§1).

## Non-goals

- Push (FCM) behaviour is unchanged everywhere. This spec is about email.
- The `false -> true` publish email is unchanged (see §7).
- No delivery guarantee and no retry. The existing best-effort posture holds,
  and duplicates are possible on two enumerated paths (§1).

## Decisions taken during design

| Question | Decision |
|---|---|
| Noise control | 15-minute sliding debounce, per subject, for all three notice kinds |
| Window refresh | Every new modification pushes the deadline out, with a 60-minute hard ceiling |
| Setlist edits | Auto-notify, debounced. No manual "Notificar al equipo" button |
| What counts as a setlist change | Songs, keys and medley grouping. `team_notes` alone does not |
| Lead notes | A change on a reviewable proposal notifies admins |
| Preferences | Five independent per-type toggles |
| Vercel plan | Hobby — one cron/day, so the sweep needs an external trigger |
| Publish | Stays immediate, outside the debounce |
| Setlist presentation | One standings table for every case — never a diff |
| Movement marker | `▲n` / `▼n` on **every** row, `–` where nothing moved |
| Movement arithmetic | Absolute position delta; a removal legitimately lifts everything below it |
| Prose | None. Header states what and when; the table carries the rest |
| Visual identity | Dark, on-brand, from `brand.css` — including the two shipped templates |

---

## 1. The outbox

A new Sanity document type, `notificationOutbox`. One document per **subject** —
the thing being debounced — holding a pending notice.

```ts
{
  _id: digestId(kind, subjectKey),  // deterministic + length-bounded; see §8
  _type: "notificationOutbox",
  kind: "role" | "setlist" | "leadNotes",
  subjectKey: string,
  memberId: string | null,  // `role` only — stored, never re-parsed from subjectKey
  roleId: string | null,    // `role` and `setlist`
  proposalId: string | null, // `leadNotes`

  // Identity, snapshotted at queue time as a FALLBACK for when the subject
  // document is gone at flush (a deleted role still owes its assignees a
  // "Ya no participas" whose subject line carries a date). Live state wins
  // whenever the document exists — see "Which source renders the date".
  serviceDate: string,     // YYYY-MM-DD
  roleType: "sunday_role" | "saturday_role" | "special_role" | null,

  before: {...},           // kind-specific snapshot, taken at the FIRST change
                           // in this window; written once, never overwritten
  firstQueuedAt: string,   // ISO instant
  notifyAfter: string,     // ISO instant, slides: last change + DEBOUNCE
  deadline: string,        // ISO instant, fixed at creation, NEVER rewritten
  status: "pending" | "sending",
  claimedAt: string | null,

  // Recipients known at queue time. A recipient absent from this set is new to
  // the subject and is introduced ("Setlist listo") rather than sent a diff.
  knownRecipients: string[],
}
```

| Kind | Subject | `subjectKey` | `before` | Recipients (resolved at flush) |
|---|---|---|---|---|
| `role` | one member's seats on one service | `${memberId}__${roleId}` | `roles: string[]` — seat labels held before | that member (1) |
| `setlist` | one service's song list | `${roleId}` | `songs: [{ref, key, group}]`, ordered — see below | that service's participants (N) |
| `leadNotes` | one proposal's lead notes | `${proposalId}` | `notes: string` | admins (N) |

Two of the three kinds are **one-to-many**: one notice discharges one email to
each of N people in a single sweep. That is why the sweep's budget bounds the
*union of recipients* rather than counting notices.

### Classifying a subject that no longer exists

`serviceDate` and `roleType` are snapshotted at queue time and never re-read.
A deleted role still owes its assignees *Ya no participas*, and both the subject
line ("— Domingo 9 ago") and the past-service-date drop rule need a date that no
longer exists anywhere else. Role ids are `randomUUID()` and encode nothing.

### Which source renders the date

One rule, because every subject line carries a date and an earlier draft stated
this three different ways:

**Live state wins whenever the subject document exists. The snapshot is used only
when it does not.** So a deleted role renders "Ya no participas — Domingo 9 ago"
from its snapshot, and everything else renders from live. Drop rules evaluate
against whichever source answered.

Date moves are then handled per kind, and the two differ for a reason:

- **`role` → re-date from live.** `PATCH /api/admin/roles/[id]` supports moving a
  service (`isMove`, `app/api/admin/roles/[id]/route.ts:141`). If a published
  service moves from Aug 9 to Aug 16 and a seat changes inside the same window,
  `before.roles` is still perfectly valid — the member and the role document are
  unchanged, only the label moved. The email reads "Tu rol cambió — Domingo 16
  ago", the truth.
- **`setlist` → drop on mismatch.** Here the snapshot *is* invalidated by a move:
  `before.songs` was captured against one week's setlist and live songs now
  resolve from another. There is nothing truthful to say, so the notice is
  discarded (§4).

`before.roles` holds seat labels (`"Líder"`, `"BGV"`, `"Coro"`, instrument and
FOH labels) — the vocabulary `rolesForMember()` already produces — derived from
the stored role via `normalizeStoredSeats(role)`, which every protected role
writer already loads before it patches. No new read.

### Upsert, on every committed write

In a post-commit `after()` block, as its **own** transaction on `writeClient` —
never the business transaction (§2).

**Three of the writers have no `after()` block today** and must introduce one:
`app/api/admin/setlists/route.ts` (which awaits `notifySetlistSaved(week)` inline
at line 367), `app/api/me/proposals/route.ts`, and
`app/api/admin/proposals/[id]/route.ts`. The `DELETE` handler in
`app/api/admin/roles/[id]/route.ts` likewise has none — its current comment says
"A removal is silent by §7", which this design makes false. Without the block the
upsert and the layer-2 sweep run *inside* the admin's request instead of after
the response.

```
writeClient.transaction()
  .createIfNotExists({ _id, _type: "notificationOutbox", kind, subjectKey,
                       serviceDate, roleType, before, status: "pending",
                       firstQueuedAt: now, deadline: now + MAX_WINDOW,
                       claimedAt: null })
  .patch(_id, p => p.set({ notifyAfter: now + DEBOUNCE, status: "pending" }))
  .commit()
```

`before` is a value computed **pre-commit** and passed into `after()` — never
read here, where live state is already the post-write state (§2).

`createIfNotExists` is a no-op when a notice already exists, so `before` and
`deadline` survive an entire burst of edits. The patch only slides `notifyAfter`
and re-pends. A deterministic `_id` makes the whole thing
idempotent: an HTTP retry replaying the same commit produces the same document.

### The sliding window, and its ceiling

Every new modification refreshes `notifyAfter` to *now + 15 minutes*. That is the
intended behaviour: the email describes a finished piece of work, not a
keystroke.

A pure sliding window can **starve** — an admin saving every 10 minutes for two
hours would never trigger a send. So `deadline` is fixed at queue time and a
notice is due when **either** `notifyAfter` or `deadline` has passed. Worst case
the team hears about a still-in-progress edit an hour in, which is far better
than hearing nothing.

### Due, and classification from live state

A notice is due when **either**:

- `status == "pending"` and `min(notifyAfter, deadline) <= now`; or
- `status == "sending"` and `claimedAt <= now - NOTIFY_CLAIM_TTL` — the **lease
  has expired**.

The second clause is not optional. Without it, any function timeout, cold kill,
unhandled throw or mid-sweep deploy strands every already-claimed notice in
`sending` **permanently** — including *Ya no participas*, the very notice this
design accepts duplicates to protect. A claim is a lease, never a tombstone.

For each due notice the flusher reads **live** state and compares it against
`before`. Reading at send time rather than storing an "after" at write time buys
two properties for free: the email is never stale, and any change that nets out
to nothing inside the window collapses to silence.

**`role`** — the member's current seat labels vs `before.roles`:

| before | after | Result |
|---|---|---|
| empty | non-empty | **Nueva asignación** |
| non-empty | empty | **Ya no participas** |
| non-empty, different | non-empty | **Tu rol cambió** — "Ahora: Líder (antes: BGV)" |
| equal | equal | **no email** — notice dropped |

Two cases resolve outside the table:

- **The role is now `published == false`.** The notice is **dropped**. An
  unpublish is silent today and stays silent; making it speak only when a notice
  happened to be pending would be arbitrary.
- **The role document no longer exists**, *and* `before.roles` is non-empty →
  **Ya no participas**. Deliberately new behaviour: deleting a published service
  currently tells its participants nothing, and it should.
- **The role document no longer exists and `before.roles` is empty** → the notice
  is **dropped**, exactly as the table's `empty → empty` row would.

  That second rule is not a nicety. Since §7 removes the immediate assignment
  email, an assignee's first email is the queued one — so an admin who creates a
  published service at 10:00 and deletes it at 10:05, having picked the wrong
  week, leaves every assignee with `before.roles = []` and a missing role. Without
  the gate, all of them are mailed *"Ya no participas — Domingo 9 ago"* about a
  service they were never told existed. That would break the introduction-before-
  modification property on a completely ordinary admin path, and it is invisible
  to the member that the removal came via `DELETE` rather than `PATCH`.

**`setlist`** — the current ordered list of `(song._ref, play_key)` plus the
**medley partition**, vs `before.songs`:

| before | after | Result |
|---|---|---|
| empty | non-empty | **Setlist listo** — lists the songs |
| non-empty, different | non-empty | **El setlist cambió** — lists the songs |
| non-empty | empty | **no email** — an emptied setlist is work in progress, not news |
| equal | equal | **no email** |

Medley grouping is part of the comparison on purpose: regrouping three songs
into a medley changes the arrangement the team rehearses even though the song
list is identical. `team_notes` is **not** part of it — editing the message to
the team without touching the songs notifies nobody.

**Never compare raw `medley_tag` values.** `normalizeMedleyTags`
(`app/utils/medley.ts:33`) mints a **fresh** tag for every group on every call,
and the editors call it on remove, reorder and toggle. Tag equality is therefore
a false premise, and using it would produce three wrong behaviours:

- removing one unrelated song regenerates every surviving group's tag, so the
  whole setlist compares as changed and the "nets out to nothing" property dies;
- a proposal approval writing the same songs in the same grouping compares as
  changed, because the proposal editor's uids differ from the setlist's;
- every medley in the email would wear a `NUEVO` chip after any unrelated edit.

Compare the **partition** instead: the contiguous grouping produced by
`buildRuns` (`app/utils/medley.ts:9`), expressed as group boundaries over song
positions and independent of tag values. `NUEVO` is defined the same way — a
group is new when that set of adjacent songs was not a group in `before`.
`before.songs` stores the partition, not the tags. Concretely, each row is
`{ ref, key, group }` where `group` is the **index of the contiguous run** the
song belongs to (`null` for a standalone song), derived from `buildRuns` at
snapshot time. One shape, stated once: no separate partition array.

**A one-song run snapshots as `null`, not as a run index.** `buildRuns` will emit
a one-song `medley` run from stored data (§6), so without this normalisation the
comparison would treat it as a group while the renderer draws it as a plain
single — the two disagreeing about the same song.

Sanity schema: `before` is one object type with three optional fields —
`beforeRoles: string[]`, `beforeSongs: [{_key, ref, key, group}]`,
`beforeNotes: string` — not a JSON blob, and `beforeSongs` rows carry `_key` like
every other array-of-object write in this repo.

A `setlist` notice is also **dropped when the service is now
`published == false`**, mirroring the `role` rule. Without this, queueing a
setlist change and then unpublishing the service mails every participant about a
service that is hidden from them — breaking the `published != false`
member-facing gate.

**`leadNotes`** — the proposal's current `lead_notes` vs `before.notes`. Equal
(after trimming) means no email. A notice on a proposal that is no longer
reviewable — `draft`, `approved`, or deleted — is dropped.

A notice whose service date has already passed is dropped without sending.
"Passed" is a **calendar-day comparison in America/Mexico_City**, per CLAUDE.md:
`new Date().toLocaleDateString("sv", { timeZone: "America/Mexico_City" })`. A
naive UTC comparison would drop every notice for today's service from 18:00
local onward, silently killing same-evening removal emails for Saturday
services.

### Grouping

Classification produces `(recipient, line)` pairs. Lines are filtered by the
preference for their own kind (§5), then grouped **by recipient**: one member
with a role change on Sunday and a new setlist on Saturday gets one email with
two sections. If no line survives filtering, no email is sent.

This is the whole point of the debounce, and it is why recipients are resolved
at flush rather than stored: a member added to the service five minutes after
the setlist changed still gets the setlist email.

### Subjects

Single-subject emails read *"Nueva asignación — Domingo 9 ago"*, *"Tu rol
cambió — Domingo 9 ago"*, *"Ya no participas — Domingo 9 ago"*, *"Setlist
listo — Domingo 9 ago"*, *"El setlist cambió — Domingo 9 ago"*, *"Notas del
líder — Domingo 9 ago"*. A grouped email uses *"Novedades de tus servicios"*,
mirroring `buildBatchAssignmentEmail()`, which already falls back to the
single-item template for a one-item list.

Every subject is a **constant string plus a formatted date**. Nothing is
assembled from content, so no song title or member name can leak into a subject
line or break it.

### Claim and delete

**A notice is a debounce record, not a delivery ledger.** It buffers "this
subject changed" until the subject goes quiet. It is then classified, consumed,
and gone.

Delivery is **best-effort with no retry, and duplicates are possible** — on a
re-pend during a send, and on a lease expiry after a killed sweep. Earlier drafts
called this "at-most-once", which is simply the wrong label for a mechanism that
enumerates two duplicate paths, and the term was load-bearing in three separate
justifications. The accurate posture is the one
`serviceMutationSideEffects.ts` §7 already documents: attempts are logged and
swallowed, nothing is rolled back into content, and no exactly-once claim is
made.

Earlier drafts tried to make the notice track per-recipient delivery progress as
well. That produced two defects that only adversarial review surfaced: progress
entries survived a re-pend, so a second edit resolved to "everyone already
notified" and sent **nothing** — losing a notification in the exact interleaving
the guard existed to catch — and the per-notice settle loop was flatly
incompatible with grouping emails per recipient across notices. One document
cannot be a debounce record, a delivery ledger, and an input to a cross-document
fold at once.

### One pipeline, stated once

A sweep runs these stages in order, and there is no second control flow:

1. **Select.** Read due notices ordered by `(firstQueuedAt asc)`. Accumulate
   them while the size of the **union of their resolved recipients** stays within
   `NOTIFY_FLUSH_EMAIL_LIMIT`. Stop there and leave the rest pending. A single
   notice whose own recipient count exceeds the budget is taken **alone**.
2. **Claim** every selected notice, **one `Patch.commit()` per notice**:
   `writeClient.patch(id).ifRevisionId(rev).set({ status: "sending", claimedAt: now }).commit()`.
   It must be a patch commit, not a transaction: `Transaction.commit()` resolves
   to a `MultipleMutationResult` carrying no `_rev` (`index.d.ts:6027`), while
   `Patch.commit()` returns the patched document (`index.d.ts:3963`) — and step 7
   asserts the revision this claim returns. A transaction here yields a revision
   the implementer cannot read back.
   Per-notice is required, not stylistic: a single batched transaction would
   abort the whole sweep on one conflict, where the intended behaviour is that a
   failed claim drops only that notice — another sweeper has it, or a writer just
   re-pended it.
3. **Classify** each claimed notice against live state (above), producing
   `(recipient, line)` pairs. Notices producing no line are simply consumed.
4. **Filter** each line by the preference for its own kind (§5).
5. **Group** by recipient — one email per person, covering every line they own.
6. **Send** each grouped email.
7. **Consume.** Delete every claimed notice in the batch, whatever each send
   returned.

Steps 1 and 3 each resolve recipients — two reads, deliberately. Step 1 needs a
count to bound the batch before claiming anything; step 3 needs the authoritative
set after the claim. The budget counts recipients **before** preference filtering,
so a batch of several notices sends no more emails than the budget. The single
exception is the oversized-notice case in step 1, which is deliberately allowed to
exceed it — see below.

Selection bounding the union of recipients is what makes step 7 safe: every
notice in the batch is fully discharged by step 6, so there is no partial state
to represent and no progress to track.

**The delete is a transaction, not a guarded delete.** `delete()` takes no
revision precondition — `ifRevisionId` is a `Patch` method only
(`@sanity/client` `index.d.ts:594,647`). Use the shape this repo already uses for
the role delete (`app/api/admin/roles/[id]/route.ts:458`): a revision-asserting
no-op patch plus the delete **in one transaction**, asserting the revision
returned by the **claim** in step 2. A notice re-pended by a writer during the
send therefore fails to delete and survives to be re-classified — the correct
outcome, and **one of two** cases where a member may see a duplicate. The other is
a sweep killed mid-fan-out: the lease expires and the next sweep re-sends from the
top. The wall-clock bound below keeps that second case bounded rather than
unbounded, but it does not eliminate it.

**Deletion is unconditional on send outcome.** A failed send is logged and the
notice is still consumed. This is the no-retry posture stated above; retrying
would need delivery receipts, an attempt counter and a dead-letter path, and the
review rounds showed that half-building that machinery is worse than not building
it. A member with a permanently-undeliverable address must never be able to hold
the outbox — and therefore the liveness alarm (§3) — red forever.

**The send loop is bounded by wall clock, and the batch is consumed either way.**
Step 6 stops sending when elapsed time reaches `NOTIFY_SEND_BUDGET_MS` (default
40 s, inside `maxDuration = 60`), and step 7 consumes the whole batch regardless
of how far it got, logging how many recipients went unserved.

Without this bound, the duplicate paths are unbounded. A sweep that sends to 8 of 15
recipients and is then killed leaves the notice in `sending`; the lease expires,
the next sweep re-claims and re-sends **from the top**. If the cause is
deterministic — an oversized notice that cannot finish inside `maxDuration`, which
§1's own unmeasured 2 s/send figure admits is possible — those first recipients
are re-mailed every `NOTIFY_CLAIM_TTL`, forever. Bounding the loop and consuming
unconditionally converts an unbounded repeat into a bounded, logged partial
delivery — a bounded repeat rather than an endless one.

**`deadline` is written once and never rewritten.** An earlier draft required the
upsert to both preserve `deadline` across a burst and refresh it on a re-pend —
two behaviours on one unconditional `.set()`, which Sanity cannot express and
which two implementers would resolve in opposite, both-plausible ways. The rule
is single: `createIfNotExists` writes `deadline`, nothing else touches it. A
notice re-pended after its ceiling has passed is immediately due again.

### Bounding the sweep

The budget is arithmetic, not assertion. SMTP here is a **pooled transport with
`maxConnections: 1`** (`app/utils/email.ts:16`), so sends are serialized. Every
route that hosts a sweep declares `export const maxDuration = 60`, matching the
admin routes in this repo.

| Knob | Default | Why |
|---|---|---|
| `NOTIFY_FLUSH_EMAIL_LIMIT` | 40 | Distinct recipients per sweep; the selection stage bounds the union, not a running count |
| `NOTIFY_SEND_BUDGET_MS` | 40 000 | Wall-clock bound on step 6, inside `maxDuration = 60` |
| `NOTIFY_CLAIM_TTL` | 5 min | Longer than any legitimate sweep, short enough that a crashed sweep recovers within two cron ticks |

Layer 2 (the opportunistic sweep inside an admin's save) uses **half** the limit,
since part of its invocation budget is already spent.

**The limit must exceed the largest realistic single-notice recipient count, and
that is the whole reason it is 40.** A `setlist` notice's recipients are every
seat on the service across all five paths — leads, BGVs, Chorus, instruments and
FOH — which for a Sunday on this ~30-member team is routinely 12–20 people. An
earlier draft set the limit to 12, which would have made "taken alone" the
*normal* path for almost every setlist change rather than a rare exception, and
combined with the wall-clock bound it would have silently dropped the tail of the
biggest service every time. At 40, no single service can exceed it and the
oversized branch becomes genuinely exceptional.

**The knobs must satisfy an inequality, and as first drafted they did not.**
Sends are serialized (`maxConnections: 1`), so the relationship is linear:

```
measured_ms_per_send × NOTIFY_FLUSH_EMAIL_LIMIT  <  NOTIFY_SEND_BUDGET_MS
```

At the working assumption of 2 s/send, a limit of 40 needs 80 s against a 40 s
budget — it does not fit, and step 7 would consume the batch anyway, permanently
dropping the tail of exactly the largest services the limit was raised to protect.
So one of the three values is derived, never all three guessed.

**This is a release gate, not a knob to tune later.** Nobody has timed a real
send. Before shipping, measure a batch of ~20 and evaluate the inequality
directly rather than judging a single run "comfortable":

- inequality holds at `NOTIFY_FLUSH_EMAIL_LIMIT` = 40 → ship as specified;
- it does not hold → **derive**: either raise `NOTIFY_SEND_BUDGET_MS` (bounded by
  `maxDuration = 60`) or lower the limit — and if lowering it drops below the
  largest per-service seat count, stop. Splitting one notice's recipients across
  sweeps reintroduces per-recipient progress, which "Claim and delete" shows is
  incompatible with one document per subject. That is a different outbox model
  and must be designed deliberately, not discovered in production.

> **2026-08-08 — measured, and the stop condition above WAS crossed.**
> `ms_per_send` = **14 413 ms**, not the 2 000 ms this section assumes: at the
> default limit that is `14 413 × 40 = 576 520` against a 40 000 ms budget. The
> derivation ran out of room — `NOTIFY_SEND_BUDGET_MS` cannot rise far behind a
> 60 s `maxDuration`, and concurrency was tried at 8 and at 10 and made things
> strictly worse (the server serializes acceptance for remote recipients; a local
> one costs 67 ms). Production therefore runs `NOTIFY_FLUSH_EMAIL_LIMIT = 2` —
> **below the 12–20 floor this section says to stop at** — chosen knowingly,
> because at the default the excess is not delayed but destroyed.
>
> The consequences are exactly the ones predicted here and are not resolved: a
> monthly role publish fragments into several emails per member instead of one,
> and a `setlist` notice — every participant in ONE document — cannot be split by
> any cap, so it is still taken alone, over budget, and truncated. The two real
> fixes are the ~14 s remote accept at the mail server, or re-pending notices the
> sweep never attempted instead of consuming them, which IS the different outbox
> model named above and still wants designing rather than discovering. See
> `docs/NOTIFICATIONS.md` → *Still open* and `docs/SECRETS.md` →
> `NOTIFY_FLUSH_EMAIL_LIMIT`.

**Layer 2 derates both knobs, not just one.** It halves the recipient limit *and*
the send budget, so the inequality holds identically there. An earlier draft
halved only the limit, which would have let a layer-2 sweep spend a full 40 s
sending *after* the write route had already consumed part of its `maxDuration`.
Note the consequence: at a halved limit of 20, a large Sunday setlist is
"oversized" for layer 2 and taken alone — which is fine, because layer 2 is a
backstop, and layer 1 runs at the full limit.

If the team grows past 40 active members, the limit grows with it, and the
inequality is re-evaluated.

When selection truncates, the sweep logs one structured line naming how many
notices were left behind. Silent truncation is not acceptable.

---

## 2. What queues a notice

HTTP methods below are the **actual exported handlers**, verified in the routes.
They matter beyond documentation: `file + operation` is the key
`protectedReadAudit`'s registries match on, so a wrong method propagates into a
failing guard entry.

| Writer | Method | Queues |
|---|---|---|
| `app/api/admin/roles/route.ts` (create) | `POST` | `role`, per initial assignee, when published |
| `app/api/admin/roles/[id]/route.ts` | `PATCH` | `role`, per member in the union of before- and after-assignees |
| `app/api/admin/roles/[id]/route.ts` (delete) | `DELETE` | `role`, per **current** assignee, snapshotted before the delete commits |
| `app/api/admin/roles/swap/route.ts` | `POST` | as `PATCH` |
| `app/api/admin/roles/copy-instruments/route.ts` | `POST` | as `PATCH` |
| `app/api/admin/setlists/route.ts` | `PUT` | `setlist`, for the target service |
| `app/api/admin/proposals/[id]/route.ts` (approve) | `PATCH` | `setlist`, for the service it just wrote |
| `app/api/admin/roles/publish/route.ts` | `POST` | `setlist` on each `false -> true` transition (see below) |
| `app/api/admin/roles/publish-ready/route.ts` | `POST` | same as `publish` — both are publish surfaces |
| `app/api/me/proposals/route.ts` | `POST` | `leadNotes`, when `lead_notes` changed and the proposal is `pending` or `changes_requested` |

Draft services stay silent, exactly as today: nothing is queued unless
`published !== false`.

### Publish must announce the setlist

The dominant workflow is *create as draft → build the setlist → publish*. While
the service is a draft nothing queues, so without a rule here **publishing a
service that already has a setlist would send no setlist email at all** — which
is the first clause of the requirement verbatim. Worse, the member's first
setlist email for that service would be *El setlist cambió* on the first
post-publish edit.

So a `false -> true` transition queues a `setlist` notice with
**`before.songs = []`**, on both publish surfaces. At flush, live songs are
non-empty, so it classifies as *Setlist listo* — the member's introduction to
the setlist, exactly as if it had been written after publication. A service
published with no songs yields `[] → []`, which is silent.

The cost is explicit: publishing sends the assignment email immediately (§7) and
a setlist email once the window closes. Two emails, not one. Grouping keeps it
at two no matter how many services are in the batch, because every queued
`setlist` notice for one member collapses into a single email.

### Deletion

`DELETE` queues a `role` notice for each current assignee, with `before.roles`
read from the stored role **before** the transaction commits. At flush the role
document is gone, which classifies as *Ya no participas* (§1). Without this row
the "deleted role" rule in §1 would be unreachable — it could only fire when a
notice happened to already be pending, which is the arbitrary behaviour §1
rejects for the unpublish case.

### Other boundaries

- **Creating an already-published service queues** rather than emailing
  immediately. Any seat write debounces, with no carve-out for creation — admins
  routinely create a service and then adjust it, and a carve-out would produce
  exactly the "asignado now, cambió later" double email this design exists to
  prevent.
- **Publish queues no `role` notice.** A `false -> true` transition writes no
  seats; the assignment email is sent immediately by `notifyRolePublished()`
  (§7). Only the `setlist` notice above is queued.
- **Unpublish queues nothing**, and any pending `role` notice for that service is
  dropped at flush (§1).
- **Lead notes on a `draft` proposal are silent.** The proposal is not in front
  of admins yet, so there is nothing for them to act on.
- **A resubmit deliberately notifies twice, and that is accepted.** A
  `changes_requested -> pending` resubmit sends admins the immediate "Nueva
  propuesta" and, once the window closes, "Notas del líder" for the same save.
  The carve-out below covers `draft -> pending` only. Review flagged the
  asymmetry — the resubmit path is the *more* common one — and the user's call
  (2026-07-28) is to keep it: on a resubmit the two emails say genuinely
  different things, one that a proposal is back in the queue and one what
  changed in it, and admins would rather have both than guess. Recorded as a
  decision, not an oversight.
- **A first submission does not queue `leadNotes`.** The predicate is that the
  proposal was **already** `pending` or `changes_requested` *before* this write —
  not merely that it is afterwards. A `draft → pending` submit carrying notes
  already sends admins the immediate "Nueva propuesta" (§5); queueing on the same
  write would mail them twice about one submission.

### Where `before` is captured, and in which transaction

Both are load-bearing and neither may be left to the implementer:

- **Capture is pre-commit**, from the document the writer has already loaded, and
  the value is threaded into `after()` as an argument. Reading live state inside
  `after()` would return the *post*-write state, making `before == after` for
  every notice — a system that silently sends nothing while passing every unit
  test that feeds `before`/`after` as parameters.
  - `role` → `normalizeStoredSeats(role)` on the stored role, before the patch.
  - `setlist` → `loadWeekendSetlistTarget(...).target.record.songs` or
    `loadSpecialSetlistTarget(...).target.role.songs`.
  - `leadNotes` → the proposal's stored `lead_notes`.
- **The upsert is a separate post-commit write**, not part of the business
  transaction, issued with `writeClient` (`operationalClient` carries a read
  token only). Rationale: a failed outbox op must never abort a committed content
  write. The accepted cost is that a crash between commit and queue drops that
  notice — the same best-effort posture §11 already documents, and preferable to
  coupling content integrity to notification bookkeeping.

---

## 3. Flush triggers — three layers

Vercel Hobby allows one cron per day, so the primary trigger lives outside
Vercel.

**Layer 1 is load-bearing, and earlier drafts of this spec claimed otherwise.**
Layer 2 can only flush subjects that have *already* gone quiet, so it can never
flush the terminal edit of a working session — and the terminal edit is what
every notice eventually is. Every notice that ships therefore depends on the
GitHub workflow or, failing that, the daily cron. The honest worst case when the
workflow is broken, disabled or throttled is **up to 24 hours**, not 15 minutes.
That is why §7 keeps the publish email immediate and why the liveness signal
below is part of the design rather than an operational nicety.

1. **Primary — GitHub Actions, every 5 minutes.** A workflow in this repo curls
   `GET /api/cron/flush-notifications` with a shared secret in an `Authorization`
   header (`CRON_SECRET`, the pattern the existing service-reminders cron already
   uses). Chosen over a third-party scheduler because it is versioned in the repo
   and needs no external account. GitHub's scheduled runs are routinely 5–15
   minutes late; that makes an email later, never wrong.
2. **Backstop — opportunistic sweep.** Every protected role/setlist/proposal
   write also sweeps due notices in its `after()` block. Because an in-flight
   burst keeps sliding `notifyAfter` forward, this will not normally flush the
   subject the admin is *currently* editing. The one exception is the `deadline`
   ceiling: past 60 minutes a notice is due regardless of `notifyAfter`, so an
   admin in a long session can flush their own in-progress subject from their own
   save. §1 accepts that outcome deliberately — it is what the ceiling is for. What it does cover is the cross-subject case: an admin who edits
   service A, then twenty minutes later edits service B, flushes A. Useful, but
   never sufficient on its own.
3. **Last resort — the existing daily Vercel cron.** `/api/cron/service-reminders`
   calls the same sweep, so nothing can sit pending for more than a day even if
   both other triggers are broken.

The sweep is one exported function; the three triggers are three thin callers.

**GitHub disables scheduled workflows after 60 days of repository inactivity.**
That rule applies to public repositories, and this repo is public, so it applies
here. Combined with a once-daily liveness check, the detection
window for that specific failure is up to 48 hours. Accepted, and named here so
it is a known operational property rather than a surprise.

### Liveness signal

Because layer 1 is load-bearing and can fail silently, the daily cron reports
the **oldest `firstQueuedAt` across notices in *either* status** — `pending` and
`sending` both. Reporting only `pending` would blind the alarm to precisely the
failure that spams the team: a notice stuck mid-fan-out sits in `sending`.

An outbox entry older than `NOTIFY_STALE_ALERT_HOURS` (default 6) emits a loud
structured error line naming the count and the oldest age, **and emails the
super-admins through the same `sendEmail` path** as every other notification.

The email is not belt-and-braces; it is the whole mitigation. This repo has no
log drain, no error-reporting integration and no alerting, and Vercel Hobby
provides none — a `console.error` in a daily cron has no consumer. §11 designates
this signal as the mitigation for layer 1 being a single point of failure, so it
has to reach a person or that risk is simply unmitigated.

Six hours is far outside any legitimate window — the hard ceiling is one hour —
so this fires only when layer 1 has genuinely stopped. Without it, a disabled
GitHub workflow produces a system that looks healthy and quietly sends nothing.

---

## 4. Setlist recipients

Participants of **that** service — not the whole team. Resolved from committed
canonical state through `assignedMemberRefsQuery()` so all five seat paths are
covered, scoped to the role type the setlist belongs to:

| Setlist | Role type queried |
|---|---|
| `featuredSongs` (Sunday) | `sunday_role` for that week |
| `saturdarSongs` (Saturday) | `saturday_role` for that week |
| `special_role` | that role document itself |

The existing setlist **push** audience (`notifPrefs.setlist` = all/assigned/off,
default "all" — the whole team) is unchanged. Email is narrower on purpose: the
requirement is "a service the user participates in".

`leadNotes` recipients are the members whose `role` is `admin` or `super-admin`,
resolved at flush with the **same query `proposalNotify.ts` already uses**. That
query applies no active-member filter; this spec deliberately matches it rather
than diverging, so the two admin audiences stay identical. Adding an active
filter is a separate, pre-existing question and is out of scope here.

### One subject key per service, from both writers

The `setlist` `subjectKey` is `${roleId}`. The manual weekend writer holds only
`week` + `setlistType` and must resolve the roleId via
`loadWeekendCoordination(...).coordination.role`, which is **`null` when no role
exists at that target** — in that case no notice is queued, because there are no
participants to notify.

Both the manual writer and the approve path must derive the **same** key for the
same service. If they don't, one service produces two outbox documents and the
member gets two emails for one change.

The flush-time recipient query carries `published != false` explicitly, at the
query, per the CLAUDE.md member-facing-read invariant — not merely by relying on
the §1 drop rule to have caught it first.

### A `setlist` notice whose role is gone

Dropped, silently. Recipients resolve from the role's seats, so a missing role
yields an empty audience and no email either way — but two implementers would
write different code to reach that, so the rule is stated rather than left to
converge by accident.

### Resolving live songs at flush

For a weekend service the live songs are not on the role: resolve `roleId` →
`role.week` → the `featuredSongs` (Sunday) or `saturdarSongs` (Saturday) document
for that week. For a `special_role` the songs are on the role document itself.
`loadWeekendSetlistTarget(...).target.record` is nullable
(`app/utils/serviceWriteTargets.ts:87`), so both the snapshot and the flush read
treat a missing record as `[]`.

### Departed songs need titles from the union

§6 renders struck-through titles for songs that left, whose refs exist only in
`before`. The flusher resolves titles for the **union** of before- and after-refs
in one query. A song document deleted in the interim yields no title; that row
renders with its ref omitted rather than blank-titled, and never fails the email.

### Two date-move behaviours, stated rather than discovered

`PATCH /api/admin/roles/[id]` supports moving a service to another date, and the
`setlist` `subjectKey` is `${roleId}`, which survives the move. Two consequences:

- A pending `setlist` notice queued before the move resolves live songs from the
  **new** week at flush, reporting a "change" that is really a different
  service's setlist. The notice therefore stores `serviceDate` at queue time, and
  a notice whose live service date no longer matches its snapshot is **dropped** —
  the subject moved out from under it.
- A date move alone classifies as `equal → equal` for every member, so **moving a
  published service notifies nobody**. Raised with the user, since every subject
  line carries a date and this looked like a gap. The answer: moving an entire
  service — the whole team and its setlist — to a different day does not happen
  in practice, so the case is not worth a fourth notice kind. Recorded as a
  deliberate non-goal with that reasoning, not as an artifact.

---

## 5. Preferences — five toggles

New boolean fields on `notifPrefs`, all defaulting to `true`:

| Field | Covers |
|---|---|
| `emailAssigned` | Nueva asignación |
| `emailRemoved` | Ya no participas |
| `emailRoleChanged` | Tu rol cambió |
| `emailSetlist` | Setlist listo, El setlist cambió |
| `emailProposals` | Notas del líder, plus the existing "nueva propuesta" admin email |

**Legacy fallback, no data migration.** Resolution for a given type: if the
specific field is a boolean, use it; otherwise fall back to
`notifPrefs.email !== false`. A member who already opted out of
`notifPrefs.email` stays opted out of all five, and nobody starts receiving mail
they had switched off. The legacy `email` field stays in the schema as that
fallback and leaves the member-facing UI.

Surfaces to update: `sanity/schemas/worshipTeam.ts`, `ProfilePanel.tsx`,
`AdminPanel.tsx` (admin editing another member), `PATCH /api/me/notif-prefs`,
`PATCH /api/admin/members/[id]`, `proposalNotify.ts` (to read `emailProposals`
instead of raw `notifPrefs.email`), and — easy to miss, and the one that matters
most — **`assignmentEmail.ts`**.

`sendAssignmentEmails` and `sendAssignmentEmailsBatch` gate on
`wantsEmail(m.emailPref)` where `emailPref` projects `notifPrefs.email`
(`assignmentEmail.ts:144,150,173,184`). §7 keeps that batch send **outside** the
outbox, so without this change a member who switches `emailAssigned` off keeps
receiving publish assignment emails — the highest-volume "Nueva asignación" the
system produces, and the toggle would be dead on it. Both functions route through
the same shared per-type resolver as every other sender.

The resolver is one exported function used by every send path. Nothing reads
`notifPrefs` fields directly.

Delivery is gated in this order, unchanged from today except for the pref step:
valid email → `EMAIL_ALLOWLIST` → per-type preference → `EMAIL_REDIRECT_TO`
override → `sendEmail`.

**The panels must render the resolved value, not the raw field.** A member who
set `notifPrefs.email: false` has all five new fields unset, which resolves to
"no mail" — but an unset boolean renders as its `true` default. Since §5 removes
the legacy `email` toggle from the member-facing UI, a naive render would show
five switches ON to someone receiving nothing. `ProfilePanel` and `AdminPanel`
apply the same fallback the sender does.

---

## 6. Presentation

### No prose

An email states **what** and **when** in its header, and nothing else in
sentences. There is no generated narration — no "Ahora abren con Digno Es", no
"Santo sale del setlist". Two reasons, and the second matters more: sentences
assembled from content are the hardest thing here to get right in Spanish across
every permutation, and they are the first thing to read as machine-written.

This deletes a whole layer that earlier drafts of this spec carried: no
"name the opener" rule, no "one moved vs. many" branch, no sentence assembly.

### One standings table

Every setlist email uses the same table. There is no diff mode and no
full-list mode — the columns carry the difference:

| Column | Content |
|---|---|
| `#` | Position in the new running order; `–` for a song that left |
| Canción | Title. Struck through when the song left |
| Tono | `play_key`. A change shows `E` struck through, then `G` |
| `Mov.` | `▲n` / `▼n` / `–`, or a `NUEVA` / `SALIÓ` chip |

`Mov.` is **omitted entirely** for *Setlist listo* — there is no previous
position to compare against. Same table, one column fewer, not a second
template.

Departed songs sit in the table, below a hairline, with `–` for position and a
`SALIÓ` chip. Symmetric with `NUEVA`, and inside the table rather than in a
footnote: "don't rehearse this one" is among the most actionable lines the
system sends.

### Movement

`▲n` and `▼n` appear on **every** row; a song that held its position shows `–`,
never a blank. A blank cell reads as "not computed"; the dash reads as
"computed, unchanged", and that distinction is what makes the column scan as a
standings table.

The delta is **absolute position arithmetic**. Removing the 2nd song therefore
shows `▲1` on everything below it. That is literally true — those songs will be
played one slot earlier — and it needs no algorithm deciding which movements
"count". An earlier draft used a longest-common-subsequence pass to suppress
displacement; it was cut because it hid real changes (a song can become the
opener without "moving") and cost code and tests to do so.

A one-line legend under the table resolves the metaphor: **`▲ suena antes en el
servicio`**. In a league table "up" means better; in a running order it only
means sooner.

### Medley

Drawn the way the app already draws it in `DayCard.tsx`: a vertical `beam` rule
down the left of the group, an uppercase `MEDLEY` label above it, `+` between
songs. A newly formed group carries a `NUEVO` chip on that label. The email
borrows the app's visual language rather than inventing a second one.

**The renderer must guard the one-song group itself.** `normalizeMedleyTags`
clears a lone tag, but it runs only in the two client editors —
`parseSetlistWriteRequest` stores whatever `medley_tag` arrives
(`parseSongRows`, `app/utils/setlistWriteRequest.ts:164`), and `buildRuns` will happily emit a
one-song `medley` run from stored data. `DayCard.tsx:156` already defends against
exactly this, and with 275 imported history documents in the catalog the
defensive case is real, not theoretical. A one-song group renders as a plain
single, with no spine and no label.

### Palette and type

**Superseded 2026-07-28 — the email palette is LIGHT, and deliberately not
`brand.css`.** The original rule below is kept for the reasoning it carries about
movement colours, which still holds.

The templates shipped dark to match the app. Outlook for Mac rendered every dark
surface as slate grey, flattening the design; five escalating attempts to hold
the palette all failed, three of them regressing other clients badly enough to
revert:

| Attempt | Result |
|---|---|
| `color-scheme` / `supported-color-schemes` meta | ignored |
| `<style>` with `[data-ogsb]`/`[data-ogsc]` `!important` | fixed light mode only |
| `!important` on inline backgrounds | broke light mode too — reverted |
| same, with conformant spacing | broke light mode again — reverted |
| 1×1 `data:` GIF via the `background` attribute | broke light mode — reverted |

The evidence across all of it was consistent: brand **accents** survived every
transform without exception; only dark **surfaces** were remapped. That is
structural. Client dark-mode transforms assume email is light — darkening a light
message is the case they are built for, lightening a dark one is the edge case
they handle badly. Fighting it from the sending side has no reliable hook.

So the surfaces are light and the brand accents sit on top, which is the
combination already proven to render everywhere. Accents are darkened from their
`brand.css` values purely for contrast on a light surface, and **every pairing
clears WCAG AA** — something the dark palette was never checked against. Verified
in Outlook for Mac in both toggle states.

The one `<style>` block restates each surface colour. §6 forbids *depending* on a
stylesheet, which this does not: every colour is also inline and on `bgcolor`, so
a client that drops the block renders identically.

*Original rule, for the movement-colour reasoning:* colors came from `brand.css`
— `blackout` field, `deck` panels, `beam` accent and links, `signal` for
additions and upward movement, `frost` primary text, `steel` secondary — with one
deliberate exception: **amber for downward movement**. Red would read as an
error, and a song moving later is not an error; `steel` was rejected because up
and down stop being distinguishable at a glance.

No web fonts — Gmail and Outlook drop them. Personality comes from setting:
wide-tracked uppercase eyebrows, a large date, monospace confined to data (keys,
deltas, positions).

### Email-client constraints

Tables and inline styles throughout; no flexbox, no grid, no `<style>`
dependency, no remote images. `bgcolor` is set on every cell, not just `body`,
which is what makes a dark email safe in Gmail and Apple Mail. Movement glyphs
are Unicode `▲ U+25B2` / `▼ U+25BC`, present in every system font — remote icons
would be blocked by default in roughly half of clients, erasing the marker
exactly when it matters.

Two behaviours are **reasoned, not verified**, and must be checked in real
clients before release: Outlook on Windows (Word engine) squares off
`border-radius` and handles `padding` on inline `span` poorly, which affects the
key pills; and the four-column table on a narrow phone in Gmail, where the title
wraps and the numeric columns must stay right-aligned.

### Restyle of the shipped templates

`buildAssignmentEmail()` and `buildBatchAssignmentEmail()` currently render navy
`#003572` on white, which resembles nothing else in the product. Both move to
the treatment above; the batch template becomes a `fecha → tu rol` table, since
a member commonly holds different seats across the services in one publish.
`proposalNotify.ts`'s "nueva propuesta" admin email is restyled with them, for
consistency rather than because it changes.

*This was inferred from approval of the mockups rather than asked directly. If
the shipped templates should stay as they are, this subsection is the one to
cut — nothing else depends on it.*

### Copy audit

Every user-facing string is checked against what the app already says before it
ships. Two misses were caught by review during design: "popurrí" for what the UI
calls **Medley** (`DayCard.tsx`), and "Cantas como…", which is wrong for the
three of five seat paths that do not sing — now **"Sirves como…"**. Instrument
and FOH labels are free text typed by an admin in `ServicesPanel`; templates
print them and never interpret them, so no mapping table can drift.

---

## 7. Publish stays immediate

`notifyRolePublished()` keeps sending its consolidated email at publish time,
outside the outbox. Publishing is a deliberate single click, the email is already
batched per member across the batch, and that path is verified in production.
Routing it through the outbox would unify the code at the cost of delaying the
single most important email and disturbing shipped A2/A3 behaviour.

The availability argument is the decisive one. Layer 2 only fires while someone
keeps working, and the publish workflow is *publish, then stop* — so a debounced
publish email would lean entirely on the flakiest trigger.

The interaction is coherent: publish at T emails "nueva asignación"; an edit at
T+2min queues a notice that, once the edits stop, emails "tu rol cambió". The
member gets two emails, the second carrying correct information. Accepted over
adding suppression logic.

Removing `notifyRoleAssignments()`'s email leg **breaks existing tests** that
assert an immediate assignment email — `app/api/__tests__/roleWriteRoutes.test.ts`,
`app/api/__tests__/roleSwapRoutes.test.ts`, the send paths in
`app/utils/__tests__/assignmentEmail.test.ts`,
`app/utils/__tests__/serviceMutationSideEffects.test.ts:212`, and
`app/utils/__tests__/deliveryFirewallTransports.test.ts:273,676`. They must be updated to assert an
outbox notice instead. This is expected work, not a regression to discover
mid-implementation.

**`notifyRoleAssignments()` loses its email leg.** Its immediate assignment email
is fully absorbed by the outbox — otherwise one edit produces "te asignaron" now
and "tu rol cambió" fifteen minutes later. Its push leg is unchanged, so members
still get an immediate in-app signal. The pairing is deliberate: the push says
*something* changed, the grouped email says *what*.

---

## 8. Integration constraints

- **Studio protection — needs a policy restructure, not two list appends.**
  `notificationOutbox` should be hidden from authoring *and* prunable by an
  operator. That combination is **not currently expressible**: `studioCapability`
  takes the `DELETE_ONLY_STUDIO_TYPES` branch before it consults internal-ness
  (`studioProtection.ts:182`), and `studioProtection.test.ts:123` asserts every
  `INTERNAL_STUDIO_TYPES` entry's create mechanism contains `"hidden"`, which a
  delete-only type cannot produce. Implementation must restructure
  `studioCapability` so the two properties compose, and extend the test to assert
  the new combination. Treating this as "append to both lists" will fail `npm test`.
  The write registry has the same class of assertion —
  `protectedReadAudit.test.ts:335` asserts the exact `file#operation` key set of
  `PROTECTED_RUNTIME_WRITERS` — so the new entries must be added there too, and it
  is a staleness check, not a lint.
  The restructure is larger than one branch: `studioProtection.test.ts:120` asserts
  `INTERNAL_STUDIO_TYPES` equals an **exact array**, and `:367` asserts each
  internal type is `hidden: true` in its own schema file, and `:373` asserts
  `Object.keys(INTERNAL_STUDIO_FIELDS)` as an exact set. The spec's intent is
  `notificationOutbox` in `DELETE_ONLY_STUDIO_TYPES` (operators may prune) **and**
  hidden from authoring; implementation must decide how that is represented and
  update both assertions.
- **Read audit — the constraint is on writes, not reads.** A protected read
  through `operationalClient` is already compliant and needs no registration;
  there is no read registry (`A2_HANDOFF_ALLOWLIST` is empty and documented to
  stay that way). What actually bites: a mutation issued in a region that names a
  protected `_type` literal is classified `protected-write`
  (`protectedReadAudit.ts:818`), satisfiable only by a `PROTECTED_RUNTIME_WRITERS`
  entry. The sweep module qualifies, and `serviceMutationSideEffects.ts` already
  names `sunday_role` at line 215 — so adding a `writeClient` mutation there makes
  that **whole file** one `protected-write` region at operation `"module"`,
  needing its own `PROTECTED_RUNTIME_WRITERS` entry in the same shape as the
  existing `app/utils/roleWriteOps.ts` / `"module"` entry
  (`protectedReadAudit.ts:189`). Register the writers; do not touch the read side.
- **`maxDuration` on every sweep host.** The roles routes declare
  `export const maxDuration = 60`; `app/api/admin/setlists/route.ts`,
  `app/api/admin/proposals/[id]/route.ts`, `app/api/me/proposals/route.ts`,
  `app/api/admin/roles/unpublish/route.ts` and
  **`app/api/cron/service-reminders/route.ts`** declare none. The first four host
  the layer-2 sweep; the last *is* layer 3, the backstop for an acknowledged-flaky
  layer 1. All five must declare it, as must the new flush route.
- **Route conventions.** `/api/cron/flush-notifications` is wrapped in
  `withVerificationRunContext`, like every other route in this repo, and
  authorized by the `CRON_SECRET` header pattern at
  `app/api/cron/service-reminders/route.ts:13`.
- **The GitHub workflow is new infrastructure.** `.github/workflows/` does not
  exist in this repo; layer 1 is not an extension of an existing pattern. Only
  the `CRON_SECRET` header convention is borrowed, from
  `app/api/cron/service-reminders/route.ts:13`.
- **Client split.** Reads in the sweep use `operationalClient` (published
  perspective). Outbox writes use `writeClient` — `operationalClient` carries a
  read token only (`sanity/lib/operationalClient.ts:22`).
- **Delivery firewall.** Everything routes through `sendEmail`, so A3's
  transport-level refusal covers the new paths unchanged. The sweep route is
  included: a verification run must not mail the team. The sweep gates on
  `isDeliveryBlocked()` (`app/utils/deliveryFirewall.ts:191`) **before it claims
  anything** and exits without touching the outbox. One caveat worth naming: any
  unrecognised `DELIVERY_MODE` value blocks (`deliveryFirewall.ts:170`), so a typo
  in production would silence both the sweep *and* the super-admin alarm that §3
  designates as its own mitigation — the alarm shares a failure mode with the
  thing it watches. Low probability, but not zero, and the daily cron's log line
  remains the only trace — rather than discovering the
  block per-send, where `sendEmail` returns the same `{ ok: false }`
  (`email.ts:38`) for a firewall block, missing configuration and a genuine SMTP
  failure alike, and is therefore useless for deciding whether to consume.
  (An earlier draft made consumption conditional on `ok` to protect the real
  outbox from a verification run. That premise was false — the verification
  deployment targets an isolated project and dataset and hard-refuses production
  `ebb8vcnk`/`production` on either axis, `scripts/lib/sr-verification.mjs:12` —
  and the rule it justified would have let one undeliverable address hold a
  notice forever.)
- **`_key`.** Any array-of-object field written to the outbox carries a `_key`,
  including `before.beforeSongs` rows.
- **Stale invariant comments must be updated with the behaviour.** The header
  contract in `serviceMutationSideEffects.ts:7` states that "a removal … [is]
  silent; the caller simply never builds a notice", and the `DELETE` handler
  repeats it at `app/api/admin/roles/[id]/route.ts:470`. Both become false here.
  CLAUDE.md exists to stop exactly this kind of drift, so they are part of the
  change, not follow-up.
- **Document id length.** `outbox.role.${memberId}__${roleId}` composes two ids
  that `isCanonicalDocumentId` permits at up to 200 chars each, which can exceed
  Sanity's id ceiling. Use the digest approach the repo already uses for this
  shape (`receiptIdForRequestId`, `app/utils/roleCreationReceipt.ts:196`), keeping
  the id deterministic while bounding its length.
- **Timezone.** `notifyAfter`, `deadline`, `firstQueuedAt` and `claimedAt` are
  instants — no calendar arithmetic there. The one calendar comparison in the
  system is the past-service-date drop, which uses the America/Mexico_City
  local-date rule (§1). Every rendered service date keeps the local-noon rule:
  `new Date(iso.slice(0,10) + "T12:00:00")`.
- **Cache.** Nothing here changes content, so no `revalidate*` call is added.
- **Schema deploy.** The new document type and the five `notifPrefs` fields need
  a Sanity schema deploy before the Studio reflects them.

## 9. Configuration

| Name | Default | Meaning |
|---|---|---|
| `NOTIFY_DEBOUNCE_MINUTES` | `15` | Quiet period before a subject's notice flushes |
| `NOTIFY_MAX_WINDOW_MINUTES` | `60` | Hard ceiling from first queue; defeats starvation |
| `NOTIFY_CLAIM_TTL_MINUTES` | `5` | Lease on a claimed notice; expiry makes it due again |
| `NOTIFY_SEND_BUDGET_MS` | `40000` | Wall-clock bound on the send loop; the batch is consumed either way |
| `NOTIFY_FLUSH_EMAIL_LIMIT` | `40` | Max recipients per sweep. **Must exceed the largest per-service seat count** — see §1 |
| `NOTIFY_STALE_ALERT_HOURS` | `6` | Oldest pending age that triggers the liveness error line |
| `CRON_SECRET` | — | Already present; now also authorizes the sweep route |

Because every claimed notice is consumed in the sweep that claims it, nothing
accumulates in normal operation. A pending age above `NOTIFY_STALE_ALERT_HOURS`
therefore means layer 1 has stopped, which is exactly what the alarm is for.

## 10. Testing

Pure logic, unit-tested (vitest):

- **`role` classification:** each of the four before/after cases, plus the
  deleted-role case (sends "Ya no participas"), the unpublished-role case (drops
  silently) and the past-date case (drops silently).
- **`setlist` classification:** empty → non-empty is "listo"; a reorder, a
  `play_key` change and a **regrouping** each count as changed; a
  `team_notes`-only edit does not; non-empty → empty is silent; equal is silent.
- **`leadNotes` classification:** changed vs unchanged after trimming; `draft`,
  `approved` and deleted proposals drop.
- **Debounce arithmetic** against a fixed clock: the window slides on each
  modification; the ceiling fires despite continuous activity; due-ness is
  `min(notifyAfter, deadline)`.
- **Introduction before modification** — the cases that look fine in review and
  break in production. Each asserts that a member never receives a "changed"
  email for something they were never told about:
  - Setlist created, then edited inside the window → **one** *Setlist listo*
    carrying the final song list, never *El setlist cambió*.
  - Member added, then promoted BGV → Líder inside the window → **Nueva
    asignación** as Líder, never *Tu rol cambió*.
  - Member added, then removed inside the window → **no email at all**.
  - Member absent from a publish batch, added minutes later → **Nueva
    asignación**, because `before.roles` is that member's own seats and is still
    empty.
  - `before` survives repeated writes: three edits in one window leave the
    snapshot from the first.
- **Lease recovery:** a notice left in `sending` with an expired `claimedAt` is
  due again; one inside its TTL is not. This is the test that would have caught
  the permanently-stranded-notice bug.
- **One-to-many delivery:** a `setlist` notice with 5 participants sends 5 emails
  and is consumed once. This is the test that would have caught the
  notify-one-participant-then-delete bug.
- **Selection bounds the recipient union:** two notices sharing most participants
  can both enter one sweep; two disjoint notices that would exceed the budget
  cannot, and the second stays pending and is logged.
- **Budget sizing:** a `setlist` notice with 20 recipients is *not* treated as
  oversized at the default limit — the regression test for the 12-vs-20 defect.
- **Create-published-then-delete inside the window sends nothing.** A published
  create with 12 assignees, deleted 5 minutes later, yields **zero** emails — not
  12 × *Ya no participas* for a service nobody was told about. Deleting a role
  whose assignees *had* been introduced still yields *Ya no participas*.
- **A recipient absent from `knownRecipients` gets *Setlist listo***, not a diff
  against a list they never saw.
- **The knob inequality holds:** `ms_per_send × EMAIL_LIMIT < SEND_BUDGET_MS` is
  asserted for both the layer-1 and the halved layer-2 configuration.
- **Date move:** a `role` notice whose service moved renders the **live** date; a
  `setlist` notice whose service moved is dropped.
- **One-song run snapshots as `null` group**, so comparison and rendering agree.
- **A first proposal submission queues no `leadNotes` notice**, so admins are not
  mailed twice about one submission.
- **The send loop is bounded:** a batch that exceeds `NOTIFY_SEND_BUDGET_MS` stops
  sending, is still consumed, and logs the unserved count — so a lease expiry can
  never re-send the same recipients indefinitely.
- **A blocked delivery environment exits before claiming**, leaving the outbox
  untouched.
- **Preferences bind the immediate path too:** a member with `emailAssigned: false`
  receives no publish assignment email from `sendAssignmentEmailsBatch`.
- **The liveness query counts `sending` as well as `pending`**, and the alarm
  emails super-admins rather than only logging.
- **Consumption is unconditional:** a notice is deleted even when its send fails,
  so a permanently-undeliverable address cannot hold the outbox — or the liveness
  alarm — red forever. A notice whose lines all filter out is consumed too.
- **Deleted subject:** a `role` notice whose role document is gone still renders
  its subject and evaluates the past-date drop, from the queue-time snapshot.
- **Date move:** a `setlist` notice whose live service date no longer matches its
  snapshot is dropped rather than reporting another week's setlist.
- **Guarded delete:** the delete is a transaction with a revision-asserting patch;
  a notice touched during the send is not deleted.
- **`deadline` is never rewritten** by any path, including a re-pend.
- **One-song medley group** from stored data renders as a plain single.
- **Medley partition, not tags:** two song lists with identical songs, keys and
  grouping but **different `medley_tag` values** classify as *unchanged*. A
  regrouping classifies as *changed*. `NUEVO`
  attaches only to a group whose adjacent-song set was not a group in `before`.
- **Publish announces the setlist:** a draft service with songs, then published,
  yields *Setlist listo*; published with no songs yields no email.
- **Deletion:** deleting a published role yields *Ya no participas* for every
  assignee, from a notice queued by the `DELETE` handler.
- **Unpublish drops both kinds:** a pending `role` notice and a pending `setlist`
  notice are both discarded when the service becomes `published == false`.
- **Past-date drop uses America/Mexico_City**, asserted at 18:00–23:59 local on
  the service date (where a UTC comparison would wrongly drop).
- **Presentation:**
  - `Mov.` is absent from *Setlist listo* and present on *El setlist cambió*.
  - Unmoved rows render `–`, never an empty cell.
  - Removing the 2nd of 5 songs yields `▲1` on the three below it and `SALIÓ` on
    the removed row.
  - A departed song renders inside the table with `–` for position.
  - A key change renders both old and new key.
  - A newly formed medley carries the `NUEVO` chip; a group is never rendered
    with fewer than two songs.
  - Subjects are a constant plus a date, with no content interpolated.
- **Grouping** by recipient across several kinds and services.
- **Preference resolution:** specific field set; specific field unset with legacy
  `email: false`; both unset. Per-line filtering, including "every line filtered
  out → no email".
- **Setlist recipient scoping:** the right role type per setlist kind.
- **Sweep caps:** truncation is reported, not silent.

Integration-level:

- The outbox upsert preserves `before` and `deadline` across repeated writes.
- A failed claim does not send.
- The delivery-firewall transport tests extend to the sweep route.

Both gates must pass before this is done: `npx tsc --noEmit` and `npm test`.

## 11. Risks

- **The sweep is on the critical path of assignment email, and layer 1 is
  genuinely load-bearing.** Today that email is sent in-request; after this change
  it waits for the GitHub workflow, because layer 2 structurally cannot flush the
  terminal edit of a session (§3). If the workflow is broken or disabled, the
  realistic delay is up to 24 hours. Mitigated by the liveness signal, which makes
  that state loud rather than silent — **not** by trigger redundancy, which an
  earlier draft of this spec claimed and which does not hold. The publish email
  stays immediate (§7) precisely because of this.
- **GitHub Actions schedules are unreliable under load.** Accepted: lateness
  delays an email, it does not corrupt one.
- **A duplicate is possible** when a write lands inside the send window. Accepted
  deliberately over losing a notice; the repeat is truthful.
- **Everything is late by design now.** A member who checks email the instant an
  admin saves will see nothing for 15 minutes. That is the trade being bought:
  fewer, denser emails that stay worth opening.
- **"Introduction before modification" has five holes, not one.** The property —
  a member never gets a "changed" email about something they were never told
  about — holds by construction in the normal path, and fails in three ways:
  1. A **swallowed send failure**: *Setlist listo* fails at the transport, the
     notice is deleted, and a later edit produces *El setlist cambió* for a
     setlist never seen.
  2. A **crash between commit and queue**: the outbox upsert is a separate
     post-commit write (§2), so a process death in that gap drops the notice.
  3. **Out-of-order `after()` callbacks** on the same subject: the later write's
     snapshot can win `createIfNotExists`, so a creation whose snapshot records
     the songs yields *El setlist cambió* as the first email.
  4. **Unpublish then republish inside one window swallows *Setlist listo*.**
     `createIfNotExists` preserves the earlier non-empty `before`, so the publish
     path's `before.songs = []` is discarded and the comparison nets to equal.
  5. ~~`before` is per-subject, not per-recipient.~~ **Fixed, cheaply.** A
     member added to a service that already had a setlist would otherwise receive
     *El setlist cambió* — deltas and struck-through departed songs — measured
     against a list they were never sent. An earlier draft accepted this on the
     grounds that fixing it required one outbox document per subject-recipient
     pair. It does not: the notice snapshots its **recipient set** at queue time
     as one extra array, and any recipient absent from it renders *Setlist listo*
     (no `Mov.` column, no `SALIÓ` rows) instead. One field, and a misleading
     email on the normal path disappears.
  Holes 1–3 need delivery receipts and retry and hole 4 needs window-aware
  snapshot invalidation — all materially larger than this spec, so those four are
  accepted, not fixed. Hole 5 turned out to be cheap and is fixed. What matters is
  that they are enumerated rather than asserted away.
- **A weekend setlist saved before its role exists never notifies.** §4 correctly
  queues nothing — there are no participants yet — but nothing re-queues when the
  role later appears, so that setlist's introduction is lost permanently. Rare
  (the editor normally creates the role first) and accepted, but real.
- **Two rendering behaviours are unverified.** Outlook/Windows treatment of the
  key pills, and the four-column table on a narrow phone in Gmail. Both are
  reasoned from known engine behaviour, neither is tested. They are release
  blockers, not design blockers.
