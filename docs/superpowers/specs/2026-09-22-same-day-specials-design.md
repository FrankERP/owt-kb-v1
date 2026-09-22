# Same-day special services with a time — design

**Date:** 2026-09-22 · **Status:** implemented on branch `claude/campamento-sets-app-d5466d`; not released · **Risk tier:** standard (no server
writer concurrency, lock, auth or migration change; see §7) · **Motivating event:**
Campamento 2–4 October 2026, six worship sets across three days, five of them on Saturday 3.

## 1. Problem

The camp agenda has these worship sets:

| Day | Sets |
|---|---|
| Vie 2 oct | 18:45 Alabanza |
| Sáb 3 oct | 9:00 Alabanza · 12:30 Alabanza · 14:45 Micro Alabanza · 18:30 Alabanza · 20:45 Noche de Alabanza |
| Dom 4 oct | 11:00 Alabanza at Oasis Tepepan — the ordinary `sunday_role`, out of scope |

Each set needs its own setlist and its own card in the app. The data layer already
allows this: a `special_role` is identified by `{date, service_name}` (ADR-0011), the
roles route's occupancy check compares the normalized name
(`roleWriteOps.ts` «Target occupancy»), and home, `/schedule`, `/me`, proposals, the
setlist editor and the reminder cron all key a special by `_id`. **So does the admin
grid's stored mode:** `storedRoleReadModel.ts` keys a special by `date|name`
(`specialKey`) and every stored column by its `_id`, and the «+ Nuevo servicio»
composer (`MonthGenerator.handleCreateOne`) posts straight to `POST /api/admin/roles`,
whose occupancy check is name-aware. A second, differently named special on a stored
date can be created there today.

Two things are missing:

1. **There is no time.** Specials sort by `order(date asc)` only, so five Saturday
   cards would come out in undefined order and the hour would live in the name only
   if the admin typed it there.
2. **The month CREATE flow refuses a second special on a date.** Every key in that flow
   is `draftTargetKey(type, date)` = `special_role__<date>` (`plannerModel.ts:1018`),
   E3 in `buildColumns` claims a date per column, and `refuseSpecialOn`
   (`MonthCalendar.tsx:107–170`) refuses at the picker. That flow exists to draft a
   month for the solver; it is NOT how the camp sets get created (see §4).

Not a problem: the server-side preflight (`monthTargetPreflight`'s special branch,
`serviceCardModel.ts:1215`) is deliberately name-blind and always answers `role:
"none"`; it never refuses, so it needs no change.

## 2. Decision

One `special_role` document per set (option "a"). Add an optional `time` to the
special, carry it through the write path, the stored-mode editor and every
member-facing read, and sort same-day specials by time. Same-day sets are created and
edited in the admin grid's **stored mode**, which already supports them. The month
create flow keeps its one-special-per-date rule; its refusal copy now points the admin
to «+ Nuevo servicio». No container document, no multi-set setlist, no migration.

Option "b" — one document per day with several sets inside — was rejected: it changes
the setlist shape that the editor, proposals, medley grouping and play history all
read, for a case that happens once a year.

### Amendment (2026-09-22, before the plan)

The first draft of this spec re-keyed the month create flow by date + name
(`draftTargetKey`, `buildColumns` E3, `refuseSpecialOn`, `createdTargets`). The code
read for the plan showed (a) stored mode already handles N specials per date, and (b)
the create-flow identity key is date-only ON PURPOSE (E19, `plannerModel.ts:1000–1017`):
a name-bearing identity would remint a draft's ids on rename and let `handleConfirm`
post a second document. Re-keying it would have re-opened a hazard the planner was
built to close, to add a capability another surface already has. Dropped.

## 3. Schema and reads

### 3.1 `special_role.time`

- `sanity/schemas/specialRole.ts`: new field `time`, type `string`, title «Hora»,
  description «HH:mm, hora local (America/Mexico_City). Opcional.» Stored as
  `"HH:mm"` 24-hour, zero-padded (`"09:00"`, `"18:45"`). Optional; an absent field
  means "no time" and sorts **after** timed specials on the same day.
