// app/utils/fairnessLedger.ts
//
// THE fairness ledger (solver v3 C2 LG-1 … LG-17, CAD-1 … CAD-3; spec IF2-10, IF2-11,
// IF2-12): the only TypeScript definition of the policy's F2–F7 and X1. Given the monthly
// eligibility records, the stored voice services and the members, it computes for every
// person and line the exact share of the seats she was owed, the seats she received and
// the balance, per month, over the 3-month window and cumulatively; and X1's cadence
// state. `fixtures/fairness/golden.json` is its contract with the v3 solver (C5), which
// computes the same formula for its plan: both suites assert the file.
//
// NEUTRAL AND DETERMINISTIC (LG-16): no "use client", no `server-only`, no Sanity client,
// no `node:crypto`, no `Date` arithmetic on service dates (the weekday is a civil-calendar
// formula on the stored string's integers), no import from a client module. Output is
// independent of input order: every list is sorted by codepoint. Identity is the member
// `_id`; names are display only.
//
// EXACT ARITHMETIC (LG-13): shares are rationals in BigInt — nothing floating
// accumulates. Each wire figure is rounded ONCE to hundredths (half away from zero) and
// the wire balance is DEFINED as `share − received` in hundredths; each display tenth is
// rounded once from the same exact value, never from the hundredths.

import { countsForFairness } from "./countsForFairness";
import {
  ROLE_CLASS_ORDER,
  ROLE_KEYS,
  ROLE_LINE,
  SATURDAY_KEYS,
  SUNDAY_KEYS,
  compareCodepoint,
  monthIndex,
  roleClassOf,
  tabOfLine,
  type FairnessLedgerResponse,
  type FairnessPerson,
  type FairnessPersonMonth,
  type Figures,
  type LineKey,
  type LogicalRecord,
  type Note,
  type RecordSummary,
  type RoleKey,
  type SetAsideReason,
  type Status,
  type TabKey,
  NOTE_CODES,
} from "./fairnessVocabulary";
import { indexUniqueByKey, serviceDayKey } from "./serviceReadSelect";
import { compareServiceTime } from "./serviceTime";
import { historyWindow } from "./solverHistory";

// ─── Inputs (IF2-10) ─────────────────────────────────────────────────────────

export interface LedgerService {
  _id: string;
  _type: "sunday_role" | "saturday_role" | "special_role";
  /** The stored date: `week` on a weekend role, `date` on a special. */
  date: string;
  /** Raw stored field, unvalidated; LG-11 orders it only through `compareServiceTime`. */
  time?: string;
  published?: boolean;
  /** Raw field; the ledger applies `countsForFairness(doc)`. */
  countsForFairness?: boolean;
  /** Member ids (non-empty `_ref`s), stored order. */
  Lead: string[];
  BGVs: string[];
  Chorus: string[];
}

export interface LedgerInput {
  target: string;
  records: LogicalRecord[];
  services: LedgerService[];
  members: Array<{ id: string; name: string; unavailableDates: string[] }>;
}

// ─── Exact rationals ─────────────────────────────────────────────────────────

interface Q {
  n: bigint;
  d: bigint;
}

const B0 = BigInt(0);
const B1 = BigInt(1);
const B2 = BigInt(2);
const ZERO: Q = { n: B0, d: B1 };

function gcd(a: bigint, b: bigint): bigint {
  let x = a < B0 ? -a : a;
  let y = b < B0 ? -b : b;
  while (y !== B0) [x, y] = [y, x % y];
  return x === B0 ? B1 : x;
}

function norm(n: bigint, d: bigint): Q {
  if (d < B0) [n, d] = [-n, -d];
  const g = gcd(n, d);
  return { n: n / g, d: d / g };
}

const frac = (num: number, den: number): Q => norm(BigInt(num), BigInt(den));
const add = (a: Q, b: Q): Q => norm(a.n * b.d + b.n * a.d, a.d * b.d);
const subInt = (a: Q, k: number): Q => norm(a.n - BigInt(k) * a.d, a.d);
const lessThanOne = (a: Q) => a.n < a.d;

/** sign(x) · ⌊|x| · units + ½⌋ — half away from zero, from the exact value (LG-13). */
function roundTo(x: Q, units: number): number {
  const abs = x.n < B0 ? -x.n : x.n;
  const r = (B2 * abs * BigInt(units) + x.d) / (B2 * x.d);
  return Number(x.n < B0 ? -r : r);
}

