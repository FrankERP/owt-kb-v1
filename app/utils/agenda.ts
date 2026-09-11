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

/** Conflicts = people seated twice within ONE section (voces / instrumentos / foh). */
export function serviceConflicts(e: ActiveDay): number {
  const instr = (e.instruments ?? []).filter((s) => s.person).map((s) => s.person);
  const foh = (e.fohTeam ?? []).filter((s) => s.person).map((s) => s.person);
  return findDuplicates(voices(e)).size + findDuplicates(instr).size + findDuplicates(foh).size;
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

export type StripDay = { date: string; num: number; dow: string; tone: Tone | null; today: boolean; multiple: boolean };
const DOW = ["D", "L", "M", "X", "J", "V", "S"]; // getUTCDay order, Spanish initials

export function monthStripDays(ym: string, activeDays: Record<string, ActiveDay[]>, todayStr: string): StripDay[] {
  const [y, m] = ym.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: last }, (_, i) => {
    const date = `${ym}-${String(i + 1).padStart(2, "0")}`;
    const entries = activeDays[date] ?? [];
    const tones = entries.map(serviceTone);
    const tone: Tone | null = tones.includes("special") ? "special" : tones.includes("sat") ? "sat" : tones.includes("sun") ? "sun" : null;
    return { date, num: i + 1, dow: DOW[new Date(Date.UTC(y, m - 1, i + 1)).getUTCDay()], tone, today: date === todayStr, multiple: entries.length > 1 };
  });
}
