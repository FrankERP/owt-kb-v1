# Service notification emails — design

**Date:** 2026-07-27
**Status:** approved (design), not implemented

## Problem

Two gaps in member-facing email:

1. **Setlist.** When a service's setlist appears or changes, members who serve
   that service get a push and no email. The proposal-approval path writes the
   live setlist and sends nothing at all about the setlist.
2. **Role changes.** Being *added* to a published service emails the member.
   Being **removed** is silent by design (`serviceMutationSideEffects.ts` §7),
   and a **role change inside the same service** (BGV → Líder, guitarra → bajo)
   is also silent, because `addedAssignees()` diffs member ids, not seats.

## Non-goals

- Push (FCM) behaviour is unchanged everywhere. This spec is about email.
- The `false -> true` publish email is unchanged (see "Publish stays immediate").
- No exactly-once delivery guarantee. The existing best-effort posture holds.

## Decisions taken during design

| Question | Decision |
|---|---|
| Setlist noise | First setlist emails automatically; later edits email only when an admin presses **"Notificar al equipo"** |
| Role-change noise | 15-minute per-member debounce; one grouped email once the member's changes go quiet |
| Preferences | Four independent per-type toggles |
| Vercel plan | Hobby — one cron/day, so the sweep needs an external trigger |
| Publish | Stays immediate, outside the debounce |

---

## 1. The outbox

A new Sanity document type, `notificationOutbox`. One document per
**(member, role)** pair, holding a pending role-change notice.

```ts
{
  _id: `outbox.${memberId}__${roleId}`,   // deterministic → upsert without a query
  _type: "notificationOutbox",
  member: string,          // teamMembers._id
  roleId: string,
  roleType: "sunday_role" | "saturday_role" | "special_role",
  serviceDate: string,     // YYYY-MM-DD
  beforeRoles: string[],   // seat labels the member held BEFORE the first change
                           // in this window; written once, never overwritten
  firstQueuedAt: string,   // ISO instant
  notifyAfter: string,     // ISO instant = last change + NOTIFY_DEBOUNCE_MINUTES
  status: "pending" | "sending",
}
```

`beforeRoles` holds seat labels (`"Líder"`, `"BGV"`, `"Coro"`, instrument and
FOH labels) — the same vocabulary `rolesForMember()` already produces. It is
derived from the stored role document via `normalizeStoredSeats(role)`, which
every protected role writer already loads before it patches. No new read.

### Upsert, on every committed role write

Inside the existing post-commit `after()` block, for each member touched by the
write (the union of before-assignees and after-assignees):

```
tx.createIfNotExists({ _id, ...notice, beforeRoles, status: "pending", firstQueuedAt: now })
  .patch(_id, p => p.set({ notifyAfter: now + DEBOUNCE, status: "pending" }))
```

`createIfNotExists` is a no-op when a notice already exists, so `beforeRoles`
survives an entire burst of edits. The patch only pushes the deadline out. A
deterministic `_id` makes the whole thing idempotent: an HTTP retry that replays
the same commit produces the same document.

Draft services stay silent, exactly as today: nothing is queued unless
`published !== false`.

Two boundaries worth stating, because both are easy to get wrong:

- **Creating an already-published service queues** rather than emailing
  immediately. Any seat write debounces, with no exception carved out for
  creation — admins routinely create a service and then adjust it, and a carve-out
  would produce exactly the "asignado now, cambió later" double email this design
  exists to prevent.
- **The publish route queues nothing.** A `false -> true` transition writes no
  seats, so there is nothing to queue; it emails immediately via
  `notifyRolePublished()` (§5).

### Flush: classify from live state

A due notice is one with `status == "pending"` and `notifyAfter <= now`.

For each due notice the flusher reads the **live** role document, computes the
member's current seat labels, and compares against `beforeRoles`:

| before | after | Result |
|---|---|---|
| empty | non-empty | **Nueva asignación** |
| non-empty | empty | **Ya no participas** |
| non-empty, different | non-empty | **Tu rol cambió** — "Ahora: Líder (antes: BGV)" |
| equal | equal | **no email** — the notice is dropped |

Reading live state at send time (rather than storing the "after" at write time)
buys two properties for free: the email is never stale, and remove-then-re-add
inside the window collapses to silence.

Two cases resolve outside the table:

- **The role is now `published == false`.** The notice is **dropped**. An
  unpublish is silent today and stays silent; making it speak only when a notice
  happened to be pending would be arbitrary.
- **The role document no longer exists.** The notice classifies as **Ya no
  participas**. This is deliberately new behaviour — deleting a published service
  currently tells its participants nothing, and it should.

A notice whose service date is already in the past is dropped without sending.

Subjects follow the existing assignment-email voice: *"Nueva asignación —
Domingo 9 ago"*, *"Tu rol cambió — Domingo 9 ago"*, *"Ya no participas —
Domingo 9 ago"*. A grouped email covering several services uses
*"Cambios en tus servicios"*, mirroring `buildBatchAssignmentEmail()`, which
already falls back to the single-service template for a one-item list.

