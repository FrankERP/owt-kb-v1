"use client";

// The month grid: dates across, seats down. Every cell is editable and Auto
// fills the voice rows via the existing solver. This component renders what
// `plannerModel` (Task 2) computes and decides nothing: `MonthGenerator`
// (Task 4) owns `cells`/`counts` state, the Auto fetch, and threading
// `previous` across calls — this component is fully controlled.
//
// Seven things adversarial review found broken in the surface this replaces,
// each pinned by a test in the sibling `__tests__/PlannerGrid.test.tsx`:
//
//  1. Ranking is TWO `rankCandidates` calls, merged (D12) — one supplies order
//     and `load` from `[...savedWindow, ...inGridDrafts]`, the other supplies
//     `recent` from `savedWindow` alone. A single concatenated call would make
//     `recent`'s `slice(-4)` return the grid's own future weeks.
//  2. Density differs by row kind (D7): solvable rows cap at `target` then a
//     focusable `+N` (never a `title` — the iOS build is a web wrap and
//     `title` never fires on touch); non-solvable rows always render every
//     occupant.
//  3. No cell ever refuses an occupant for reasons of count, and none ever
//     replaces one (D6) — replacement is what evicted a drummer in a shipped
//     bug. A manual pick still refuses a same-category double, exactly like
//     `SeatBoard`.
//  4. A Saturday column has no Coro row at all — gated by `rowAppliesTo`, not
//     just `isSolvable`.
//  5. Unchecking Domingos still enables Auto and renders no Sunday column.
//  6. `unaddressableDates` is a prop computed from `sundayDates`, never
//     derived here from `columns` (D9's columns can hold zero Sundays).
//  7. Auto has a failure and pending contract (D15) — the component does not
//     own the fetch (`onAuto` does), but it owns rendering `autoState`
//     honestly: pending, error, and disabled-with-reason.

import { useMemo, useState } from "react";

import {
  cellsToParticipantRoles,
  isSolvable,
  rowAppliesTo,
  seatDefForRow,
  type GridCell,
  type GridColumn,
  type GridRow,
} from "./plannerModel";
import {
  displayName,
  rankCandidates,
  type AssignedSeat,
  type RankedCandidate,
  type RankMember,
} from "./candidateRanking";
import {
  fohSeatDef,
  instrumentSeatDef,
  normalizeSeatName,
  type SeatCategory,
} from "./seatModel";
import type { ParticipantRole } from "@/app/utils/computeParticipation";
import type { TargetPreflight } from "./serviceReadiness";
import { CARD_STYLE, PREFLIGHT_COPY, TONE_CLASS, describePreflightReason } from "./serviceCardModel";

// `SolveDiagnostics` is not part of `plannerModel`'s exports (Task 2's scope
// was the wire translation, not presentation) — it is the narrow slice of
// `SolveResponse` this surface still owes the admin (fact 14, D15).
export interface SolveDiagnostics {
  fairness_relaxed?: boolean;
  sun_lead_fairness_relaxed?: boolean;
  sun_bgv_fairness_relaxed?: boolean;
  history_runs_used?: number;
}

export interface AutoState {
  pending: boolean;
  error: string | null;
  disabledReason: string | null;
}

export interface PlannerGridProps {
  rows: GridRow[];
  columns: GridColumn[];
  cells: GridCell[];
  members: RankMember[];
  /** D12: `recent` comes from this alone. */
  savedWindow: ParticipantRole[];
  preflightFor: (c: GridColumn) => TargetPreflight | null;
  /** By column date. */
  skipped: Set<string>;
  /**
   * Computed from `sundayDates`, NOT from `columns` — under D9 `columns` can
   * hold zero Sunday dates, and deriving this from `columns` would mark every
   * Saturday unaddressable.
   */
  unaddressableDates: string[];
  unresolvedNames: string[];
  /** `mapUnfilledSeats` output. */
  unfilled: { date: string; rowId: string }[];
  onCellsChange: (next: GridCell[]) => void;
  /** Add/remove instrument and FOH rows. */
  onRowsChange: (next: GridRow[]) => void;
  onToggleSkip: (date: string) => void;
  /** `MonthGenerator` owns the fetch; this component only asks for it. */
  onAuto: () => void;
  autoState: AutoState;
  diagnostics: SolveDiagnostics | null;
}