/** A line's or tab's figures from its exact share and its received seat count. */
function figures(share: Q, seats: number): Figures {
  const shareH = roundTo(share, 100);
  const received = 100 * seats;
  return {
    share: shareH,
    received,
    balance: shareH - received,
    seats,
    tenths: { share: roundTo(share, 10), balance: roundTo(subInt(share, seats), 10) },
  };
}

// ─── The seat-keeping step (IF2-11; LG-1, LG-2, LG-4) ───────────────────────

export type VoiceSeat = { serviceId: string; date: string; roleKey: RoleKey; memberId: string };

/** 0 = Sunday … 6 = Saturday, by Sakamoto's civil-calendar formula — never a `Date` (LG-16). */
export function civilDayOfWeek(date: string): number {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const day = Number(date.slice(8, 10));
  const offsets = [0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4];
  const y = month < 3 ? year - 1 : year;
  return (y + Math.floor(y / 4) - Math.floor(y / 100) + Math.floor(y / 400) + offsets[month - 1] + day) % 7;
}

export interface CountedService {
  id: string;
  type: LedgerService["_type"];
  date: string;
  time: unknown;
  sunday: boolean;
  weekend: boolean;
}

const SEAT_FIELDS: ReadonlyArray<[keyof Pick<LedgerService, "Lead" | "BGVs" | "Chorus">, "Lead" | "BGV" | "Choir"]> = [
  ["Lead", "Lead"],
  ["BGVs", "BGV"],
  ["Chorus", "Choir"],
];

function compareSeats(a: VoiceSeat, b: VoiceSeat): number {
  return (
    compareCodepoint(a.date, b.date) ||
    compareCodepoint(a.serviceId, b.serviceId) ||
    ROLE_KEYS.indexOf(a.roleKey) - ROLE_KEYS.indexOf(b.roleKey) ||
    compareCodepoint(a.memberId, b.memberId)
  );
}

function seatStep(services: readonly LedgerService[]) {
  const canonical: Array<{ s: LedgerService; day: string }> = [];
  for (const s of services) {
    if (!s || typeof s._id !== "string" || s._id.startsWith("drafts.")) continue;
    if (s._type !== "sunday_role" && s._type !== "saturday_role" && s._type !== "special_role") continue;
    const day = serviceDayKey(s.date);
    if (!day) continue;
    canonical.push({ s, day });
  }

  // LG-1 — every copy of a weekend type on one stored date is dropped, by the
  // read model's own rule (`indexUniqueByKey`); several specials on a date are separate.
  const targetKey = (x: { s: LedgerService; day: string }) => `${x.s._type}:${x.day}`;
  const weekend = canonical.filter((x) => x.s._type !== "special_role");
  const unique = indexUniqueByKey(weekend, targetKey);
  const duplicates = new Map<string, { type: string; date: string; roleIds: string[] }>();
  for (const x of weekend) {
    const key = targetKey(x);
    if (unique.has(key)) continue;
    const found = duplicates.get(key);
    if (found) found.roleIds.push(x.s._id);
    else duplicates.set(key, { type: x.s._type, date: x.day, roleIds: [x.s._id] });
  }

  const kept: VoiceSeat[] = [];
  const secondSeats: VoiceSeat[] = [];
  const counted: CountedService[] = [];
  for (const x of canonical) {
    if (x.s._type !== "special_role" && unique.get(targetKey(x)) !== x) continue;
    if (!countsForFairness(x.s)) continue; // LG-2
    const sunday = x.s._type === "sunday_role" || (x.s._type === "special_role" && civilDayOfWeek(x.day) === 0);
    counted.push({ id: x.s._id, type: x.s._type, date: x.day, time: x.s.time, sunday, weekend: x.s._type !== "special_role" });
    const keys = sunday ? SUNDAY_KEYS : SATURDAY_KEYS;
    const held = new Set<string>();
    for (const [field, cls] of SEAT_FIELDS) {
      const roleKey = keys[ROLE_CLASS_ORDER.indexOf(cls)];
      for (const memberId of Array.isArray(x.s[field]) ? x.s[field] : []) {
        if (typeof memberId !== "string" || memberId === "") continue;
        const seat = { serviceId: x.s._id, date: x.day, roleKey, memberId };
        // LG-4: one seat per person per service — the first in Lead > BGV > Choir.
        (held.has(memberId) ? secondSeats : kept).push(seat);
        held.add(memberId);
      }
    }
  }
  kept.sort(compareSeats);
  secondSeats.sort(compareSeats);
  counted.sort((a, b) => compareCodepoint(a.date, b.date) || compareCodepoint(a.id, b.id));
  const duplicateTargets = [...duplicates.values()]
    .map((d) => ({ ...d, roleIds: [...d.roleIds].sort(compareCodepoint) }))
    .sort((a, b) => compareCodepoint(a.type, b.type) || compareCodepoint(a.date, b.date));
  return { kept, secondSeats, duplicateTargets, counted };
}

