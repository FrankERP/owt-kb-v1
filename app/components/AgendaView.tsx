"use client";
// app/components/AgendaView.tsx
// The /schedule agenda (spec §12.3, R2 Task 4): SERVICE DAYS ONLY, one line each,
// in date order, under a month divider. It is the default mode — the month grid is
// the second one — because the question the page is asked is "when do I serve next",
// and a grid answers it by making the reader scan 30 cells for the lit ones.
//
// A row is a CARD (ADR-0087; it was a hairline row since the «millones» pass): the date as a
// calendar leaf in the day's colour, the day as the card's title, the clock with its icon, and
// who leads and whether the songs are in as faces and pictures (`ServiceFacts`) — not the
// sentence that spelled every seat on every row. «Tú · EG» is the app's one green chip with the
// seat's glyph; the countdown is a quiet chip beside it. The tone rail — 3 px, the day's one
// colour (ADR-0067) — stays on the left edge. An Oasis Kids Sunday and a Jóvenes meeting keep
// their one-line summary: another ministry's day, described in its own words.
// Later months are section titles (`SHEET_TITLE`) with a hairline and their count.
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
import { COUNTDOWN_CHIP, MINE_CHIP, SERVICE_TONE } from "../utils/serviceToneStyle";
import DateTile from "./jovenes/DateTile";
import ServiceFacts from "./service/ServiceFacts";
import SeatIcon from "./service/SeatIcon";
import { ClockIcon } from "./ui/icons";
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
  photos,
}: {
  /** Display-name key → photo URL (`seatPhotos`), for the faces of who leads. Absent:
   *  initials for everyone. */
  photos?: Record<string, string>;
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

  // How many services each month holds, for the count at the end of its title.
  const perMonth = new Map<string, number>();
  for (const row of rows) perMonth.set(row.date.slice(0, 7), (perMonth.get(row.date.slice(0, 7)) ?? 0) + 1);

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
        // tone (DayCard's positive green), read from the neutral helper so the row
        // and the card can never disagree on who "you" is.
        const seats = mySeats(row.entry, myName);
        const worship = !row.entry.kids && !row.entry.jovenes;
        return (
          <div key={row.key}>
            {row.monthStart && (
              // A section title: the gap is between month GROUPS, so the first carries
              // none. Not `first:mt-0`: each row sits in its own wrapper, where the title
              // is always the first child and the variant would always match.
              <h3 className={`${SHEET_TITLE} flex items-center gap-3 pb-3 ${index === 0 ? "" : "pt-8"}`}>
                {monthLabel(row.monthStart)}
                <span aria-hidden="true" className="h-px flex-1 bg-ink/[0.10]" />
                {/* How many cards the month holds. Decorative: read after the title it
                    would be heard as part of the year («2026 6»). */}
                <span aria-hidden="true" className="tabular-nums tracking-normal">{perMonth.get(row.monthStart)}</span>
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
              className={`brand-surface group relative mb-3 flex w-full gap-3.5 overflow-hidden rounded-[var(--brand-radius-panel)] py-4 pl-5 pr-4 text-left transition-[border-color,transform] duration-fast ease-out-brand hover:border-ink/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/60 active:scale-[0.995] ${
                upcoming ? "" : "opacity-70"
              }`}
            >
              <span
                aria-hidden
                className={`absolute inset-y-0 left-0 w-[3px] ${TONE_RAIL[row.tone]}${
                  seats.length ? " shadow-[0_0_10px_rgb(var(--positive-fg-rgb)/0.6)]" : ""
                }`}
              />
              <DateTile decorative date={row.date} tone={SERVICE_TONE[row.tone]} />
              <span className="block min-w-0 flex-1 space-y-2">
                {/* A special names itself here; «Domingo»/«Sábado» is the day word. */}
                <span className="block break-words pt-0.5 font-display text-[22px] font-semibold uppercase leading-none tracking-[0.02em] text-ink transition-colors group-hover:text-accent md:text-2xl">
                  {row.entry.day}
                </span>
                {clock && (
                  <span className="flex items-center gap-1.5 font-body text-[15px] leading-snug text-ink-muted">
                    <ClockIcon size={14} className="shrink-0 text-ink-dim" />
                    <span className="font-semibold tabular-nums text-ink">{clock}</span>
                  </span>
                )}
                {(upcoming || seats.length > 0 || row.conflicts > 0) && (
                  <span className="flex flex-wrap items-center gap-1.5">
                    {upcoming && (
                      <span className={COUNTDOWN_CHIP}>
                        <NumberRoll value={countdown} />
                      </span>
                    )}
                    {/* DayCard's «you» tone — the same positive green its seats take there,
                        so the two surfaces read as one signal. The countdown beside it is
                        neutral, as on the card: cyan is for what can be pressed, green
                        only for «tú» (2026-10-20). */}
                    {seats.length > 0 && (
                      <span className={MINE_CHIP}>
                        {worship && <SeatIcon seat={seats[0]} size={11} />}
                        Tú · {seats.join(", ")}
                      </span>
                    )}
                    {row.conflicts > 0 && (
                      <span className="inline-flex items-center gap-1 font-body text-[13px] text-warning-fg">
                        <WarningIcon size={12} />
                        {conflictLabel(row.conflicts)}
                      </span>
                    )}
                  </span>
                )}
                {worship ? (
                  <ServiceFacts leads={row.entry.leads} songs={row.entry.setlist?.songs} photos={photos} myName={myName} className="pt-1" />
                ) : (
                  <span className="block font-body text-sm leading-snug text-ink-muted">{row.summary}</span>
                )}
              </span>
            </button>
          </div>
        );
      })}
    </div>
  );
}
