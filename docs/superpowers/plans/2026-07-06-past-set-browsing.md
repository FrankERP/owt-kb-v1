# Past-Set Browsing on `/schedule` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let team members browse past (and future) setlists on `/schedule` month-by-month via prev/next buttons, a month-jump picker, and a "Hoy" reset — without changing the default upcoming view.

**Architecture:** `/schedule` stays a server component using ISR. A new optional `?m=YYYY-MM` search param switches it from the default rolling *today → +95 days* window to a single full-month window (bounds fed into the existing GROQ query). A new pure util module (`scheduleMonths.ts`) owns all month arithmetic and link construction and is fully unit-tested. `CalendarView` gains a `viewMonth` prop that (a) renders a single anchored month in grid view, (b) renders a URL-driven nav bar, and (c) owns a mode-aware empty state.

**Tech Stack:** Next.js 16 (App Router, async `searchParams`), React 19 client component, Sanity v5 GROQ, Tailwind (dark-mode only), vitest.

## Global Constraints

- **Timezone = America/Mexico_City.** Server "today": `new Date().toLocaleDateString("sv",{timeZone:"America/Mexico_City"})`. Render dates at local noon (`new Date(iso.slice(0,10)+"T12:00:00")`), never bare `new Date(iso)`. Month arithmetic is integer math on `YYYY-MM` strings; last-day-of-month via `new Date(Date.UTC(y,m,0)).getUTCDate()` (UTC read only).
- **Setlist doc types:** Sunday = `featuredSongs`, Saturday = `saturdarSongs` (deliberate typo — do not rename). `special_role` keyed by `date`; `sunday_role`/`saturday_role`/`featuredSongs`/`saturdarSongs` keyed by `week`.
- **Member-facing reads filter `published != false`** — the existing `SCHEDULE_QUERY` already does this on the three role clauses; keep it.
- **Query is reused verbatim.** Do NOT rename its params — they stay `$today`, `$limit`, `$weekStart`. Only the bound *values* change per mode. Do NOT introduce `$from`/`$to`.
- **Conventional commits**, body explains the *why*. **Never** add AI/Claude attribution or `Co-Authored-By` trailers.
- **Before claiming done:** `npx tsc --noEmit` and `npm test` (vitest) must both pass.
- Work on a feature branch off `improve/continuous`; merge to `main` when green (direct push, no PR).

**Reference spec:** `docs/superpowers/specs/2026-07-06-past-set-browsing-design.md`

## File Structure

- **Create** `app/utils/scheduleMonths.ts` — pure month helpers + link builders. One responsibility: month-string arithmetic and href construction. No React, no Sanity.
- **Create** `app/utils/__tests__/scheduleMonths.test.ts` — unit tests for the above.
- **Modify** `app/components/CalendarView.tsx` — add `viewMonth` prop, nav bar, single-month grid, mode-aware empty state; source month names from `scheduleMonths`.
- **Modify** `app/(client)/schedule/page.tsx` — read/validate `?m=`, pick window bounds, mode-aware heading, pass `viewMonth`, drop page-level empty state.

## Setup

- [ ] **Create the feature branch**

```bash
git checkout improve/continuous
git pull --ff-only
git checkout -b feat/schedule-past-browsing
```

---

### Task 1: `scheduleMonths.ts` pure helpers

**Files:**
- Create: `app/utils/scheduleMonths.ts`
- Test: `app/utils/__tests__/scheduleMonths.test.ts`

**Interfaces:**
- Consumes: nothing (leaf module).
- Produces:
  - `MONTH_NAMES_ES: string[]` — 12 Spanish month names, index 0 = Enero.
  - `parseMonthParam(raw: string | undefined | null): string | null` — `"YYYY-MM"` if well-formed (month 01–12), else `null`.
  - `addMonths(ym: string, n: number): string` — `"YYYY-MM"`.
  - `monthBounds(ym: string): { from: string; to: string }` — first/last calendar day as `"YYYY-MM-DD"`.
  - `monthLabel(ym: string): string` — e.g. `"Julio 2026"`.
  - `scheduleHref(ym: string | null): string` — `"/schedule?m=YYYY-MM"`, or `"/schedule"` when `null`.