const cellKey = (date: string, rowId: string) => `${date}|${rowId}`;

function withUpdatedCell(cells: GridCell[], rowId: string, date: string, memberIds: string[]): GridCell[] {
  const idx = cells.findIndex((c) => c.date === date && c.rowId === rowId);
  if (idx === -1) {
    return [...cells, { date, rowId, memberIds, origin: "manual" }];
  }
  const next = [...cells];
  next[idx] = { ...next[idx], memberIds, origin: "manual" };
  return next;
}

function assignedForDate(cells: GridCell[], rows: GridRow[], date: string): AssignedSeat[] {
  const rowById = new Map(rows.map((r) => [r.id, r]));
  const out: AssignedSeat[] = [];
  for (const c of cells) {
    if (c.date !== date) continue;
    const row = rowById.get(c.rowId);
    if (!row) continue;
    for (const memberId of c.memberIds) out.push({ seatId: c.rowId, category: row.category, memberId });
  }
  return out;
}

/**
 * Same person, two different rows of the SAME category, on the same date.
 * `blockedReason` (`candidateRanking.ts:134-137`) only refuses this at manual
 * pick time — Auto is not a manual pick, so a hand-assigned Lead the solver
 * then places in BGV needs re-checking after every run. Cross-category
 * (voz + instrumento) double duty is legitimate and never flagged.
 */
function categoryDuplicatesForDate(cells: GridCell[], rows: GridRow[], date: string): Map<string, string[]> {
  const rowById = new Map(rows.map((r) => [r.id, r]));
  const byMember = new Map<string, { rowId: string; category: SeatCategory }[]>();
  for (const c of cells) {
    if (c.date !== date) continue;
    const row = rowById.get(c.rowId);
    if (!row) continue;
    for (const memberId of c.memberIds) {
      const list = byMember.get(memberId) ?? [];
      list.push({ rowId: c.rowId, category: row.category });
      byMember.set(memberId, list);
    }
  }
  const out = new Map<string, string[]>();
  for (const [memberId, entries] of byMember) {
    const byCategory = new Map<string, string[]>();
    for (const e of entries) {
      const list = byCategory.get(e.category) ?? [];
      list.push(e.rowId);
      byCategory.set(e.category, list);
    }
    for (const rowIds of byCategory.values()) {
      // ACCUMULATE, never overwrite: a member can be duplicated in two
      // categories on one date (Lead+BGV and Bass+Guitar). Assigning here would
      // keep only the last category's rows, silently un-flagging the other
      // duplicate — the very thing this function exists to catch.
      if (rowIds.length > 1) out.set(memberId, [...(out.get(memberId) ?? []), ...rowIds]);
    }
  }
  return out;
}

