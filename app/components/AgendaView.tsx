"use client";
// app/components/AgendaView.tsx
// The /schedule agenda (spec §12.3, R2 Task 4): SERVICE DAYS ONLY, one line each,
// in date order, under a month divider. It is the default mode — the month grid is
// the second one — because the question the page is asked is "when do I serve next",
// and a grid answers it by making the reader scan 30 cells for the lit ones.
//
// The row (the «millones» pass, 2026-10-24) is a hairline row in the page's own type,
// the way the library lists a song: the day NUMBER in the display face on the left
// (the library's key), «Domingo · 11:00» at 17 px, who leads and how many songs at
// 14 px, the countdown as plain muted text on the right, and «Tú · Keys» in the app's
// one green under it where the signed-in member is seated. The tone rail — 3 px, the
// day's one colour (ADR-0067) — stays on the left edge. What is gone is everything
// that was a chip: the uppercase `DOM 13 SEP`, the bordered countdown pill, the
// bordered «TÚ» badge. Later months are section titles (`SHEET_TITLE`).
//
// Every row is a plain `<button>`, not the `Button` primitive — the recorded
// row/cell exemption (the R2 rubric ruling, same as `LibraryRow`, `DayStrip`'s cells
// and `DayCard`'s setlist rows): the row IS the affordance, so it carries no eyebrow
// and no "Ver", and a variant's padding/radius would fight the tone rail.
//
// All the arithmetic — ordering, month breaks, the summary line, the conflict count,
// the clock — lives in `app/utils/agenda.ts` (`agendaRows`, `serviceClock`), so this
// file only lays it out. The conflict flag therefore counts what `DayCard`'s own ⚠
// marks count, by construction: both read `findDuplicates` from that module.
//
// F1 — a row where the signed-in member is seated carries «Tú · Lead, Keys» and a
// positive glow on its tone rail, the same «you» signal `DayCard` gives a seat
// (`mySeats`/`myNameFromSession`, `app/utils/agenda.ts`) — the agenda had dropped it
// when it replaced the stacked `DayCard`s the old «Lista» mode rendered.
import { useSession } from "next-auth/react";
import { WarningIcon } from "./ui/icons";
import { agendaRows, conflictLabel, mySeats, myNameFromSession, serviceClock, TONE_RAIL } from "../utils/agenda";
import type { ActiveDay } from "./CalendarView";
import { daysUntil, formatCountdown } from "../utils/daysUntil";
import { monthLabel } from "../utils/scheduleMonths";
import { SHEET_TITLE } from "../utils/homeHero";
import NumberRoll from "./ui/NumberRoll";
import { haptic } from "../utils/haptics";

/** Local-noon render, never a bare `new Date(iso)` — the UTC day-flip rule. */
const fmt = (iso: string, options: Intl.DateTimeFormatOptions) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString("es-MX", options);

export default function AgendaView({
  activeDays,
  todayStr,
  onSelect,
  emptyMessage,
  myName: myNameProp,
}: {
  activeDays: Record<string, ActiveDay[]>;
  /** "today" as the server computed it (CDMX), so the countdown agrees with the fetch. */
  todayStr: string;
  onSelect: (date: string) => void;
  emptyMessage: string;
  /** Who «tú» is, as `CalendarView` derived it ONCE for the header count, the strip and the
   *  grid — with the server-known `viewerName` standing in before the client session
   *  arrives, so the rows never lag a beat behind «te toca en 3» above them. Omitted
   *  (a host without that fallback), the session alone decides, as `DayCard` does. */
  myName?: string;
}) {
  const { data: session } = useSession();
  const myName = myNameProp ?? myNameFromSession(session?.user);
  const rows = agendaRows(activeDays);

  if (rows.length === 0) {
    return <p className="py-20 text-center font-body text-base text-ink-muted">{emptyMessage}</p>;
  }

  return (
    <div>
      {rows.map((row, index) => {
        const days = daysUntil(row.date);
        // The countdown is for services still ahead. `todayStr` is the boundary the
        // SERVER fetched against, so a browsed month's already-past days are silent
        // even if the client's own clock disagrees; `days >= 0` is the second half of
        // the same guard, because `formatCountdown` only FLOORS a past date («Hace 3 días»).
        const upcoming = row.date >= todayStr && days >= 0;
        const countdown = upcoming ? formatCountdown(days) : "";
        const long = fmt(row.date, { weekday: "long", day: "numeric", month: "long" });
        const clock = serviceClock(row.entry);
        // The seats where the signed-in member is serving THIS row — «you»'s own
        // tone (DayCard's positive glow), read from the neutral helper so the row
        // and the card can never disagree on who "you" is.
        const seats = mySeats(row.entry, myName);
        return (
          <div key={row.key}>
            {row.monthStart && (
              // A section title, not a divider with a line: the gap is between month
              // GROUPS, so the first carries none. Not `first:mt-0`: each row sits in its
              // own wrapper, where the title is always the first child and the variant
              // would always match.
              <h3 className={`${SHEET_TITLE} pb-2.5 ${index === 0 ? "" : "pt-9"}`}>
                {monthLabel(row.monthStart)}
              </h3>
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
              className={`group grid w-full grid-cols-[3px_2.75rem_minmax(0,1fr)_auto] items-center gap-x-3.5 py-3.5 text-left transition-[color,background-color,transform] duration-fast ease-out-brand hover:bg-accent/[0.055] focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/60 active:scale-[0.995] ${
                index === 0 || row.monthStart ? "border-t border-ink/[0.10]" : ""
              } border-b border-ink/[0.10]`}
            >
              <span
                aria-hidden
                className={`self-stretch rounded-full ${TONE_RAIL[row.tone]}${
                  seats.length ? " shadow-[0_0_10px_rgb(var(--positive-fg-rgb)/0.6)]" : ""
                }`}
              />
              {/* The day number, the way the library leads with the key: the first thing
                  the eye wants from a calendar row, in the display face. */}
              <span className="text-center font-display text-[30px] font-semibold leading-none tabular-nums text-ink transition-colors group-hover:text-accent">
                {fmt(row.date, { day: "numeric" })}
              </span>
              <span className="min-w-0">
                <span className="block font-body text-[17px] font-semibold leading-tight text-ink">
                  {/* A special names itself here; «Domingo»/«Sábado» is the day word. */}
                  {row.entry.day}
                  {clock && (
                    <>
                      <span className="text-ink-dim font-normal"> · </span>
                      <span className="font-normal tabular-nums text-ink-dim">{clock}</span>
                    </>
                  )}
                </span>
                <span className="mt-0.5 block font-body text-sm leading-snug text-ink-muted">{row.summary}</span>
              </span>
              <span className="flex shrink-0 flex-col items-end gap-1 text-right">
                {upcoming && (
                  <span className="font-body text-sm text-ink-muted">
                    <NumberRoll value={countdown} />
                  </span>
                )}
                {/* DayCard's «you» tone — the same positive green its seats take there,
                    so the two surfaces read as one signal. The countdown above it is
                    neutral, as on the card: cyan is for what can be pressed, green
                    only for «tú» (2026-10-20). */}
                {seats.length > 0 && (
                  <span className="font-body text-[13px] font-semibold text-positive-fg">Tú · {seats.join(", ")}</span>
                )}
                {row.conflicts > 0 && (
                  <span className="flex items-center gap-1 font-body text-[13px] text-warning-fg">
                    <WarningIcon size={12} />
                    {conflictLabel(row.conflicts)}
                  </span>
                )}
              </span>
            </button>
          </div>
        );
      })}
    </div>
  );
}
