// app/components/admin/v3SolveRequest.ts
//
// Solver v3 C6 — `buildV3SolveRequest`, the ONE pure builder of the `contract: 3` request (spec §6
// «Provided by C6»). Planner state, the fresh ledger GET, the roles read and the clock (as
// `currentMonth`) in; the request, C6's own notices and refusals, and the run's snapshot out. No React,
// no `fetch`, no clock: its unit tests and C7's Preview rehearsal exercise this same code.
//
// Order (each stage refuses with Spanish lines and stops):
//   1. preReadRefusals — HZ-7, HZ-9, WN-2 (incl. A11); Auto runs these before any read too.
//   2. month sources (RQ-2) — record or IF2-15 body; resolver refusals (§7.9).
//   3. rules (RQ-5) — names exactly once, IF2-17 refusals.
//   4. services (RQ-3, ST-4–ST-7), eligibility (RQ-2), cadence once (RQ-4), the horizon-wide flag check.
//   5. counted-specials pre-fill (SP-1, SP-2) — reads the cadence states.
//   6. pins (RQ-6): stored, counted specials, the board under «Solo llenar vacíos»; the v3 cap.
//   7. people (RQ-4), minted rule ids (RQ-5), C5's limits (RQ-10).
// A refusal while counted specials were waiting adds SP-5's line: nothing of the pre-fill is applied.
// Never called on the v3 path: v2's builder, its omissions, `omittedCapsNotices`, `trailingNotice`.

import {
  CADENCE_OUTSIDE_SENTENCE, cadenceMembers, cadenceOutsideSundayPool, resolveRulePersonId,
} from "@/app/utils/sundayCadence";
import type { FairnessLedgerResponse } from "@/app/utils/fairnessVocabulary";
import type { ParticipantRole } from "@/app/utils/computeParticipation";
import { droppedPinNotices, seatLabel, type DroppedPin, type PinSeat } from "./pinModel";
import { rolesOfPatternV3, type GridCell, type GridColumn, type GridRow, type SolverConfig } from "./plannerModel";
import { horizonRefusal, monthOfDate } from "./v3Horizon";
import { V3_LINES, V3_PIN_CAP, monthsList } from "./v3Copy";
import { dayClass, resolveMonthSources, serviceEligibility, type MonthSource } from "./v3MonthSources";
import { buildV3Prior, buildV3Services, type PlannedColumn, type V3StoredRole } from "./v3Services";
import { buildV3People, carriedPresenceKeys, computeRunCadence, flagDisagreementLines, type RunCadence } from "./v3People";
import { collectV3Rules, emitV3Rules, mintInputOf, ruleReferences } from "./v3Rules";
import { capCardLabel, mintRuleIds, type RuleRefEntry } from "./v3RuleIds";
import { prefillCountedSpecials, type FixedLead } from "./v3Prefill";
import type { V3Pin, V3Role, V3Service, V3SolveRequest } from "./v3Wire";

/** C5 §5.1 — services 1–40, people 1–100 (shared with C2 WR-4), rules 0–500. */
export const V3_LIMITS = { services: 40, people: 100, rules: 500 } as const;

export interface V3Member {
  _id: string;
  member_name: string;
  alias?: string;
  memberType?: string[];
  instruments?: string[];
  unavailableDates?: string[];
  ministries?: unknown;
}

export interface V3BuildInput {
  months: string[];
  currentMonth: string;
  ledger: FairnessLedgerResponse;
  config: SolverConfig;
  members: readonly V3Member[];
  storedRoles: readonly V3StoredRole[];
  planned: { columns: readonly GridColumn[]; cells: readonly GridCell[]; rows: readonly GridRow[] };
  savedWindow: readonly ParticipantRole[];
  fillEmpty: boolean;
  seed: number;
  requestId: string;
}

export interface V3Snapshot {
  requestId: string;
  months: string[];
  /** Each horizon month's source and state as of this run's ledger read — what CF-2 freezes. */
  sources: MonthSource[];
  /** KH-3 — wire id → kind and config ordinal, name-free. */
  ruleTable: RuleRefEntry[];
}

export type V3BuildResult =
  | {
      ok: true;
      request: V3SolveRequest;
      /** The board after the counted-specials pre-fill (only planned special cells change). */
      cells: GridCell[];
      notices: string[];
      snapshot: V3Snapshot;
      ruleLabels: ReadonlyMap<string, string>;
      serviceLabels: ReadonlyMap<string, string>;
      cadence: RunCadence;
      /** `${columnId}|${rowId}` of the planned weekend cells pinned under «Solo llenar vacíos». */
      boardPinnedCellKeys: ReadonlySet<string>;
      storedServiceIds: ReadonlySet<string>;
    }
  | { ok: false; lines: string[] };

