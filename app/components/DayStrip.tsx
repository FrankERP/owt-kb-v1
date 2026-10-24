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
// otherwise). Since the «millones» pass (2026-10-24) a day is TEXT, not a card: the
// weekday in the label face, the number in the display face inside a round target,
// and one tone dot per service under it (`DayDots`, ADR-0067) — the same circle the
// month grid draws, so the two views can never disagree about what a colour means.
// Lit days come from `activeDays` whatever month they fall in — a paged week that
// crosses into the next month still lights up. Today is an inset ink ring; a day the
// signed-in member is seated in adds a green dot («tú», the one green in the app).
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
      <p className="mb-2 text-center font-body text-sm text-ink-muted">
        {weekRangeLabel(days[0].date, days[6].date)}
      </p>
      <div className="grid grid-cols-7">
        {days.map((d) => {
          const entries = activeDays[d.date] ?? [];
          return (
            // The weekday and the dots sit OUTSIDE the button: the round target is the
            // number alone, so a fill or a ring never recolours the day's other facts.
            // The button's `aria-label` (`dayCellLabel`) names the weekday anyway.
            <div key={d.date} className="flex flex-col items-center gap-1.5 py-1">
              <span aria-hidden className="font-label text-[11px] uppercase tracking-[0.12em] text-ink-muted">{d.dow}</span>
              <button
                type="button"
                disabled={!d.lit}
                aria-current={d.today ? "date" : undefined}
                aria-label={dayCellLabel(d, entries)}
                onClick={() => {
                  // Native only, fire-and-forget (see haptics.ts) — never gates the pick.
                  void haptic("selection");
                  onPick(d.date);
                }}
                className={`${DAY_CELL_BASE} h-10 w-10 text-[22px] ${d.lit ? DAY_CELL_LIT : DAY_CELL_EMPTY} ${d.today ? DAY_CELL_TODAY : ""}`}
              >
                {d.num}
              </button>
              <DayDots tones={d.tones} mine={d.mine} />
            </div>
          );
        })}
      </div>
    </SwipeStrip>
  );
}
