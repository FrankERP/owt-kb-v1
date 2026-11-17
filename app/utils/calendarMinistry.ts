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
import type { ActiveDay, JovenesDayEntry, JovenesDayStep, KidsDaySeat } from "../components/CalendarView";
import { MINISTRIES } from "../ministries";
import { KIDS_SEATS, KIDS_SEAT_LABELS, type KidsSeat } from "./kidsTypes";
import { serviceDayKey } from "./serviceReadSelect";
import type { MinistryEventView } from "./ministryEventReads";
import { audienceLabel, eventName, seatRoleLabel } from "./jovenesEventView";
import { freeLines, partPending, partViews, type PartView } from "./jovenesPartView";
import { ALABANZA_LABEL, hasFixedProgram, musicChip } from "./ministryParts";

/** That Saturday's worship setlist as `readSaturdaySets` answers it: titles and keys. */
export type JovenesDaySongs = ReadonlyArray<{ title: string; key: string | null }>;

/** A fixed part as a program step. Plática's «mine» stays off the STEP: whoever shares already
 *  holds the «Comparte» seat, and `mySeats` would name the same thing twice («Comparte · Plática»). */
function partStep(p: PartView): JovenesDayStep {
  return {
    key: `part-${p.id}`,
    label: p.label,
    name: p.people[0]?.name ?? null,
    photo: p.people[0]?.photo ?? null,
    mine: p.id === "platica" ? false : p.mine,
    note: p.note,
    part: p.id,
    people: p.people,
    music: musicChip(p.id, p.music),
    helpers: p.helpers,
    pending: partPending(p),
  };
}

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

/**
 * A meeting's people, program and notes as both the Calendario's day sheet and `/jovenes` show
 * them (`JovenesMeetingBody`), so the two can never word a seat differently.
 *
 * The program (ADR-0089): the Saturday meeting always opens with Alabanza and its four parts,
 * filled or not; any other meeting shows only the parts it holds; then the free lines, in their
 * stored order. `songs` is that Saturday's worship setlist — a list, `null` when the page read it
 * and there is none published, `undefined` when the page did not read it. `links: false` when the
 * meeting's page no longer opens this date (`meetingPageOpens`): its parts then carry no link.
 */
export function jovenesDayEntry(e: MinistryEventView, songs?: JovenesDaySongs | null, links = true): JovenesDayEntry {
  const fixed = hasFixedProgram(e);
  const alabanza: JovenesDayStep[] = fixed
    ? [{ key: "part-alabanza", label: ALABANZA_LABEL, name: null, photo: null, mine: false, note: null, part: "alabanza", ...(songs === undefined ? {} : { songs: songs ? [...songs] : null }) }]
    : [];
  // Off a Saturday: the part lines the meeting holds — and Plática for whoever SHARES there, with
  // no line yet, so the way in to «Mi parte» never depends on an email having arrived.
  const parts = partViews(e).filter((p) => fixed || p.stored || p.mine).map(partStep);
  return {
    id: e._id,
    audience: audienceLabel(e.audience),
    arrival: e.arrival,
    place: e.place,
    seats: e.seats.map((s) => ({ key: s._key, label: seatRoleLabel(s.role), name: s.name, photo: s.photo, mine: s.mine })),
    program: [
      ...alabanza,
      ...parts,
      ...freeLines(e.program).map((l) => ({ key: l._key, label: l.label ?? "—", name: l.memberId ? l.name : null, photo: l.memberId ? l.photo : null, mine: l.mine, note: l.note })),
    ],
    notes: e.notes,
    ...(links ? {} : { partLinks: false as const }),
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
export function jovenesActiveDay(e: MinistryEventView, songs?: JovenesDaySongs | null, links = true): ActiveDay | null {
  const date = serviceDayKey(e.date);
  if (!date) return null;
  return { day: eventName(e) ?? JOVENES_DAY_LABEL, date, time: e.time, jovenes: jovenesDayEntry(e, songs, links) };
}
