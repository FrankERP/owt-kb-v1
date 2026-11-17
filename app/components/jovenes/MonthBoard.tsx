"use client";

// The «Mes» view of Jóvenes' Calendario (2026-11-17): a month as a grid, each day with a dot per
// meeting in its audience's colour and a green one on the days that are the reader's, and under it
// the meetings of the day picked — or of the whole month while none is. The grid is the Alabanza
// Calendario's own (the day circles and their states are `DayDots.tsx`'s), so a day looks and
// presses the same in both; the dots are Jóvenes' group colours instead of the service tones
// (ADR-0086), and the cards are the ones «Lista» shows.
//
// It pages client-side over what the server already sent (the reader's meetings, member mode), so
// a month change is instant and reads nothing. The rules — which months, which cells, what a day
// carries — are `jovenesCalendarModel.ts`'s; this draws them.
import { useState } from "react";
import Button from "@/app/components/ui/Button";
import { CalendarOffIcon, ChevronLeftIcon, ChevronRightIcon } from "@/app/components/ui/icons";
import { DOW_SHORT, dayTitle } from "@/app/utils/agenda";
import { SHEET_TITLE } from "@/app/utils/homeHero";
import { calendarMonthTitle, calendarMonths, dayMarks, monthCells, monthLegend } from "@/app/utils/jovenesCalendarModel";
import { plural } from "@/app/utils/plural";
import {
  DAY_CELL_BASE,
  DAY_CELL_EMPTY,
  DAY_CELL_LIT,
  DAY_CELL_SELECTED,
  DAY_CELL_TODAY,
  DAY_CELL_TODAY_ON_FILL,
} from "../DayDots";
import JovenesMeetingCard from "./MeetingCard";
import type { JovenesListItem } from "./meetingItems";

/** Monday first, the Calendario's own weekday labels. */
const DAY_HEADERS = [...DOW_SHORT.slice(1), DOW_SHORT[0]];
/** Past this many dots a day stops growing: three meetings on one day is the realistic ceiling. */
const MAX_DOTS = 4;

/** The grid stays under the navbar while the cards scroll, from `lg`; the banner's height joins in. */
const BOARD_STICKY = "lg:sticky lg:top-[calc(6.5rem+env(safe-area-inset-top)+var(--impersonation-offset))]";