- [ ] **Step 1: Write the failing test**

Create `app/utils/__tests__/scheduleMonths.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  parseMonthParam,
  addMonths,
  monthBounds,
  monthLabel,
  scheduleHref,
} from "@/app/utils/scheduleMonths";

describe("parseMonthParam", () => {
  it("accepts a well-formed month", () => {
    expect(parseMonthParam("2026-07")).toBe("2026-07");
    expect(parseMonthParam("2026-01")).toBe("2026-01");
    expect(parseMonthParam("2026-12")).toBe("2026-12");
  });
  it("rejects out-of-range and malformed input", () => {
    expect(parseMonthParam("2026-13")).toBeNull();
    expect(parseMonthParam("2026-00")).toBeNull();
    expect(parseMonthParam("2026-7")).toBeNull(); // needs 2-digit month
    expect(parseMonthParam("26-07")).toBeNull();
    expect(parseMonthParam("garbage")).toBeNull();
    expect(parseMonthParam("")).toBeNull();
    expect(parseMonthParam(undefined)).toBeNull();
    expect(parseMonthParam(null)).toBeNull();
  });
});

describe("addMonths", () => {
  it("crosses year boundaries in both directions", () => {
    expect(addMonths("2026-12", 1)).toBe("2027-01");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(addMonths("2026-07", 0)).toBe("2026-07");
    expect(addMonths("2026-07", -13)).toBe("2025-06");
    expect(addMonths("2026-06", 8)).toBe("2027-02");
  });
});

describe("monthBounds", () => {
  it("returns first and last day, handling month lengths and leap years", () => {
    expect(monthBounds("2026-02")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(monthBounds("2024-02")).toEqual({ from: "2024-02-01", to: "2024-02-29" });
    expect(monthBounds("2026-04")).toEqual({ from: "2026-04-01", to: "2026-04-30" });
    expect(monthBounds("2026-01")).toEqual({ from: "2026-01-01", to: "2026-01-31" });
    expect(monthBounds("2026-12")).toEqual({ from: "2026-12-01", to: "2026-12-31" });
  });
});

describe("monthLabel", () => {
  it("renders a title-case Spanish label", () => {
    expect(monthLabel("2026-07")).toBe("Julio 2026");
    expect(monthLabel("2026-01")).toBe("Enero 2026");
    expect(monthLabel("2025-12")).toBe("Diciembre 2025");
  });
});

describe("scheduleHref", () => {
  it("builds browse and default targets", () => {
    expect(scheduleHref("2026-07")).toBe("/schedule?m=2026-07");
    expect(scheduleHref(null)).toBe("/schedule");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run app/utils/__tests__/scheduleMonths.test.ts`
