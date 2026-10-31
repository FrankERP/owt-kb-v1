// Availability conflicts: find them and propose a replacement (ADR-0079; plan
// docs/superpowers/plans/2026-10-29-availability-conflict-resolver.md §4). The pure core of the
// availability writer (`availabilityFixCommit.ts`), which reads, records and emails; this module
// only judges.
//
// A conflict is a person seated on a service whose date is in their `unavailableDates`. It is found
// from the ROLES READ (all five seat paths), never from the month's board, which leaves out a role it
// cannot translate: such a conflict is still a conflict, «sin revisar».
//
// A proposal covers EVERY seat the person holds on that service, or none (all or nothing). A voice
// seat needs a replacement; an instrument or FOH seat nobody can take is left EMPTY (Frank,
// 2026-10-31: «si no hay nadie para cubrir Bass, se puede quedar vacío»), so a person in Lead and
// Bass still gets a Lead proposal. When nobody free fits a VOICE seat, someone already singing on
// the same service moves up into it and a free person takes the seat they leave (`moveUp`: one
// move, this service only, at most three people changed; Frank, 2026-10-31, 27 dic: Marianne BGV →
// Lead, Liu → BGV). Per seat, in board row order: the planner's own candidates for the seat
// (`serverPickCandidates`) with the absent person removed, filtered on the filler's verdict
// (`eligible`, not already serving the service, an instrument declared, in Alabanza), ordered as
// the fillers order them — a voice by `orderByEffectiveLoad` (the rules' exempt/slack), an
// instrument row the filler fills by `orderForFill`, anything else in the candidates' own order —
// and the first of at most 8 that passes the gates is taken:
//   (0) a weekend voice: on the month's v3 eligibility for that role (what the solver could seat);
//   (a) the service target, judged as a diff (`judgeTarget`), adds no rule finding;
//   (b) a voice: the month check finds nothing new against the month with the seat merely emptied.
// A month that cannot be judged (no fairness record, no ledger) answers «sin revisar», never a
// pick. Each identity is judged on the month AS STORED: two proposals may name the same person,
// which is safe because nothing is written until «Aplicar», which judges again on a fresh read.
//
// Neutral and pure: no I/O, nothing from a `"use client"` module (ADR-0028).

import { normalizeMinistries } from "@/app/ministries";
import type { ParticipantRole } from "@/app/utils/computeParticipation";
import type { FairnessLedgerResponse, LogicalRecord } from "@/app/utils/fairnessVocabulary";
import { isSpecialRoleType } from "@/app/utils/roleWriteRequest";
import { isWorshipNightFormat } from "@/app/utils/serviceFormat";
import type { ServiceRole } from "@/app/components/admin/serviceCardModel";
import { cellsToParticipantRoles, type GridCell, type SolverConfig } from "@/app/components/admin/plannerModel";
import { savedWindowFor } from "@/app/components/admin/plannerMonth";
import type { RankedCandidate } from "@/app/components/admin/candidateRanking";
import { fairnessByMemberId, orderByEffectiveLoad } from "@/app/components/admin/localFill";
import {
  instrumentalistsOn,
  isFillableInstrumentRow,
  isInstrumentFillColumn,
  isInstrumentRowId,
  orderForFill,
  seatCounts,
} from "@/app/components/admin/instrumentFill";
import type { V3Role } from "@/app/components/admin/v3Wire";
import { serverPickCandidates, withCells, type EditorBoard } from "@/app/mcp/monthProposals/editorBoard";
import type { EditorMember } from "@/app/mcp/monthProposals/revise";
import { columnTarget, storedColumn, type ServiceTarget, type StoredMonthBoard } from "@/app/mcp/monthProposals/storedMonthBoard";
import { judgeTarget } from "@/app/mcp/monthProposals/storedJudge";
import { monthCheckVerdict, type MonthCheckVerdict } from "@/app/mcp/monthProposals/monthCheck";
import { entryFromRecord } from "@/app/mcp/monthProposals/storedEntries";

