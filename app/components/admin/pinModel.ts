// app/components/admin/pinModel.ts
//
// «Solo llenar vacíos» — the pure half (spec 2026-09-29-planner-trailing-saturday-and-fill-empty
// §3.2). With the switch on, every occupied voice seat on a column Auto writes becomes a pin
// (ADR-0041): hand-placed or from an earlier Auto alike (Frank, 2026-09-29: «Todo lo que ya
// está»). This module turns the board into the `pinned` array, refuses in Spanish before the
// fetch whatever the solver would refuse in English, checks the handshake, and computes what the
// board shows about each pin. No React, no network.

import type { SolveRequest, SolveResponse } from "@/app/api/admin/solve/route";
import { displayName, type RankMember } from "./candidateRanking";
import { isSolvable, weekForColumn, type GridCell, type GridColumn, type GridRow } from "./plannerModel";

export type PinRole = NonNullable<SolveRequest["pinned"]>[number]["role"];

export interface Pin {
  week: number;
  role: PinRole;
  person: string;
}

/** One occupant copy on the board: the cell, the member, and which copy of them in that cell. */
export interface PinSeat {
  columnId: string;
  rowId: string;
  memberId: string;
  /** Earlier copies of the same member in this cell — DD10 lets a member sit twice in one cell. */
  occurrence: number;
}

/** A seat not sent because its person already holds a seat of the same service. */
export interface DroppedPin extends PinSeat {
  person: string;
  /** The seat of that service the person keeps. */
  kept: PinSeat;
}

export interface CollectedPins {
  /** Distinct `(person, role, week)`, one per person per service, in board order. */
  pins: Pin[];
  /** The seat each pin came from, parallel to `pins`. */
  seats: PinSeat[];
  /** `${columnId}|${rowId}` of every cell holding a seat in `seats` (`applySolveResponse`). */
  pinnedCellKeys: Set<string>;
  dropped: DroppedPin[];
  /** Occupants whose id resolves to no member. */
  unresolved: PinSeat[];
  /** Members whose `member_name` is empty once trimmed. */
  unnamed: PinSeat[];
}

/** The solver's own cap (`PINNED_CAP`, `gcf/owt_solver_v2.py`): over it the request is refused. */
export const PINNED_CAP = 100;

/** Set directly under Auto, never through `solverRefusalMessage` (spec §3.2, E8). */
export const PIN_HANDSHAKE_REFUSAL = "El solver no respetó los lugares fijados; no se aplicó nada.";

/** The spec's precedence: one seat per person per service, Lead first, then BGV, then Coro. */
const VOICE_ROW_ORDER = ["lead", "bgv", "coro"] as const;

const ROLE_FOR: Record<"sunday_role" | "saturday_role", Partial<Record<string, PinRole>>> = {
  sunday_role: { lead: "Sun.Lead", bgv: "Sun.BGV", coro: "Sun.Choir" },
  saturday_role: { lead: "Sat.Lead", bgv: "Sat.BGV" },
};

const SHORT_MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

const cellKeyOf = (columnId: string, rowId: string) => `${columnId}|${rowId}`;

export const serviceOfRole = (role: PinRole): "Sun" | "Sat" => (role.startsWith("Sun") ? "Sun" : "Sat");

export function pinSeatKey(seat: Pick<PinSeat, "columnId" | "rowId" | "memberId" | "occurrence">): string {
  return `${seat.columnId}|${seat.rowId}|${seat.memberId}#${seat.occurrence}`;
}

/** `2026-10-04` → `4 oct`. String arithmetic on the ISO date — no `Date`, no Intl. */
export function dayLabel(iso: string): string {
  return `${Number(iso.slice(8, 10))} ${SHORT_MONTHS[Number(iso.slice(5, 7)) - 1]}`;
}

export function serviceDayLabel(type: "sunday_role" | "saturday_role", iso: string): string {
  return `${type === "sunday_role" ? "domingo" : "sábado"} ${dayLabel(iso)}`;
}

