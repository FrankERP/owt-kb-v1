"use client";
// app/components/DayStrip.tsx
// The /schedule WEEK strip (spec §12.3's «week strip, swipeable»): seven days per
// view, one per column of a `grid-cols-7`, and a horizontal drag PAGES THE WEEK.
// There is no inner scroller — `SwipeStrip`'s host sets `touch-action: pan-y`, so a
// horizontal overflow inside it could never be finger-scrolled anyway; paging is the
// gesture the strip actually has. The two axes stay separate: the strip pages WEEKS
// client-side (`useState`, no navigation), the header's arrows page MONTHS
// server-side (`?m=`, so the route reveal carries them — decision C).
//
// Every day of the visible week renders, so the strip reads as a calendar rather than
// a filtered list; only the days that carry a service are pressable (`disabled`
// otherwise). A lit day is a NEUTRAL raised cell with one tone dot per service under
// the number (`DayDots`, ADR-0067) — the same cell the month grid draws, so the two
// views can never disagree about what a colour means. Lit days come from
// `activeDays` whatever month they fall in — a paged week that crosses into the next
// month still lights up. Today is an inset accent ring; a day the signed-in member
// is seated in paints its number positive («tú», the one green in the app).
//
// The caption above the cells is what makes a paged week legible: «7 – 13 sep», and
// it is the only label that moves, since the header's month heading does not.
//
// Each cell is a plain `<button>`, not the `Button` primitive — the recorded row/cell
// exemption (the R2 rubric ruling, same as `LibraryRow` and `DayCard`'s setlist rows):
// the cell IS the affordance, and a variant's padding/radius would fight the seven
// equal columns.
import { useState } from "react";
import SwipeStrip from "./ui/SwipeStrip";
import type { ActiveDay } from "./CalendarView";
import { addDays, dayCellLabel, mondayOf, weekStripDays } from "../utils/agenda";
import { haptic } from "../utils/haptics";
import DayDots, { DAY_CELL_BASE, DAY_CELL_EMPTY, DAY_CELL_LIT, DAY_CELL_TODAY } from "./DayDots";

/** Local-noon render, never a bare `new Date(iso)` — the UTC day-flip rule. */
const fmt = (iso: string, options: Intl.DateTimeFormatOptions) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString("es-MX", options);

/** «7 – 13 sep» within one month, «28 sep – 4 oct» across two. */
function weekRangeLabel(from: string, to: string): string {
  const day = (iso: string) => fmt(iso, { day: "numeric" });
  const month = (iso: string) => fmt(iso, { month: "short" });
  return from.slice(0, 7) === to.slice(0, 7)
    ? `${day(from)} – ${day(to)} ${month(to)}`
    : `${day(from)} ${month(from)} – ${day(to)} ${month(to)}`;
}

export default function DayStrip({
  anchorMonth,
  activeDays,
  todayStr,
  onPick,
  onWeekChange,
  myName = "",
}: {
  anchorMonth: string;
  activeDays: Record<string, ActiveDay[]>;
  todayStr: string;
  onPick: (date: string) => void;
  /** The Monday of the week now on screen, after a swipe. Task 4 uses it to scroll the agenda. */
  onWeekChange?: (mondayIso: string) => void;
  /** `myNameFromSession(session?.user)`, derived once by `CalendarView` — flags the
   *  «you» dot (F1). Omitted, no day is ever `mine`. */
  myName?: string;
}) {
  // Which week the strip opens on: today's when the anchor month contains today,
  // else the week of that month's first day. From there it is the swipe's state —
  // changing the month re-mounts the route, so no effect has to sync it.
  const [weekStart, setWeekStart] = useState(() =>
    mondayOf(todayStr.startsWith(`${anchorMonth}-`) ? todayStr : `${anchorMonth}-01`),
  );
  const days = weekStripDays(weekStart, activeDays, todayStr, myName);

  const handleSwipe = (direction: -1 | 1) => {
    const next = addDays(weekStart, 7 * direction);
    // Native only, fire-and-forget (see haptics.ts) — never gates the paging.
    void haptic("selection");
    setWeekStart(next);
    onWeekChange?.(next);
  };

  return (
    <SwipeStrip onSwipe={handleSwipe} className="mb-6">
      <p className="mb-1 text-center font-label text-[10px] uppercase tracking-widest text-mono-400">
        {weekRangeLabel(days[0].date, days[6].date)}
      </p>
      <div className="grid grid-cols-7 gap-1">
        {days.map((d) => {
          const entries = activeDays[d.date] ?? [];
          return (
            <button
              key={d.date}
              type="button"
              disabled={!d.lit}
              aria-current={d.today ? "date" : undefined}
              aria-label={dayCellLabel(d, entries)}
              onClick={() => {
                // Native only, fire-and-forget (see haptics.ts) — never gates the pick.
                void haptic("selection");
                onPick(d.date);
              }}
              className={`${DAY_CELL_BASE} gap-0.5 py-2 ${d.lit ? DAY_CELL_LIT : DAY_CELL_EMPTY} ${d.today ? DAY_CELL_TODAY : ""}`}
            >
              <span className="font-label text-[10px] uppercase tracking-widest opacity-70">{d.dow}</span>
              <span className={`font-display text-sm font-bold ${d.mine ? "text-positive-fg" : ""}`}>{d.num}</span>
              <DayDots tones={d.tones} />
            </button>
          );
        })}
      </div>
    </SwipeStrip>
  );
}