### Grouping

After classification, surviving notices are grouped **by member**. One member
with changes across three services gets one email listing three lines. This is
the whole point of the debounce.

Per-line preference filtering happens after grouping: each line is checked
against the toggle for *its* classification, and if no line survives, no email
is sent.

### Claim and delete

Three independent triggers can sweep concurrently, so claiming is guarded:

1. `patch(id).ifRevisionId(rev).set({ status: "sending", claimedAt })`.
   A failed claim means another sweeper got it, or a writer bumped
   `notifyAfter` mid-claim — either way, skip it.
2. Send.
3. `delete(id).ifRevisionId(claimedRev)`.

Step 3 is revision-guarded on purpose. If a role write lands during the send, it
sets `status` back to `pending` with a fresh deadline, the delete fails, and the
notice is re-sent later. `beforeRoles` is preserved, so the repeat is a truthful
superset rather than a wrong message. This trades a rare duplicate for never
losing a notice, which is the right way round for "you were removed from
Sunday".

### Bounding the sweep

A sweep processes at most `NOTIFY_FLUSH_LIMIT` notices (default 200) and emails
at most `NOTIFY_FLUSH_EMAIL_LIMIT` members (default 50), so a Hobby function
cannot run past its limit. When either cap truncates the batch, the sweep logs
one structured line naming how many notices were left behind, and the next sweep
picks them up. Silent truncation is not acceptable — a partially-notified team
must be visible in the logs.

---

## 2. Flush triggers — three layers

Vercel Hobby allows one cron per day, so the primary trigger lives outside
Vercel. No single trigger is load-bearing:

1. **Primary — GitHub Actions, every 5 minutes.** A workflow in this repo curls
   `GET /api/cron/flush-notifications` with a shared secret in an `Authorization`
   header (`CRON_SECRET`, same pattern as the existing service-reminders cron).
   Chosen over a third-party scheduler because it is versioned in the repo and
   needs no external account. GitHub's scheduled runs are routinely 5–15 minutes
   late; that only makes an email later, never wrong.
2. **Backstop — opportunistic sweep.** Every protected role/setlist write already
   runs an `after()` block; it also sweeps due notices. Since any in-flight
   reshuffle pushes `notifyAfter` forward, an admin's own writes can never flush
   their own unfinished work. In practice the admin making the changes is the one
   who triggers delivery.
3. **Last resort — the existing daily Vercel cron.** `/api/cron/service-reminders`
   calls the same sweep, so nothing can sit pending for more than a day even if
   both other triggers are broken.

The sweep is one exported function; the three triggers are three thin callers.

---

## 3. Setlist emails

### First setlist — automatic

"First setlist" is the transition from **zero songs to at least one song** for a
service, not "the setlist document was created". A `special_role` is its own
setlist target and can exist with an empty `songs` array, so a
document-creation test would miss it.

Both writers that can produce that transition send the email:

- `POST /api/admin/setlists` — the manual save.
- `POST /api/admin/proposals/[id]` (approve) — writes the live setlist today and
  currently sends nothing about it.

Subject: *"Setlist listo — Domingo 9 ago"*. The email lists the songs and links
to the service.

### Later edits — the "Notificar al equipo" button

`SetlistEditor.tsx` gains a **Notificar al equipo** button, shown only once a
setlist exists. It posts to a new manager-gated route which emails participants
*"El setlist cambió"*. There is no automatic email on edit and no stored state.

The button follows the client-mutation invariant: `try/catch/finally`, checks
`res.ok`, resets its loading flag, and never reports success on failure. It asks
for confirmation before sending, since it mails real people.

### Recipients

Participants of **that** service — not the whole team. Resolved from committed
canonical state through `assignedMemberRefsQuery()` so all five seat paths are
covered, scoped to the role type the setlist belongs to:

| Setlist | Role type queried |
|---|---|
| `featuredSongs` (Sunday) | `sunday_role` for that week |
| `saturdarSongs` (Saturday) | `saturday_role` for that week |
| `special_role` | that role document itself |

The existing setlist **push** audience (`notifPrefs.setlist` = all/assigned/off,
default "all", i.e. the whole team) is unchanged. Email is narrower on purpose:
the request is "a service the user participates in".

---

## 4. Preferences — four toggles

New boolean fields on `notifPrefs`, all defaulting to `true`:

| Field | Covers |
|---|---|
| `emailAssigned` | Nueva asignación |
| `emailRemoved` | Ya no participas |
| `emailRoleChanged` | Tu rol cambió |
| `emailSetlist` | Both setlist emails (first + manual notify) |

