# Past-set browsing on `/schedule` — design

**Date:** 2026-07-06
**Status:** Approved for planning
**Area:** `/schedule` calendar page

## Goal

Let team members look back at past setlists (and future ones beyond the default
window) by navigating the calendar month-by-month, plus jumping directly to a
chosen month. Today the `/schedule` page only shows a rolling *today → +95 days*
window with a fixed 3-month grid and **no navigation** — past weeks are
unreachable in the UI even though the setlist data exists.

## Non-goals

- No song-centric "where was this song played" search (that already exists in
  the song detail API / `SongSheet` play-history popover).
- No changes to `DayCard`'s content or to how setlists/roles are modeled.
- No new write paths; this is read-only browsing.

## Approach (chosen: URL-driven server render)

Add an optional `?m=YYYY-MM` search param to `/schedule`. The page stays a
server component using ISR — past data is immutable, so caching is ideal.

### View modes

| URL | View | Data window |
|-----|------|-------------|
| `/schedule` (no param) | **Default** — unchanged | today → today + 95 days (rolling), specials from week start |
| `/schedule?m=YYYY-MM` | **Browse** — single month (any month, incl. current) | first day → last day of that month |

**No-param = the live landing view.** `/schedule` with no param is the default
95-day rolling view, unchanged, and remains the canonical "home" URL and cache
entry. **The param is fully independent of it:** `?m=YYYY-MM` browses that whole
month with full-month bounds — and this is true *including the current month*.
Browsing the current month therefore shows the **entire** current month from day
1, so current-month services that are already in the past (dated before today,
which the default `week >= today` window excludes) are reachable. The **Hoy**
button clears the param to return to the live rolling view. There is
deliberately **no** "current month clears the param" rule — paging or jumping to
the current month lands on `?m=<current-month>` (a real full-month browse), which
is what makes early-this-month past sets visible.

### Navigation bar (in `CalendarView`)

Rendered above the existing grid, in both modes. State is driven entirely by the
URL via `Link`/router navigation (no client fetch, no local data state).
`anchorMonth` = `m` when present, else the current month (America/Mexico_City):

- **‹ Anterior** — `?m=(anchorMonth − 1)`.
- **Siguiente ›** — `?m=(anchorMonth + 1)`. No special-casing of the current
  month (see the no-clear-on-current rule above); it always links to a real
  month browse. Shown in both modes.
- **Month label** — the anchored month, Spanish, e.g. "julio 2026". In the
  default (no-param) view the label still reads the current month but the view is
  the rolling window; a subtle "próximos" hint distinguishes it.
- **Month jump** — a themed control (native `<input type="month">` or a compact
  dropdown) → `?m=<selected>` for any month, current included.
- **Hoy** — clears the param (→ `/schedule`, the live rolling view); shown only
  while browsing (`m` present).

The existing **Calendario / Lista** toggle and today-highlight are preserved.

### What each set shows

The same rich `DayCard`, unchanged. The setlist always renders. Team
assignments (Lead / BGVs / Chorus / instruments / FOH) render when role docs
exist for that week and are gracefully omitted when absent — the common case for
older backfilled weeks, which have `featuredSongs`/`saturdarSongs` setlists but
no role docs. `DayCard` already tolerates missing team, so no change is needed
there. `published != false` filtering is preserved on member-facing reads.

### Empty months & mode-aware copy

Three existing hardcoded strings assume the "upcoming" framing and are wrong in
browse mode — all must become mode-aware:

- `schedule/page.tsx:130` — `<h2>Próximos fines de semana</h2>` → in browse mode,
  the browsed month label (e.g. "Julio 2026").
- `schedule/page.tsx:132-134` — empty state "No hay roles asignados para los
  próximos tres meses." → generic/month-aware (e.g. "No hay servicios en
  <mes>.").
- `CalendarView.tsx:174-176` — list-view empty state, same string → same
  treatment.

