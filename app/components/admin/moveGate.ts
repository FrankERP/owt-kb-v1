// T3 of the grid drag-and-drop plan
// (docs/superpowers/plans/2026-08-06-grid-drag-and-drop.md) — the JUDGEMENT half
// of a move. `moveOccupant` (T2) performs one; this decides whether it may be
// performed at all, and on what terms. Exported and UNCALLED in production here;
// T4 (pointer drag) and T5 (pick-then-place) compose gate-then-primitive.
//
// One verdict per proposed move: `not-permitted` (P1–P3, nothing was even
// evaluated), `clean`, `refused` (C1, C2, C3 — never forceable, DD2) or `prompt`
// (C4, the only forceable one, DD3).
//
// ─── The evaluation input is the whole thing ─────────────────────────────────
//
// All four constraints are judged against ONE list, `assignedAfterSourceRemoval`:
// the TARGET column's occupancy, with the source removal applied (a no-op across
// columns), and with the member NOT yet placed at the target seat.
//
// **Pre-placement, never post-move.** `blockingReasons` returns `[]` the moment
// `assigned` holds the member at `row.id` (`ruleEnforcement.ts:351` — the E6/P9
// self-exemption for the cell being edited). Hand this gate post-move state and
// every rule passes: C4 could never fire, the force/desist prompt would be
// unreachable, and rule-violating pairings would seat with no override recorded.
// That is the single most likely way to implement this and get a feature that
// looks like it works, so `moveGate.test.ts`'s acceptance-6 case is written to
// fail under exactly that mutation (and under dropping the target `column`).
//
// ─── One entry point for the reuse ───────────────────────────────────────────
//
// C2, C3 and C4 all come from ONE `rankCandidates` call. `blockedReason`, the
// `memberType` filter and the `evaluate` call live inline inside its `.map()`
// (`candidateRanking.ts:184-215`) and none is separately exported; calling it
// once with `assigned: assignedAfterSourceRemoval` yields all three at parity
// with the picker BY CONSTRUCTION. Re-implementing any of them here would fork
// the source of truth — the exact thing this module exists to prevent — so
// nothing below re-derives a predicate.
import { rankCandidates, type AssignedSeat, type RankMember } from "./candidateRanking";
import type { MoveOccupantEndpoint, MoveOccupantSource } from "./moveOccupant";
import {
  assignedForColumn,
  rowAppliesTo,
  seatDefForRow,
  type GridCell,
  type GridColumn,
  type GridRow,
  type SolverConfig,
} from "./plannerModel";
import type { SeatDef } from "./seatModel";
import { serializeStoredColumn } from "./plannerSaveModel";
import type { StoredGridColumn } from "./storedRoleReadModel";

export type MoveGateMode = "create" | "stored";

/** P1–P3, plus `unresolved` for a move whose endpoints do not exist. */
export type NotPermittedCode = "P1" | "P2" | "P3" | "unresolved";

/**
 * The three non-forceable refusals (DD2), plus the second cause of absence from
 * `rankCandidates`' output: a member id that is not in `members` at all. Only
 * the `memberType` cause is reported with C3's wording — the other one is not a
 * statement about eligibility, it is a statement about the caller's ids.
 */
export type RefusedCode = "C1" | "C2" | "C3" | "unknown-member";

export type MoveGateVerdict =
  | { kind: "not-permitted"; code: NotPermittedCode; reason: string }
  | { kind: "clean" }
  | { kind: "refused"; code: RefusedCode; reason: string }
  | {
      kind: "prompt";
      code: "C4";
      /** The rule's own Spanish wording, as `evaluate` gave it. */
      reason: string;
      /**
       * What T4/T5 must hand `moveOccupant` on FORCE, and the only sanctioned
       * way to build it. `moveOccupant`'s `addOverride` is
       * `withUpdatedCell`'s directive, whose `memberId` is not type-narrowed to
       * the dragged member — a caller assembling it by hand could record the
       * waiver against somebody else, or against a different rule than the one
       * the admin was shown. Returning it pre-built removes that freedom.
       */
      addOverride: { memberId: string; reason: string };
    };

