// app/components/admin/v3Services.ts
//
// Solver v3 C6 RQ-3, RQ-7, ST-4–ST-7 — the services a v3 request holds, and `prior`.
//
// Exactly the services that will exist: planned weekend columns that are neither skipped nor
// blocked (the caller passes only those), every stored weekend service of the horizon, and every
// counted special (planned or stored). Stored services and counted specials are FIXED: their seats
// are pins and the solver adds nothing. A stored service's id is its document `_id` VERBATIM; a
// planned one's is its create column's id. `time` is sent only when `isServiceTime` holds.
//
// One seat per person per service is C2's rule (LG-4), not C6's: the stored seats sent are exactly
// the ones C2's `keepVoiceSeats` (IF2-11) keeps, called with `countsForFairness: true` so its LG-2
// filter never drops an uncounted weekend service, which RQ-3 still sends fixed. Its LG-1 drop of a
// duplicated weekend target applies here and to `prior` alike.

import { keepVoiceSeats, type LedgerService } from "@/app/utils/fairnessLedger";
import { countsForFairness } from "@/app/utils/countsForFairness";
import { isServiceTime } from "@/app/utils/serviceTime";
import { compareCodepoint, roleClassOf, shiftMonth } from "@/app/utils/fairnessVocabulary";
import { dayLabel } from "./plannerModel";
import { monthOfDate } from "./v3Horizon";
import { V3_LINES } from "./v3Copy";
import type { V3Pin, V3Prior, V3Service, V3ServiceKind } from "./v3Wire";

/** A row of `GET /api/admin/roles` — a structural subset of `ServiceRole` (serviceCardModel.ts). */
export interface V3StoredRole {
  _id: string;
  _type: string;
  date: string;
  time?: string | null;
  service_name?: string | null;
  countsForFairness?: boolean;
  leads: ReadonlyArray<{ _id: string }>;
  bgvs: ReadonlyArray<{ _id: string }>;
  chorus: ReadonlyArray<{ _id: string }>;
}

export interface PlannedColumn {
  columnId: string;
  date: string;
  type: "sunday_role" | "saturday_role" | "special_role";
  serviceName?: string;
  time?: string;
  countsForFairness: boolean;
}

export interface BuiltServices {
  services: V3Service[];
  /** The kept seats of every fixed stored service (IF2-11), members only. */
  storedPins: V3Pin[];
  storedServiceIds: Set<string>;
  /** Planned counted specials, in date order — the pre-fill's targets (SP-1). */
  plannedSpecialIds: string[];
  /** service id → «domingo 8 nov» / «sábado 7 nov» / «{nombre} 12 nov». */
  labels: Map<string, string>;
  /** ST-5, ST-6. */
  notices: string[];
}

export function kindOfType(type: string): V3ServiceKind | null {
  if (type === "sunday_role") return "sunday";
  if (type === "saturday_role") return "saturday";
  if (type === "special_role") return "special";
  return null;
}

export function serviceLabel(kind: V3ServiceKind, date: string, name?: string | null): string {
  if (kind === "sunday") return `domingo ${dayLabel(date)}`;
  if (kind === "saturday") return `sábado ${dayLabel(date)}`;
  return `${name?.trim() || "especial"} ${dayLabel(date)}`;
}

const ROLE_ES: Record<"Lead" | "BGV" | "Choir", string> = { Lead: "Lead", BGV: "BGV", Choir: "Coro" };

const toLedger = (r: V3StoredRole): LedgerService => ({
  _id: r._id,
  _type: r._type as LedgerService["_type"],
  date: r.date,
  countsForFairness: true,
  Lead: r.leads.map((x) => x._id),
  BGVs: r.bgvs.map((x) => x._id),
  Chorus: r.chorus.map((x) => x._id),
});

const isWeekend = (r: V3StoredRole) => r._type === "sunday_role" || r._type === "saturday_role";
const isCountedSpecial = (r: V3StoredRole) => r._type === "special_role" && countsForFairness({ _type: r._type, countsForFairness: r.countsForFairness });
const byDateThenId = (a: { date: string; id: string }, b: { date: string; id: string }) =>
  compareCodepoint(a.date, b.date) || compareCodepoint(a.id, b.id);

