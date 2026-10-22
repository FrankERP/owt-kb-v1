"use client";
// app/components/ScheduleHeader.tsx
// The /schedule month header (spec §12.3, R2 Task 3; month sheet 2026-10-22):
//
//   ‹  SEPTIEMBRE 2026 ⌄  ›     ← one month per press, server-driven (a route push)
//           Próximos             ← rolling view only; while browsing, a «Hoy» reset
//
// The arrows are the house `Button variant="icon" size="lg"` WITH `href`, so they
// render as `<Link>`s: month paging is a navigation (`?m=`), which keeps the back
// button honest and lets the route reveal carry the transition (decision C).
//
// The month name is itself the jump-to-any-month control: a button inside the `h2`
// that opens a `CueDialog` sheet of one year's twelve months as pills (links to
// `?m=`), with ‹ › arrows to change the year. It replaces the native
// `<input type="month">` the header carried below the title (ADR-0067): the OS
// control drew a second, differently-styled month label under the heading, opened a
// wheel the brand could not style, and on a phone it was the only control on the page
// that did not look like the app. The sheet carries NO one-month steppers — the
// header's arrows already own «Mes anterior»/«Mes siguiente» (the R2 Task 4 ruling).
//
// The label is an `h2` that TRUNCATES inside a `min-w-0 flex-1` cell and carries no
// fixed width. That is the overflow fix by construction: the row this replaces gave
// the label a `sm:min-w-[13rem]` and hid the buttons' words under `sm:` to survive a
// 390 px phone. With one month per arrow the label is short anyway, and a long one
// («Septiembre 2026») now clips instead of pushing the arrows off-screen.
import { useState } from "react";
import { ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon } from "./ui/icons";
import Button from "./ui/Button";
import CueDialog from "./ui/CueDialog";
import { addMonths, MAX_YEAR, MIN_YEAR, monthLabel, scheduleHref, shortMonthLabel, yearMonths } from "../utils/scheduleMonths";

export default function ScheduleHeader({
  anchorMonth,
  viewMonth,
}: {
  anchorMonth: string;
  /** "YYYY-MM" while browsing a past/future month; null or undefined in the default rolling view. */
  viewMonth?: string | null;
}) {
  const [open, setOpen] = useState(false);
  // The year the sheet shows: seeded from the anchor each time it opens, then the
  // sheet's own arrows move it. Picking a month is a navigation that re-renders this
  // header with a new anchor but does NOT remount it, so the pill closes the sheet.
  const [year, setYear] = useState(() => Number(anchorMonth.slice(0, 4)));
  const openSheet = () => { setYear(Number(anchorMonth.slice(0, 4))); setOpen(true); };
  const close = () => setOpen(false);

  return (
    <>
      <div className="mb-6 flex items-center gap-2">
        <Button
          href={scheduleHref(addMonths(anchorMonth, -1))}
          aria-label="Mes anterior"
          variant="icon"
          size="lg"
          className="shrink-0"
        >
          <ChevronLeftIcon size={16} />
        </Button>
        <div className="min-w-0 flex-1 text-center">
          {/* No `truncate` on the `h2` itself: its overflow-hidden would clip the
              button's focus ring. The inner span clips the long label instead. */}
          <h2 className="font-display text-base font-bold uppercase tracking-wide sm:text-lg">
            {/* The month name opens the sheet: an inline button so the heading stays
                the route's heading. The chevron says it can be pressed. */}
            <button
              type="button"
              onClick={openSheet}
              aria-haspopup="dialog"
              aria-expanded={open}
              className="inline-flex max-w-full items-center gap-1.5 rounded-lg px-2 py-1 transition-colors duration-fast ease-out-brand hover:text-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
            >
              <span className="truncate">{monthLabel(anchorMonth)}</span>
              <ChevronDownIcon size={14} className="shrink-0 opacity-60" />
            </button>
          </h2>
          {/* The page's own `h2` is gone (this IS the heading), so the rolling view
              says so here: the month named above is the one the rolling fetch
              starts from, not a month being browsed. While browsing, the same line
              holds the way back. */}
          {viewMonth ? (
            <Button href="/schedule" variant="ghost" size="sm" className="-mt-1">
              Hoy
            </Button>
          ) : (
            <p className="font-label text-[10px] uppercase tracking-widest text-mono-400">Próximos</p>
          )}
        </div>
        <Button
          href={scheduleHref(addMonths(anchorMonth, 1))}
          aria-label="Mes siguiente"
          variant="icon"
          size="lg"
          className="shrink-0"
        >
          <ChevronRightIcon size={16} />
        </Button>
      </div>

      <CueDialog open={open} title="Ir a un mes" label="Ir a un mes" mode="sheet" size="sm" onDismiss={close}>
        <div className="p-4">
          <div className="mb-3 flex items-center justify-between">
            {/* The arrows stop at the years `?m=` accepts (`parseMonthParam`), so no
                pill can link to a month the route would silently drop. */}
            <Button type="button" variant="icon" aria-label="Año anterior" disabled={year <= MIN_YEAR} onClick={() => setYear((y) => Math.max(MIN_YEAR, y - 1))}>
              <ChevronLeftIcon size={16} />
            </Button>
            <span className="font-display text-lg font-bold tabular-nums">{year}</span>
            <Button type="button" variant="icon" aria-label="Año siguiente" disabled={year >= MAX_YEAR} onClick={() => setYear((y) => Math.min(MAX_YEAR, y + 1))}>
              <ChevronRightIcon size={16} />
            </Button>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {/* Every month is a link to `?m=`; the month already on screen is the one
                pressed pill (`active`, the pill variant's own pressed colour) and a
                press on it only closes the sheet — there is nowhere to go. */}
            {yearMonths(year).map((ym) =>
              ym === anchorMonth ? (
                <Button key={ym} type="button" variant="pill" size="sm" active aria-label={monthLabel(ym)} onClick={close}>
                  {shortMonthLabel(ym)}
                </Button>
              ) : (
                <Button key={ym} href={scheduleHref(ym)} variant="pill" size="sm" aria-label={monthLabel(ym)} onClick={close}>
                  {shortMonthLabel(ym)}
                </Button>
              ),
            )}
          </div>
        </div>
      </CueDialog>
    </>
  );
}
