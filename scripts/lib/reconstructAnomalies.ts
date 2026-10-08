// scripts/lib/reconstructAnomalies.ts
//
// R13's anomalies (solver v3 C4): listed, never resolved. Seats are only C2's kept and
// second seats (IF2-11); seat counts and set-asides are only C2's ledger output
// (IF2-10); nothing here counts or weighs a seat. `rule_split` and `person_added`
// come from `transformMonth`, which made those changes.
//
// The record a month's anomalies read is the one the month will hold after the plan
// is applied (R11's preview rule): the planned body for «crear»/«reemplazar»/«sin
// cambios», the stored record for the two «no se toca» rows.

import { keepVoiceSeats, type LedgerService } from "../../app/utils/fairnessLedger";
import {
  SATURDAY_KEYS,
  SUNDAY_KEYS,
  compareCodepoint,
  type FairnessLedgerResponse,
  type FairnessMonthBody,
  type LogicalRecord,
  type RoleKey,
} from "../../app/utils/fairnessVocabulary";
import { countedServiceDays, type SeatJoins } from "./reconstructInference";
import type { MemberOverride } from "./reconstructOverrides";
import { ANOMALY_CODES, LINES, LINE_ROLES, type Anomaly, type Line } from "./reconstructTypes";

type RecordContent = Pick<FairnessMonthBody, "people" | "presence">;

export function monthAnomalies(input: {
  month: string;
  record: RecordContent;
  services: readonly LedgerService[];
  ledger: Pick<FairnessLedgerResponse, "people" | "diagnostics">;
  rosterIds: ReadonlySet<string>;
  presenceOrdinal: (ruleKey: string) => string | undefined;
}): Anomaly[] {
  const { month, record } = input;
  const out: Anomaly[] = [];
  const people = new Map(record.people.map((p) => [p.memberId, p]));
  const status = (id: string, k: RoleKey) => people.get(id)?.roles[k] ?? "out";
  const cadence = (id: string) => people.get(id)?.sundayCadence === "alternate";
  const { kept, secondSeats, duplicateTargets } = keepVoiceSeats([...input.services]);
  const days = countedServiceDays(input.services);
  const weekend = new Set(days.filter((d) => d.weekend).map((d) => d.id));

  // Seats against the record: out, unavailable, rule-excluded (weekend services only, A13).
  for (const seat of kept) {
    if (!input.rosterIds.has(seat.memberId)) continue; // a deleted or non-worship holder is `member_gone`
    const at = { month, memberId: seat.memberId, date: seat.date, roleKey: seat.roleKey, serviceId: seat.serviceId };
    if (status(seat.memberId, seat.roleKey) === "out") out.push({ code: "seat_while_out", ...at });
    const blocks = people.get(seat.memberId)?.blocks ?? [];
    if (blocks.some((b) => b.date === seat.date && b.unavailable)) out.push({ code: "seat_unavailable", ...at });
    if (weekend.has(seat.serviceId) && blocks.some((b) => b.date === seat.date && b.excludedRoles.includes(seat.roleKey))) {
      out.push({ code: "seat_rule_excluded", ...at });
    }
  }
  for (const seat of secondSeats) {
    out.push({ code: "second_seat", month, memberId: seat.memberId, date: seat.date, roleKey: seat.roleKey, serviceId: seat.serviceId });
  }
  for (const d of duplicateTargets) out.push({ code: "duplicate_target", month, type: d.type, date: d.date, roleIds: d.roleIds });

  // R7 — an exact rule against the seats held (the ledger's integer `held`), and R6's kept setting.
  for (const p of record.people) {
    const held = input.ledger.people.find((x) => x.memberId === p.memberId)?.months.find((m) => m.month === month)?.held ?? {};
    for (const rule of p.exactRules) {
      const n = rule.roles.reduce((sum, k) => sum + (held[k] ?? 0), 0);
      if (n !== rule.count) out.push({ code: "exact_mismatch", month, memberId: p.memberId, roles: rule.roles, count: rule.count, held: n });
    }
    if (p.sundayCadence === "alternate" && p.roles["Sun.Lead"] !== "in") out.push({ code: "cadence_not_in", month, memberId: p.memberId });
  }

  // Presence (C2 LG-7): a counted weekend service where the rule applies and no rule
  // member holds a non-fixed seat of its roles; and the ledger's `outside_population`
  // presence seats.
  for (const rule of record.presence) {
    const ordinal = input.presenceOrdinal(rule.ruleKey);
    const named = { ruleKey: rule.ruleKey, ...(ordinal ? { ruleOrdinal: ordinal } : {}) };
    for (const day of days) {
      if (!day.weekend) continue;
      const roles = (day.sunday ? SUNDAY_KEYS : SATURDAY_KEYS).filter((k) => rule.roles.includes(k));
      if (roles.length === 0) continue;
      const hasSeat = kept.some(
        (x) =>
          x.serviceId === day.id &&
          roles.includes(x.roleKey) &&
          rule.members.includes(x.memberId) &&
          status(x.memberId, x.roleKey) !== "exact" &&
          !(x.roleKey === "Sun.Lead" && cadence(x.memberId)),
      );
      if (!hasSeat) out.push({ code: "presence_no_seat", month, ...named, date: day.date, serviceId: day.id });
    }
    for (const person of input.ledger.people) {
      for (const note of person.months.find((m) => m.month === month)?.notes ?? []) {
        if (note.code === "outside_population" && note.line === `P:${rule.ruleKey}`) {
          out.push({ code: "presence_outside", month, ...named, memberId: person.memberId, dates: note.dates });
        }
      }
    }
  }

  // «miembro eliminado o fuera de alabanza»: exactly IF2-8 `diagnostics.unknownMembers`.
  for (const id of input.ledger.diagnostics.unknownMembers) out.push({ code: "member_gone", month, memberId: id });
  return out;
}

