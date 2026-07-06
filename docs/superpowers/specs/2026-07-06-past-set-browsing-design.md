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
| `/schedule?m=YYYY-MM` | **Browse** — single month | first day → last day of that month |

**Invariant rule:** *the current month is always the default view.* Navigating
or jumping to the current month clears the param (→ `/schedule`), returning the
user to the live 95-day rolling view. Any month other than the current one is a
single-month browse. This keeps one canonical URL for "now" and preserves the
exact current default behavior and its cache entry.

### Navigation bar (in `CalendarView`)

Rendered above the existing grid, in both modes. State is driven entirely by the
URL via `Link`/router navigation (no client fetch, no local data state):

- **‹ Anterior** — anchor − 1 month → `?m=`
- **Siguiente ›** — anchor + 1 month; if that equals the current month, links to
  `/schedule` (clears param). Present in browse mode; in the default view it is
  hidden/disabled (already at the leading edge).
- **Month label** — the anchored month (`currentMonth` when no param), Spanish,
  e.g. "julio 2026".
- **Month jump** — a themed control (native `<input type="month">` or a compact
  dropdown) to jump to any month. Selecting the current month clears the param.
- **Hoy** — clears the param; shown only while browsing.

`anchorMonth` = `m` when present, else the current month (America/Mexico_City).
The existing **Calendario / Lista** toggle and today-highlight are preserved.

### What each set shows

The same rich `DayCard`, unchanged. The setlist always renders. Team
assignments (Lead / BGVs / Chorus / instruments / FOH) render when role docs
exist for that week and are gracefully omitted when absent — the common case for
older backfilled weeks, which have `featuredSongs`/`saturdarSongs` setlists but
no role docs. `DayCard` already tolerates missing team, so no change is needed
there. `published != false` filtering is preserved on member-facing reads.

### Empty months

A month with no services shows a friendly Spanish empty state; the nav bar stays
active so the user can keep paging.

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
  - Optional `prevHref`/`nextHref`/`jumpHref` helpers so link targets (including
    the "current month clears the param" rule) are pure and testable.
- **`app/(client)/schedule/page.tsx`**: read+validate `searchParams.m` (await —
  Next 16 async searchParams), pick default vs browse bounds, fetch, pass
  `viewMonth` (undefined in default mode) to `CalendarView`.
- **`app/components/CalendarView.tsx`**: accept `viewMonth?: string`; when set,
  render the single anchored month (grid + list) instead of the 3-month roll;
  render the nav bar in both modes; keep the existing toggle and highlight.

## Edge cases

- Invalid / malformed `m` → treated as no param (default view).
- `m` = current month → redirect/normalize to `/schedule` (canonical) — or
  simply render default; links never produce this URL.
- Months with no data → empty state, nav still works.
- Far past/future → bounded only by data; nav never dead-ends.
- Grid/List toggle and today-dot behave the same; today-dot only appears in
  months containing today.

## Testing

- Unit tests (vitest) for every `scheduleMonths.ts` helper: param
  parse/validate (valid, out-of-range month, garbage, empty), `addMonths` across
  year boundaries, `monthBounds` incl. February/leap and 30/31-day months,
  `isCurrentMonth`, and the href helpers' "clear param on current month" rule.
- `npx tsc --noEmit` and `npm test` must pass before claiming done.

## Rollout

Implement on a feature branch off `improve/continuous`; merge to `main` when
green (direct push, no PR, no AI attribution — per repo conventions).