/** Candidates tried per seat before the answer is «sin reemplazo». */
export const MAX_TRIED_PER_SEAT = 8;

export type NoneReason = "no_candidate" | "song_lead" | "unchecked";

/** A member as the plan sources read them (`unavailableDates` included). */
export type AvailabilityMember = EditorMember;

/** One conflict, from the roles read: a person seated on a service dated on a day they marked. */
export interface RoleConflict {
  roleId: string;
  roleRev: string;
  roleType: ServiceRole["_type"];
  memberId: string;
  /** The service day, `YYYY-MM-DD`. */
  date: string;
  published: boolean;
}

export interface SeatChange {
  rowId: string;
  from: string;
  /** `null` = the seat is left empty (an instrument or FOH seat nobody can take). */
  to: string | null;
}

export type Proposal =
  | { kind: "replace"; target: ServiceTarget; seats: SeatChange[] }
  | { kind: "none"; reason: NoneReason };

const dayOf = (iso: string) => iso.slice(0, 10);
const isWorship = (m: { ministries?: unknown } | undefined) => !!m && normalizeMinistries(m.ministries).includes("worship");

/** Member ids seated on a role, every seat path (the five of `ASSIGNED_SEAT_PATHS`). */
export function seatedOnRole(role: ServiceRole): string[] {
  const ids = [
    ...(role.leads ?? []).map((m) => m?._id),
    ...(role.bgvs ?? []).map((m) => m?._id),
    ...(role.chorus ?? []).map((m) => m?._id),
    ...(role.instruments ?? []).map((i) => i?.person?._id),
    ...(role.foh ?? []).map((f) => f?.person?._id),
  ];
  return [...new Set(ids.filter((x): x is string => typeof x === "string" && x.length > 0))];
}

