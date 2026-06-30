# Design — Draft / Publish workflow for services

Date: 2026-06-30
Status: Approved (pending adversarial review)

## Summary

Services (`sunday_role` / `saturday_role` / `special_role`) gain a `published`
flag. New services are created **as drafts by default**; drafts are visible only
to admins in the Servicios panel. Admins publish them — one-by-one, or "Publicar
todo" for the current month filter — to make them visible to the whole team.
Publishing is a reversible toggle.

### Core invariant (the spine of this feature)

> **A member learns about a service's ROLE — who is assigned (Lead / BGV / Coro /
> instruments / FOH) — in the app UI, in push, in email, and in the reminder cron
> — ONLY once that service is published.**

The invariant is scoped to the **role documents** (the assignments). Role
visibility and role-assignment notifications are gated by the same `published`
state. Nothing member-facing ever surfaces a draft service's *assignments*.

**Deliberately out of scope (separate follow-up): the setlist channel.** A
service's *songs* live in separate `featuredSongs` / `saturdarSongs` documents
keyed by the same `week`, written by the existing Lead-proposes → admin-approves
setlist flow. Those documents (a) render on home/schedule by week independent of
the role doc, and (b) trigger a "setlist ready" push from
`PUT /api/admin/setlists`. This spec does NOT gate that channel, for three
reasons: (1) songs are chosen by the assigned people, so a published setlist
without a published role is an unusual transient state, not the normal flow;
(2) gating it correctly means coordinating with the existing setlist
proposal/approval system, which deserves its own design; (3) keeping this change
to role visibility limits the blast radius. A follow-up spec will coordinate
setlist visibility/notification with role `published` state. This is an explicit,
reasoned exemption — not a gap — so the invariant above is stated for *role
assignments*, which it fully covers.

## Data model

Add a boolean `published` field to all three role schemas
(`sanity/schemas/sunRole.ts`, `satRole.ts`, `specialRole.ts`):

```ts
{ name: "published", title: "Publicado", type: "boolean", initialValue: true,
  description: "Si está apagado, el servicio es un borrador visible solo para admins." }
```

- `initialValue: true` so Sanity-Studio-created docs are published (intentional).
- API-created docs set `published` explicitly (default `false`, see Create flow).
- **Existing docs have no field.** Member-facing queries treat *missing* as
  published (grandfathered), so nothing currently visible disappears.

## Visibility — the draft filter

Member-facing reads add `&& published != false` to each role query. `!= false`
matches `true` AND missing (grandfathered) and excludes only explicit `false`.

The complete member-facing surface is **7 files / 18 query clauses** (re-derived by
grepping every `sunday_role`/`saturday_role`/`special_role` occurrence AND the two
`_id`-based role reads that carry no type literal). ALL must get the filter:

1. `app/(client)/page.tsx` — `WEEKEND_QUERY` sunRole/satRole/special — lines 53, 54, 55 (3)
2. `app/(client)/schedule/page.tsx` — `SCHEDULE_QUERY` 3 role queries — lines 32, 33, 36 (3)
3. `app/(client)/me/page.tsx` — 3 member-assignment reads (67, 85, 103) **and 3
   calendar-date reads (129, 130, 131)**. The calendar-date reads have no
   `memberFilter` and return ALL service dates — they MUST be filtered too, so a
   draft's date never appears on a member's availability calendar. (6)
4. `app/(client)/me/propose/[roleId]/page.tsx` — `getRoleDoc()` — line 14 (1)
5. `app/api/me/proposals/route.ts` — lead verification (queries by `_id` + `Lead`
   membership, no type literal) — line 51 (1)
6. `app/api/cron/service-reminders/route.ts` — reminder recipient reads — lines 13, 14, 15 (3)
7. `app/api/song/[id]/route.ts` — the song-history `leaders` sub-query joins the
   matching `sunday_role`/`saturday_role` by week to show who led; an upcoming
   draft + its setlist would leak its leads here. Add `&& published != false`
   **inside the inner role filter** `*[ _type == select(...) && week == ^.week
   && published != false ][0]` — NOT on the outer setlist-history query — line ~32 (1)