const displayName = (m: V3Member) => m.alias?.trim() || m.member_name;
const VOICE_ROWS: ReadonlyArray<{ rowId: string; role: V3Role }> = [
  { rowId: "lead", role: "Lead" }, { rowId: "bgv", role: "BGV" }, { rowId: "coro", role: "Choir" },
];

/** HZ-7, HZ-9 and WN-2 — Auto refuses on any of these before any read. */
export function preReadRefusals(input: {
  months: readonly string[];
  currentMonth: string;
  config: SolverConfig;
  members: readonly V3Member[];
}): string[] {
  const horizon = horizonRefusal(input.months, input.currentMonth);
  if (horizon) return [horizon.kind === "past" ? V3_LINES.horizonPast : V3_LINES.horizonCeiling(horizon.month, horizon.limit)];
  const roster = [...input.members];
  const { ids, refusals } = cadenceMembers(input.config, roster);
  const lines = refusals.map((r) =>
    V3_LINES.cadenceName(r.person, r.reason === "unresolved" ? V3_LINES.cadenceNameNone : V3_LINES.cadenceNameMany(r.matches.length)));
  input.config.restrictions.forEach((r, ri) => {
    r.caps.forEach((c, ci) => {
      if (c.op !== "==" || !rolesOfPatternV3(c.pattern).includes("Sun.Lead")) return;
      const who = resolveRulePersonId(r.person, roster);
      if (!who.ok || !ids.includes(who.id)) return;
      const member = roster.find((m) => m._id === who.id)!;
      lines.push(V3_LINES.cadenceAndExact(displayName(member), capCardLabel(input.config, ri, ci)));
    });
  });
  return lines;
}

export function limitRefusals(counts: { services: number; people: number; rules: number }): string[] {
  const out: string[] = [];
  if (counts.services > V3_LIMITS.services) out.push(V3_LINES.tooLarge("servicios", counts.services, V3_LIMITS.services));
  if (counts.people > V3_LIMITS.people) out.push(V3_LINES.tooLarge("personas", counts.people, V3_LIMITS.people));
  if (counts.rules > V3_LIMITS.rules) out.push(V3_LINES.tooLarge("reglas", counts.rules, V3_LIMITS.rules));
  return out;
}

/** The voice occupants of one planned column as pins: one per person (Lead > BGV > Choir); duplicates reported. */
function pinsOfColumn(
  column: GridColumn, service: V3Service, cells: readonly GridCell[], memberIds: ReadonlySet<string>, nameOf: (id: string) => string,
): { pins: V3Pin[]; dropped: DroppedPin[]; nonMember: PinSeat | null; keys: string[] } {
  const pins: V3Pin[] = [];
  const dropped: DroppedPin[] = [];
  const keys: string[] = [];
  const seen = new Map<string, PinSeat>();
  for (const { rowId, role } of VOICE_ROWS) {
    if (role === "Choir" && service.kind === "saturday" && !service.fixed) continue;
    const cell = cells.find((c) => c.columnId === column.columnId && c.rowId === rowId);
    const occurrences = new Map<string, number>();
    for (const o of cell?.occupants ?? []) {
      const occurrence = occurrences.get(o.memberId) ?? 0;
      occurrences.set(o.memberId, occurrence + 1);
      const seat: PinSeat = { columnId: column.columnId, rowId, memberId: o.memberId, occurrence };
      if (!memberIds.has(o.memberId)) return { pins, dropped, nonMember: seat, keys };
      const kept = seen.get(o.memberId);
      if (kept) {
        dropped.push({ ...seat, person: nameOf(o.memberId), kept });
        continue;
      }
      seen.set(o.memberId, seat);
      pins.push({ service: service.id, date: service.date, role, person: o.memberId });
      if (!keys.includes(`${column.columnId}|${rowId}`)) keys.push(`${column.columnId}|${rowId}`);
    }
  }
  return { pins, dropped, nonMember: null, keys };
}