/** The months a sweep looks at (D7): this CDMX month through the month after next. */
export function horizonMonths(todayIso: string): string[] {
  const [y, m] = todayIso.slice(0, 7).split("-").map(Number);
  return [0, 1, 2].map((k) => {
    const d = new Date(Date.UTC(y, m - 1 + k, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  });
}

/**
 * Every conflict on a service dated from `todayIso` through the horizon (§4.1), from the roles
 * read. `memberId` scopes it to one person (the member's own save).
 */
export function findRoleConflicts(input: {
  adminRoles: readonly ServiceRole[];
  members: readonly AvailabilityMember[];
  todayIso: string;
  memberId?: string;
}): RoleConflict[] {
  const months = new Set(horizonMonths(input.todayIso));
  const unavailable = new Map(input.members.map((m) => [m._id, new Set(m.unavailableDates ?? [])]));
  const out: RoleConflict[] = [];
  for (const role of input.adminRoles) {
    const date = dayOf(role.date ?? "");
    if (!date || date < input.todayIso || !months.has(date.slice(0, 7))) continue;
    for (const memberId of seatedOnRole(role)) {
      if (input.memberId && memberId !== input.memberId) continue;
      if (!unavailable.get(memberId)?.has(date)) continue;
      out.push({ roleId: role._id, roleRev: role._rev, roleType: role._type, memberId, date, published: role.published !== false });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.roleId.localeCompare(b.roleId) || a.memberId.localeCompare(b.memberId));
}

/** Whether a person leads a song on a worship night (ADR-0036): such a seat is never proposed. */
export function isSongLead(role: { format?: unknown; songs?: Array<{ leads?: Array<{ _ref?: string }> }> } | undefined, memberId: string): boolean {
  if (!role || !isWorshipNightFormat(role.format)) return false;
  return (role.songs ?? []).some((s) => (s.leads ?? []).some((l) => l._ref === memberId));
}

// ── Board helpers ────────────────────────────────────────────────────────────

const VOICE_ROLE: Readonly<Record<string, V3Role>> = { lead: "Lead", bgv: "BGV", coro: "Choir" };
/** Voice rows from the top: a singer only ever moves UP this list. */
const VOICE_ORDER = ["lead", "bgv", "coro"];
export const isVoiceRow = (rowId: string) => rowId in VOICE_ROLE;

function occupantsOf(board: EditorBoard, columnId: string, rowId: string): string[] {
  return board.cells.find((c) => c.columnId === columnId && c.rowId === rowId)?.occupants.map((o) => o.memberId) ?? [];
}

/** The board with `from` replaced IN PLACE by `to` (or taken out when `to` is null) in one cell. */
function replaceIn(board: EditorBoard, columnId: string, rowId: string, from: string, to: string | null): EditorBoard {
  return withCells(board, board.cells.map((c): GridCell => {
    if (c.columnId !== columnId || c.rowId !== rowId) return c;
    const i = c.occupants.findIndex((o) => o.memberId === from);
    if (i === -1) return c;
    const occupants = to === null
      ? [...c.occupants.slice(0, i), ...c.occupants.slice(i + 1)]
      : c.occupants.map((o, k) => (k === i ? { memberId: to } : o));
    return { ...c, occupants, origin: "manual" };
  }));
}

/** The seat's candidates in the order the filler that fills such a seat would reach for them (D2). */
function orderedPool(input: {
  board: EditorBoard;
  columnId: string;
  rowId: string;
  pool: RankedCandidate[];
  config: SolverConfig;
  members: readonly AvailabilityMember[];
}): RankedCandidate[] {
  const { board, columnId, rowId, pool } = input;
  if (isVoiceRow(rowId)) return orderByEffectiveLoad(pool, fairnessByMemberId(input.config, [...input.members]));
  const row = board.rows.find((r) => r.id === rowId);
  const column = board.columns.find((c) => c.columnId === columnId);
  if (row && column && isInstrumentRowId(rowId) && isFillableInstrumentRow(row) && isInstrumentFillColumn(column)) {
    const weekend = board.columns.filter(isInstrumentFillColumn).sort((a, b) => a.date.localeCompare(b.date));
    const i = weekend.findIndex((c) => c.columnId === columnId);
    const previous = i > 0 ? instrumentalistsOn(board.cells, weekend[i - 1].columnId) : new Set<string>();
    return orderForFill(pool, seatCounts(board.cells), previous);
  }
  return pool;
}

// ── The month gate (§4.3) ────────────────────────────────────────────────────

export type GateAnswer = "ok" | "reject" | "unchecked";

export interface MonthGateInput {
  month: string;
  todayIso: string;
  config: SolverConfig;
  members: readonly AvailabilityMember[];
  adminRoles: readonly ServiceRole[];
  /** The month's ONE ledger read; `null` = it failed (the gate answers «sin revisar»). */
  ledger: FairnessLedgerResponse | null;
}

/** The month's record from the ledger, or `null` («sin revisar»: the month cannot be built). */
const recordOf = (ledger: FairnessLedgerResponse, month: string): LogicalRecord | null =>
  ledger.horizon.find((h) => h.month === month)?.record ?? null;

function verdictOn(board: EditorBoard, gate: MonthGateInput): MonthCheckVerdict {
  const record = gate.ledger ? recordOf(gate.ledger, gate.month) : null;
  const [year, month] = gate.month.split("-").map(Number);
  const onBoard = new Set(board.columns.map((c) => c.columnId));
  return monthCheckVerdict({
    months: [gate.month],
    currentMonth: gate.todayIso.slice(0, 7),
    entries: record ? [entryFromRecord(record)] : [],
    board,
    config: gate.config,
    members: gate.members,
    storedRoles: gate.adminRoles.filter((r) => !board.editable.has(r._id)),
    savedWindow: savedWindowFor(year, month, [...gate.adminRoles]).filter((r) => !onBoard.has((r as { _id?: string })._id ?? "")),
    ledger: gate.ledger,
    fairShare: null,
  });
}

const instanceKey = (x: MonthCheckVerdict["instances"][number]) => `${x.family}|${x.rule}|${x.scope}`;
const missedKey = (x: MonthCheckVerdict["missed"][number]) => `${x.code}|${x.person}|${x.scope}`;

/**
 * Whether seating the candidate makes the month worse than merely emptying the seat: a new broken
 * rule instance or missed protection, a `<=`/`==` count that grows, or a cap protection whose count
 * grows. Either build not judged, or the two builds' rule tables differing → not «ok».
 */
export function compareVerdicts(removedOnly: MonthCheckVerdict, withCandidate: MonthCheckVerdict): GateAnswer {
  if (!removedOnly.judged || !withCandidate.judged) return "unchecked";
  if (removedOnly.ruleIds !== withCandidate.ruleIds) return "reject";
  const ops = new Map((JSON.parse(withCandidate.ruleIds) as Array<{ id: string; kind: string; op?: string }>).map((r) => [r.id, r]));
  const before = new Map(removedOnly.instances.map((x) => [instanceKey(x), x]));
  for (const x of withCandidate.instances) {
    const was = before.get(instanceKey(x));
    if (!was) return "reject";
    const rule = ops.get(x.rule);
    if (x.family === "count" && rule?.kind === "count" && (rule.op === "<=" || rule.op === "==") && (x.observed ?? 0) > (was.observed ?? 0)) return "reject";
  }
  const missedBefore = new Map(removedOnly.missed.map((x) => [missedKey(x), x]));
  for (const x of withCandidate.missed) {
    const was = missedBefore.get(missedKey(x));
    if (!was) return "reject";
    if ((x.count ?? 0) > (was.count ?? 0)) return "reject";
  }
  return "ok";
}

// ── The proposal (§4.2) ──────────────────────────────────────────────────────

export interface ProposeInput {
  board: StoredMonthBoard;
  roleId: string;
  memberId: string;
  members: readonly AvailabilityMember[];
  config: SolverConfig | null;
  adminRoles: readonly ServiceRole[];
  todayIso: string;
  /** The month's ledger (one read per month); `null` = failed or not read. */
  ledger: FairnessLedgerResponse | null;
  /** The role as the snapshot holds it, for the worship-night song leads. */
  snapshotRole?: { format?: unknown; songs?: Array<{ leads?: Array<{ _ref?: string }> }> };
  /** People «Elegir otro» skips, per seat (row id → member ids). */
  exclude?: ReadonlyMap<string, ReadonlySet<string>>;
  /** Only these candidates per row (the chosen replacement on «Aplicar»; `null` = leave it empty); absent = any. */
  only?: ReadonlyMap<string, string | null>;
}

/** The seat's replacement candidates in order, filtered (D2): what «Elegir otro» lists too. */
export function seatCandidates(input: ProposeInput & { working: EditorBoard; rowId: string }): RankedCandidate[] | null {
  const { working, roleId, rowId } = input;
  const config = input.config;
  if (!config) return null;
  const [year, month] = roleMonth(input.board, roleId).split("-").map(Number);
  const onBoard = new Set(working.columns.map((c) => c.columnId));
  const windowRoles: ParticipantRole[] = [
    ...savedWindowFor(year, month, [...input.adminRoles]).filter((r) => !onBoard.has((r as { _id?: string })._id ?? "")),
    ...cellsToParticipantRoles(working.cells, working.columns, [...input.members]),
  ];
  const ranked = serverPickCandidates({ board: working, columnId: roleId, rowId, members: [...input.members], config, windowRoles });
  if (!ranked) return null;
  const worship = new Set(input.members.filter(isWorship).map((m) => m._id));
  const instrument = isInstrumentRowId(rowId);
  const pool = ranked.filter((c) =>
    c.eligible && !c.alreadyAssigned && !(instrument && c.undeclared) && worship.has(c.id) && c.id !== input.memberId && !input.exclude?.get(rowId)?.has(c.id));
  return orderedPool({ board: working, columnId: roleId, rowId, pool, config, members: input.members });
}

const roleMonth = (board: StoredMonthBoard, roleId: string) => storedColumn(board, roleId)?.date.slice(0, 7) ?? "";

/**
 * The vacant voice seat `rowId` (the absent person still on `working`, gone on `removed`) taken by
 * someone singing in a LOWER voice seat of the same service (BGV or Coro into Lead, Coro into BGV),
 * whose seat a free person then takes. Singers are tried in board order, never a worship night's
 * song lead, at most `MAX_MOVED_PER_SEAT` who could take the seat, each with up to
 * `MAX_TRIED_PER_SEAT` fillers. `only` (on «Aplicar») fixes
 * the person moved (`only[rowId]`) and the filler of the seat they leave.
 */
function moveUp(input: ProposeInput & {
  config: SolverConfig;
  working: EditorBoard;
  removed: EditorBoard;
  rowId: string;
  baseline: MonthCheckVerdict;
  judge: (next: EditorBoard, baseline: MonthCheckVerdict, voices: ReadonlyArray<{ id: string; rowId: string }>) => GateAnswer;
}): { board: EditorBoard; changes: SeatChange[] } | null | "unchecked" {
  const { working, removed, roleId, rowId, memberId } = input;
  const wantedMover = input.only?.get(rowId);
  // Only UP: a BGV or Coro singer into Lead, a Coro singer into BGV — never a Lead down. Never a
  // seat the absent person also holds (that one is being replaced in its own turn).
  const rank = (r: string) => VOICE_ORDER.indexOf(r);
  const sources = removed.rows.map((r) => r.id).filter((r) =>
    isVoiceRow(r) && rank(r) > rank(rowId) && !occupantsOf(working, roleId, r).includes(memberId) && (!input.only || input.only.has(r)));
  let tried = 0;
  for (const from of sources) {
    for (const mover of occupantsOf(removed, roleId, from)) {
      if (mover === memberId || isSongLead(input.snapshotRole, mover) || input.exclude?.get(rowId)?.has(mover)) continue;
      if (wantedMover !== undefined && mover !== wantedMover) continue;
      // The mover must be a candidate for the vacant seat once their own seat is freed.
      const freed = replaceIn(removed, roleId, from, mover, null);
      if (!seatCandidates({ ...input, working: freed, rowId })?.some((c) => c.id === mover)) continue;
      if (tried++ >= MAX_MOVED_PER_SEAT) return null;
      const lifted = replaceIn(replaceIn(working, roleId, rowId, memberId, mover), roleId, from, mover, null);
      const fillers = seatCandidates({ ...input, working: lifted, rowId: from });
      if (!fillers) return "unchecked";
      const wantedFiller = input.only?.get(from);
      for (const filler of (wantedFiller ? fillers.filter((c) => c.id === wantedFiller) : fillers).slice(0, MAX_TRIED_PER_SEAT)) {
        const next = replaceIn(replaceIn(working, roleId, rowId, memberId, mover), roleId, from, mover, filler.id);
        const answer = input.judge(next, input.baseline, [{ id: mover, rowId }, { id: filler.id, rowId: from }]);
        if (answer === "unchecked") return "unchecked";
        if (answer === "ok") {
          return { board: next, changes: [{ rowId, from: memberId, to: mover }, { rowId: from, from: mover, to: filler.id }] };
        }
      }
    }
  }
  return null;
}

/** Max people moved up from another voice seat of the same service, per vacant voice seat. */
export const MAX_MOVED_PER_SEAT = 6;

/** The replacement for every seat the person holds on the service, or why there is none (§4.2). */
export function proposeReplacement(input: ProposeInput): Proposal {
  const { board, roleId, memberId, todayIso } = input;
  const column = storedColumn(board, roleId);
  if (!column || !board.editable.has(roleId) || column.date < todayIso || !input.config) return { kind: "none", reason: "unchecked" };
  const config = input.config;
  if (isSongLead(input.snapshotRole, memberId)) return { kind: "none", reason: "song_lead" };
  const held = board.rows.filter((r) => occupantsOf(board, roleId, r.id).includes(memberId)).map((r) => r.id);
  if (!held.length) return { kind: "none", reason: "unchecked" };

  const gate: MonthGateInput = {
    month: column.date.slice(0, 7), todayIso, config, members: input.members, adminRoles: input.adminRoles, ledger: input.ledger,
  };
  const weekend = !isSpecialRoleType(column.type);

  /**
   * One build judged against `baseline` (the month with the absent person's seat merely emptied):
   * the month gate, each newly seated voice on the v3 eligibility for its role (weekends), and the
   * service target adding no rule finding.
   */
  const judge = (next: EditorBoard, baseline: MonthCheckVerdict | null, voices: ReadonlyArray<{ id: string; rowId: string }>): GateAnswer => {
    if (baseline) {
      const after = verdictOn(next, gate);
      const answer = compareVerdicts(baseline, after);
      if (answer !== "ok") return answer;
      if (weekend && !voices.every((v) => (after.eligibility.get(v.id)?.[roleId] ?? []).includes(VOICE_ROLE[v.rowId]))) return "reject";
    }
    const target = columnTarget(next, roleId, todayIso);
    if (!target) return "reject";
    const judged = judgeTarget({ board, roleId, target, members: [...input.members], config, todayIso });
    return judged.ok && judged.judged.added.length === 0 && judged.judged.reforced.length === 0 ? "ok" : "reject";
  };

  let working: EditorBoard = board;
  const seats: SeatChange[] = [];
  for (const rowId of held) {
    const removed = replaceIn(working, roleId, rowId, memberId, null);
    const voice = isVoiceRow(rowId);
    const wanted = input.only?.get(rowId);
    if (wanted === null) {
      // «Aplicar» on a proposal that leaves this seat empty: never a voice seat.
      if (voice) return { kind: "none", reason: "no_candidate" };
      working = removed;
      seats.push({ rowId, from: memberId, to: null });
      continue;
    }
    const pool = seatCandidates({ ...input, working: removed, rowId });
    if (!pool) return { kind: "none", reason: "unchecked" };
    const tried = (wanted ? pool.filter((c) => c.id === wanted) : pool).slice(0, MAX_TRIED_PER_SEAT);
    const baseline = voice ? verdictOn(removed, gate) : null;
    let picked: { board: EditorBoard; changes: SeatChange[] } | null = null;
    let unchecked = false;
    for (const candidate of tried) {
      const next = replaceIn(working, roleId, rowId, memberId, candidate.id);
      const answer = judge(next, baseline, voice ? [{ id: candidate.id, rowId }] : []);
      if (answer === "unchecked") {
        unchecked = true;
        break;
      }
      if (answer === "ok") {
        picked = { board: next, changes: [{ rowId, from: memberId, to: candidate.id }] };
        break;
      }
    }
    // Nobody free fits a voice seat: move someone up from another voice seat of the same service,
    // and fill the seat they leave with someone free (one move, this service only).
    if (!picked && !unchecked && voice) {
      const moved = moveUp({ ...input, config, working, removed, rowId, baseline: baseline!, judge });
      if (moved === "unchecked") unchecked = true;
      else picked = moved;
    }
    if (!picked && !unchecked && !voice && !wanted) {
      working = removed;
      seats.push({ rowId, from: memberId, to: null });
      continue;
    }
    if (!picked) return { kind: "none", reason: unchecked ? "unchecked" : "no_candidate" };
    working = picked.board;
    seats.push(...picked.changes);
  }
  const target = columnTarget(working, roleId, todayIso);
  if (!target) return { kind: "none", reason: "unchecked" };
  return { kind: "replace", target, seats };
}
