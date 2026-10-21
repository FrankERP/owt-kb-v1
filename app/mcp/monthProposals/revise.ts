// The MCP proposal editor's replay (plan E1, E4, T2.3): a list of hand edits, each judged by the
// planner's OWN gate for that gesture on the board as the previous edits left it. The screen holds
// a list of edits, never a board the server trusts; every check and every save replays the whole
// list from the stored proposal, so the answer is deterministic and needs no session.
//
//   place     a member into a seat = the manual pick (`judgePick`): C3 by absence, C2, C4.
//   move      a seated member to another seat = the drag gate (`evaluateMove`, create mode).
//   clear     always allowed, as the planner allows removal; the member must be in that seat (R6).
//   exchange  two seated members trade seats, ONE judged unit: both leave, then each placement is
//             judged as a `place` on the board without either, so neither sees the other in its
//             column (no spurious pair-rule C4); either refusal refuses the unit.
//
// C1–C3 refuse. C4 (a hard rule: an exclusion, a week exclusion, a pair) refuses unless the edit
// carries `force` (Q1, the screen's «Asignar de todos modos»); a forced edit records EVERY rule
// its gate named, which the save turns into waivers (T2.2, A4). The first refusal stops the
// replay and names the edit by its index. Members are ids here; the tools translate tokens.
//
// Neutral and pure (ADR-0028): the gates and the board come from `editorBoard.ts`, whose
// `columnRuleInputs` is the only source of their rule inputs.

import { normalizeMinistries } from "@/app/ministries";
import type { RankMember } from "@/app/components/admin/candidateRanking";
import { V3_EDITOR_LINES } from "@/app/components/admin/v3Copy";
import { moveOccupant } from "@/app/components/admin/moveOccupant";
import { buildRows, rowAppliesTo, withUpdatedCell, type GridCell, type SolverConfig } from "@/app/components/admin/plannerModel";
import type { RuleRefusal } from "@/app/components/admin/ruleEnforcement";
import { columnFindings, findingIsRule, serverEvaluateMove, serverJudgePick, withCells, type EditorBoard } from "./editorBoard";

/** At most this many edits per call (T2.3). */
export const MAX_EDITS = 200;
/**
 * R14: at most this many people in one cell — derived from the rows, never restated: four times
 * the largest seat target, far above any real service, so a valid edit never stores a record the
 * size guards would refuse.
 */
export const CELL_LIMIT = 4 * Math.max(...buildRows().map((r) => r.target ?? 0));

export interface SeatRef {
  /** The draft's `localId`. */
  service: string;
  /** The grid row id (`lead`, `bgv`, `coro`, `instrumento:<label>`, `foh:<label>`). */
  row: string;
  member: string;
}

export type EditorEdit =
  | { op: "place"; service: string; row: string; member: string; force?: boolean }
  | { op: "move"; from: SeatRef; to: { service: string; row: string }; force?: boolean }
  | { op: "clear"; service: string; row: string; member: string }
  | { op: "exchange"; a: SeatRef; b: SeatRef; force?: boolean };

export type ReplayCode =
  | "unknown_service"
  | "column_not_created"
  | "unknown_row"
  | "row_not_on_column"
  | "already_in_cell"
  | "member_not_in_cell"
  | "member_not_eligible"
  | "same_category_double"
  | "same_seat"
  | "hard_rule"
  | "cell_limit"
  | "too_many_edits"
  | "judge_disagreement"
  | "server_error";

/** R1's collapsed sentence (I5): never confirms that an id outside the worship audience exists. */
export const NOT_ELIGIBLE_SENTENCE = V3_EDITOR_LINES.notEligible;

export const REPLAY_SENTENCES: Record<Exclude<ReplayCode, "member_not_eligible" | "same_category_double" | "hard_rule">, string> = {
  ...V3_EDITOR_LINES.replay,
  cell_limit: V3_EDITOR_LINES.cellLimit(CELL_LIMIT),
  too_many_edits: V3_EDITOR_LINES.tooManyEdits(MAX_EDITS),
};

export type EditorMember = RankMember & { ministries?: unknown };

export interface PlacedSeat extends SeatRef {
  /** The member marked this date unavailable (the planner's «No disp.» badge; never a block). */
  unavailable: boolean;
}

export interface EditVerdict {
  index: number;
  op: EditorEdit["op"];
  /** The seats this edit filled. */
  placed: PlacedSeat[];
  /** Every hard rule the gate named for a seat this edit forced (empty when nothing was forced). */
  forced: Array<{ seat: SeatRef; rules: RuleRefusal[] }>;
}

export interface ReplayRefusal {
  index: number;
  code: ReplayCode;
  sentence: string;
  /** `hard_rule` only: the rules the gate named, for the screen's «¿Asignar de todos modos?». */
  prompt?: { seat: SeatRef; rules: RuleRefusal[] };
}

export type ReplayResult =
  | { ok: true; board: EditorBoard; verdicts: EditVerdict[] }
  /** `board` is the board as the edits before the refused one left it. */
  | { ok: false; board: EditorBoard; verdicts: EditVerdict[]; refusal: ReplayRefusal };

