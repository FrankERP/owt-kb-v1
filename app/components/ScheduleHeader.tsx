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
        <h2 className="min-w-0 flex-1 truncate text-center font-display text-base font-bold uppercase tracking-wide sm:text-lg">
          {monthLabel(anchorMonth)}
        </h2>
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
          aria-label="Ir al mes"
          value={anchorMonth}
          onChange={(e) => { if (e.target.value) router.push(scheduleHref(e.target.value)); }}
          onStep={(d) => router.push(scheduleHref(addMonths(anchorMonth, d)))}
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
