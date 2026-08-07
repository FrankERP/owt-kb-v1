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
//     bug, on 18 services running two drummers on one Drums seat. A manual pick
//     still refuses a same-category double.
//  4. A Saturday column has no Coro row at all — gated by `rowAppliesTo`, not
//     just solvability. (A special DOES have one — E18.)
//  5. Unchecking Domingos still enables Auto and renders no Sunday column.
//  6. `unaddressableDates` is a prop computed from `sundayDates`, never
//     derived here from `columns` (D9's columns can hold zero Sundays).
//  7. Auto has a failure and pending contract (D15) — the component does not
//     own the fetch (`onAuto` does), but it owns rendering `autoState`
//     honestly: pending, error, and disabled-with-reason.
//
// ── The three-column workspace, and the trade it makes ──────────────────────
//
// Participaciones on the left, the grid in the middle, the candidate picker on
// the right. All three are IN FLOW: the rail used to be `position: fixed` in
// the page's empty gutter so it cost the grid nothing, and at 1512 logical (a
// 14" MacBook Pro) there is no gutter — the admin's own machine never showed
// it. Taking real width from the grid at every size, on every machine, is the
// deliberate trade that replaces it. The gutter placement is gone entirely —
// the component that owned it was retired with the Tablero, and the WebKit
// paint bug it worked around is recorded at the full-screen portal below, which
// is the last `position: fixed` thing here and inherits the same problem.
//
// The layout is FLEX, not a grid template, for one reason: the DOM order is
// centre → picker → participation (so a phone stacks grid, then candidates,
// then the chart, exactly as this surface stacked before), and `xl:order-*`
// puts them left-to-right only once there is room. Below `xl` (1280px) nothing
// is side by side and the layout is the stacked one that shipped.
//
// The widths at 1512, measured rather than budgeted — see
// `.brand-admin-frame` / `.brand-admin-shell` in `app/brand.css`, which the
// `planner-wide` marker on this component's root widens through `:has()`:
//   1512 viewport − 24 frame padding − 2 shell border − 24 shell padding
//     = 1462 usable
//   216 (Participaciones) + 12 + 982 (grid) + 12 + 240 (picker) = 1462
// The picker's 240px is only spent while a cell is ACTIVE; with none open the
// grid gets it back and runs at 1234.
//
// **216 is a FLOOR, not a preference** — `CHART_COLUMN_WIDTH` below, now the
// only place it is declared. It shipped at
// 190 for one release and the count column printed itself on top of the bar:
// `ParticipationSidebar`'s member row is a hard 150px INLINE bar (it cannot
// shrink) + a 10px gap + a 24px count column, inside 12px of padding and a 1px
// border either side, plus the 2px right padding of the `overflow-y-auto`
// scroller the rows actually live in — 212px before the count starts
// overlapping the bar, and the `flex-1 min-w-0` name block shrinks around the
// bar rather than clipping it, so nothing overflows the box to give it away.
// Measured in Chromium at 1512 inside the real shell: at 190 the bar's right
// edge is x=163 and the count column starts at x=151 (a 12px overlap, on every
// member row); at 216 the count starts at x=177 and clears by 14px.
// `participationAlongside.test.tsx` re-derives that floor from
// `ParticipationSidebar`'s own source, so widening the bar or the count column
// fails there instead of on the admin's screen.
//
// Two consequences that are features, not oversights:
//  • The grid SCROLLS horizontally rather than squeezing its columns — the date
//    track keeps its `minmax(150px, 1fr)` floor and the row-label column is
//    `position: sticky`, so the seat you are reading never leaves the screen.
//  • "Pantalla completa" exists because none of that fits a whole month at
//    once, and a screenshot of the whole month is a real need. It portals this
//    surface to `document.body`, drops both side panels, and switches the date
//    track to `minmax(0, 1fr)` so N columns divide the viewport instead of
//    overflowing it.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

import {
  assignedForColumn,
  cellsToParticipantRoles,
  hasTarget,
  reconcileOccupants,
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
import CueDialog from "../ui/CueDialog";
// T4 of the drag-and-drop plan. `moveOccupant` imports `withUpdatedCell` back
// out of this file, so these two modules are a cycle — a deliberate one: T2's
// whole point is that the move composes THIS file's single write helper twice
// rather than mutating cells itself. Both sides are hoisted function
// declarations used only at event time, so nothing is read during module
// evaluation.
import { moveOccupant, type MoveOccupantEndpoint, type MoveOccupantSource } from "./moveOccupant";
import {
  canTouchColumn,
  createMoveGate,
  type MoveGateInput,
  type MoveGateVerdict,
} from "./moveGate";

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
  mode?: "create" | "stored";
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
  /**
   * P3 of the drag gate — may an occupant be DROPPED into this column?
   *
   * **Required, and required in both modes on purpose.** It is forwarded
   * verbatim to `moveGate`'s `CreateModeGateInput.canReceive`, which is required
   * there for the same reason: P3 is the one precondition whose absence loses
   * data rather than merely permitting a bad edit — the removal lands on a
   * column that IS created and the add on one that is not, so the person
   * disappears from the month in one gesture, with no type error and no runtime
   * signal that the check was skipped.
   *
   * This component cannot compute it. The authority is `isDraftCreatable`
   * (`MonthGenerator.tsx`), which reads the session's `createdTargets` ref and
   * the A1/A2 preflight snapshot — neither derivable from `columns`/`cells`, and
   * neither reaching here through `skipped` (the admin's toggle alone) or
   * `createBlockFor` (which answers a different question, and only for the
   * header's copy). Stored mode never consults it: every stored column is a
   * document that already exists.
   */
  canReceive: (c: GridColumn) => boolean;
  /** By opaque column id. */
  skipped: Set<string>;
  /**
   * Computed from `sundayDates`, NOT from `columns` — under D9 `columns` can
   * hold zero Sunday dates, and deriving this from `columns` would mark every
   * Saturday unaddressable.
   */
  unaddressableDates: string[];
  unresolvedNames: string[];
  /** `mapUnfilledSeats` output. */
  unfilled: { columnId: string; rowId: string }[];
  onCellsChange: (next: GridCell[]) => void;
  /** Add/remove instrument and FOH rows. */
  onRowsChange: (next: GridRow[]) => void;
  onToggleSkip: (columnId: string) => void;
  onStoredHeaderChange?: (columnId: string, patch: { date?: string; serviceName?: string }) => void;
  storedDateBlockedReason?: string | null;
  /** Prevent every stored-grid mutation while another stored mutation is unresolved. */
  mutationLocked?: boolean;
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
  sundayDatesForColumn?: (column: GridColumn) => string[];
  /**
   * The left column's contents — `ParticipationSidebar`, built and fed by
   * `MonthGenerator` (the counts are a function of ITS state, and nothing about
   * what is counted moved here).
   *
   * A `ReactNode` rather than the roles themselves, so this component owns the
   * three widths and none of the arithmetic. Omitted, the left column is not
   * rendered at all and the grid takes its 216px — which is what every
   * `PlannerGrid` unit test does.
   */
  participation?: ReactNode;
  /** Named on the full-screen bar, where the page's own month header is gone. */
  monthLabel?: string;
}

/**
 * The left column's width — the number the layout arithmetic in this file's
 * header is stated in, and a FLOOR derived from `ParticipationSidebar`'s widest
 * row rather than a design preference. See the header.
 *
 * Exported because `xl:w-[216px]` is a Tailwind literal that cannot be built
 * from a constant at runtime (the JIT only sees whole class names in the
 * source), so the constant and the rendered class can drift. The test that
 * re-derives the floor from `ParticipationSidebar` pins THIS number, and a
 * second test pins the rendered literal against it.
 *
 * **This is now the ONLY declaration of the chart's width.** A retired gutter
 * rail held a second copy, and the guard that kept the two equal went with it.
 * 216 shipped at 190 for one release and the count column printed itself on top
 * of the bar on every member row; the floor is derived from
 * `ParticipationSidebar`'s widest row — a 150px inline bar that cannot shrink,
 * a 10px gap, a 24px count column, 12px padding either side, a 1px border
 * either side and the scroller's 2px right padding, 212px in total, measured in
 * a real browser rather than read off the source. If either of the sidebar's
 * two rows grows past this, the test fails rather than someone's screen.
 */
export const CHART_COLUMN_WIDTH = 216;

/** The right column's width, spent only while a cell is active. */
export const PICKER_COLUMN_WIDTH = 240;

const cellKey = (columnId: string, rowId: string) => `${columnId}|${rowId}`;

/**
 * A service date as the admin reads it — "6 sep". Pinned to LOCAL NOON, never
 * `new Date(iso)`: a bare parse of a `YYYY-MM-DD` is UTC midnight and prints the
 * day before in America/Mexico_City.
 */
const shortDate = (iso: string) =>
  new Date(iso.slice(0, 10) + "T12:00:00").toLocaleDateString("es-MX", {
    day: "numeric",
    month: "short",
  });

/**
 * Controls whose own Escape means something, so the capture-phase listener does
 * not steal it. Text entry (revert / dismiss the completion popup) and a
 * `<select>` (close the dropdown) — never a checkbox, a radio or a button,
 * which have no Escape behaviour to lose.
 */
const NON_TEXT_INPUT_TYPES = new Set(["checkbox", "radio", "button", "submit", "reset", "image", "range", "color"]);

function ownsEscape(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag !== "INPUT") return false;
  return !NON_TEXT_INPUT_TYPES.has((target as HTMLInputElement).type);
}

/**
 * Everything inside the full-screen overlay a Tab can land on. Deliberately NOT
 * filtered by visibility: `offsetParent`/`getClientRects` are the only ways to
 * ask, both are meaningless in jsdom (which would leave the list empty and the
 * trap untested), and nothing in that surface is rendered-but-hidden.
 */
const FOCUSABLE_SELECTOR =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

// ── Drag and drop (T4) ───────────────────────────────────────────────────────
//
// DD7 (no swap by drag), DD8 (no touch drag) and DD9 (no edge auto-scroll) are
// recorded in ADR-0012 — read it before "fixing" any of the three.
//
// **HTML5 drag, not pointer events**, and that choice carries DD8 for free.
// `SetlistEditor.tsx:335-339` and `ProposalEditor.tsx:151-167` are both HTML5
// (`draggable` + `onDragStart`/`onDragOver`/`onDrop`/`onDragEnd`), so this is
// the idiom the repo already reads and reviews; and `dragstart` simply never
// fires from a touch, which is exactly the desktop-only scope DD8 asks for —
// with pointer events the touch case would have to be excluded by hand, and a
// half-lifted chip that fights the grid's horizontal scroll is precisely what
// DD8 rules out. T5's pick-then-place is what serves touch. The native drag also
// scrolls nothing on its own, so DD9 (no edge auto-scroll) costs nothing here.
//
// Nothing marks whole rows or columns as valid targets: validity is computed
// LAZILY, at the hovered cell and again at the drop. Marking every cell during a
// drag would be one `rankCandidates` call per cell — ~100 on a ten-column month
// — per `dragover`.