export interface ReplayInput {
  board: EditorBoard;
  edits: readonly EditorEdit[];
  /** The fresh pool (C3 is judged by id against it, never against the screen's list). */
  members: EditorMember[];
  /** The bound rules (the caller has refused a changed rule set already). */
  config: SolverConfig | null;
}

const isWorship = (m: EditorMember | undefined) => !!m && normalizeMinistries(m.ministries).includes("worship");

type Step = { ok: true; board: EditorBoard; placed: PlacedSeat[]; forced: EditVerdict["forced"] } | { ok: false; refusal: Omit<ReplayRefusal, "index"> };

const refuse = (code: keyof typeof REPLAY_SENTENCES): Step => ({ ok: false, refusal: { code, sentence: REPLAY_SENTENCES[code] } });

function occupantsOf(board: EditorBoard, columnId: string, rowId: string): string[] {
  return board.cells.find((c) => c.columnId === columnId && c.rowId === rowId)?.occupants.map((o) => o.memberId) ?? [];
}

/** R9/R10 and the row's existence; the column id, or a refusal. */
function seatColumn(board: EditorBoard, service: string, rowId: string): { ok: true; columnId: string } | { ok: false; step: Step } {
  const columnId = board.columnIdOf.get(service);
  if (!columnId) return { ok: false, step: refuse("unknown_service") };
  if (!board.editable.has(service)) return { ok: false, step: refuse("column_not_created") };
  const row = board.rows.find((r) => r.id === rowId);
  if (!row) return { ok: false, step: refuse("unknown_row") };
  const column = board.columns.find((c) => c.columnId === columnId)!;
  if (!rowAppliesTo(row, column)) return { ok: false, step: refuse("row_not_on_column") };
  return { ok: true, columnId };
}

function placed(board: EditorBoard, members: EditorMember[], seat: SeatRef): PlacedSeat {
  const columnId = board.columnIdOf.get(seat.service)!;
  const date = board.columns.find((c) => c.columnId === columnId)!.date;
  const m = members.find((x) => x._id === seat.member);
  return { ...seat, unavailable: (m?.unavailableDates ?? []).includes(date) };
}

/** C3 / an unknown id: the planner's sentence for a worship member, R1's collapsed one otherwise (I5). */
function notEligible(members: EditorMember[], memberId: string, plannerSentence: string): Step {
  const sentence = isWorship(members.find((m) => m._id === memberId)) ? plannerSentence : NOT_ELIGIBLE_SENTENCE;
  return { ok: false, refusal: { code: "member_not_eligible", sentence } };
}

/** One `place`, judged by the pick gate on `board`. */
function place(board: EditorBoard, input: ReplayInput, seat: SeatRef, force: boolean): Step {
  const at = seatColumn(board, seat.service, seat.row);
  if (!at.ok) return at.step;
  const verdict = serverJudgePick({ board, columnId: at.columnId, rowId: seat.row, members: input.members, config: input.config }, seat.member);
  if (!verdict) return refuse("server_error");
  let forced: EditVerdict["forced"] = [];
  switch (verdict.kind) {
    case "seated":
      return refuse("already_in_cell");
    case "refused":
      if (verdict.code === "C2") return { ok: false, refusal: { code: "same_category_double", sentence: verdict.reason } };
      return notEligible(input.members, seat.member, verdict.reason);
    case "prompt":
      if (!force) return { ok: false, refusal: { code: "hard_rule", sentence: verdict.reason, prompt: { seat, rules: verdict.rules } } };
      forced = [{ seat, rules: verdict.rules }];
      break;
    case "clean":
      break;
  }
  const occupants = [...occupantsOf(board, at.columnId, seat.row), seat.member];
  if (occupants.length > CELL_LIMIT) return refuse("cell_limit");
  const cells = withUpdatedCell(board.cells, seat.row, at.columnId, occupants);
  return { ok: true, board: withCells(board, cells), placed: [placed(board, input.members, seat)], forced };
}

function clear(board: EditorBoard, seat: SeatRef): Step {
  const columnId = board.columnIdOf.get(seat.service);
  if (!columnId) return refuse("unknown_service");
  if (!board.editable.has(seat.service)) return refuse("column_not_created");
  const occupants = occupantsOf(board, columnId, seat.row);
  const i = occupants.indexOf(seat.member);
  if (i === -1) return refuse("member_not_in_cell");
  const cells = withUpdatedCell(board.cells, seat.row, columnId, [...occupants.slice(0, i), ...occupants.slice(i + 1)]);
  return { ok: true, board: withCells(board, cells), placed: [], forced: [] };
}