To avoid the two empty states double-rendering (the page-level check at
`page.tsx:132` **and** `CalendarView`'s list-view check both fire on no data),
consolidate to a single empty state. Simplest: drop the page-level check and let
`CalendarView` own the empty state for both grid and list, passed the mode/label
so it reads correctly. The nav bar stays active on empty so the user can keep
paging.

## Data / query changes

`SCHEDULE_QUERY` is reused as-is, parameterized on bounds:

- Default mode passes `$today`/`$limit` (= today + 95d) and `$weekStart` exactly
  as today.
- Browse mode passes `$from` = `YYYY-MM-01`, `$limit`/`$to` = last day of the
  month, and `$weekStart` = `$from`.
- `week`-keyed types (`featuredSongs`, `saturdarSongs`, `sunday_role`,
  `saturday_role`) and the `date`-keyed `special_role` are already both handled
  by the query; only the bound values change.

`revalidate = 60` is unchanged.

## Timezone safety (invariant)

All month math is pinned to America/Mexico_City:

- `currentMonth()` = `new Date().toLocaleDateString("sv",{timeZone:"America/Mexico_City"}).slice(0,7)`.
- `addMonths(ym, n)` and month-string parsing are pure integer arithmetic on
  `YYYY-MM` — no `Date` round-trips, so no UTC day-flip risk.
- Last-day-of-month uses `new Date(Date.UTC(y, m, 0)).getUTCDate()` (UTC-only
  read; deterministic calendar arithmetic, no TZ flip).
- Any date rendering keeps the existing local-noon pattern
  (`new Date(iso.slice(0,10)+"T12:00:00")`), never bare `new Date(iso)`.

## Modules / components

- **`app/utils/scheduleMonths.ts`** (new, pure, unit-tested):
  - `parseMonthParam(raw): string | null` — validates `YYYY-MM` (real month
    01–12); returns null on anything malformed.
  - `currentMonth(): string` — TZ-pinned current `YYYY-MM`.
  - `isCurrentMonth(ym): boolean`.
  - `addMonths(ym, n): string`.
  - `monthBounds(ym): { from: string; to: string }` — first/last day ISO.
  - Optional `prevHref`/`nextHref`/`jumpHref` helpers returning `?m=` targets so
    link construction is pure and testable. (No "clears on current month" logic —
    only **Hoy** clears the param, which is a static `/schedule` link.)
- **`app/(client)/schedule/page.tsx`**: read+validate `searchParams.m`, pick
  default vs browse bounds, fetch, pass `viewMonth` (undefined in default mode)
  to `CalendarView`. **Next 16 async `searchParams`:** the prop is typed
  `searchParams: Promise<{ m?: string }>` and must be `await`ed. There is no
  existing server-component precedent in this repo (the only `searchParams` use,
  `auth/signin/page.tsx:10`, is a client `useSearchParams`), so confirm the shape
  explicitly and lean on `npx tsc --noEmit` to catch a mistyped signature.
- **`app/components/CalendarView.tsx`**: accept `viewMonth?: string`. This is
  **more than a passthrough prop** — the two views compute their months
  differently and must be handled separately:
  - **Grid view**: today the month list is hardcoded as `[0,1,2]` offsets from
    `todayStr` (`CalendarView.tsx:95-99`). Rewrite: when `viewMonth` is set,
    `months = [that single month]`; else keep the `[0,1,2]`-from-today roll. The
    per-cell today-dot (`:319`, `dateStr === todayStr`) is untouched and simply
    never matches in a non-current browsed month.
  - **List view**: `getWeekends(activeDays)` (`:49-75`) already renders whatever
    data it is given, grouped by **Sunday-anchored** week key (`:57-59`,
    `daysToSun`). In browse mode it is passed only the month's services, so no
    grid-month rewrite is needed there — **but** a weekend that straddles the
    month boundary splits: a browsed month's trailing **Saturday** whose Sunday
    falls in the next month renders as a lone card, and a leading **Sunday**
    whose Saturday was in the prior month likewise renders alone. **This is
    accepted, intentional behavior** — each card is a real service dated within
    the browsed month; its weekend partner shows when you page to the adjacent
    month. We deliberately do **not** widen the query bounds to keep pairs
    together (added complexity for a cosmetic edge). The plan must not treat
    these lone cards as a bug.
  - Render the nav bar in both modes; own the (mode-aware) empty state; keep the
    existing Calendario/Lista toggle.

## Edge cases

- Invalid / malformed `m` → treated as no param (default view).
- `m` = current month → a real full-month browse of the current month (shows the
  whole month including already-past services this month). **Not** normalized to
  `/schedule`. `/schedule` (no param) remains the separate live rolling view,
  reached via **Hoy**.
- Weekend straddling a month boundary → lone Sat or Sun card in the browsed
  month (see List view above). Intended, not a bug.
- Months with no data → single mode-aware empty state, nav still works.
- Far past/future → bounded only by data; nav never dead-ends.
- Grid/List toggle behave the same; today-dot only appears in the month
  containing today (so never in a non-current browsed month).

## Testing

- Unit tests (vitest) for every `scheduleMonths.ts` helper: param
  parse/validate (valid, out-of-range month, garbage, empty), `addMonths` across
  year boundaries (Jan→Dec, Dec→Jan), `monthBounds` incl. February/leap and
  30/31-day months, `isCurrentMonth`, and the `prevHref`/`nextHref`/`jumpHref`
  target construction.
- `npx tsc --noEmit` and `npm test` must pass before claiming done.

## Rollout

Implement on a feature branch off `improve/continuous`; merge to `main` when
green (direct push, no PR, no AI attribution — per repo conventions).
