// The MCP proposal editor's board (plan T2.3): a stored proposal's drafts as the planner grid's own
// cells, the ONE source of every rule judgment's inputs (`columnRuleInputs`), the whole-board
// rule findings (T2.2) and the child's drafts. Neutral and pure: no I/O, no React, nothing from a
// `"use client"` module (ADR-0028), so the tools call it on the server and its tests run in node.
//
// WHY ONE INPUT BUILDER. `rankCandidates`, `evaluateMove` and `ruleFindings` each enforce nothing
// when `column` or `config` is missing, and no week exclusion without the right `sundayDates`
// (`ruleEnforcement.ts`'s `blockingReasons`). The grid tolerates that while its rules load; the
// editor never judges with one missing. Every judgment here — the pick gate, the move gate, the
// finder, the safety net — takes `(column, config, sundayDates)` from `columnRuleInputs`, which
// refuses instead, and `editorInputs.test.ts` greps the editor's modules for a call that bypasses it.

import type { ParticipantRole } from "@/app/utils/computeParticipation";
import { newCreationRequestId } from "@/app/utils/monthDraftCreate";
import { isSpecialRoleType } from "@/app/utils/roleWriteRequest";
import type { RankMember } from "@/app/components/admin/candidateRanking";
import { judgePick, pickCandidates, type PickContext } from "@/app/components/admin/pickJudge";
import { assignedAfterSourceRemoval, evaluateMove, type MoveGateVerdict } from "@/app/components/admin/moveGate";
import {
  assignedForColumn,
  buildRows,
  cellsToDrafts,
  draftsToCells,
  type GridCell,
  type GridColumn,
  type GridRow,
  type SolverConfig,
} from "@/app/components/admin/plannerModel";
import { ruleFindings, ruleRefusals, type RuleRefusal } from "@/app/components/admin/ruleEnforcement";
import { sundaySpineForColumn } from "@/app/components/admin/serviceRuleContext";
import type { FindingKey, ProposalDraft } from "./proposalDocument";

export interface EditorBoard {
  rows: GridRow[];
  columns: GridColumn[];
  cells: GridCell[];
  /** `columnId` → the draft's `localId` (the record's and the waivers' service key), and back. */
  localIdOf: ReadonlyMap<string, string>;
  columnIdOf: ReadonlyMap<string, string>;
  /** The `localId`s apply may create: the drafts `creatable` at solve (R10). Only these are edited or judged. */
  editable: ReadonlySet<string>;
}

/** The drafts as a board, or `null` when a draft cannot be represented (`draftsToCells`). */
export function proposalBoard(drafts: readonly ProposalDraft[]): EditorBoard | null {
  const rows = buildRows();
  const grid = draftsToCells(drafts.map((d) => d.draft), rows);
  if (!grid) return null;
  const localIdOf = new Map<string, string>();
  const columnIdOf = new Map<string, string>();
  for (const { draft } of drafts) {
    const column = grid.columns.find((c) => c.date === draft.date && c.type === draft._type)!;
    localIdOf.set(column.columnId, draft.localId);
    columnIdOf.set(draft.localId, column.columnId);
  }
  return {
    rows,
    columns: grid.columns,
    cells: grid.cells,
    localIdOf,
    columnIdOf,
    editable: new Set(drafts.filter((d) => d.atSolve === "creatable").map((d) => d.draft.localId)),
  };
}

export const withCells = (board: EditorBoard, cells: GridCell[]): EditorBoard => ({ ...board, cells });

/**
 * The child's drafts: the base's, with only the SEATS replaced from the board and a fresh
 * `creationRequestId` each (E2: a child sharing the base's ids would claim the base's creates as
 * its own). Every other field — `localId`, `exists`, `isExisting`, `skipped`, `countsForFairness`,
 * `service_name`, `atSolve`, `reasons` — is copied, never recomputed.
 */
export function childDrafts(
  base: readonly ProposalDraft[],
  board: EditorBoard,
  mintRequestId: () => string = newCreationRequestId,
): ProposalDraft[] {
  const seated = cellsToDrafts(board.cells, board.columns, new Set(), base.map((d) => d.draft), []);
  const byLocalId = new Map(seated.map((d) => [d.localId, d]));
  return base.map((d) => {
    const s = byLocalId.get(d.draft.localId)!;
    return {
      ...d,
      draft: {
        ...d.draft,
        creationRequestId: mintRequestId(),
        leads: s.leads,
        bgvs: s.bgvs,
        chorus: s.chorus,
        instruments: s.instruments,
        foh: s.foh,
      },
      reasons: [...d.reasons],
    };
  });
}

// ── Rule inputs ─────────────────────────────────────────────────────────────

export interface ColumnRuleInputs {
  column: GridColumn;
  config: SolverConfig;
  sundayDates: string[];
}

/**
 * THE source of `(column, config, sundayDates)` for every rule judgment the editor makes. The
 * spine is `sundaySpineForColumn`'s — the planner grid's own per-column spine (trailing Saturday
 * and a 2-month horizon's second month included): required and non-empty for a weekend, `[]` for a
 * special. `null` when anything is missing; the caller answers `server_error` and judges nothing.
 */
export function columnRuleInputs(board: EditorBoard, columnId: string, config: SolverConfig | null): ColumnRuleInputs | null {
  if (!config) return null;
  const column = board.columns.find((c) => c.columnId === columnId);
  if (!column) return null;
  const sundayDates = sundaySpineForColumn(column);
  if (!isSpecialRoleType(column.type) && sundayDates.length === 0) return null;
  return { column, config, sundayDates };
}

