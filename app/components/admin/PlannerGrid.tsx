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
//     just solvability. (A special DOES have one — E18.)
//  5. Unchecking Domingos still enables Auto and renders no Sunday column.
//  6. `unaddressableDates` is a prop computed from `sundayDates`, never
//     derived here from `columns` (D9's columns can hold zero Sundays).
//  7. Auto has a failure and pending contract (D15) — the component does not
//     own the fetch (`onAuto` does), but it owns rendering `autoState`
//     honestly: pending, error, and disabled-with-reason.

import { useMemo, useState } from "react";

import {
  assignedForDate,
  cellsToParticipantRoles,
  hasTarget,
  rowAppliesTo,
  seatDefForRow,
  type GridCell,
  type GridColumn,
  type GridRow,
  type SolverConfig,
} from "./plannerModel";
import { ruleViolationsForColumn, violationKey, type SeatedViolation } from "./ruleEnforcement";
import {
  displayName,
  rankCandidates,
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
import {
  CARD_STYLE,
  PREFLIGHT_COPY,
  SERVICE_LABEL,
  TONE_CLASS,
  describePreflightReason,
} from "./serviceCardModel";

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
  /**
   * E17: why this column will NOT be created, when the reason is not the
   * admin's own "Omitir" toggle — `"existing"` (a stored service already
   * occupies this exact target, name included for a special) or `"created"`
   * (this generator session already created it). `null` when it is creatable
   * as far as this channel knows.
   *
   * Neither reason is derivable here. `preflightFor` cannot see them (its
   * special branch is name-blind and reports `creatable` for a date that
   * already holds that same special), and `skipped` never contains them. Before
   * this prop the header lied twice on a special that already existed: the
   * checkbox rendered unchecked and the badge read "Se puede crear", while
   * `handleConfirm` quietly posted nothing.
   */
  createBlockFor: (c: GridColumn) => "existing" | "created" | null;
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
  /**
   * The admin's solver rules (E6). **Optional and, until Task 8, never passed** —
   * without it `rankCandidates` leaves `ruleBlockedReason` null for everyone and
   * this surface behaves exactly as it shipped.
   *
   * It may arrive with `conflicts`/`presence` `undefined` despite the type: see
   * `ruleEnforcement`'s `ruleLists`. Nothing here may iterate it directly.
   */
  config?: SolverConfig;
  /**
   * The month's FULL Sunday spine, positional and 1-based — `sundayDatesFull`,
   * never the admin's selection (E21). Week exclusions are the only rules that
   * need it; without it they are simply not evaluated.
   */
  sundayDates?: string[];
}

const cellKey = (date: string, rowId: string) => `${date}|${rowId}`;

/**
 * Writes `memberIds` into one cell, and keeps `overrides` (P10) honest:
 * an id no longer seated cannot stay overridden, so removing a member clears
 * their entry — the alternative is a stale exception that would silence E13's
 * re-flag if the same person were ever seated here again.
 *
 * `addOverride` is the ONLY way an entry is created, and it is reachable from
 * exactly one place: the picker's secondary "Asignar de todos modos" action.
 * It carries the RULE that was waived, not just the person: the two fields are
 * written and pruned together here, so `overrideReasons` can never outlive the
 * seating it describes. See `GridCell.overrideReasons`.
 */
