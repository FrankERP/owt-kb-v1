// The MCP proposal editor's month check (plan E5, T2.4, A1–A3): does Frank's board meet the rules
// AS WRITTEN — caps, presence, pairs, the solver's protections, a Lead on every service, the voice
// seats against the solve's targets, people seated on a day they marked unavailable, and each
// person's seats against the fairness share. Warnings, never refusals: the month is his.
//
// Two layers, so the parity fixtures cover what production runs:
//   · the judging core over the solver's wire (`monthCheckCore.ts`, held to `checker.py`);
//   · this ADAPTER, which builds that wire with THE request builder (`buildV3SolveRequest`, as the
//     solve did) over the replayed board, then overrides what the check needs (A2): every PLANNED
//     service `fixed: false` with no pins, and the board's seats as its assignments, so a counted
//     special is judged on what Frank left in it, not on the builder's pre-fill. A STORED service
//     keeps the builder's form (fixed, its seats as pins and as assignments): it is not on the board,
//     its pins ARE its seats, and the checker's `could` reads them.
//
// Eligibility, `==` rules and presence come from the proposal's FROZEN entries (A1): the builder is
// handed a synthetic ledger whose horizon months are bound to them. The fresh ledger feeds only
// `people` (cadence, exemptions, `dl_since`, `prev_dl_leads`) — so the protections are judged
// «según el registro de hoy» — and, through the shared assembly, the fair-share lines. If it
// failed, everything that does not read it is still judged and the check is «sin revisar» (E7).
// A builder refusal is «sin revisar» too, with its own lines (A3); the board's own lines stay.
//
// Pure: the tools do the reads.

import type { ParticipantRole } from "@/app/utils/computeParticipation";
import { formatFairnessTenths } from "@/app/utils/fairnessFormat";
import type { LedgerService } from "@/app/utils/fairnessLedger";
import type { assembleFairnessLedger } from "@/app/utils/fairnessLedgerRead";
import type { FairnessLedgerResponse, LogicalRecord, RecordEnvironment } from "@/app/utils/fairnessVocabulary";
import { columnShowsRowId, type SolverConfig } from "@/app/components/admin/plannerModel";
import type { V3ConfirmEntry } from "@/app/components/admin/v3Confirm";
import { V3_EDITOR_LINES as E, missedLine, type V3Names } from "@/app/components/admin/v3Copy";
import { buildV3SolveRequest, type V3Member } from "@/app/components/admin/v3SolveRequest";
import type { V3StoredRole } from "@/app/components/admin/v3Services";
import type { V3Role, V3SolveRequest } from "@/app/components/admin/v3Wire";
import { judgeMonthWire, type CheckAssignments, type CheckRequest } from "./monthCheckCore";
import type { EditorBoard } from "./editorBoard";
import { draftLabel } from "./labels";

export type FairShareLedger = ReturnType<typeof assembleFairnessLedger>;

export interface MonthCheckInput {
  months: readonly string[];
  currentMonth: string;
  entries: readonly V3ConfirmEntry[];
  board: EditorBoard;
  config: SolverConfig;
  /** The fresh pool. */
  members: readonly V3Member[];
  /** The roles read (the admin rows), as the solve's `storedRoles`. */
  storedRoles: readonly V3StoredRole[];
  savedWindow: readonly ParticipantRole[];
  /** The fresh ledger (`loadV3Ledger`); `null` = the read failed. */
  ledger: FairnessLedgerResponse | null;
  /** The ledger for the month after the horizon over the board (`fairShareAdjust`); `null` = failed. */
  fairShare: FairShareLedger | null;
}

export interface MonthCheck {
  /** `false` = «sin revisar» (E7, A3). */
  checked: boolean;
  /** The first lines: why it is «sin revisar», what was omitted. */
  notes: string[];
  rules: string[];
  services: string[];
  fairness: string[];
}

const VOICE: ReadonlyArray<{ rowId: string; role: V3Role }> = [
  { rowId: "lead", role: "Lead" }, { rowId: "bgv", role: "BGV" }, { rowId: "coro", role: "Choir" },
];
const FAIR_LINES = ["DL", "SL", "BGV", "CORO"] as const;

const displayName = (m: V3Member) => m.alias?.trim() || m.member_name;

/** The frozen entry as the record the synthetic ledger binds its month to (A1). */
function frozenRecord(entry: V3ConfirmEntry, environment: RecordEnvironment, nameOf: (id: string) => string): LogicalRecord {
  return {
    month: entry.month,
    rev: entry.write.expectedRev ?? "proposal",
    contentHash: "proposal",
    source: entry.write.source,
    engine: "v3",
    environment,
    recordedAt: "",
    people: entry.write.people.map((p) => ({ ...p, name: nameOf(p.memberId) })),
    presence: entry.write.presence,
  };
}

