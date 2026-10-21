// The judge of a SAVED service's change (admin parity phase 1, plan T2.3, F3–F5): one service's
// stored state against the TARGET a save would write, judged as a DIFF — the same function for the
// check (which shows the result) and for the save (which writes only what it re-derives here).
//
//   1. The header: the type and the date never change (a date move stays in /admin); a name and a
//      time only on a special; «Cuenta para equidad» not in a past CDMX month (F7).
//   2. Removals first: they need no judgement, as the planner allows any removal.
//   3. Each added person through the pick gate (`judgePick`) on the board WITHOUT any addition, so
//      no addition is judged against another (order-free, as the replay's `exchange` judges); then
//      each against the final board without that one seat, read only for C2 (a same-category
//      double two additions could make together). C1–C3 refuse; C4 is only collected.
//   4. The safety net: the service's rule findings on the final board against its findings as
//      stored (the BASELINE). A new finding needs a waiver (F5); a baseline finding is a warning.
//      A C4 the gate named must be a finding on the final board (the editor's cross-check), and
//      when it is a baseline finding it is a «re-forced» one: it gets no token, but its line is in
//      the permission prompt («ya estaba rota antes de este cambio», ADR delta to ADR-0062 A4).
//
// The rule findings read only the service's own column (`ruleFindings`), so the rest of the board
// is whatever it currently holds. Pure and neutral (ADR-0028); its inputs come from
// `columnRuleInputs` (`editorBoard.ts`), never assembled here.

import { normalizeServiceName } from "@/app/utils/normalizeLabel";
import { isServiceTime } from "@/app/utils/serviceTime";
import { isStoredColumnPast, effectiveStoredCounts } from "@/app/components/admin/fairnessToggleModel";
import { V3_STORED_EDITOR_LINES as S } from "@/app/components/admin/v3Copy";
import type { SolverConfig } from "@/app/components/admin/plannerModel";
import type { RuleRefusal } from "@/app/components/admin/ruleEnforcement";
import { normalizeMinistries } from "@/app/ministries";
import { columnFindings, findingIsRule, serverJudgePick, withCells, type EditorBoard, type Finding } from "./editorBoard";
import { findingKeyText } from "./proposalDocument";
import { CELL_LIMIT, NOT_ELIGIBLE_SENTENCE, REPLAY_SENTENCES, type EditorMember, type SeatRef } from "./revise";
import { whereOf } from "./editorView";
import { draftLabel } from "./labels";
import { kindOfType } from "@/app/components/admin/v3Services";
import { columnTarget, diffTargets, storedColumn, targetSeats, withTarget, type ServiceDiff, type ServiceTarget } from "./storedMonthBoard";

export type JudgeCode =
  | keyof typeof S.judge
  | "already_in_cell"
  | "member_not_eligible"
  | "same_category_double"
  | "cell_limit"
  | "judge_disagreement"
  | "server_error";

export interface JudgeRefusal {
  code: JudgeCode;
  sentence: string;
  seat?: SeatRef;
}

export interface TargetJudgement {
  /** The board with this service set to its target. */
  board: EditorBoard;
  stored: ServiceTarget;
  diff: ServiceDiff;
  /** Findings this change creates: each needs a waiver token (F5). */
  added: Finding[];
  /** Baseline findings a C4 of this change named again: a line, never a token. */
  reforced: Finding[];
  /** Baseline findings still on the final board (warnings). */
  baseline: Finding[];
}

export type TargetVerdict = { ok: true; judged: TargetJudgement } | { ok: false; refusal: JudgeRefusal };

const no = (code: JudgeCode, sentence: string, seat?: SeatRef): TargetVerdict => ({ ok: false, refusal: { code, sentence, ...(seat ? { seat } : {}) } });

const isWorship = (m: EditorMember | undefined) => !!m && normalizeMinistries(m.ministries).includes("worship");

