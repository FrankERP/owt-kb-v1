// app/components/jovenes/MeetingBody.tsx
// The inside of a Jóvenes meeting: its team as faces, its program as a numbered timeline, its
// notes as a note. ONE body for the two places a pastor reads a meeting, the Calendario's day
// sheet (`JovenesDayCard`) and the cards on `/jovenes`, so a seat can never be worded or coloured
// differently between them. «Tú» is the app's one green, decided by member id on the server.
//
// Until 2026-11-12 these were hairline rows, label left and name right. With eight meetings on
// one page that read as one long table of text (Frank), so each part now has its own SHAPE: a
// person is a circle with a name, a program line is a numbered step on a line, a note is a
// tinted block (ADR-0087).
//
// NEUTRAL — no hooks — so either side of the boundary can render it.
import { SHEET_TITLE } from "../../utils/homeHero";
import { NoteIcon } from "../ui/icons";
import type { JovenesDayEntry, JovenesDayPerson } from "../CalendarView";
import PersonAvatar from "./PersonAvatar";

const ROLE = "font-label text-[10px] uppercase tracking-[0.16em] text-ink-dim";

/** «Tú · Frank» in green, a name in ink, or «Sin asignar» for a seat nobody holds. */
function personName(p: JovenesDayPerson): { text: string; className: string } {
  if (p.mine) return { text: `Tú · ${p.name ?? ""}`, className: "font-semibold text-positive-fg" };
  if (p.name) return { text: p.name, className: "font-semibold text-ink" };
  return { text: "Sin asignar", className: "italic text-ink-muted" };
}

function Seat({ person }: { person: JovenesDayPerson }) {
  const name = personName(person);
  return (
    <li className="flex min-w-0 items-center gap-2.5">
      <PersonAvatar name={person.name} mine={person.mine} />
      <div className="min-w-0">
        <p className={ROLE}>{person.label}</p>
        <p className={`break-words font-body text-[16px] leading-tight ${name.className}`}>{name.text}</p>
      </div>
    </li>
  );
}

function Step({ line, index, last }: { line: JovenesDayEntry["program"][number]; index: number; last: boolean }) {
  const who = line.name || line.mine ? personName(line) : null;
  return (
    <li className={`relative grid grid-cols-[1.75rem_minmax(0,1fr)] gap-x-3 ${last ? "" : "pb-4"}`}>
      {/* The line that joins this step to the next one. */}
      {!last && <span aria-hidden="true" className="absolute bottom-0 left-[0.8125rem] top-7 w-px bg-ink/[0.14]" />}
      <span
        aria-hidden="true"
        className={`flex h-7 w-7 items-center justify-center rounded-full border font-label text-[11px] tabular-nums ${
          line.mine ? "border-positive-fg bg-positive-fg/10 text-positive-fg" : "border-ink/[0.18] bg-surface-base/60 text-ink-muted"
        }`}
      >
        {index + 1}
      </span>
      {/* The name keeps its place on the right whatever the note's length: the note wraps under
          the label, never pushing the person to a line of their own. */}
      <div className="flex min-w-0 items-start justify-between gap-x-4 pt-[3px]">
        <div className="min-w-0">
          <p className="break-words font-body text-[16px] font-semibold leading-snug text-ink">{line.label}</p>
          {line.note && <p className="break-words font-body text-[14px] leading-snug text-ink-muted">{line.note}</p>}
        </div>
        {who && <p className={`max-w-[55%] shrink-0 truncate font-body text-[15px] leading-snug ${who.className}`}>{who.text}</p>}
      </div>
    </li>
  );
}

export default function JovenesMeetingBody({
  entry,
  teamTitle,
  level = 4,
  columns = false,
}: {
  entry: JovenesDayEntry;
  /** A title over the seats, where no meeting name sits right above them (a card on `/jovenes`). */
  teamTitle?: string;
  /** The heading level of the section titles: one under whatever heads the meeting. */
  level?: 3 | 4;
  /** Team and program side by side from `md` (the wide card on `/jovenes`); never in a sheet. */
  columns?: boolean;
}) {
  const Title = level === 3 ? "h3" : "h4";
  const hasSeats = entry.seats.length > 0;
  const hasProgram = entry.program.length > 0;
  const split = columns && hasSeats && hasProgram;
  return (
    <div className="space-y-5">
      {(hasSeats || hasProgram) && (
        <div className={split ? "space-y-5 md:grid md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] md:gap-x-8 md:space-y-0" : "space-y-5"}>
          {hasSeats && (
            <div>
              {teamTitle && <Title className={`${SHEET_TITLE} pb-3`}>{teamTitle}</Title>}
              <ul className={split ? "grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-x-4 gap-y-3.5 md:grid-cols-1" : "grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-x-4 gap-y-3.5"}>
                {entry.seats.map((s) => (
                  <Seat key={s.key} person={s} />
                ))}
              </ul>
            </div>
          )}
          {hasProgram && (
            <div>
              <Title className={`${SHEET_TITLE} pb-3`}>Programa</Title>
              <ol>
                {entry.program.map((l, i) => (
                  <Step key={l.key} line={l} index={i} last={i === entry.program.length - 1} />
                ))}
              </ol>
            </div>
          )}
        </div>
      )}
      {entry.notes && (
        <p className="flex gap-2.5 rounded-xl bg-ink/[0.05] px-3.5 py-3 font-body text-[15px] leading-snug text-ink-muted">
          <NoteIcon size={15} className="mt-[3px] shrink-0 text-ink-dim" />
          <span className="min-w-0 whitespace-pre-line break-words">{entry.notes}</span>
        </p>
      )}
    </div>
  );
}