export function buildV3Services(input: {
  months: readonly string[];
  stored: readonly V3StoredRole[];
  planned: readonly PlannedColumn[];
  seats: { Lead: number; BGV: number; Choir: number };
  memberIds: ReadonlySet<string>;
  nameOf: (id: string) => string;
}): BuiltServices {
  const inHorizon = new Set(input.months);
  const services: V3Service[] = [];
  const labels = new Map<string, string>();
  const notices: string[] = [];

  // ── Stored: every weekend service of the horizon, every counted special; uncounted specials never.
  const storedSent = input.stored.filter((r) => inHorizon.has(monthOfDate(r.date)) && (isWeekend(r) || isCountedSpecial(r)));
  const seatStep = keepVoiceSeats(storedSent.map(toLedger));
  const dropped = new Set(seatStep.duplicateTargets.flatMap((d) => d.roleIds));
  const storedServiceIds = new Set<string>();
  let emptyVoiceSeats = 0;
  for (const r of storedSent) {
    if (dropped.has(r._id)) continue;
    const kind = kindOfType(r._type)!;
    storedServiceIds.add(r._id);
    labels.set(r._id, serviceLabel(kind, r.date, r.service_name));
    services.push({
      id: r._id, date: r.date, month: monthOfDate(r.date), kind,
      ...(isServiceTime(r.time) ? { time: r.time } : {}),
      fixed: true,
      counts: countsForFairness({ _type: r._type, countsForFairness: r.countsForFairness }),
    });
    emptyVoiceSeats += Math.max(0, input.seats.Lead - r.leads.length) + Math.max(0, input.seats.BGV - r.bgvs.length);
    if (kind === "sunday") emptyVoiceSeats += Math.max(0, input.seats.Choir - r.chorus.length);
  }
  const storedPins: V3Pin[] = [];
  const nonMemberNoticed = new Set<string>();
  for (const seat of seatStep.kept) {
    if (dropped.has(seat.serviceId)) continue;
    if (!input.memberIds.has(seat.memberId)) {
      if (!nonMemberNoticed.has(seat.serviceId)) {
        nonMemberNoticed.add(seat.serviceId);
        notices.push(V3_LINES.storedNonMember(labels.get(seat.serviceId) ?? seat.serviceId));
      }
      continue;
    }
    storedPins.push({ service: seat.serviceId, date: seat.date, role: roleClassOf(seat.roleKey), person: seat.memberId });
  }
  const noticedDouble = new Set<string>();
  for (const second of seatStep.secondSeats) {
    const key = `${second.serviceId}|${second.memberId}`;
    if (noticedDouble.has(key) || dropped.has(second.serviceId) || !input.memberIds.has(second.memberId)) continue;
    noticedDouble.add(key);
    const kept = storedPins.find((p) => p.service === second.serviceId && p.person === second.memberId);
    if (kept) {
      notices.push(V3_LINES.storedDoubleSeat(input.nameOf(second.memberId), labels.get(second.serviceId) ?? second.serviceId, ROLE_ES[kept.role]));
    }
  }
  if (emptyVoiceSeats > 0) notices.unshift(V3_LINES.storedEmptySeats(emptyVoiceSeats));

  // ── Planned: weekend columns with their row targets; counted specials fixed; uncounted specials never.
  const plannedSpecialIds: string[] = [];
  for (const c of input.planned) {
    if (!inHorizon.has(monthOfDate(c.date))) continue;
    const kind = kindOfType(c.type)!;
    labels.set(c.columnId, serviceLabel(kind, c.date, c.serviceName));
    if (kind === "special") {
      if (!c.countsForFairness) continue;
      plannedSpecialIds.push(c.columnId);
      services.push({
        id: c.columnId, date: c.date, month: monthOfDate(c.date), kind,
        ...(isServiceTime(c.time) ? { time: c.time } : {}),
        fixed: true, counts: true,
      });
      continue;
    }
    services.push({
      id: c.columnId, date: c.date, month: monthOfDate(c.date), kind, fixed: false, counts: c.countsForFairness,
      seats: kind === "saturday"
        ? { Lead: input.seats.Lead, BGV: input.seats.BGV }
        : { Lead: input.seats.Lead, BGV: input.seats.BGV, Choir: input.seats.Choir },
    });
  }

  services.sort(byDateThenId);
  const ROLE_ORDER = { Lead: 0, BGV: 1, Choir: 2 } as const;
  storedPins.sort((a, b) =>
    byDateThenId({ date: a.date, id: a.service }, { date: b.date, id: b.service })
    || ROLE_ORDER[a.role] - ROLE_ORDER[b.role]
    || compareCodepoint(a.person, b.person));
  plannedSpecialIds.sort((a, b) => compareCodepoint(a, b));
  return { services, storedPins, storedServiceIds, plannedSpecialIds, labels, notices };
}

/** CDMX date + n days, by UTC integer arithmetic (no local-time day flip). */
function addDaysIso(iso: string, days: number): string {
  const t = Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)) + days);
  return new Date(t).toISOString().slice(0, 10);
}

/**
 * RQ-7 (C5 §5.6), from the roles read — never the ledger: `month` = months[0] − 1; `has_services`
 * = that month holds a stored weekend service or a stored counted special; `services` = those
 * dated in [first day of months[0] − 14 days, first day of months[0]), seats in stored order.
 */
export function buildV3Prior(firstMonth: string, stored: readonly V3StoredRole[]): V3Prior {
  const month = shiftMonth(firstMonth, -1);
  const start = addDaysIso(`${firstMonth}-01`, -14);
  const end = `${firstMonth}-01`;
  const relevant = stored.filter((r) => isWeekend(r) || isCountedSpecial(r));
  const dropped = new Set(keepVoiceSeats(relevant.map(toLedger)).duplicateTargets.flatMap((d) => d.roleIds));
  const kept = relevant.filter((r) => !dropped.has(r._id));
  return {
    month,
    has_services: kept.some((r) => monthOfDate(r.date) === month),
    services: kept
      .filter((r) => r.date >= start && r.date < end)
      .sort((a, b) => compareCodepoint(a.date, b.date) || compareCodepoint(a._id, b._id))
      .map((r) => ({
        date: r.date,
        kind: kindOfType(r._type)!,
        counts: countsForFairness({ _type: r._type, countsForFairness: r.countsForFairness }),
        seats: { Lead: r.leads.map((x) => x._id), BGV: r.bgvs.map((x) => x._id), Choir: r.chorus.map((x) => x._id) },
      })),
  };
}
