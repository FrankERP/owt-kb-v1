// Planear Jóvenes — the pure half (ADR-0081; plan `docs/superpowers/plans/2026-10-30-jovenes-events-access.md`
// §7.3, PR C). Months, the Saturday rows, the request bodies the editors send, and the WhatsApp
// text. Nothing here decides access: the reader decided what the page received, and the commit
// module (`ministryEventCommit.ts`) decides every write again from the stored document. The
// `canEdit*` answers below only choose which buttons to SHOW; a hidden button is cosmetic.
//
// Neutral module (no "use client", no server import): the server page and the client editors
// both import it (ADR-0028).

import type { MinistryEventLine, MinistryEventSeat, MinistryEventView } from "./ministryEventReads";
import { eventDayLabel } from "./jovenesEventView";

/** The Saturday meeting's usual times (Frank, 2026-10-30: «Junta a las 18:10, llegada como a las 17:30»). */
export const SATURDAY_DEFAULTS = { time: "18:10", arrival: "17:30" } as const;

/** The three seats the Saturday table shows, in its column order. */
export const SATURDAY_SEATS = ["encargado", "apoyo", "comparte"] as const;
export type SaturdaySeat = (typeof SATURDAY_SEATS)[number];

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** A `?mes=YYYY-MM` value, or the fallback when absent or malformed. */
export function parseMonth(raw: unknown, fallback: string): string {
  return typeof raw === "string" && MONTH.test(raw) ? raw : fallback;
}

/** `YYYY-MM` plus whole months (negative goes back), on a noon-UTC anchor so no edge moves it. */
export function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + by, 1, 12)).toISOString().slice(0, 7);
}

