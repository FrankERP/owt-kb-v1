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

## Non-goals

- Push (FCM) behaviour is unchanged everywhere. This spec is about email.
- The `false -> true` publish email is unchanged (see §7).
- No exactly-once delivery guarantee. The existing best-effort posture holds.

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
  _id: `outbox.${kind}.${subjectKey}`,  // deterministic → upsert without a query
  _type: "notificationOutbox",
  kind: "role" | "setlist" | "leadNotes",
  subjectKey: string,

  // Identity, snapshotted at queue time. NOT re-read at flush, because the
  // subject document may be gone by then (a deleted role still owes its
  // assignees a "Ya no participas" whose subject line carries a date).
  serviceDate: string,     // YYYY-MM-DD
  roleType: "sunday_role" | "saturday_role" | "special_role" | null,

  before: {...},           // kind-specific snapshot, taken at the FIRST change
                           // in this window; written once, never overwritten
  firstQueuedAt: string,   // ISO instant
  notifyAfter: string,     // ISO instant, slides: last change + DEBOUNCE
  deadline: string,        // ISO instant, fixed at creation, NEVER rewritten
  status: "pending" | "sending",
  claimedAt: string | null,

  // Per-recipient delivery progress. A setlist notice has N participants and a
  // leadNotes notice has N admins, so one document owes many emails and cannot
  // be deleted until every one of them is served.
  notified: [{ _key, memberId, at }],
  attempts: number,        // failed send passes over this notice
  lastError: string | null,
}
```

| Kind | Subject | `subjectKey` | `before` | Recipients (resolved at flush) |
|---|---|---|---|---|
| `role` | one member's seats on one service | `${memberId}__${roleId}` | `roles: string[]` — seat labels held before | that member (1) |
| `setlist` | one service's song list | `${roleId}` | `songs: [{ref, key}]` + medley partition, ordered | that service's participants (N) |
| `leadNotes` | one proposal's lead notes | `${proposalId}` | `notes: string` | admins (N) |

Two of the three kinds are **one-to-many**. That is why the outbox carries
per-recipient progress and why the notice, not the recipient, is the unit of
claim (see "Claim and delete").

### Classifying a subject that no longer exists

`serviceDate` and `roleType` are snapshotted at queue time and never re-read.
A deleted role still owes its assignees *Ya no participas*, and both the subject
line ("— Domingo 9 ago") and the past-service-date drop rule need a date that no
longer exists anywhere else. Role ids are `randomUUID()` and encode nothing.

The flusher therefore reads live state **when the document exists**, and falls
back to the snapshot when it does not. The drop rules evaluate against whichever
source answered.

`before.roles` holds seat labels (`"Líder"`, `"BGV"`, `"Coro"`, instrument and
FOH labels) — the vocabulary `rolesForMember()` already produces — derived from
the stored role via `normalizeStoredSeats(role)`, which every protected role
writer already loads before it patches. No new read.

### Upsert, on every committed write

Inside the existing post-commit `after()` block, as its **own** transaction on
`writeClient` — never the business transaction (§2):

```
writeClient.transaction()
  .createIfNotExists({ _id, _type: "notificationOutbox", kind, subjectKey,
                       serviceDate, roleType, before, status: "pending",
                       firstQueuedAt: now, deadline: now + MAX_WINDOW,
                       notified: [], attempts: 0, lastError: null })
  .patch(_id, p => p.set({ notifyAfter: now + DEBOUNCE, status: "pending" }))
  .commit()
