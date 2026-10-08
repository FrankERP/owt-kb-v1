// app/components/admin/v3MonthSources.ts
//
// Solver v3 C6 §4 and RQ-2 — ONE derivation of eligibility per horizon month (parent A7):
//   · a BOUND month (IF2-8 `horizon[].recordBinds`, A6) is solved from its record — statuses, exact
//     rules, presence, date blocks, cadence and exempt flags; C6 takes `people` without `name`;
//   · every other month from the `body` of C2's resolver (IF2-15) over the on-screen config and the
//     planner's on-screen `members` AS-IS (any superset carrying `ministries`; C2 RES-5 filters).
// The same frozen source feeds the request (eligibility, rules, people) and the confirm's record
// body, so the two can never disagree; a resolver `ok:false` refuses Auto with §7.9's lines.
// C6 never runs C2's validator (RES-8) and never re-derives pools, Tipo or rule membership.

import { resolveMonthEligibility, type EligibilityMember } from "@/app/utils/fairnessEligibility";
import { civilDayOfWeek } from "@/app/utils/fairnessLedger";
import type { FairnessLedgerResponse, FairnessMonthBody, LogicalRecord, RoleKey } from "@/app/utils/fairnessVocabulary";
import type { SolverConfig } from "./plannerModel";
import { V3_RESOLVER_ISSUE, V3_RESOLVER_REFUSAL, V3_ROUTE_COPY } from "./v3Copy";
import type { V3Role, V3ServiceKind } from "./v3Wire";

export type MonthState = "bound" | "recorded_unbound" | "unrecorded" | "anchored_unrecorded";

export interface MonthSource {
  month: string;
  state: MonthState;
  /** The record's `rev` as read with this eligibility (C2 WR-15), or `null` when there is none. */
  rev: string | null;
  recordedAt: string | null;
  body: FairnessMonthBody;
}

type HorizonEntry = FairnessLedgerResponse["horizon"][number];

/** §4's state table, from IF2-8 alone: `recordBinds` is read, never re-derived (A6). */
export function monthStateOf(h: HorizonEntry): MonthState {
  if (h.record && h.recordBinds) return "bound";
  if (h.record) return "recorded_unbound";
  return h.storedServices > 0 ? "anchored_unrecorded" : "unrecorded";
}

/** §4 «Displayed state before a run»: the latest GET's states; none yet ⇒ every month not bound. */
export function displayedMonthStates(months: readonly string[], ledger: FairnessLedgerResponse | null): Map<string, MonthState> {
  return new Map(months.map((month) => {
    const h = ledger?.horizon.find((x) => x.month === month);
    return [month, h ? monthStateOf(h) : "unrecorded"];
  }));
}

/** IF2-3 → the body a bound month is solved with and confirmed as (CF-3): `name` removed, nothing else changed. */
export function bodyFromRecord(record: LogicalRecord): FairnessMonthBody {
  return {
    month: record.month,
    people: record.people.map((p) => ({
      memberId: p.memberId,
      roles: p.roles,
      exactRules: p.exactRules,
      ...(p.sundayCadence ? { sundayCadence: p.sundayCadence } : {}),
      exempt: p.exempt,
      blocks: p.blocks,
    })),
    presence: record.presence.map((r) => ({ ruleKey: r.ruleKey, roles: r.roles, members: r.members, exclusive: r.exclusive })),
  };
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value as Record<string, unknown>)) deepFreeze(v);
  }
  return value;
}

export function resolveMonthSources(input: {
  months: readonly string[];
  ledger: FairnessLedgerResponse;
  config: SolverConfig;
  members: readonly EligibilityMember[];
  /** The card label of a person's exact `Sun.Lead` rule, for `cadence_and_exact`'s line. */
  exactLeadLabel: (person: string) => string | null;
}): { ok: true; sources: MonthSource[] } | { ok: false; lines: string[] } {
  const sources: MonthSource[] = [];
  const lines: string[] = [];
  for (const month of input.months) {
    const h = input.ledger.horizon.find((x) => x.month === month);
    if (!h) {
      lines.push(V3_ROUTE_COPY.ledgerFailed);
      continue;
    }
    const state = monthStateOf(h);
    if (state === "bound" && h.record) {
      sources.push(deepFreeze({ month, state, rev: h.record.rev, recordedAt: h.record.recordedAt, body: bodyFromRecord(h.record) }));
      continue;
    }
    const resolved = resolveMonthEligibility({ month, config: input.config, members: [...input.members] });
    if (!resolved.ok) {
      for (const r of resolved.refusals) lines.push(V3_RESOLVER_REFUSAL[r.reason](r.person, month, input.exactLeadLabel(r.person)));
      for (const issue of resolved.issues) lines.push(V3_RESOLVER_ISSUE[issue.code]);
      continue;
    }
    sources.push(deepFreeze({
      month, state, rev: h.record?.rev ?? null, recordedAt: h.record?.recordedAt ?? null, body: structuredClone(resolved.body),
    }));
  }
  return lines.length > 0 ? { ok: false, lines: [...new Set(lines)] } : { ok: true, sources };
}

// ─── Per-service eligibility (RQ-2) ─────────────────────────────────────────

/** A13 / D14: a Sunday-dated service uses the `Sun.*` keys; any other day the `Sat.*` keys. */
export function dayClass(kind: V3ServiceKind, date: string): "Sun" | "Sat" {
  if (kind === "sunday") return "Sun";
  if (kind === "saturday") return "Sat";
  return civilDayOfWeek(date) === 0 ? "Sun" : "Sat";
}

export function roleKeyOf(cls: "Sun" | "Sat", role: V3Role): RoleKey {
  return `${cls}.${role}` as RoleKey;
}

/** C5 §5.2: a non-fixed `saturday` has no Choir; every fixed service carries all three. */
export function rolesOfService(kind: V3ServiceKind, fixed: boolean): V3Role[] {
  return kind === "saturday" && !fixed ? ["Lead", "BGV"] : ["Lead", "BGV", "Choir"];
}

/**
 * A role of service s is eligible for p iff p's status for s's role key is `in` or `exact`, p is
 * available on s's date (the source's `blocks[].unavailable` ∪ live `unavailableDates`, F4), and —
 * at a weekend service only — the key is not in that date's `blocks[].excludedRoles`.
 */
export function serviceEligibility(
  source: MonthSource,
  memberId: string,
  service: { date: string; kind: V3ServiceKind; fixed: boolean },
  liveUnavailable: readonly string[],
): V3Role[] {
  const person = source.body.people.find((p) => p.memberId === memberId);
  if (!person) return [];
  const block = person.blocks.find((b) => b.date === service.date);
  if (block?.unavailable || liveUnavailable.includes(service.date)) return [];
  const cls = dayClass(service.kind, service.date);
  const weekend = service.kind !== "special";
  return rolesOfService(service.kind, service.fixed).filter((role) => {
    const key = roleKeyOf(cls, role);
    const status = person.roles[key];
    if (status !== "in" && status !== "exact") return false;
    return !(weekend && block?.excludedRoles.includes(key));
  });
}
