# Same-day special services with a time — design

**Date:** 2026-09-22 · **Status:** approved in chat (option "a"), spec pending Frank's read
· **Risk tier:** standard (no server writer concurrency, lock, auth or migration change;
see §7) · **Motivating event:** Campamento 2–4 October 2026, six worship sets across
three days, five of them on Saturday 3.

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
setlist editor and the reminder cron all key a special by `_id`. Two things stop it
in practice:

1. **The `/admin` planner refuses a second special on a date.** Every client-side key
   for a special is `draftTargetKey(type, date)` = `special_role__<date>`
   (`plannerModel.ts:1018`), so `createColumnId`, `createdTargets`, `prevByKey`, the
   skipped-dates set and `refuseSpecialOn` rules 2–4 (`MonthCalendar.tsx:107–170`)
   all collapse two same-day specials into one.
2. **There is no time.** Specials sort by `order(date asc)` only, so five Saturday
   cards would come out in undefined order and the hour would live in the name only
   if the admin typed it there.

Not a problem: the server-side preflight (`monthTargetPreflight`'s special branch,
`serviceCardModel.ts:1215`) is deliberately name-blind and always answers `role:
"none"`; it never refuses, so it needs no change. E17's collision key in
`cellsToDrafts` is already name-bearing.

## 2. Decision

One `special_role` document per set (option "a"). Add an optional `time` to the
special, make the planner key specials by date **and** normalized name, and sort
same-day specials by time on every member-facing read. No container document, no
multi-set setlist, no migration.

Option "b" — one document per day with several sets inside — was rejected: it changes
the setlist shape that the editor, proposals, medley grouping and play history all
read, for a case that happens once a year.

## 3. Schema and reads

### 3.1 `special_role.time`

- `sanity/schemas/specialRole.ts`: new field `time`, type `string`, title «Hora»,
  description «HH:mm, hora local (America/Mexico_City). Opcional.» Stored as
  `"HH:mm"` 24-hour, zero-padded (`"09:00"`, `"18:45"`). Optional; an absent field
  means "no time" and sorts **after** timed specials on the same day (GROQ `order`
  puts `null` last for ascending order — pin this in a test on the mapping helper,
  not on GROQ).
- `date` stays a Sanity `date` (`YYYY-MM-DD`). The timezone invariant is untouched:
  `time` is a display/sort string, never combined into a `Date` with the date. Nothing
  computes "is this set over" from it.
- Studio: the document is `readOnly: true` (A2 §8); the field is edited through the
  app only, like every other field.

### 3.2 Projections and queries

- `ROLE_PROJECTION` (`serviceReadQueries.ts:17`) adds `time`.
- Every special read that orders by date adds `time` to the projection and becomes
  `order(date asc, time asc)`: `app/(client)/page.tsx:59`,
  `app/(client)/schedule/page.tsx:46`, `app/(client)/me/page.tsx:184`. The
  `app/(client)/me/queries.ts:38` date-list and `api/cue/route.ts:23` read only the
  date and need nothing — a cue is a calendar day.
- `api/cron/service-reminders/route.ts` already matches every role on `$day`; each
  set gets its own reminder. Unchanged.
- The `SpecialRole` interface (`app/utils/interface.tsx:125`) gains `time?: string | null`.

### 3.3 Write request

- `roleWriteRequest.ts`: the create body and the PATCH body accept an optional
  `time`. Validation: absent/`null`/`""` → field omitted (create) or unset (patch);
  otherwise must match `/^([01]\d|2[0-3]):[0-5]\d$/` or the request fails with
  `["time"]` like every other field failure. Only meaningful on `special_role`; on a
  weekend type it is rejected, not silently dropped, matching how `service_name` is
  handled.
- `roleCreationReceipt`'s fingerprint is computed over the request payload, so a
  set's time is part of what the receipt authorized. No format change to the receipt.
- `time` is **not** part of the identity. Two specials with the same date and
  normalized name at different times are still one identity and are refused, exactly
  as today. Frank names them differently («Alabanza 9:00» vs «Alabanza 12:30», or
  «Alabanza» vs «Micro Alabanza» vs «Noche de Alabanza»).

## 4. Planner

### 4.1 Key

`draftTargetKey(type, date, name?)` in `plannerModel.ts`:

- weekend types: `${type}__${date}` — byte-identical to today.
- `special_role`: `${type}__${date}__${normalizeServiceName(name)}`.

`createColumnId` takes the column's `serviceName` through. Every caller that builds
or looks up a special key passes the name: `buildColumns` (`plannerModel.ts:447`),
`prevByKey`/`cellsToDrafts` reconciliation (`:1082–1093`), `createdTargets` in
`MonthGenerator` (composer create at `:2587` and the `refuseSpecialOn` call), the
skipped-dates keying, and `PlannerGrid`'s column header lookups. A special call
without a name is a type error, not a fallback to the date-only key — the
signature makes the name required when `type === "special_role"` (overload or a
discriminated input object), so a missed call site fails `tsc`.

`normalizeServiceName` (`normalizeLabel.ts:43`) is the ONE normalizer, shared with
the server's occupancy check and E17; no `.toLowerCase()`, per its own comment.

