# R2 — Schedule as an agenda strip Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/schedule` becomes an agenda: a month header with icon buttons (no fixed-width label), a swipeable day strip with the service days lit, and an agenda of service days only (`DOM 13 SEP · en 5 días`, one summary line, a conflict flag) that opens the existing day sheet. The month grid stays as a second mode («Mes»); the card list («Lista») goes.

**Architecture:** Pure agenda logic (`app/utils/agenda.ts`, neutral) computes rows, summaries, conflicts and the strip's days; `DayCard`'s duplicate detection moves there so both agree. One new `ui/` primitive, `SwipeStrip`, owns the `motion` drag-with-snap so the boundary holds. `CalendarView` becomes the mode host (`Agenda` | `Mes`) with a `Presence` crossfade; `AgendaView`, `ScheduleHeader` and `DayStrip` are new client components. Month navigation stays server-driven (`?m=`), one month per step; the fetch window is unchanged (3 months from the anchor; rolling 95 days by default).

**Tech Stack:** Next.js 16 App Router, React 19, Tailwind 3.4, `motion` 13.2 (`motion/react-m`, `domMax` loaded), vitest + RTL, Node 22.

**Spec:** `docs/superpowers/specs/2026-09-08-premium-motion-design.md` — §12.3 (agenda strip), §5.2 (schedule motion), §17 (month input = `DateField`, Anterior/Siguiente become icon buttons at the strip's ends), §19.2 (status pill via `NumberRoll`), §18 (label budget). Part IV decisions C (enter-only transitions), N. Deferred to R7: pull-to-refresh, long-press.

## Global Constraints

- Gates before any commit, in ONE `&&` chain with the commit: `npx tsc --noEmit && npx vitest run && npx eslint .` (0 errors) — Node 22 (`export PATH=~/.nvm/versions/node/v22.22.3/bin:$PATH`). Every task runs the full suite. `node scripts/colour-inventory.mjs` after any class/colour change; fixture committed.
- `motion` only under `app/components/ui/**`; Server Components never CALL a client-module value.
- `Button` for every button except list rows/day cells (DayCard row exemption, say so in a comment); `SegmentedControl` for the mode switch; `<CueDialog open={variable}>` — the existing day sheet keeps its shape; `Presence` for the crossfade; `Skeleton` for loading; `NumberRoll` for the countdown pill; `daysUntil`/`formatCountdown` from `app/utils/daysUntil.ts` (CDMX-pinned) — never re-derive.
- Timezone: dates pinned to local noon; "today" via `toLocaleDateString("sv", { timeZone: "America/Mexico_City" })` (already in `CalendarView`).
- Label budget: no new eyebrows; the page's `h2` («Próximos fines de semana» / range label) goes — the strip header IS the heading.
- Spanish UI; conventional commits; no AI attribution; docs current in the same task.

---

### Task 1: Agenda logic as a neutral module

**Files:**
- Create: `app/utils/agenda.ts`, `app/utils/__tests__/agenda.test.ts`
- Modify: `app/components/DayCard.tsx` (import `findDuplicates` from the util; delete the local copy)

**Interfaces:**
- Produces: `findDuplicates(names)`, `serviceTone(entry)` → `"sun" | "sat" | "special"`, `serviceConflicts(entry)` → number, `summarizeService(entry)` → string, `agendaRows(activeDays)` → `AgendaRow[]`, `monthStripDays(ym, activeDays, todayStr)` → `StripDay[]`.

- [ ] **Step 1: Failing tests**

```ts
// app/utils/__tests__/agenda.test.ts
import { describe, it, expect } from "vitest";
import { findDuplicates, serviceTone, serviceConflicts, summarizeService, agendaRows, monthStripDays } from "../agenda";
import type { ActiveDay } from "../../components/CalendarView";

const sun = (date: string, extra: Partial<ActiveDay> = {}): ActiveDay => ({ day: "Domingo", date, leads: ["Jakey", "Marianne"], instruments: [{ label: "Keys", person: "Sofi" }, { label: "Bass", person: "Mkz" }], setlist: { songs: Array(5).fill({ _id: "s", title: "t" }) as never, week: date }, ...extra });
const sat = (date: string): ActiveDay => ({ day: "Sábado", date, leads: ["Ana"] });
const special = (date: string): ActiveDay => ({ day: "Noche de alabanza", date, roleId: "sp1", leads: [] });

describe("findDuplicates", () => {
  it("lowercases, trims, and returns only names seen more than once", () => {
    expect([...findDuplicates(["Sofi", " sofi", "Mkz"])]).toEqual(["sofi"]);
  });
});
describe("serviceTone / serviceConflicts", () => {
  it("tones by day and roleId", () => {
    expect(serviceTone(sun("2026-09-13"))).toBe("sun");
    expect(serviceTone(sat("2026-09-12"))).toBe("sat");
    expect(serviceTone(special("2026-09-15"))).toBe("special");
  });
  it("counts a person seated twice in one section, per section", () => {
    const e = sun("2026-09-13", { leads: ["Ana", "Ana"], instruments: [{ label: "Keys", person: "Sofi" }, { label: "Bass", person: "sofi" }] });
    expect(serviceConflicts(e)).toBe(2);
    expect(serviceConflicts(sun("2026-09-13"))).toBe(0);
  });
});
describe("summarizeService", () => {
  it("joins lead · instruments · song count, skipping empty parts", () => {
    expect(summarizeService(sun("2026-09-13"))).toBe("Lead Jakey, Marianne · Keys Sofi · Bass Mkz · 5 canciones");
    expect(summarizeService(sat("2026-09-12"))).toBe("Lead Ana");
    expect(summarizeService(special("2026-09-15"))).toBe("Sin asignaciones");
  });
});
describe("agendaRows", () => {
  it("one row per service, sorted by date then Sábado < Domingo < specials, with a month marker on the first row of each month", () => {
    const rows = agendaRows({ "2026-09-13": [sun("2026-09-13")], "2026-09-12": [sat("2026-09-12")], "2026-10-04": [sun("2026-10-04")], "2026-09-13x": [] });
    expect(rows.map((r) => `${r.date} ${r.entry.day}`)).toEqual(["2026-09-12 Sábado", "2026-09-13 Domingo", "2026-10-04 Domingo"]);
    expect(rows.map((r) => r.monthStart)).toEqual(["2026-09", null, "2026-10"]);
    expect(rows[0].key).toBe("2026-09-12:Sábado");
  });
});
describe("monthStripDays", () => {
  it("lists every day of the month with weekday letters, lit tones, and today", () => {
    const days = monthStripDays("2026-09", { "2026-09-13": [sun("2026-09-13")], "2026-09-12": [sat("2026-09-12")] }, "2026-09-10");
    expect(days).toHaveLength(30);
    expect(days[0]).toMatchObject({ date: "2026-09-01", dow: "M", num: 1, tone: null, today: false });
    expect(days[11]).toMatchObject({ date: "2026-09-12", dow: "S", tone: "sat" });
    expect(days[12]).toMatchObject({ date: "2026-09-13", dow: "D", tone: "sun" });
    expect(days[9].today).toBe(true);
  });
});
```

- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement**

```ts
// app/utils/agenda.ts
// Pure agenda logic for /schedule (spec §12.3). NEUTRAL — no React. DayCard's
// duplicate detection lives here so the agenda's conflict flag and the card's
// ⚠ marks can never disagree.
import type { ActiveDay } from "../components/CalendarView";

export type Tone = "sun" | "sat" | "special";

export function findDuplicates(names: string[]): Set<string> {
  const counts = new Map<string, number>();
  for (const n of names) { const k = n.toLowerCase().trim(); if (k) counts.set(k, (counts.get(k) ?? 0) + 1); }
  return new Set([...counts].filter(([, c]) => c > 1).map(([k]) => k));
}

export function serviceTone(e: ActiveDay): Tone {
  if (e.roleId) return "special";
  if (e.day === "Sábado") return "sat";
  if (e.day === "Domingo") return "sun";
  return "special";
}

const voices = (e: ActiveDay) => [
  ...(e.leads ?? []),
  ...(e.bgvs ?? []).map((m) => m.alias || m.member_name),
  ...(e.chorus ?? []).map((m) => m.alias || m.member_name),
];

/** Conflicts = people seated twice within ONE section (voces / instrumentos / foh). */
export function serviceConflicts(e: ActiveDay): number {
  const instr = (e.instruments ?? []).filter((s) => s.person).map((s) => s.person);
  const foh = (e.fohTeam ?? []).filter((s) => s.person).map((s) => s.person);
  return findDuplicates(voices(e)).size + findDuplicates(instr).size + findDuplicates(foh).size;
}

export function summarizeService(e: ActiveDay): string {
  const parts: string[] = [];
  if (e.leads?.length) parts.push(`Lead ${e.leads.join(", ")}`);
  for (const s of (e.instruments ?? []).filter((s) => s.person)) parts.push(`${s.label} ${s.person}`);
  const n = e.setlist?.songs?.length ?? 0;
  if (n) parts.push(`${n} ${n === 1 ? "canción" : "canciones"}`);
  return parts.length ? parts.join(" · ") : "Sin asignaciones";
}

export type AgendaRow = { key: string; date: string; entry: ActiveDay; tone: Tone; conflicts: number; summary: string; monthStart: string | null };

const ORDER: Record<Tone, number> = { sat: 0, sun: 1, special: 2 };

export function agendaRows(activeDays: Record<string, ActiveDay[]>): AgendaRow[] {
  const rows = Object.entries(activeDays)
    .filter(([date]) => /^\d{4}-\d{2}-\d{2}$/.test(date))
    .flatMap(([date, entries]) => entries.map((entry) => ({ date, entry, tone: serviceTone(entry) })))
    .sort((a, b) => a.date.localeCompare(b.date) || ORDER[a.tone] - ORDER[b.tone]);
  let lastMonth = "";
  return rows.map(({ date, entry, tone }) => {
    const month = date.slice(0, 7);
    const monthStart = month !== lastMonth ? month : null;
    lastMonth = month;
    return { key: `${date}:${entry.roleId ?? entry.day}`, date, entry, tone, conflicts: serviceConflicts(entry), summary: summarizeService(entry), monthStart };
  });
}

export type StripDay = { date: string; num: number; dow: string; tone: Tone | null; today: boolean; multiple: boolean };
const DOW = ["D", "L", "M", "X", "J", "V", "S"]; // getUTCDay order, Spanish initials

export function monthStripDays(ym: string, activeDays: Record<string, ActiveDay[]>, todayStr: string): StripDay[] {
  const [y, m] = ym.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: last }, (_, i) => {
    const date = `${ym}-${String(i + 1).padStart(2, "0")}`;
    const entries = activeDays[date] ?? [];
    const tones = entries.map(serviceTone);
    const tone: Tone | null = tones.includes("special") ? "special" : tones.includes("sat") ? "sat" : tones.includes("sun") ? "sun" : null;
    return { date, num: i + 1, dow: DOW[new Date(Date.UTC(y, m - 1, i + 1)).getUTCDay()], tone, today: date === todayStr, multiple: entries.length > 1 };
  });
}
```

`DayCard.tsx`: delete its local `findDuplicates` and `import { findDuplicates } from "@/app/utils/agenda"` — behaviour identical (`dayCard.test.tsx` stays green). `ActiveDay` is a type-only import from a client module — legal (types are erased); if `clientBoundary` complains, move the `ActiveDay` type to `app/utils/interface.tsx` and re-export it from `CalendarView`.

- [ ] **Step 4: Tests → PASS; full suite; commit** — `feat(schedule): agenda logic — rows, summaries, conflicts, the month strip's days`

---

### Task 2: `SwipeStrip` primitive

**Files:**
- Create: `app/components/ui/SwipeStrip.tsx`, `app/components/ui/__tests__/SwipeStrip.test.tsx`
- Modify: `docs/MOTION.md` (primitives table row)

**Interfaces:**
- Produces: `<SwipeStrip onSwipe={(dir: -1 | 1) => void} threshold={64} className>{children}</SwipeStrip>` — `m.div drag="x"` with `dragConstraints={{ left: 0, right: 0 }}`, `dragElastic={0.2}`, `dragSnapToOrigin`, spring `SPRINGS.settle`; on `onDragEnd`, if `offset.x < -threshold` or `velocity.x < -500` → `onSwipe(1)` (next), mirrored for previous; horizontal-only (`dragDirectionLock`), `touch-action: pan-y` so vertical scroll survives; keyboard is NOT the strip's job (the header buttons cover it); reduced motion: the drag still works, the snap uses `duration: 0`.

- [ ] **Step 1: Failing test** — renders children; a pointerdown/move/up sequence of −120px on the host calls `onSwipe(1)`; +120px calls `onSwipe(-1)`; 20px calls nothing. Use the sibling render pattern (`installMotionTestEnv` + `MotionProvider`); if jsdom cannot drive motion's drag, test the exported pure `swipeDirection(offsetX, velocityX, threshold)` helper instead and render-smoke the component — say which in the report.
- [ ] **Step 2: Implement; docs row; full suite; commit** — `feat(motion): SwipeStrip — drag with snap for month paging`

---

### Task 3: Schedule header and day strip

**Files:**
- Create: `app/components/ScheduleHeader.tsx`, `app/components/DayStrip.tsx`, `app/components/__tests__/dayStrip.test.tsx`
- Modify: `app/brand.css` (one-shot today-dot pulse keyframe), colour fixture

**Interfaces:**
- Consumes: `monthStripDays`, `scheduleHref`, `addMonths`, `monthLabel` (`scheduleMonths.ts`), `DateField`, `Button variant="icon"`, `SwipeStrip`.
- Produces: `<ScheduleHeader anchorMonth viewMonth />` — row 1: `Button variant="icon" size="lg" aria-label="Mes anterior" href={scheduleHref(addMonths(anchorMonth, -1))}` `‹` · `monthLabel(anchorMonth)` as an `h2` (`font-display uppercase`, `min-w-0 truncate`, no fixed width — the overflow fix by construction) · `›` `Mes siguiente`; row 2: `DateField kind="month"` (as today, one-month steps) + `Hoy` (`Button variant="ghost" size="sm" href="/schedule"`, only when `viewMonth`). `<DayStrip anchorMonth activeDays todayStr onPick(date) onSwipe(dir) />` — a `SwipeStrip` wrapping a horizontal `overflow-x-auto snap-x snap-mandatory scrollbar-hide` row of the month's days, 7 per viewport (`min-w-[calc(100%/7)] snap-start`), each a `<button>` (row exemption): weekday initial over the number; lit days carry the tone (`sun` accent / `sat` warning / `special` info, same classes as the month grid's cells); unlit days `disabled`; today gets `aria-current="date"` and a dot that pulses ONCE on reveal (`brand-today-pulse`, 600 ms, ends on `transform: none`); a second dot for `multiple`. On mount, scroll the strip so today's week (or the first lit day) is in view (`scrollIntoView({ inline: "start", block: "nearest" })`, instant). `onSwipe(1)` → `router.push(scheduleHref(addMonths(anchorMonth, 1)))`.

