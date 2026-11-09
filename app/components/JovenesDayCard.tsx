// app/components/JovenesDayCard.tsx
// A Jóvenes meeting inside the Calendario's day sheet (PR D, ADR-0081), for a member of both
// Alabanza and Jóvenes. Like `KidsDayCard`, it is only the body: the sheet's title is the date
// and its line the clock. The meeting as a section title, who it is for, the seats and the
// program as hairline rows with «Tú» in the app's one green (decided by member id on the server),
// then the notes. The full list and the planner stay on `/jovenes`, one tap away.
//
// NEUTRAL — no hooks — so either side of the boundary can render it.
import Button from "./ui/Button";
import { SHEET_TITLE } from "../utils/homeHero";
import type { JovenesDayEntry, JovenesDayPerson } from "./CalendarView";

function Row({ person, detail }: { person: JovenesDayPerson; detail?: string | null }) {
  return (
    <li className="flex items-baseline justify-between gap-4 py-3">
      <span className="font-body text-[15px] text-ink-dim">
        {person.label}
        {detail && <span className="text-ink-muted"> · {detail}</span>}
      </span>
      <span
        className={`min-w-0 truncate text-right font-body text-[17px] ${
          person.mine ? "font-semibold text-positive-fg" : person.name ? "text-ink" : "italic text-ink-muted"
        }`}
      >
        {person.mine ? `Tú · ${person.name ?? ""}` : (person.name ?? "Sin asignar")}
      </span>
    </li>
  );
}

/** `time` is shown when the sheet holds more than one entry: its own line then carries no clock
 *  (a Saturday with both the worship service and the Jóvenes meeting), as `DayCard identity`. */
export default function JovenesDayCard({ title, entry, time }: { title: string; entry: JovenesDayEntry; time?: string | null }) {
  return (
    <section aria-label={title}>
      <h3 className={`${SHEET_TITLE} pb-1`}>{title}</h3>
      <p className="pb-2.5 font-body text-[15px] text-ink-muted">
        {[time, entry.audience, entry.arrival ? `llegada ${entry.arrival}` : null].filter(Boolean).join(" · ")}
      </p>
      {entry.seats.length > 0 && (
        <ul className="divide-y divide-ink/[0.10] border-y border-ink/[0.10]">
          {entry.seats.map((s) => (
            <Row key={s.key} person={s} />
          ))}
        </ul>
      )}
      {entry.program.length > 0 && (
        <>
          <h4 className={`${SHEET_TITLE} pb-2.5 pt-5`}>Programa</h4>
          <ul className="divide-y divide-ink/[0.10] border-y border-ink/[0.10]">
            {entry.program.map((l) =>
              l.name || l.mine ? (
                <Row key={l.key} person={l} detail={l.note} />
              ) : (
                <li key={l.key} className="py-3 font-body text-[15px] text-ink-dim">
                  {l.label}
                  {l.note && <span className="text-ink-muted"> · {l.note}</span>}
                </li>
              ),
            )}
          </ul>
        </>
      )}
      {entry.notes && <p className="whitespace-pre-line pt-4 font-body text-[15px] text-ink-muted">{entry.notes}</p>}
      <Button href="/jovenes" variant="secondary" size="sm" className="mt-5">
        Ver Jóvenes
      </Button>
    </section>
  );
}
