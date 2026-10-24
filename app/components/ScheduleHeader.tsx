"use client";
// app/components/ScheduleHeader.tsx
// The /schedule month header (spec §12.3, R2 Task 3; month sheet 2026-10-22; the
// «millones» pass 2026-10-24):
//
//   Octubre ⌄                    ‹  ›     ← the month IS the page title (display face)
//   2026 · 8 servicios por venir · te toca en 3
//
// The month name is set in the display face at the page-title size Inicio and
// Biblioteca use (46 px, 76 px from `md`), because on this page it is the title: the
// old row — `‹ SEPTIEMBRE 2026 ⌄ ›` in 16 px small caps with «Próximos» under it —
// was one more tracked label on a page made of them. The year moves to the line
// under it on a phone (the title and two 44 px arrows share 342 px) and sits dim
// beside the name from `md`; «Próximos» is gone, the count line says «por venir».
// The line's second half, «te toca en 3», is the app's one green — the same «tú» the
// agenda rows and the grid's dot carry.
//
// The arrows are the house `Button variant="round"` WITH `href`, so they render as
// `<Link>`s: month paging is a navigation (`?m=`), which keeps the back button honest
// and lets the route reveal carry the transition (decision C). While browsing, a
// ghost «Hoy» sits beside them — the way back to the rolling view.
//
// The month name is itself the jump-to-any-month control: a button inside the `h2`
// that opens a `CueDialog` sheet of one year's twelve months as pills (links to
// `?m=`), with ‹ › arrows to change the year. It replaces the native
// `<input type="month">` the header carried below the title (ADR-0067): the OS
// control drew a second, differently-styled month label under the heading, opened a
// wheel the brand could not style, and on a phone it was the only control on the page
// that did not look like the app. The sheet carries NO one-month steppers — the
// header's arrows already own «Mes anterior»/«Mes siguiente» (the R2 Task 4 ruling).
import { useState } from "react";
import { ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon } from "./ui/icons";
import Button from "./ui/Button";
import CueDialog from "./ui/CueDialog";
import { addMonths, MAX_YEAR, MIN_YEAR, MONTH_NAMES_ES, monthLabel, scheduleHref, shortMonthLabel, yearMonths } from "../utils/scheduleMonths";

export default function ScheduleHeader({
  anchorMonth,
  viewMonth,
  counts,
}: {
  anchorMonth: string;
  /** "YYYY-MM" while browsing a past/future month; null or undefined in the default rolling view. */
  viewMonth?: string | null;
  /** The line under the month (`calendarCountLine`): the services ahead, and «te toca en N» or null. */
  counts: { services: string; mine: string | null };
}) {
  const [open, setOpen] = useState(false);
  // The year the sheet shows: seeded from the anchor each time it opens, then the
  // sheet's own arrows move it. Picking a month is a navigation that re-renders this
  // header with a new anchor but does NOT remount it, so the pill closes the sheet.
  const [year, setYear] = useState(() => Number(anchorMonth.slice(0, 4)));
  const openSheet = () => { setYear(Number(anchorMonth.slice(0, 4))); setOpen(true); };
  const close = () => setOpen(false);
  const monthName = MONTH_NAMES_ES[Number(anchorMonth.slice(5, 7)) - 1];
  const anchorYear = anchorMonth.slice(0, 4);

  return (
    <>
      <div className="mb-7 flex flex-col gap-2.5">
        <div className="flex items-end justify-between gap-3">
          {/* No `truncate` on the `h2` itself: its overflow-hidden would clip the
              button's focus ring. The inner span clips the long label instead. */}
          <h2 className="min-w-0 font-display text-[46px] font-semibold leading-[0.98] tracking-[-0.01em] text-ink md:text-[76px] md:leading-[0.95]">
            {/* The month name opens the sheet: an inline button so the heading stays
                the route's heading. The chevron says it can be pressed. */}
            <button
              type="button"
              onClick={openSheet}
              aria-haspopup="dialog"
              aria-expanded={open}
              // The visible text splits the year off into its own span (shown from
              // `md`), and an accessible name computed from that collapses the space
              // («Septiembre2026»), so the control names itself in full.
              aria-label={monthLabel(anchorMonth)}
              className="inline-flex max-w-full items-baseline gap-2 rounded-lg transition-colors duration-fast ease-out-brand hover:text-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
            >
              <span className="truncate">{monthName}</span>
              {/* The year rides in the heading from `md` (the title row has the room) and
                  in the line below on a phone; the heading's text is the same either way. */}
              <span className="hidden text-ink-dim md:inline"> {anchorYear}</span>
              <ChevronDownIcon size={18} className="shrink-0 self-center opacity-60" />
            </button>
          </h2>
          <div className="flex shrink-0 items-center gap-2 pb-1.5">
            {viewMonth && (
              <Button href="/schedule" variant="ghost" size="sm">
                Hoy
              </Button>
            )}
            <Button href={scheduleHref(addMonths(anchorMonth, -1))} aria-label="Mes anterior" variant="round">
              <ChevronLeftIcon size={18} />
            </Button>
            <Button href={scheduleHref(addMonths(anchorMonth, 1))} aria-label="Mes siguiente" variant="round">
              <ChevronRightIcon size={18} />
            </Button>
          </div>
        </div>
        <p className="font-body text-[17px] leading-snug text-ink-dim md:text-xl">
          <span className="md:hidden">{anchorYear} · </span>
          {counts.services}
          {counts.mine && (
            <>
              {" · "}
              <span className="text-positive-fg">{counts.mine}</span>
            </>
          )}
        </p>
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