/** `Lead del domingo 4 oct` — what a Spanish refusal points the admin at. */
export function seatLabel(seat: Pick<PinSeat, "columnId" | "rowId">, columns: GridColumn[], rows: GridRow[]): string {
  const column = columns.find((c) => c.columnId === seat.columnId);
  const label = rows.find((r) => r.id === seat.rowId)?.label ?? seat.rowId;
  if (!column || column.type === "special_role") return label;
  return `${label} del ${serviceDayLabel(column.type, column.date)}`;
}

/**
 * Whether Auto writes this column: a weekend column the solver has a week for, and — when the
 * request's `weekends_with_saturday` is given — a Saturday whose week the request sends (Q1:
 * a trailing Saturday withheld by T5 is filled by hand, never pinned and refused).
 */
function autoWrites(
  column: GridColumn,
  sundayDates: string[],
  weekendsWithSaturday: number[] | undefined,
): boolean {
  if (column.type === "special_role") return false;
  const week = weekForColumn(column, sundayDates);
  if (week == null) return false;
  if (column.type === "saturday_role" && weekendsWithSaturday && !weekendsWithSaturday.includes(week)) return false;
  return true;
}

export function collectPins(input: {
  cells: GridCell[];
  columns: GridColumn[];
  rows: GridRow[];
  members: RankMember[];
  /** The FULL month spine (`sundayDatesFull`) — week numbers are positional over it (E21). */
  sundayDates: string[];
  /**
   * The request's `weekends_with_saturday`. When given, a Saturday column whose week is not
   * in it is not a column Auto writes, so it sends no pin (Q1). Absent ⇒ no such filter.
   */
  weekendsWithSaturday?: number[];
}): CollectedPins {
  const { cells, columns, rows, members, sundayDates, weekendsWithSaturday } = input;
  const byKey = new Map(cells.map((c) => [cellKeyOf(c.columnId, c.rowId), c]));
  const out: CollectedPins = { pins: [], seats: [], pinnedCellKeys: new Set(), dropped: [], unresolved: [], unnamed: [] };
  const keptInService = new Map<string, PinSeat>(); // `${person}|${week}|${Sun|Sat}` → kept seat

  for (const column of columns) {
    if (column.type === "special_role") continue;
    if (!autoWrites(column, sundayDates, weekendsWithSaturday)) continue;
    const week = weekForColumn(column, sundayDates);
    if (week == null) continue; // unreachable after `autoWrites`; narrows `week`
    for (const rowId of VOICE_ROW_ORDER) {
      const row = rows.find((r) => r.id === rowId);
      const role = ROLE_FOR[column.type][rowId];
      if (!row || !role || !isSolvable(row, column)) continue;
      const cell = byKey.get(cellKeyOf(column.columnId, rowId));
      if (!cell) continue;
      cell.occupants.forEach((occupant, index) => {
        const occurrence = cell.occupants.slice(0, index).filter((o) => o.memberId === occupant.memberId).length;
        const seat: PinSeat = { columnId: column.columnId, rowId, memberId: occupant.memberId, occurrence };
        const member = members.find((x) => x._id === occupant.memberId);
        if (!member) {
          out.unresolved.push(seat);
          return;
        }
        // The Studio schema does not require `member_name`: null or absent is unnamed, not a crash.
        if (!member.member_name?.trim()) {
          out.unnamed.push(seat);
          return;
        }
        // Exact `member_name` — `memberIdToName`'s answer for a member that exists. The
        // solver accepts a pool member's exact spelling, trailing space and all.
        const person = member.member_name;
        const serviceKey = `${person}|${week}|${serviceOfRole(role)}`;
        const kept = keptInService.get(serviceKey);
        if (kept) {
          out.dropped.push({ ...seat, person, kept });
          return;
        }
        keptInService.set(serviceKey, seat);
        out.pins.push({ week, role, person });
        out.seats.push(seat);
        out.pinnedCellKeys.add(cellKeyOf(column.columnId, rowId));
      });
    }
  }
  return out;
}