- `date` stays a Sanity `date` (`YYYY-MM-DD`). The timezone invariant is untouched:
  `time` is a display/sort string, never combined into a `Date` with the date. Nothing
  computes "is this set over" from it.
- Studio: the document is `readOnly: true` (A2 §8); the field is edited through the
  app only, like every other field.
- One validator, `isServiceTime(v): v is string` in `app/utils/serviceTime.ts`
  (`/^([01]\d|2[0-3]):[0-5]\d$/`), plus `compareServiceTime(a, b)` for client-side
  ordering (absent last). Both neutral, so a Server Component may call them.

### 3.2 Projections and queries

- `ROLE_PROJECTION` (`serviceReadQueries.ts:17`) adds `time`.
- The roles GET (`api/admin/roles/route.ts:65`) projects `time` and orders
  `coalesce(week, date) asc, time asc`, so stored columns arrive in set order.
- Every member-facing special read adds `time` to the projection and becomes
  `order(date asc, time asc)`: `app/(client)/page.tsx:59`,
  `app/(client)/schedule/page.tsx:46`, `app/(client)/me/page.tsx:184`. `/me` then
  sorts its merged list by `dateKey`, then `compareServiceTime`. The
  `app/(client)/me/queries.ts:38` date-list and `api/cue/route.ts:23` read only the
  date and need nothing — a cue is a calendar day.
- `api/cron/service-reminders/route.ts` already matches every role on `$day`; each
  set gets its own reminder. Unchanged.
- `SpecialRole` (`app/utils/interface.tsx:125`) and `ServiceRole`
  (`serviceCardModel.ts:119`) gain `time?: string | null`.

### 3.3 Write request

- `roleWriteRequest.ts`: `parseCreateRequest` and `parseEditRequest` accept an
  optional `time`. Absent, `null` or `""` → no time; otherwise it must pass
  `isServiceTime` or the request fails with `["time"]`. On a weekend type a non-empty
  `time` is rejected with `["time"]`, matching how a weekend `service_name` is a lie
  about what gets stored.
- `buildRoleDocument` writes `time` only when present. `buildRoleEditPatch` returns
  `{ set, unset }`: `time` in `set` when present, in `unset` when absent, so clearing
  the field in the editor really clears it. The PATCH route applies both.
- `roleCreationReceipt.canonicalizeCreatePayload` includes `time` in the canonical
  payload **only when present**, so the fingerprint of every payload without a time is
  byte-identical to today's and an in-flight retry across the deploy still matches its
  receipt. `FINGERPRINT_VERSION` is not bumped.
- `time` is **not** part of the identity. Two specials with the same date and
  normalized name at different times are still one identity and are refused, exactly
  as today. Frank names them differently («Alabanza 9:00» vs «Alabanza 12:30», or
  «Alabanza» vs «Micro Alabanza» vs «Noche de Alabanza»).

## 4. Admin: stored mode owns same-day sets

### 4.1 Composer

The «+ Nuevo servicio» composer (`MonthGenerator.tsx:3508–3530`, `handleCreateOne`)
gains an optional «Hora» field, shown for `special_role` only, sent as `time` in the
create body (`draftCreateBody` gains `time?` and emits it for specials only). The
composer's `createAttempt.payloadKey` includes the time, so a retry of the same
request carries the same payload.

### 4.2 Stored column header

`PlannerGrid`'s stored header (`:2360–2373`) shows a «Hora» field under «Nombre» for a
`special_role` column, wired through `onStoredHeaderChange(columnId, { time })`.
`GridColumn` gains `time?: string`; `translateStoredRole` copies it from the role;
`serializeStoredColumn` emits `time` in the PATCH body (present) and the semantic
snapshot (`time: string | null`), so a changed time makes the column dirty and
`sameRoleSemantics` sees it. A malformed time is a serialization reason
(`invalid_special_time`), never sent.

The header's stored-section label (`storedSectionServiceOptions`) appends ` · HH:mm`
for a timed special so two same-day sets are distinguishable in the swap picker.

### 4.3 Month create flow — unchanged, one message

`refuseSpecialOn` rule 4's copy becomes «El <fecha> ya tiene un servicio especial
guardado: «…». Para agregar otro set ese día usa «+ Nuevo servicio» en los servicios
guardados.» No key, column or E3 change.