/**
 * IF2-11 — the record-free seat step: LG-1 (duplicate weekend targets dropped whole and
 * reported), LG-2 (uncounted services contribute nothing) and LG-4 (role key by seat
 * array and, at a special, by day class; one kept seat per person per service; every
 * further seat of hers there a second seat). The ledger runs exactly this; C4 runs it for
 * its join months; C6's ST-6 test compares its sent seat against it.
 */
export function keepVoiceSeats(services: LedgerService[]): {
  kept: VoiceSeat[];
  secondSeats: VoiceSeat[];
  duplicateTargets: Array<{ type: string; date: string; roleIds: string[] }>;
  /** LG-1/LG-2's surviving services with their day class — the one counted-service list (C4 reads it, never re-derives it). */
  counted: CountedService[];
} {
  const { kept, secondSeats, duplicateTargets, counted } = seatStep(services);
  return { kept, secondSeats, duplicateTargets, counted };
}

// ─── X1 (IF2-12; CAD-1) ──────────────────────────────────────────────────────

export type CadenceReason = "on" | "not_eligible" | "led_previous_month" | "assumed_led_previous_month" | "no_available_sunday";

/**
 * X1 for one cadence member over 1–2 consecutive months. Month 1 follows the facts;
 * month 2 assumes month 1 followed its own state. The wire's `out` is exactly the reason
 * `not_eligible`, every other «off» is `off` — that mapping is the caller's (A14).
 */
export function cadenceStates(input: {
  ledCountedSundayPreviousMonth: boolean;
  months: Array<{ month: string; eligible: boolean; availableCountedSundays: number }>;
}): Array<{ month: string; state: "on" | "off"; reason: CadenceReason }> {
  if (input.months.length < 1 || input.months.length > 2) throw new RangeError("cadenceStates: 1 or 2 months");
  let ledPrevious = input.ledCountedSundayPreviousMonth;
  return input.months.map((m, i) => {
    let reason: CadenceReason;
    if (!m.eligible) reason = "not_eligible";
    else if (ledPrevious) reason = i === 0 ? "led_previous_month" : "assumed_led_previous_month";
    else if (m.availableCountedSundays <= 0) reason = "no_available_sunday";
    else reason = "on";
    const state = reason === "on" ? "on" : "off";
    ledPrevious = state === "on";
    return { month: m.month, state, reason };
  });
}

// ─── One recorded month (LG-5 … LG-11, LG-15, LG-17) ─────────────────────────

type Person = LogicalRecord["people"][number];

interface SetAside {
  date: string;
  serviceId: string;
  roleKey: RoleKey;
  memberId: string;
  reason: SetAsideReason;
  line: LineKey;
}

interface MonthResult {
  share: Map<string, Map<LineKey, Q>>;
  received: Map<string, Map<LineKey, number>>;
  inPopulation: Map<string, Set<LineKey>>;
  setAsides: SetAside[];
  notes: Map<string, Note[]>;
  zeroChecks: Array<{ serviceId: string; key: string; sum: Q }>;
}

function bump<K>(map: Map<string, Map<K, Q>>, id: string, key: K, value: Q) {
  const inner = map.get(id) ?? new Map<K, Q>();
  inner.set(key, add(inner.get(key) ?? ZERO, value));
  map.set(id, inner);
}

function count<K>(map: Map<string, Map<K, number>>, id: string, key: K, by = 1) {
  const inner = map.get(id) ?? new Map<K, number>();
  inner.set(key, (inner.get(key) ?? 0) + by);
  map.set(id, inner);
}