- [ ] **Step 1: Tests** — `dayStrip.test.tsx`: renders 30 buttons for 2026-09 with lit days enabled and others disabled; today carries `aria-current="date"`; clicking a lit day calls `onPick` with its date; the month label reads «Septiembre 2026»; the icon buttons carry `href`s for the adjacent months.
- [ ] **Step 2: Implement; `node scripts/colour-inventory.mjs`; full suite; commit** — `feat(schedule): month header with icon buttons and the swipeable day strip`

---

### Task 4: Agenda view and the mode host

**Files:**
- Create: `app/components/AgendaView.tsx`, `app/components/__tests__/agendaView.test.tsx`
- Modify: `app/components/CalendarView.tsx`, `app/(client)/schedule/page.tsx`, `app/(client)/schedule/loading.tsx`

**Interfaces:**
- Consumes: Task 1 rows, Task 3 header/strip, `daysUntil`/`formatCountdown`, `NumberRoll`, `Presence`, `SegmentedControl`, the existing `CueDialog` sheet with `DayCard`s.
- `CalendarView` becomes the host: `ScheduleHeader` → `DayStrip` → `SegmentedControl` `Agenda | Mes` (`value` state, default `agenda`) → `Presence` crossfade between `<AgendaView>` and the month grid (both absolutely stacked inside a `relative` host during the 200 ms so the height does not jump — use `Presence variant="fade"` with `as="div"` and a `min-h` on the host; if stacking is impractical, a plain fade on a shared container is the recorded fallback). The «Lista» view and its `getWeekends` grouping go. The legend renders only in `Mes`. The day sheet (`CueDialog`, `Detalle del día`) stays exactly as it is; `AgendaView` rows and strip days both call `onSelect(date)`.
- `AgendaView`: rows = `agendaRows(activeDays)`; a month divider (`monthLabel`) where `monthStart`; each row a `<button>` (row exemption): left a tone rail (2 px, tone colour), `DOM 13 SEP` (`font-display uppercase`, weekday short via `toLocaleDateString("es-MX", { weekday: "short" })`), the countdown pill (`NumberRoll`, `formatCountdown(daysUntil(date))`, only for dates ≥ today), the summary line (`font-body text-sm text-ink-dim truncate`), and `⚠ N conflicto(s)` in `text-warning-fg` when `conflicts > 0`; `aria-label` = `${day} ${fecha larga}${conflicts ? `, ${N} conflictos` : ""}`. Empty: «No hay servicios próximos.» / the browse-mode message (unchanged copy).
- `page.tsx`: delete the `h2`; pass `todayStr` from the server (`localToday()`) so the strip and the agenda agree with the fetch; keep the fetch, maps and `activeDays` construction byte-identical.
- `loading.tsx`: header row (two `h-9 w-9` squares + `h-7 w-40` label), strip (seven `h-14` cells), toggle, six agenda rows (`h-16`). Must satisfy `loadingSkeletons.test.ts`.
- Day cells in the month grid: `active:scale-[0.94] transition-transform duration-fast ease-out-brand` (§5.2 press).

