// Which ministries the in-app Calendario shows (Frank, 2026-10-29: «que en su
// calendario puedan ver de todos los ministerios o solo de uno que quieran»).
//
// NEUTRAL — no React, no "use client" — because the `/schedule` Server Component
// reads the remembered choice and builds the Kids days with it (ADR-0028: a server
// file may never CALL a value from a client module).
//
// The choice exists only for someone in more than one ministry with a calendar
// (today Alabanza and Oasis Kids; Jóvenes has none yet). It is remembered per
// DEVICE, in a cookie, like the theme: the server reads it so first paint already
// shows the chosen view, and nothing is written to the member's document.
import type { ActiveDay, KidsDaySeat } from "../components/CalendarView";
import { MINISTRIES } from "../ministries";
import { KIDS_SEATS, KIDS_SEAT_LABELS, type KidsSeat } from "./kidsTypes";
import { serviceDayKey } from "./serviceReadSelect";

export type CalendarView = "all" | "worship" | "kids";

export const CALENDAR_VIEW_COOKIE = "owt_calendar_view";

/** A year: the choice should outlive a session, and the cookie carries nothing private. */
export const CALENDAR_VIEW_MAX_AGE = 60 * 60 * 24 * 365;

/** Anything but a known value is «Todos»: the combined view is what the option is for. */
export function parseCalendarView(value: unknown): CalendarView {
  return value === "worship" || value === "kids" ? value : "all";
}

export const CALENDAR_VIEW_OPTIONS: ReadonlyArray<{ value: CalendarView; label: string }> = [
  { value: "all", label: "Todos" },
  { value: "worship", label: MINISTRIES.worship.name },
  { value: "kids", label: MINISTRIES.kids.name },
];

/** The ministry a calendar entry belongs to: a Kids Sunday carries `kids`, everything else is worship. */
export function entryMinistry(e: Pick<ActiveDay, "kids">): "worship" | "kids" {
  return e.kids ? "kids" : "worship";
}

/** The days the chosen view shows. A day whose every entry is filtered out disappears,
 *  so the strip and the grid stop lighting it. «Todos» returns the input untouched. */
export function filterActiveDays(activeDays: Record<string, ActiveDay[]>, view: CalendarView): Record<string, ActiveDay[]> {
  if (view === "all") return activeDays;
  const out: Record<string, ActiveDay[]> = {};
  for (const [date, entries] of Object.entries(activeDays)) {
    const kept = entries.filter((e) => entryMinistry(e) === view);
    if (kept.length) out[date] = kept;
  }
  return out;
}

/** One seat of a published `kidsSchedule` as `/schedule` projects it: the pair's name,
 *  and whether the viewer is in it (decided by member id in the query, never by name). */
export type KidsSeatRead = { name?: string | null; mine?: boolean | null } | null;
export type KidsCalendarRow = { date?: string } & Partial<Record<KidsSeat, KidsSeatRead>>;

/** The day word a Kids Sunday shows in the agenda, the sheet and a cell's accessible name. */
export const KIDS_DAY_LABEL = MINISTRIES.kids.name;

/** A published Kids Sunday as a calendar entry. `null` for a malformed date, which can
 *  neither be placed nor rendered (the same drop the weekend reads apply). */
export function kidsActiveDay(row: KidsCalendarRow): ActiveDay | null {
  const date = serviceDayKey(row?.date);
  if (!date) return null;
  const seats: KidsDaySeat[] = KIDS_SEATS.map((seat) => ({
    seat,
    label: KIDS_SEAT_LABELS[seat],
    pair: row[seat]?.name?.trim() || null,
    mine: row[seat]?.mine === true,
  }));
  return { day: KIDS_DAY_LABEL, date, kids: { seats } };
}