function computeMonth(
  record: LogicalRecord,
  services: CountedService[],
  kept: VoiceSeat[],
  second: VoiceSeat[],
  liveUnavailable: ReadonlyMap<string, ReadonlySet<string>>,
): MonthResult {
  const people = new Map<string, Person>(record.people.map((p) => [p.memberId, p]));
  const status = (id: string, k: RoleKey): Status => people.get(id)?.roles[k] ?? "out";
  const cadence = (id: string) => people.get(id)?.sundayCadence === "alternate";
  const unavailable = (id: string, date: string) =>
    (people.get(id)?.blocks ?? []).some((b) => b.date === date && b.unavailable) ||
    (liveUnavailable.get(id)?.has(date) ?? false);
  const ruleExcluded = (id: string, k: RoleKey, s: CountedService) =>
    s.weekend && (people.get(id)?.blocks ?? []).some((b) => b.date === s.date && b.excludedRoles.includes(k));
  const isFixed = (seat: VoiceSeat) =>
    status(seat.memberId, seat.roleKey) === "exact" || (ROLE_LINE[seat.roleKey] === "DL" && cadence(seat.memberId));
  const rules = [...record.presence].sort((a, b) => compareCodepoint(a.ruleKey, b.ruleKey));
  const listed = [...people.keys()].sort(compareCodepoint);

  const result: MonthResult = {
    share: new Map(),
    received: new Map(),
    inPopulation: new Map(),
    setAsides: [],
    notes: new Map(),
    zeroChecks: [],
  };
  const enter = (id: string, line: LineKey) => {
    const set = result.inPopulation.get(id) ?? new Set<LineKey>();
    set.add(line);
    result.inPopulation.set(id, set);
  };

  // Per-service structure, before the floor (LG-7 … LG-10).
  interface Slot {
    s: CountedService;
    key: RoleKey | `P:${string}`;
    line: LineKey;
    population: string[];
    /** Seats counted in this slot (class 3, or the counted presence seat). */
    counted: VoiceSeat[];
  }
  const slots: Slot[] = [];
  const fixedHolders = new Set<string>();
  const outsideSeats: SetAside[] = [];

  for (const s of services) {
    const keys = s.sunday ? SUNDAY_KEYS : SATURDAY_KEYS;
    const seatsHere = kept.filter((x) => x.serviceId === s.id);
    for (const x of second.filter((y) => y.serviceId === s.id)) {
      result.setAsides.push({ ...x, reason: "second_seat", line: ROLE_LINE[x.roleKey] });
    }

    // LG-7 — presence, weekend services only.
    const applying: Array<{ ruleKey: string; members: string[]; exclusive: boolean; A: RoleKey[]; Q: string[] }> = [];
    if (s.weekend) {
      for (const rule of rules) {
        const A = keys.filter((k) => rule.roles.includes(k));
        if (A.length === 0) continue;
        const Q = [...rule.members]
          .sort(compareCodepoint)
          .filter((id) => A.some((k) => status(id, k) === "in" && !unavailable(id, s.date) && !ruleExcluded(id, k, s)));
        applying.push({ ruleKey: rule.ruleKey, members: rule.members, exclusive: rule.exclusive, A, Q });
      }
    }
    const usedAsPresence = new Set<VoiceSeat>();
    const presenceSeat = new Map<string, { seat: VoiceSeat; counted: boolean }>();
    for (const rule of applying) {
      const candidate = seatsHere
        .filter((x) => rule.A.includes(x.roleKey) && rule.members.includes(x.memberId) && !isFixed(x) && !usedAsPresence.has(x))
        .sort(
          (a, b) =>
            ROLE_CLASS_ORDER.indexOf(roleClassOf(a.roleKey)) - ROLE_CLASS_ORDER.indexOf(roleClassOf(b.roleKey)) ||
            compareCodepoint(a.memberId, b.memberId),
        )[0];
      if (!candidate) continue;
      usedAsPresence.add(candidate);
      const counts = rule.Q.includes(candidate.memberId);
      presenceSeat.set(rule.ruleKey, { seat: candidate, counted: counts });
      if (!counts) outsideSeats.push({ ...candidate, reason: "outside_population", line: `P:${rule.ruleKey}` });
    }

    // LG-8 — the normal populations.
    const soleInQ = new Set(applying.filter((r) => r.Q.length === 1).map((r) => r.Q[0]));
    const population = (k: RoleKey) =>
      listed.filter((id) => {
        if (status(id, k) !== "in") return false;
        if (unavailable(id, s.date) || ruleExcluded(id, k, s)) return false;
        if (ROLE_LINE[k] === "DL" && cadence(id)) return false;
        if (applying.some((r) => r.exclusive && r.A.includes(k) && r.members.includes(id))) return false;
        if (soleInQ.has(id)) return false;
        return !seatsHere.some((x) => x.memberId === id && x.roleKey !== k && status(id, x.roleKey) === "exact");
      });

    // LG-9 — set-asides of the remaining seats; LG-10 — the normal seats.
    for (const k of keys) {
      const P = population(k);
      const normal: VoiceSeat[] = [];
      for (const seat of seatsHere.filter((x) => x.roleKey === k && !usedAsPresence.has(x))) {
        let reason: SetAsideReason | null = null;
        if (status(seat.memberId, k) === "exact") reason = "exact";
        else if (ROLE_LINE[k] === "DL" && cadence(seat.memberId)) reason = "cadence";
        else if (!people.has(seat.memberId)) reason = "not_in_record";
        else if (!P.includes(seat.memberId)) reason = "outside_population";
        if (reason === null) normal.push(seat);
        else {
          result.setAsides.push({ ...seat, reason, line: ROLE_LINE[k] });
          if (reason === "exact" || reason === "cadence") fixedHolders.add(seat.memberId);
        }
      }
      for (const id of P) enter(id, ROLE_LINE[k]);
      slots.push({ s, key: k, line: ROLE_LINE[k], population: P, counted: normal });
    }
    for (const rule of applying) {
      const line: LineKey = `P:${rule.ruleKey}`;
      for (const id of rule.Q) enter(id, line);
      const pi = presenceSeat.get(rule.ruleKey);
      slots.push({ s, key: line, line, population: rule.Q, counted: pi?.counted ? [pi.seat] : [] });
    }
  }
  result.setAsides.push(...outsideSeats);

  // LG-11 — the floor seat, on the values before any floor set-aside.
  const preShare = new Map<string, Q>();
  const preReceived = new Map<string, VoiceSeat[]>();
  for (const slot of slots) {
    if (slot.population.length > 0) {
      const each = frac(slot.counted.length, slot.population.length);
      for (const id of slot.population) preShare.set(id, add(preShare.get(id) ?? ZERO, each));
    }
    for (const seat of slot.counted) preReceived.set(seat.memberId, [...(preReceived.get(seat.memberId) ?? []), seat]);
  }
  const floorSeats = new Set<VoiceSeat>();
  for (const id of listed) {
    const person = people.get(id)!;
    if (person.exempt || fixedHolders.has(id)) continue;
    if (!result.inPopulation.has(id)) continue;
    if (!lessThanOne(preShare.get(id) ?? ZERO)) continue;
    const received = preReceived.get(id) ?? [];
    if (received.length === 0) continue;
    const time = (seat: VoiceSeat) => services.find((s) => s.id === seat.serviceId)?.time as string | undefined;
    const [first] = [...received].sort(
      (a, b) =>
        compareCodepoint(a.date, b.date) ||
        ROLE_CLASS_ORDER.indexOf(roleClassOf(a.roleKey)) - ROLE_CLASS_ORDER.indexOf(roleClassOf(b.roleKey)) ||
        compareServiceTime(time(a), time(b)) ||
        compareCodepoint(a.serviceId, b.serviceId),
    );
    floorSeats.add(first);
  }

  // Final shares and receipts, the floor seats set aside together (populations unchanged).
  for (const slot of slots) {
    const counted = slot.counted.filter((seat) => !floorSeats.has(seat));
    for (const seat of slot.counted.filter((x) => floorSeats.has(x))) {
      result.setAsides.push({ ...seat, reason: "floor", line: slot.line });
    }
    let sum = ZERO;
    if (slot.population.length > 0) {
      const each = frac(counted.length, slot.population.length);
      for (const id of slot.population) {
        bump(result.share, id, slot.line, each);
        sum = add(sum, each);
      }
    }
    for (const seat of counted) {
      count(result.received, seat.memberId, slot.line);
      sum = subInt(sum, 1);
    }
    result.zeroChecks.push({ serviceId: slot.s.id, key: slot.key, sum });
  }

  result.notes = monthNotes({ record, services, kept, people, status, cadence, unavailable, ruleExcluded, setAsides: result.setAsides });
  return result;
}

