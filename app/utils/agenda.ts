// Pure agenda logic for /schedule (spec §12.3). NEUTRAL — no React. DayCard's
// duplicate detection lives here so the agenda's conflict flag and the card's
// ⚠ marks can never disagree.
import type { ActiveDay } from "../components/CalendarView";
import { plural } from "./plural";
import { serviceStartTime } from "./calendarFeed";

export type Tone = "sun" | "sat" | "special";

export function findDuplicates(names: string[]): Set<string> {
  const counts = new Map<string, number>();
  for (const n of names) { const k = n.toLowerCase().trim(); if (k) counts.set(k, (counts.get(k) ?? 0) + 1); }
  return new Set([...counts].filter(([, c]) => c > 1).map(([k]) => k));
}

/** A service's tone as a 2–3 px rail: the agenda's rows and `DayCard`'s left edge.
 *  The day's ONE colour device — nothing else on either surface takes the tone. */
export const TONE_RAIL: Record<Tone, string> = {
  sun: "bg-accent",
  sat: "bg-warning-fg",
  special: "bg-info-fg",
};

export function serviceTone(e: Pick<ActiveDay, "day" | "roleId">): Tone {
  if (e.roleId) return "special";
  if (e.day === "Sábado") return "sat";
  if (e.day === "Domingo") return "sun";
  return "special";
}

const voices = (e: ActiveDay) => [
  ...(e.leads ?? []),
  ...(e.bgvs ?? []).map((m) => m.alias || m.member_name),
  ...(e.chorus ?? []).map((m) => m.alias || m.member_name),
];

/** The display name used in role cards is alias || name (`DayCard`'s own rule) — the
 *  ONE reader of `session.user`, so the card and the agenda can never disagree on who
 *  "you" is. */
export function myNameFromSession(user?: { alias?: string | null; name?: string | null }): string {
  return (user?.alias?.trim() || user?.name?.trim() || "").toLowerCase();
}

/** The seat labels where `myName` (already lowercased/trimmed) is seated, in DayCard's
 *  own order and casing: Lead, BGVs, Coro, then each instrument, then each FOH seat. An
 *  empty `myName` (signed out, or no alias/name) seats nobody. */
export function mySeats(e: Pick<ActiveDay, "leads" | "bgvs" | "chorus" | "instruments" | "fohTeam">, myName: string): string[] {
  if (!myName) return [];
  const seated = (name?: string) => !!name && name.toLowerCase().trim() === myName;
  const seats: string[] = [];
  if ((e.leads ?? []).some(seated)) seats.push("Lead");
  if ((e.bgvs ?? []).some((m) => seated(m.alias || m.member_name))) seats.push("BGVs");
  if ((e.chorus ?? []).some((m) => seated(m.alias || m.member_name))) seats.push("Coro");
  for (const s of e.instruments ?? []) if (seated(s.person)) seats.push(s.label);
  for (const s of e.fohTeam ?? []) if (seated(s.person)) seats.push(s.label);
  return [...new Set(seats)];
}

/** Conflicts = people seated twice within ONE section (voces / instrumentos / foh). */
export function serviceConflicts(e: ActiveDay): number {
  const instr = (e.instruments ?? []).filter((s) => s.person).map((s) => s.person);
  const foh = (e.fohTeam ?? []).filter((s) => s.person).map((s) => s.person);
  return findDuplicates(voices(e)).size + findDuplicates(instr).size + findDuplicates(foh).size;
}

/** "N conflicto" | "N conflictos" — the ONE plural rule, so the row's chip and
 *  its `aria-label` can never disagree on the wording. */
export function conflictLabel(n: number): string {
  return `${n} ${n === 1 ? "conflicto" : "conflictos"}`;
}

export function summarizeService(e: ActiveDay): string {
  const parts: string[] = [];
  if (e.leads?.length) parts.push(`Lead ${e.leads.join(", ")}`);
  for (const s of (e.instruments ?? []).filter((s) => s.person)) parts.push(`${s.label} ${s.person}`);
  const n = e.setlist?.songs?.length ?? 0;
  if (n) parts.push(plural(n, "canción", "canciones"));
  return parts.length ? parts.join(" · ") : "Sin asignaciones";
}

/** The clock a row or a day sheet shows beside the service: a weekend at the team's
 *  standing hour, a special at its own valid `time`, else nothing — the feed's ONE rule
 *  (`serviceStartTime`), so the agenda, `/me` and the `.ics` never disagree on it. */
export function serviceClock(e: Pick<ActiveDay, "day" | "roleId" | "time">): string | undefined {
  return serviceStartTime(e.roleId ? "special" : "weekend", e.day, e.time);
}

export type AgendaRow = { key: string; date: string; entry: ActiveDay; tone: Tone; conflicts: number; summary: string; monthStart: string | null };

const ORDER: Record<Tone, number> = { sat: 0, sun: 1, special: 2 };