export default function JovenesMonthBoard({
  items,
  today,
}: {
  /** The meetings the chosen filter keeps, ordered by date. */
  items: JovenesListItem[];
  /** CDMX today, `YYYY-MM-DD`, as the server computed it. */
  today: string;
}) {
  const listed = items.map((it) => ({ id: it.event._id, date: it.event.date, audience: it.event.audience, mine: it.mine.length > 0 }));
  const months = calendarMonths(listed, today);
  // The month and the day the reader picked. Both are checked against what is on screen NOW: a
  // filter or a refresh can take a month's last meeting away, and a stale pick would show nothing.
  const [pickedMonth, setPickedMonth] = useState<string | null>(null);
  const [pickedDay, setPickedDay] = useState<string | null>(null);
  // Until the reader pages, the month of the next meeting: a grid of an empty month would be a
  // first screen that answers nothing.
  const firstWithMeeting = listed[0]?.date.slice(0, 7);
  const month = pickedMonth && months.includes(pickedMonth) ? pickedMonth : firstWithMeeting && months.includes(firstWithMeeting) ? firstWithMeeting : months[0];
  const at = months.indexOf(month);
  const marks = dayMarks(listed);
  const day = pickedDay && pickedDay.slice(0, 7) === month && marks.has(pickedDay) ? pickedDay : null;
  const inMonth = items.filter((it) => it.event.date.slice(0, 7) === month);
  const shown = day ? inMonth.filter((it) => it.event.date === day) : inMonth;
  const legend = monthLegend(listed, month);
  const anyMine = inMonth.some((it) => it.mine.length > 0);

  function page(by: -1 | 1) {
    const next = months[at + by];
    if (!next) return;
    setPickedMonth(next);
    setPickedDay(null);
  }

  return (
    <div className="lg:grid lg:grid-cols-[21rem_minmax(0,1fr)] lg:items-start lg:gap-x-10">
      {/* The sticky box is a wrapper: `.brand-surface` sets `position: relative`, which would win
          over `lg:sticky` on the same element and turn its `top` into a 104 px push down. */}
      <div className={BOARD_STICKY}>
        <section aria-label={calendarMonthTitle(month)} className="brand-surface rounded-[var(--brand-radius-panel)] p-4 sm:p-5">
          <div className="flex items-center justify-between gap-3 pb-3">
            {/* `aria-live`: the arrows change what this names, and nothing else announces a new month. */}
            <h2 aria-live="polite" className="font-display text-[26px] font-semibold leading-none text-ink">
              {calendarMonthTitle(month)}
            </h2>
            <div className="flex shrink-0 items-center gap-2">
              <Button variant="round" aria-label="Mes anterior" disabled={at <= 0} onClick={() => page(-1)} className="!h-9 !w-9">
                <ChevronLeftIcon size={16} />
              </Button>
              <Button variant="round" aria-label="Mes siguiente" disabled={at >= months.length - 1} onClick={() => page(1)} className="!h-9 !w-9">
                <ChevronRightIcon size={16} />
              </Button>
            </div>
          </div>
          <div className="grid grid-cols-7 gap-y-1.5">
            {DAY_HEADERS.map((h) => (
              <div key={h} aria-hidden="true" className="pb-1.5 text-center font-label text-[11px] uppercase tracking-[0.12em] text-ink-dim">
                {h}
              </div>
            ))}
            {monthCells(month).map((cell, i) => {
              if (!cell) return <div key={`b${i}`} />;
              const mark = marks.get(cell.date);
              const isToday = cell.date === today;
              const selected = day === cell.date;
              const cls = `${DAY_CELL_BASE} h-10 w-10 text-lg ${selected ? DAY_CELL_SELECTED : mark ? DAY_CELL_LIT : DAY_CELL_EMPTY} ${
                isToday ? (selected ? DAY_CELL_TODAY_ON_FILL : DAY_CELL_TODAY) : ""
              }`;
              return (
                <div key={cell.date} className="flex flex-col items-center gap-1">
                  {mark ? (
                    // A day circle is the Calendario's own control (`DayDots.tsx`), not a house
                    // button: a toggle — pressing the picked day again shows the whole month.
                    <button
                      type="button"
                      aria-pressed={selected}
                      aria-current={isToday ? "date" : undefined}
                      aria-label={`${dayTitle(cell.date)}: ${plural(mark.count, "reunión", "reuniones")}, ${mark.labels.join(", ")}${mark.mine ? ", te toca" : ""}`}
                      onClick={() => setPickedDay(selected ? null : cell.date)}
                      className={cls}
                    >
                      {cell.day}
                    </button>
                  ) : (
                    <span aria-current={isToday ? "date" : undefined} className={cls}>
                      {cell.day}
                    </span>
                  )}
                  <span aria-hidden="true" className="flex h-[6px] items-center justify-center gap-[3px]">
                    {mark?.dots.slice(0, MAX_DOTS).map((d) => <span key={d.key} className={`h-[6px] w-[6px] rounded-full ${d.tone.solid}`} />)}
                    {mark?.mine && <span data-mine="" className="h-[6px] w-[6px] rounded-full bg-positive-fg" />}
                  </span>
                </div>
              );
            })}
          </div>
          {(legend.length > 0 || anyMine) && (
            <ul className="mt-4 flex flex-wrap gap-x-3.5 gap-y-1.5 border-t border-ink/[0.08] pt-3 font-body text-[13px] leading-tight text-ink-muted">
              {legend.map((l) => (
                <li key={l.key} className="inline-flex items-center gap-1.5">
                  <span aria-hidden="true" className={`h-2 w-2 rounded-full ${l.tone.solid}`} />
                  {l.label}
                </li>
              ))}
              {anyMine && (
                <li className="inline-flex items-center gap-1.5">
                  <span aria-hidden="true" className="h-2 w-2 rounded-full bg-positive-fg" />
                  Te toca
                </li>
              )}
            </ul>
          )}
        </section>
      </div>

      <section aria-label={day ? dayTitle(day) : `Reuniones de ${calendarMonthTitle(month)}`} className="mt-8 min-w-0 lg:mt-0">
        <div className="flex min-h-9 items-center gap-3 pb-3">
          {/* «Reuniones del mes», not the month's name again: the grid's own heading already says it. */}
          <h2 className={`${SHEET_TITLE} min-w-0`}>{day ? dayTitle(day) : "Reuniones del mes"}</h2>
          <span aria-hidden="true" className="h-px flex-1 bg-ink/[0.10]" />
          {day ? (
            <Button variant="ghost" size="sm" onClick={() => setPickedDay(null)} className="-mr-3 shrink-0">
              Ver todo el mes
            </Button>
          ) : (
            <span className={`${SHEET_TITLE} tabular-nums tracking-normal`}>{inMonth.length}</span>
          )}
        </div>
        {shown.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-[var(--brand-radius-panel)] border border-dashed border-ink/[0.16] px-6 py-12 text-center">
            <CalendarOffIcon size={26} className="text-ink-dim" />
            <p className="font-body text-base text-ink-muted">Sin reuniones este mes.</p>
          </div>
        ) : (
          <ul className="space-y-3">
            {shown.map((it) => (
              // Keyed by the pick too, so a card opened for one day does not stay open, or shut,
              // when the same meeting is shown again inside its month.
              <li key={`${day ?? "month"}-${it.event._id}`}>
                <JovenesMeetingCard event={it.event} entry={it.entry} mine={it.mine} countdown={it.countdown} defaultOpen={day !== null && shown.length === 1}>
                  {it.editor}
                </JovenesMeetingCard>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