```

`before` is a value computed **pre-commit** and passed into `after()` — never
read here, where live state is already the post-write state (§2).

`createIfNotExists` is a no-op when a notice already exists, so `before`,
`deadline` and `notified` survive an entire burst of edits. The patch only slides
`notifyAfter` and re-pends. A deterministic `_id` makes the whole thing
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
- **The role document no longer exists.** Classifies as **Ya no participas**.
  Deliberately new behaviour — deleting a published service currently tells its
  participants nothing, and it should.

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
(`app/utils/medley.ts:32`) mints a **fresh** tag for every group on every call,
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
`before.songs` stores the partition, not the tags.

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

**The unit of claim is the notice, not the recipient.** One `setlist` notice owes
an email to every participant and one `leadNotes` notice owes one to every admin.
Claiming per recipient and deleting after "the" send would notify exactly one
participant and discard the rest — a direct failure of the requirement.

Per due notice:

1. **Claim:** `patch(id).ifRevisionId(rev).set({ status: "sending", claimedAt: now })`.
   A failed claim means another sweeper holds it, or a writer slid `notifyAfter`
   mid-claim — skip it.
2. **Resolve recipients** from live state (§4) and subtract those already in
   `notified`.
3. **Send** to each remaining recipient, appending `{_key, memberId, at}` to
   `notified` after each success, so progress survives a mid-batch death.
4. **Settle:**
   - every resolved recipient now in `notified` → **delete** the notice;
   - some remain (sweep cap reached, or sends failed) → set `status: "pending"`,
     bump `attempts`, record `lastError`, and let a later sweep continue.

A notice with more recipients than the per-sweep email budget therefore spans
sweeps and completes, rather than being truncated into silent drops.

**The delete must be a transaction, not a guarded delete.** `delete()` takes no
revision precondition — `ifRevisionId` is a `Patch` method only
(`@sanity/client` `index.d.ts:594,647`). The guarded shape is the one this repo
already uses for the role delete (`app/api/admin/roles/[id]/route.ts:455`): a
revision-asserting no-op patch plus the delete **in one transaction**, so a
notice touched during the send rolls the whole delete back and stays pending.
Without this the interleaving the design exists to catch is silently swallowed.

**`deadline` is written once and never rewritten.** An earlier draft required the
upsert to both preserve `deadline` across a burst and refresh it on a re-pend —
two behaviours on one unconditional `.set()`, which Sanity cannot express and
which two implementers would resolve in opposite, both-plausible ways. The rule
is now single: `createIfNotExists` writes `deadline`, nothing else touches it. A
notice re-pended after its ceiling has passed is immediately due again, and the
accepted duplicate arrives on the next sweep rather than after a fresh window.
That is the correct trade — the ceiling exists to force delivery, and it has
already fired once.

`before` is preserved throughout, so any repeat is a truthful superset rather
than a wrong message.

### Giving up

A notice that can never produce an email must die, or it is immortal: its lease
expires every few minutes, it is due again forever, it permanently consumes part
of the sweep budget, and it holds the liveness alarm (§3) permanently red — which
destroys the only mitigation for layer 1 being load-bearing.

A notice is **deleted with one structured error line** when any of:

- `attempts >= NOTIFY_MAX_ATTEMPTS` (default 5) — e.g. a member with a
  malformed address that nodemailer rejects on every pass;
- `firstQueuedAt` is older than `NOTIFY_MAX_AGE_HOURS` (default 24);
- **zero lines survive** classification or preference filtering — a `setlist`
  notice whose only participant set `emailSetlist: false` has nothing to say and
  must not linger. §1 "Grouping" says no email is sent; this says the notice is
  also dropped.

Sweeps order due notices by `firstQueuedAt` **ascending, excluding notices whose
`attempts` exceed the others'** — a repeatedly-failing notice must not
head-of-line block healthy ones behind it.

### Bounding the sweep

The budget is arithmetic, not assertion. SMTP here is a **pooled transport with
`maxConnections: 1`** (`app/utils/email.ts:16`), so sends are serialized. The
route declares `export const maxDuration = 60`, matching every other admin route
in this repo.

| Knob | Default | Why |
|---|---|---|
| `NOTIFY_FLUSH_LIMIT` | 200 | Notices *classified* — cheap, a few GROQ reads |
| `NOTIFY_FLUSH_EMAIL_LIMIT` | 12 | Emails *sent* — at a conservative 2 s per serialized send that is ~24 s, leaving over half the 60 s budget for reads, claims and deletes |
| `NOTIFY_CLAIM_TTL` | 5 min | Comfortably longer than any legitimate sweep, short enough that a crashed sweep recovers within two cron ticks |

Layer 2 (the opportunistic sweep inside an admin's save) runs with part of the
invocation budget already spent, so it uses **half** the email limit.

When either cap truncates the batch, the sweep logs one structured line naming
how many notices were left behind, and the next sweep picks them up. Silent
truncation is not acceptable — a partially-notified team must be visible in the
logs.

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
   burst keeps sliding `notifyAfter` forward, this can never flush the subject
   the admin is *currently* editing — that is the safety property, and it is also
   the limit. What it does cover is the cross-subject case: an admin who edits
   service A, then twenty minutes later edits service B, flushes A. Useful, but
   never sufficient on its own.
3. **Last resort — the existing daily Vercel cron.** `/api/cron/service-reminders`
   calls the same sweep, so nothing can sit pending for more than a day even if
   both other triggers are broken.

The sweep is one exported function; the three triggers are three thin callers.

### Liveness signal

Because layer 1 is load-bearing and can fail silently, the daily cron reports
the **oldest pending `firstQueuedAt`** on every run. An outbox entry older than
`NOTIFY_STALE_ALERT_HOURS` (default 6) emits a loud structured error line naming
the count and the oldest age.

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

### Two date-move behaviours, stated rather than discovered

`PATCH /api/admin/roles/[id]` supports moving a service to another date, and the
`setlist` `subjectKey` is `${roleId}`, which survives the move. Two consequences:

- A pending `setlist` notice queued before the move resolves live songs from the
  **new** week at flush, reporting a "change" that is really a different
  service's setlist. The notice therefore stores `serviceDate` at queue time, and
  a notice whose live service date no longer matches its snapshot is **dropped** —
  the subject moved out from under it.
- A date move alone classifies as `equal → equal` for every member, so **moving a
  published service notifies nobody**. That matches today's behaviour and is not
  a regression, but every subject line carries a date, so it is recorded here as
  an explicit non-goal rather than left as an artifact for someone to rediscover.

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
`PATCH /api/admin/members/[id]`, and `proposalNotify.ts` (to read
`emailProposals` instead of raw `notifPrefs.email`).

Delivery is gated in this order, unchanged from today except for the pref step:
valid email → `EMAIL_ALLOWLIST` → per-type preference → `EMAIL_REDIRECT_TO`
override → `sendEmail`.

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
(`app/utils/setlistWriteRequest.ts:164`), and `buildRuns` will happily emit a
one-song `medley` run from stored data. `DayCard.tsx:156` already defends against
exactly this, and with 275 imported history documents in the catalog the
defensive case is real, not theoretical. A one-song group renders as a plain
single, with no spine and no label.

### Palette and type

Colors come from `brand.css`: `blackout` field, `deck` panels, `beam` accent and
links, `signal` for additions and upward movement, `frost` primary text, `steel`
secondary. One exception, deliberate and approved: **`#F5B437` amber for
downward movement**. Red would read as an error, and a song moving later is not
an error; `steel` was rejected because up and down stop being distinguishable at
a glance. It is the only value in the email system not traceable to a token.

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
  (`studioProtection.ts:182`), and `studioProtection.test.ts:119` asserts every
  `INTERNAL_STUDIO_TYPES` entry's create mechanism contains `"hidden"`, which a
  delete-only type cannot produce. Implementation must restructure
  `studioCapability` so the two properties compose, and extend the test to assert
  the new combination. Treating this as "append to both lists" will fail `npm test`.
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
  (`protectedReadAudit.ts:186`). Register the writers; do not touch the read side.
