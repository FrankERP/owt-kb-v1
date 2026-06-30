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

> **A member learns about a service — in the app UI, in push, in email, and in
> the reminder cron — ONLY once that service is published.**

Visibility and notifications are gated by the same `published` state. Nothing
member-facing ever surfaces a draft.

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

The **8 member-facing reads** (from the audit) that MUST get the filter:

1. `app/(client)/page.tsx` — `WEEKEND_QUERY` (sunRole, satRole, special) — ~lines 53–55
2. `app/(client)/schedule/page.tsx` — `SCHEDULE_QUERY` (3 role queries) — ~lines 32–36
3. `app/(client)/me/page.tsx` — member assignment reads + calendar-date reads (6 queries) — ~lines 67, 85, 103, 129, 130, 131
4. `app/(client)/me/propose/[roleId]/page.tsx` — `getRoleDoc()` (1) — ~line 14
5. `app/api/me/proposals/route.ts` — lead verification (1) — ~line 51
6. `app/api/cron/service-reminders/route.ts` — reminder recipient reads (3) — ~lines 13–15

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
- Returns `{ ok, published: <count>, unpublished: <count> }`.

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
fires **only if the service is published** (read the doc's current `published`
in the PATCH, gate the notification on `published !== false`).

## One-time data step (post-deploy)

After the feature ships, set `published: false` on existing **July 2026** services
so they become drafts the user can test publishing with (all other existing
services stay grandfathered-visible). A one-shot script/patch:
`*[_type in [roles] && (week match "2026-07*" || date match "2026-07*")]` → set
`published: false`. Run once, idempotent.

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

A fresh reviewer must re-audit that **every** member-facing read and **every**
notification path (push, email, cron) is gated on `published`, with NO leak: no
member-facing query missing the filter, no notification firing for a draft.

## Non-goals

- The participation sidebar (separate, queued feature).
- Per-field draft (whole-service granularity only).
- Scheduled/auto-publish, publish history/audit log.
- Changing setlist (`featuredSongs`/`saturdarSongs`) visibility.
- A draft/publish concept for anything other than the three role types.

## Risks / mitigations

- **Draft leak to members** — mitigated by the exhaustive audit list (8 reads),
  the unified `published != false` filter, and an adversarial re-audit.
- **Notifying about drafts** — mitigated by the core invariant: POST/PATCH/cron/
  publish-endpoint all gate notifications on `published`.
- **Existing schedules vanishing** — mitigated by grandfathering (`!= false`);
  only July is explicitly unpublished, by an idempotent one-shot.
- **Double-notify on re-publish** — mitigated by skipping no-op patches (only the
  draft→published transition notifies).