function removeOne(board: EditorBoard, columnId: string, rowId: string, memberId: string): EditorBoard {
  return withCells(board, board.cells.map((c) => {
    if (c.columnId !== columnId || c.rowId !== rowId) return c;
    const i = c.occupants.findIndex((o) => o.memberId === memberId);
    return i === -1 ? c : { ...c, occupants: [...c.occupants.slice(0, i), ...c.occupants.slice(i + 1)] };
  }));
}

/** The header half (1): `null` = allowed. */
function headerRefusal(board: EditorBoard, roleId: string, stored: ServiceTarget, target: ServiceTarget, todayIso: string): TargetVerdict | null {
  const column = storedColumn(board, roleId)!;
  if (target._type !== stored._type) return no("type_changed", S.judge.type_changed);
  if (target.date !== stored.date) return no("date_changed", S.judge.date_changed);
  if (kindOfType(target._type) === "special") {
    if (!normalizeServiceName(target.service_name)) return no("header_invalid", S.judge.header_invalid);
    if (target.time !== undefined && !isServiceTime(target.time)) return no("header_invalid", S.judge.header_invalid);
  } else if (target.service_name !== undefined || target.time !== undefined) {
    return no("header_invalid", S.judge.header_invalid);
  }
  if (isStoredColumnPast(column, todayIso) && target.countsForFairness !== effectiveStoredCounts(column, todayIso)) {
    return no("past_counts", S.judge.past_counts);
  }
  return null;
}

export function judgeTarget(input: {
  board: EditorBoard;
  roleId: string;
  target: ServiceTarget;
  members: EditorMember[];
  config: SolverConfig | null;
  todayIso: string;
}): TargetVerdict {
  const { board, roleId, target, members, config, todayIso } = input;
  const column = storedColumn(board, roleId);
  if (!column) return no("unknown_service", S.judge.unknown_service);
  if (!board.editable.has(roleId)) return no("not_editable", S.judge.not_editable);
  const stored = columnTarget(board, roleId, todayIso);
  if (!stored) return no("not_editable", S.judge.not_editable);
  const header = headerRefusal(board, roleId, stored, target, todayIso);
  if (header) return header;

  const diff = diffTargets(board.rows, stored, target);
  const final = withTarget(board, roleId, target);
  if (!diff || !final) return no("unknown_row", S.judge.unknown_row);
  for (const cell of final.cells) {
    if (cell.columnId === column.columnId && cell.occupants.length > CELL_LIMIT) return no("cell_limit", REPLAY_SENTENCES.cell_limit);
  }

  // (2) Removals, on the final header; (3) each addition on that board, without any addition.
  let removedBoard = withTarget(board, roleId, stored)!;
  removedBoard = { ...removedBoard, columns: final.columns };
  for (const r of diff.removed) removedBoard = removeOne(removedBoard, column.columnId, r.row, r.member);
  const prompts: Array<{ seat: SeatRef; rules: RuleRefusal[] }> = [];
  for (const a of diff.added) {
    const seat: SeatRef = { service: roleId, row: a.row, member: a.member };
    const verdict = serverJudgePick({ board: removedBoard, columnId: column.columnId, rowId: a.row, members, config }, a.member);
    if (!verdict) return no("server_error", REPLAY_SENTENCES.server_error, seat);
    if (verdict.kind === "seated") return no("already_in_cell", REPLAY_SENTENCES.already_in_cell, seat);
    if (verdict.kind === "refused") {
      if (verdict.code === "C2") return no("same_category_double", verdict.reason, seat);
      // C3 or an unknown id: R1's collapsed sentence outside the worship audience (I5).
      const sentence = isWorship(members.find((m) => m._id === a.member)) ? verdict.reason : NOT_ELIGIBLE_SENTENCE;
      return no("member_not_eligible", sentence, seat);
    }
    if (verdict.kind === "prompt") prompts.push({ seat, rules: verdict.rules });
    const alone = serverJudgePick({ board: removeOne(final, column.columnId, a.row, a.member), columnId: column.columnId, rowId: a.row, members, config }, a.member);
    if (!alone) return no("server_error", REPLAY_SENTENCES.server_error, seat);
    if (alone.kind === "refused" && alone.code === "C2") return no("same_category_double", alone.reason, seat);
  }

  // (4) The safety net.
  const before = columnFindings(board, column.columnId, members, config);
  const after = columnFindings(final, column.columnId, members, config);
  if (!before || !after) return no("server_error", REPLAY_SENTENCES.server_error);
  for (const { seat, rules } of prompts) {
    if (!rules.every((r) => after.some((f) => findingIsRule(f.key, seat, r)))) return no("judge_disagreement", REPLAY_SENTENCES.judge_disagreement, seat);
  }
  const baseKeys = new Set(before.map((f) => findingKeyText(f.key)));
  const named = (f: Finding) => prompts.some(({ seat, rules }) => rules.some((r) => findingIsRule(f.key, seat, r)));
  return {
    ok: true,
    judged: {
      board: final,
      stored,
      diff,
      added: after.filter((f) => !baseKeys.has(findingKeyText(f.key))),
      reforced: after.filter((f) => baseKeys.has(findingKeyText(f.key)) && named(f)),
      baseline: after.filter((f) => baseKeys.has(findingKeyText(f.key)) && !named(f)),
    },
  };
}

