// app/components/admin/v3Horizon.ts
//
// Solver v3 C6 §5.3 — the horizon (1 or 2 consecutive calendar months a v3 run plans) and the two
// refusals Auto and the confirm apply before any read or write:
//   · HZ-7 / CF-1 (A24, A40): a month before the current CDMX month;
//   · HZ-9 / CF-1: a month after the current CDMX month + 12, the last month C2's WR-4 accepts.
// NEUTRAL and pure: dates are CDMX strings, months move by integer arithmetic, weekdays come from
// C2's civil-calendar formula — never through a `Date` on a service date. The clock is an input.

import { monthIndex, shiftMonth } from "@/app/utils/fairnessVocabulary";
import { civilDayOfWeek } from "@/app/utils/fairnessLedger";

export type HorizonLength = 1 | 2;

/** C2 WR-4: a record month is at most the current CDMX month + 12 (spec HZ-9). */
export const HORIZON_MONTHS_AHEAD = 12;

export function horizonMonths(first: string, length: HorizonLength): string[] {
  return length === 2 ? [first, shiftMonth(first, 1)] : [first];
}

/** HZ-3: a date's month is its own `YYYY-MM` prefix — never through a `Date`. */
export function monthOfDate(date: string): string {
  return date.slice(0, 7);
}

/** CLAUDE.md's server-today rule, usable on the client: the CDMX calendar date. */
export function cdmxTodayIso(now: Date): string {
  return now.toLocaleDateString("sv", { timeZone: "America/Mexico_City" });
}

export function cdmxCurrentMonth(now: Date): string {
  return cdmxTodayIso(now).slice(0, 7);
}

export type HorizonRefusal =
  | { kind: "past"; month: string }
  | { kind: "ceiling"; month: string; limit: string };

/** The first offending month, past before ceiling; `null` when every month is admissible. */
export function horizonRefusal(months: readonly string[], currentMonth: string): HorizonRefusal | null {
  const past = months.find((m) => monthIndex(m) < monthIndex(currentMonth));
  if (past) return { kind: "past", month: past };
  const limit = shiftMonth(currentMonth, HORIZON_MONTHS_AHEAD);
  const beyond = months.find((m) => monthIndex(m) > monthIndex(limit));
  return beyond ? { kind: "ceiling", month: beyond, limit } : null;
}

function daysInMonth(month: string): number {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  if (m === 2) return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28;
  return m === 4 || m === 6 || m === 9 || m === 11 ? 30 : 31;
}

/**
 * HZ-3: the calendar month's OWN Sundays and Saturdays. A month-end Saturday whose Sunday is in the
 * next month is its own month's service (ADR-0048) and is never offered by the next month.
 */
export function weekendDatesOfMonth(month: string): { sundays: string[]; saturdays: string[] } {
  const sundays: string[] = [];
  const saturdays: string[] = [];
  for (let d = 1; d <= daysInMonth(month); d++) {
    const date = `${month}-${String(d).padStart(2, "0")}`;
    const dow = civilDayOfWeek(date);
    if (dow === 0) sundays.push(date);
    else if (dow === 6) saturdays.push(date);
  }
  return { sundays, saturdays };
}

/** HZ-2: a per-date selection keeps only the dates of months still in the horizon. */
export function retainInHorizon<T extends { date: string } | string>(items: readonly T[], months: readonly string[]): T[] {
  const keep = new Set(months);
  return items.filter((item) => keep.has(monthOfDate(typeof item === "string" ? item : item.date)));
}

/** HZ-2: the months a horizon change brings in (they start with today's per-month defaults). */
export function monthsEntering(previous: readonly string[], next: readonly string[]): string[] {
  const before = new Set(previous);
  return next.filter((m) => !before.has(m));
}
