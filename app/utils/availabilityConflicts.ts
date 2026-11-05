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
import type { FairnessLedgerResponse, LogicalRecord, RoleKey } from "@/app/utils/fairnessVocabulary";
import { pooledForRoleKey } from "@/app/utils/fairnessEligibility";
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
import { serverPickCandidates, withCells, type EditorBoard, type Finding } from "@/app/mcp/monthProposals/editorBoard";
import type { EditorMember } from "@/app/mcp/monthProposals/revise";
import { columnTarget, storedColumn, type ServiceTarget, type StoredMonthBoard } from "@/app/mcp/monthProposals/storedMonthBoard";
import { judgeTarget } from "@/app/mcp/monthProposals/storedJudge";
import { monthCheckVerdict, type MonthCheckVerdict } from "@/app/mcp/monthProposals/monthCheck";
import { entryFromRecord } from "@/app/mcp/monthProposals/storedEntries";
import { findingKeyText } from "@/app/mcp/monthProposals/proposalDocument";
import { missedLine, V3_EDITOR_LINES as E, type V3Names } from "@/app/components/admin/v3Copy";
import { conflictSentence, exclusionSentence, sentenceText, weekSentence } from "@/app/components/admin/ruleCopy";

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

/**
 * The month's record with its availability brought up to date: a block that says «no disponible» on
 * a date the person has since UNMARKED is lifted (its rule exclusions stay). The record is a photo
 * of availability on the day the month was confirmed; whether someone can cover today is today's
 * availability (Marianne, 15 nov 2026: marked 14–15 when November was confirmed, then freed them,
 * and stayed off every option). A NEW absence needs nothing here: no candidate is ever someone who
 * marks the day. Only for judging: the record itself is never written.
 */
function withLiveAvailability(record: LogicalRecord, members: readonly AvailabilityMember[]): LogicalRecord {
  const off = new Map(members.map((m) => [m._id, new Set((m.unavailableDates ?? []).map((d) => String(d).slice(0, 10)))]));
  return {
    ...record,
    people: record.people.map((p) => {
      const marked = off.get(p.memberId);
      // Someone the sources do not list keeps the record as it is (never lift on a missing read).
      if (!marked) return p;
      const blocks = p.blocks.flatMap((b) => (!b.unavailable || marked.has(b.date) ? [b] : b.excludedRoles.length ? [{ ...b, unavailable: false }] : []));
      return blocks.length === p.blocks.length && blocks.every((b, i) => b === p.blocks[i]) ? p : { ...p, blocks };
    }),
  };
}

