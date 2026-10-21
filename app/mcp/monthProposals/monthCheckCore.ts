// The month check's JUDGING CORE (MCP proposal editor, plan T2.4/E5): a board in the solver's own
// wire shapes (a `contract: 3` request and an assignment per service) in, the rule instances it
// breaks and the protections it misses out. Pure, no I/O, no names — rule ids, member ids and
// service ids only; `monthCheck.ts` turns them into lines.
//
// It is a port of `gcf_v3/acceptance/checker.py`'s `_instances` and `_protections`, the solver's
// independent checker, and `fixtures/month-check/parity.json` holds both to the same answers
// (`monthCheckParity.test.ts` here, `gcf_v3/tests/test_month_check_parity.py` there). The checker
// answers «did the SOLVER keep its promises»; this answers «does Frank's board meet the rules AS
// WRITTEN», so it differs from the checker on purpose in exactly two places, each pinned by
// hand-computed cases in `fixtures/month-check/cases.json`:
//
//   1. NO CLAMPING. The solver lowers an `==`/`>=` rule to the person's availability; a check of a
//      hand edit judges the value as written and reports the availability beside it.
//   2. A SEATED PERSON COUNTS toward a pair or presence rule whoever they are. The checker only
//      counts a person eligible for the seat (it judges the solver, which never seats anyone
//      else); a forced seat or a person who became unavailable is still in the room.
//
// Everything else — which services a rule looks at, how a count is taken, every protection's
// condition and scope — is the checker's, line for line, and changes only together with it.

import { civilDayOfWeek } from "@/app/utils/fairnessLedger";
import { compareCodepoint } from "@/app/utils/fairnessVocabulary";
import type { V3Pin, V3Prior, V3Role, V3Rule, V3Service, V3SolveRequest } from "@/app/components/admin/v3Wire";

const ROLES: readonly V3Role[] = ["Lead", "BGV", "Choir"];

/** The wire a check judges: the request's planning facts, never its seed or id. */
export type CheckRequest = Pick<V3SolveRequest, "months" | "services" | "people" | "rules" | "pins" | "prior">;
export type CheckAssignments = Readonly<Record<string, Partial<Record<V3Role, readonly string[]>>>>;

export type InstanceFamily = "count" | "pair" | "presence" | "mandatory_lead";
export const PROTECTION_CODES = [
  "sunday_cap_exceeded", "saturday_cap_exceeded", "consecutive_sundays", "voice_floor_missed",
  "dl_floor_missed", "compensation_missed", "cadence_on_missed", "cadence_off_led",
] as const;
export type ProtectionCode = (typeof PROTECTION_CODES)[number];

/** One broken rule instance: `scope` is the month (count) or the service id (pair, presence, Lead). */
export interface BrokenInstance {
  family: InstanceFamily;
  /** The wire rule id; `"mandatory_lead"` for the Lead instance, as the checker keys it. */
  rule: string;
  scope: string;
  /** count only: how many the person holds, what the rule asks, and how many weekends she could serve. */
  observed?: number;
  limit?: number;
  available?: number;
}

/** One missed protection: `scope` is the month, or the first Sunday of a consecutive pair. */
export interface MissedProtection {
  code: ProtectionCode;
  person: string;
  scope: string;
  /** The caps: Leads that month. */
  count?: number;
  /** `dl_floor_missed`: the two months with no Sunday Lead. */
  month1?: string;
  /** `consecutive_sundays`: both Sundays. */
  dates?: string[];
}

export interface CoreVerdict {
  instances: BrokenInstance[];
  missed: MissedProtection[];
}

// ── Dates (the checker's own helpers) ───────────────────────────────────────

const dayOf = (date: string): "Sun" | "Sat" => (civilDayOfWeek(date) === 0 ? "Sun" : "Sat");

function plusDays(date: string, k: number): string {
  const d = new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)) + k));
  return d.toISOString().slice(0, 10);
}