(The `_id`-by-`Lead` reads in #4/#5 are why a literal grep alone is insufficient;
both are confirmed member-facing — `requireActiveSession` — and must be filtered.)

Reads that must **NOT** be filtered (admin sees all):
- `app/api/admin/roles/route.ts` GET — additionally, **add `published` to its GROQ
  projection** so the panel knows each service's status.
- `app/api/admin/roles/[id]/route.ts` PATCH — unchanged.
- `app/api/admin/setlists/route.ts` — setlists are not roles; out of scope.

Admin gate (who sees drafts): `session.user.role` ∈ {`super-admin`, `admin`}.
`content-editor` and `member` are treated as members for service visibility (they
can't reach `/api/admin/roles`, which already excludes `content-editor`).

## Create flow (default = draft)

`POST /api/admin/roles` accepts `published?: boolean` in the body, default
**`false`**:

```ts
const doc = await writeClient.create({
  _type: body._type,
  [dateField]: body.date,
  ...(special && service_name ? { service_name } : {}),
  Lead: toRefs(...), BGVs: ..., Chorus: ..., instruments: ..., foh_team: ...,
  published: body.published === true,   // explicit; default false = draft
});
```

**Notification gating in POST:** the existing `void sendPush(...)` and
`void sendAssignmentEmails(...)` fire **only if `body.published === true`**. A
draft create notifies no one.

UI surfaces the choice:
- **ServiceForm** (single create): two submit buttons — **"Crear"** (`published:false`)
  and **"Crear y publicar"** (`published:true`).
- **MonthGenerator** (bulk create): the create step offers **"Crear borradores"**
  (`published:false` on each POST) vs **"Crear y publicar"** (`published:true`).
  The existing per-draft `POST /api/admin/roles` loop passes the chosen value.

## Publish controls

New endpoint **`POST /api/admin/roles/publish`** — `{ ids: string[], published: boolean }`:
- Auth: `requireActiveManager()` and role ≠ `content-editor` (same as roles routes).
- Patches each id: `.patch(id).set({ published }).commit()` (skip ids that are
  already in the target state to avoid redundant notifications).
- **On draft→published transition only**, send the deferred notification:
  `sendPush(assignees, "assignments", …)` and `sendAssignmentEmails(assignees, …)`
  for each newly-published service (assignees = its Lead+BGV+Chorus+instruments+foh).
- **Unpublishing (published→draft) is silent** — no notification.
- **Revalidate member-facing views** after any publish/unpublish so the change
  isn't delayed by the CDN cache. Home/schedule/`/me` use the CDN `client` with
  `revalidate = 60`, so without this a published service can take ~60s to appear
  and (more importantly for safety) an unpublished one ~60s to disappear. Mirror
  what `PUT /api/admin/setlists` already does (`revalidateServiceViews()`-style
  `revalidatePath('/')`, `/schedule`, `/me`). The 60s window is otherwise an
  accepted, documented bound.
- Returns `{ ok, published: <count>, unpublished: <count> }`.

Note on re-publish: only the **transition into published** notifies. A genuine
unpublish→re-publish cycle WILL notify again (the assignees are told again) — this
is acceptable and intended (it's effectively a fresh announcement). Only redundant
no-op patches (already in target state) are skipped, so a single "Publicar todo"
press never double-notifies the same service.

ServicesPanel UI:
- Each service card shows a **"Borrador"** badge when `published === false`
  (existing/published services show no badge). Use the amber/draft accent.
- Per-card toggle button: **"Publicar"** when draft, **"Despublicar"** when
  published → calls the endpoint with `[id]`.
- Header button **"Publicar todo (filtro actual)"** — visible when the current
  filter has ≥1 draft; publishes all currently-visible draft ids in one call,
  behind a confirm dialog showing the count.
- `roles` state already carries `published` (added to the GET projection), so all
  of this recomputes reactively after the existing `fetchData()` refresh.

## Edit (PATCH) behavior

`PATCH /api/admin/roles/[id]` does **not** change `published` (not in its payload),
so editing preserves draft/published state. Its existing "newly-added member" push
fires **only if the service is published**. The PATCH already fetches `prevDoc`
(`roles/[id]/route.ts:69`); add `"published": published` to that projection and
gate the notification on `prevDoc.published !== false` (no separate fetch). Since
PATCH cannot transition draft→published, gating on the current state is correct.

## One-time data step (post-deploy)

After the feature ships, set `published: false` on existing **July 2026** services
so they become drafts the user can test publishing with (all other existing
services stay grandfathered-visible). A one-shot script/patch selecting July via
an explicit date range (NOT `match` — `week`/`date` are `date`-typed; a range is
unambiguous): `*[_type in ["sunday_role","saturday_role","special_role"] &&
coalesce(week, date) >= "2026-07-01" && coalesce(week, date) < "2026-08-01"]` →
set `published: false`. Dry-run first; run once; idempotent.

## Studio schema deploy

`published` is a new schema field → run the Sanity Studio schema deploy
(`sanity:deploy-schema`) so the field appears in Studio. The app reads work
regardless (GROQ tolerates missing fields), but Studio editing needs the deploy.

## Testing

- **Unit (vitest):** a pure helper or documented constant for the draft filter
  clause; the notification-gating decision (`shouldNotify(published)`), and the
  publish endpoint's transition logic (only draft→published notifies; skip
  no-op patches). Member-resolution and sends are mocked — no real notifications.
- **Manual:** create a draft → confirm it's absent from home/schedule/`/me` for a
  member and present (badged) in the panel; publish it → appears for members and
  they get notified; unpublish → disappears, no notification; "Publicar todo"
  publishes the filtered drafts.

## Adversarial review focus

A fresh reviewer must re-audit that **every** member-facing read of a **role doc**
and **every** role-assignment notification path (POST push/email, PATCH push,
reminder cron, the new publish endpoint) is gated on `published`, with NO leak.
The **setlist channel** (home/schedule setlist reads + `PUT /api/admin/setlists`
push) is explicitly and reasonedly out of scope (see *Core invariant*) — a
reviewer may note it, but it is a deliberate deferral, not a defect in this spec.

## Non-goals

- The participation sidebar (separate, queued feature).
- Per-field draft (whole-service granularity only).
- Scheduled/auto-publish, publish history/audit log.
- **The setlist channel** — `featuredSongs`/`saturdarSongs` visibility on
  home/schedule AND the `PUT /api/admin/setlists` "setlist ready" push. Explicitly
  deferred to a follow-up spec that coordinates with the existing setlist
  proposal/approval flow (see the reasoned exemption under *Core invariant*). This
  spec's invariant is scoped to role **assignments**, which it fully covers.
- A draft/publish concept for anything other than the three role types.

## Risks / mitigations

- **Draft leak to members** — mitigated by the re-derived exhaustive audit
  (7 files / 18 query clauses, incl. the song-history `leaders` join and the two
  `_id`-based reads), the unified `published != false` filter, and an adversarial
  re-audit that must independently re-grep for any read not on the list.
- **Notifying about drafts (role assignments)** — mitigated by the core invariant:
  POST/PATCH/cron/publish-endpoint all gate role-assignment notifications on
  `published`. The setlist "ready" push is the one known, deferred exception
  (separate follow-up spec).
- **Existing schedules vanishing** — mitigated by grandfathering (`!= false`);
  only July is explicitly unpublished, by an idempotent one-shot.
- **Double-notify on re-publish** — mitigated by skipping no-op patches (only the
  draft→published transition notifies).