const REFUSAL = "No se puede usar «Solo llenar vacíos»";

/**
 * Everything the solver would refuse about `pinned`, refused here first, in Spanish and
 * naming the cell (spec §3.2), so its English text never has to explain them. First
 * refusal wins, in the order below.
 */
export function pinRefusal(input: {
  collected: CollectedPins;
  columns: GridColumn[];
  rows: GridRow[];
  members: RankMember[];
  /** The request's `weekends_with_saturday`. */
  weekendsWithSaturday: number[];
  /** Every name in the request's three pools (`sunday_leads`, `saturday_leads`, `support`). */
  poolNames: string[];
}): string | null {
  const { collected, columns, rows, members, weekendsWithSaturday, poolNames } = input;
  const where = (seat: PinSeat) => seatLabel(seat, columns, rows);

  const ghost = collected.unresolved[0];
  if (ghost) {
    return `${REFUSAL}: en ${where(ghost)} hay alguien que ya no está en la lista de miembros. Quítalo de ese lugar y vuelve a intentarlo.`;
  }
  const unnamed = collected.unnamed[0];
  if (unnamed) {
    const who = members.find((x) => x._id === unnamed.memberId)?.alias?.trim() || "Un miembro";
    return `${REFUSAL}: ${who} (en ${where(unnamed)}) no tiene nombre en su ficha. Complétalo en Miembros o quítalo de ese lugar.`;
  }
  if (collected.pins.length > PINNED_CAP) {
    return `${REFUSAL}: hay ${collected.pins.length} lugares de voz ocupados y el solver acepta hasta ${PINNED_CAP}. Borra algunos o apaga «Solo llenar vacíos».`;
  }
  const satWeeks = new Set(weekendsWithSaturday);
  const offWeek = collected.pins.findIndex((p) => serviceOfRole(p.role) === "Sat" && !satWeeks.has(p.week));
  if (offWeek !== -1) {
    return `${REFUSAL}: ${where(collected.seats[offWeek])} no se envía al solver este mes. Quítalo de ese lugar o apaga «Solo llenar vacíos».`;
  }
  // `validate_config` (gcf/owt_solver_v2.py): a PINNED-ONLY name that differs from another
  // name only in case or surrounding spaces is refused; a pin on a pool member's exact name
  // never is.
  const pool = new Set(poolNames);
  const pinnedOnly = [...new Set(collected.pins.map((p) => p.person))].filter((n) => !pool.has(n));
  const spellings = new Map<string, string[]>();
  for (const name of [...pool, ...pinnedOnly]) {
    const k = name.trim().toLowerCase();
    spellings.set(k, [...(spellings.get(k) ?? []), name]);
  }
  for (const name of pinnedOnly) {
    const group = spellings.get(name.trim().toLowerCase()) ?? [];
    if (group.length < 2) continue;
    const other = group.find((n) => n !== name) ?? name;
    const seat = collected.seats[collected.pins.findIndex((p) => p.person === name)];
    return `${REFUSAL}: «${name}» (en ${where(seat)}) solo se distingue de «${other}» por mayúsculas o espacios, y el solver no puede saber cuál es cuál. Corrige el nombre en Miembros.`;
  }
  return null;
}

/**
 * E8: a success is applied only if the solver says it honoured every pin AND the schedule
 * shows each one, by EXACT name. Deliberately not `applySolveResponse`'s alias-tolerant,
 * case-insensitive `nameToId`: a pin is a promise about one spelling.
 */
export function pinHandshakeHolds(response: SolveResponse, pins: Pin[]): boolean {
  if (typeof response.pinned_honored !== "number" || response.pinned_honored !== pins.length) return false;
  const schedule = response.schedule ?? {};
  return pins.every((pin) => {
    const week = schedule[String(pin.week)];
    const service = serviceOfRole(pin.role) === "Sun" ? week?.Sunday : week?.Saturday;
    const field = pin.role.slice(4) as "Lead" | "BGV" | "Choir";
    const names = (service as Record<string, string[] | undefined> | undefined)?.[field];
    return Array.isArray(names) && names.includes(pin.person);
  });
}