/** A ledger whose horizon is bound to the frozen entries; `people` from the fresh read, or none. */
function syntheticLedger(input: MonthCheckInput, nameOf: (id: string) => string): FairnessLedgerResponse {
  const base: FairnessLedgerResponse = input.ledger ?? {
    v: 1, engine: "v3", environment: "production", currentMonth: input.currentMonth, target: input.months[0],
    window: [], recordsSince: null, balanceStart: null, horizon: [], people: [],
    diagnostics: { duplicateTargets: [], notInRecordSeats: 0, unknownMembers: [] },
  };
  return {
    ...base,
    horizon: input.entries.map((entry) => ({
      month: entry.month, record: frozenRecord(entry, base.environment, nameOf), storedServices: 1, recordBinds: true,
    })),
  };
}

/**
 * What the fair-share read replaces and adds (T2.4): each horizon month's stored record → its frozen
 * entry, and every editable draft as a service, seated as the board holds it.
 */
export function fairShareAdjust(input: {
  months: readonly string[];
  entries: readonly V3ConfirmEntry[];
  board: EditorBoard;
  environment: RecordEnvironment;
  nameOf: (id: string) => string;
}): (stored: { records: LogicalRecord[]; services: LedgerService[] }) => { records: LogicalRecord[]; services: LedgerService[] } {
  return (stored) => {
    const records = [
      ...stored.records.filter((r) => !input.months.includes(r.month)),
      ...input.entries.map((e) => frozenRecord(e, input.environment, input.nameOf)),
    ];
    const services: LedgerService[] = [...stored.services];
    for (const column of input.board.columns) {
      const localId = input.board.localIdOf.get(column.columnId)!;
      if (!input.board.editable.has(localId)) continue;
      const seat = (rowId: string) =>
        input.board.cells.find((c) => c.columnId === column.columnId && c.rowId === rowId)?.occupants.map((o) => o.memberId) ?? [];
      services.push({
        _id: `proposal.${localId}`,
        _type: column.type,
        date: column.date,
        published: false,
        countsForFairness: column.countsForFairness,
        Lead: seat("lead"),
        BGVs: seat("bgv"),
        Chorus: columnShowsRowId(column.type, "coro") ? seat("coro") : [],
      });
    }
    return { records, services };
  };
}

/** The lines the board itself gives, whatever the reads did: Lead, voice seats, unavailable people. */
function boardLines(input: MonthCheckInput, person: (id: string) => string): string[] {
  const { board } = input;
  const lines: string[] = [];
  for (const column of board.columns) {
    if (!board.editable.has(board.localIdOf.get(column.columnId)!)) continue;
    const label = draftLabel({ _type: column.type, date: column.date, service_name: column.serviceName });
    const held = (rowId: string) => board.cells.find((c) => c.columnId === column.columnId && c.rowId === rowId)?.occupants ?? [];
    if (held("lead").length === 0) lines.push(E.noLead(label));
    for (const { rowId } of VOICE) {
      const row = board.rows.find((r) => r.id === rowId);
      if (!row || row.target === null || !columnShowsRowId(column.type, rowId)) continue;
      const n = held(rowId).length;
      if (n < row.target && !(rowId === "lead" && n === 0)) lines.push(E.seats(label, row.label, n, row.target));
    }
    for (const cell of board.cells.filter((c) => c.columnId === column.columnId)) {
      for (const o of cell.occupants) {
        const m = input.members.find((x) => x._id === o.memberId);
        if (m?.unavailableDates?.includes(column.date)) lines.push(E.unavailableSeated(person(o.memberId), label));
      }
    }
  }
  return [...new Set(lines)];
}

/** The fair-share lines: per person and horizon month, the ledger's own seats against its share. */
function fairnessLines(fair: FairShareLedger, months: readonly string[]): string[] {
  const lines: Array<{ text: string; gap: number }> = [];
  for (const p of fair.people) {
    for (const pm of p.months) {
      if (!months.includes(pm.month)) continue;
      let seats = 0;
      let share = 0;
      let received = 0;
      for (const line of FAIR_LINES) {
        const f = pm.lines[line];
        if (!f) continue;
        seats += f.seats;
        share += f.share;
        received += f.received;
      }
      // A full seat apart, in hundredths — the ledger's own figures, never re-derived.
      if (Math.abs(received - share) < 100) continue;
      lines.push({ text: E.fairShare(p.name, pm.month, seats, formatFairnessTenths(Math.round(share / 10))), gap: Math.abs(received - share) });
    }
  }
  return lines.sort((a, b) => b.gap - a.gap).map((l) => l.text);
}

