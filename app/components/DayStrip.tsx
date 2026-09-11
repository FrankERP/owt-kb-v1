"use client";
// app/components/DayStrip.tsx
// The /schedule day strip (spec §12.3, R2 Task 3): the anchor month as one row of
// days, seven per viewport, snapped so a scroll lands on a day boundary. The month
// grid stays available behind the Agenda|Mes switch — this is the fast scan.
//
// Every day of the month renders, so the strip reads as a calendar rather than a
// filtered list; only the days that carry a service are pressable (`disabled`
// otherwise), and they carry the SAME tone classes as the month grid's cells
// (accent = Domingo, warning = Sábado, info = especial) so the two views can never
// disagree about what a colour means.
//
// Each cell is a plain `<button>`, not the `Button` primitive — the recorded row/cell
// exemption (the R2 rubric ruling, same as `LibraryRow` and `DayCard`'s setlist rows):
// the cell IS the affordance, and a variant's padding/radius would fight the 1/7-width
// snap track.
//
// A horizontal drag pages the month through `SwipeStrip`. By default that is a route
// push (`?m=`), mirroring the header's arrows — month paging is server-driven, so the
// route reveal carries the transition (decision C). `onSwipe` is there for a host that
// needs to own the navigation.
import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import SwipeStrip from "./ui/SwipeStrip";
import type { ActiveDay } from "./CalendarView";
import { monthStripDays, type Tone } from "../utils/agenda";
import { addMonths, scheduleHref } from "../utils/scheduleMonths";
import { haptic } from "../utils/haptics";

/** Lit-day classes, copied from `MonthGrid`'s active cells — one vocabulary for both views. */
const TONE: Record<Tone, string> = {
  sun: "bg-accent-deep/50 border border-accent/50 text-accent hover:bg-accent-deep/80 hover:border-accent",
  sat: "bg-warning-surface/50 border border-warning-fg/50 text-warning-fg hover:bg-warning-surface/80 hover:border-warning-fg",
  special: "bg-info-surface/50 border border-info-fg/50 text-info-fg hover:bg-info-surface/80 hover:border-info-fg",
};

export default function DayStrip({
  anchorMonth,
  activeDays,
  todayStr,
  onPick,
  onSwipe,
}: {
  anchorMonth: string;
  activeDays: Record<string, ActiveDay[]>;
  todayStr: string;
  onPick: (date: string) => void;
  onSwipe?: (direction: -1 | 1) => void;
}) {
  const router = useRouter();
  const days = monthStripDays(anchorMonth, activeDays, todayStr);

  // Where the strip opens: today when the anchor month contains it, else the first
  // day with a service. A month with neither (an empty past month) opens at day 1,
  // which is where the scroller already sits.
  const anchorDate = days.find((d) => d.today)?.date ?? days.find((d) => d.tone)?.date ?? null;
  const anchorRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    // `inline: "start"` puts the anchor day at the left edge, so its week fills the
    // viewport; `block: "nearest"` is what keeps this from scrolling the PAGE to the
    // strip on every mount. Instant — a smooth scroll on arrival reads as a glitch,
    // and the reveal is already animating.
    anchorRef.current?.scrollIntoView({ behavior: "instant", inline: "start", block: "nearest" });
  }, [anchorDate]);

  const handleSwipe = (direction: -1 | 1) => {
    if (onSwipe) return onSwipe(direction);
    router.push(scheduleHref(addMonths(anchorMonth, direction)));
  };

  return (
    <SwipeStrip onSwipe={handleSwipe} className="mb-6">
      <div className="flex snap-x snap-mandatory overflow-x-auto scrollbar-hide">
        {days.map((d) => {
          const label = new Date(`${d.date}T12:00:00`).toLocaleDateString("es-MX", {
            weekday: "long",
            day: "numeric",
            month: "long",
          });
          const entries = activeDays[d.date] ?? [];
          return (
            <button
              key={d.date}
              ref={d.date === anchorDate ? anchorRef : undefined}
              type="button"
              disabled={!d.tone}
              aria-current={d.today ? "date" : undefined}
              aria-label={`${label}${entries.length ? `, ${entries.map((e) => e.day).join(", ")}` : ""}`}
              onClick={() => {
                // Native only, fire-and-forget (see haptics.ts) — never gates the pick.
                void haptic("selection");
                onPick(d.date);
              }}
              className={`relative flex min-w-[calc(100%/7)] snap-start flex-col items-center justify-center gap-0.5 rounded-lg py-2 transition-colors duration-fast ease-out-brand ${
                d.tone ? `${TONE[d.tone]} cursor-pointer active:scale-[0.94]` : "text-mono-400 dark:text-mono-400 cursor-default"
              }`}
            >
              <span className="font-label text-[10px] uppercase tracking-widest opacity-70">{d.dow}</span>
              <span className="font-display text-sm font-bold">{d.num}</span>
              {d.today && (
                // Centred with a negative margin, NOT `-translate-x-1/2`: the pulse
                // animates `transform`, which would override a translate utility for
                // the whole pass and then drop it at `transform: none`.
                <span className="brand-today-pulse absolute bottom-0.5 left-1/2 -ml-0.5 h-1 w-1 rounded-full bg-current opacity-60" />
              )}
              {d.multiple && (
                <span className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-current opacity-80" />
              )}
            </button>
          );
        })}
      </div>
    </SwipeStrip>
  );
}