/** `PlannerGrid`'s own copy for a blocked interaction (`PlannerGrid.tsx:880`). */
const LOCKED_REASON = "Espera a que termine la operación pendiente.";
const NOT_SERIALIZABLE_REASON = "No se puede editar este servicio.";
const NOT_CREATABLE_REASON = "Esta columna no se va a crear.";
const ALREADY_HERE_REASON = "Ya está en esta casilla";
const UNKNOWN_MEMBER_REASON = "Miembro desconocido";
const UNRESOLVED_REASON = "Movimiento no reconocido.";

interface MoveGateInputBase {
  cells: GridCell[];
  rows: GridRow[];
  columns: GridColumn[];
  members: RankMember[];
  source: MoveOccupantSource;
  target: MoveOccupantEndpoint;
  /** P1 — `mutationLocked`/`storedMutationLocked`. */
  mutationLocked?: boolean;
  /** The month's FULL Sunday spine (E21) — week exclusions only. */
  sundayDates?: string[];
  /** Threaded for the TARGET column, matching `PlannerGrid.tsx:544`. */
  sundayDatesForColumn?: (column: GridColumn) => string[];
  config?: SolverConfig;
}

export interface CreateModeGateInput extends MoveGateInputBase {
  mode: "create";
  /**
   * P3 — create mode only, and the TARGET side only: dragging OUT of a column
   * that will never be written is legitimate (the removal is discarded, the add
   * lands on a real column).
   *
   * **REQUIRED, and required at the type level on purpose.** P3 is the one
   * precondition whose absence loses data rather than merely permitting a bad
   * edit: the removal lands on a column that IS created and the add on one that
   * is not, so the person disappears from the month in one gesture. An optional
   * predicate would make that failure silent — no test, no type error, no
   * runtime signal that P3 was skipped — so the caller must say, even if what it
   * says is `() => true`.
   *
   * Injected rather than computed here, because the authority is
   * `MonthGenerator`'s `isCreatable` (`MonthGenerator.tsx:2056-2060`): it reads
   * `createdTargets` (a ref) and the A1/A2 preflight snapshot, neither of which
   * is derivable from `columns`/`cells`. Re-deriving it here would create the
   * SECOND definition P3 exists to prevent, so the one definition stays in
   * `MonthGenerator` and is threaded down. What T4 must wire:
   *
   * ```ts
   * canReceive={(column) => {
   *   const draft = drafts.find(
   *     (d) => draftTargetKey(d._type, d.date) === draftTargetKey(column.type, column.date),
   *   );
   *   return draft !== undefined && isCreatable(draft);
   * }}
   * ```
   */
  canReceive: (column: GridColumn) => boolean;
}

export interface StoredModeGateInput extends MoveGateInputBase {
  mode: "stored";
  /** No P3 in stored mode: every column is a document that already exists. */
  canReceive?: never;
}

export type MoveGateInput = CreateModeGateInput | StoredModeGateInput;

/**
 * P2 — may this column be touched at all?
 *
 * Stored mode only, and stated as `serializeStoredColumn(...).ok` rather than an
 * `admission === "readOnly"` string check: the serializer also rejects
 * `hidden_saturday_chorus`, `invalid_special_name`, `invalid_write_label`,
 * `missing_lead|bgv|coro` and `invalid_occupant` (`plannerSaveModel.ts:65-100`),
 * and ANY touched column that fails poisons Guardar for the whole month behind
 * "Corrige los datos inválidos antes de guardar" — advice the admin cannot act
 * on. Same cost as the string check, no gap.
 *
 * Fails closed when a stored-mode column carries no stored identity: without
 * `roleId`/`rev`/`admission` there is nothing to serialize, and answering "yes"
 * there would be a guess.
 */