- [ ] **Step 1: Tests** — `agendaView.test.tsx` (mock `usePlayer`/`useSession` like `dayCard.test.tsx`, wrap with the motion test setup + `CueDialogProvider`): renders one row per service in date order with month dividers; the summary and `⚠ 2 conflictos` text; clicking a row calls `onSelect(date)`; the countdown pill reads `En 3 días` under fake timers. A `CalendarView` smoke: default mode is Agenda, switching to Mes shows the grid and the legend, the sheet opens with a `DayCard` on `onSelect`.
- [ ] **Step 2: Implement; inventory; full suite; commit** — `feat(schedule): the agenda — service days only, one line each, opening the day sheet; Lista retires`

---

### Task 5: Docs

- `docs/MOTION.md` — "Schedule (R2)" section: header/strip/agenda, `SwipeStrip`, the crossfade, the once-only today pulse, deviations (server-driven month paging reveals via the route reveal, not a directional slide — decision C makes transitions enter-only anyway).
- `docs/ROUTES.md` (`/schedule` description: agenda default, `Mes` grid, `?m=` one month per step), `docs/UTILITIES_AND_COMPONENTS.md` (rows: `ScheduleHeader`, `DayStrip`, `AgendaView`, `SwipeStrip`, `agenda.ts`; `CalendarView` row updated), `CLAUDE.md`/`AGENTS.md` reusable utils (`SwipeStrip`, `findDuplicates`/`serviceConflicts`), spec **Part XI — R2** (scope, rulings: Agenda|Mes replaces Calendario|Lista; arrows step one month; strip = month days snapped by week; conflicts counted per section; deferrals), and the `docs/superpowers/specs/2026-09-08-premium-motion-shots/` pair (`schedule-before.png` from dev before the preview push, `schedule-after.png` after) — captured at Task 6.
- [ ] Gates; commit — `docs(motion): R2 — the schedule agenda`

---

### Task 6: Delivery (coordinator)

- [ ] Gates on the tip; bundle A/B (git-archive cold builds, APFS-cloned `node_modules`) for `/schedule`, `/`, `/admin`; whole-branch review (fable) → fix wave → re-review; `schedule-before.png` from dev BEFORE pushing preview; preview → alias+SHA → dev-verify captures (phone agenda, phone Mes, 1440 agenda, sheet open) → visual-verifier → `schedule-after.png` committed → PR → STOP for Frank's look.
