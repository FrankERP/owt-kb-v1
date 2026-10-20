// app/components/admin/plannerMonth.ts
//
// The month generator's pure month helpers, moved verbatim out of
// `MonthGenerator.tsx` (a "use client" module) so the MCP month planner
// (`app/utils/v3MonthPlan.ts`) computes the same weekend dates, saved-roles window,
// unavailability notices and year bounds the planner does. `MonthGenerator`
// imports every name from here.
//
// Neutral: no React, no "use client", nothing that reads a session or the network.

import type { SavedRole } from "./plannerModel";

/** The member fields `buildUnavailabilityNotices` reads (a subset of the planner's `MemberOption`). */
export interface UnavailabilityMember {
  member_name: string;
  alias?: string;
  unavailableDates?: string[];
}

/** The planner's year field bounds (and the connector's `month` input bounds). */
export const MIN_YEAR = 2024;
export const MAX_YEAR = 2035;

/** 56 days — matches the historical candidate-load window used by Servicios. */
export const SAVED_WINDOW_DAYS = 56;

export function getDates(year: number, month: number, day: 0 | 6): string[] {
  const dates: string[] = [];
  const d = new Date(year, month - 1, 1);
  while (d.getMonth() === month - 1) {
    if (d.getDay() === day) {
      dates.push(`${year}-${String(month).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`);
    }
    d.setDate(d.getDate() + 1);
  }
  return dates;
}

/**
 * Who is unavailable on a date this month will actually GENERATE.
 *
 * Fed the SELECTED Sundays (never `sundayDatesFull`) plus the specials, per
 * work item 6: once Sundays are individually deselectable, the full spine would
 * report notices for dates that produce no column at all — and a special, which
 * does produce one, would go unreported. The rule is "one entry per column",
 * which is why the three arguments here mirror `buildColumns`' three inputs.
 */
export function buildUnavailabilityNotices(
  sundayDates: string[],
  activeSatDates: string[],
  specials: { date: string; name: string }[],
  allMembers: UnavailabilityMember[]
): { name: string; date: string; service: string }[] {
  const out: { name: string; date: string; service: string }[] = [];
  for (const m of allMembers) {
    if (!m.unavailableDates?.length) continue;
    const unavailable = new Set(m.unavailableDates);
    const name = m.alias?.trim() || m.member_name;
    for (const d of sundayDates)    if (unavailable.has(d)) out.push({ name, date: d, service: "Dom" });
    for (const d of activeSatDates) if (unavailable.has(d)) out.push({ name, date: d, service: "Sáb" });
    for (const s of specials)       if (unavailable.has(s.date)) out.push({ name, date: s.date, service: s.name });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
}

/**
 * `allRoles` bounded to `SAVED_WINDOW_DAYS` days ending at the target month's
 * first Sunday (D12's `savedWindow`, fact 24) — both compared at local noon.
 * Empty when the month has no first Sunday (defensive; `getDates` always
 * returns at least one for a real calendar month) or when the caller has no
 * history to offer.
 */
export function savedWindowFor(year: number, month: number, allRoles: SavedRole[]): SavedRole[] {
  const firstSunday = getDates(year, month, 0)[0];
  if (!firstSunday) return [];
  const noon = (iso: string) => new Date(iso.slice(0, 10) + "T12:00:00").getTime();
  const anchor = noon(firstSunday);
  const start = anchor - SAVED_WINDOW_DAYS * 86_400_000;
  return allRoles.filter(r => {
    const t = noon(r.date);
    return t >= start && t <= anchor;
  });
}
