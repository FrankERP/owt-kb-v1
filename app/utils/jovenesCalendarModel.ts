// The «Mes» view of Jóvenes' Calendario as data (2026-11-17): which months it pages through, a
// month's cells, and what each day carries. Pure and neutral; `jovenesCalendarModel.test.ts` holds
// the rules. Every meeting came from `readMinistryEvents` in member mode, so nothing here decides
// access: a mark only draws what the reader may already see.

import { MONTH_NAMES_ES } from "./scheduleMonths";
import { audienceBadges, type AudienceTone } from "./jovenesGroupStyle";
import type { MinistryEventView } from "./ministryEventReads";

/** What the grid needs of a meeting. */
export type CalendarMeeting = { id: string; date: string; audience: MinistryEventView["audience"]; mine: boolean };

/** `YYYY-MM` plus whole months. */
function addMonth(month: string, by: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * The months the grid pages through: from today's to the last meeting's, every one in between
 * (an empty month is still a page: it says «nothing that month», which is an answer). Always at
 * least today's month.
 */
export function calendarMonths(meetings: readonly Pick<CalendarMeeting, "date">[], today: string): string[] {
  const first = today.slice(0, 7);
  const last = meetings.reduce((max, m) => (m.date.slice(0, 7) > max ? m.date.slice(0, 7) : max), first);
  const out: string[] = [];
  // The cap is a guard against a meeting stored in the year 9999, not a rule anyone meets.
  for (let month = first; month <= last && out.length < 36; month = addMonth(month, 1)) out.push(month);
  return out;
}

/** «Noviembre 2026». */
export function calendarMonthTitle(month: string): string {
  return `${MONTH_NAMES_ES[Number(month.slice(5, 7)) - 1] ?? month} ${month.slice(0, 4)}`;
}

/** A month's cells, Monday first as the Calendario: `null` for the blanks before day 1. */
export function monthCells(month: string): Array<{ date: string; day: number } | null> {
  const [y, m] = month.split("-").map(Number);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const offset = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7;
  return [
    ...Array<null>(offset).fill(null),
    ...Array.from({ length: days }, (_, i) => ({ date: `${month}-${String(i + 1).padStart(2, "0")}`, day: i + 1 })),
  ];
}

export type DayMark = {
  /** The day's meetings, in order. */
  count: number;
  /** One dot per audience of each meeting, in its colour (a shared meeting shows its groups). */
  dots: Array<{ key: string; tone: AudienceTone }>;
  /** Who it is for, in words, for the cell's accessible name. */
  labels: string[];
  /** The reader holds a seat or a program line that day. */
  mine: boolean;
};

/** What each day with a meeting carries, by date. */
export function dayMarks(meetings: readonly CalendarMeeting[]): Map<string, DayMark> {
  const out = new Map<string, DayMark>();
  for (const m of meetings) {
    const mark = out.get(m.date) ?? { count: 0, dots: [], labels: [], mine: false };
    mark.count += 1;
    mark.mine ||= m.mine;
    for (const b of audienceBadges(m.audience)) {
      mark.dots.push({ key: `${m.id}-${b.key}`, tone: b.tone });
      if (!mark.labels.includes(b.label)) mark.labels.push(b.label);
    }
    out.set(m.date, mark);
  }
  return out;
}

/** The audiences a month's meetings are for, once each, for the legend under the grid. */
export function monthLegend(meetings: readonly CalendarMeeting[], month: string): Array<{ key: string; label: string; tone: AudienceTone }> {
  const out = new Map<string, { key: string; label: string; tone: AudienceTone }>();
  for (const m of meetings) {
    if (m.date.slice(0, 7) !== month) continue;
    for (const b of audienceBadges(m.audience)) if (!out.has(b.key)) out.set(b.key, { key: b.key, label: b.label, tone: b.tone });
  }
  return [...out.values()];
}