export function canTouchColumn(input: {
  mode: MoveGateMode;
  column: GridColumn;
  rows: GridRow[];
  cells: GridCell[];
}): boolean {
  if (input.mode !== "stored") return true;
  const stored = asStoredColumn(input.column);
  if (!stored) return false;
  // `GridRow` is assignable to `StoredGridRow` (its `writeLabel` is optional),
  // and in stored mode the rows carry one at runtime — so the serializer sees
  // exactly the labels a save would write, with no cast and no second shape.
  return serializeStoredColumn(stored, input.rows, input.cells).ok;
}

function asStoredColumn(column: GridColumn): StoredGridColumn | null {
  const candidate = column as Partial<StoredGridColumn>;
  return typeof candidate.roleId === "string" &&
    typeof candidate.rev === "string" &&
    typeof candidate.admission === "string"
    ? (column as StoredGridColumn)
    : null;
}

/**
 * THE list every constraint but C1 is judged against.
 *
 * The target column's seats, with exactly ONE copy of the dragged member dropped
 * from the source seat when source and target share a column (DD10 — a member
 * seated twice in one cell loses one assignment per drag, never both). Follows
 * `reasonsFor`'s one-copy-drop precedent (`ruleEnforcement.ts:512-525`) rather
 * than re-deriving it, and reuses `assignedForColumn` so the seat shape and the
 * unknown-row rule are the picker's, not a second copy.
 *
 * The dragged member is NOT added at the target seat. See this module's header
 * for what happens if they are.
 */
export function assignedAfterSourceRemoval(input: {
  cells: GridCell[];
  rows: GridRow[];
  source: MoveOccupantSource;
  targetColumnId: string;
}): AssignedSeat[] {
  const { cells, rows, source, targetColumnId } = input;
  const assigned = assignedForColumn(cells, rows, targetColumnId);
  if (source.columnId !== targetColumnId) return assigned;
  let dropped = false;
  return assigned.filter((seat) => {
    if (dropped) return true;
    if (seat.seatId === source.rowId && seat.memberId === source.memberId) {
      dropped = true;
      return false;
    }
    return true;
  });
}

/**
 * Judges one proposed move. Pure; changes nothing.
 *
 * Order is fixed and load-bearing: preconditions before any constraint (a
 * failing endpoint means nothing is evaluated at all), then C1 against the
 * target cell PRE-removal, then C3 (an absence, not a value), then C2, then C4.
 * C2 before C4 mirrors the picker, which refuses `blockedReason` before it
 * offers an override for `ruleBlockedReason` (`PlannerGrid.tsx:617-618`, `:653`)
 * — a same-category double must never be handed a force path (DD2).
 */