function move(board: EditorBoard, input: ReplayInput, from: SeatRef, to: { service: string; row: string }, force: boolean): Step {
  const src = seatColumn(board, from.service, from.row);
  if (!src.ok) return src.step;
  if (!occupantsOf(board, src.columnId, from.row).includes(from.member)) return refuse("member_not_in_cell");
  const dst = seatColumn(board, to.service, to.row);
  if (!dst.ok) return dst.step;
  if (src.columnId === dst.columnId && from.row === to.row) return refuse("same_seat");
  const source = { columnId: src.columnId, rowId: from.row, memberId: from.member };
  const target = { columnId: dst.columnId, rowId: to.row };
  const verdict = serverEvaluateMove({ board, members: input.members, config: input.config, source, target });
  if (!verdict) return refuse("server_error");
  const seat: SeatRef = { service: to.service, row: to.row, member: from.member };
  let forced: EditVerdict["forced"] = [];
  switch (verdict.kind) {
    case "not-permitted":
      // Every precondition `evaluateMove` checks was checked above; one firing here is a disagreement.
      // P3 (a draft apply will not create) and P2 (a stored service that no longer serializes) are
      // both «not editable»; anything else is a disagreement.
      return verdict.code === "P3" || verdict.code === "P2" ? refuse("column_not_created") : refuse("server_error");
    case "refused":
      if (verdict.code === "C1") return refuse("already_in_cell");
      if (verdict.code === "C2") return { ok: false, refusal: { code: "same_category_double", sentence: verdict.reason } };
      return notEligible(input.members, from.member, verdict.reason);
    case "prompt":
      if (!force) return { ok: false, refusal: { code: "hard_rule", sentence: verdict.reason, prompt: { seat, rules: verdict.rules } } };
      forced = [{ seat, rules: verdict.rules }];
      break;
    case "clean":
      break;
  }
  const next = moveOccupant(board.cells, source, target);
  if (occupantsOf(withCells(board, next), dst.columnId, to.row).length > CELL_LIMIT) return refuse("cell_limit");
  return { ok: true, board: withCells(board, next), placed: [placed(board, input.members, seat)], forced };
}

function exchange(board: EditorBoard, input: ReplayInput, a: SeatRef, b: SeatRef, force: boolean): Step {
  if (a.service === b.service && a.row === b.row) return refuse("same_seat");
  const outA = clear(board, a);
  if (!outA.ok) return outA;
  const outB = clear(outA.board, b);
  if (!outB.ok) return outB;
  // Each placement is judged on the board WITHOUT either, then both are applied.
  const intoB = place(outB.board, input, { ...b, member: a.member }, force);
  if (!intoB.ok) return intoB;
  const intoA = place(outB.board, input, { ...a, member: b.member }, force);
  if (!intoA.ok) return intoA;
  // Both verdicts stand; apply the second placement on top of the first without judging it again.
  const columnA = board.columnIdOf.get(a.service)!;
  const cells = withUpdatedCell(intoB.board.cells, a.row, columnA, [...occupantsOf(intoB.board, columnA, a.row), b.member]);
  return { ok: true, board: withCells(board, cells), placed: [...intoB.placed, ...intoA.placed], forced: [...intoB.forced, ...intoA.forced] };
}

/**
 * Gate and finder must agree (T2.2): every rule a forced edit's gate named must be a finding on that
 * seat of the board the edit produced, compared by identity. A judge that disagrees with itself
 * never stores a seat silently, so a miss refuses the edit.
 */
function crossCheck(step: Extract<Step, { ok: true }>, input: ReplayInput): Omit<ReplayRefusal, "index"> | null {
  for (const { seat, rules } of step.forced) {
    const found = columnFindings(step.board, step.board.columnIdOf.get(seat.service)!, input.members, input.config);
    if (!found) return { code: "server_error", sentence: REPLAY_SENTENCES.server_error };
    if (!rules.every((r) => found.some((f) => findingIsRule(f.key, seat, r)))) {
      return { code: "judge_disagreement", sentence: REPLAY_SENTENCES.judge_disagreement };
    }
  }
  return null;
}

export function replayEdits(input: ReplayInput): ReplayResult {
  let board = input.board;
  const verdicts: EditVerdict[] = [];
  if (input.edits.length > MAX_EDITS) {
    return { ok: false, board, verdicts, refusal: { index: MAX_EDITS, code: "too_many_edits", sentence: REPLAY_SENTENCES.too_many_edits } };
  }
  for (let index = 0; index < input.edits.length; index++) {
    const e = input.edits[index];
    const step: Step =
      e.op === "place" ? place(board, input, { service: e.service, row: e.row, member: e.member }, e.force === true)
        : e.op === "clear" ? clear(board, { service: e.service, row: e.row, member: e.member })
          : e.op === "move" ? move(board, input, e.from, e.to, e.force === true)
            : exchange(board, input, e.a, e.b, e.force === true);
    if (!step.ok) return { ok: false, board, verdicts, refusal: { index, ...step.refusal } };
    const disagreement = crossCheck(step, input);
    if (disagreement) return { ok: false, board, verdicts, refusal: { index, ...disagreement } };
    board = step.board;
    verdicts.push({ index, op: e.op, placed: step.placed, forced: step.forced });
  }
  return { ok: true, board, verdicts };
}

/** The seated member ids of a board (the token resolver's second source: a seated person who left the pool). */
export function seatedIds(cells: readonly GridCell[]): string[] {
  return [...new Set(cells.flatMap((c) => c.occupants.map((o) => o.memberId)))];
}