/** The month's first and last calendar day, as `YYYY-MM-DD` (string bounds, like `/kids/admin`). */
export function monthRange(month: string): { from: string; to: string } {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0, 12)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, "0")}` };
}

/** Every Saturday of the month, as `YYYY-MM-DD`. */
export function saturdaysOfMonth(month: string): string[] {
  const { from, to } = monthRange(month);
  const out: string[] = [];
  const last = Number(to.slice(8));
  for (let d = 1; d <= last; d++) {
    const iso = `${from.slice(0, 8)}${String(d).padStart(2, "0")}`;
    if (new Date(iso + "T12:00:00Z").getUTCDay() === 6) out.push(iso);
  }
  return out;
}

/** «noviembre de 2026» */
export function monthLabel(month: string): string {
  return new Date(month + "-01T12:00:00").toLocaleDateString("es-MX", { month: "long", year: "numeric" });
}

/** A whole-ministry meeting (the Saturday table's rows); a group's events belong to PR D's calendars. */
export function isMinistryWide(e: Pick<MinistryEventView, "audience">): boolean {
  return e.audience?.kind === "ministry";
}

export type SaturdayRow = { date: string; events: MinistryEventView[] };

/**
 * The table's rows: every Saturday of the month, plus any other date holding a whole-ministry
 * meeting (a quarterly pastors' board on a Friday still shows), each with its meetings in order.
 */
export function saturdayRows(month: string, events: readonly MinistryEventView[]): SaturdayRow[] {
  const { from, to } = monthRange(month);
  const byDate = new Map<string, MinistryEventView[]>(saturdaysOfMonth(month).map((d) => [d, []]));
  for (const e of events) {
    if (!isMinistryWide(e) || e.date < from || e.date > to) continue;
    const list = byDate.get(e.date) ?? [];
    list.push(e);
    byDate.set(e.date, list);
  }
  return [...byDate.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([date, list]) => ({ date, events: list }));
}

/** The names in one seat role, in stored order; a seat with no person reads «Sin asignar». */
export function seatNames(e: Pick<MinistryEventView, "seats">, role: string): string[] {
  return e.seats.filter((s) => s.role === role).map((s) => s.name ?? "Sin asignar");
}

// ── The Saturday editor ─────────────────────────────────────────────────────

export type SeatPick = { key: string | null; member: string | null };

export type SaturdayForm = {
  date: string;
  time: string;
  arrival: string;
  title: string;
  notes: string;
  published: boolean;
  /** One pick per column. Extra stored seats (a second apoyo) ride along untouched in `extra`. */
  picks: Record<SaturdaySeat, SeatPick>;
  extra: Array<{ key: string; role: string; member: string | null }>;
};

/** The form for an existing meeting, or a new one on `date` with the usual times. */
export function saturdayForm(date: string, e?: MinistryEventView): SaturdayForm {
  const picks = { encargado: empty(), apoyo: empty(), comparte: empty() } as Record<SaturdaySeat, SeatPick>;
  const extra: SaturdayForm["extra"] = [];
  for (const s of e?.seats ?? []) {
    const role = s.role as SaturdaySeat;
    if ((SATURDAY_SEATS as readonly string[]).includes(s.role ?? "") && picks[role].key === null) {
      picks[role] = { key: s._key, member: s.memberId };
    } else if (s.role) {
      extra.push({ key: s._key, role: s.role, member: s.memberId });
    }
  }
  return {
    date: e?.date ?? date,
    time: e ? e.time ?? "" : SATURDAY_DEFAULTS.time,
    arrival: e ? e.arrival ?? "" : SATURDAY_DEFAULTS.arrival,
    title: e?.title ?? "",
    notes: e?.notes ?? "",
    published: e?.published ?? false,
    picks,
    extra,
  };
}

function empty(): SeatPick {
  return { key: null, member: null };
}

const orNull = (s: string) => (s.trim() ? s.trim() : null);

/**
 * The body both the create (POST, with `token`) and the edit (PATCH, with `_rev`) send. An empty
 * column sends no seat: a stored seat whose column was cleared is dropped, which is the edit.
 */
export function saturdayBody(form: SaturdayForm): Record<string, unknown> {
  const seats: Array<Record<string, unknown>> = [];
  for (const role of SATURDAY_SEATS) {
    const p = form.picks[role];
    if (!p.member) continue;
    seats.push({ ...(p.key ? { _key: p.key } : {}), role, member: p.member });
  }
  for (const x of form.extra) seats.push({ _key: x.key, role: x.role, member: x.member });
  return {
    audience: { kind: "ministry" },
    kind: "saturday",
    date: form.date,
    time: orNull(form.time),
    arrival: orNull(form.arrival),
    title: orNull(form.title),
    notes: orNull(form.notes),
    published: form.published,
    seats,
  };
}

// ── The program editor ──────────────────────────────────────────────────────

export type LineForm = { key: string | null; label: string; member: string | null; note: string };

export function programForm(lines: readonly MinistryEventLine[]): LineForm[] {
  return lines.map((l) => ({ key: l._key, label: l.label ?? "", member: l.memberId, note: l.note ?? "" }));
}

/** The program PATCH's `program`: blank lines (no label) are left out, never sent as invalid. */
export function programBody(lines: readonly LineForm[]): Array<Record<string, unknown>> {
  return lines
    .filter((l) => l.label.trim())
    .map((l) => ({
      ...(l.key ? { _key: l.key } : {}),
      label: l.label.trim(),
      ...(l.member ? { member: l.member } : {}),
      ...(l.note.trim() ? { note: l.note.trim() } : {}),
    }));
}

/**
 * Show «Editar programa»? A Jóvenes admin on any meeting; the encargado or apoyo of a
 * whole-ministry meeting (W3a). The server checks again on the stored document.
 */
export function showsProgramEditor(e: Pick<MinistryEventView, "audience" | "seats">, isManager: boolean): boolean {
  if (isManager) return true;
  if (!isMinistryWide(e)) return false;
  return e.seats.some((s: MinistryEventSeat) => s.mine && (s.role === "encargado" || s.role === "apoyo"));
}

// ── «Copiar para WhatsApp» ──────────────────────────────────────────────────

/**
 * The month's Saturday roster as a WhatsApp message (it replaces the image the team sent). Bold
 * is WhatsApp's `*…*`. Only dates with a meeting are listed; a draft is listed too, because the
 * table is what the admin is about to send.
 */
export function whatsappRoster(month: string, rows: readonly SaturdayRow[]): string {
  const blocks: string[] = [];
  for (const row of rows) {
    for (const e of row.events) {
      const day = eventDayLabel(e.date);
      const when = [e.time, e.arrival ? `llegada ${e.arrival}` : null].filter(Boolean).join(" · ");
      const lines = [`*${capitalize(day)}*${when ? ` — ${when}` : ""}`];
      if (e.title) lines.push(e.title);
      const label: Record<SaturdaySeat, string> = { encargado: "Encargado", apoyo: "Apoyo", comparte: "Comparte" };
      for (const role of SATURDAY_SEATS) {
        const names = seatNames(e, role);
        lines.push(`${label[role]}: ${names.length ? names.join(", ") : "Sin asignar"}`);
      }
      if (e.notes) lines.push(`Notas: ${e.notes}`);
      blocks.push(lines.join("\n"));
    }
  }
  const header = `*Rol de Jóvenes — ${monthLabel(month)}*`;
  return blocks.length ? `${header}\n\n${blocks.join("\n\n")}` : header;
}

function capitalize(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}
