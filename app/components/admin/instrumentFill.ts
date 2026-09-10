// app/components/admin/instrumentFill.ts
//
// The greedy filler for INSTRUMENT seats on weekend columns (spec
// 2026-09-09-member-instruments-auto-fill-design.md §6). Sibling of
// `localFill.ts`, and like it NOT the solver — never describe it as one in the
// UI. CP-SAT knows five voice roles and nothing else (D5); instruments were
// manual until this module.
//
// What it guarantees (§6.2): per-MEMBER total balance inside the month, per
// service. At every placement the eligible declarer holding the fewest
// instrument seats this month is chosen, so nobody is passed over by someone
// who already holds strictly more. When every player of an instrument declares
// only that instrument, that IS the per-instrument "difference ≤ 1" Frank
// asked for; a two-instrument member is balanced as a person, and their count
// on any ONE instrument may lag — confirmed as the intended reading.
//
// The two traps the review found, and where each is closed:
//  1. Eligibility is NEVER re-implemented here. The pool is `rankCandidates`
//     re-run per placement against `working`, filtered on `eligible` and
//     `!undeclared`. That single call is what enforces Tipo, availability, and
//     the same-category rule (a member already on another `instrumento:` row of
//     this column is `blockedReason`, exactly the C2 refusal the picker and
//     `moveGate` apply to a human). Round 1 of the review caught a version that
//     forked this and seated one person on Keys and Drums the same day.
//  2. Vacate happens ONCE, before any counting. A previous Auto's `origin:
//     "auto"` instrument cells are emptied in one pass over the whole grid, so
//     `working` never holds a pick this run has not made. Round 2 caught a
//     version that vacated inside the column loop: stale picks in later columns
//     counted as seats held while earlier columns were filled, and the same
//     inputs produced two different rosters.

import type { ParticipantRole } from "@/app/utils/computeParticipation";
import { rankCandidates, type RankedCandidate, type RankMember } from "./candidateRanking";
import { withAutoCell } from "./localFill";
import {
  assignedForColumn,
  cellsToParticipantRoles,
  rowAppliesTo,
  seatDefForRow,
  type GridCell,
  type GridColumn,
  type GridRow,
  type SolverConfig,
} from "./plannerModel";
import { instrumentSeatDef, isKnownInstrument } from "./seatModel";

export const INSTRUMENT_ROW_PREFIX = "instrumento:";

export function isInstrumentRowId(rowId: string): boolean {
  return rowId.startsWith(INSTRUMENT_ROW_PREFIX);
}

export interface FillInstrumentsInput {
  /** The whole grid, every column type; specials are skipped, never filled. */
  columns: GridColumn[];
  rows: GridRow[];
  /** Post-solve, post-special-fill cells. */
  cells: GridCell[];
  members: RankMember[];
  /** `rankCandidates` needs it; the ORDER below ignores it (D2: in-month only). */
  savedWindow: ParticipantRole[];
  /** `rankCandidates` needs it for rule blocks; no rule form names an instrument. */
  config?: SolverConfig;
}

export interface FillInstrumentsResult {
  /** The whole grid, merged — every cell this did not touch survives by reference. */
  cells: GridCell[];
  /** ONE ENTRY PER SEAT left empty on a row that HAS declarers. */
  unfilled: { columnId: string; rowId: string }[];
}

type Seat = { columnId: string; rowId: string };

const isWeekend = (c: GridColumn) => c.type === "sunday_role" || c.type === "saturday_role";

/**
 * Step 0 — every auto instrument cell on a weekend column, emptied, in one
 * pass. If the same member is re-picked into this seat later this run, the
 * fresh `GridOccupant` carries no `itemKey` even though the vacated one did —
 * dropping it is knowingly inert today: no writer reads `itemKey` off an
 * instrument occupant, and `serializeStoredColumn` rebuilds the stored array
 * from `memberId` + the row's label, not from a carried-over key.
 */
function vacateAutoInstrumentCells(cells: GridCell[], weekendIds: Set<string>): GridCell[] {
  return cells.map((c) =>
    weekendIds.has(c.columnId) && isInstrumentRowId(c.rowId) && c.origin === "auto"
      ? { ...c, occupants: [], origin: "empty" as const }
      : c,
  );
}

/** Instrument seats held per member over the whole grid, all instrument rows, every column. */
function seatCounts(cells: GridCell[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const c of cells) {
    if (!isInstrumentRowId(c.rowId)) continue;
    for (const o of c.occupants) out.set(o.memberId, (out.get(o.memberId) ?? 0) + 1);
  }
  return out;
}

/** Members holding ANY instrument row on the given column. */
function instrumentalistsOn(cells: GridCell[], columnId: string): Set<string> {
  const out = new Set<string>();
  for (const c of cells) {
    if (c.columnId !== columnId || !isInstrumentRowId(c.rowId)) continue;
    for (const o of c.occupants) out.add(o.memberId);
  }
  return out;
}