/** A non-blocking line under the grid: a refusal, or acceptance 11's note. */
interface DragNotice {
  tone: "refusal" | "note";
  message: string;
}

/**
 * A C4 move the admin has been asked about and has not yet answered.
 *
 * It deliberately holds NO `cells` snapshot. See `forcePendingMove` for what it
 * does instead and why.
 */
interface PendingMove {
  source: MoveOccupantSource;
  target: MoveOccupantEndpoint;
  /** The rule's own wording, as the gate reported it when the drop landed. */
  reason: string;
  memberName: string;
}

/**
 * DD12 — an occupant MARKED as the source of a move, waiting for a target.
 *
 * The pick-then-place trigger (T5), and the reason it exists: `dragstart` never
 * fires from a touch and a 20px chip is not a 44px touch target, so without this
 * the whole iOS wrap — and every keyboard — would be locked out of a move.
 *
 * It is a SELECTION, not a half-applied edit: nothing is written while one is
 * held, and it holds no verdict either. The target is judged when the admin
 * activates one, by the same `judgeMove` the drag calls.
 */
interface PickedMove {
  source: MoveOccupantSource;
  memberName: string;
  /** Seat and date the pick was made from, for the banner. */
  fromLabel: string;
}

/** Everything a cell and its chips need to take part in a pick-then-place. */
interface CellPickHandlers {
  /** The occupant currently marked, or `null`. */
  source: MoveOccupantSource | null;
  /** Their name, for the "place here" wording — `null` when nothing is marked. */
  memberName: string | null;
  /** P1, mirroring `CellDragHandlers.enabled`. */
  enabled: boolean;
  onPickOccupant: (source: MoveOccupantSource) => void;
  onPlace: (target: MoveOccupantEndpoint) => void;
}

/** Everything a cell and its chips need to take part in a drag. */
interface CellDragHandlers {
  /** P1, the one precondition cheap enough to answer per render. */
  enabled: boolean;
  source: MoveOccupantSource | null;
  activeDropKey: string | null;
  onOccupantDragStart: (event: ReactDragEvent, source: MoveOccupantSource) => void;
  onOccupantDragEnd: () => void;
  onCellDragOver: (event: ReactDragEvent, target: MoveOccupantEndpoint) => void;
  onCellDragLeave: (target: MoveOccupantEndpoint) => void;
  onCellDrop: (event: ReactDragEvent, target: MoveOccupantEndpoint) => void;
}

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
export function withUpdatedCell(
  cells: GridCell[],
  rowId: string,
  columnId: string,
  memberIds: string[],
  addOverride?: { memberId: string; reason: string },
): GridCell[] {
  const idx = cells.findIndex((c) => c.columnId === columnId && c.rowId === rowId);
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
    return [
      ...cells,
      {
        columnId,
        rowId,
        occupants: reconcileOccupants([], memberIds),
        origin: "manual" as const,
        overrides,
        overrideReasons,
      },
    ];
  }
  const next = [...cells];
  next[idx] = {
    ...next[idx],
    occupants: reconcileOccupants(next[idx].occupants, memberIds),
    origin: "manual",
    overrides,
    overrideReasons,
  };
  return next;
}

/**
 * Same person, two different rows of the SAME category, on the same date.
 * `blockedReason` (`candidateRanking.ts:134-137`) only refuses this at manual
 * pick time — Auto is not a manual pick, so a hand-assigned Lead the solver
 * then places in BGV needs re-checking after every run. Cross-category
 * (voz + instrumento) double duty is legitimate and never flagged.
 */
