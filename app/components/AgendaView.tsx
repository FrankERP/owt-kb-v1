"use client";
// app/components/AgendaView.tsx
// The /schedule agenda (spec §12.3, R2 Task 4): SERVICE DAYS ONLY, one line each,
// in date order, under a month divider. It is the default mode — the month grid is
// the second one — because the question the page is asked is "when do I serve next",
// and a grid answers it by making the reader scan 30 cells for the lit ones.
//
// Every row is a plain `<button>`, not the `Button` primitive — the recorded
// row/cell exemption (the R2 rubric ruling, same as `LibraryRow`, `DayStrip`'s cells
// and `DayCard`'s setlist rows): the row IS the affordance, so it carries no eyebrow
// and no "Ver", and a variant's padding/radius would fight the tone rail.
//
// All the arithmetic — ordering, month breaks, the summary line, the conflict count —
// lives in `app/utils/agenda.ts` (`agendaRows`), so this file only lays it out. The
// conflict flag therefore counts what `DayCard`'s own ⚠ marks count, by construction:
// both read `findDuplicates` from that module.
//
// F1 — a row where the signed-in member is seated carries a «Tú · Lead, Keys» pill
// and a positive glow on its tone rail, the same «you» signal `DayCard` gives a seat
// (`mySeats`/`myNameFromSession`, `app/utils/agenda.ts`) — the agenda had dropped it
// when it replaced the stacked `DayCard`s the old «Lista» mode rendered.
import { useSession } from "next-auth/react";
import { agendaRows, conflictLabel, mySeats, myNameFromSession, type Tone } from "../utils/agenda";
import type { ActiveDay } from "./CalendarView";
import { daysUntil, formatCountdown } from "../utils/daysUntil";
import { monthLabel } from "../utils/scheduleMonths";
import NumberRoll from "./ui/NumberRoll";
import { haptic } from "../utils/haptics";

/** The 2 px rail: the same tone vocabulary the strip and the grid use. */
const RAIL: Record<Tone, string> = {
  sun: "bg-accent",
  sat: "bg-warning-fg",
  special: "bg-info-fg",
};

/** Local-noon render, never a bare `new Date(iso)` — the UTC day-flip rule. */
const fmt = (iso: string, options: Intl.DateTimeFormatOptions) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString("es-MX", options);

export default function AgendaView({
  activeDays,
  todayStr,
  onSelect,
  emptyMessage,
}: {
  activeDays: Record<string, ActiveDay[]>;
  /** "today" as the server computed it (CDMX), so the countdown agrees with the fetch. */
  todayStr: string;
  onSelect: (date: string) => void;
  emptyMessage: string;
}) {
  const { data: session } = useSession();
  const myName = myNameFromSession(session?.user);
  const rows = agendaRows(activeDays);

  if (rows.length === 0) {
    return <p className="py-20 text-center font-label text-sm text-mono-400">{emptyMessage}</p>;
  }

  return (
    <div>
      {rows.map((row, index) => {
        const days = daysUntil(row.date);
        // The pill is for services still ahead. `todayStr` is the boundary the SERVER
        // fetched against, so a browsed month's already-past days are silent even if
        // the client's own clock disagrees; `days >= 0` is the second half of the same
        // guard, because `formatCountdown` only FLOORS a past date («Hace 3 días»).
        const upcoming = row.date >= todayStr && days >= 0;
        const countdown = upcoming ? formatCountdown(days) : "";
        const long = fmt(row.date, { weekday: "long", day: "numeric", month: "long" });
        // The seats where the signed-in member is serving THIS row — «you»'s own
        // tone (DayCard's positive glow), read from the neutral helper so the row
        // and the card can never disagree on who "you" is.
        const seats = mySeats(row.entry, myName);
        return (
          <div key={row.key}>
            {row.monthStart && (
              // The gap is between month GROUPS, so the first divider carries none.
              // Not `first:mt-0`: each row sits in its own wrapper, where the divider
              // is always the first child and the variant would always match.
              <div className={`mb-2 flex items-center gap-3 ${index === 0 ? "" : "mt-8"}`}>
                <h3 className="font-label text-[11px] uppercase tracking-widest text-mono-500">
                  {monthLabel(row.monthStart)}
                </h3>
                <span className="h-px flex-1 bg-surface-accent-faint" />
              </div>
            )}
            <button
              type="button"
              // `data-date` is the hook `CalendarView`'s `onWeekChange` scrolls by
              // (the first row on or after the swiped-to Monday). Nothing else
              // connects the two, so they move together.
              data-date={row.date}
              onClick={() => {
                // Native only, fire-and-forget (see haptics.ts) — never gates the sheet.
                void haptic("selection");
                onSelect(row.date);
              }}
              // The label carries what the eye sees, in the same order: the day
              // name, the long date, the countdown (upcoming rows only), the
              // summary, the conflict count, then the «you» signal.
              aria-label={`${row.entry.day}, ${long}${countdown ? `, ${countdown}` : ""}, ${row.summary}${row.conflicts ? `, ${conflictLabel(row.conflicts)}` : ""}${seats.length ? `, ${upcoming ? "te toca" : "te tocó"}: ${seats.join(", ")}` : ""}`}
              className="group relative flex w-full items-center gap-3 rounded-xl py-3 pl-4 pr-3 text-left transition-[color,background-color,transform] duration-fast ease-out-brand hover:bg-accent/[0.055] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 active:scale-[0.995]"
            >
              <span
                aria-hidden
                className={`absolute bottom-2 left-0 top-2 w-0.5 rounded-full ${RAIL[row.tone]}${
                  seats.length ? " shadow-[0_0_10px_rgb(var(--positive-fg-rgb)/0.6)]" : ""
                }`}
              />
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-display text-sm font-bold uppercase text-ink transition-colors group-hover:text-accent">
                    {fmt(row.date, { weekday: "short" })} {fmt(row.date, { day: "numeric", month: "short" })}
                  </span>
                  {/* A special names itself here — Sábado/Domingo don't, the day
                      word already says it. */}
                  {row.tone === "special" && (
                    <span className="min-w-0 truncate font-body text-sm text-ink-dim">{row.entry.day}</span>
                  )}
                  {upcoming && (
                    <span className="rounded-full bg-accent/10 px-2 py-px font-label text-[10px] uppercase tracking-widest text-accent">
                      <NumberRoll value={countdown} />
                    </span>
                  )}
                  {/* DayCard's «you» tone — the same positive pill/glow the seats
                      themselves glow with there, so the two surfaces read as one
                      signal. */}
                  {seats.length > 0 && (
                    <span className="rounded-full border border-positive-fg/35 bg-positive-fg/10 px-2.5 py-0.5 font-label text-[10px] uppercase tracking-widest text-positive-fg">
                      Tú · {seats.join(", ")}
                    </span>
                  )}
                </span>
                <span className="mt-0.5 block truncate font-body text-sm text-ink-dim">{row.summary}</span>
              </span>
              {row.conflicts > 0 && (
                <span className="shrink-0 font-label text-[11px] uppercase tracking-widest text-warning-fg">
                  ⚠ {conflictLabel(row.conflicts)}
                </span>
              )}
            </button>
          </div>
        );
      })}
    </div>
  );
}