export function fillInstruments(input: FillInstrumentsInput): FillInstrumentsResult {
  const { columns, rows, members, savedWindow, config } = input;
  const unfilled: Seat[] = [];

  const weekend = columns.filter(isWeekend).sort((a, b) => a.date.localeCompare(b.date));
  const weekendIds = new Set(weekend.map((c) => c.columnId));
  let working = vacateAutoInstrumentCells(input.cells, weekendIds);

  // Rows the filler may touch: instrument rows inside the member vocabulary
  // AND whose id agrees with the id `seatDefForRow` would derive from the
  // row's own label. Stored-mode rows keep their case as written on the role
  // document (`normalizeLabel`, not `normalizeSeatName`), so a legacy-spelled
  // row like `{ id: "instrumento:keys", label: "keys" }` passes
  // `isKnownInstrument` (case-insensitive) but collides on id with the
  // canonical `instrumento:Keys` row — `seatDefForRow` maps BOTH to the same
  // seat, so filling the legacy row would double-seat one instrument under a
  // non-canonical label. Requiring `instrumentSeatDef(row.label).id ===
  // row.id` is what `seatDefForRow(row).id === row.id` must hold for
  // everything the filler touches; a legacy-spelled row then stays manual,
  // with no marker, exactly like a zero-declarer row.
  const instrumentRows = rows.filter(
    (r) => isInstrumentRowId(r.id) && isKnownInstrument(r.label) && instrumentSeatDef(r.label).id === r.id,
  );

  let previousColumnId: string | null = null;
  for (const column of weekend) {
    // Declarer count per row, through `rankCandidates` (never a direct read of
    // `instruments`): Tipo filter applied, `undeclared` computed. Rows with
    // zero declarers are skipped; the rest go thinnest pool first, then `rows`
    // order, so equal pools resolve deterministically.
    const candidateRows = instrumentRows
      .filter((row) => rowAppliesTo(row, column))
      .map((row, index) => ({
        row,
        index,
        declarers: rankCandidates({
          seat: seatDefForRow(row), date: column.date, members, windowRoles: [], assigned: [],
        }).filter((c) => !c.undeclared).length,
      }))
      .filter((x) => x.declarers > 0)
      .sort((a, b) => a.declarers - b.declarers || a.index - b.index);

    for (const { row } of candidateRows) {
      const existing = working.find((c) => c.columnId === column.columnId && c.rowId === row.id);
      if (existing && existing.occupants.length > 0) continue; // not empty — never touched

      // Re-ranked against `working`, the state as of THIS placement.
      const windowRoles = [...savedWindow, ...cellsToParticipantRoles(working, columns, members)];
      const assigned = assignedForColumn(working, rows, column.columnId);
      const pool = rankCandidates({
        seat: seatDefForRow(row), date: column.date, members, windowRoles, assigned, column, config,
      }).filter((c) => c.eligible && !c.undeclared);

      if (pool.length === 0) {
        unfilled.push({ columnId: column.columnId, rowId: row.id });
        continue;
      }

      const counts = seatCounts(working);
      const playedPrevious = previousColumnId ? instrumentalistsOn(working, previousColumnId) : new Set<string>();
      const pick = orderForFill(pool, counts, playedPrevious)[0];
      working = withAutoCell(working, column.columnId, row.id, [pick.id]);
    }
    previousColumnId = column.columnId;
  }

  return { cells: working, unfilled };
}

/**
 * The filler's ordering key (§6.2 step 3): fewest instrument seats this month
 * (per member, all rows), then did NOT play on the immediately previous weekend
 * column (the alternation), then `member_name` in Spanish collation. Decorated
 * with the incoming index so ties are broken explicitly, never by trusting the
 * engine's sort.
 */
export function orderForFill(
  pool: RankedCandidate[],
  counts: Map<string, number>,
  playedPrevious: Set<string>,
): RankedCandidate[] {
  return pool
    .map((c, i) => ({ c, i, count: counts.get(c.id) ?? 0, prev: playedPrevious.has(c.id) ? 1 : 0 }))
    .sort((a, b) => a.count - b.count || a.prev - b.prev || a.c.name.localeCompare(b.c.name, "es") || a.i - b.i)
    .map((x) => x.c);
}

/**
 * The render-time gate (§6.3), SCOPED to instrument rows: an instrument entry
 * whose cell now has an occupant (a human filled it after Auto) is dropped.
 * Voice and special entries are one per missing SLOT — a Coro with one of three
 * seated has two entries and a non-empty cell — so they pass through untouched.
 * The `unfilled` STATE and its merge rules are not modified; only what renders.
 */
export function renderableUnfilled(unfilled: Seat[], cells: GridCell[]): Seat[] {
  const occupied = new Set(
    cells.filter((c) => isInstrumentRowId(c.rowId) && c.occupants.length > 0).map((c) => `${c.columnId}|${c.rowId}`),
  );
  return unfilled.filter((u) => !(isInstrumentRowId(u.rowId) && occupied.has(`${u.columnId}|${u.rowId}`)));
}