// ── The lines (F4) ───────────────────────────────────────────────────────────

/** The service as the month names it, from its STORED header (a rename is its own line). */
export function storedLabel(board: EditorBoard, roleId: string): string {
  const c = storedColumn(board, roleId);
  return c ? draftLabel({ _type: c.type, date: c.date, service_name: c.serviceName }) : "servicio";
}

/**
 * What the permission prompt shows for one service: each changed seat («entra Ana; sale Bruno»),
 * each header change, and every rule forced on it — a new one, or a baseline one named again. The
 * check answers these and the save re-renders them and compares (F4); both call this.
 */
export function changeLines(input: { board: EditorBoard; roleId: string; target: ServiceTarget; judged: TargetJudgement; nameOf: (id: string) => string }): string[] {
  const { board, roleId, target, judged, nameOf } = input;
  const label = storedLabel(board, roleId);
  const { stored, diff } = judged;
  const lines: string[] = [];
  if (kindOfType(stored._type) === "special") {
    const from = normalizeServiceName(stored.service_name);
    const to = normalizeServiceName(target.service_name);
    if (from !== to) lines.push(S.rename(label, from, to));
    if ((stored.time ?? null) !== (target.time ?? null)) lines.push(S.time(label, stored.time ?? null, target.time ?? null));
  }
  if (stored.countsForFairness !== target.countsForFairness) lines.push(S.counts(label, target.countsForFairness));
  for (const row of board.rows) {
    const enters = diff.added.filter((a) => a.row === row.id).map((a) => nameOf(a.member));
    const leaves = diff.removed.filter((r) => r.row === row.id).map((r) => nameOf(r.member));
    if (enters.length || leaves.length) lines.push(S.seatChange(label, row.label, enters, leaves));
  }
  const where = (f: Finding) => whereOf(judged.board, f.key);
  lines.push(...judged.added.map((f) => S.forced(f.sentence, where(f))));
  lines.push(...judged.reforced.map((f) => S.reforced(f.sentence, where(f))));
  return lines;
}

/**
 * What the permission prompt shows for a copy of instruments (S3): EVERY instrument seat of the
 * result by name («domingo 8 nov · Bass: Tomás»), each instrument row the copy empties, and every
 * rule forced — so the prompt says who is seated, not only who changes. Check and write both call it.
 */
export function copyLines(input: { board: EditorBoard; roleId: string; fromLabel: string; target: ServiceTarget; judged: TargetJudgement; nameOf: (id: string) => string }): string[] {
  const { board, roleId, fromLabel, target, judged, nameOf } = input;
  const label = storedLabel(board, roleId);
  const rowsOf = (t: ServiceTarget) => new Map((targetSeats(board.rows, t) ?? []).map((s) => [s.rowId, s.members]));
  const after = rowsOf(target);
  const before = rowsOf(judged.stored);
  const lines = [S.copy.head(fromLabel, label)];
  for (const row of board.rows) {
    if (row.category !== "instrumento") continue;
    const now = after.get(row.id) ?? [];
    if (now.length) lines.push(S.copy.seat(label, row.label, now.map(nameOf)));
    else if ((before.get(row.id) ?? []).length) lines.push(S.copy.cleared(label, row.label));
  }
  if (target.instruments.length === 0) lines.push(S.copy.empty(label));
  const where = (f: Finding) => whereOf(judged.board, f.key);
  lines.push(...judged.added.map((f) => S.forced(f.sentence, where(f))));
  lines.push(...judged.reforced.map((f) => S.reforced(f.sentence, where(f))));
  return lines;
}