export default function PlannerGrid(props: PlannerGridProps) {
  const {
    rows,
    columns,
    cells,
    members,
    savedWindow,
    preflightFor,
    skipped,
    unaddressableDates,
    unresolvedNames,
    unfilled,
    onCellsChange,
    onRowsChange,
    onToggleSkip,
    onAuto,
    autoState,
    diagnostics,
  } = props;

  const [openCell, setOpenCell] = useState<{ rowId: string; date: string } | null>(null);
  const [confirmingAuto, setConfirmingAuto] = useState(false);
  const [removeError, setRemoveError] = useState<{ rowId: string; message: string } | null>(null);

  // Finding 5: `removeError` was never cleared by anything except a
  // SUCCESSFUL `removeRow` call, so "Vacía la fila antes de eliminarla"
  // could outlive the condition that produced it — e.g. Auto or a manual
  // pick empties the row through some path other than `removeRow` itself,
  // and the stale refusal message keeps showing next to a row that is now
  // actually empty. Derived at render time from the current `cells` (the
  // only thing the message's truth depends on) rather than reset via an
  // effect — the row it names may no longer even exist in `rows`, and the
  // effect approach also trips `react-hooks/set-state-in-effect`.
  const activeRemoveError =
    removeError && cells.some((c) => c.rowId === removeError.rowId && c.memberIds.length > 0)
      ? removeError
      : null;

  const membersById = useMemo(() => new Map(members.map((m) => [m._id, m])), [members]);
  const memberName = (id: string) => {
    const found = membersById.get(id);
    return found ? displayName(found) : id;
  };

  // D12: `inGridDrafts` — the whole grid's current occupancy, converted to the
  // shape `rankCandidates` consumes, so "assigned earlier in THIS grid" can be
  // read as load. Recomputed once per render, reused for every cell.
  const inGridRoles = useMemo(
    () => cellsToParticipantRoles(cells, columns, members),
    [cells, columns, members],
  );
  const unionRoles = useMemo(() => [...savedWindow, ...inGridRoles], [savedWindow, inGridRoles]);

  const cellsByKey = useMemo(() => {
    const map = new Map<string, GridCell>();
    for (const c of cells) map.set(cellKey(c.date, c.rowId), c);
    return map;
  }, [cells]);

  const unfilledByKey = useMemo(() => {
    const set = new Set<string>();
    for (const u of unfilled) set.add(cellKey(u.date, u.rowId));
    return set;
  }, [unfilled]);

  const unaddressableSet = useMemo(() => new Set(unaddressableDates), [unaddressableDates]);

  // Finding 4: `categoryDuplicatesForDate` scans every cell. Called once per
  // (row, column) pair — as it was via an inline prop callback — that's
  // ~rows×columns full scans per render. Computed once per distinct date
  // that actually holds a cell, keyed for O(1) lookup per (row, column) pair.
  const emptyDuplicates = useMemo(() => new Map<string, string[]>(), []);
  const duplicatesByDateMap = useMemo(() => {
    const map = new Map<string, Map<string, string[]>>();
    const dates = new Set(cells.map((c) => c.date));
    for (const date of dates) map.set(date, categoryDuplicatesForDate(cells, rows, date));
    return map;
  }, [cells, rows]);

  function rankFor(row: GridRow, date: string): RankedCandidate[] {
    const seat = seatDefForRow(row);
    const assigned = assignedForDate(cells, rows, date);
    const order = rankCandidates({ seat, date, members, windowRoles: unionRoles, assigned });
    const recentOnly = rankCandidates({ seat, date, members, windowRoles: savedWindow, assigned });
    const recentById = new Map(recentOnly.map((c) => [c.id, c.recent]));
    return order.map((c) => ({ ...c, recent: recentById.get(c.id) ?? c.recent }));
  }

  /**
   * The refusal message survives until an edit could plausibly resolve it.
   * `activeRemoveError` already hides it once the row empties, but the state
   * itself lingered — so emptying the row and then re-seating someone made the
   * message reappear without the user touching Eliminar again.
   */
  function clearRemoveError() {
    if (removeError) setRemoveError(null);
  }

  function toggleCandidate(row: GridRow, date: string, memberId: string, candidates: RankedCandidate[]) {
    clearRemoveError();
    const current = cellsByKey.get(cellKey(date, row.id))?.memberIds ?? [];
    const blocked = candidates.find((c) => c.id === memberId)?.blockedReason;
    if (blocked && !current.includes(memberId)) return; // refuse a same-category double (D6)
    const next = current.includes(memberId) ? current.filter((id) => id !== memberId) : [...current, memberId];
    onCellsChange(withUpdatedCell(cells, row.id, date, next));
  }

  function handleAutoClick() {
    if (autoState.disabledReason || autoState.pending) return;
    setConfirmingAuto(true);
  }

  function confirmAuto() {
    setConfirmingAuto(false);
    onAuto();
  }

  function removeRow(rowId: string) {
    const hasOccupants = cells.some((c) => c.rowId === rowId && c.memberIds.length > 0);
    if (hasOccupants) {
      setRemoveError({ rowId, message: "Vacía la fila antes de eliminarla." });
      return;
    }
    setRemoveError(null);
    onRowsChange(rows.filter((r) => r.id !== rowId));
  }

  function addInstrumentRow(raw: string): string | null {
    const name = normalizeSeatName(raw);
    if (!name) return null;
    if (rows.some((r) => r.category === "instrumento" && r.label.toLowerCase() === name.toLowerCase())) {
      return "Ya existe un puesto de instrumento con ese nombre.";
    }
    const def = instrumentSeatDef(name);
    onRowsChange([...rows, { id: def.id, label: def.label, category: def.category, target: 1 }]);
    return null;
  }

  function addFohRow(raw: string): string | null {
    const name = normalizeSeatName(raw);
    if (!name) return null;
    if (rows.some((r) => r.category === "foh" && r.label.toLowerCase() === name.toLowerCase())) {
      return "Ya existe un rol de FOH con ese nombre.";
    }
    const def = fohSeatDef(name);
    onRowsChange([...rows, { id: def.id, label: def.label, category: def.category, target: 1 }]);
    return null;
  }

  function copyRowAcrossDates(row: GridRow, sourceDate: string) {
    clearRemoveError();
    const sourceIds = cellsByKey.get(cellKey(sourceDate, row.id))?.memberIds ?? [];
    let next = cells;
    for (const col of columns) {
      if (col.date === sourceDate) continue;
      if (!rowAppliesTo(row, col)) continue;
      next = withUpdatedCell(next, row.id, col.date, sourceIds);
    }
    onCellsChange(next);
  }

  const openRow = openCell ? rows.find((r) => r.id === openCell.rowId) ?? null : null;
  const openCandidates = openCell && openRow ? rankFor(openRow, openCell.date) : [];

  return (
    <div className="space-y-4">
      {/* ── Auto controls ─────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={handleAutoClick}
          disabled={!!autoState.disabledReason || autoState.pending}
          className="min-h-[44px] rounded-lg bg-[#003572] px-4 font-label text-xs uppercase tracking-widest transition-colors hover:bg-[#003572]/80 disabled:opacity-50 dark:bg-[#00bfff]/20 dark:hover:bg-[#00bfff]/30"
        >
          {autoState.pending ? "Calculando..." : "🤖 Auto-asignar con Solver"}
        </button>
        {autoState.disabledReason && (
          <p className="font-body text-xs text-amber-400">{autoState.disabledReason}</p>
        )}
        {autoState.error && <p className="font-body text-xs text-red-400">{autoState.error}</p>}
      </div>

      {confirmingAuto && (
        <div className="space-y-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2">
          <p className="font-body text-xs text-amber-300">
            Esto reemplazará toda asignación de voz (Lead, BGV, Coro) que el solver pueda resolver en
            este mes. Las asignaciones manuales de instrumentos y FOH no se tocan.
            {unaddressableDates.length > 0 &&
              ` ${unaddressableDates.length} sábado(s) fuera del alcance de Auto no se tocarán.`}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={confirmAuto}
              className="min-h-[44px] rounded-lg bg-[#003572] px-3 font-label text-xs uppercase tracking-widest dark:bg-[#00bfff]/20"
            >
              Confirmar
            </button>
            <button
              type="button"
              onClick={() => setConfirmingAuto(false)}
              className="min-h-[44px] rounded-lg border border-[#00bfff]/20 px-3 font-label text-xs uppercase tracking-widest"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {diagnostics && (
        <div className="flex flex-wrap gap-2 font-label text-[11px] uppercase tracking-widest text-amber-400">
          {diagnostics.fairness_relaxed && <span>Equidad relajada</span>}
          {diagnostics.sun_lead_fairness_relaxed && <span>Equidad de líderes de domingo relajada</span>}
          {diagnostics.sun_bgv_fairness_relaxed && <span>Equidad de BGV de domingo relajada</span>}
          {typeof diagnostics.history_runs_used === "number" && (
            <span>Historial usado: {diagnostics.history_runs_used}</span>
          )}
        </div>
      )}

      {unresolvedNames.length > 0 && (
        <p className="font-body text-xs text-red-400">
          Nombres no reconocidos: {unresolvedNames.join(", ")}
        </p>
      )}

      {/* Today's honest short-staffing signal, alongside the degradation
          explainer — the solver degrades Coro -> BGV -> 2nd Lead, always
          keeping at least one Lead. */}
      <p className="font-body text-[11px] text-gray-500">
        El líder siempre se asigna; primero queda vacío el coro, luego BGV.
      </p>
      {unfilled.length > 0 && (
        <p className="font-body text-xs text-amber-400">
          Lugares sin cubrir (faltó gente): {unfilled.length}
        </p>
      )}

      {/* ── The grid — ONE scroller, both axes covered by min-w columns ──── */}
      <div className="overflow-x-auto">
        <div
          className="grid"
          style={{ gridTemplateColumns: `160px repeat(${columns.length}, minmax(150px, 1fr))` }}
        >
          <div className="min-w-[160px]" />
          {columns.map((column) => (
            <ColumnHeader
              key={column.date}
              column={column}
              preflight={preflightFor(column)}
              skipped={skipped.has(column.date)}
              unaddressable={unaddressableSet.has(column.date)}
              onToggleSkip={() => onToggleSkip(column.date)}
            />
          ))}

          {rows.map((row) => (
            <RowGroup
              key={row.id}
              row={row}
              columns={columns}
              cellsByKey={cellsByKey}
              unfilledByKey={unfilledByKey}
              duplicatesByDate={(date) => duplicatesByDateMap.get(date) ?? emptyDuplicates}
              memberName={memberName}
              onOpen={(date) => setOpenCell({ rowId: row.id, date })}
              onRemove={row.category !== "voz" ? () => removeRow(row.id) : undefined}
              removeError={activeRemoveError?.rowId === row.id ? activeRemoveError.message : null}
              onCopy={row.category !== "voz" ? (date) => copyRowAcrossDates(row, date) : undefined}
            />
          ))}
        </div>
      </div>

      {/* ── Add instrument / FOH rows ──────────────────────────────────────── */}
      <div className="flex flex-wrap gap-3">
        <AddRowForm placeholder="Nuevo instrumento" onAdd={addInstrumentRow} />
        <AddRowForm placeholder="Nuevo rol FOH" onAdd={addFohRow} />
      </div>

      {/* ── Candidate picker — sibling to the grid scroller, never nested ─── */}
      {openCell && openRow && (
        <div className={`${CARD_STYLE.dialog} rounded-xl border border-[#00bfff]/15 p-3`}>
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="font-label text-xs uppercase tracking-widest text-[#C8D8EB]/70">
              Candidatos para {openRow.label} — {openCell.date}
            </span>
            <button
              type="button"
              onClick={() => setOpenCell(null)}
              className="min-h-[44px] min-w-[44px] font-label text-xs uppercase tracking-widest text-[#C8D8EB]/60 hover:text-white"
            >
              Cerrar
            </button>
          </div>
          <ul className="max-h-[50vh] space-y-1.5 overflow-y-auto pr-1">
            {openCandidates.map((candidate) => (
              <CandidateRow
                key={candidate.id}
                candidate={candidate}
                selected={(cellsByKey.get(cellKey(openCell.date, openCell.rowId))?.memberIds ?? []).includes(
                  candidate.id,
                )}
                onToggle={(id) => toggleCandidate(openRow, openCell.date, id, openCandidates)}
              />
            ))}
            {openCandidates.length === 0 && (
              <li className="font-body text-xs italic text-gray-600">Nadie elegible para este puesto.</li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

// ── Column header ────────────────────────────────────────────────────────────

function ColumnHeader({
  column,
  preflight,
  skipped,
  unaddressable,
  onToggleSkip,
}: {
  column: GridColumn;
  preflight: TargetPreflight | null;
  skipped: boolean;
  unaddressable: boolean;
  onToggleSkip: () => void;
}) {
  const date = new Date(column.date.slice(0, 10) + "T12:00:00");
  const day = date.getDate();
  const month = date.toLocaleDateString("es-MX", { month: "short" });
  const typeLabel = column.type === "sunday_role" ? "Domingo" : "Sábado";

  return (
    <div className={`min-w-[150px] space-y-1 px-1 ${skipped ? "opacity-40" : ""}`}>
      <div className="flex items-center gap-1.5">
        <span className="font-display text-sm leading-none">{day}</span>
        <span className="font-label text-[10px] uppercase tracking-widest text-gray-500">{month}</span>
      </div>
      <span className="font-label text-[10px] uppercase tracking-widest text-gray-500">{typeLabel}</span>
      <label className="flex items-center gap-1 font-label text-[10px] uppercase tracking-widest text-gray-500">
        <input type="checkbox" checked={skipped} onChange={onToggleSkip} aria-label={`Omitir ${column.date}`} />
        Omitir
      </label>
      {preflight && (
        <div>
          <span
            className={`inline-flex rounded-full border px-1.5 py-0.5 font-label text-[10px] uppercase tracking-widest ${TONE_CLASS[PREFLIGHT_COPY[preflight.state].tone]}`}
          >
            {PREFLIGHT_COPY[preflight.state].text}
          </span>
          {preflight.state !== "creatable" && preflight.reasons.length > 0 && (
            <p className={`font-body text-[10px] text-gray-400 ${CARD_STYLE.longText}`}>
              {preflight.reasons.map(describePreflightReason).join(" · ")}
            </p>
          )}
        </div>
      )}
      {unaddressable && (
        <p className="font-label text-[10px] uppercase tracking-widest text-red-400">
          Fuera del alcance de Auto
        </p>
      )}
    </div>
  );
}

// ── Row + cells ───────────────────────────────────────────────────────────────

function RowGroup({
  row,
  columns,
  cellsByKey,
  unfilledByKey,
  duplicatesByDate,
  memberName,
  onOpen,
  onRemove,
  removeError,
  onCopy,
}: {
  row: GridRow;
  columns: GridColumn[];
  cellsByKey: Map<string, GridCell>;
  unfilledByKey: Set<string>;
  duplicatesByDate: (date: string) => Map<string, string[]>;
  memberName: (id: string) => string;
  onOpen: (date: string) => void;
  onRemove?: () => void;
  removeError: string | null;
  onCopy?: (date: string) => void;
}) {
  return (
    <>
      <div className="min-w-[160px] px-1 py-1">
        <div className="flex items-center gap-1.5">
          <span className="font-label text-xs uppercase tracking-widest text-[#C8D8EB]/70">{row.label}</span>
          {row.category !== "voz" && (
            <span className="font-label text-[9px] uppercase tracking-widest text-gray-500">
              asignación manual
            </span>
          )}
          {onRemove && (
            <button
              type="button"
              onClick={onRemove}
              aria-label={`Eliminar fila ${row.label}`}
              className="ml-auto font-label text-[10px] uppercase tracking-widest text-red-400/70 hover:text-red-400"
            >
              Eliminar
            </button>
          )}
        </div>
        {removeError && <p className="font-body text-[11px] text-red-400">{removeError}</p>}
      </div>
      {columns.map((column) => {
        if (!rowAppliesTo(row, column)) {
          return <div key={column.date} className="min-w-[150px]" />;
        }
        const cell = cellsByKey.get(cellKey(column.date, row.id));
        const memberIds = cell?.memberIds ?? [];
        const duplicates = duplicatesByDate(column.date);
        return (
          <GridCellView
            key={column.date}
            row={row}
            column={column}
            memberIds={memberIds}
            memberName={memberName}
            duplicates={duplicates}
            unfilled={unfilledByKey.has(cellKey(column.date, row.id))}
            onOpen={() => onOpen(column.date)}
            onCopy={onCopy ? () => onCopy(column.date) : undefined}
          />
        );
      })}
    </>
  );
}

function GridCellView({
  row,
  column,
  memberIds,
  memberName,
  duplicates,
  unfilled,
  onOpen,
  onCopy,
}: {
  row: GridRow;
  column: GridColumn;
  memberIds: string[];
  memberName: (id: string) => string;
  duplicates: Map<string, string[]>;
  unfilled: boolean;
  onOpen: () => void;
  onCopy?: () => void;
}) {
  const solvable = isSolvable(row, column);
  // D7: solvable rows cap at `target`, then a focusable `+N`. Non-solvable
  // rows always render every occupant and never show `+N` — two people on one
  // Drums seat is the normal case on 18 of 27 services, and `target: 1` is
  // not a real threshold there.
  const target = solvable ? row.target : null;
  const overflow = target != null && memberIds.length > target;
  const visibleIds = overflow ? memberIds.slice(0, target!) : memberIds;
  const hiddenIds = overflow ? memberIds.slice(target!) : [];
  const hiddenCount = hiddenIds.length;
  // Finding 2: the `⚠` used to apply only to `visibleIds`, so a duplicate
  // sitting in the hidden `+N` tail — exactly the over-target state `+N`
  // exists for — was never surfaced at all. Checked here regardless of
  // whether the occupant is currently visible.
  const hiddenHasDuplicate = hiddenIds.some((id) => duplicates.get(id)?.includes(row.id));

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      data-row-id={row.id}
      data-date={column.date}
      className={`min-h-[44px] min-w-[150px] cursor-pointer rounded-lg border px-2 py-1.5 transition-colors ${
        overflow ? "border-amber-500/40 bg-amber-500/5" : "border-[#00bfff]/15 hover:border-[#00bfff]/40"
      }`}
    >
      <div className="flex flex-wrap gap-1">
        {visibleIds.length === 0 && memberIds.length === 0 && (
          <span className="font-body text-[11px] italic text-gray-600">Sin asignar</span>
        )}
        {visibleIds.map((id) => {
          // Finding 1: `duplicates` is keyed by member alone across the whole
          // date, so a member flagged for a same-category conflict (e.g.
          // Lead+BGV) must NOT also light up on an unrelated row (e.g. Bass)
          // just because they happen to appear in `duplicates` at all —
          // legitimate cross-category double duty (voz + instrumento) is
          // real and must never be flagged. Only flag when THIS row's id is
          // among the rows that hold the duplicate.
          const isDuplicate = duplicates.get(id)?.includes(row.id) ?? false;
          return (
            <span
              key={id}
              className={`rounded-full border px-1.5 py-0.5 font-label text-[10px] text-[#C8D8EB] ${CARD_STYLE.longText} ${
                isDuplicate ? "border-red-500/50 bg-red-500/10" : "border-[#00bfff]/25 bg-[#00bfff]/10"
              }`}
            >
              {memberName(id)}
              {isDuplicate && " ⚠"}
            </span>
          );
        })}
        {overflow && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onOpen();
            }}
            aria-label={`Ver ${hiddenCount} más en ${row.label}`}
            className={`rounded-full border px-1.5 py-0.5 font-label text-[10px] ${
              hiddenHasDuplicate
                ? "border-red-500/50 bg-red-500/10 text-red-400"
                : "border-amber-500/40 bg-amber-500/10 text-amber-400"
            }`}
          >
            +{hiddenCount}
            {hiddenHasDuplicate && " ⚠"}
          </button>
        )}
      </div>
      {/* Finding 6: the brief says a solvable cell over target "warns and
          still accepts" — an amber border alone carries no words, so make
          the warning legible as Spanish text, not just a color. */}
      {overflow && (
        <p className="font-label text-[9px] uppercase tracking-widest text-amber-400">
          Por encima del objetivo — se acepta de todos modos
        </p>
      )}
      {unfilled && (
        <p className="font-label text-[9px] uppercase tracking-widest text-amber-400">Sin cubrir</p>
      )}
      {onCopy && memberIds.length > 0 && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onCopy();
          }}
          className="mt-1 font-label text-[9px] uppercase tracking-widest text-[#C8D8EB]/40 hover:text-[#C8D8EB]/70"
        >
          Copiar a todo el mes
        </button>
      )}
    </div>
  );
}