### 4.2 `refuseSpecialOn` (`MonthCalendar.tsx`)

Signature gains `name: string` (the normalized name the admin is about to add).

1. Weekend selected on that date — unchanged (E3). The Saturday of the camp is
   deselected in the October planner, as today.
2. `createdTargets.has(draftTargetKey("special_role", date, name))` — same name
   already created this session → refuse with the existing wording.
3. `specials.find(s => s.date === date && normalizeServiceName(s.name) === name)` →
   refuse with the existing wording («ya tiene un servicio especial en este mes:
   «…». Quítalo de la lista para cambiarlo»).
4. A stored `special_role` on that date whose normalized `service_name` equals
   `name` → refuse («ya tiene un servicio especial guardado: «…»»). A stored special
   with a **different** name lets the new one through.
5. Otherwise `null`.

`refuseWeekendOn` is unchanged: any special on a date still blocks selecting that
weekend date.

### 4.3 Composer

The one-service composer in `MonthGenerator` (`createType`/`createDate`/`createName`,
`:1777`) and the month calendar's special picker both gain an optional «Hora» input
for `special_role` only — a `ui/DateField` extended with `kind: "time"` (it wraps the native
`<input type>` already, `DateField.tsx:27`) — never a bare `<input type="time">` in `app/**`. If
the native time picker proves unusable on desktop, a text input with `inputMode="numeric"`, `placeholder="HH:mm"` and
the same regex, 16 px on a phone (`inputFontSize.test.ts` applies). Its value goes
into the create body as `time`. Editing the time of a stored special goes through the
same PATCH the name edit uses.

`ExistingRoleRef` (`plannerModel.ts:222`) already carries `service_name` for
specials; it gains `time?` only if the grid header shows it (nice-to-have, not
required).

### 4.4 What does not change

- Solver and `localFill` (ADR-0010). Specials still never reach CP-SAT; each set is
  its own column filled locally.
- Weekend `roleTargetLock`, the special identity coordinator and the roles route's
  transaction shape.
- The server preflight's name-blind special branch (`serviceCardModel.ts:1215`).

## 5. Member UI

- `DayCardProps` gains `time?: string | null`. `DayCard` renders it as a small
  tabular-numeral caption next to the day label («Campamento · Alabanza — 18:45»);
  with no `time` the card is pixel-identical to today. `paintsDayCard` is unchanged
  — a time alone never makes an empty card paint.
- Home and `/schedule` pass `sp.time` through; both already emit one card per
  special. `isNext`, the hero slot and the countdown stay calendar-day based: on
  Saturday all five sets share `isNext`, and the first by time is the hero because it
  is first in the list.
- `/me`'s assignment list shows the time after the service name for specials.

## 6. Out of scope, stated

- **Assignment/reminder emails are per document.** A member seated in all five
  Saturday sets can receive five assignment notices (debounced per the outbox rules)
  and five reminders. Not grouped in this delivery; noted in `docs/NOTIFICATIONS.md`.
- No backfill: existing specials get no `time`.
- No "camp" or "event" grouping in the UI; the name carries it («Campamento · …»).

## 7. Risk tier and review

Standard. The additive `time` field touches `roleWriteRequest.ts`'s parser, which
is part of a production writer, but it changes no concurrency, locking, deletion,
batching or identity behaviour; it is one more validated optional string, handled
like `team_notes`. Pipeline: spec (this) → plan → implement → gates → fresh code
review of the diff → fix → re-verify → `preview` → verify alias → PR to `main`.

## 8. Tests

- `plannerModel`: `draftTargetKey` weekend keys unchanged (snapshot the strings);
  two specials same date different names → two keys; same normalized name → one key;
  `buildColumns` with two same-day specials yields two columns with distinct
  `columnId`.
- `MonthCalendar.refuseSpecialOn`: each of rules 1–4 with a different-name sibling
  present (allowed) and a same-name sibling (refused); a stored special with another
  name does not refuse.
- `roleWriteRequest`: `time` absent, `""`, `"09:00"`, `"9:00"` (rejected), `"24:00"`
  (rejected), on a weekend type (rejected).
- Home/schedule mapping: three same-day specials at `"18:30"`, `"09:00"`, none →
  order `09:00, 18:30, none`; `DayCard` renders the caption only when `time` is set.
- `inputFontSize.test.ts` and `draftGatingCoverage.test.ts` keep passing (the new
  reads carry `published != false`).

## 9. Rollout

1. Merge to `preview`, verify the dev alias, look at `/admin` October with Saturday 3
   deselected and two specials on it.
2. PR to `main`.
3. Frank creates the six sets from `/admin` (name + time), assigns seats, builds each
   setlist in the normal editor, publishes when ready.

## 10. Docs touched in the same delivery

`CLAUDE.md` (invariants: specials are keyed by date **and** name in the planner;
`time` is display/sort only), `docs/NOTIFICATIONS.md` (§6 note). No new secret, so `docs/SECRETS.md` is untouched. Decision
record: none needed — the rejection of option "b" is recorded here.