export function agendaRows(activeDays: Record<string, ActiveDay[]>): AgendaRow[] {
  const rows = Object.entries(activeDays)
    .filter(([date]) => /^\d{4}-\d{2}-\d{2}$/.test(date))
    .flatMap(([date, entries]) => entries.map((entry) => ({ date, entry, tone: serviceTone(entry) })))
    .sort((a, b) => a.date.localeCompare(b.date) || ORDER[a.tone] - ORDER[b.tone]);
  let lastMonth = "";
  return rows.map(({ date, entry, tone }) => {
    const month = date.slice(0, 7);
    const monthStart = month !== lastMonth ? month : null;
    lastMonth = month;
    return { key: `${date}:${entry.roleId ?? entry.day}`, date, entry, tone, conflicts: serviceConflicts(entry), summary: summarizeService(entry), monthStart };
  });
}

/** `tones` is one per service in `activeDays` order, for the dot row — a Sunday that
 *  also hosts a special shows two dots, not a "several" mark; `lit` (any service) is
 *  what makes the cell pressable. No single "winning" tone: since ADR-0067 nothing
 *  paints a cell in one colour. */
export type StripDay = { date: string; num: number; dow: string; lit: boolean; tones: Tone[]; today: boolean; mine: boolean };
/** Weekday abbreviations in `getUTCDay` order — the strip's cell labels and the
 *  month grid's column headers (`DAY_HEADERS` rotates them Monday-first), one vocabulary. */
export const DOW_SHORT = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

/** Add n days (may be negative) to a "YYYY-MM-DD". UTC arithmetic on a date-only
 *  string, same reason `monthBounds` reads UTC: there is no time to shift. */
export function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** The Monday on or before `iso`, as "YYYY-MM-DD". Sunday belongs to the week that
 *  ENDS on it (the strip and the month grid both run Monday → Sunday). */
export function mondayOf(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
  return addDays(iso, dow === 0 ? -6 : 1 - dow);
}

function stripDay(date: string, activeDays: Record<string, ActiveDay[]>, todayStr: string, myName: string): StripDay {
  const [y, m, d] = date.split("-").map(Number);
  const entries = activeDays[date] ?? [];
  const tones = entries.map(serviceTone);
  const mine = !!myName && entries.some((e) => mySeats(e, myName).length > 0);
  return { date, num: d, dow: DOW_SHORT[new Date(Date.UTC(y, m - 1, d)).getUTCDay()], lit: tones.length > 0, tones, today: date === todayStr, mine };
}

/** A calendar cell's accessible name — «sábado, 12 de septiembre, Sábado, te toca» —
 *  shared by the week strip and the month grid so the two can never name a day
 *  differently. Local-noon render, never a bare `new Date(iso)`. */
export function dayCellLabel(d: Pick<StripDay, "date" | "mine">, entries: Pick<ActiveDay, "day">[]): string {
  const date = new Date(`${d.date}T12:00:00`).toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long" });
  return `${date}${entries.length ? `, ${entries.map((e) => e.day).join(", ")}` : ""}${d.mine ? ", te toca" : ""}`;
}

export function monthStripDays(ym: string, activeDays: Record<string, ActiveDay[]>, todayStr: string, myName = ""): StripDay[] {
  const [y, m] = ym.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: last }, (_, i) => stripDay(`${ym}-${String(i + 1).padStart(2, "0")}`, activeDays, todayStr, myName));
}

/** The seven days of one week, Monday first. `mondayIso` is normalized through
 *  `mondayOf`, so any day of the week resolves to the same seven cells — the strip's
 *  own paging arithmetic can never drift off a Monday. Lit tones come from
 *  `activeDays` whatever month the day falls in: the week is the unit here, not the
 *  month. `myName` (already lowercased/trimmed, from `myNameFromSession`) flags the
 *  `mine` dot; omitted, no day is ever `mine`. */
export function weekStripDays(mondayIso: string, activeDays: Record<string, ActiveDay[]>, todayStr: string, myName = ""): StripDay[] {
  const start = mondayOf(mondayIso);
  return Array.from({ length: 7 }, (_, i) => stripDay(addDays(start, i), activeDays, todayStr, myName));
}

/** What the calendar header counts (the «millones» pass, 2026-10-24): the services the
 *  reader will scroll past, and how many of them seat `myName`. In the rolling view only
 *  days from `todayStr` on count (the fetch starts there anyway); a browsed month counts
 *  its whole window, past days included, because that is what the page shows. */
export type CalendarCounts = { services: number; mine: number };
export function calendarCounts(activeDays: Record<string, ActiveDay[]>, todayStr: string, myName: string, fromToday: boolean): CalendarCounts {
  let services = 0;
  let mine = 0;
  for (const row of agendaRows(activeDays)) {
    if (fromToday && row.date < todayStr) continue;
    services += 1;
    if (myName && mySeats(row.entry, myName).length > 0) mine += 1;
  }
  return { services, mine };
}

/** The header's one line under the month, in two parts so the host can colour the second:
 *  «8 servicios por venir» (rolling) or «8 servicios» (a browsed window), and «te toca en 3»
 *  — null when the reader serves in none, so the line never says «te toca en 0». */
export function calendarCountLine(c: CalendarCounts, browsing: boolean): { services: string; mine: string | null } {
  const services =
    c.services === 0 ? (browsing ? "Sin servicios" : "Sin servicios por venir") : `${plural(c.services, "servicio", "servicios")}${browsing ? "" : " por venir"}`;
  return { services, mine: c.mine > 0 ? `te toca en ${c.mine}` : null };
}