export function monthCheck(input: MonthCheckInput): MonthCheck {
  const { board, months } = input;
  const memberById = new Map(input.members.map((m) => [m._id, m]));
  const person = (id: string) => {
    const m = memberById.get(id);
    return m ? displayName(m) : (input.ledger?.people.find((p) => p.memberId === id)?.name || "alguien que ya no está en la lista");
  };
  const services = boardLines(input, person);
  const notes: string[] = [];
  const rules: string[] = [];
  let fairness: string[] = [];
  let checked = input.ledger !== null;
  if (!checked) notes.push(E.unchecked, E.omittedLedger);

  const plannedColumns = board.columns.filter((c) => board.editable.has(board.localIdOf.get(c.columnId)!));
  if (plannedColumns.some((c) => c.type === "special_role" && !c.countsForFairness)) notes.push(E.uncountedSpecials);

  const built = buildV3SolveRequest({
    months: [...months],
    currentMonth: input.currentMonth,
    ledger: syntheticLedger(input, person),
    config: input.config,
    members: input.members,
    storedRoles: input.storedRoles,
    planned: { columns: plannedColumns, cells: board.cells, rows: board.rows },
    savedWindow: input.savedWindow,
    fillEmpty: false,
    seed: 0,
    requestId: "month-check",
  });
  if (!built.ok) {
    if (checked) notes.push(E.uncheckedBuild);
    checked = false;
    return { checked, notes: [...notes, ...built.lines], rules, services, fairness };
  }

  const { request, assignments } = checkWire(built.request, plannedColumns.map((c) => c.columnId), board);
  const verdict = judgeMonthWire(request, assignments);
  const names: V3Names = {
    person,
    rule: (id) => built.ruleLabels.get(id) ?? "una regla",
    service: (id) => built.serviceLabels.get(id) ?? "servicio",
  };
  for (const x of verdict.instances) {
    const rule = request.rules.find((r) => r.id === x.rule);
    if (x.family === "count" && rule?.kind === "count") {
      rules.push(E.count(names.rule(x.rule), x.scope, rule.op, x.observed ?? 0, x.limit ?? 0, x.available ?? 0));
    } else if (x.family === "pair") rules.push(E.pair(names.rule(x.rule), names.service(x.scope)));
    else if (x.family === "presence") rules.push(E.presence(names.rule(x.rule), names.service(x.scope)));
    // `mandatory_lead`: the board's own «sin Lead» line covers every draft (A2).
  }
  if (input.ledger) {
    const missed = verdict.missed.map((m) =>
      missedLine({ code: m.code, person: m.person, month: m.scope, count: m.count, month1: m.month1, month2: m.scope, dates: m.dates }, names));
    if (missed.length) rules.push(...missed, E.ledgerToday);
  }
  if (input.fairShare) fairness = fairnessLines(input.fairShare, months);
  else if (input.ledger) {
    // The GET read succeeded but the fair-share read did not: still «sin revisar» (E7).
    checked = false;
    notes.push(E.unchecked);
  }
  return { checked, notes, rules, services, fairness };
}

/**
 * A2's override of the builder's wire: planned services `fixed: false` and unpinned; the board's
 * voice seats as their assignments; a stored service as the builder left it, its pins as its seats.
 */
export function checkWire(
  request: V3SolveRequest,
  plannedIds: readonly string[],
  board: EditorBoard,
): { request: CheckRequest; assignments: CheckAssignments } {
  const planned = new Set(plannedIds);
  const assignments: Record<string, Partial<Record<V3Role, string[]>>> = {};
  for (const pin of request.pins) {
    if (planned.has(pin.service)) continue;
    ((assignments[pin.service] ??= {})[pin.role] ??= []).push(pin.person);
  }
  for (const id of planned) {
    const seats: Partial<Record<V3Role, string[]>> = {};
    for (const { rowId, role } of VOICE) {
      const held = board.cells.find((c) => c.columnId === id && c.rowId === rowId)?.occupants.map((o) => o.memberId) ?? [];
      if (held.length) seats[role] = held;
    }
    assignments[id] = seats;
  }
  return {
    request: {
      months: request.months,
      services: request.services.map((s) => (planned.has(s.id) ? { ...s, fixed: false } : s)),
      people: request.people,
      rules: request.rules,
      pins: request.pins.filter((p) => !planned.has(p.service)),
      prior: request.prior,
    },
    assignments,
  };
}

export const monthCheckLines = (c: MonthCheck): string[] => [
  ...c.notes,
  ...(c.rules.length ? [E.groupRules, ...c.rules] : []),
  ...(c.services.length ? [E.groupServices, ...c.services] : []),
  ...(c.fairness.length ? [E.groupFairness, ...c.fairness] : []),
  ...(c.checked && !c.rules.length && !c.services.length ? [E.allClear] : []),
];