export function evaluateMove(input: MoveGateInput): MoveGateVerdict {
  const { mode, cells, rows, columns, members, source, target, config } = input;

  // P1 — `handleCellsChange` drops the write silently while locked
  // (`MonthGenerator.tsx:2117`), so the drop would appear to succeed and revert.
  if (input.mutationLocked) return { kind: "not-permitted", code: "P1", reason: LOCKED_REASON };

  const sourceColumn = columns.find((c) => c.columnId === source.columnId);
  const targetColumn = columns.find((c) => c.columnId === target.columnId);
  const targetRow = rows.find((r) => r.id === target.rowId);
  if (!sourceColumn || !targetColumn || !targetRow) return unresolved();
  // A row this column does not show is not a cell — `PlannerGrid.tsx:1574`
  // renders a blank spacer for it, so nothing there can be a drop zone. Stated
  // here as well because P2 CANNOT catch it: `serializeStoredColumn` judges the
  // column as it is NOW, so a stored Saturday would pass P2 and only produce
  // `hidden_saturday_chorus` after the drop had already landed — poisoning
  // Guardar for the whole month, which is the exact harm P2 exists to avoid.
  if (!rowAppliesTo(targetRow, targetColumn)) return unresolved();
  // Nothing to move. `moveOccupant` degrades to a no-op here; the gate says so
  // rather than letting a stale drag produce a "clean" verdict.
  const sourceCell = cells.find((c) => c.rowId === source.rowId && c.columnId === source.columnId);
  if (!sourceCell?.occupants.some((o) => o.memberId === source.memberId)) return unresolved();

  // P2 — BOTH endpoints. Touching a column the serializer rejects marks it
  // changed and disables Guardar for the entire month.
  if (
    !canTouchColumn({ mode, column: sourceColumn, rows, cells }) ||
    !canTouchColumn({ mode, column: targetColumn, rows, cells })
  ) {
    return { kind: "not-permitted", code: "P2", reason: NOT_SERIALIZABLE_REASON };
  }

  // P3 — DROP side only. Because a drag is a MOVE, dropping into a column that
  // is never created lands the removal on a column that IS created and the add
  // on one that is not: the person vanishes from the month in one gesture.
  if (input.mode === "create" && !input.canReceive(targetColumn)) {
    return { kind: "not-permitted", code: "P3", reason: NOT_CREATABLE_REASON };
  }

  // C1 — against the target cell PRE-removal, deliberately not against
  // `assignedAfterSourceRemoval`: on the post-removal list a self-drop with a
  // single copy would not fire. Refusing (rather than moving-as-no-op) is the
  // point — removing them from the source would silently delete an assignment
  // nobody asked to drop.
  const targetCell = cells.find((c) => c.rowId === target.rowId && c.columnId === target.columnId);
  if (targetCell?.occupants.some((o) => o.memberId === source.memberId)) {
    return { kind: "refused", code: "C1", reason: ALREADY_HERE_REASON };
  }

  // TWO ID SPACES, and the removal above belongs to the first. Stored
  // instrument/FOH rows are keyed with `normalizeLabel` (case-preserving) while
  // `seatDefForRow` rebuilds with `normalizeSeatName` (canonicalizing), so a
  // stored `"bass"` gives row `instrumento:bass` and seat `instrumento:Bass`.
  // `assignedForColumn` keys seats by the CELL's `rowId`, which is why
  // `assignedAfterSourceRemoval` matches on `source.rowId` and never on a seat
  // id: matching on the seat id would silently remove nothing on exactly those
  // rows, and the move would then be refused as a same-category double.
  // `seatDefForRow` THROWS on a row it cannot recognise (a `voz` row whose id is
  // not one of `VOICE_SEATS`). The picker meets that during a render, where a
  // throw is loud; this gate runs inside a pointer handler, where it would break
  // the drag with nothing caught and nothing said. A gate that cannot describe
  // the target seat cannot judge the move, so it refuses instead.
  const seat = seatDefForRowOrNull(targetRow);
  if (!seat) return unresolved();
  const assigned = assignedAfterSourceRemoval({ cells, rows, source, targetColumnId: target.columnId });
  const ranked = rankCandidates({
    seat,
    date: targetColumn.date,
    members,
    // `[]` ON PURPOSE, and it is not a shortcut worth "fixing" back to
    // `unionRoles`: `windowRoles` feeds ONLY `load` and the `recent` strip
    // (`candidateRanking.ts:156-168`), which order the picker's list. None of
    // the four constraints reads either, while `computeParticipation` over the
    // whole grid is the expensive half of the call and this runs per drag.
    windowRoles: [],
    assigned,
    // WITHOUT THIS the gate passes everything: no pattern's service half can be
    // matched, so every rule is out of scope and `ruleBlockedReason` stays
    // `null` (`candidateRanking.ts:105-110`). A second route to the same dead
    // gate as post-move state.
    column: targetColumn,
    sundayDates: input.sundayDatesForColumn?.(targetColumn) ?? input.sundayDates,
    config,
  });

  // C3 — AN ABSENCE, NOT A VALUE. The `memberType` filter runs before the
  // `.map()` (`candidateRanking.ts:185`), so an ineligible member has no row at
  // all and `rows.find(...)?.blockedReason` would read `undefined` — i.e. clean.
  // Absent from the output ⇒ refuse. Absence has two causes and both refuse;
  // only the `memberType` one is C3.
  const row = ranked.find((c) => c.id === source.memberId);
  if (!row) {
    return members.some((m) => m._id === source.memberId)
      ? {
          kind: "refused",
          code: "C3",
          reason: `No puede ocupar ${seat.label}: requiere tipo ${seat.memberType}`,
        }
      : { kind: "refused", code: "unknown-member", reason: UNKNOWN_MEMBER_REASON };
  }

  // C2 — the picker's own wording, and a data error rather than a judgement
  // call (`PlannerGrid.tsx:1803-1804`): never forceable.
  if (row.blockedReason) return { kind: "refused", code: "C2", reason: row.blockedReason };

  // C4 — the only forceable constraint (DD2/DD3).
  if (row.ruleBlockedReason) {
    return {
      kind: "prompt",
      code: "C4",
      reason: row.ruleBlockedReason,
      addOverride: { memberId: source.memberId, reason: row.ruleBlockedReason },
    };
  }

  // Unavailability is deliberately NOT a fifth constraint — it is a `+10` sort
  // penalty in the picker, never a block (`PlannerGrid.tsx:588-594`). Acceptance
  // 11 (T4) surfaces it as a non-blocking note at the drop.
  return CLEAN;
}