// ─── Notes (LG-15, LG-17) ────────────────────────────────────────────────────

function monthNotes(ctx: {
  record: LogicalRecord;
  services: CountedService[];
  kept: VoiceSeat[];
  people: Map<string, Person>;
  status: (id: string, k: RoleKey) => Status;
  cadence: (id: string) => boolean;
  unavailable: (id: string, date: string) => boolean;
  ruleExcluded: (id: string, k: RoleKey, s: CountedService) => boolean;
  setAsides: SetAside[];
}): Map<string, Note[]> {
  const out = new Map<string, Note[]>();
  const push = (id: string, note: Note) => out.set(id, [...(out.get(id) ?? []), note]);
  const uniqueSorted = (dates: string[]) => [...new Set(dates)].sort(compareCodepoint);
  const LINES: Array<{ line: "DL" | "SL" | "BGV" | "CORO"; keys: RoleKey[] }> = [
    { line: "DL", keys: ["Sun.Lead"] },
    { line: "SL", keys: ["Sat.Lead"] },
    { line: "BGV", keys: ["Sun.BGV", "Sat.BGV"] },
    { line: "CORO", keys: ["Sun.Choir", "Sat.Choir"] },
  ];

  for (const [id, person] of ctx.people) {
    for (const { line, keys } of LINES) {
      if (keys.every((k) => ctx.status(id, k) === "out")) push(id, { code: "role_out", line });
    }
    const unavailable = ctx.services.filter((s) => ctx.unavailable(id, s.date)).map((s) => s.date);
    if (unavailable.length) push(id, { code: "unavailable", dates: uniqueSorted(unavailable) });
    for (const { line, keys } of LINES) {
      const dates = ctx.services
        .filter((s) => keys.some((k) => (s.sunday ? SUNDAY_KEYS : SATURDAY_KEYS).includes(k) && ctx.status(id, k) === "in" && ctx.ruleExcluded(id, k, s)))
        .map((s) => s.date);
      if (dates.length) push(id, { code: "rule_excluded", line, dates: uniqueSorted(dates) });
    }
    for (const rule of person.exactRules) {
      push(id, { code: "exact", roles: rule.roles, count: rule.count });
      const available = ctx.services.filter((s) => {
        const keys = s.sunday ? SUNDAY_KEYS : SATURDAY_KEYS;
        return keys.some((k) => rule.roles.includes(k) && !ctx.unavailable(id, s.date) && !ctx.ruleExcluded(id, k, s));
      }).length;
      if (rule.count > available) push(id, { code: "exact_clamped", count: rule.count, available });
    }
    if (ctx.cadence(id)) {
      const sundays = ctx.kept.filter((x) => x.memberId === id && x.roleKey === "Sun.Lead");
      const saturdays = ctx.kept.filter((x) => x.memberId === id && x.roleKey === "Sat.Lead");
      if (sundays.length === 0 && saturdays.length > 0) {
        push(id, { code: "cadence_no_sunday_saturday", line: "SL", dates: uniqueSorted(saturdays.map((x) => x.date)) });
      }
    }
    for (const rule of ctx.record.presence) {
      if (rule.members.includes(id)) {
        push(id, { code: "presence", line: `P:${rule.ruleKey}`, ruleKey: rule.ruleKey, members: [...rule.members].sort(compareCodepoint) });
      }
    }
    if (person.exempt) push(id, { code: "exempt" });
  }
  // Set-aside notes, by holder and line. A holder absent from the record also gets
  // `not_listed`, which `run` gives every unlisted person of a recorded month.
  const byHolder = new Map<string, SetAside[]>();
  for (const x of ctx.setAsides) byHolder.set(x.memberId, [...(byHolder.get(x.memberId) ?? []), x]);
  for (const [id, list] of byHolder) {
    const lines = [...new Set(list.map((x) => x.line))].sort(compareCodepoint);
    for (const line of lines) {
      const of = (reason: SetAsideReason) => uniqueSorted(list.filter((x) => x.line === line && x.reason === reason).map((x) => x.date));
      if (of("cadence").length) push(id, { code: "cadence_set_aside", line, dates: of("cadence") });
      for (const x of list.filter((y) => y.line === line && y.reason === "floor")) {
        push(id, { code: "floor_seat", line, date: x.date, roleKey: x.roleKey });
      }
      if (of("outside_population").length) push(id, { code: "outside_population", line, dates: of("outside_population") });
      if (of("second_seat").length) push(id, { code: "second_seat", line, dates: of("second_seat") });
    }
  }
  for (const [id, notes] of out) out.set(id, sortNotes(notes));
  return out;
}