function prevMonth(month: string): string {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

// ── The request, indexed (the checker's `_Request`) ─────────────────────────

class Indexed {
  readonly svc = new Map<string, V3Service>();
  readonly people: CheckRequest["people"];
  private readonly person = new Map<string, CheckRequest["people"][number]>();
  private readonly pins = new Set<string>();
  readonly pinAt = new Set<string>();

  constructor(readonly req: CheckRequest) {
    for (const s of req.services) this.svc.set(s.id, s);
    this.people = req.people;
    for (const p of req.people) this.person.set(p.id, p);
    for (const p of req.pins as readonly V3Pin[]) {
      this.pins.add(`${p.service}|${p.role}|${p.person}`);
      this.pinAt.add(`${p.service}|${p.person}`);
    }
  }

  roles(s: V3Service): readonly V3Role[] {
    if (s.fixed) return ROLES;
    return s.kind === "saturday" ? ["Lead", "BGV"] : ROLES;
  }

  key(s: V3Service, role: V3Role): string {
    return `${dayOf(s.date)}.${role}`;
  }

  pinned(sid: string, role: V3Role, p: string): boolean {
    return this.pins.has(`${sid}|${role}|${p}`);
  }

  eligible(p: string, sid: string, role: V3Role): boolean {
    return (this.person.get(p)?.eligibility[sid] ?? []).includes(role);
  }

  could(p: string, sid: string, role: V3Role): boolean {
    const s = this.svc.get(sid)!;
    return this.pinned(sid, role, p) || (!s.fixed && this.eligible(p, sid, role));
  }

  exact(p: string, month: string, key: string): boolean {
    return this.req.rules.some((r) => r.kind === "count" && r.op === "==" && r.person === p && r.month === month
      && (r.roles as readonly string[]).includes(key) && r.value >= 1);
  }
}

type Seat = { sid: string; role: V3Role; p: string };

function seatsOf(assignments: CheckAssignments): { list: Seat[]; has: (sid: string, role: V3Role, p: string) => boolean } {
  const list: Seat[] = [];
  const keys = new Set<string>();
  for (const [sid, roles] of Object.entries(assignments)) {
    for (const role of ROLES) {
      for (const p of roles[role] ?? []) {
        const k = `${sid}|${role}|${p}`;
        if (keys.has(k)) continue;
        keys.add(k);
        list.push({ sid, role, p });
      }
    }
  }
  return { list, has: (sid, role, p) => keys.has(`${sid}|${role}|${p}`) };
}

// ── Rule instances (the checker's `_instances`, with differences 1 and 2) ───

function instances(R: Indexed, seated: ReturnType<typeof seatsOf>): BrokenInstance[] {
  const broken: BrokenInstance[] = [];
  const weekend = R.req.services.filter((s) => s.kind !== "special");
  for (const r of R.req.rules as readonly V3Rule[]) {
    if (r.kind === "count") {
      const roles = r.roles as readonly string[];
      const available = weekend.filter((s) => s.month === r.month
        && R.roles(s).some((role) => roles.includes(R.key(s, role)) && R.could(r.person, s.id, role))).length;
      const n = seated.list.filter(({ sid, role, p }) => {
        const s = R.svc.get(sid);
        return p === r.person && s !== undefined && s.kind !== "special" && s.month === r.month && roles.includes(R.key(s, role));
      }).length;
      // Difference 1: the value as written, never min(value, available).
      const bad = r.op === "==" ? n !== r.value : r.op === "<=" ? n > r.value : n < r.value;
      if (bad) broken.push({ family: "count", rule: r.id, scope: r.month, observed: n, limit: r.value, available });
    } else if (r.kind === "pair" || r.kind === "presence") {
      const roles = r.roles as readonly string[];
      for (const s of weekend) {
        if (r.month !== undefined && s.month !== r.month) continue;
        // Difference 2: a seated person is a term whoever they are.
        const terms: Array<{ role: V3Role; p: string }> = [];
        for (const role of R.roles(s)) {
          if (!roles.includes(R.key(s, role))) continue;
          for (const p of r.persons) if (R.could(p, s.id, role) || seated.has(s.id, role, p)) terms.push({ role, p });
        }
        const held = terms.filter(({ role, p }) => seated.has(s.id, role, p)).length;
        if (r.kind === "pair") {
          const persons = new Set(terms.map((t) => t.p));
          if (r.persons.every((p) => persons.has(p)) && persons.size === new Set(r.persons).size && held >= 2) {
            broken.push({ family: "pair", rule: r.id, scope: s.id });
          }
        } else {
          const applies = terms.length > 0 || R.roles(s).some((role) =>
            roles.includes(R.key(s, role)) && r.persons.some((p) => R.eligible(p, s.id, role)));
          if (applies && held === 0) broken.push({ family: "presence", rule: r.id, scope: s.id });
        }
      }
    }
  }
  for (const s of weekend) {
    if (s.fixed || !R.roles(s).includes("Lead")) continue;
    const candidates = R.people.filter((p) => R.could(p.id, s.id, "Lead"));
    if (candidates.length > 0 && !candidates.some((p) => seated.has(s.id, "Lead", p.id))) {
      broken.push({ family: "mandatory_lead", rule: "mandatory_lead", scope: s.id });
    }
  }
  return broken;
}

// ── Protections (the checker's `_protections`) ──────────────────────────────

function protections(R: Indexed, seated: ReturnType<typeof seatsOf>): MissedProtection[] {
  const missed: MissedProtection[] = [];
  const counted = R.req.services.filter((s) => s.counts);
  const count = (p: string, m: string, pred: (s: V3Service, role: V3Role) => boolean) =>
    seated.list.filter(({ sid, role, p: q }) => {
      const s = R.svc.get(sid);
      return q === p && s !== undefined && s.counts && s.month === m && pred(s, role);
    }).length;
  const L = (p: string, m: string) => count(p, m, (s, r) => r === "Lead" && dayOf(s.date) === "Sun");
  const S = (p: string, m: string) => count(p, m, (s, r) => r === "Lead" && dayOf(s.date) === "Sat");
  const V = (p: string, m: string) => count(p, m, () => true);

  for (const person of R.people) {
    const p = person.id;
    for (const m of R.req.months) {
      const state = person.cadence?.[m];
      if (state !== undefined) {
        if (state === "on" && L(p, m) === 0) missed.push({ code: "cadence_on_missed", person: p, scope: m });
        if ((state === "off" || state === "out") && L(p, m) >= 1) missed.push({ code: "cadence_off_led", person: p, scope: m });
        if (state === "off" && L(p, m) === 0 && S(p, m) === 0) missed.push({ code: "compensation_missed", person: p, scope: m });
      }
      if (!person.exempt && counted.some((s) => s.month === m && ((person.eligibility[s.id] ?? []).length > 0 || R.pinAt.has(`${s.id}|${p}`)))) {
        if (V(p, m) === 0) missed.push({ code: "voice_floor_missed", person: p, scope: m });
      }
      for (const [key, cnt, code] of [["Sun.Lead", L, "sunday_cap_exceeded"], ["Sat.Lead", S, "saturday_cap_exceeded"]] as const) {
        const n = cnt(p, m);
        if (!R.exact(p, m, key) && n >= 2) missed.push({ code, person: p, scope: m, count: n });
      }
    }
  }

  R.req.months.forEach((m, i) => {
    const prev = prevMonth(m);
    for (const person of R.people) {
      const p = person.id;
      if (person.cadence || R.exact(p, m, "Sun.Lead")) continue;
      const onLine = R.req.services.some((s) => s.month === m && s.counts && (
        (s.kind === "sunday" && (person.eligibility[s.id] ?? []).includes("Lead"))
        || (dayOf(s.date) === "Sun" && R.pinned(s.id, "Lead", p))));
      if (!onLine) continue;
      const since = person.dl_since;
      if (since === null || compareCodepoint(prev, since) < 0) continue;
      if (prev === R.req.prior.month && !R.req.prior.has_services) continue;
      const before = i === 0 ? person.prev_dl_leads : L(p, R.req.months[0]);
      if (before + L(p, m) === 0) missed.push({ code: "dl_floor_missed", person: p, scope: m, month1: prev });
    }
  });

  const horizon = new Set(R.req.services.map((s) => s.date));
  for (const person of R.people) {
    const p = person.id;
    const leads = new Set<string>();
    for (const { sid, role, p: q } of seated.list) {
      const s = R.svc.get(sid);
      if (s && q === p && role === "Lead" && s.counts && dayOf(s.date) === "Sun") leads.add(s.date);
    }
    for (const ps of (R.req.prior as V3Prior).services) {
      if (ps.counts && dayOf(ps.date) === "Sun" && ps.seats.Lead.includes(p)) leads.add(ps.date);
    }
    for (const d of [...leads].sort(compareCodepoint)) {
      const next = plusDays(d, 7);
      if (leads.has(next) && horizon.has(next)) missed.push({ code: "consecutive_sundays", person: p, scope: d, dates: [d, next] });
    }
  }
  return missed;
}

// ── Entry ───────────────────────────────────────────────────────────────────

const byTriple = <T>(f: (x: T) => [string, string, string]) => (a: T, b: T) => {
  const x = f(a);
  const y = f(b);
  for (let i = 0; i < 3; i++) {
    const c = compareCodepoint(x[i], y[i]);
    if (c !== 0) return c;
  }
  return 0;
};

/**
 * Judge `assignments` under `req`. Each instance or miss appears once, sorted as the checker
 * sorts its tuples, so the parity test compares lists.
 */
export function judgeMonthWire(req: CheckRequest, assignments: CheckAssignments): CoreVerdict {
  const R = new Indexed(req);
  const seated = seatsOf(assignments);
  const uniq = <T>(items: T[], key: (x: T) => string) => {
    const seen = new Set<string>();
    return items.filter((x) => (seen.has(key(x)) ? false : (seen.add(key(x)), true)));
  };
  const inst = uniq(instances(R, seated), (x) => `${x.family}|${x.rule}|${x.scope}`)
    .sort(byTriple((x) => [x.family, x.rule, x.scope]));
  const miss = uniq(protections(R, seated), (x) => `${x.code}|${x.person}|${x.scope}`)
    .sort(byTriple((x) => [x.code, x.person, x.scope]));
  return { instances: inst, missed: miss };
}
