// The weekends a member marks availability for (spec Part IV decision I).
//
// NEUTRAL — no hooks, no "use client" — so a Server Component may CALL it and a
// test may import it without a DOM.
//
// Every date here is built at LOCAL NOON (`…T12:00:00`), never bare
// `new Date(iso)`: at UTC-6 a bare parse is the previous day, which would shift
// every row of the list by one (CLAUDE.md's timezone invariant).

export interface Weekend {
  /** `YYYY-MM-DD` of the Saturday. */
  sat: string;
  /** `YYYY-MM-DD` of the Sunday that follows it. */
  sun: string;
}

function noon(iso: string): Date {
  return new Date(iso.slice(0, 10) + "T12:00:00");
}

function isoOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * The next `count` weekends from `todayIso`, Saturday first.
 *
 * THE CURRENT WEEKEND COUNTS while its SUNDAY is still ahead — so on a Saturday,
 * and on the Sunday itself, the first row is the weekend the member is living
 * through. Starting at next Saturday instead would hide the row they opened the
 * page for, on the two days they are most likely to need it.
 */
export function nextWeekends(todayIso: string, count: number): Weekend[] {
  const today = noon(todayIso);
  const day = today.getDay(); // 0 = Sunday … 6 = Saturday
  const sat = new Date(today);
  // From a Sunday the weekend's Saturday is YESTERDAY (its Sunday is today);
  // from any other day it is the upcoming one, which on a Saturday is today.
  sat.setDate(today.getDate() + (day === 0 ? -1 : 6 - day));

  const out: Weekend[] = [];
  for (let i = 0; i < count; i++) {
    const sun = new Date(sat);
    sun.setDate(sat.getDate() + 1);
    out.push({ sat: isoOf(sat), sun: isoOf(sun) });
    sat.setDate(sat.getDate() + 7);
  }
  return out;
}

/**
 * A weekend as one short line: «12 – 13 sep», and «31 oct – 1 nov» when the two
 * days fall in different months.
 */
export function weekendLabel({ sat, sun }: Weekend): string {
  const a = noon(sat);
  const b = noon(sun);
  const month = (d: Date) => d.toLocaleDateString("es-MX", { month: "short" });
  return a.getMonth() === b.getMonth()
    ? `${a.getDate()} – ${b.getDate()} ${month(b)}`
    : `${a.getDate()} ${month(a)} – ${b.getDate()} ${month(b)}`;
}