function sortNotes(notes: Note[]): Note[] {
  return [...notes].sort(
    (a, b) =>
      NOTE_CODES.indexOf(a.code) - NOTE_CODES.indexOf(b.code) ||
      compareCodepoint(a.line ?? "", b.line ?? "") ||
      compareCodepoint(JSON.stringify(a), JSON.stringify(b)),
  );
}

// ─── The ledger (IF2-10) ─────────────────────────────────────────────────────

const LINE_ORDER = (line: LineKey) => (["DL", "SL", "BGV", "CORO"] as string[]).indexOf(line);
function compareLines(a: LineKey, b: LineKey): number {
  const ia = LINE_ORDER(a);
  const ib = LINE_ORDER(b);
  if (ia !== -1 || ib !== -1) return (ia === -1 ? 9 : ia) - (ib === -1 ? 9 : ib);
  return compareCodepoint(a, b);
}

function summary(record: LogicalRecord): RecordSummary {
  return { rev: record.rev, source: record.source, engine: record.engine, environment: record.environment, recordedAt: record.recordedAt };
}

function sumLines(
  months: MonthResult[],
  id: string,
): { lines: Partial<Record<LineKey, Figures>>; tabs: Partial<Record<TabKey, Figures>> } {
  const share = new Map<LineKey, Q>();
  const seats = new Map<LineKey, number>();
  const present = new Set<LineKey>();
  for (const m of months) {
    for (const line of m.inPopulation.get(id) ?? []) present.add(line);
    for (const [line, q] of m.share.get(id) ?? []) share.set(line, add(share.get(line) ?? ZERO, q));
    for (const [line, n] of m.received.get(id) ?? []) seats.set(line, (seats.get(line) ?? 0) + n);
  }
  const lines: Partial<Record<LineKey, Figures>> = {};
  const tabShare = new Map<TabKey, Q>();
  const tabSeats = new Map<TabKey, number>();
  for (const line of [...present].sort(compareLines)) {
    const q = share.get(line) ?? ZERO;
    const n = seats.get(line) ?? 0;
    lines[line] = figures(q, n);
    for (const tab of [tabOfLine(line), "TOTAL"] as TabKey[]) {
      tabShare.set(tab, add(tabShare.get(tab) ?? ZERO, q));
      tabSeats.set(tab, (tabSeats.get(tab) ?? 0) + n);
    }
  }
  const tabs: Partial<Record<TabKey, Figures>> = {};
  for (const tab of ["DL", "SL", "BGV", "CORO", "TOTAL"] as TabKey[]) {
    if (tabShare.has(tab)) tabs[tab] = figures(tabShare.get(tab)!, tabSeats.get(tab)!);
  }
  return { lines, tabs };
}

