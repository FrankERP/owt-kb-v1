// Which ministries the in-app Calendario shows (Frank, 2026-10-29: «que en su
// calendario puedan ver de todos los ministerios o solo de uno que quieran»).
//
// NEUTRAL — no React, no "use client" — because the `/schedule` Server Component
// reads the remembered choice and builds the Kids days with it (ADR-0028: a server
// file may never CALL a value from a client module).
//
// The choice exists only for someone in more than one ministry with a calendar
// (Alabanza plus Oasis Kids and/or Jóvenes). It is remembered per
// DEVICE, in a cookie, like the theme: the server reads it so first paint already
// shows the chosen view, and nothing is written to the member's document.
import type { ActiveDay, JovenesDayEntry, KidsDaySeat } from "../components/CalendarView";
import { MINISTRIES } from "../ministries";
import { KIDS_SEATS, KIDS_SEAT_LABELS, type KidsSeat } from "./kidsTypes";
import { serviceDayKey } from "./serviceReadSelect";
import type { MinistryEventView } from "./ministryEventReads";
import { audienceLabel, eventName, seatRoleLabel } from "./jovenesEventView";

export type CalendarView = "all" | "worship" | "kids" | "jovenes";
/** The ministries beside Alabanza that can join the Calendario, in the control's order. */
export type ExtraCalendarMinistry = "kids" | "jovenes";

export const CALENDAR_VIEW_COOKIE = "owt_calendar_view";

/** A year: the choice should outlive a session, and the cookie carries nothing private. */
export const CALENDAR_VIEW_MAX_AGE = 60 * 60 * 24 * 365;

/**
 * Anything but a known value is «Todos»: the combined view is what the option is for. So is a
 * ministry the reader no longer has (`extras`), since that view would be an empty calendar with
 * no way to tell why.
 */
export function parseCalendarView(value: unknown, extras: readonly ExtraCalendarMinistry[] = ["kids"]): CalendarView {
  if (value === "worship") return value;
  return (value === "kids" || value === "jovenes") && extras.includes(value) ? value : "all";
}

/** «Todos», Alabanza, then each other ministry the reader is in, by its registry name. */
export function calendarViewOptions(extras: readonly ExtraCalendarMinistry[]): Array<{ value: CalendarView; label: string }> {
  const order: ExtraCalendarMinistry[] = ["kids", "jovenes"];
  return [
    { value: "all", label: "Todos" },
    { value: "worship", label: MINISTRIES.worship.name },
    ...order.filter((m) => extras.includes(m)).map((m) => ({ value: m, label: MINISTRIES[m].name })),
  ];
}

/** The ministry a calendar entry belongs to: a Kids Sunday carries `kids`, a Jóvenes meeting
 *  `jovenes`, everything else is worship. */
export function entryMinistry(e: Pick<ActiveDay, "kids" | "jovenes">): "worship" | "kids" | "jovenes" {
  return e.kids ? "kids" : e.jovenes ? "jovenes" : "worship";
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

/** The day word of the plain Saturday meeting: the ministry's name, as «Oasis Kids» above. A
 *  meeting with a title or another kind names itself («Campamento», «Junta de grupos»). */
export const JOVENES_DAY_LABEL = MINISTRIES.jovenes.name;

/** A meeting's people, program and notes as both the Calendario's day sheet and `/jovenes` show
 *  them (`JovenesMeetingBody`), so the two can never word a seat differently. */
export function jovenesDayEntry(e: MinistryEventView): JovenesDayEntry {
  return {
    id: e._id,
    audience: audienceLabel(e.audience),
    arrival: e.arrival,
    seats: e.seats.map((s) => ({ key: s._key, label: seatRoleLabel(s.role), name: s.name, mine: s.mine })),
    program: e.program.map((l) => ({ key: l._key, label: l.label ?? "—", name: l.memberId ? l.name : null, mine: l.mine, note: l.note })),
    notes: e.notes,
  };
}

/**
 * A Jóvenes meeting as a calendar entry. `e` came from `readMinistryEvents` in MEMBER mode, so it
 * is published and the reader may see it (ADR-0081); «mine» was decided by member id in that
 * query. `null` for a date that cannot be placed.
 *
 * The Saturday meeting is called «Jóvenes» here (2026-11-10), not «Sábado de Jóvenes»: the row
 * already sits under a Saturday, and the long name pushed an agenda row to four lines on a phone.
 */
export function jovenesActiveDay(e: MinistryEventView): ActiveDay | null {
  const date = serviceDayKey(e.date);
  if (!date) return null;
  return { day: eventName(e) ?? JOVENES_DAY_LABEL, date, time: e.time, jovenes: jovenesDayEntry(e) };
}