**Legacy fallback, no data migration.** Resolution for a given type is: if the
specific field is a boolean, use it; otherwise fall back to
`notifPrefs.email !== false`. A member who already opted out of
`notifPrefs.email` stays opted out of all four and nobody starts receiving mail
they had switched off. The legacy `email` field stays in the schema as that
fallback and leaves the member-facing UI.

Surfaces to update: `sanity/schemas/worshipTeam.ts`, `ProfilePanel.tsx`,
`AdminPanel.tsx` (admin editing another member), `PATCH /api/me/notif-prefs`,
`PATCH /api/admin/members/[id]`.

Delivery is gated in this order, unchanged from today except for the pref step:
valid email → `EMAIL_ALLOWLIST` → per-type preference → `EMAIL_REDIRECT_TO`
override → `sendEmail`.

---

## 5. Publish stays immediate

`notifyRolePublished()` keeps sending its consolidated email at publish time,
outside the outbox. Publishing is a deliberate single click, the email is
already batched per member, and that path is verified in production. Routing it
through the outbox would unify the code at the cost of delaying the single most
important email by 15 minutes and disturbing shipped A2/A3 behaviour.

The interaction is coherent: publish at T emails "nueva asignación"; an edit at
T+2min queues a notice that, 15 minutes after the edits stop, emails "tu rol
cambió".

**`notifyRoleAssignments()` loses its email leg.** Its immediate assignment
email is fully absorbed by the outbox — otherwise one edit produces "te
asignaron" now and "tu rol cambió" fifteen minutes later. Its push leg is
unchanged, so members still get an immediate in-app signal.

---

## 6. Integration constraints

- **Studio protection.** `notificationOutbox` is internal coordination state,
  written only by the server write token. It joins `INTERNAL_STUDIO_TYPES`
  (hidden, no create affordance) and `DELETE_ONLY_STUDIO_TYPES` (pruning is
  legitimate operator work, hand-authoring is not), alongside `loginEvent`,
  `roleTargetLock` and `roleCreationReceipt`. `studioProtection.test.ts` enforces
  this.
- **Read audit.** The outbox is not a protected content type, so it does not
  join `PROTECTED_TYPES` in `protectedReadAudit.ts`. The new sweep route reads
  protected role documents, so it must use `operationalClient` and be registered
  the way every other protected reader is.
- **Delivery firewall.** Everything routes through `sendEmail`, so A3's
  transport-level refusal covers the new paths with no change. The sweep route
  is included: a verification run must not mail the team.
- **`_key`.** Any array-of-object field written to the outbox carries a `_key`.
- **Timezone.** `notifyAfter` and `firstQueuedAt` are instants — no calendar
  arithmetic, no DST trap. Every rendered service date keeps the local-noon rule:
  `new Date(iso.slice(0,10) + "T12:00:00")`.
- **Cache.** Nothing here changes content, so no `revalidate*` call is added.
- **Schema deploy.** The new document type and the four `notifPrefs` fields need
  a Sanity schema deploy before the Studio reflects them.

## 7. Configuration

| Name | Default | Meaning |
|---|---|---|
| `NOTIFY_DEBOUNCE_MINUTES` | `15` | Quiet period before a member's notices flush |
| `NOTIFY_FLUSH_LIMIT` | `200` | Max notices classified per sweep |
| `NOTIFY_FLUSH_EMAIL_LIMIT` | `50` | Max members emailed per sweep |
| `CRON_SECRET` | — | Already present; now also authorizes the sweep route |

## 8. Testing

Pure logic, unit-tested (vitest):

- Classification: each of the four before/after cases, plus the equal-case no-op,
  the deleted-role case (sends "Ya no participas"), the unpublished-role case
  (drops silently) and the past-date case (drops silently).
- Grouping by member across several services.
- Preference resolution: specific field set, specific field unset with legacy
  `email: false`, unset with legacy unset.
- Per-line preference filtering, including "every line filtered out → no email".
- First-setlist detection: zero → non-zero for a created document and for an
  existing empty `special_role`; non-zero → non-zero is not "first".
- Setlist recipient scoping: the right role type per setlist kind.
- Sweep caps: truncation is reported, not silent.
- Debounce arithmetic against a fixed clock.

Integration-level:

- The outbox upsert preserves `beforeRoles` across repeated writes.
- A failed claim does not send.
- The delivery-firewall transport tests extend to the sweep route.

Both gates must pass before this is done: `npx tsc --noEmit` and `npm test`.

## 9. Risks

- **The sweep is now on the critical path of assignment email.** Today that
  email is sent in-request; after this change it depends on a trigger firing.
  Mitigated by three independent triggers, the strongest of which (the
  opportunistic sweep) runs inside the app itself.
- **GitHub Actions schedules are unreliable under load.** Accepted: lateness
  delays an email, it does not corrupt one, and layer 2 covers the active case.
- **A duplicate is possible** when a role write lands inside the send window.
  Accepted deliberately over losing a notice; the repeat is truthful.