- **`maxDuration` on the layer-2 hosts.** The roles routes declare
  `export const maxDuration = 60`; `app/api/admin/setlists/route.ts`,
  `app/api/admin/proposals/[id]/route.ts` and `app/api/me/proposals/route.ts`
  declare none. Since the opportunistic sweep runs in their `after()` blocks, all
  three must declare it too, or serialized SMTP sends can outrun the default
  budget on exactly the routes that trigger setlist emails.
- **The GitHub workflow is new infrastructure.** `.github/workflows/` does not
  exist in this repo; layer 1 is not an extension of an existing pattern. Only
  the `CRON_SECRET` header convention is borrowed, from
  `app/api/cron/service-reminders/route.ts:13`.
- **Client split.** Reads in the sweep use `operationalClient` (published
  perspective). Outbox writes use `writeClient` — `operationalClient` carries a
  read token only (`sanity/lib/operationalClient.ts:22`).
- **Delivery firewall.** Everything routes through `sendEmail`, so A3's
  transport-level refusal covers the new paths unchanged. The sweep route is
  included: a verification run must not mail the team. Note that a blocked
  `sendEmail` returns `{ ok: false }` rather than throwing (`email.ts:38`), so the
  sweep must treat a falsy `ok` as a failed send and **not** delete the notice —
  otherwise a verification run would silently consume the real outbox.