/**
 * One shared object, so a clean verdict is referentially stable for a memo —
 * and frozen, because it is shared: a caller that annotated the verdict it got
 * back (T4's unavailability note, say) would otherwise annotate every clean
 * verdict the module has ever returned.
 */
const CLEAN: MoveGateVerdict = Object.freeze({ kind: "clean" as const });

function unresolved(): MoveGateVerdict {
  return { kind: "not-permitted", code: "unresolved", reason: UNRESOLVED_REASON };
}

function seatDefForRowOrNull(row: GridRow): SeatDef | null {
  try {
    return seatDefForRow(row);
  } catch {
    return null;
  }
}

/**
 * `evaluateMove`, memoized per (source, target cell, dragged member) for as long
 * as nothing it reads has changed.
 *
 * Required by the plan, not an optimisation added for taste: `rankCandidates`
 * runs one `evaluate` per member per call, and a drag fires `dragover`
 * continuously over one cell. Gate on `dragenter`/`drop` and this cache makes
 * the repeat calls free; gate on `dragover` without it and the grid does that
 * work dozens of times a second.
 *
 * The cache is dropped WHOLE the moment any input identity changes — `cells`
 * above all, so a forced move can never be applied against a verdict computed
 * from a grid that has since moved. Reference equality only: every one of these
 * is a React prop or state value that is replaced, not mutated, on change.
 */
export function createMoveGate(): (input: MoveGateInput) => MoveGateVerdict {
  let deps: unknown[] | null = null;
  let cache = new Map<string, MoveGateVerdict>();
  return (input) => {
    const next: unknown[] = [
      input.mode,
      input.cells,
      input.rows,
      input.columns,
      input.members,
      input.mutationLocked ?? false,
      input.canReceive,
      input.sundayDates,
      input.sundayDatesForColumn,
      input.config,
    ];
    if (!deps || next.some((value, i) => value !== deps![i])) {
      deps = next;
      cache = new Map();
    }
    const key = `${input.source.columnId}|${input.source.rowId}|${input.source.memberId}>${input.target.columnId}|${input.target.rowId}`;
    const hit = cache.get(key);
    if (hit) return hit;
    const verdict = evaluateMove(input);
    cache.set(key, verdict);
    return verdict;
  };
}