/** Whether a body lists the member with some role of the line not "out". */
const lineOpen = (body: FairnessMonthBody | undefined, memberId: string, line: Line) => {
  const p = body?.people.find((x) => x.memberId === memberId);
  return !!p && LINE_ROLES[line].some((k) => p.roles[k] !== "out");
};

/**
 * R13's two pool anomalies, per person and line, over the requested months. `hypothetical`
 * is R4's resolver output (before R5); `actual` is the same rules over today's REAL pools —
 * so «ticked in a pool C2 RES-1 maps to a role of the line» is C2's own mapping, not a copy.
 */
export function poolAnomalies(input: {
  months: readonly string[];
  hypothetical: ReadonlyMap<string, FairnessMonthBody>;
  actual: ReadonlyMap<string, FairnessMonthBody>;
  seatJoins: SeatJoins;
  overrides: readonly MemberOverride[];
  cadenceIds: ReadonlySet<string>;
}): Anomaly[] {
  const ids = new Set<string>();
  for (const body of [...input.hypothetical.values(), ...input.actual.values()]) for (const p of body.people) ids.add(p.memberId);
  const out: Anomaly[] = [];
  for (const id of [...ids].sort(compareCodepoint)) {
    const override = input.overrides.find((o) => o.memberId === id);
    for (const line of LINES) {
      const notTicked = input.months.filter((m) => lineOpen(input.hypothetical.get(m), id, line) && !lineOpen(input.actual.get(m), id, line));
      if (notTicked.length > 0) out.push({ code: "not_ticked_today", month: null, memberId: id, line, months: notTicked });
      if (line === "DL" && input.cadenceIds.has(id)) continue; // R6: not join-bounded
      if (input.seatJoins.get(id)?.[line] !== undefined || override?.joinMonths[line] !== undefined) continue;
      const ticked = input.months.filter((m) => lineOpen(input.actual.get(m), id, line));
      if (ticked.length > 0) out.push({ code: "ticked_never_seated", month: null, memberId: id, line, months: ticked });
    }
  }
  return out;
}

/** R13: a join month inside the run whose first seat is not that month's first counted service of the line. */
export function joinAnomalies(input: {
  months: readonly string[];
  seatJoins: SeatJoins;
  joinWindow: readonly LedgerService[];
  resolverIds: ReadonlyMap<string, ReadonlySet<string>>;
  overrides: readonly MemberOverride[];
  cadenceIds: ReadonlySet<string>;
}): Anomaly[] {
  const days = countedServiceDays(input.joinWindow);
  const firstOf = (month: string, line: Line) =>
    days.find((d) => d.date.slice(0, 7) === month && (line === "DL" ? d.sunday : line === "SL" ? !d.sunday : true))?.date;
  const out: Anomaly[] = [];
  for (const [id, lines] of [...input.seatJoins].sort(([a], [b]) => compareCodepoint(a, b))) {
    const override = input.overrides.find((o) => o.memberId === id);
    for (const line of LINES) {
      const join = lines[line];
      if (!join || !input.months.includes(join.month)) continue;
      if (!input.resolverIds.get(join.month)?.has(id)) continue;
      if (override?.joinMonths[line] !== undefined) continue;
      if (line === "DL" && input.cadenceIds.has(id)) continue;
      const first = firstOf(join.month, line);
      if (first !== undefined && first !== join.firstSeatDate) {
        out.push({ code: "join_mid_month", month: join.month, memberId: id, line, date: join.firstSeatDate, firstServiceDate: first });
      }
    }
  }
  return out;
}

/** R13 «fecha bloqueada perdida»: an unavailable date the existing record holds and the planned replace drops. */
export function lostBlocks(month: string, existing: LogicalRecord, planned: FairnessMonthBody): Anomaly[] {
  const out: Anomaly[] = [];
  for (const p of existing.people) {
    const next = planned.people.find((x) => x.memberId === p.memberId);
    for (const b of p.blocks) {
      if (!b.unavailable) continue;
      if (next?.blocks.some((x) => x.date === b.date && x.unavailable)) continue;
      out.push({ code: "lost_block", month, memberId: p.memberId, date: b.date });
    }
  }
  return out;
}

/** Deterministic order (R17): month (run-wide first), the spec's anomaly order, then member, line, date and the rest. */
export function sortAnomalies(list: readonly Anomaly[]): Anomaly[] {
  const key = (a: Anomaly) =>
    [
      a.month ?? "",
      String(ANOMALY_CODES.indexOf(a.code)).padStart(2, "0"),
      a.memberId ?? "",
      a.line ?? "",
      a.date ?? "",
      a.ruleKey ?? "",
      a.roleKey ?? "",
      a.serviceId ?? "",
      a.type ?? "",
    ].join("\u0000");
  return [...list].sort((a, b) => compareCodepoint(key(a), key(b)));
}