- **`_key`.** Any array-of-object field written to the outbox carries a `_key`.
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
| `NOTIFY_FLUSH_LIMIT` | `200` | Max notices classified per sweep |
| `NOTIFY_FLUSH_EMAIL_LIMIT` | `12` | Max recipients emailed per sweep; halved for the layer-2 sweep |
| `NOTIFY_MAX_ATTEMPTS` | `5` | Failed send passes before a notice is dropped |
| `NOTIFY_MAX_AGE_HOURS` | `24` | Absolute age after which a notice is dropped |
| `NOTIFY_STALE_ALERT_HOURS` | `6` | Oldest pending age that triggers the liveness error line |
| `CRON_SECRET` | — | Already present; now also authorizes the sweep route |

`NOTIFY_STALE_ALERT_HOURS` (6) sits below `NOTIFY_MAX_AGE_HOURS` (24) on purpose:
a genuinely stuck outbox raises the alarm well before it starts silently
discarding notices.

## 10. Testing

Pure logic, unit-tested (vitest):

- **`role` classification:** each of the four before/after cases, plus the
  deleted-role case (sends "Ya no participas"), the unpublished-role case (drops
  silently) and the past-date case (drops silently).
- **`setlist` classification:** empty → non-empty is "listo"; a reorder, a
  `play_key` change and a `medley_tag` change each count as changed; a
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
  and is deleted once; with more participants than the sweep's email budget it
  sends a prefix, survives, and completes on the next sweep with **no recipient
  emailed twice and none skipped**. This is the test that would have caught the
  notify-one-participant-then-delete bug.
- **Giving up:** a notice hits `NOTIFY_MAX_ATTEMPTS` and is deleted with an error
  line; one past `NOTIFY_MAX_AGE_HOURS` is deleted; one whose recipients all
  filtered out is deleted rather than left immortal; a repeatedly-failing notice
  does not head-of-line block healthy ones.
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
  regrouping with identical tags-per-song count classifies as *changed*. `NUEVO`
  attaches only to a group whose adjacent-song set was not a group in `before`.
- **Publish announces the setlist:** a draft service with songs, then published,
  yields *Setlist listo*; published with no songs yields no email.
- **Deletion:** deleting a published role yields *Ya no participas* for every
  assignee, from a notice queued by the `DELETE` handler.
- **Unpublish drops both kinds:** a pending `role` notice and a pending `setlist`
  notice are both discarded when the service becomes `published == false`.
- **Past-date drop uses America/Mexico_City**, asserted at 18:00–23:59 local on
  the service date (where a UTC comparison would wrongly drop).
- **Re-pended notice gets a fresh `deadline`**, so a write during the send window
  produces the duplicate after a quiet window rather than on the next sweep.
- **A blocked `sendEmail` (`ok: false`) does not delete the notice.**
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
- **"Introduction before modification" has three holes, not one.** The property —
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
  4. **`before` is per-subject, not per-recipient** — and this one is on the
     normal path, not an exceptional one. A member added to a service that
     already has a setlist, followed by any setlist edit inside the window,
     receives *El setlist cambió* with `▲`/`▼` deltas and struck-through departed
     songs, measured against a list they were never sent. Fixing it properly
     means per-recipient snapshots, which changes the outbox from one document
     per subject to one per subject-recipient pair.
  All four need machinery materially larger than this spec — delivery receipts
  and retry for 1–3, per-recipient snapshots for 4 — so they are accepted, not
  fixed. What matters is that they are four and enumerated, rather than one and
  asserted.
- **Two rendering behaviours are unverified.** Outlook/Windows treatment of the
  key pills, and the four-column table on a narrow phone in Gmail. Both are
  reasoned from known engine behaviour, neither is tested. They are release
  blockers, not design blockers.
