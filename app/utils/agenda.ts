// Pure agenda logic for /schedule (spec §12.3). NEUTRAL — no React. DayCard's
// duplicate detection lives here so the agenda's conflict flag and the card's
// ⚠ marks can never disagree.
import type { ActiveDay } from "../components/CalendarView";

export type Tone = "sun" | "sat" | "special";

export function findDuplicates(names: string[]): Set<string> {
  const counts = new Map<string, number>();
  for (const n of names) { const k = n.toLowerCase().trim(); if (k) counts.set(k, (counts.get(k) ?? 0) + 1); }
  return new Set([...counts].filter(([, c]) => c > 1).map(([k]) => k));
}

export function serviceTone(e: ActiveDay): Tone {
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
export function mySeats(e: ActiveDay, myName: string): string[] {
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
  if (n) parts.push(`${n} ${n === 1 ? "canción" : "canciones"}`);
  return parts.length ? parts.join(" · ") : "Sin asignaciones";
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

export type StripDay = { date: string; num: number; dow: string; tone: Tone | null; today: boolean; multiple: boolean; mine: boolean };
const DOW = ["D", "L", "M", "X", "J", "V", "S"]; // getUTCDay order, Spanish initials

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
  const tone: Tone | null = tones.includes("special") ? "special" : tones.includes("sat") ? "sat" : tones.includes("sun") ? "sun" : null;
  const mine = !!myName && entries.some((e) => mySeats(e, myName).length > 0);
  return { date, num: d, dow: DOW[new Date(Date.UTC(y, m - 1, d)).getUTCDay()], tone, today: date === todayStr, multiple: entries.length > 1, mine };
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