// ── The two gates, server-side ──────────────────────────────────────────────

export interface PickInput {
  board: EditorBoard;
  columnId: string;
  rowId: string;
  members: RankMember[];
  config: SolverConfig | null;
  windowRoles?: ParticipantRole[];
}

function pickContext(input: PickInput, inputs: ColumnRuleInputs, row: GridRow): PickContext {
  return {
    cells: input.board.cells,
    rows: input.board.rows,
    column: inputs.column,
    row,
    members: input.members,
    windowRoles: input.windowRoles ?? [],
    recentRoles: input.windowRoles ?? [],
    sundayDates: inputs.sundayDates,
    config: inputs.config,
  };
}

/** `judgePick` with its inputs from `columnRuleInputs`; `null` = a missing input (`server_error`). */
export function serverJudgePick(input: PickInput, memberId: string): ReturnType<typeof judgePick> | null {
  const inputs = columnRuleInputs(input.board, input.columnId, input.config);
  const row = input.board.rows.find((r) => r.id === input.rowId);
  if (!inputs || !row) return null;
  return judgePick(pickContext(input, inputs, row), memberId);
}

/** The seat's candidates in the planner's order, for the screen's seat sheet. */
export function serverPickCandidates(input: PickInput): ReturnType<typeof pickCandidates> | null {
  const inputs = columnRuleInputs(input.board, input.columnId, input.config);
  const row = input.board.rows.find((r) => r.id === input.rowId);
  if (!inputs || !row) return null;
  return pickCandidates(pickContext(input, inputs, row));
}

export interface MoveInput {
  board: EditorBoard;
  members: RankMember[];
  config: SolverConfig | null;
  source: { columnId: string; rowId: string; memberId: string };
  target: { columnId: string; rowId: string };
}

export type ServerMoveVerdict =
  | Exclude<MoveGateVerdict, { kind: "prompt" }>
  /** The grid's C4, plus EVERY rule refusing the move by identity (the cross-check reads these). */
  | (Extract<MoveGateVerdict, { kind: "prompt" }> & { rules: RuleRefusal[] });

/**
 * `evaluateMove` in create mode, its spine REQUIRED (the grid's is optional, `moveGate.ts`) and
 * its target column's inputs from `columnRuleInputs`. P3 (`canReceive`) = the target is editable.
 */
export function serverEvaluateMove(input: MoveInput): ServerMoveVerdict | null {
  const { board, members, source, target } = input;
  const inputs = columnRuleInputs(board, target.columnId, input.config);
  if (!inputs) return null;
  const verdict = evaluateMove({
    mode: "create",
    cells: board.cells,
    rows: board.rows,
    columns: board.columns,
    members,
    source,
    target,
    sundayDates: inputs.sundayDates,
    sundayDatesForColumn: (c) => (c.columnId === inputs.column.columnId ? inputs.sundayDates : sundaySpineForColumn(c)),
    config: inputs.config,
    canReceive: (c) => board.editable.has(board.localIdOf.get(c.columnId) ?? ""),
  });
  if (verdict.kind !== "prompt") return verdict;
  const row = board.rows.find((r) => r.id === target.rowId)!;
  const member = members.find((m) => m._id === source.memberId)!;
  const rules = ruleRefusals({
    member,
    row,
    column: inputs.column,
    sundayDates: inputs.sundayDates,
    assigned: assignedAfterSourceRemoval({ cells: board.cells, rows: board.rows, source, targetColumnId: target.columnId }),
    members,
    config: inputs.config,
  });
  return { ...verdict, rules };
}

// ── Findings (T2.2) ─────────────────────────────────────────────────────────

export interface Finding {
  key: FindingKey;
  /** Display only: the rule as the planner words it. */
  sentence: string;
}

/** One column's rule breaches, keyed once; `null` when its inputs are missing. */
export function columnFindings(board: EditorBoard, columnId: string, members: RankMember[], config: SolverConfig | null): Finding[] | null {
  const inputs = columnRuleInputs(board, columnId, config);
  if (!inputs) return null;
  const service = board.localIdOf.get(columnId)!;
  return ruleFindings({
    column: inputs.column,
    assigned: assignedForColumn(board.cells, board.rows, columnId),
    members,
    sundayDates: inputs.sundayDates,
    config: inputs.config,
  }).map((f) => ({ key: { kind: f.kind, rule: f.ruleId, service, row: f.rowId, members: f.members }, sentence: f.sentence }));
}

/**
 * Every rule breach on the board's editable columns, keyed once (T2.2): per seat for an exclusion
 * or a week exclusion, per two members for a pair. `null` when a column's inputs are missing.
 */
export function boardFindings(board: EditorBoard, members: RankMember[], config: SolverConfig | null): Finding[] | null {
  const out: Finding[] = [];
  for (const column of board.columns) {
    if (!board.editable.has(board.localIdOf.get(column.columnId)!)) continue;
    const found = columnFindings(board, column.columnId, members, config);
    if (!found) return null;
    out.push(...found);
  }
  return out;
}

/** Whether a gate's C4 rule (for a member placed in `seat`) is this finding — compared by identity. */
export function findingIsRule(f: FindingKey, seat: { service: string; row: string; member: string }, rule: RuleRefusal): boolean {
  if (f.kind !== rule.kind || f.rule !== rule.ruleId || f.service !== seat.service) return false;
  if (rule.kind === "pair") {
    const pair = [...rule.members].sort();
    return f.members.length === 2 && f.members[0] === pair[0] && f.members[1] === pair[1];
  }
  return f.row === seat.row && f.members.length === 1 && f.members[0] === seat.member;
}