function categoryDuplicatesForColumn(
  cells: GridCell[],
  rows: GridRow[],
  columnId: string,
): Map<string, string[]> {
  const rowById = new Map(rows.map((r) => [r.id, r]));
  const byMember = new Map<string, { rowId: string; category: SeatCategory }[]>();
  for (const c of cells) {
    if (c.columnId !== columnId) continue;
    const row = rowById.get(c.rowId);
    if (!row) continue;
    for (const { memberId } of c.occupants) {
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
    mode = "create",
    rows,
    columns,
    cells,
    members,
    savedWindow,
    preflightFor,
    createBlockFor,
    canReceive,
    skipped,
    unaddressableDates,
    unresolvedNames,
    unfilled,
    onCellsChange,
    onRowsChange,
    onToggleSkip,
    onStoredHeaderChange,
    storedDateBlockedReason,
    mutationLocked = false,
    onAuto,
    autoState,
    diagnostics,
    config,
    sundayDates,
    sundayDatesForColumn,
    participation,
    monthLabel,
  } = props;

  const [openCell, setOpenCell] = useState<{ rowId: string; columnId: string } | null>(null);
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
  const [fullScreen, setFullScreen] = useState(false);
  // ── Drag state (T4) ────────────────────────────────────────────────────────
  // The occupant currently being dragged, or `null`. Held in state rather than
  // in `dataTransfer` for the reason both shipped drags in this repo do
  // (`SetlistEditor.tsx:335-339`, `ProposalEditor.tsx:151-167`): `dataTransfer`
  // only yields its payload on `drop` in most engines, and `dragover` has to
  // decide whether the cell under the cursor is a drop zone at all.
  const [dragSource, setDragSource] = useState<MoveOccupantSource | null>(null);
  /** `cellKey` of the hovered cell that WOULD accept the drop. */
  const [dropTargetKey, setDropTargetKey] = useState<string | null>(null);
  const [dragNotice, setDragNotice] = useState<DragNotice | null>(null);
  /** A C4 move waiting on the force/desist prompt. See `forcePendingMove`. */
  const [pendingMove, setPendingMove] = useState<PendingMove | null>(null);
  /** T5 — the occupant marked for a pick-then-place. See `PickedMove`. */
  const [pickedMove, setPickedMove] = useState<PickedMove | null>(null);
  const pickerRef = useRef<HTMLDivElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);

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
    removeError && cells.some((c) => c.rowId === removeError.rowId && c.occupants.length > 0)
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

  const columnById = useMemo(() => new Map(columns.map((c) => [c.columnId, c])), [columns]);

  const cellsByKey = useMemo(() => {
    const map = new Map<string, GridCell>();
    for (const c of cells) map.set(cellKey(c.columnId, c.rowId), c);
    return map;
  }, [cells]);

  const unfilledByKey = useMemo(() => {
    const set = new Set<string>();
    for (const u of unfilled) set.add(cellKey(u.columnId, u.rowId));
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
  const duplicatesByColumnId = useMemo(() => {
    const map = new Map<string, Map<string, string[]>>();
    const columnIds = new Set(cells.map((c) => c.columnId));
    for (const columnId of columnIds) {
      map.set(columnId, categoryDuplicatesForColumn(cells, rows, columnId));
    }
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
  const violationsByColumnId = useMemo(() => {
    const map = new Map<string, Map<string, SeatedViolation>>();
    if (!config) return map;
    // P10's record, read straight off the cells — the only reader there is.
    // Keyed BY DATE as well as by `violationKey`: an override is a decision
    // about one seating on one day, and a map shared across the month would let
    // overriding Gaby on the 12th silently sanction her on the 19th too. The
    // VALUE is the rule that was waived, so it cannot sanction a rule added or
    // edited since either — see `ruleViolationsForColumn`.
    const overriddenByColumnId = new Map<string, Map<string, string>>();
    for (const c of cells) {
      for (const id of c.overrides ?? []) {
        const reason = c.overrideReasons?.[id];
        if (reason === undefined) continue;
        const map = overriddenByColumnId.get(c.columnId) ?? new Map<string, string>();
        map.set(violationKey(c.rowId, id), reason);
        overriddenByColumnId.set(c.columnId, map);
      }
    }
    for (const column of columns) {
      const columnSundayDates = sundayDatesForColumn?.(column) ?? sundayDates;
      const found = ruleViolationsForColumn({
        column,
        rows,
        assigned: assignedForColumn(cells, rows, column.columnId),
        members,
        sundayDates: columnSundayDates,
        config,
        overridden: overriddenByColumnId.get(column.columnId),
      });
      if (found.size > 0) map.set(column.columnId, found);
    }
    return map;
  }, [cells, rows, columns, members, sundayDates, sundayDatesForColumn, config]);

  function rankFor(row: GridRow, columnId: string): RankedCandidate[] {
    const column = columnById.get(columnId);
    if (!column) return [];
    const seat = seatDefForRow(row);
    const assigned = assignedForColumn(cells, rows, columnId);
    const columnSundayDates = sundayDatesForColumn?.(column) ?? sundayDates;
    // Passed to BOTH calls: the merge below keeps only `recent` from the second,
    // so its verdict is discarded and cannot disagree — but a later change to
    // what the merge keeps would make a divergence here a real hazard.
    const order = rankCandidates({
      seat,
      date: column.date,
      members,
      windowRoles: unionRoles,
      assigned,
      column,
      sundayDates: columnSundayDates,
      config,
    });
    const recentOnly = rankCandidates({
      seat,
      date: column.date,
      members,
      windowRoles: savedWindow,
      assigned,
      column,
      sundayDates: columnSundayDates,
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
   * The same hazard `activeRemoveError` guards, for the drag's line: a refusal
   * like "Ya asignado en Lead" is true of one grid, and an edit through the
   * picker can make it false while it is still on screen. The drag's own events
   * already clear it (a new drag start, a hover that would be accepted), so this
   * only has to cover the paths that change `cells` some other way.
   */
  function clearDragNotice() {
    if (dragNotice) setDragNotice(null);
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
  function toggleCandidate(row: GridRow, columnId: string, memberId: string, candidates: RankedCandidate[]) {
    if (mutationLocked) return;
    clearRemoveError();
    clearDragNotice();
    const current =
      cellsByKey.get(cellKey(columnId, row.id))?.occupants.map((o) => o.memberId) ?? [];
    if (current.includes(memberId)) {
      onCellsChange(withUpdatedCell(cells, row.id, columnId, current.filter((id) => id !== memberId)));
      return;
    }
    const candidate = candidates.find((c) => c.id === memberId);
    if (candidate?.blockedReason) return; // refuse a same-category double (D6)
    if (candidate?.ruleBlockedReason) return; // refuse a hard rule (E6) — see `overrideCandidate`
    onCellsChange(withUpdatedCell(cells, row.id, columnId, [...current, memberId]));
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
  function overrideCandidate(row: GridRow, columnId: string, memberId: string, candidates: RankedCandidate[]) {
    if (mutationLocked) return;
    clearRemoveError();
    clearDragNotice();
    const candidate = candidates.find((c) => c.id === memberId);
    if (!candidate?.ruleBlockedReason) return;
    // A BACKSTOP, and no test can kill this line ALONE: `CandidateRow` renders
    // the button on the same two conditions, so a double-blocked candidate has
    // no button to click. The line that carries D6 here is `overridable`, which
    // IS pinned — by a candidate holding both refusals at once ("offers NO
    // override for a same-category double"). Kept because this is a write path
    // into a cell and the cost is one line.
    if (candidate.blockedReason) return;
    const current =
      cellsByKey.get(cellKey(columnId, row.id))?.occupants.map((o) => o.memberId) ?? [];
    // A BACKSTOP, not the enforcement. Nobody already seated here can reach this
    // line: `evaluate` exempts a cell's own occupants outright (E6/P9,
    // `ruleEnforcement.ts`'s self-exemption), so their `ruleBlockedReason` is
    // `null` and the guard above has already returned. Deleting this line fails
    // no test. It is kept because "an override adds a seat" is what the line
    // below assumes, and re-stating it costs one line.
    if (current.includes(memberId)) return;
    onCellsChange(
      withUpdatedCell(cells, row.id, columnId, [...current, memberId], {
        memberId,
        reason: candidate.ruleBlockedReason,
      }),
    );
  }

  // ── The drag, gated ────────────────────────────────────────────────────────

  /**
   * ONE gate instance for the lifetime of this component, so its verdict cache
   * survives the `dragover` storm. It drops the whole cache the moment any input
   * identity changes (`cells` above all), so no verdict can outlive the grid it
   * was computed from.
   */
  const gate = useMemo(() => createMoveGate(), []);

  /**
   * The gate call, assembled in ONE place. `mode` selects the discriminated
   * union member: create mode carries P3's `canReceive`, stored mode is typed to
   * forbid it, and this is the only spot where the choice is made.
   */
  function judgeMove(source: MoveOccupantSource, target: MoveOccupantEndpoint): MoveGateVerdict {
    const shared = {
      cells,
      rows,
      columns,
      members,
      source,
      target,
      mutationLocked,
      sundayDates,
      sundayDatesForColumn,
      config,
    };
    const input: MoveGateInput =
      mode === "create" ? { ...shared, mode: "create", canReceive } : { ...shared, mode: "stored" };
    return gate(input);
  }

  function clearDrag() {
    setDragSource(null);
    setDropTargetKey(null);
  }

  /**
   * P1 and P2 for the SOURCE, answered at drag start rather than per render.
   *
   * `canTouchColumn` runs `serializeStoredColumn` over the whole column, so
   * asking it for every chip on every render would be rows×columns serializer
   * passes for a drag that may never happen. Asking once, when a drag actually
   * starts, is the same answer for a fraction of the cost.
   *
   * A refused source is refused SILENTLY — `preventDefault` and nothing else.
   * Both causes already say so on screen: `mutationLocked` renders every cell
   * `cursor-not-allowed opacity-60`, and a stored column the serializer rejects
   * is `readOnly`, which prints "Solo lectura: revisa la integridad del
   * servicio." in its own header. A notice here would restate one of the gate's
   * own strings from a second copy.
   */
  function handleOccupantDragStart(event: ReactDragEvent, source: MoveOccupantSource) {
    const sourceColumn = columnById.get(source.columnId);
    if (mutationLocked || !sourceColumn || !canTouchColumn({ mode, column: sourceColumn, rows, cells })) {
      event.preventDefault();
      return;
    }
    // Guarded because jsdom has no `DataTransfer`, and because the payload is
    // not what carries the drag — `dragSource` is. Setting it anyway is what
    // makes the native drag image and cursor behave on a real desktop.
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", source.memberId);
    }
    setDragNotice(null);
    // One gesture at a time: a drag started while a pick is armed replaces it,
    // rather than leaving two sources marked and the admin guessing which the
    // next cell will move.
    setPickedMove(null);
    setDragSource(source);
  }

  // ── The same move, picked and placed (T5) ──────────────────────────────────

  /** A seat and a date in the grid's own words — "BGV — 6 sep". */
  function endpointLabel(endpoint: MoveOccupantEndpoint): string {
    const row = rows.find((r) => r.id === endpoint.rowId);
    const column = columnById.get(endpoint.columnId);
    if (!row || !column) return "";
    return `${row.label} — ${shortDate(column.date)}`;
  }

  /**
   * DD11/DD12 — mark an occupant as the SOURCE of a move, or un-mark them.
   *
   * Writes nothing and judges nothing: a source has no eligibility question
   * (that is a question about the target, and `moveGate` owns it), so this is
   * reachable from a chip AND from a seated member's picker row even when that
   * row is refused as a *candidate* — see `CandidateRow`'s anchor.
   *
   * At most ONE source is ever armed. Marking somebody else REPLACES the mark
   * rather than queueing a second one — two armed sources and one target cell
   * would be a coin toss over who moves — and a drag started mid-pick does the
   * same. The banner names whoever currently holds it.
   */
  function togglePickedMove(source: MoveOccupantSource) {
    // A BACKSTOP, and no test can kill this line alone: both anchors already
    // refuse while locked (the chip on `pick.enabled`, the picker row on
    // `disabled`), which is also what renders them inert. Kept because this is
    // the single entry point for arming a move and the cost is one line.
    if (mutationLocked) return;
    clearRemoveError();
    clearDragNotice();
    setPickedMove((prev) =>
      prev &&
      prev.source.memberId === source.memberId &&
      prev.source.rowId === source.rowId &&
      prev.source.columnId === source.columnId
        ? null
        : {
            source,
            memberName: memberName(source.memberId),
            fromLabel: endpointLabel(source),
          },
    );
  }

  /**
   * The place — the pick path's drop, and the same three outcomes.
   *
   * It runs `judgeMove` before anything is written, exactly as `handleCellDrop`
   * does, and hands a C4 to the same `pendingMove` prompt. A refusal about THIS
   * target leaves the pick armed so the next cell can be tried; a refusal about
   * the SOURCE (it is gone from the grid — Auto finished, another window edited)
   * disarms it, because there is no target that would make it true again.
   */
  function placePickedMove(target: MoveOccupantEndpoint) {
    const picked = pickedMove;
    if (!picked) return;
    const verdict = judgeMove(picked.source, target);
    if (verdict.kind === "not-permitted" || verdict.kind === "refused") {
      setDragNotice({ tone: "refusal", message: verdict.reason });
      if (verdict.kind === "not-permitted" ? verdict.code === "unresolved" : verdict.code === "unknown-member") {
        setPickedMove(null);
      }
      return;
    }
    setPickedMove(null);
    if (verdict.kind === "prompt") {
      setDragNotice(null);
      setPendingMove({ source: picked.source, target, reason: verdict.reason, memberName: picked.memberName });
      return;
    }
    applyMove(picked.source, target);
  }

  /**
   * The hovered cell, judged lazily.
   *
   * **`preventDefault` is the whole drop-zone contract in HTML5 drag**: without
   * it the browser refuses the drop and paints the "no-drop" cursor. So a cell
   * that fails P1–P3 or C1–C3 is left alone here and is genuinely not droppable
   * — the refusal is not merely reported after the fact.
   *
   * `dragover` fires continuously, so this only writes state when the answer
   * actually changes; between those writes nothing re-renders, so the gate's
   * cache keeps every repeat call free.
   */
  function handleCellDragOver(event: ReactDragEvent, target: MoveOccupantEndpoint) {
    if (!dragSource) return;
    const verdict = judgeMove(dragSource, target);
    if (verdict.kind === "not-permitted" || verdict.kind === "refused") {
      if (dropTargetKey !== null) setDropTargetKey(null);
      // C1/C2/C3 (and the preconditions) surface inline, in the gate's own
      // wording — the picker's wording, since the gate takes it from
      // `rankCandidates`. None of them offers a force (DD2).
      if (dragNotice?.message !== verdict.reason) {
        setDragNotice({ tone: "refusal", message: verdict.reason });
      }
      return;
    }
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    const key = cellKey(target.columnId, target.rowId);
    if (dropTargetKey !== key) setDropTargetKey(key);
    if (dragNotice) setDragNotice(null);
  }

  function handleCellDragLeave(target: MoveOccupantEndpoint) {
    if (dropTargetKey === cellKey(target.columnId, target.rowId)) setDropTargetKey(null);
  }

  /**
   * The drop. The gate runs BEFORE anything is written, every time — a refused
   * or not-permitted drop changes no state at all, which is what keeps
   * `handleCellsChange` from marking the column touched (acceptance 8).
   *
   * Re-judged here rather than trusting `handleCellDragOver`'s verdict: the two
   * are cheap (same cache) and the drop is the one that writes.
   */
  function handleCellDrop(event: ReactDragEvent, target: MoveOccupantEndpoint) {
    event.preventDefault();
    const source = dragSource;
    clearDrag();
    if (!source) return;
    const verdict = judgeMove(source, target);
    if (verdict.kind === "not-permitted" || verdict.kind === "refused") {
      setDragNotice({ tone: "refusal", message: verdict.reason });
      return;
    }
    if (verdict.kind === "prompt") {
      setDragNotice(null);
      setPendingMove({ source, target, reason: verdict.reason, memberName: memberName(source.memberId) });
      return;
    }
    applyMove(source, target);
  }

  /**
   * DD1 — the move, in ONE `onCellsChange`, through T2's primitive. A forced C4
   * carries the gate's own `addOverride` in that same call, so the waiver is
   * written with the seating rather than after it.
   */
  function applyMove(
    source: MoveOccupantSource,
    target: MoveOccupantEndpoint,
    addOverride?: { memberId: string; reason: string },
  ) {
    clearRemoveError();
    onCellsChange(moveOccupant(cells, source, target, addOverride));
    setDragNotice(unavailabilityNoticeFor(source.memberId, target));
  }

  /**
   * Acceptance 11 — unavailability is NOT a gate, and it is not a fifth
   * constraint (see `moveGate`'s closing comment): the move has already been
   * applied by the time this runs. It is a SIGNAL, and the drag must not be a
   * weaker signal than the picker, which renders "No disp." on the same fact.
   *
   * Read through `rankFor` — the picker's own call — rather than off
   * `member.unavailableDates`. That field is read in exactly one place
   * (`candidateRanking.ts:199`), and a second reader here would be a second
   * definition of "available" that could drift from the badge it is supposed to
   * echo.
   */
  function unavailabilityNoticeFor(memberId: string, target: MoveOccupantEndpoint): DragNotice | null {
    const row = rows.find((r) => r.id === target.rowId);
    const column = columnById.get(target.columnId);
    if (!row || !column) return null;
    const candidate = rankFor(row, target.columnId).find((c) => c.id === memberId);
    if (!candidate || candidate.available) return null;
    return {
      tone: "note",
      message: `${candidate.name} no está disponible el ${shortDate(column.date)} — el movimiento se aplicó de todos modos.`,
    };
  }

  /**
   * C4, forced — and the answer to the prompt's asynchronous hazard.
   *
   * The move is RE-JUDGED against the live `cells` instead of being applied to a
   * snapshot taken when the prompt opened. A snapshot would be worse than stale:
   * `onCellsChange(moveOccupant(snapshot, …))` hands `MonthGenerator` a whole
   * `cells` array built from the grid as it was, silently reverting anything
   * that landed while the dialog was up (Auto finishing, a picker edit in
   * another window of the same session). Re-judging keeps the write on today's
   * array and costs one cached gate call.
   *
   * The override recorded is the RE-JUDGED verdict's, never the one shown when
   * the prompt opened: it is the rule actually in force at the moment of the
   * write, and `withUpdatedCell` scopes an override to the rule it names
   * (`ruleViolationsForColumn`). Recording a rule that no longer applies would
   * sanction nothing and silence nothing.
   *
   * The three other outcomes are all real: the conflict may have been resolved
   * (`clean` — move, with no waiver to record), or the target may have become
   * unreachable (`refused`/`not-permitted` — say so, write nothing).
   */
  function forcePendingMove() {
    const pending = pendingMove;
    setPendingMove(null);
    if (!pending) return;
    const verdict = judgeMove(pending.source, pending.target);
    if (verdict.kind === "prompt") {
      applyMove(pending.source, pending.target, verdict.addOverride);
      return;
    }
    if (verdict.kind === "clean") {
      applyMove(pending.source, pending.target);
      return;
    }
    setDragNotice({ tone: "refusal", message: verdict.reason });
  }

  /**
   * Desist. It writes NOTHING — no `onCellsChange`, no partial move, no touched
   * column — so `cells` is byte-identical to what it was before the drop
   * (acceptance 5).
   */
  function desistPendingMove() {
    setPendingMove(null);
  }

  const cellPick: CellPickHandlers = {
    source: pickedMove?.source ?? null,
    memberName: pickedMove?.memberName ?? null,
    enabled: !mutationLocked,
    onPickOccupant: togglePickedMove,
    onPlace: placePickedMove,
  };

  const cellDrag: CellDragHandlers = {
    enabled: !mutationLocked,
    source: dragSource,
    activeDropKey: dropTargetKey,
    onOccupantDragStart: handleOccupantDragStart,
    onOccupantDragEnd: clearDrag,
    onCellDragOver: handleCellDragOver,
    onCellDragLeave: handleCellDragLeave,
    onCellDrop: handleCellDrop,
  };

  /**
   * Opens the picker and freezes the candidate ORDER as of right now.
   *
   * With the picker a PERSISTENT right column rather than an in-place popover,
   * this is also "switch the picker to another cell": the panel does not close
   * and reopen, its contents are replaced and `openOrder` is re-captured for
   * the new cell. Clicking the cell that is already open is deliberately NOT a
   * toggle — the panel is a fixed region of the layout, and a stray second
   * click on the cell you are working in must not empty it.
   */
  function openPicker(row: GridRow, columnId: string) {
    setOpenOrder(rankFor(row, columnId).map((c) => c.id));
    setOpenCell({ rowId: row.id, columnId });
  }

  /**
   * Closes the picker and hands focus BACK to the cell that opened it.
   *
   * The popover this replaces sat next to the button that summoned it, so
   * dismissing it left focus somewhere sensible on its own. A column on the far
   * side of the grid does not: without this, closing drops focus onto `<body>`
   * and a keyboard user restarts at the top of the page.
   *
   * The cell is found by its own data attributes rather than a stored element
   * reference — the reference would go stale across the re-render that a seat
   * change or a full-screen toggle causes, and the attributes are the same pair
   * that identifies the cell everywhere else in this file. Quoted attribute
   * values need no escaping for the ids in play (`instrumento:Bass`).
   */
  const closePicker = useCallback(() => {
    const target = openCell;
    setOpenCell(null);
    setOpenOrder(null);
    if (!target) return;
    const cell = document.querySelector<HTMLElement>(
      `[data-row-id="${target.rowId}"][data-column-id="${target.columnId}"]`,
    );
    // The cell's ACTION, not the cell box. The box used to be `role="button"`
    // and answered Enter itself; it is a `role="group"` now (T5 — it holds
    // focusable chips), so focusing it would land a keyboard user on something
    // inert and cost them the "close, look, reopen" loop. The button inside is
    // where that Enter went. Falls back to the box if there is no enabled action
    // — a locked grid — so focus never drops to `<body>`.
    (cell?.querySelector<HTMLElement>("[data-cell-action]:not([disabled])") ?? cell)?.focus();
  }, [openCell]);

  const openKey = openCell ? `${openCell.rowId}|${openCell.columnId}` : null;

  /**
   * Focus follows the picker, on open AND on every switch to another cell.
   *
   * Keyed on the cell, not on "the picker appeared": switching from Lead to BGV
   * keeps the same panel mounted, so nothing else would tell a screen-reader
   * user that the list under their cursor is now a different seat's. The panel
   * carries the seat and date in its `aria-label`, which is what lands when
   * focus does.
   */
  useEffect(() => {
    if (openKey) pickerRef.current?.focus();
  }, [openKey]);

  /**
   * Escape, in the CAPTURE phase, and only while there is something for it to
   * dismiss.
   *
   * `MonthGenerator` listens for Escape on `document` too, and its answer is to
   * close the whole generator (behind the discard guard). Both listeners sit on
   * the same node, so bubble-phase registration order would decide the winner —
   * and that order flips whenever either effect re-registers, which both do on
   * ordinary state changes. A capture-phase listener on `document` runs before
   * ANY bubble-phase listener on it, whatever the order they were added in, so
   * this is a priority rule rather than a race.
   *
   * `stopPropagation` is what makes it a priority rule: it keeps the keystroke
   * from reaching the generator's handler at all. It is deliberately scoped —
   * with no picker open and no full screen, this listener does not exist, and
   * Escape closes the generator exactly as it always did.
   *
   * Full screen outranks the picker when both are up: the picker is visible and
   * usable inside full screen, so the first Escape returns the admin to the page
   * they came from and the second closes the picker.
   *
   * **The C4 prompt outranks BOTH, and it is not a priority rule this listener
   * can win by stopping propagation.** `CueDialog` registers its own
   * capture-phase Escape listener on `document`, and two capture listeners on
   * the SAME node both run: `stopPropagation` below stops the event reaching
   * other nodes, not other listeners here — only `stopImmediatePropagation`
   * would do that, and using it would break `CueDialog`'s dismissal instead.
   * So the collision is resolved by yielding: while a prompt is open this
   * listener does nothing at all, and one Escape dismisses the prompt alone
   * rather than also exiting full screen and stranding a pending move.
   *
   * **A pending PICK (T5) is registered here for the same reason and outranks
   * the other two.** It is the most recent and most transient state on the
   * surface, and cancelling it is what Escape means while it is armed — exiting
   * full screen instead would leave a marked source with no visible banner. It
   * also gives this listener a third reason to exist: a pick can be armed from a
   * chip with no picker open and no full screen.
   */
  useEffect(() => {
    if (!openKey && !fullScreen && !pickedMove) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (pendingMove) return;
      // SCOPED to keystrokes that are not already spoken for. A capture-phase
      // listener on `document` sees Escape before the field it was typed into
      // does, so an unconditional one made Escape inside "Nuevo instrumento"
      // close the picker and yank focus across the grid to a cell — a keystroke
      // that means "undo what I am typing", answered by an unrelated dismissal.
      // Text entry and an open `<select>` keep their own Escape (the chart's
      // Voces/Instrumentos select is inside this surface), and because this
      // handler then does nothing at all, Escape in a field behaves exactly the
      // same whether or not the picker happens to be open — which is the point.
      // A checkbox (a column header's "Omitir") has no Escape behaviour of its
      // own and is deliberately NOT exempt.
      if (ownsEscape(event.target)) return;
      event.preventDefault();
      event.stopPropagation();
      if (pickedMove) {
        setPickedMove(null);
        return;
      }
      if (fullScreen) {
        setFullScreen(false);
        return;
      }
      closePicker();
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [openKey, fullScreen, closePicker, pendingMove, pickedMove]);

  /**
   * What `role="dialog" aria-modal="true"` promises, actually delivered.
   *
   * Declaring the attributes without any of this was the shipped defect:
   * entering full screen unmounted the button that had focus, so focus fell to
   * `<body>` and a keyboard user restarted at the top of the page; `aria-modal`
   * told assistive tech the page behind was hidden while it stayed fully
   * tabbable; and the page kept its own scroll, so a wheel past the overlay's
   * extent moved the page underneath and exiting landed somewhere else.
   *
   * Three things, one effect, because they share a lifetime:
   *  • **focus in, and back out.** Out by ATTRIBUTE, not by a stored element
   *    reference — leaving full screen rebuilds this subtree (see the portal
   *    note at the bottom of this file), so the button that opened it is a
   *    different DOM node by the time focus is restored. Same reason
   *    `closePicker` looks its cell up by `[data-row-id][data-date]`.
   *  • **body scroll lock**, restoring the caller's own inline value rather than
   *    assuming it was empty — `CueDialogProvider` does the identical dance, and
   *    a planner opened from inside a dialog would otherwise have that lock
   *    cleared on the way out.
   *  • **`inert` on every other body child**, which is what makes `aria-modal`
   *    true rather than merely claimed. The overlay is portalled to `body`, so
   *    its siblings ARE the page behind it. Restored exactly: an element that
   *    already carried `inert` (a closed `BottomNav` sheet, a lower `CueDialog`
   *    layer) is left alone rather than un-inerted on the way out.
   */
  useEffect(() => {
    if (!fullScreen) return;
    const overlay = overlayRef.current;
    overlay?.focus();

    const body = document.body;
    const priorOverflow = body.style.overflow;
    body.style.overflow = "hidden";

    const inerted: HTMLElement[] = [];
    for (const child of Array.from(body.children)) {
      if (!(child instanceof HTMLElement)) continue;
      if (overlay && (child === overlay || child.contains(overlay))) continue;
      // `CueDialogProvider`'s portal target is a body child too, and inerting it
      // would make every dialog raised FROM full screen unusable — the C4
      // force/desist prompt above all, which is reachable by a drag inside this
      // overlay. A dialog is a HIGHER layer than the surface that opened it, so
      // it is the one thing here that must stay live; `CueDialog` runs its own
      // focus trap and its own `inert` for the layers below it.
      if (child.hasAttribute("data-cue-dialog-root")) continue;
      if (child.hasAttribute("inert")) continue;
      child.setAttribute("inert", "");
      inerted.push(child);
    }

    return () => {
      body.style.overflow = priorOverflow;
      for (const el of inerted) el.removeAttribute("inert");
      document.querySelector<HTMLElement>("[data-planner-fullscreen]")?.focus();
    };
  }, [fullScreen]);

  /**
   * The trap itself. `inert` already stops a pointer or a screen reader reaching
   * the page behind, but it is not honoured for sequential focus in every engine
   * this app ships to (the Capacitor WebView included), and Tab is the one input
   * that would otherwise walk straight out of a surface whose only exit control
   * is inside it.
   */
  const trapTab = useCallback((event: ReactKeyboardEvent) => {
    if (event.key !== "Tab") return;
    const root = overlayRef.current;
    if (!root) return;
    const items = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
    if (items.length === 0) {
      event.preventDefault();
      root.focus();
      return;
    }
    const active = document.activeElement;
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey) {
      if (active === first || active === root || !root.contains(active)) {
        event.preventDefault();
        last.focus();
      }
      return;
    }
    if (active === last || !root.contains(active)) {
      event.preventDefault();
      first.focus();
    }
  }, []);

  function handleAutoClick() {
    if (autoState.disabledReason || autoState.pending) return;
    setConfirmingAuto(true);
  }

  function confirmAuto() {
    setConfirmingAuto(false);
    onAuto();
  }

  function removeRow(rowId: string) {
    if (mutationLocked) return;
    const hasOccupants = cells.some((c) => c.rowId === rowId && c.occupants.length > 0);
    if (hasOccupants) {
      setRemoveError({ rowId, message: "Vacía la fila antes de eliminarla." });
      return;
    }
    setRemoveError(null);
    onRowsChange(rows.filter((r) => r.id !== rowId));
  }

  function addInstrumentRow(raw: string): string | null {
    if (mutationLocked) return "Espera a que termine la operación pendiente.";
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
    if (mutationLocked) return "Espera a que termine la operación pendiente.";
    const name = normalizeSeatName(raw);
    if (!name) return null;
    if (rows.some((r) => r.category === "foh" && r.label.toLowerCase() === name.toLowerCase())) {
      return "Ya existe un rol de FOH con ese nombre.";
    }
    const def = fohSeatDef(name);
    onRowsChange([...rows, { id: def.id, label: def.label, category: def.category, target: 1 }]);
    return null;
  }

  function copyRowAcrossColumns(row: GridRow, sourceColumnId: string) {
    if (mutationLocked) return;
    clearRemoveError();
    clearDragNotice();
    const sourceColumn = columnById.get(sourceColumnId);
    if (mode === "stored" && sourceColumn && "admission" in sourceColumn && sourceColumn.admission === "readOnly") return;
    const sourceIds =
      cellsByKey.get(cellKey(sourceColumnId, row.id))?.occupants.map((o) => o.memberId) ?? [];
    let next = cells;
    for (const col of columns) {
      if (col.columnId === sourceColumnId) continue;
      if (mode === "stored" && "admission" in col && col.admission === "readOnly") continue;
      if (!rowAppliesTo(row, col)) continue;
      next = withUpdatedCell(next, row.id, col.columnId, sourceIds);
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
  const openColumn = openCell ? columnById.get(openCell.columnId) ?? null : null;
  const liveCandidates = openCell && openRow ? rankFor(openRow, openCell.columnId) : [];
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

  // ── The three tracks, and the one number that differs between the modes ────
  //
  // The date track's floor is what decides "scroll" vs "squeeze". In the page
  // it stays at 150px: a column narrower than that wraps a two-word name onto
  // three lines, and the type on this surface was deliberately made BIGGER, not
  // smaller. In full screen the whole point is that the month fits, so the floor
  // goes to 0 and N columns divide whatever the viewport has. Threaded down to
  // the header and the cells as well, because each of those carries its own
  // `min-w-[150px]` — leaving those behind would make the fitted template a lie
  // and reintroduce the horizontal scroll full screen exists to remove.
  const dateTrack = fullScreen ? "minmax(0, 1fr)" : "minmax(150px, 1fr)";
  const labelTrack = fullScreen ? "minmax(140px, max-content)" : "minmax(176px, max-content)";
  const cellMinW = fullScreen ? "min-w-0" : "min-w-[150px]";
  const labelMinW = fullScreen ? "min-w-[140px]" : "min-w-[176px]";
  // The row-label column is `sticky` inside the horizontal scroller, so the seat
  // being read stays on screen while the month scrolls under it — losing track
  // of which row you are in is the failure mode a narrower grid actually has.
  // Sticky needs an OPAQUE background or the chips scroll through it; `#010b17`
  // is `--brand-blackout`, the same value `ParticipationSidebar` paints itself.
  const stickyLabel = "sticky left-0 z-10 bg-[#010b17]";

  const gridBlock = (
    <div className={fullScreen ? undefined : "overflow-x-auto"}>
      <div
        className="grid"
        style={{ gridTemplateColumns: `${labelTrack} repeat(${columns.length}, ${dateTrack})` }}
      >
        <div className={`${labelMinW} ${stickyLabel}`} />
        {columns.map((column) => (
          <ColumnHeader
            key={column.columnId}
            column={column}
            preflight={preflightFor(column)}
            createBlock={createBlockFor(column)}
            skipped={skipped.has(column.columnId)}
            unaddressable={unaddressableSet.has(column.date)}
            onToggleSkip={() => onToggleSkip(column.columnId)}
            stored={mode === "stored"}
            readOnly={mode === "stored" && "admission" in column && column.admission === "readOnly"}
            onStoredHeaderChange={onStoredHeaderChange}
            storedDateBlockedReason={storedDateBlockedReason}
            mutationLocked={mutationLocked}
            minWClass={cellMinW}
          />
        ))}

        {rows.map((row) => (
          <RowGroup
            key={row.id}
            row={row}
            columns={columns}
            cellsByKey={cellsByKey}
            unfilledByKey={unfilledByKey}
            duplicatesByColumnId={(columnId) =>
              duplicatesByColumnId.get(columnId) ?? emptyDuplicates
            }
            violationsByColumnId={(columnId) =>
              violationsByColumnId.get(columnId) ?? emptyViolations
            }
            memberName={memberName}
            onOpen={(columnId) => {
              if (mutationLocked) return;
              const column = columnById.get(columnId);
              if (mode === "stored" && column && "admission" in column && column.admission === "readOnly") return;
              openPicker(row, columnId);
            }}
            onRemove={row.category !== "voz" ? () => removeRow(row.id) : undefined}
            mutationLocked={mutationLocked}
            removeError={activeRemoveError?.rowId === row.id ? activeRemoveError.message : null}
            onCopy={
              row.category !== "voz"
                ? (columnId) => copyRowAcrossColumns(row, columnId)
                : undefined
            }
            activeColumnId={openCell?.rowId === row.id ? openCell.columnId : null}
            drag={cellDrag}
            pick={cellPick}
            minWClass={cellMinW}
            labelMinWClass={labelMinW}
            stickyLabelClass={stickyLabel}
          />
        ))}
      </div>
    </div>
  );

  // ── The centre column ──────────────────────────────────────────────────────
  // `min-w-0` is load-bearing on a flex child: without it the grid's intrinsic
  // width (every column at its floor) sets the flex basis and pushes the picker
  // off the screen instead of scrolling inside its own box.
  const centre = (
    <div className="min-w-0 flex-1 space-y-4 xl:order-2">
      {gridBlock}
      {/*
        The drag's only words: a refusal the gate produced (C1/C2/C3, or a
        precondition), or acceptance 11's non-blocking unavailability note after
        a move that DID land.

        BELOW the grid on purpose. A message above it would move every cell down
        the moment it appeared — mid-drag — and the browser answers a cell moving
        out from under the cursor with `dragleave`/`dragenter`, so the surface
        would fight the interaction it is describing. Rendered in `centre` rather
        than beside the Auto controls so it exists in full screen too, where
        those controls are gone.

        ONE wrapper for both lines, so an idle grid pays a single `space-y-4`
        gap for two permanently-mounted regions rather than two.
      */}
      <div className="space-y-2">
        {/*
          T5's pending pick, said out loud: WHO is marked and WHERE from, since
          the source cell may be scrolled off screen (or hidden behind `+N`) by
          the time the admin picks a target. Beside it, the way out that is not a
          key — full screen has no Escape on a phone, and DD8 routes the whole iOS
          wrap through this path.
        */}
        <div className="flex flex-wrap items-center gap-2">
          <p
            role="status"
            aria-live="polite"
            data-pick-banner
            data-pick-active={pickedMove ? "true" : undefined}
            className="font-body text-xs text-[#00bfff]"
          >
            {/*
              The second sentence tracks what is actually possible. A pick can
              only be ARMED while unlocked, but a save can start under one — and
              "Elige la casilla de destino" would then be instructing the admin
              to do the one thing every cell is refusing. Escape still cancels
              either way, so that half of the sentence stands.
            */}
            {pickedMove
              ? `Marcado para mover: ${pickedMove.memberName} — desde ${pickedMove.fromLabel}. ${
                  mutationLocked
                    ? "Espera a que termine la operación pendiente, o pulsa Esc para cancelar."
                    : "Elige la casilla de destino, o pulsa Esc para cancelar."
                }`
              : ""}
          </p>
          {pickedMove && (
            <button
              type="button"
              onClick={() => setPickedMove(null)}
              className="min-h-[44px] rounded-lg border border-[#00bfff]/20 px-3 font-label text-xs uppercase tracking-widest text-[#C8D8EB]/70 hover:border-[#00bfff]"
            >
              Cancelar el movimiento
            </button>
          )}
        </div>
        {/*
          MOUNTED WHETHER OR NOT IT HAS ANYTHING TO SAY. A `role="status"` region
          that appears with its text is announced unreliably — several screen
          readers only watch regions that existed when the update landed — so the
          region is permanent and only its content changes. The tone attribute
          still appears only with a message, so `[data-drag-notice="…"]` remains
          the honest "is there a notice" query.
        */}
        <p
          role="status"
          aria-live="polite"
          data-drag-notice={dragNotice?.tone}
          className={`font-body text-xs ${dragNotice?.tone === "refusal" ? "text-red-400" : "text-amber-400"}`}
        >
          {dragNotice?.message ?? ""}
        </p>
      </div>
      {!fullScreen && (
        <div className="flex flex-wrap gap-3">
          <AddRowForm placeholder="Nuevo instrumento" onAdd={addInstrumentRow} disabled={mutationLocked} />
          <AddRowForm placeholder="Nuevo rol FOH" onAdd={addFohRow} disabled={mutationLocked} />
        </div>
      )}
    </div>
  );

  // ── The right column — present only while a cell is ACTIVE ────────────────
  // Not "always mounted and empty": an idle 240px panel is 240px the grid does
  // not have for the ~90% of the time nobody is picking anybody. The template is
  // flex, so the centre column simply reclaims the width.
  const pickerColumn =
    openCell && openRow && openColumn ? (
      <div
        ref={pickerRef}
        tabIndex={-1}
        role="region"
        aria-label={`Candidatos para ${openRow.label} — ${openColumn.date}`}
        data-candidate-picker
        className={`${CARD_STYLE.dialog} self-start rounded-xl border border-[#00bfff]/15 p-3 focus:outline-none xl:sticky xl:top-4 xl:order-3 xl:w-[240px] xl:shrink-0`}
      >
        <div className="mb-2 flex items-start justify-between gap-2">
          <span className="font-label text-xs uppercase tracking-widest text-[#C8D8EB]/70">
            Candidatos para {openRow.label} — {openColumn.date}
          </span>
          <button
            type="button"
            onClick={closePicker}
            className="min-h-[44px] min-w-[44px] shrink-0 font-label text-xs uppercase tracking-widest text-[#C8D8EB]/60 hover:text-white"
          >
            Cerrar
          </button>
        </div>
        <ul className="max-h-[60vh] space-y-1.5 overflow-y-auto pr-1">
          {openCandidates.map((candidate) => (
            <CandidateRow
              key={candidate.id}
              candidate={candidate}
              selected={(
                cellsByKey
                  .get(cellKey(openCell.columnId, openCell.rowId))
                  ?.occupants.map((o) => o.memberId) ?? []
              ).includes(candidate.id)}
              mutationLocked={mutationLocked}
              picked={
                pickedMove?.source.memberId === candidate.id &&
                pickedMove.source.rowId === openCell.rowId &&
                pickedMove.source.columnId === openCell.columnId
              }
              onToggle={(id) => toggleCandidate(openRow, openCell.columnId, id, openCandidates)}
              onOverride={(id) =>
                overrideCandidate(openRow, openCell.columnId, id, openCandidates)
              }
              onPickSource={(id) =>
                togglePickedMove({ rowId: openCell.rowId, columnId: openCell.columnId, memberId: id })
              }
            />
          ))}
          {openCandidates.length === 0 && (
            <li className="font-body text-xs italic text-gray-600">Nadie elegible para este puesto.</li>
          )}
        </ul>
      </div>
    ) : null;

  // ── The left column ────────────────────────────────────────────────────────
  // The data attributes are the ones the gutter rail carried, kept so the
  // panel stays findable by the same selector it always had — but the VALUE is
  // honest about what changed: `column`, never `gutter` or `inline`.
  //
  // `xl:w-[216px]` is `CHART_COLUMN_WIDTH`, and it is the content FLOOR of
  // `ParticipationSidebar`'s member row, not a budget: below 212px the 24px
  // count column is drawn on top of the 150px inline bar it is supposed to sit
  // beside. See this file's header, and the guard in
  // `participationAlongside.test.tsx` that re-derives the floor from the
  // sidebar's own source.
  const participationColumn =
    participation && !fullScreen ? (
      <div
        data-participation-rail="panel"
        data-rail-placement="column"
        className="min-w-0 xl:order-1 xl:w-[216px] xl:shrink-0"
      >
        {participation}
      </div>
    ) : null;

  // DOM order: grid, picker, chart. That is the order a phone stacks them in,
  // and it is the order this surface already stacked in (the picker sat under
  // the grid; the rail was mounted after the whole grid in `MonthGenerator`).
  // `xl:order-*` is the only thing that puts the chart on the left, and only
  // once there is width for it.
  const regions = (
    <div className="flex flex-col gap-3 xl:flex-row xl:items-start">
      {centre}
      {pickerColumn}
      {participationColumn}
    </div>
  );

  const surface = (
    <div
      className={
        fullScreen
          ? // The padding is FOUR safe-area maxima rather than `p-4`.
            // `viewportFit: "cover"` (`app/(client)/layout.tsx`) lets the page
            // run under the iOS status bar / Dynamic Island and the home
            // indicator, and `inset-0` is exactly the shape that lands under
            // them. The bar below holds the ONLY exit control — there is no
            // Escape key on a phone — so a plain `p-4` puts "Salir de pantalla
            // completa" under the Dynamic Island and the mode becomes a trap in
            // the Capacitor wrap. `CueDialog.tsx` already solves this; left and
            // right are included as well because this surface is full-bleed
            // horizontally and a landscape iPhone puts the notch on one of those
            // edges — the orientation a month grid is actually read in.
            //
            // Classes, not an inline `style`, for the same reason `Navbar.tsx`
            // writes `ps-[max(1.25rem,env(safe-area-inset-left))]`: it is this
            // repo's existing spelling, and an inline `max(…, env(…))` is a
            // value jsdom's CSS parser drops on the floor, so nothing could pin
            // it.
            "fixed inset-0 z-50 flex flex-col gap-3 overflow-auto bg-[#010b17] focus:outline-none pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))] pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))]"
          : "planner-wide space-y-4"
      }
      {...(fullScreen
        ? {
            ref: overlayRef,
            tabIndex: -1,
            onKeyDown: trapTab,
            role: "dialog" as const,
            "aria-modal": true,
            "aria-label": "Cuadrícula del mes en pantalla completa",
          }
        : {})}
    >
      {fullScreen ? (
        <div className="flex items-center justify-between gap-3">
          <p className="font-label text-xs uppercase tracking-widest text-gray-500">
            {monthLabel ?? "Cuadrícula del mes"}
          </p>
          <button
            type="button"
            onClick={() => setFullScreen(false)}
            className="min-h-[44px] rounded-lg border border-[#00bfff]/20 px-3 font-label text-xs uppercase tracking-widest hover:border-[#00bfff]"
          >
            Salir de pantalla completa (Esc)
          </button>
        </div>
      ) : (
        <>
      {/* ── Auto controls ─────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3">
        {mode === "create" && (
          <button
            type="button"
            onClick={handleAutoClick}
            disabled={!!autoState.disabledReason || autoState.pending}
            className="min-h-[44px] rounded-lg bg-[#003572] px-4 font-label text-xs uppercase tracking-widest transition-colors hover:bg-[#003572]/80 disabled:opacity-50 dark:bg-[#00bfff]/20 dark:hover:bg-[#00bfff]/30"
          >
            {autoState.pending ? "Calculando..." : "🤖 Auto-asignar con Solver"}
          </button>
        )}
        {/*
          "Sometimes I need to take a screenshot of the whole month." Neither the
          page nor the three columns can show a ten-column month at 1512, and a
          bigger scroller would not answer the request — so this is a mode, not a
          zoom: both side panels go, the surface leaves the page, and the columns
          divide the viewport instead of overflowing it.
        */}
        <button
          type="button"
          // The anchor focus comes back to on the way out. An attribute rather
          // than a ref because leaving full screen rebuilds this subtree, so
          // this is a different DOM node by then — see the effect above.
          data-planner-fullscreen
          onClick={() => setFullScreen(true)}
          className="min-h-[44px] rounded-lg border border-[#00bfff]/20 px-3 font-label text-xs uppercase tracking-widest text-[#C8D8EB]/70 transition-colors hover:border-[#00bfff]"
        >
          ⛶ Pantalla completa
        </button>
        {mode === "create" && autoState.disabledReason && (
          <p className="font-body text-xs text-amber-400">{autoState.disabledReason}</p>
        )}
        {mode === "create" && autoState.error && <p className="font-body text-xs text-red-400">{autoState.error}</p>}
      </div>

      {mode === "create" && confirmingAuto && (
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

      {/* The right column is empty space until a cell is picked, so say what
          fills it rather than leaving the admin to discover the interaction. */}
      {!openCell && (
        <p className="font-body text-[11px] text-gray-500">
          Selecciona una celda para ver los candidatos de ese puesto.
        </p>
      )}
        </>
      )}

      {regions}

      {/*
        C4, and the ONLY constraint that gets a prompt (DD2). `CueDialog` rather
        than a hand-rolled panel: it is this repo's portalled dialog, with the
        focus trap, the layer stack and the safe-area padding already solved, and
        its portal is what keeps the prompt visible in full screen — where this
        surface is itself a `position: fixed` overlay and an in-flow dialog would
        be painted inside the box the admin is dragging in.

        Mounted conditionally (the `SetlistEditor.tsx:494` shape) rather than
        always-mounted-with-`open={false}`: `CueDialog` throws outside a
        `CueDialogProvider`, and this grid renders in unit tests that have no
        provider and never raise a prompt.
      */}
      {pendingMove && (
        <CueDialog
          open
          title="Forzar el movimiento"
          label="Forzar el movimiento"
          size="sm"
          onDismiss={desistPendingMove}
        >
          <div className="space-y-4 p-6">
            <p className="font-body text-sm text-[#C8D8EB]">
              Una regla no permite mover a {pendingMove.memberName} aquí:
            </p>
            <p data-prompt-reason className="font-body text-sm text-red-400">
              {pendingMove.reason}
            </p>
            <p className="font-body text-xs text-[#C8D8EB]/70">
              Si lo mueves de todos modos, la regla queda anulada solo para esta casilla y se marca
              ahí para que siga a la vista.
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={forcePendingMove}
                className="min-h-[44px] flex-1 rounded-lg border border-amber-500/40 px-3 font-label text-xs uppercase tracking-widest text-amber-400 hover:bg-amber-500/10"
              >
                Mover de todos modos
              </button>
              <button
                type="button"
                onClick={desistPendingMove}
                className="min-h-[44px] flex-1 rounded-lg border border-[#00bfff]/20 px-3 font-label text-xs uppercase tracking-widest hover:border-[#00bfff]"
              >
                Desistir
              </button>
            </div>
          </div>
        </CueDialog>
      )}
    </div>
  );

  // Full screen leaves the page entirely, and the portal is not decoration.
  // ── The WebKit compositing failure, and why this portal is NOT removable ──
  //
  // `.brand-admin-shell` carries `position: relative` + `isolation: isolate` +
  // `overflow: hidden`, and in real Safari a `position: fixed` descendant of
  // that trio lays out and hit-tests correctly and paints NOTHING. A full-screen
  // overlay is exactly such a descendant, so it goes on `document.body`.
  //
  // This paragraph used to live in `ParticipationRail.tsx`, which was retired
  // with the Tablero. It is reproduced here because it is the ONLY remaining
  // record of a bug a reader will otherwise "fix" away:
  //
  // Per spec a `position: fixed` element whose containing block is the viewport
  // is NOT clipped by an ancestor's `overflow: hidden` — `relative` does not
  // establish a containing block for it, only `transform`/`filter`/
  // `backdrop-filter`/`perspective`/`contain`/`container-type`/`will-change` do,
  // and an audit of the live chain found none of those on any ancestor. Chromium
  // paints correctly mounted in place, so a reader who checks the spec will
  // conclude this portal is pointless and remove it.
  //
  // In real Safari it is not pointless. The element measures its correct box,
  // reports `display: block` / `visibility: visible`, wins `elementFromPoint` at
  // its own centre, accepts a `background-color` — and paints nothing. That
  // fingerprint (correct layout, correct hit-testing, no paint) is a compositing
  // failure, not a layout one, and the only thing separating it from every other
  // painted element on the page is that ancestor chain. The portal takes it out
  // of the chain entirely. It reaches the Capacitor iOS wrap too, same engine.
  // The user confirmed the fix in real Safari; headless WebKit never reproduced
  // the bug, so do not "verify" it away.
  //
  // WHAT THIS COSTS, so it is not mistaken for a bug: switching between the two
  // branches swaps a host element for a portal, so React rebuilds the DOM
  // underneath. Everything that decides what is on screen survives — `cells`,
  // `rows`, `skipped` and the diagnostics live in `MonthGenerator`, and
  // `openCell`/`openOrder`/`fullScreen` live in THIS component, above the
  // subtree being rebuilt. What resets is transient DOM: the horizontal scroll
  // offset, an unsubmitted "Nuevo instrumento" name, and the chart's
  // Voces/Instrumentos choice (it is passed in as an element and is rebuilt with
  // the rest). No assignment can be lost this way.
  return fullScreen ? createPortal(surface, document.body) : surface;
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
  stored,
  readOnly,
  onStoredHeaderChange,
  storedDateBlockedReason,
  mutationLocked,
  minWClass,
}: {
  column: GridColumn;
  preflight: TargetPreflight | null;
  createBlock: "existing" | "created" | null;
  skipped: boolean;
  unaddressable: boolean;
  onToggleSkip: () => void;
  stored: boolean;
  readOnly: boolean;
  onStoredHeaderChange?: (columnId: string, patch: { date?: string; serviceName?: string }) => void;
  storedDateBlockedReason?: string | null;
  mutationLocked: boolean;
  /** `min-w-[150px]` in the page, `min-w-0` in full screen — see `dateTrack`. */
  minWClass: string;
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
    <div data-grid-column-id={column.columnId} className={`${minWClass} space-y-1 px-1 ${skipped || blockCopy ? "opacity-40" : ""}`}>
      {/* Legibility pass: the header's date, month and service type were
          `text-sm`/`text-[10px]` — small enough on a real 10-column month that
          the admin had to lean in to tell one column from another. Bumped one
          step each. Deliberately scoped to THIS grid: the participation chart
          and the rest of the admin screens are unchanged. */}
      <div className="flex items-center gap-1.5">
        <span className="font-display text-base leading-none">{day}</span>
        <span className="font-label text-xs uppercase tracking-widest text-gray-500">{month}</span>
      </div>
      <span className="font-label text-xs uppercase tracking-widest text-gray-500">{typeLabel}</span>
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
      {stored && (
        <div className="space-y-1.5 pt-1">
          {readOnly && <p className="font-body text-[10px] text-amber-400">Solo lectura: revisa la integridad del servicio.</p>}
          <label className="block font-label text-[9px] uppercase tracking-widest text-gray-500">
            Fecha
            <input
              type="date"
              value={column.date}
              disabled={readOnly || mutationLocked || !!storedDateBlockedReason}
              title={storedDateBlockedReason ?? undefined}
              onChange={(event) => onStoredHeaderChange?.(column.columnId, { date: event.target.value })}
              className="mt-1 w-full rounded border border-[#00bfff]/15 bg-transparent px-1.5 py-1 font-body text-[11px] text-[#C8D8EB]"
            />
          </label>
          {column.type === "special_role" && (
            <label className="block font-label text-[9px] uppercase tracking-widest text-gray-500">
              Nombre
              <input
                value={column.serviceName ?? ""}
                disabled={readOnly || mutationLocked}
                onChange={(event) => onStoredHeaderChange?.(column.columnId, { serviceName: event.target.value })}
                className="mt-1 w-full rounded border border-[#00bfff]/15 bg-transparent px-1.5 py-1 font-body text-[11px] normal-case tracking-normal text-[#C8D8EB]"
              />
            </label>
          )}
        </div>
      )}
      {/* A blocked column is skipped whatever the toggle says, so the checkbox
          shows it as skipped and refuses the toggle instead of offering an
          un-skip that changes nothing. */}
      {!stored && (
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
      )}
      {!stored && blockCopy && (
        <p className={`font-body text-[10px] text-amber-400 ${CARD_STYLE.longText}`}>{blockCopy}</p>
      )}
      {/* Suppressed while blocked: the preflight's special branch is name-blind,
          so its badge would read "Se puede crear" right beside the reason this
          column will not be created. A genuinely blocked/unknown preflight
          still has something to say and is rendered below. */}
      {!stored && preflight && !(blockCopy && preflight.state === "creatable") && (
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
      {!stored && unaddressable && (
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
  duplicatesByColumnId,
  violationsByColumnId,
  memberName,
  onOpen,
  onRemove,
  removeError,
  onCopy,
  mutationLocked,
  activeColumnId,
  drag,
  pick,
  minWClass,
  labelMinWClass,
  stickyLabelClass,
}: {
  row: GridRow;
  columns: GridColumn[];
  cellsByKey: Map<string, GridCell>;
  unfilledByKey: Set<string>;
  duplicatesByColumnId: (columnId: string) => Map<string, string[]>;
  /** E13, by `violationKey(rowId, memberId)` — that service column only. */
  violationsByColumnId: (columnId: string) => Map<string, SeatedViolation>;
  memberName: (id: string) => string;
  onOpen: (columnId: string) => void;
  onRemove?: () => void;
  removeError: string | null;
  onCopy?: (columnId: string) => void;
  mutationLocked: boolean;
  /**
   * The date of THIS row's cell that the picker column is currently showing,
   * or `null`. With the picker parked on the far side of the grid instead of
   * under the cell that opened it, the cell has to say so itself — otherwise
   * two clicks apart the admin has no way to tell which seat the list belongs
   * to.
   */
  activeColumnId: string | null;
  drag: CellDragHandlers;
  pick: CellPickHandlers;
  minWClass: string;
  labelMinWClass: string;
  stickyLabelClass: string;
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
      <div className={`${labelMinWClass} ${stickyLabelClass} px-1 py-1`}>
        <div className="flex flex-col items-start gap-0.5">
          {/* Legibility pass — one step up from `text-xs`. The track is
              `minmax(176px, max-content)` and the label already wraps
              (`break-words`), so a wider word grows the track instead of
              spilling into the first cell (D-defect-2). */}
          <span className="font-label text-sm uppercase tracking-widest text-[#C8D8EB]/70 break-words">
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
              disabled={mutationLocked}
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
          return <div key={column.columnId} className={minWClass} />;
        }
        const cell = cellsByKey.get(cellKey(column.columnId, row.id));
        const memberIds = cell?.occupants.map((o) => o.memberId) ?? [];
        const duplicates = duplicatesByColumnId(column.columnId);
        return (
          <GridCellView
            key={column.columnId}
            row={row}
            column={column}
            memberIds={memberIds}
            memberName={memberName}
            duplicates={duplicates}
            violations={violationsByColumnId(column.columnId)}
            unfilled={unfilledByKey.has(cellKey(column.columnId, row.id))}
            onOpen={() => onOpen(column.columnId)}
            onCopy={onCopy ? () => onCopy(column.columnId) : undefined}
            mutationLocked={mutationLocked}
            active={activeColumnId === column.columnId}
            drag={drag}
            pick={pick}
            minWClass={minWClass}
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
  mutationLocked,
  active,
  drag,
  pick,
  minWClass,
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
  mutationLocked: boolean;
  /** This cell is the one the picker column is showing. */
  active: boolean;
  drag: CellDragHandlers;
  pick: CellPickHandlers;
  minWClass: string;
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

  const endpoint: MoveOccupantEndpoint = { rowId: row.id, columnId: column.columnId };
  const isDropTarget = drag.activeDropKey === cellKey(column.columnId, row.id);

  /**
   * The cell's own action, and the ONE place a pick takes it over (DD12).
   *
   * With a member marked, activating a cell PLACES them here — the shipped
   * "open the candidate picker" is suppressed for the duration, deliberately and
   * against tests that pinned it. Anything else would make the target ambiguous:
   * the admin has said which person is moving, so the next cell they activate is
   * a destination, not a list to browse.
   */
  const activate = () => {
    if (mutationLocked) return;
    if (pick.source) {
      pick.onPlace(endpoint);
      return;
    }
    onOpen();
  };

  return (
    <div
      // NOT `role="button"` any more, and that is what T5 needed.
      //
      // A cell holds interactive children — `+N`, "Copiar a todo el mes", and
      // now a focusable chip per occupant. `button` takes presentational
      // children, so all of those were being flattened away by assistive tech,
      // and a chip's Enter was swallowed by this element's own key handler
      // before it could ever mean "marcar para mover". A `group` labelled with
      // its seat and date describes what this box actually is: a named
      // container of controls. `aria-disabled` is supported there; the one
      // property `group` does NOT take is `aria-expanded`, which moved onto the
      // control that does the expanding — see the overlay button below.
      //
      // The cell's own activation moved to the transparent full-bleed button
      // below — a real `<button>`, so Enter and Space are the browser's, not a
      // hand-rolled imitation.
      role="group"
      aria-label={`${row.label} — ${column.date}`}
      // Focusable but NOT tabbable: `closePicker` hands focus back to this
      // element by attribute lookup, which needs `-1`, while the tab order
      // belongs to the controls inside.
      tabIndex={-1}
      aria-disabled={mutationLocked ? "true" : undefined}
      // KEPT as the pointer path: a click anywhere in the box that is not one of
      // the controls means the cell itself. The overlay button stops its own
      // click from arriving here twice.
      onClick={activate}
      // The whole cell is the drop target — cell granularity, never seat-slot
      // granularity. `onDragOver` is what decides whether this cell accepts the
      // drop at all (it `preventDefault`s only when the gate permits the move),
      // so a refused cell never reaches `onDrop`.
      onDragOver={(e) => drag.onCellDragOver(e, endpoint)}
      onDragLeave={() => drag.onCellDragLeave(endpoint)}
      onDrop={(e) => drag.onCellDrop(e, endpoint)}
      data-drop-target={isDropTarget ? "true" : undefined}
      data-row-id={row.id}
      data-date={column.date}
      data-column-id={column.columnId}
      data-active={active ? "true" : undefined}
      className={`relative min-h-[44px] ${minWClass} rounded-lg border px-2 py-1.5 transition-colors ${
        overflow ? "border-amber-500/40 bg-amber-500/5" : "border-[#00bfff]/15 hover:border-[#00bfff]/40"
      } ${mutationLocked ? "cursor-not-allowed opacity-60" : "cursor-pointer"} ${active ? "ring-2 ring-[#00bfff] ring-offset-2 ring-offset-[#010b17]" : ""} ${
        isDropTarget ? "border-[#00bfff] bg-[#00bfff]/10" : ""
      }`}
    >
      {/*
        The cell's activation, as a real button — invisible, full bleed, and
        BEHIND everything else. It changes nothing visually (the content sits on
        top of it, so a pointer still hits chips and `+N` first) and it is what
        puts the cell in the tab order with a name and a role instead of a bare
        focusable div.
      */}
      <button
        type="button"
        data-cell-action
        disabled={mutationLocked}
        onClick={(e) => {
          e.stopPropagation();
          activate();
        }}
        aria-label={
          pick.source && pick.memberName
            ? `Colocar a ${pick.memberName} en ${row.label} — ${column.date}`
            : `Candidatos para ${row.label} — ${column.date}`
        }
        // ON THE CONTROL THAT EXPANDS, not on the cell: `aria-expanded` is a
        // property of the thing you activate to reveal the picker, and `group`
        // does not support it at all in ARIA 1.2 (jsx-a11y says so out loud).
        // Still emitted ONLY where it says something — `aria-expanded={active}`
        // once printed "collapsed" on all ~60 cells of a ten-column month.
        aria-expanded={active ? true : undefined}
        className="absolute inset-0 rounded-lg disabled:cursor-not-allowed"
      />
      {/*
        `relative` is load-bearing: the overlay above is positioned, so without
        it this static content would paint UNDER the button and nothing inside
        would be clickable.
      */}
      <div className="relative">
        <div className="flex flex-wrap gap-1">
          {visibleIds.length === 0 && memberIds.length === 0 && (
            <span className="font-body text-xs italic text-gray-600">Sin asignar</span>
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
            const dragging =
              drag.source?.memberId === id &&
              drag.source.rowId === row.id &&
              drag.source.columnId === column.columnId;
            const source: MoveOccupantSource = { rowId: row.id, columnId: column.columnId, memberId: id };
            const marked =
              pick.source?.memberId === id &&
              pick.source.rowId === row.id &&
              pick.source.columnId === column.columnId;
            const pickChip = () => {
              if (pick.enabled) pick.onPickOccupant(source);
            };
            return (
              <span
                key={id}
                // T4 — the drag SOURCE, and T5's pick source. Occupants past
                // `target` are behind `+N` and have no chip, so both reach visible
                // occupants only; `+N` deliberately gets no second handle (DD11's
                // picker-row anchor is the hidden tail's route).
                //
                // A `role="button"` SPAN, not a `<button>`, and the difference is
                // the drag: this element carries `draggable` + `onDragStart`, and
                // native drag from a `<button>` is inconsistent across engines —
                // changing the tag would put T4's shipped interaction at risk to
                // buy nothing. The cell above is no longer `role="button"`, so
                // nothing flattens this one away, and its Enter/Space is handled
                // here rather than swallowed by an ancestor. Same idiom as
                // `CandidateRow`'s own row.
                role="button"
                tabIndex={pick.enabled ? 0 : -1}
                aria-disabled={pick.enabled ? undefined : "true"}
                // The NAME is the action, because the action is what a button's
                // name is for; the member is named inside it, and the ⚠ the sighted
                // chip carries is spelled out rather than dropped. It describes
                // the KEYBOARD activation, which is the one this role implies and
                // the one assistive tech performs.
                aria-label={`${marked ? "Cancelar el movimiento de" : "Marcar para mover a"} ${memberName(id)}${
                  isDuplicate || ruleBroken ? " (conflicto)" : ""
                }`}
                // NO `onClick`, deliberately (user ruling, 2026-08-06). A pointer
                // click on a name keeps doing exactly what it always has: it
                // falls through to the cell, which opens the picker — or places
                // a pick in progress, like any other part of the cell. Marking
                // from the chip is a KEYBOARD affordance only; a mouse marks
                // from the picker-row anchor or simply drags, and touch is the
                // picker row's job regardless (DD8 — this chip is ~20px).
                onKeyDown={(e) => {
                  if (e.key !== "Enter" && e.key !== " ") return;
                  e.preventDefault();
                  e.stopPropagation();
                  pickChip();
                }}
                draggable={drag.enabled}
                onDragStart={(e) => {
                  // The cell is not draggable, so nothing competes for this event
                  // — stopped anyway so a future draggable ancestor cannot start a
                  // second drag from the same gesture.
                  e.stopPropagation();
                  drag.onOccupantDragStart(e, source);
                }}
                onDragEnd={drag.onOccupantDragEnd}
                data-occupant={id}
                data-picked={marked ? "true" : undefined}
                // Legibility pass — the member chip is the thing the admin
                // actually reads across the whole month, and `text-[10px]` was
                // the smallest type on the surface. One step up, to `text-xs`.
                className={`rounded-full border px-1.5 py-0.5 font-label text-xs text-[#C8D8EB] ${CARD_STYLE.longText} ${
                  isDuplicate || ruleBroken
                    ? "border-red-500/50 bg-red-500/10"
                    : "border-[#00bfff]/25 bg-[#00bfff]/10"
                } ${drag.enabled ? "cursor-grab" : "cursor-not-allowed"} ${dragging ? "opacity-30" : ""} ${
                  marked ? "ring-2 ring-[#00bfff]" : ""
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
              // DELIBERATELY NOT routed through `activate`: this is a disclosure,
              // not the cell's action, and it is the only way to SEE the hidden
              // tail — which is where DD11's source anchor lives. Suppressing it
              // during a pick would make the `+N` occupant unreachable exactly
              // when the admin is already moving somebody else.
              onClick={(e) => {
                e.stopPropagation();
                onOpen();
              }}
              aria-label={`Ver ${hiddenCount} más en ${row.label}`}
              // Sized with the member chips it stands in for.
              className={`rounded-full border px-1.5 py-0.5 font-label text-xs ${
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
              if (!mutationLocked) onCopy();
            }}
            disabled={mutationLocked}
            className="mt-1 font-label text-[9px] uppercase tracking-widest text-[#C8D8EB]/40 hover:text-[#C8D8EB]/70"
          >
            Copiar a todo el mes
          </button>
        )}
      </div>
    </div>
  );
}

// ── Candidate picker row ─────────────────────────────────────────────────────

function CandidateRow({
  candidate,
  selected,
  mutationLocked,
  picked,
  onToggle,
  onOverride,
  onPickSource,
}: {
  candidate: RankedCandidate;
  selected: boolean;
  mutationLocked: boolean;
  /** DD12 — this row's member is the one currently marked for moving. */
  picked: boolean;
  onToggle: (id: string) => void;
  /** P10 — seat this rule-blocked candidate anyway. */
  onOverride: (id: string) => void;
  /** DD11 — mark this SEATED member as the source of a move. */
  onPickSource: (id: string) => void;
}) {
  // TWO refusals, read as two predicates and never as `eligible` (which folds
  // in availability and belongs to the filler alone — see `toggleCandidate`).
  const blocked = mutationLocked || !!candidate.blockedReason || !!candidate.ruleBlockedReason;
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
      title={mutationLocked ? "Espera a que termine la operación pendiente." : candidate.blockedReason ?? candidate.ruleBlockedReason ?? undefined}
      onClick={() => {
        if (!blocked) onToggle(candidate.id);
      }}
      onKeyDown={(e) => {
        // THE ROW ITSELF, never a control inside it. This row is `role="button"`
        // and holds two nested buttons; a keystroke aimed at one of them bubbles
        // here, and this handler `preventDefault`s the button's own activation
        // and runs the row's action instead. For a SEATED member that action is
        // the REMOVAL branch of `onToggle`, so Enter on "Marcar para mover"
        // un-seated the person it was meant to mark — a destructive keyboard
        // path on the only anchor a `+N`-hidden occupant has. Guarded here
        // rather than with a `stopPropagation` on each button so the whole class
        // is closed, including "Asignar de todos modos" (safe today only because
        // it renders exclusively while `blocked` short-circuits this handler).
        if (e.target !== e.currentTarget) return;
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
        {/*
          LABELLED, and never a bare number. `rankCandidates` reads this out of
          `computeParticipation` (`candidateRanking.ts`) — literally the counter
          the participation rail renders — but over a DIFFERENT set of services:
          `unionRoles` here (the ranking lookback plus every draft on this grid,
          including columns that will never be created), and the month's saved
          services plus only the CREATABLE drafts in the rail
          (`plannerParticipationRoles`). Since the rail sits in the gutter beside
          this picker, the same admin now reads two numbers for one person that
          legitimately disagree. The arithmetic is right on both sides — they
          answer different questions — so the fix is to stop the smaller one from
          posing as the other's total.
        */}
        <span
          className="font-label text-[10px] text-gray-500"
          title="Carga que ordena esta lista: el historial reciente más todo lo asignado en esta cuadrícula. No es el total de Participaciones, que cuenta el mes y solo los servicios que se van a crear."
        >
          Carga para ordenar: {candidate.load}
        </span>
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
            if (!mutationLocked) onOverride(candidate.id);
          }}
          disabled={mutationLocked}
          className="mt-1.5 min-h-[44px] w-full rounded-lg border border-amber-500/40 px-2 font-label text-[10px] uppercase tracking-widest text-amber-400 hover:bg-amber-500/10"
        >
          Asignar de todos modos
        </button>
      )}
      {/*
        DD11 — the source anchor, and the ONLY handle a `+N`-hidden occupant has.
        A drop onto an at-target cell appends (`withUpdatedCell`) and the cell
        shows `slice(0, target)`, so the person just placed there has no chip at
        all; this row is where they are still reachable.

        **Deliberately OUTSIDE the `blocked` guard above.** `blocked` answers
        "may this member be SEATED here", which is a question about the target
        and belongs to `moveGate`. A source has no eligibility question — and the
        occupant who most needs relocating is precisely the one `blocked` refuses:
        someone in the `+N` tail who also holds a same-category double would
        otherwise have no anchor anywhere in this UI. `mutationLocked` is the one
        condition that does disable it, because nothing may be written at all
        while it holds.

        Rendered on `selected` — a member already seated in THIS cell. Not on a
        candidate row, which is the column-scoped "traer aquí" DD12 rejected for
        being unable to reach a cross-service move.

        `min-h-[44px] w-full` is DD8's touch floor: this anchor, not the ~20px
        chip, is what the iOS wrap taps.
      */}
      {selected && (
        <button
          type="button"
          data-pick-source={candidate.id}
          onClick={(e) => {
            e.stopPropagation();
            onPickSource(candidate.id);
          }}
          disabled={mutationLocked}
          className={`mt-1.5 min-h-[44px] w-full rounded-lg border px-2 font-label text-[10px] uppercase tracking-widest disabled:opacity-50 ${
            picked
              ? "border-[#00bfff] bg-[#00bfff]/10 text-[#00bfff]"
              : "border-[#00bfff]/25 text-[#C8D8EB]/70 hover:border-[#00bfff]"
          }`}
        >
          {picked ? "Cancelar el movimiento" : "Marcar para mover"}
        </button>
      )}
    </li>
  );
}

// ── Add row form ─────────────────────────────────────────────────────────────

function AddRowForm({
  placeholder,
  onAdd,
  disabled = false,
}: {
  placeholder: string;
  onAdd: (name: string) => string | null;
  disabled?: boolean;
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
          disabled={disabled}
          onChange={(e) => {
            setValue(e.target.value);
            if (error) setError(null);
          }}
          placeholder={placeholder}
          className="min-h-[44px] flex-1 rounded-lg border border-[#00bfff]/20 bg-transparent px-3 py-2 font-body text-xs focus:border-[#00bfff] focus:outline-none"
        />
        <button
          type="submit"
          disabled={disabled}
          className="shrink-0 rounded-lg border border-[#00bfff]/20 px-3 font-label text-xs uppercase tracking-widest text-[#C8D8EB]/70 hover:border-[#00bfff]"
        >
          Añadir
        </button>
      </div>
      {error && <p className="font-body text-[11px] text-red-400">{error}</p>}
    </form>
  );
}
