"use client";
// app/components/ScheduleHeader.tsx
// The /schedule month header (spec §12.3, R2 Task 3). Two rows:
//
//   ‹  SEPTIEMBRE 2026  ›        ← one month per press, server-driven (a route push)
//   [ 2026-09 ]  Hoy             ← jump to any month; «Hoy» only while browsing
//
// The arrows are the house `Button variant="icon" size="lg"` WITH `href`, so they
// render as `<Link>`s: month paging is a navigation (`?m=`), which keeps the back
// button honest and lets the route reveal carry the transition (decision C).
//
// The month field carries NO `onStep` steppers (R2 Task 4 ruling): they would be a
// second pair of one-month arrows, labelled «Mes anterior»/«Mes siguiente» — the same
// accessible names the row above already owns. The field is the jump-to-any-month
// control only. And since the page's own `h2` is gone, this header IS the route's
// heading, so the rolling view adds a small «Próximos» sublabel to say that the month
// named is where the rolling window starts rather than a month being browsed.
//
// The label is an `h2` that TRUNCATES inside a `min-w-0 flex-1` cell and carries no
// fixed width. That is the overflow fix by construction: the row this replaces gave
// the label a `sm:min-w-[13rem]` and hid the buttons' words under `sm:` to survive a
// 390 px phone. With one month per arrow the label is short anyway, and a long one
// («Septiembre 2026») now clips instead of pushing the arrows off-screen.
import { useRouter } from "next/navigation";
import Button from "./ui/Button";
import DateField from "./ui/DateField";
import { addMonths, monthLabel, scheduleHref } from "../utils/scheduleMonths";

export default function ScheduleHeader({
  anchorMonth,
  viewMonth,
}: {
  anchorMonth: string;
  /** "YYYY-MM" while browsing a past/future month; null or undefined in the default rolling view. */
  viewMonth?: string | null;
}) {
  const router = useRouter();

  return (
    <>
      <div className="mb-3 flex items-center gap-2">
        <Button
          href={scheduleHref(addMonths(anchorMonth, -1))}
          aria-label="Mes anterior"
          variant="icon"
          size="lg"
          className="shrink-0"
        >
          <span aria-hidden>‹</span>
        </Button>
        <div className="min-w-0 flex-1 text-center">
          <h2 className="truncate font-display text-base font-bold uppercase tracking-wide sm:text-lg">
            {monthLabel(anchorMonth)}
          </h2>
          {/* The page's own `h2` is gone (this IS the heading), so the rolling view
              says so here: the month named above is the one the rolling fetch
              starts from, not a month being browsed. */}
          {!viewMonth && (
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
          <span aria-hidden>›</span>
        </Button>
      </div>
      <div className="mb-6 flex items-center justify-center gap-3">
        <DateField
          kind="month"
          className="w-40"
          aria-label="Ir al mes"
          value={anchorMonth}
          onChange={(e) => { if (e.target.value) router.push(scheduleHref(e.target.value)); }}
        />
        {viewMonth && (
          <Button href="/schedule" variant="ghost" size="sm">
            Hoy
          </Button>
        )}
      </div>
    </>
  );
}
