// app/components/JovenesDayCard.tsx
// A Jóvenes meeting inside the Calendario's day sheet (PR D, ADR-0081), for a member of both
// Alabanza and Jóvenes. Like `KidsDayCard`, it is only the body: the sheet's title is the date
// and its line the clock. The meeting as a section title, who it is for, then the seats, the
// program and the notes (`JovenesMeetingBody`, the same rows `/jovenes` shows). The full list
// and the planner stay on `/jovenes`, one tap away.
//
// NEUTRAL — no hooks — so either side of the boundary can render it.
import Button from "./ui/Button";
import JovenesMeetingBody from "./jovenes/MeetingBody";
import { SHEET_TITLE } from "../utils/homeHero";
import type { JovenesDayEntry } from "./CalendarView";

/** `time` is shown when the sheet holds more than one entry: its own line then carries no clock
 *  (a Saturday with both the worship service and the Jóvenes meeting), as `DayCard identity`. */
export default function JovenesDayCard({ title, entry, time }: { title: string; entry: JovenesDayEntry; time?: string | null }) {
  return (
    <section aria-label={title}>
      <h3 className={`${SHEET_TITLE} pb-1`}>{title}</h3>
      <p className="pb-4 font-body text-[15px] text-ink-muted">
        {[time, entry.audience, entry.arrival ? `llegada ${entry.arrival}` : null, entry.place].filter(Boolean).join(" · ")}
      </p>
      <JovenesMeetingBody entry={entry} />
      <Button href="/jovenes" variant="secondary" size="sm" className="mt-5">
        Ver Jóvenes
      </Button>
    </section>
  );
}