Expected: FAIL — cannot resolve `@/app/utils/scheduleMonths` (module doesn't exist yet).

- [ ] **Step 3: Write the implementation**

Create `app/utils/scheduleMonths.ts`:

```ts
// Pure month-arithmetic + link helpers for /schedule past-set browsing.
// Month values are "YYYY-MM" strings. Fully deterministic — no clock, no
// React/Sanity imports. Keep this a leaf module.

export const MONTH_NAMES_ES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

/** Validate a raw ?m= value. Returns "YYYY-MM" if well-formed (month 01–12), else null. */
export function parseMonthParam(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const match = /^(\d{4})-(\d{2})$/.exec(raw);
  if (!match) return null;
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  return raw;
}

/** Add n months (may be negative) to a "YYYY-MM"; returns "YYYY-MM". */
export function addMonths(ym: string, n: number): string {
  const [y, m] = ym.split("-").map(Number);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = ((total % 12) + 12) % 12; // safe modulo, 0–11
  return `${String(ny).padStart(4, "0")}-${String(nm + 1).padStart(2, "0")}`;
}

/** First and last calendar day of the month, as "YYYY-MM-DD". */
export function monthBounds(ym: string): { from: string; to: string } {
  const [y, m] = ym.split("-").map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate(); // UTC read only — TZ-stable
  return { from: `${ym}-01`, to: `${ym}-${String(lastDay).padStart(2, "0")}` };
}

/** Human label, e.g. "Julio 2026". */
export function monthLabel(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return `${MONTH_NAMES_ES[m - 1]} ${y}`;
}

/** Link target for the schedule page. null → default (rolling) view. */
export function scheduleHref(ym: string | null): string {
  return ym ? `/schedule?m=${ym}` : "/schedule";
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run app/utils/__tests__/scheduleMonths.test.ts`
Expected: PASS (all describe blocks green).

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add app/utils/scheduleMonths.ts app/utils/__tests__/scheduleMonths.test.ts
git commit -m "feat(schedule): month-arithmetic helpers for past-set browsing"
```

---

### Task 2: `CalendarView` — nav bar, single-month grid, empty state

**Files:**
- Modify: `app/components/CalendarView.tsx`

**Interfaces:**
- Consumes (from Task 1): `MONTH_NAMES_ES`, `addMonths`, `monthLabel`, `scheduleHref` from `../utils/scheduleMonths`.
- Produces: `CalendarView` now accepts an optional prop `viewMonth?: string | null` (a `"YYYY-MM"` in browse mode, `undefined`/`null` in default mode). Task 3 passes it.

After this task the page still renders in default mode (page doesn't pass `viewMonth` yet), but the nav bar is live. This is an expected intermediate state.

- [ ] **Step 1: Update imports and remove the local month-name constant**

At the top of `app/components/CalendarView.tsx`, after `import { Setlist } from "../utils/interface";` (line 5), add:

```ts
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MONTH_NAMES_ES, addMonths, monthLabel, scheduleHref } from "../utils/scheduleMonths";
```

Delete the local `MONTH_NAMES` constant (lines 24–27):

```ts
const MONTH_NAMES = [
  "Enero","Febrero","Marzo","Abril","Mayo","Junio",
  "Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre",
];
```

Leave `DAY_HEADERS` (line 28) in place.

- [ ] **Step 2: Add the `viewMonth` prop**

Change the `Props` interface (lines 18–20) from:

```ts
interface Props {
  activeDays: Record<string, ActiveDay[]>;
}
```

to:

```ts
interface Props {
  activeDays: Record<string, ActiveDay[]>;
  viewMonth?: string | null; // "YYYY-MM" in browse mode; undefined/null = default rolling view
}
```

Change the component signature (line 79) from:

```ts
export default function CalendarView({ activeDays }: Props) {
```

to:

```ts
export default function CalendarView({ activeDays, viewMonth }: Props) {
```

- [ ] **Step 3: Compute anchor month, router, single-month grid, and empty state**

Replace the months-array block (lines 95–99):

```ts
  const [todayYear, todayMonth] = todayStr.split("-").map(Number);
  const months = [0, 1, 2].map((offset) => {
    const d = new Date(todayYear, todayMonth - 1 + offset, 1);
    return { year: d.getFullYear(), month: d.getMonth() };
  });
```

with:

```ts
  const router = useRouter();
  const anchorMonth = viewMonth ?? todayStr.slice(0, 7);

  const [todayYear, todayMonth] = todayStr.split("-").map(Number);
  const months = viewMonth
    ? [{ year: Number(viewMonth.slice(0, 4)), month: Number(viewMonth.slice(5, 7)) - 1 }]
    : [0, 1, 2].map((offset) => {
        const d = new Date(todayYear, todayMonth - 1 + offset, 1);
        return { year: d.getFullYear(), month: d.getMonth() };
      });

  const isEmpty = Object.keys(activeDays).length === 0;
  const emptyMessage = viewMonth
    ? `No hay servicios en ${monthLabel(viewMonth)}.`
    : "No hay servicios próximos.";
```

- [ ] **Step 4: Render the nav bar above the view toggle**

Immediately after the opening `<>` (line 105), before the `{/* View toggle */}` block, insert:

```tsx
      {/* Month navigation */}
      <div className="flex items-center justify-center gap-4 mb-4">
        <Link
          href={scheduleHref(addMonths(anchorMonth, -1))}
          aria-label="Mes anterior"
          className="px-3 py-2 rounded-lg border border-[#003572]/30 dark:border-[#00bfff]/20 font-label text-xs uppercase tracking-widest text-gray-400 hover:text-[#C8D8EB] hover:border-[#00bfff]/40 transition-colors"
        >
          ‹ Anterior
        </Link>
        <div className="text-center min-w-[9rem]">
          <p className="font-display text-base font-bold uppercase">{monthLabel(anchorMonth)}</p>
          {!viewMonth && (
            <p className="font-label text-[10px] uppercase tracking-widest text-gray-500">Próximos</p>
          )}
        </div>
        <Link
          href={scheduleHref(addMonths(anchorMonth, 1))}
          aria-label="Mes siguiente"
          className="px-3 py-2 rounded-lg border border-[#003572]/30 dark:border-[#00bfff]/20 font-label text-xs uppercase tracking-widest text-gray-400 hover:text-[#C8D8EB] hover:border-[#00bfff]/40 transition-colors"
        >
          Siguiente ›
        </Link>
      </div>
      <div className="flex items-center justify-center gap-3 mb-8">
        <label className="flex items-center gap-2">
          <span className="sr-only">Ir al mes</span>
          <input
            type="month"
            value={anchorMonth}
            onChange={(e) => { if (e.target.value) router.push(scheduleHref(e.target.value)); }}
            className="bg-transparent border border-[#003572]/30 dark:border-[#00bfff]/20 rounded-lg px-3 py-1.5 font-label text-xs text-[#C8D8EB] [color-scheme:dark]"
          />
        </label>
        {viewMonth && (
          <Link
            href="/schedule"
            className="px-4 py-1.5 rounded-lg border border-[#00bfff]/40 font-label text-xs uppercase tracking-widest text-[#00bfff] hover:bg-[#003572]/40 transition-colors"
          >
            Hoy
          </Link>
        )}
      </div>
```

- [ ] **Step 5: Gate the grid on the single-month layout and the empty state**

Replace the calendar-view block (lines 154–169):

```tsx
      {/* Calendar view */}
      {view === "calendar" && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-10">
          {months.map(({ year, month }) => (
            <MonthGrid
              key={`${year}-${month}`}
              year={year}
              month={month}
              activeDays={activeDays}
              todayStr={todayStr}
              selected={selected}
              onSelect={setSelected}
            />
          ))}
        </div>
      )}
```

with:

```tsx
      {/* Empty state (owns both grid and list) */}
      {isEmpty && (
        <p className="text-center font-label text-sm text-gray-400 py-20">{emptyMessage}</p>
      )}

      {/* Calendar view */}
      {!isEmpty && view === "calendar" && (
        <div className={viewMonth ? "max-w-sm mx-auto" : "grid grid-cols-1 md:grid-cols-3 gap-10"}>
          {months.map(({ year, month }) => (
            <MonthGrid
              key={`${year}-${month}`}
              year={year}
              month={month}
              activeDays={activeDays}
              todayStr={todayStr}
              selected={selected}
              onSelect={setSelected}
            />
          ))}
        </div>
      )}
```

- [ ] **Step 6: Remove the list-view's own empty check and gate list on `!isEmpty`**

Change the list-view opening (line 172) from:

```tsx
      {/* List view */}
      {view === "list" && (
        <div className="space-y-14">
          {weekends.length === 0 && (
            <p className="text-center font-label text-sm text-gray-400 py-20">
              No hay roles asignados para los próximos tres meses.
            </p>
          )}
          {weekends.map(([sundayKey, { sat, satDate, sun, sunDate, specials }]) => {
```

to:

```tsx
      {/* List view */}
      {!isEmpty && view === "list" && (
        <div className="space-y-14">
          {weekends.map(([sundayKey, { sat, satDate, sun, sunDate, specials }]) => {
```

(Leave the rest of the `.map` body unchanged.)

- [ ] **Step 7: Fix the `MONTH_NAMES` reference in `MonthGrid`**

In `MonthGrid` (line 304), change:

```tsx
        {MONTH_NAMES[month]} {year}
```

to:

```tsx
        {MONTH_NAMES_ES[month]} {year}
```

- [ ] **Step 8: Typecheck and test**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm test`
Expected: PASS (existing suite + Task 1 tests still green; no CalendarView tests exist).

- [ ] **Step 9: Commit**

```bash
git add app/components/CalendarView.tsx
git commit -m "feat(schedule): month nav bar + single-month browse in CalendarView"
```

---

### Task 3: `/schedule` page — `?m=` window switching and mode-aware heading

**Files:**
- Modify: `app/(client)/schedule/page.tsx`

**Interfaces:**
- Consumes (from Task 1): `parseMonthParam`, `monthBounds`, `monthLabel` from `@/app/utils/scheduleMonths`.
- Consumes (from Task 2): `CalendarView`'s `viewMonth` prop.
- Produces: final wired feature — `/schedule` (default) and `/schedule?m=YYYY-MM` (browse).

- [ ] **Step 1: Import the helpers**

Change the import block (lines 1–5). After line 5 (`import { SundayRole, ... } from "@/app/utils/interface";`) add:

```ts
import { parseMonthParam, monthBounds, monthLabel } from "@/app/utils/scheduleMonths";
```

- [ ] **Step 2: Make `getScheduleData` window-aware**

Replace the whole `getScheduleData` function (lines 49–64):

```ts
async function getScheduleData() {
  const today = localToday();
  const [y, m, d] = today.split("-").map(Number);
  const limit = new Date(Date.UTC(y, m - 1, d + 95)).toISOString().slice(0, 10);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const daysToMon = dow === 0 ? -6 : 1 - dow;
  const weekStart = new Date(Date.UTC(y, m - 1, d + daysToMon)).toISOString().slice(0, 10);

  return client.fetch<{
    sundays: SundayRole[];
    saturdays: SaturdayRole[];
    sunSetlists: Setlist[];
    satSetlists: Setlist[];
    specials: SpecialRole[];
  }>(SCHEDULE_QUERY, { today, limit, weekStart });
}
```

with:

```ts
async function getScheduleData(viewMonth: string | null) {
  let today: string;
  let limit: string;
  let weekStart: string;

  if (viewMonth) {
    // Browse mode: the whole selected month (day 1 → last day), incl. the
    // current month, so already-past services this month are reachable.
    const { from, to } = monthBounds(viewMonth);
    today = from;
    limit = to;
    weekStart = from;
  } else {
    // Default mode: rolling today → +95 days (unchanged).
    today = localToday();
    const [y, m, d] = today.split("-").map(Number);
    limit = new Date(Date.UTC(y, m - 1, d + 95)).toISOString().slice(0, 10);
    const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    const daysToMon = dow === 0 ? -6 : 1 - dow;
    weekStart = new Date(Date.UTC(y, m - 1, d + daysToMon)).toISOString().slice(0, 10);
  }

  return client.fetch<{
    sundays: SundayRole[];
    saturdays: SaturdayRole[];
    sunSetlists: Setlist[];
    satSetlists: Setlist[];
    specials: SpecialRole[];
  }>(SCHEDULE_QUERY, { today, limit, weekStart });
}
```

- [ ] **Step 3: Read `?m=`, pass `viewMonth`, make the heading mode-aware, drop the page-level empty state**

Change the page signature (line 68) from:

```ts
export default async function SchedulePage() {
  const { sundays, saturdays, sunSetlists, satSetlists, specials } = await getScheduleData();
```

to:

```ts
export default async function SchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ m?: string }>;
}) {
  const viewMonth = parseMonthParam((await searchParams).m);
  const { sundays, saturdays, sunSetlists, satSetlists, specials } = await getScheduleData(viewMonth);
```

Then change the render block (lines 125–138). From:

```tsx
  return (
    <div>
      <Navbar title="Calendario" tags schedule />
      <div className="mx-auto max-w-4xl px-6 pt-10 pb-16">
        <h2 className="font-display text-center text-2xl md:text-3xl font-bold mb-10">
          Próximos fines de semana
        </h2>
        {Object.keys(activeDays).length === 0 && (
          <p className="text-center font-label text-sm text-gray-400 py-20">
            No hay roles asignados para los próximos tres meses.
          </p>
        )}
        <CalendarView activeDays={activeDays} />
      </div>
    </div>
  );
```

to:

```tsx
  return (
    <div>
      <Navbar title="Calendario" tags schedule />
      <div className="mx-auto max-w-4xl px-6 pt-10 pb-16">
        <h2 className="font-display text-center text-2xl md:text-3xl font-bold mb-10">
          {viewMonth ? monthLabel(viewMonth) : "Próximos fines de semana"}
        </h2>
        <CalendarView activeDays={activeDays} viewMonth={viewMonth} />
      </div>
    </div>
  );
```

(The empty state now lives entirely in `CalendarView`, removing the transient double-empty from Task 2.)

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors (this is where a mistyped async `searchParams` signature would surface).

- [ ] **Step 5: Run the full test suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Manual smoke check (dev server)**

Run: `npm run dev`, then verify in the browser:
- `/schedule` — default rolling view, nav bar shows current month + "Próximos", no "Hoy" button.
- Click **‹ Anterior** — URL becomes `/schedule?m=<prev-month>`; heading + label show that month; "Hoy" button appears; a past month with backfilled setlists shows setlist-only DayCards.
- Click **Hoy** — returns to `/schedule` default view.
- Use the month picker to jump to a month with no services — mode-aware empty message ("No hay servicios en <Mes> <año>.") with nav bar still usable.
- Jump to the current month via the picker — full current month renders (including any service earlier this month), "Hoy" button present.

- [ ] **Step 7: Commit**

```bash
git add "app/(client)/schedule/page.tsx"
git commit -m "feat(schedule): browse past months via ?m= window switching"
```

---

### Task 4: Merge

- [ ] **Step 1: Final verification on the branch**

Run: `npx tsc --noEmit && npm test`
Expected: both pass.

- [ ] **Step 2: Merge to main and push**

```bash
git checkout main
git pull --ff-only
git merge --no-ff feat/schedule-past-browsing -m "feat(schedule): past-set month browsing"
git push origin main
```

(Per repo convention: direct push, no PR, no AI attribution.)

## Notes for the implementer

- **Lone weekend cards at month boundaries are intentional**, not a bug: `getWeekends` (`CalendarView.tsx:49-75`) groups a Sat/Sun pair under the Sunday's week key. In a single-month browse, a month's trailing Saturday (whose Sunday is next month) or leading Sunday (whose Saturday was last month) renders alone. The list JSX already null-guards `sat && satDate` and `sun && sunDate` independently, so a half-populated `WeekGroup` renders without error. Do not "fix" this by widening query bounds.
- **`DayCard` already tolerates missing team** (`DayCard.tsx:60,76`): it renders a setlist-only card when role docs are absent — the common case for old backfilled weeks. No `DayCard` change is needed.
- **Do not rename the GROQ params.** `SCHEDULE_QUERY` keeps `$today`/`$limit`/`$weekStart`; only the values differ per mode (see Task 3 Step 2).
- **`MonthGrid`'s internal date math** (`firstDayOffset`, `getDaysInMonth`) uses local `new Date(year, month, ...)` but only reads local calendar fields (no ISO round-trip), so it is TZ-stable — leave it untouched.