// ── Candidate picker row (mirrors SeatBoard's RosterRow) ─────────────────────

function CandidateRow({
  candidate,
  selected,
  onToggle,
}: {
  candidate: RankedCandidate;
  selected: boolean;
  onToggle: (id: string) => void;
}) {
  const blocked = !!candidate.blockedReason;
  return (
    <li
      role="button"
      tabIndex={blocked ? -1 : 0}
      aria-disabled={blocked ? "true" : undefined}
      title={candidate.blockedReason ?? undefined}
      onClick={() => {
        if (!blocked) onToggle(candidate.id);
      }}
      onKeyDown={(e) => {
        if (blocked) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onToggle(candidate.id);
        }
      }}
      className={`min-h-[44px] min-w-0 rounded-lg border px-3 py-2 transition-colors ${
        blocked
          ? "cursor-not-allowed border-red-500/20 bg-red-500/5 opacity-60"
          : selected
            ? "cursor-pointer border-[#00bfff] bg-[#00bfff]/10"
            : "cursor-pointer border-[#00bfff]/15 hover:border-[#00bfff]/40"
      }`}
    >
      <div className="flex min-w-0 items-center justify-between gap-2">
        <span className={`font-body text-sm ${CARD_STYLE.longText}`}>{candidate.name}</span>
        <div className="flex shrink-0 items-center gap-1.5">
          {!candidate.available && (
            <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 font-label text-[10px] uppercase tracking-wide text-amber-400">
              No disp.
            </span>
          )}
          {candidate.alreadyAssigned && (
            <span className="rounded-full border border-gray-500/40 bg-gray-500/10 px-1.5 py-0.5 font-label text-[10px] uppercase tracking-wide text-gray-300">
              Ya asignado
            </span>
          )}
        </div>
      </div>
      <div className="mt-1 flex items-center gap-2">
        <div className="flex gap-0.5" aria-hidden="true">
          {candidate.recent.map((served, i) => (
            <span key={i} className={`h-1.5 w-3 rounded-sm ${served ? "bg-[#00bfff]/70" : "bg-gray-700"}`} />
          ))}
        </div>
        <span className="font-label text-[10px] text-gray-500">{candidate.load}</span>
      </div>
      {blocked && <p className="mt-1 font-body text-[11px] text-red-400">{candidate.blockedReason}</p>}
    </li>
  );
}

// ── Add row form (mirrors SeatBoard's AddSeatForm) ───────────────────────────

function AddRowForm({
  placeholder,
  onAdd,
}: {
  placeholder: string;
  onAdd: (name: string) => string | null;
}) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const rejected = onAdd(value);
        setError(rejected);
        if (!rejected) setValue("");
      }}
      className="flex flex-col gap-1"
    >
      <div className="flex gap-1.5">
        <input
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            if (error) setError(null);
          }}
          placeholder={placeholder}
          className="min-h-[44px] flex-1 rounded-lg border border-[#00bfff]/20 bg-transparent px-3 py-2 font-body text-xs focus:border-[#00bfff] focus:outline-none"
        />
        <button
          type="submit"
          className="shrink-0 rounded-lg border border-[#00bfff]/20 px-3 font-label text-xs uppercase tracking-widest text-[#C8D8EB]/70 hover:border-[#00bfff]"
        >
          Añadir
        </button>
      </div>
      {error && <p className="font-body text-[11px] text-red-400">{error}</p>}
    </form>
  );
}