interface LedgerRun {
  output: Pick<FairnessLedgerResponse, "window" | "recordsSince" | "people" | "diagnostics">;
  zeroChecks: Array<{ month: string; serviceId: string; key: string; sum: Q }>;
}

function run(input: LedgerInput): LedgerRun {
  const target = input.target;
  const targetIndex = monthIndex(target);
  const windowMonths = historyWindow({ year: Number(target.slice(0, 4)), month: Number(target.slice(5, 7)) }).map(
    (w) => `${String(w.year).padStart(4, "0")}-${String(w.month).padStart(2, "0")}`,
  );

  // LG-3 — records before the target only; one per month.
  const records = new Map<string, LogicalRecord>();
  for (const r of [...input.records].sort((a, b) => compareCodepoint(a.month, b.month) || compareCodepoint(a.rev, b.rev))) {
    if (monthIndex(r.month) < targetIndex) records.set(r.month, r);
  }
  const recordedMonths = [...records.keys()].sort(compareCodepoint);
  const recordsSince = recordedMonths[0] ?? null;

  const { kept, secondSeats, duplicateTargets, counted } = seatStep(input.services);
  const before = (date: string) => monthIndex(date.slice(0, 7)) < targetIndex;
  const liveUnavailable = new Map<string, Set<string>>(
    input.members.map((m) => [m.id, new Set((m.unavailableDates ?? []).map((d) => String(d).slice(0, 10)))]),
  );

  const monthResults = new Map<string, MonthResult>();
  const zeroChecks: LedgerRun["zeroChecks"] = [];
  for (const month of recordedMonths) {
    const inMonth = (x: { date: string }) => x.date.slice(0, 7) === month;
    const result = computeMonth(
      records.get(month)!,
      counted.filter(inMonth),
      kept.filter(inMonth),
      secondSeats.filter(inMonth),
      liveUnavailable,
    );
    monthResults.set(month, result);
    for (const z of result.zeroChecks) zeroChecks.push({ month, ...z });
  }

  // Who the ledger names (RD-5): listed in a record before the target, or seated at a
  // counted service before it.
  const ids = new Set<string>();
  for (const r of records.values()) for (const p of r.people) ids.add(p.memberId);
  for (const x of [...kept, ...secondSeats]) if (before(x.date)) ids.add(x.memberId);
  const members = new Map(input.members.map((m) => [m.id, m]));
  const latestNames = new Map<string, string>();
  for (const r of [...input.records].sort((a, b) => compareCodepoint(a.month, b.month))) {
    for (const p of r.people) latestNames.set(p.memberId, p.name);
  }

  const windowResults = windowMonths.map((m) => monthResults.get(m)).filter((m): m is MonthResult => !!m);
  const cumulativeResults = [...monthResults.values()];
  const latestWindowRecord = [...windowMonths].reverse().map((m) => records.get(m)).find((r) => !!r);

  const people: FairnessPerson[] = [...ids].sort(compareCodepoint).map((id) => {
    const exists = members.has(id);
    const months: FairnessPersonMonth[] = windowMonths.map((month) => {
      const record = records.get(month);
      const result = monthResults.get(month);
      const held: Partial<Record<RoleKey, number>> = {};
      for (const x of [...kept, ...secondSeats]) {
        if (x.memberId === id && x.date.slice(0, 7) === month) held[x.roleKey] = (held[x.roleKey] ?? 0) + 1;
      }
      const lines: Partial<Record<LineKey, Figures>> = result ? sumLines([result], id).lines : {};
      return {
        month,
        recorded: !!record,
        listed: !!record?.people.some((p) => p.memberId === id),
        lines,
        held,
        setAsides: (result?.setAsides ?? [])
          .filter((x) => x.memberId === id)
          .map(({ date, serviceId, roleKey, reason }) => ({ date, serviceId, roleKey, reason }))
          .sort((a, b) => compareCodepoint(a.date, b.date) || compareCodepoint(a.serviceId, b.serviceId) || ROLE_KEYS.indexOf(a.roleKey) - ROLE_KEYS.indexOf(b.roleKey)),
        notes: !record
          ? [{ code: "unrecorded_month" }]
          : record.people.some((p) => p.memberId === id)
            ? (result?.notes.get(id) ?? [])
            : sortNotes([{ code: "not_listed" }, ...(result?.notes.get(id) ?? [])]),
      };
    });
    const windowSum = sumLines(windowResults, id);
    const cumulativeSum = sumLines(cumulativeResults, id);
    const firstRecordedIn: Partial<Record<RoleKey, string>> = {};
    for (const month of recordedMonths) {
      const person = records.get(month)!.people.find((p) => p.memberId === id);
      for (const k of ROLE_KEYS) if (person?.roles[k] === "in" && !firstRecordedIn[k]) firstRecordedIn[k] = month;
    }
    const recordedWindow = windowMonths.filter((m) => records.has(m));
    return {
      memberId: id,
      name: exists ? members.get(id)!.name : (latestNames.get(id) ?? ""),
      exists,
      window: windowSum.lines,
      cumulative: cumulativeSum.lines,
      tabs: { window: windowSum.tabs, cumulative: cumulativeSum.tabs },
      sang: [...kept, ...secondSeats].filter((x) => x.memberId === id && recordedWindow.includes(x.date.slice(0, 7))).length,
      exempt: latestWindowRecord?.people.find((p) => p.memberId === id)?.exempt ?? false,
      months,
      countedSundayLeads: kept
        .filter((x) => x.memberId === id && x.roleKey === "Sun.Lead" && windowMonths.includes(x.date.slice(0, 7)))
        .map((x) => x.date)
        .sort(compareCodepoint),
      firstRecordedIn,
    };
  });

  return {
    output: {
      window: windowMonths.map((month) => ({ month, record: records.has(month) ? summary(records.get(month)!) : null })),
      recordsSince,
      people,
      diagnostics: {
        duplicateTargets,
        notInRecordSeats: cumulativeResults.reduce((n, m) => n + m.setAsides.filter((x) => x.reason === "not_in_record").length, 0),
        unknownMembers: people.filter((p) => !p.exists).map((p) => p.memberId),
      },
    },
    zeroChecks,
  };
}

/**
 * IF2-10 — the ledger's entry point: the GET's `window`, `recordsSince`, `people` and
 * `diagnostics` (RD-3). Same input → same output (LG-16).
 */
export function computeFairnessLedger(input: LedgerInput): Pick<FairnessLedgerResponse, "window" | "recordsSince" | "people" | "diagnostics"> {
  return run(input).output;
}

/**
 * The EXACT balance sum of every (service, role key) and every (presence rule, service)
 * of every recorded month — each must be zero (LG-10, FX-3). Exported for the tests that
 * assert it; nothing else reads it.
 */
export function fairnessLedgerExactSums(input: LedgerInput): Array<{ month: string; serviceId: string; key: string; numerator: string; denominator: string }> {
  return run(input).zeroChecks.map((z) => ({
    month: z.month,
    serviceId: z.serviceId,
    key: z.key,
    numerator: z.sum.n.toString(),
    denominator: z.sum.d.toString(),
  }));
}
