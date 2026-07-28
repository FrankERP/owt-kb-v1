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
  before: {...},           // kind-specific snapshot, taken at the FIRST change
                           // in this window; written once, never overwritten
  firstQueuedAt: string,   // ISO instant
  notifyAfter: string,     // ISO instant, slides: last change + DEBOUNCE
  deadline: string,        // ISO instant, fixed: firstQueuedAt + MAX_WINDOW
  status: "pending" | "sending",
}
```

| Kind | Subject | `subjectKey` | `before` | Recipients (resolved at flush) |
|---|---|---|---|---|
| `role` | one member's seats on one service | `${memberId}__${roleId}` | `roles: string[]` — seat labels held before | that member |
| `setlist` | one service's song list | `${roleId}` | `songs: {ref, key, medley}[]` — ordered | that service's participants |
| `leadNotes` | one proposal's lead notes | `${proposalId}` | `notes: string` | admins |

`before.roles` holds seat labels (`"Líder"`, `"BGV"`, `"Coro"`, instrument and
FOH labels) — the vocabulary `rolesForMember()` already produces — derived from
the stored role via `normalizeStoredSeats(role)`, which every protected role
writer already loads before it patches. No new read.

### Upsert, on every committed write

Inside the existing post-commit `after()` block:

```
tx.createIfNotExists({ _id, kind, subjectKey, before, status: "pending",
                       firstQueuedAt: now, deadline: now + MAX_WINDOW })
  .patch(_id, p => p.set({ notifyAfter: now + DEBOUNCE, status: "pending" }))
