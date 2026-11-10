// app/components/jovenes/MeetingBody.tsx
// The inside of a Jóvenes meeting: its seats and its program as hairline rows, with «Tú» in the
// app's one green (decided by member id on the server), then the notes. ONE body for the two
// places a pastor reads a meeting, the Calendario's day sheet (`JovenesDayCard`) and the list on
// `/jovenes`, so a seat can never be worded or coloured differently between them: before
// 2026-11-10 the list drew its own boxes and painted «te toca» in the accent.
//
// NEUTRAL — no hooks — so either side of the boundary can render it.
import { SHEET_TITLE } from "../../utils/homeHero";
import type { JovenesDayEntry, JovenesDayPerson } from "../CalendarView";

const ROWS = "divide-y divide-ink/[0.10] border-y border-ink/[0.10]";

// The NAME keeps its width and the label gives: a long note beside it («Dinámica · traer hojas
// y plumas para todos») wraps on the left instead of squeezing the person to «Tú · Gabri…». Only a
// name longer than 60% of the row is cut.
function Row({ person, detail }: { person: JovenesDayPerson; detail?: string | null }) {
  return (
    <li className="flex items-baseline justify-between gap-4 py-3">
      <span className="min-w-0 break-words font-body text-[15px] leading-snug text-ink-dim">
        {person.label}
        {detail && <span className="text-ink-muted"> · {detail}</span>}
      </span>
      <span
        className={`max-w-[60%] shrink-0 truncate text-right font-body text-[17px] ${
          person.mine ? "font-semibold text-positive-fg" : person.name ? "text-ink" : "italic text-ink-muted"
        }`}
      >
        {person.mine ? `Tú · ${person.name ?? ""}` : (person.name ?? "Sin asignar")}
      </span>
    </li>
  );
}

export default function JovenesMeetingBody({
  entry,
  teamTitle,
  level = 4,
}: {
  entry: JovenesDayEntry;
  /** A title over the seats, where no meeting name sits right above them (the list on `/jovenes`). */
  teamTitle?: string;
  /** The heading level of the section titles: one under whatever heads the meeting. */
  level?: 3 | 4;
}) {
  const Title = level === 3 ? "h3" : "h4";
  return (
    <>
      {entry.seats.length > 0 && (
        <>
          {teamTitle && <Title className={`${SHEET_TITLE} pb-2.5`}>{teamTitle}</Title>}
          <ul className={ROWS}>
            {entry.seats.map((s) => (
              <Row key={s.key} person={s} />
            ))}
          </ul>
        </>
      )}
      {entry.program.length > 0 && (
        <>
          <Title className={`${SHEET_TITLE} pb-2.5 pt-5`}>Programa</Title>
          <ul className={ROWS}>
            {entry.program.map((l) =>
              l.name || l.mine ? (
                <Row key={l.key} person={l} detail={l.note} />
              ) : (
                <li key={l.key} className="break-words py-3 font-body text-[15px] leading-snug text-ink-dim">
                  {l.label}
                  {l.note && <span className="text-ink-muted"> · {l.note}</span>}
                </li>
              ),
            )}
          </ul>
        </>
      )}
      {entry.notes && <p className="whitespace-pre-line break-words pt-4 font-body text-[15px] text-ink-muted">{entry.notes}</p>}
    </>
  );
}