/** The warnings that are not in the prompt: rules this service already broke as stored. */
export const baselineLines = (judged: TargetJudgement): string[] =>
  judged.baseline.map((f) => S.baseline(f.sentence, whereOf(judged.board, f.key)));

/** Lines compared as the prompt shows them: a multiset after Unicode NFC, nothing else normalized (F4). */
export function sameLines(given: readonly string[], expected: readonly string[]): boolean {
  if (given.length !== expected.length) return false;
  const counts = new Map<string, number>();
  for (const e of expected) counts.set(e.normalize("NFC"), (counts.get(e.normalize("NFC")) ?? 0) + 1);
  for (const g of given) {
    const k = g.normalize("NFC");
    const n = counts.get(k) ?? 0;
    if (n === 0) return false;
    counts.set(k, n - 1);
  }
  return true;
}

// ── Groups (F3) ──────────────────────────────────────────────────────────────

/** At most this many services in one group (T2.5): a group always fits the call's time. */
export const MAX_GROUP = 6;

/**
 * The groups the server derives from the changes' diffs (F3), never sent by a client: services are
 * joined when someone leaves one and enters another in the same call, transitively. Members are
 * compared as given (ids, or the month's tokens: one id has one token). Every service is in exactly
 * one group, singles included, groups in order of their earliest service.
 */
export function deriveGroups(changes: ReadonlyArray<{ service: string; date: string; diff: { removed: ReadonlyArray<{ member: string }>; added: ReadonlyArray<{ member: string }> } }>): string[][] {
  const parent = new Map(changes.map((c) => [c.service, c.service]));
  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    parent.set(x, r);
    return r;
  };
  const leaves = new Map<string, Set<string>>();
  const enters = new Map<string, Set<string>>();
  for (const c of changes) {
    for (const r of c.diff.removed) (leaves.get(r.member) ?? leaves.set(r.member, new Set()).get(r.member)!).add(c.service);
    for (const a of c.diff.added) (enters.get(a.member) ?? enters.set(a.member, new Set()).get(a.member)!).add(c.service);
  }
  for (const [member, from] of leaves) {
    for (const s of from) for (const t of enters.get(member) ?? []) if (s !== t) parent.set(find(s), find(t));
  }
  const dateOf = new Map(changes.map((c) => [c.service, c.date]));
  const order = (a: string, b: string) => dateOf.get(a)!.localeCompare(dateOf.get(b)!) || a.localeCompare(b);
  const groups = new Map<string, string[]>();
  for (const c of changes) {
    const root = find(c.service);
    groups.set(root, [...(groups.get(root) ?? []), c.service]);
  }
  return [...groups.values()].map((g) => g.sort(order)).sort((a, b) => order(a[0], b[0]));
}

/** Who leaves and who enters a service, for the «quedó en…» line after a half-written group. */
export function movedMembers(changes: ReadonlyArray<{ diff: ServiceDiff }>): string[] {
  const leaves = new Set(changes.flatMap((c) => c.diff.removed.map((r) => r.member)));
  return [...new Set(changes.flatMap((c) => c.diff.added.map((a) => a.member)))].filter((m) => leaves.has(m));
}

/** The services of `board` where `member` sits, by label, in board order. */
export function servicesOf(board: EditorBoard, member: string): string[] {
  return board.columns
    .filter((c) => board.cells.some((x) => x.columnId === c.columnId && x.occupants.some((o) => o.memberId === member)))
    .map((c) => storedLabel(board, board.localIdOf.get(c.columnId)!));
}