function verdictOn(board: EditorBoard, gate: MonthGateInput): MonthCheckVerdict {
  const stored = gate.ledger ? recordOf(gate.ledger, gate.month) : null;
  const record = stored ? withLiveAvailability(stored, gate.members) : null;
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

/**
 * The seat's replacement candidates in order, filtered (D2): what «Elegir otro» lists too. `relaxed`
 * (the fallback search only) also keeps someone a personal rule blocks (`ruleBlockedReason`, what
 * the planner's «Asignar de todos modos» forces); never someone who marked the day, a seat clash,
 * someone already serving that service, or a person without the seat's Tipo.
 */
export function seatCandidates(input: ProposeInput & { working: EditorBoard; rowId: string; relaxed?: boolean }): RankedCandidate[] | null {
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
  const fits = (c: RankedCandidate) => (input.relaxed ? c.available && !c.blockedReason : c.eligible);
  const pool = ranked.filter((c) =>
    fits(c) && !c.alreadyAssigned && !(instrument && c.undeclared) && worship.has(c.id) && c.id !== input.memberId && !input.exclude?.get(rowId)?.has(c.id));
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

type Judge = (next: EditorBoard, baseline: MonthCheckVerdict | null, voices: ReadonlyArray<{ id: string; rowId: string }>) => GateAnswer;

/**
 * An instrument or FOH seat the person holds (no month gate: the month check reads voices only):
 * the first of at most 8 candidates whose service judgement adds nothing, else the seat is left
 * EMPTY. Under `only`, exactly the wanted person (or empty for `null`); the wanted person failing
 * is «sin reemplazo», never a different pick.
 */
function otherSeat(input: ProposeInput, judge: Judge, working: EditorBoard, rowId: string): { board: EditorBoard; changes: SeatChange[] } | NoneReason {
  const { roleId, memberId } = input;
  const removed = replaceIn(working, roleId, rowId, memberId, null);
  const wanted = input.only?.get(rowId);
  if (wanted === null) return { board: removed, changes: [{ rowId, from: memberId, to: null }] };
  const pool = seatCandidates({ ...input, working: removed, rowId });
  if (!pool) return "unchecked";
  for (const candidate of (wanted ? pool.filter((c) => c.id === wanted) : pool).slice(0, MAX_TRIED_PER_SEAT)) {
    const next = replaceIn(working, roleId, rowId, memberId, candidate.id);
    const answer = judge(next, null, []);
    if (answer === "unchecked") return "unchecked";
    if (answer === "ok") return { board: next, changes: [{ rowId, from: memberId, to: candidate.id }] };
  }
  return wanted ? "no_candidate" : { board: removed, changes: [{ rowId, from: memberId, to: null }] };
}

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
  const judge: Judge = (next, baseline, voices) => {
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
    const voice = isVoiceRow(rowId);
    if (!voice) {
      const other = otherSeat(input, judge, working, rowId);
      if (typeof other === "string") return { kind: "none", reason: other };
      working = other.board;
      seats.push(...other.changes);
      continue;
    }
    const removed = replaceIn(working, roleId, rowId, memberId, null);
    const wanted = input.only?.get(rowId);
    // «Aplicar» on a proposal that leaves this seat empty: never a voice seat.
    if (wanted === null) return { kind: "none", reason: "no_candidate" };
    const pool = seatCandidates({ ...input, working: removed, rowId });
    if (!pool) return { kind: "none", reason: "unchecked" };
    const tried = (wanted ? pool.filter((c) => c.id === wanted) : pool).slice(0, MAX_TRIED_PER_SEAT);
    const baseline = verdictOn(removed, gate);
    let picked: { board: EditorBoard; changes: SeatChange[] } | null = null;
    let unchecked = false;
    for (const candidate of tried) {
      const next = replaceIn(working, roleId, rowId, memberId, candidate.id);
      const answer = judge(next, baseline, [{ id: candidate.id, rowId }]);
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
    if (!picked && !unchecked) {
      const moved = moveUp({ ...input, config, working, removed, rowId, baseline, judge });
      if (moved === "unchecked") unchecked = true;
      else picked = moved;
    }
    if (!picked) return { kind: "none", reason: unchecked ? "unchecked" : "no_candidate" };
    working = picked.board;
    seats.push(...picked.changes);
  }
  const target = columnTarget(working, roleId, todayIso);
  if (!target) return { kind: "none", reason: "unchecked" };
  return { kind: "replace", target, seats };
}

// ── When nobody passes: options that break a rule (plan 2026-11-05) ──────────

/**
 * One rule an option breaks. `key` is stable for one read (what «Aplicar de todos modos» sends back
 * and the writer must re-derive EXACTLY); `line` is the Spanish sentence the admin reads.
 */
export interface Break {
  key: string;
  line: string;
}

export interface FallbackOption {
  target: ServiceTarget;
  seats: SeatChange[];
  breaks: Break[];
}

export type FallbackAnswer = { kind: "options"; options: FallbackOption[] } | { kind: "none"; reason: NoneReason };

/** Options shown when nobody passes every rule. */
export const MAX_FALLBACK_OPTIONS = 4;
/** Fillers tried for the seat a moved-up singer leaves (the one with fewest breaks is kept). */
export const MAX_FALLBACK_FILLERS = 3;
/** Broken rules one «Aplicar de todos modos» may waive (the route's cap on `waive`). */
export const MAX_WAIVED = 32;

/**
 * What a build breaks, against `baseline` (the month with the absent person's voice seat merely
 * emptied), on the FINAL board of an option. `null` = the build is dropped: the month could not be
 * judged, its rule table differs, or the service judgement refuses it (a seat clash, an unknown row).
 * Each broken rule is one line: a pair on THIS service is named by the service finding. A newly
 * seated weekend voice (a moved-up singer in their NEW seat included) off the month's v3
 * eligibility drops the build too, unless a per-seat personal rule for that person on that row
 * explains it (that rule is the line).
 */
function breaksOf(input: {
  propose: ProposeInput;
  config: SolverConfig;
  gate: MonthGateInput;
  weekend: boolean;
  next: EditorBoard;
  baseline: MonthCheckVerdict;
  voices: ReadonlyArray<{ id: string; rowId: string }>;
  nameOf: (id: string) => string;
  /** On the solver's pool for that seat before any personal rule (`pooledForRoleKey`). */
  pooled: (id: string, rowId: string) => boolean;
}): Break[] | null {
  const { propose: p, next, baseline } = input;
  const after = verdictOn(next, input.gate);
  if (!after.judged || !baseline.judged || after.ruleIds !== baseline.ruleIds) return null;
  const target = columnTarget(next, p.roleId, p.todayIso);
  if (!target) return null;
  const judged = judgeTarget({ board: p.board, roleId: p.roleId, target, members: [...p.members], config: input.config, todayIso: p.todayIso });
  if (!judged.ok) return null;

  const breaks: Break[] = [];
  const findings = [...judged.judged.added, ...judged.judged.reforced];
  for (const f of findings) breaks.push({ key: `s:${findingKeyText(f.key)}`, line: findingLine(f, input.config, input.nameOf) });
  const servicePair = findings.some((f) => f.key.kind === "pair");
  /**
   * A per-seat personal rule for that person on that row explains why they are off the lists, but
   * only when they are on the seat's pool without it: a «Soporte» singer with a «No líder en
   * domingo» rule is off the Lead list anyway, and is never offered as Lead.
   */
  const excused = (v: { id: string; rowId: string }) => input.pooled(v.id, v.rowId) &&
    findings.some((f) => f.key.kind !== "pair" && f.key.row === v.rowId && f.key.members.includes(v.id));

  const names: V3Names = {
    person: input.nameOf,
    rule: (id) => after.ruleLabels?.get(id) ?? "una regla",
    service: (id) => after.serviceLabels?.get(id) ?? "servicio",
  };
  const ops = new Map((JSON.parse(after.ruleIds) as Array<{ id: string; kind: string; op?: "==" | "<=" | ">=" }>).map((r) => [r.id, r]));
  const before = new Map(baseline.instances.map((x) => [instanceKey(x), x]));
  for (const x of after.instances) {
    const was = before.get(instanceKey(x));
    const rule = ops.get(x.rule);
    const counted = x.family === "count" && rule?.kind === "count";
    const grew = counted && (rule.op === "<=" || rule.op === "==") && (x.observed ?? 0) > (was?.observed ?? 0);
    if (was && !grew) continue;
    if (x.family === "pair" && x.scope === p.roleId && servicePair) continue;
    const line = counted
      ? E.count(names.rule(x.rule), x.scope, rule.op ?? "==", x.observed ?? 0, x.limit ?? 0, x.available ?? 0)
      : x.family === "pair" ? E.pair(names.rule(x.rule), names.service(x.scope))
      : x.family === "presence" ? E.presence(names.rule(x.rule), names.service(x.scope))
      : E.noLead(names.service(x.scope));
    breaks.push({ key: `i:${instanceKey(x)}|${counted ? x.observed ?? 0 : ""}`, line });
  }
  const missedBefore = new Map(baseline.missed.map((x) => [missedKey(x), x]));
  for (const x of after.missed) {
    const was = missedBefore.get(missedKey(x));
    if (was && (x.count ?? 0) <= (was.count ?? 0)) continue;
    breaks.push({
      key: `m:${missedKey(x)}|${x.count ?? ""}`,
      line: missedLine({ code: x.code, person: x.person, month: x.scope, count: x.count, month1: x.month1, month2: x.scope, dates: x.dates }, names),
    });
  }
  // Off the month's v3 eligibility for that seat and not explained by a personal rule on that seat:
  // the person is not on the solver's lists for it at all («Soporte» as Lead). Never offered.
  if (input.weekend && input.voices.some((v) => !(after.eligibility.get(v.id)?.[p.roleId] ?? []).includes(VOICE_ROLE[v.rowId]) && !excused(v))) {
    return null;
  }
  return breaks;
}

/**
 * A personal rule broken on the service, in the rules card's Spanish (`ruleCopy.ts`): «Oto: su regla
 * «No líder en domingo».» / «Su regla «Mar y Noé no coinciden como Lead…»: quedan juntos.». The
 * finding's own sentence when its rule cannot be found (it never names a key).
 */
function findingLine(f: Finding, config: SolverConfig, nameOf: (id: string) => string): string {
  const m = /^(restriction|conflict)\[(\d+)\](?:\.(pattern|week)\[(\d+)\])?$/.exec(f.key.rule);
  const restriction = m?.[1] === "restriction" ? (config.restrictions ?? [])[Number(m[2])] : undefined;
  if (f.key.kind === "exclusion" && restriction && m?.[3] === "pattern") {
    const pattern = restriction.excludedPatterns[Number(m[4])];
    if (pattern) return `${nameOf(f.key.members[0])}: su regla «${exclusionSentence(pattern)}».`;
  }
  if (f.key.kind === "week_exclusion" && restriction && m?.[3] === "week") {
    const we = restriction.weekExclusions[Number(m[4])];
    if (we) return `${nameOf(f.key.members[0])}: su regla «${weekSentence(we)}».`;
  }
  if (f.key.kind === "pair" && m?.[1] === "conflict") {
    const c = (config.conflicts ?? [])[Number(m[2])];
    if (c) return `La regla «${sentenceText(conflictSentence(c))}»: quedan juntos.`;
  }
  return f.key.members.length === 1 ? `${nameOf(f.key.members[0])}: ${f.sentence}.` : `${f.sentence}.`;
}

/** Voice seats a person holds on the board's month: the tie-break between equally bad options. */
const voiceLoad = (board: EditorBoard, memberId: string) =>
  board.cells.filter((c) => isVoiceRow(c.rowId) && c.occupants.some((o) => o.memberId === memberId)).length;

const seatsKey = (seats: readonly SeatChange[]) => seats.map((s) => `${s.rowId}>${s.to ?? ""}`).join(",");

/**
 * When `proposeReplacement` finds nobody for the person's VOICE seat (`no_candidate`): the options
 * that break the fewest rules, each with the rules it breaks, for a person to apply knowingly.
 *
 * The same search as the strict one, relaxed: a direct taker may be someone a personal rule blocks
 * (`seatCandidates` relaxed), and a singer of a lower voice seat may move up (the seat they leave
 * goes to the filler with the fewest breaks among the first `MAX_FALLBACK_FILLERS` strict
 * candidates, or the relaxed ones when there is none). NEVER someone who marked the day, a seat
 * clash, someone already serving that service, a worship night's song lead, or an empty voice seat.
 * The person's instrument or FOH seat is resolved as `proposeReplacement` does. Options are sorted
 * by breaks, then people changed, then the taker's voice seats that month; at most
 * `MAX_FALLBACK_OPTIONS`. A build that breaks nothing (only possible from the two pools' different
 * load orders) or more than `MAX_WAIVED` rules is never an option. `pastDeadline` (the panel's
 * budget) stops the search early with what it has. Under `only` («Aplicar de todos modos») it
 * considers exactly the wanted people, so one read reproduces one option.
 */
export function proposeFallbacks(input: ProposeInput & { nameOf: (id: string) => string; pastDeadline?: () => boolean }): FallbackAnswer {
  const { board, roleId, memberId, todayIso } = input;
  const column = storedColumn(board, roleId);
  if (!column || !board.editable.has(roleId) || column.date < todayIso || !input.config) return { kind: "none", reason: "unchecked" };
  const config = input.config;
  if (isSongLead(input.snapshotRole, memberId)) return { kind: "none", reason: "song_lead" };
  const held = board.rows.filter((r) => occupantsOf(board, roleId, r.id).includes(memberId)).map((r) => r.id);
  if (!held.length) return { kind: "none", reason: "unchecked" };
  // One voice seat (a legacy roster may hold two: never offered, as the writer refuses it too).
  const voiceRows = held.filter(isVoiceRow);
  if (voiceRows.length !== 1) return { kind: "none", reason: "no_candidate" };
  const voiceRow = voiceRows[0];
  const wanted = input.only?.get(voiceRow);
  if (wanted === null) return { kind: "none", reason: "no_candidate" };

  const gate: MonthGateInput = {
    month: column.date.slice(0, 7), todayIso, config, members: input.members, adminRoles: input.adminRoles, ledger: input.ledger,
  };
  const weekend = !isSpecialRoleType(column.type);
  const removed = replaceIn(board, roleId, voiceRow, memberId, null);
  const baseline = verdictOn(removed, gate);
  if (!baseline.judged) return { kind: "none", reason: "unchecked" };

  /** The service findings a board's target adds or reforces, by key; `null` = refused or not judgeable. */
  const findingKeys = (next: EditorBoard): Set<string> | null => {
    const target = columnTarget(next, roleId, todayIso);
    if (!target) return null;
    const judged = judgeTarget({ board, roleId, target, members: [...input.members], config, todayIso });
    return judged.ok ? new Set([...judged.judged.added, ...judged.judged.reforced].map((f) => findingKeyText(f.key))) : null;
  };
  const day = column.type === "saturday_role" ? "Sat" : "Sun";
  const memberById = new Map(input.members.map((m) => [m._id, m]));
  /** On the seat's pool before any personal rule (RES-1, `pooledForRoleKey`). */
  const pooled = (id: string, rowId: string) => {
    const m = memberById.get(id);
    return !!m && pooledForRoleKey(m, config, `${day}.${VOICE_ROLE[rowId]}` as RoleKey);
  };
  type Built = { option: FallbackOption; taker: string; order: number; finalBoard: EditorBoard };
  let order = 0;
  /** One build finished (the other seats) and judged; `null` = dropped. */
  const finish = (voiceBoard: EditorBoard, changes: SeatChange[], voices: ReadonlyArray<{ id: string; rowId: string }>): Built | null => {
    // The person's other seats, as the strict proposal resolves them, except that a candidate
    // passes when it adds nothing BEYOND what the voice build itself breaks (else the voice
    // taker's own rule would reject every bassist and leave the seat empty).
    const voiceKeys = findingKeys(voiceBoard);
    if (!voiceKeys) return null;
    const otherJudge: Judge = (next) => {
      const keys = findingKeys(next);
      return keys && [...keys].every((k) => voiceKeys.has(k)) ? "ok" : "reject";
    };
    let working = voiceBoard;
    const seats = [...changes];
    for (const rowId of held) {
      if (rowId === voiceRow) continue;
      const other = otherSeat(input, otherJudge, working, rowId);
      if (typeof other === "string") return null;
      working = other.board;
      seats.push(...other.changes);
    }
    const breaks = breaksOf({ propose: input, config, gate, weekend, next: working, baseline, voices, nameOf: input.nameOf, pooled });
    const target = columnTarget(working, roleId, todayIso);
    // Never a waiver option without a broken rule (the strict search owns clean proposals), nor
    // one with more breaks than «Aplicar de todos modos» may waive.
    if (!breaks || !target || breaks.length === 0 || breaks.length > MAX_WAIVED) return null;
    return { option: { target, seats, breaks }, taker: voices[0].id, order: order++, finalBoard: working };
  };

  /**
   * Before any limit, keep only who could stand: on the month's v3 eligibility for that seat (it does
   * not depend on the seats), or blocked there by a personal rule while on the seat's pool without it
   * (`breaksOf` decides whether that rule is what keeps them off). Else low-load singers off the
   * lists would use up the tries.
   */
  const couldStand = (rowId: string) => (c: RankedCandidate) =>
    !weekend || (baseline.eligibility.get(c.id)?.[roleId] ?? []).includes(VOICE_ROLE[rowId]) || (!!c.ruleBlockedReason && pooled(c.id, rowId));
  const builds: Built[] = [];
  // Direct: someone free takes the seat.
  const pool = seatCandidates({ ...input, working: removed, rowId: voiceRow, relaxed: true })?.filter(couldStand(voiceRow));
  if (!pool) return { kind: "none", reason: "unchecked" };
  const late = () => input.pastDeadline?.() ?? false;
  for (const c of (wanted ? pool.filter((x) => x.id === wanted) : pool).slice(0, MAX_TRIED_PER_SEAT)) {
    if (late()) break;
    const built = finish(replaceIn(board, roleId, voiceRow, memberId, c.id), [{ rowId: voiceRow, from: memberId, to: c.id }], [{ id: c.id, rowId: voiceRow }]);
    if (built) builds.push(built);
  }
  // Move up: a singer of a lower voice seat takes it, and someone free takes theirs.
  const rank = (r: string) => VOICE_ORDER.indexOf(r);
  const sources = removed.rows.map((r) => r.id).filter((r) =>
    isVoiceRow(r) && rank(r) > rank(voiceRow) && !occupantsOf(board, roleId, r).includes(memberId) && (!input.only || input.only.has(r)));
  let movers = 0;
  for (const from of sources) {
    for (const mover of occupantsOf(removed, roleId, from)) {
      if (movers >= MAX_MOVED_PER_SEAT || late()) break;
      if (mover === memberId || isSongLead(input.snapshotRole, mover)) continue;
      if (wanted !== undefined && mover !== wanted) continue;
      const freed = replaceIn(removed, roleId, from, mover, null);
      if (!seatCandidates({ ...input, working: freed, rowId: voiceRow, relaxed: true })?.filter(couldStand(voiceRow)).some((c) => c.id === mover)) continue;
      movers++;
      const lifted = replaceIn(replaceIn(board, roleId, voiceRow, memberId, mover), roleId, from, mover, null);
      const strict = seatCandidates({ ...input, working: lifted, rowId: from })?.filter(couldStand(from));
      const relaxed = seatCandidates({ ...input, working: lifted, rowId: from, relaxed: true })?.filter(couldStand(from));
      if (!strict || !relaxed) return { kind: "none", reason: "unchecked" };
      const wantedFiller = input.only?.get(from);
      // The first strict fillers; the relaxed ones only when the strict pool is EMPTY.
      const fillers = wantedFiller
        ? relaxed.filter((c) => c.id === wantedFiller)
        : (strict.length ? strict : relaxed).slice(0, MAX_FALLBACK_FILLERS);
      let best: Built | null = null;
      for (const filler of fillers) {
        const next = replaceIn(replaceIn(board, roleId, voiceRow, memberId, mover), roleId, from, mover, filler.id);
        const built = finish(next, [{ rowId: voiceRow, from: memberId, to: mover }, { rowId: from, from: mover, to: filler.id }], [{ id: mover, rowId: voiceRow }, { id: filler.id, rowId: from }]);
        if (built && (!best || built.option.breaks.length < best.option.breaks.length)) best = built;
      }
      if (best) builds.push(best);
    }
  }

  const seen = new Set<string>();
  const options = builds
    .filter((b) => (seen.has(seatsKey(b.option.seats)) ? false : (seen.add(seatsKey(b.option.seats)), true)))
    .sort((a, b) =>
      a.option.breaks.length - b.option.breaks.length
      || a.option.seats.filter((s) => s.to !== null).length - b.option.seats.filter((s) => s.to !== null).length
      || voiceLoad(a.finalBoard, a.taker) - voiceLoad(b.finalBoard, b.taker)
      || a.order - b.order)
    .slice(0, MAX_FALLBACK_OPTIONS)
    .map((b) => b.option);
  return options.length ? { kind: "options", options } : { kind: "none", reason: "no_candidate" };
}