export function buildV3SolveRequest(input: V3BuildInput): V3BuildResult {
  const { months, config, ledger } = input;
  const members = [...input.members];
  const memberIds = new Set(members.map((m) => m._id));
  const nameOf = (id: string) => {
    const m = members.find((x) => x._id === id);
    return m ? displayName(m) : (ledger.people.find((p) => p.memberId === id)?.name || "alguien que ya no está en la lista");
  };
  const plannedColumns = input.planned.columns.filter((c) => months.includes(monthOfDate(c.date)));
  const specialsWaiting = plannedColumns.some((c) => c.type === "special_role" && c.countsForFairness);
  const refuse = (lines: string[]): V3BuildResult =>
    ({ ok: false, lines: specialsWaiting ? [...lines, V3_LINES.prefillNotRun] : lines });

  // 1. Before any read (Auto has already run these; repeated here so the builder stands alone).
  const pre = preReadRefusals({ months, currentMonth: input.currentMonth, config, members });
  if (pre.length > 0) return refuse(pre);

  // 2. One source per month (RQ-2).
  const exactLeadLabel = (person: string): string | null => {
    for (let ri = 0; ri < config.restrictions.length; ri++) {
      const r = config.restrictions[ri];
      if (r.person !== person) continue;
      const ci = r.caps.findIndex((c) => c.op === "==" && rolesOfPatternV3(c.pattern).includes("Sun.Lead"));
      if (ci !== -1) return capCardLabel(config, ri, ci);
    }
    return null;
  };
  const sourcesOut = resolveMonthSources({ months, ledger, config, members, exactLeadLabel });
  if (!sourcesOut.ok) return refuse(sourcesOut.lines);
  const sources = sourcesOut.sources;
  const sourceByMonth = new Map(sources.map((s) => [s.month, s]));

  // 3. Rules (RQ-5), before anything else is built from them.
  const collected = collectV3Rules({ months, sources, config, members });
  if (!collected.ok) return refuse(collected.lines);

  // 4. Services, eligibility, cadence, the horizon-wide flag check.
  const planned: PlannedColumn[] = plannedColumns.map((c) => ({
    columnId: c.columnId, date: c.date, type: c.type, serviceName: c.serviceName, time: c.time, countsForFairness: c.countsForFairness,
  }));
  const target = (rowId: string) => input.planned.rows.find((r) => r.id === rowId)?.target ?? 0;
  const built = buildV3Services({
    months, stored: input.storedRoles, planned, seats: { Lead: target("lead"), BGV: target("bgv"), Choir: target("coro") }, memberIds, nameOf,
  });
  const serviceById = new Map(built.services.map((s) => [s.id, s]));
  const liveUnavailable = new Map(members.map((m) => [m._id, m.unavailableDates ?? []]));
  const listedIds = new Set(sources.flatMap((s) => s.body.people.map((p) => p.memberId)));
  const eligibility = new Map<string, Record<string, V3Role[]>>();
  for (const id of listedIds) {
    const byService: Record<string, V3Role[]> = {};
    for (const svc of built.services) {
      const roles = serviceEligibility(sourceByMonth.get(svc.month)!, id, svc, liveUnavailable.get(id) ?? []);
      if (roles.length > 0) byService[svc.id] = roles;
    }
    eligibility.set(id, byService);
  }
  const prior = buildV3Prior(months[0], input.storedRoles);
  const disagreements = flagDisagreementLines({ sources, ids: listedIds, nameOf });
  if (disagreements.length > 0) return refuse(disagreements);
  const cadence = computeRunCadence({ months, sources, ledger, services: built.services, eligibility, priorMonth: prior.month });

  // 5. Board pins (RQ-6, ST-9) are fixed before the pre-fill, which judges protections against them.
  const boardPins: V3Pin[] = [];
  const dropped: DroppedPin[] = [];
  const boardPinnedCellKeys = new Set<string>();
  if (input.fillEmpty) {
    for (const column of plannedColumns) {
      const service = serviceById.get(column.columnId);
      if (!service || service.fixed) continue;
      const out = pinsOfColumn(column, service, input.planned.cells, memberIds, nameOf);
      if (out.nonMember) return refuse([V3_LINES.boardNonMember(seatLabel(out.nonMember, [...plannedColumns], [...input.planned.rows]))]);
      boardPins.push(...out.pins);
      dropped.push(...out.dropped);
      out.keys.forEach((k) => boardPinnedCellKeys.add(k));
    }
  }
  const leadOf = (pins: V3Pin[]): FixedLead[] => pins.flatMap((p) => {
    const svc = serviceById.get(p.service);
    return p.role === "Lead" && svc?.counts ? [{ date: p.date, memberId: p.person, dl: dayClass(svc.kind, p.date) === "Sun" }] : [];
  });
  const specialColumns = built.plannedSpecialIds.map((id) => plannedColumns.find((c) => c.columnId === id)!);
  const handPlacedSpecialLeads: FixedLead[] = specialColumns.flatMap((c) =>
    (input.planned.cells.find((x) => x.columnId === c.columnId && x.rowId === "lead")?.occupants ?? [])
      .map((o) => ({ date: c.date, memberId: o.memberId, dl: dayClass("special", c.date) === "Sun" })));
  const priorLeads: FixedLead[] = prior.services.filter((s) => s.counts).flatMap((s) =>
    s.seats.Lead.map((memberId) => ({ date: s.date, memberId, dl: dayClass(s.kind, s.date) === "Sun" })));

  // 6. The counted-specials pre-fill (SP-1, SP-2), then their pins.
  const prefill = prefillCountedSpecials({
    targets: specialColumns.map((c) => ({ columnId: c.columnId, date: c.date, month: monthOfDate(c.date), label: built.labels.get(c.columnId) ?? c.columnId })),
    columns: plannedColumns, rows: input.planned.rows, cells: input.planned.cells, members, savedWindow: input.savedWindow, config,
    eligibility, sources: sourceByMonth, cadence, ledger,
    fixedLeads: [...leadOf(built.storedPins), ...leadOf(boardPins), ...handPlacedSpecialLeads, ...priorLeads],
    nameOf,
  });
  const specialPins: V3Pin[] = [];
  for (const column of specialColumns) {
    const out = pinsOfColumn(column, serviceById.get(column.columnId)!, prefill.cells, memberIds, nameOf);
    if (out.nonMember) return refuse([V3_LINES.boardNonMember(seatLabel(out.nonMember, [...plannedColumns], [...input.planned.rows]))]);
    specialPins.push(...out.pins);
    dropped.push(...out.dropped);
  }
  const pins = [...built.storedPins, ...specialPins, ...boardPins];
  if (pins.length > V3_PIN_CAP) return refuse([V3_LINES.pinCap(pins.length, V3_PIN_CAP)]);

  // 7. People, minted ids, rules, limits.
  const extraIds = new Set<string>([...pins.map((p) => p.person), ...collected.rulePersons]);
  const sentIds = new Set<string>(extraIds);
  for (const [id, byService] of eligibility) if (Object.keys(byService).length > 0) sentIds.add(id);
  const carriedKeys = carriedPresenceKeys(ledger, sentIds);
  const ids = mintRuleIds(config, mintInputOf(collected.rules, carriedKeys));
  const peopleOut = buildV3People({
    months, sources, ledger, members, eligibility, extraIds, cadence, presenceId: (k) => ids.presence(k), priorMonth: prior.month,
  });
  if (!peopleOut.ok) return refuse(peopleOut.lines);
  const rules = emitV3Rules(collected.rules, ids);
  const limits = limitRefusals({ services: built.services.length, people: peopleOut.people.length, rules: rules.length });
  if (limits.length > 0) return refuse(limits);
  const { labels, table } = ruleReferences(collected.rules, ids, config, ledger, carriedKeys);

  // C6's own notices, in a stable order (NT-3): WN-1, WN-3, ST-5/ST-6, RQ-5, SP-6/SP-7, duplicate pins.
  const unbound = sources.filter((s) => s.state !== "bound").map((s) => s.month);
  const wn1 = unbound.length === 0 ? [] : cadenceOutsideSundayPool(config, members)
    .map((x) => `${monthsList(unbound, true)}: ${CADENCE_OUTSIDE_SENTENCE[x.reason](x.name)}`);
  const wn3 = config.saturdayLeads.length > 0 ? [V3_LINES.saturdayPool] : [];
  const notices = [
    ...wn1, ...wn3, ...built.notices, ...collected.notices, ...prefill.notices,
    ...droppedPinNotices({ dropped, columns: [...plannedColumns], rows: [...input.planned.rows], members }),
  ];

  const request: V3SolveRequest = {
    contract: 3,
    seed: input.seed,
    request_id: input.requestId,
    months: [...months],
    services: built.services,
    people: peopleOut.people,
    rules,
    pins,
    prior,
  };
  return {
    ok: true,
    request,
    cells: prefill.cells,
    notices,
    snapshot: { requestId: input.requestId, months: [...months], sources, ruleTable: table },
    ruleLabels: labels,
    serviceLabels: built.labels,
    cadence,
    boardPinnedCellKeys,
    storedServiceIds: built.storedServiceIds,
  };
}