function withUpdatedCell(
  cells: GridCell[],
  rowId: string,
  date: string,
  memberIds: string[],
  addOverride?: { memberId: string; reason: string },
): GridCell[] {
  const idx = cells.findIndex((c) => c.date === date && c.rowId === rowId);
  const seated = new Set(memberIds);
  const prior = idx === -1 ? [] : (cells[idx].overrides ?? []);
  const priorReasons = idx === -1 ? {} : (cells[idx].overrideReasons ?? {});
  const kept = prior.filter((id) => seated.has(id));
  const add =
    addOverride && seated.has(addOverride.memberId) && !kept.includes(addOverride.memberId)
      ? addOverride
      : null;
  const overrides = add ? [...kept, add.memberId] : kept;
  const overrideReasons: Record<string, string> = {};
  for (const id of overrides) {
    const reason = id === add?.memberId ? add.reason : priorReasons[id];
    if (reason !== undefined) overrideReasons[id] = reason;
  }
  if (idx === -1) {
    return [...cells, { date, rowId, memberIds, origin: "manual", overrides, overrideReasons }];
  }
  const next = [...cells];
  next[idx] = { ...next[idx], memberIds, origin: "manual", overrides, overrideReasons };
  return next;
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
    createBlockFor,
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
    config,
    sundayDates,
  } = props;

  const [openCell, setOpenCell] = useState<{ rowId: string; date: string } | null>(null);
  // D-defect-3: candidate ORDER only, captured the moment a cell opens. Each
  // row's own live state (load, recent strip, `Ya asignado`, blocked reason,
  // selected) still comes from a fresh `rankFor` every render — only the
  // sequence the ids are rendered in is pinned. Without this, picking someone
  // changes their `load` (and can change `alreadyAssigned`), which changes
  // `rankCandidates`' sort key, so the row you just clicked — and everyone
  // around it — jumps to a different position under the cursor. Cleared on
  // close so reopening (even the same cell) recomputes the order fresh.
  const [openOrder, setOpenOrder] = useState<string[] | null>(null);
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

  const columnByDate = useMemo(() => new Map(columns.map((c) => [c.date, c])), [columns]);

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

  /** Whether Auto will run the LOCAL filler at all (E5) — see the confirm copy. */
  const hasSpecialColumn = useMemo(
    () => columns.some((c) => c.type === "special_role"),
    [columns],
  );

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

  /**
   * E13 — the rules re-checked against everyone ALREADY SEATED, every render,
   * per column. Not "after Auto": a re-check wired to the Auto handler would
   * miss a rule edited after the month was seated, and would miss a config that
   * changed while the grid was open. Computed from `cells` + `config`, so it is
   * a function of what is on screen and cannot fall out of date.
   *
   * `evaluate` alone cannot answer this — it exempts a cell's own occupants so
   * a violating pair can be un-seated (E6's trap). `ruleViolationsForColumn`
   * re-asks with the occupant's own seat removed.
   */
  const emptyViolations = useMemo(() => new Map<string, SeatedViolation>(), []);
  const violationsByDate = useMemo(() => {
    const map = new Map<string, Map<string, SeatedViolation>>();
    if (!config) return map;
    // P10's record, read straight off the cells — the only reader there is.
    // Keyed BY DATE as well as by `violationKey`: an override is a decision
    // about one seating on one day, and a map shared across the month would let
    // overriding Gaby on the 12th silently sanction her on the 19th too. The
    // VALUE is the rule that was waived, so it cannot sanction a rule added or
    // edited since either — see `ruleViolationsForColumn`.
    const overriddenByDate = new Map<string, Map<string, string>>();
    for (const c of cells) {
      for (const id of c.overrides ?? []) {
        const reason = c.overrideReasons?.[id];
        if (reason === undefined) continue;
        const map = overriddenByDate.get(c.date) ?? new Map<string, string>();
        map.set(violationKey(c.rowId, id), reason);
        overriddenByDate.set(c.date, map);
      }
    }
    for (const column of columns) {
      const found = ruleViolationsForColumn({
        column,
        rows,
        assigned: assignedForDate(cells, rows, column.date),
        members,
        sundayDates,
        config,
        overridden: overriddenByDate.get(column.date),
      });
      if (found.size > 0) map.set(column.date, found);
    }
    return map;
  }, [cells, rows, columns, members, sundayDates, config]);

  function rankFor(row: GridRow, date: string): RankedCandidate[] {
    const seat = seatDefForRow(row);
    const assigned = assignedForDate(cells, rows, date);
    // At most one column per date (E3), so the date identifies the column.
    // Passed to BOTH calls: the merge below keeps only `recent` from the second,
    // so its verdict is discarded and cannot disagree — but a later change to
    // what the merge keeps would make a divergence here a real hazard.
    const column = columnByDate.get(date);
    const order = rankCandidates({
      seat,
      date,
      members,
      windowRoles: unionRoles,
      assigned,
      column,
      sundayDates,
      config,
    });
    const recentOnly = rankCandidates({
      seat,
      date,
      members,
      windowRoles: savedWindow,
      assigned,
      column,
      sundayDates,
      config,
    });
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

  /**
   * The manual pick, and both of its refusals.
   *
   * TWO predicates, read separately and never merged into one: `blockedReason`
   * is D6's same-category double, `ruleBlockedReason` is E6's hard solver rule.
   * They carry different copy and only one of them is overridable, so the
   * picker has to keep them apart.
   *
   * **`eligible` is deliberately NOT read here.** It is the FILLER's composite
   * (`candidateRanking.ts`) and folds in `available`, which for a human is a
   * documented `+10` sort penalty and never a block (fact 19). Reading it would
   * turn "marked this date unavailable" into a hard refusal on a shipped
   * surface — a change nobody asked for, dressed as rule enforcement.
   *
   * On REMOVING, neither predicate applies: a rule refuses adding, never
   * un-seating, or a violating pair the solver produced could not be undone.
   *
   * **Both refusals below are backstops, not the enforcement.** `CandidateRow`
   * blocks its own `onClick`/`onKeyDown`, so neither line is reachable through
   * the UI — verified by mutation: deleting BOTH of them together fails no
   * test, while neutering `CandidateRow`'s `blocked` fails six. They are kept
   * because this function is the single write path into a cell and the cost is
   * two lines; the line that must never be weakened is `CandidateRow`'s
   * `blocked`, which is also what renders `aria-disabled` and the red state.
   */
  function toggleCandidate(row: GridRow, date: string, memberId: string, candidates: RankedCandidate[]) {
    clearRemoveError();
    const current = cellsByKey.get(cellKey(date, row.id))?.memberIds ?? [];
    if (current.includes(memberId)) {
      onCellsChange(withUpdatedCell(cells, row.id, date, current.filter((id) => id !== memberId)));
      return;
    }
    const candidate = candidates.find((c) => c.id === memberId);
    if (candidate?.blockedReason) return; // refuse a same-category double (D6)
    if (candidate?.ruleBlockedReason) return; // refuse a hard rule (E6) — see `overrideCandidate`
    onCellsChange(withUpdatedCell(cells, row.id, date, [...current, memberId]));
  }

  /**
   * P10 — seat a RULE-blocked member anyway, deliberately, and record it.
   *
   * A SECOND, separate interaction: the candidate row itself stays inert while
   * blocked (`CandidateRow` guards `onClick` and `onKeyDown` on `!blocked`), so
   * this cannot be reached by the mis-click that would otherwise seat exactly
   * the pair the admin wrote a rule to keep apart.
   *
   * Only ever a RULE block. D6's same-category double is not overridable — that
   * refusal is a shipped invariant on two surfaces, and a person in two voice
   * seats of one service is a data error, not a judgement call.
   *
   * The waived rule is recorded WITH the seating, from the same
   * `ruleBlockedReason` the admin just read on the row — an override sanctions
   * that rule and no other (see `ruleViolationsForColumn`).
   *
   * **The auto-filler has no path here.** `fillColumn` neither calls this nor
   * reads `overrides`; a person may make a deliberate exception, the automation
   * may not. That asymmetry is the requirement, not an implementation detail.
   */
  function overrideCandidate(row: GridRow, date: string, memberId: string, candidates: RankedCandidate[]) {
    clearRemoveError();
    const candidate = candidates.find((c) => c.id === memberId);
    if (!candidate?.ruleBlockedReason) return;
    if (candidate.blockedReason) return;
    const current = cellsByKey.get(cellKey(date, row.id))?.memberIds ?? [];
    // A BACKSTOP, not the enforcement. Nobody already seated here can reach this
    // line: `evaluate` exempts a cell's own occupants outright (E6/P9,
    // `ruleEnforcement.ts`'s self-exemption), so their `ruleBlockedReason` is
    // `null` and the guard above has already returned. Deleting this line fails
    // no test. It is kept because "an override adds a seat" is what the line
    // below assumes, and re-stating it costs one line.
    if (current.includes(memberId)) return;
    onCellsChange(
      withUpdatedCell(cells, row.id, date, [...current, memberId], {
        memberId,
        reason: candidate.ruleBlockedReason,
      }),
    );
  }

  /** Opens the picker and freezes the candidate ORDER as of right now. */
  function openPicker(row: GridRow, date: string) {
    setOpenOrder(rankFor(row, date).map((c) => c.id));
    setOpenCell({ rowId: row.id, date });
  }

  function closePicker() {
    setOpenCell(null);
    setOpenOrder(null);
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
  // Live data (load, recent, alreadyAssigned, blockedReason, selected all
  // stay current) — only the SEQUENCE is pinned to `openOrder`, captured once
  // by `openPicker` when the cell was opened. Ids `rankFor` returns that
  // aren't in `openOrder` (shouldn't happen — the candidate pool for a given
  // row/date doesn't change while it's open) sort after everything frozen,
  // stably, rather than disappearing.
  const liveCandidates = openCell && openRow ? rankFor(openRow, openCell.date) : [];
  const openCandidates = openOrder
    ? [...liveCandidates].sort((a, b) => {
        const ia = openOrder.indexOf(a.id);
        const ib = openOrder.indexOf(b.id);
        if (ia === -1 && ib === -1) return 0;
        if (ia === -1) return 1;
        if (ib === -1) return -1;
        return ia - ib;
      })
    : liveCandidates;

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
          {/* E5: a special never goes to the solver, so its fill is a DIFFERENT
              mechanism and has to be named as one — greedy, local, rules-first,
              and it only completes what is missing instead of replacing. Said
              here rather than on the button because this is where the admin is
              told what Auto is about to do. */}
          {hasSpecialColumn && (
            <p className="font-body text-xs text-amber-300">
              Los servicios especiales no pasan por el solver: se completan aquí mismo, solo Lead y
              BGV, respetando las reglas duras (nunca juntan a quienes una regla separa) y
              equilibrando la carga. Lo ya asignado a mano se conserva; si no queda nadie elegible,
              el lugar se deja vacío y se marca «Sin cubrir».
            </p>
          )}
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
          style={{ gridTemplateColumns: `minmax(176px, max-content) repeat(${columns.length}, minmax(150px, 1fr))` }}
        >
          <div className="min-w-[176px]" />
          {columns.map((column) => (
            <ColumnHeader
              key={column.date}
              column={column}
              preflight={preflightFor(column)}
              createBlock={createBlockFor(column)}
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
              violationsByDate={(date) => violationsByDate.get(date) ?? emptyViolations}
              memberName={memberName}
              onOpen={(date) => openPicker(row, date)}
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
              onClick={closePicker}
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
                onOverride={(id) => overrideCandidate(openRow, openCell.date, id, openCandidates)}
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

/**
 * Spanish reasons for the two states `createBlockFor` reports. Named per
 * column TYPE for `"existing"` because "ya existe un servicio especial con ese
 * nombre" is a different fact from "ya existe un servicio ese día": a second,
 * differently-named special on the same date IS creatable, and copy that said
 * otherwise would send the admin looking for a conflict that isn't there.
 */
const CREATE_BLOCK_COPY = {
  created: "Ya lo creaste en esta sesión.",
  existingSpecial: "Ya existe un servicio especial con este nombre en esta fecha.",
  existingWeekend: "Ya existe un servicio en esta fecha.",
} as const;

function ColumnHeader({
  column,
  preflight,
  createBlock,
  skipped,
  unaddressable,
  onToggleSkip,
}: {
  column: GridColumn;
  preflight: TargetPreflight | null;
  createBlock: "existing" | "created" | null;
  skipped: boolean;
  unaddressable: boolean;
  onToggleSkip: () => void;
}) {
  const date = new Date(column.date.slice(0, 10) + "T12:00:00");
  const day = date.getDate();
  const month = date.toLocaleDateString("es-MX", { month: "short" });
  // The shared `Record<ServiceType, string>` — not a third hardcoded ternary.
  // The old one read "Sábado" on every special column.
  const typeLabel = SERVICE_LABEL[column.type];
  const blockCopy =
    createBlock === "created"
      ? CREATE_BLOCK_COPY.created
      : createBlock === "existing"
        ? column.type === "special_role"
          ? CREATE_BLOCK_COPY.existingSpecial
          : CREATE_BLOCK_COPY.existingWeekend
        : null;

  return (
    <div className={`min-w-[150px] space-y-1 px-1 ${skipped || blockCopy ? "opacity-40" : ""}`}>
      <div className="flex items-center gap-1.5">
        <span className="font-display text-sm leading-none">{day}</span>
        <span className="font-label text-[10px] uppercase tracking-widest text-gray-500">{month}</span>
      </div>
      <span className="font-label text-[10px] uppercase tracking-widest text-gray-500">{typeLabel}</span>
      {/* E6/E18 — a special is identified by date AND name (`special_role:date:name`),
          and two differently-named specials can share a date. Without the name
          on screen the two columns are indistinguishable, and the header's own
          "ya existe un servicio especial con este nombre" copy points at a name
          the admin cannot see. Weekend columns carry no `serviceName` at all. */}
      {column.serviceName && (
        <span className={`block font-body text-[11px] text-[#C8D8EB]/80 ${CARD_STYLE.longText}`}>
          {column.serviceName}
        </span>
      )}
      {/* A blocked column is skipped whatever the toggle says, so the checkbox
          shows it as skipped and refuses the toggle instead of offering an
          un-skip that changes nothing. */}
      <label className="flex items-center gap-1 font-label text-[10px] uppercase tracking-widest text-gray-500">
        <input
          type="checkbox"
          checked={skipped || blockCopy !== null}
          disabled={blockCopy !== null}
          onChange={onToggleSkip}
          aria-label={`Omitir ${column.date}`}
        />
        Omitir
      </label>
      {blockCopy && (
        <p className={`font-body text-[10px] text-amber-400 ${CARD_STYLE.longText}`}>{blockCopy}</p>
      )}
      {/* Suppressed while blocked: the preflight's special branch is name-blind,
          so its badge would read "Se puede crear" right beside the reason this
          column will not be created. A genuinely blocked/unknown preflight
          still has something to say and is rendered below. */}
      {preflight && !(blockCopy && preflight.state === "creatable") && (
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
  violationsByDate,
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
  /** E13, by `violationKey(rowId, memberId)` — that date's whole column. */
  violationsByDate: (date: string) => Map<string, SeatedViolation>;
  memberName: (id: string) => string;
  onOpen: (date: string) => void;
  onRemove?: () => void;
  removeError: string | null;
  onCopy?: (date: string) => void;
}) {
  return (
    <>
      {/*
        D-defect-2: the label, "asignación manual" tag, and Eliminar used to
        share one `flex items-center` line with Eliminar pushed via
        `ml-auto` — for long labels (BASS, CONSOLE) the three pieces
        exceeded 160px and Eliminar spilled into the first grid cell. Each
        piece now gets its own line so none of them can compete for the
        same horizontal space; the column track itself grows to fit the
        longest label instead of clipping (`minmax(176px, max-content)`
        above). The accessible name (`Eliminar fila {label}`) is unchanged.
      */}
      <div className="min-w-[176px] px-1 py-1">
        <div className="flex flex-col items-start gap-0.5">
          <span className="font-label text-xs uppercase tracking-widest text-[#C8D8EB]/70 break-words">
            {row.label}
          </span>
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
              className="font-label text-[10px] uppercase tracking-widest text-red-400/70 hover:text-red-400"
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
            violations={violationsByDate(column.date)}
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
  violations,
  unfilled,
  onOpen,
  onCopy,
}: {
  row: GridRow;
  column: GridColumn;
  memberIds: string[];
  memberName: (id: string) => string;
  duplicates: Map<string, string[]>;
  violations: Map<string, SeatedViolation>;
  unfilled: boolean;
  onOpen: () => void;
  onCopy?: () => void;
}) {
  // D7: rows that CARRY a target cap at it, then a focusable `+N`. Rows that
  // do not always render every occupant and never show `+N` — two people on
  // one Drums seat is the normal case on 18 of 27 services, and `target: 1` is
  // not a real threshold there.
  //
  // Gated on `hasTarget`, NOT on `isSolvable`: the two agree on every weekend
  // column, but a special is deliberately unsolvable (E4/E5) while still being
  // a voice row with a real target. Reading `isSolvable` here would silently
  // drop both the cap and the amber `+N` on every special column.
  const target = hasTarget(row, column) ? row.target : null;
  const overflow = target != null && memberIds.length > target;
  const visibleIds = overflow ? memberIds.slice(0, target!) : memberIds;
  const hiddenIds = overflow ? memberIds.slice(target!) : [];
  const hiddenCount = hiddenIds.length;
  // Finding 2: the `⚠` used to apply only to `visibleIds`, so a duplicate
  // sitting in the hidden `+N` tail — exactly the over-target state `+N`
  // exists for — was never surfaced at all. Checked here regardless of
  // whether the occupant is currently visible.
  const hiddenHasDuplicate = hiddenIds.some((id) => duplicates.get(id)?.includes(row.id));

  // E13 + P10, split. A violation the admin overrode renders as a NAMED
  // exception; one they did not renders as a refusal still to be fixed. Both are
  // computed over every occupant, `+N`'s hidden tail included — the same
  // Finding-2 hole the duplicate flag once had.
  const ruleOf = (id: string) => violations.get(violationKey(row.id, id)) ?? null;
  const seatedRules = memberIds
    .map((id) => ({ id, v: ruleOf(id) }))
    .filter((x): x is { id: string; v: SeatedViolation } => x.v !== null);
  const flagged = seatedRules.filter((x) => !x.v.overridden);
  const overridden = seatedRules.filter((x) => x.v.overridden);
  const hiddenHasViolation = hiddenIds.some((id) => ruleOf(id)?.overridden === false);

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
          const ruleBroken = ruleOf(id)?.overridden === false;
          return (
            <span
              key={id}
              className={`rounded-full border px-1.5 py-0.5 font-label text-[10px] text-[#C8D8EB] ${CARD_STYLE.longText} ${
                isDuplicate || ruleBroken
                  ? "border-red-500/50 bg-red-500/10"
                  : "border-[#00bfff]/25 bg-[#00bfff]/10"
              }`}
            >
              {memberName(id)}
              {(isDuplicate || ruleBroken) && " ⚠"}
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
              hiddenHasDuplicate || hiddenHasViolation
                ? "border-red-500/50 bg-red-500/10 text-red-400"
                : "border-amber-500/40 bg-amber-500/10 text-amber-400"
            }`}
          >
            +{hiddenCount}
            {(hiddenHasDuplicate || hiddenHasViolation) && " ⚠"}
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
      {/* E13 — a seated person a hard rule now refuses. Named in words, not just
          a red border: the admin has to know WHICH rule to go and look at, and
          the fix (open the cell, toggle them off) is only obvious once they do.
          `evaluate`'s self-exemption is what keeps that toggle-off possible. */}
      {flagged.map((x) => (
        <p key={x.id} className={`font-body text-[9px] text-red-400 ${CARD_STYLE.longText}`}>
          ⚠ {memberName(x.id)}: {x.v.reason}
        </p>
      ))}
      {/* P10 — the persistent marker. An override is a deliberate exception, so
          E13 stops re-flagging it; this is what keeps it VISIBLE rather than
          silent, and it names the rule that was set aside. */}
      {overridden.map((x) => (
        <p key={x.id} className={`font-body text-[9px] text-amber-400 ${CARD_STYLE.longText}`}>
          Regla anulada — {memberName(x.id)}: {x.v.reason}
        </p>
      ))}
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
  onOverride,
}: {
  candidate: RankedCandidate;
  selected: boolean;
  onToggle: (id: string) => void;
  /** P10 — seat this rule-blocked candidate anyway. */
  onOverride: (id: string) => void;
}) {
  // TWO refusals, read as two predicates and never as `eligible` (which folds
  // in availability and belongs to the filler alone — see `toggleCandidate`).
  const blocked = !!candidate.blockedReason || !!candidate.ruleBlockedReason;
  // Only a RULE block is overridable: a same-category double is a data error,
  // not a judgement call.
  //
  // `!selected` is a BACKSTOP, not the enforcement. A seated member is exempted
  // by `evaluate` itself (E6/P9's self-exemption in `ruleEnforcement.ts`), so
  // their `ruleBlockedReason` is already `null` and this expression is already
  // false — deleting `!selected` fails no test. What actually keeps a rule hard
  // is `blocked` below: neutering it fails six. `!selected` stays as a local
  // statement of intent, one term wide.
  const overridable = !!candidate.ruleBlockedReason && !candidate.blockedReason && !selected;
  return (
    <li
      role="button"
      tabIndex={blocked ? -1 : 0}
      aria-disabled={blocked ? "true" : undefined}
      title={candidate.blockedReason ?? candidate.ruleBlockedReason ?? undefined}
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
      {candidate.blockedReason && (
        <p className="mt-1 font-body text-[11px] text-red-400">{candidate.blockedReason}</p>
      )}
      {candidate.ruleBlockedReason && (
        <p className="mt-1 font-body text-[11px] text-red-400">{candidate.ruleBlockedReason}</p>
      )}
      {/*
        P10 — the override, as a SEPARATE, secondary action.

        The row above stays inert while blocked, so this button is the only way
        to seat a rule-blocked person: two distinct interactions, and neither
        one is the mis-click that seats exactly the pair a rule exists to keep
        apart. `stopPropagation` is belt-and-braces (the row's own handler
        already returns early while blocked) — it keeps the button working if
        that guard is ever loosened, instead of firing both paths.

        Only a human reaches this. `fillColumn` has no path to it at all.
      */}
      {overridable && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onOverride(candidate.id);
          }}
          className="mt-1.5 min-h-[44px] w-full rounded-lg border border-amber-500/40 px-2 font-label text-[10px] uppercase tracking-widest text-amber-400 hover:bg-amber-500/10"
        >
          Asignar de todos modos
        </button>
      )}
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