export type PinConflictKind = "unavailable" | "outsidePool" | "duplicate";

/**
 * What the board says about a seat that will be pinned (spec §3.3, E3/E5) — the pin wins, so
 * these are shown, never blocking. Keyed by `pinSeatKey`.
 */
export function pinConflicts(input: {
  collected: CollectedPins;
  columns: GridColumn[];
  members: RankMember[];
  /** The request's pools: `sunday_leads`, `saturday_leads`, `support` (injected names included). */
  pools: { sundayLeads: string[]; saturdayLeads: string[]; support: string[] };
}): Map<string, PinConflictKind[]> {
  const { collected, columns, members, pools } = input;
  const out = new Map<string, PinConflictKind[]>();
  const add = (seat: PinSeat, kind: PinConflictKind) => {
    const key = pinSeatKey(seat);
    out.set(key, [...(out.get(key) ?? []), kind]);
  };
  const sunLead = new Set(pools.sundayLeads);
  const satLead = new Set([...pools.sundayLeads, ...pools.saturdayLeads]);
  const anyPool = new Set([...pools.sundayLeads, ...pools.saturdayLeads, ...pools.support]);
  collected.pins.forEach((pin, i) => {
    const seat = collected.seats[i];
    const column = columns.find((c) => c.columnId === seat.columnId);
    const member = members.find((x) => x._id === seat.memberId);
    if (column && (member?.unavailableDates ?? []).includes(column.date)) add(seat, "unavailable");
    const pool = pin.role === "Sun.Lead" ? sunLead : pin.role === "Sat.Lead" ? satLead : anyPool;
    if (!pool.has(pin.person)) add(seat, "outsidePool");
  });
  for (const d of collected.dropped) add(d, "duplicate");
  return out;
}

/** One line per seat left out as a duplicate, for the notice list under Auto. */
export function droppedPinNotices(input: {
  dropped: DroppedPin[];
  columns: GridColumn[];
  rows: GridRow[];
  members: RankMember[];
}): string[] {
  const { dropped, columns, rows, members } = input;
  return dropped.map((d) => {
    const member = members.find((x) => x._id === d.memberId);
    const who = member ? displayName(member) : d.person;
    if (d.kept.rowId === d.rowId) {
      return `${who} estaba dos veces en ${seatLabel(d, columns, rows)}; se fijó una sola vez.`;
    }
    const column = columns.find((c) => c.columnId === d.columnId);
    const day = column && column.type !== "special_role" ? serviceDayLabel(column.type, column.date) : d.columnId;
    const keptLabel = rows.find((r) => r.id === d.kept.rowId)?.label ?? d.kept.rowId;
    return `${who} estaba en dos lugares del ${day}; se fijó solo en ${keptLabel}.`;
  });
}

/** The confirm dialog's count: target minus occupants, over the voice seats Auto writes. */
export function emptyVoiceSeats(input: {
  cells: GridCell[];
  columns: GridColumn[];
  rows: GridRow[];
  sundayDates: string[];
  /** The request's `weekends_with_saturday`, as in `collectPins` (Q1). Absent ⇒ no such filter. */
  weekendsWithSaturday?: number[];
}): number {
  const { cells, columns, rows, sundayDates, weekendsWithSaturday } = input;
  const byKey = new Map(cells.map((c) => [cellKeyOf(c.columnId, c.rowId), c]));
  let n = 0;
  for (const column of columns) {
    if (!autoWrites(column, sundayDates, weekendsWithSaturday)) continue;
    for (const row of rows) {
      if (!isSolvable(row, column) || row.target == null) continue;
      n += Math.max(0, row.target - (byKey.get(cellKeyOf(column.columnId, row.id))?.occupants.length ?? 0));
    }
  }
  return n;
}