### 4.4 Controls

`ui/DateField` gains `kind: "time"` — it already wraps the native `<input type>`
(`DateField.tsx:27`) — so no bare `<input type="time">` enters `app/**`. `md` size
keeps the 16 px phone floor (`inputFontSize.test.ts`); the header uses `sm` like its
date field.

### 4.5 What does not change

- Solver and `localFill` (ADR-0010). Specials still never reach CP-SAT.
- Weekend `roleTargetLock`, the special identity coordinator and the roles route's
  transaction shape.
- The month create flow's keys, `buildColumns` E3 and the name-blind preflight.

## 5. Member UI

- `DayCardProps` gains `time?: string | null`. `DayCard` renders it in the header
  after the date («CAMPAMENTO · ALABANZA · 3 oct · 18:45»); with no `time` the card is
  pixel-identical to today. `paintsDayCard` is unchanged — a time alone never makes an
  empty card paint.
- Home and `/schedule` pass `sp.time` through (`ActiveDay` gains `time?`); both
  already emit one card per special. `isNext`, the hero slot and the countdown stay
  calendar-day based: on Saturday all five sets share `isNext`, and the first by time
  is the hero because it is first in the list.

## 6. Out of scope, stated

- **Assignment/reminder emails are per document.** A member seated in all five
  Saturday sets can receive five assignment notices (debounced per the outbox rules)
  and five reminders. Not grouped in this delivery; noted in `docs/NOTIFICATIONS.md`.
- No backfill: existing specials get no `time`.
- No "camp" or "event" grouping in the UI; the name carries it («Campamento · …»).
- The month create flow still drafts at most one special per date.

## 7. Risk tier and review

Standard. The additive `time` field touches `roleWriteRequest.ts`'s parser and
`roleCreationReceipt.ts`'s canonical payload, both part of a production writer, but it
changes no concurrency, locking, deletion, batching or identity behaviour, and the
fingerprint of every existing payload shape is unchanged by construction (§3.3).
Pipeline: spec (this) → plan → implement → gates → fresh code review of the diff → fix
→ re-verify → `preview` → verify alias → PR to `main`.

## 8. Tests

- `serviceTime`: accepts `"00:00"`, `"09:00"`, `"23:59"`; rejects `"9:00"`, `"24:00"`,
  `"18:60"`, `""`, `null`; `compareServiceTime` orders `"09:00" < "18:30" < undefined`.
- `roleWriteRequest`: create/edit with `time` absent, `""`, `"09:00"`, `"9:00"`
  (rejected), on a weekend type (rejected); `buildRoleEditPatch` unsets an absent time.
- `roleCreationReceipt`: fingerprint of a payload without `time` equals the
  pre-change fingerprint (pinned hex); with `time` it differs.
- `plannerSaveModel`: a special column with `time` emits it and a changed time is not
  `sameRoleSemantics`; an invalid time is a reason.
- `storedRoleReadModel`: `translateStoredRole` carries `time`.
- `MonthCalendar`: rule 4's new copy.
- `PlannerGrid`: stored special header renders «Hora» and reports `{ time }`.
- `DateField`: `kind="time"` renders `type="time"`.
- `dayCard`: caption only when `time` is set.
- `serviceReadQueries`: `ROLE_PROJECTION` contains `time`.
- `inputFontSize.test.ts` and `draftGatingCoverage.test.ts` keep passing.

## 9. Rollout

1. Merge to `preview`, verify the dev alias, open `/admin` October in stored mode,
   create two specials on Saturday 3 with times, check the order on home.
2. PR to `main`.
3. Frank creates the six sets from «+ Nuevo servicio» (name + time), seats them,
   builds each setlist in the normal editor, publishes when ready.

## 10. Docs touched in the same delivery

`CLAUDE.md` (invariants: `time` is display/sort only and never part of a special's
identity; same-day sets are created in stored mode, the month create flow keeps one
per date), `docs/NOTIFICATIONS.md` («Landmines»: per-document notices on same-day
sets). No new secret, so `docs/SECRETS.md` is untouched. Decision record: none — the
rejection of option "b" and of the create-flow re-key is recorded here.