```

`createIfNotExists` is a no-op when a notice already exists, so `before` and
`deadline` survive an entire burst of edits. The patch only slides
`notifyAfter`. A deterministic `_id` makes the whole thing idempotent: an HTTP
retry replaying the same commit produces the same document.

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

A notice is due when `status == "pending"` and
`min(notifyAfter, deadline) <= now`.

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

**`setlist`** — the current ordered list of `(song._ref, play_key, medley_tag)`
vs `before.songs`:

| before | after | Result |
|---|---|---|
| empty | non-empty | **Setlist listo** — lists the songs |
| non-empty, different | non-empty | **El setlist cambió** — lists the songs |
| non-empty | empty | **no email** — an emptied setlist is work in progress, not news |
| equal | equal | **no email** |

`medley_tag` is part of the comparison on purpose: regrouping three songs into a
medley changes the arrangement the team rehearses even though the song list is
identical. `team_notes` is **not** part of it — editing the message to the team
without touching the songs notifies nobody.

**`leadNotes`** — the proposal's current `lead_notes` vs `before.notes`. Equal
(after trimming) means no email. A notice on a proposal that is no longer
reviewable — `draft`, `approved`, or deleted — is dropped.

A notice whose service date has already passed is dropped without sending.

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

Three independent triggers can sweep concurrently, so claiming is guarded:

1. `patch(id).ifRevisionId(rev).set({ status: "sending", claimedAt })`.
   A failed claim means another sweeper got it, or a writer slid `notifyAfter`
   mid-claim — either way, skip it.
2. Send.
3. `delete(id).ifRevisionId(claimedRev)`.

Step 3 is revision-guarded on purpose. If a write lands during the send, it sets
`status` back to `pending` with a fresh deadline, the delete fails, and the
notice is re-sent later. `before` is preserved, so the repeat is a truthful
superset rather than a wrong message. That trades a rare duplicate for never
losing a notice, which is the right way round for "you were removed from
Sunday".

### Bounding the sweep

A sweep classifies at most `NOTIFY_FLUSH_LIMIT` notices (default 200) and emails
at most `NOTIFY_FLUSH_EMAIL_LIMIT` recipients (default 50), so a Hobby function
cannot run past its limit. When either cap truncates the batch, the sweep logs
one structured line naming how many notices were left behind, and the next sweep
picks them up. Silent truncation is not acceptable — a partially-notified team
must be visible in the logs.

---

## 2. What queues a notice

| Writer | Queues |
|---|---|
| `POST /api/admin/roles` (create) | `role`, for each initial assignee, when published |
| `PATCH /api/admin/roles/[id]` | `role`, for each member in the union of before- and after-assignees |
| `POST /api/admin/roles/swap` | same |
| `POST /api/admin/roles/copy-instruments` | same |
| `POST /api/admin/setlists` | `setlist`, for the target service |
| `POST /api/admin/proposals/[id]` (approve) | `setlist`, for the service it just wrote |
| `POST /api/me/proposals` | `leadNotes`, when `lead_notes` changed and the proposal is `pending` or `changes_requested` |

Draft services stay silent, exactly as today: nothing is queued unless
`published !== false`.

Three boundaries worth stating, because each is easy to get wrong:

- **Creating an already-published service queues** rather than emailing
  immediately. Any seat write debounces, with no carve-out for creation — admins
  routinely create a service and then adjust it, and a carve-out would produce
  exactly the "asignado now, cambió later" double email this design exists to
  prevent.
- **The publish route queues nothing.** A `false -> true` transition writes no
  seats, so there is nothing to queue; it emails immediately (§7).
- **Lead notes on a `draft` proposal are silent.** The proposal is not in front
  of admins yet, so there is nothing for them to act on.

---

## 3. Flush triggers — three layers

Vercel Hobby allows one cron per day, so the primary trigger lives outside
Vercel. No single trigger is load-bearing:

1. **Primary — GitHub Actions, every 5 minutes.** A workflow in this repo curls
   `GET /api/cron/flush-notifications` with a shared secret in an `Authorization`
   header (`CRON_SECRET`, the pattern the existing service-reminders cron already
   uses). Chosen over a third-party scheduler because it is versioned in the repo
   and needs no external account. GitHub's scheduled runs are routinely 5–15
   minutes late; that makes an email later, never wrong.
2. **Backstop — opportunistic sweep.** Every protected role/setlist/proposal
   write already runs an `after()` block; it also sweeps due notices. Since an
   in-flight burst keeps sliding `notifyAfter` forward, an admin's own writes can
   never flush their own unfinished work. In practice the admin making the
   changes is the one who triggers delivery.
3. **Last resort — the existing daily Vercel cron.** `/api/cron/service-reminders`
   calls the same sweep, so nothing can sit pending for more than a day even if
   both other triggers are broken.

The sweep is one exported function; the three triggers are three thin callers.

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

`leadNotes` recipients are the active members whose role is `admin` or
`super-admin`, resolved at flush the same way `proposalNotify.ts` already
resolves its admin audience.

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

`normalizeMedleyTags` clears a lone tag — a medley is always ≥2 songs — so the
group treatment never has to render a degenerate case.

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

- **Studio protection.** `notificationOutbox` is internal coordination state,
  written only by the server write token. It joins `INTERNAL_STUDIO_TYPES`
  (hidden, no create affordance) and `DELETE_ONLY_STUDIO_TYPES` (pruning is
  legitimate operator work, hand-authoring is not), alongside `loginEvent`,
  `roleTargetLock` and `roleCreationReceipt`. `studioProtection.test.ts` enforces
  this.
- **Read audit.** The outbox is not a protected content type, so it does not join
  `PROTECTED_TYPES` in `protectedReadAudit.ts`. The sweep reads protected role,
  setlist and proposal documents, so it must use `operationalClient` and be
  registered the way every other protected reader is.
- **Delivery firewall.** Everything routes through `sendEmail`, so A3's
  transport-level refusal covers the new paths unchanged. The sweep route is
  included: a verification run must not mail the team.
- **`_key`.** Any array-of-object field written to the outbox carries a `_key`.
- **Timezone.** `notifyAfter`, `deadline` and `firstQueuedAt` are instants — no
  calendar arithmetic, no DST trap. Every rendered service date keeps the
  local-noon rule: `new Date(iso.slice(0,10) + "T12:00:00")`.
- **Cache.** Nothing here changes content, so no `revalidate*` call is added.
- **Schema deploy.** The new document type and the five `notifPrefs` fields need
  a Sanity schema deploy before the Studio reflects them.

## 9. Configuration

| Name | Default | Meaning |
|---|---|---|
| `NOTIFY_DEBOUNCE_MINUTES` | `15` | Quiet period before a subject's notice flushes |
| `NOTIFY_MAX_WINDOW_MINUTES` | `60` | Hard ceiling from first queue; defeats starvation |
| `NOTIFY_FLUSH_LIMIT` | `200` | Max notices classified per sweep |
| `NOTIFY_FLUSH_EMAIL_LIMIT` | `50` | Max recipients emailed per sweep |
| `CRON_SECRET` | — | Already present; now also authorizes the sweep route |

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

- **The sweep is now on the critical path of assignment email.** Today that email
  is sent in-request; after this change it depends on a trigger firing. Mitigated
  by three independent triggers, the strongest of which (the opportunistic sweep)
  runs inside the app itself.
- **GitHub Actions schedules are unreliable under load.** Accepted: lateness
  delays an email, it does not corrupt one, and layer 2 covers the active case.
- **A duplicate is possible** when a write lands inside the send window. Accepted
  deliberately over losing a notice; the repeat is truthful.
- **Everything is late by design now.** A member who checks email the instant an
  admin saves will see nothing for 15 minutes. That is the trade being bought:
  fewer, denser emails that stay worth opening.
- **A swallowed send failure can invert the introduction rule.** If *Setlist
  listo* fails at the transport and is logged and dropped, the notice is gone; a
  later edit then produces *El setlist cambió* for a setlist the member never
  saw. Closing this needs delivery receipts and retry — a materially larger build
  than this spec — so it is accepted, not fixed. It is the one hole in the
  otherwise-guaranteed "introduction before modification" property.
- **Two rendering behaviours are unverified.** Outlook/Windows treatment of the
  key pills, and the four-column table on a narrow phone in Gmail. Both are
  reasoned from known engine behaviour, neither is tested. They are release
  blockers, not design blockers.
