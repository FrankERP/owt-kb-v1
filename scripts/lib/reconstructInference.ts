// scripts/lib/reconstructInference.ts
//
// What each reconstructed record says (solver v3 C4 R4–R9), and how a refusal of C2's
// resolver or validator is reported (R13). Pure: no I/O.
//
// ORDER (spec Interfaces 3, C4's own):
//  (i)   C2's resolver (IF2-15) runs per month on a config whose THREE POOLS are R4's
//        hypothetical ticks — every worship member whose current Tipo fits the pool —
//        and whose restrictions, conflicts, presence and cadence settings are today's,
//        unaltered (D11; C2 §7.4's «as config» governs the rule set, C4 R4 the pools).
//        Any `ok: false` refuses the run; no correction can clear it.
//  (ii)  Only on `ok: true` does `transformMonth` change the body: R5's join bounds only
//        narrow it; R6–R8's corrections may widen a cell or add a person.
//  (iii) The caller runs C2's validator (IF2-18) on the result.
// No seat is counted here: join months read only C2's record-free seat step (IF2-11),
// so the join month and the ledger read the same seats.

import { memberFitsPool, memberFitsRoleKey, rolesOfPatternV3, type SolverConfig } from "../../app/components/admin/plannerModel";
import { countsForFairness } from "../../app/utils/countsForFairness";
import type { EligibilityResult } from "../../app/utils/fairnessEligibility";
import { civilDayOfWeek, keepVoiceSeats, type LedgerService } from "../../app/utils/fairnessLedger";
import { ROLE_KEYS, ROLE_LINE, canonicalRoles, compareCodepoint, type FairnessMonthBody, type RoleKey, type Status } from "../../app/utils/fairnessVocabulary";
import { isValidServiceDate } from "../../app/utils/serviceReadModel";
import { serviceDayKey } from "../../app/utils/serviceReadSelect";
import { resolveRulePersonId, type RosterMember } from "../../app/utils/sundayCadence";
import { ALL_MONTHS, type MemberOverride } from "./reconstructOverrides";
import {
  LINES,
  LINE_ROLES,
  ReadFailure,
  type Anomaly,
  type CellReason,
  type Correction,
  type Line,
  type PersonCells,
  type RefusalKind,
  type RosterRow,
  type RunRefusal,
} from "./reconstructTypes";

type Person = FairnessMonthBody["people"][number];

// ─── R4 ─────────────────────────────────────────────────────────────────────────

/** R4: the pools as Tipo today would tick them (C2 RES-1's effective-pool rule); every rule array is today's, by reference (D11). */
export function hypotheticalConfig(config: SolverConfig, roster: readonly RosterRow[]): SolverConfig {
  const fit = (field: "sundayLeads" | "saturdayLeads" | "support") =>
    roster
      .filter((m) => memberFitsPool(m, field))
      .map((m) => m._id)
      .sort(compareCodepoint);
  return { ...config, sundayLeads: fit("sundayLeads"), saturdayLeads: fit("saturdayLeads"), support: fit("support") };
}

// ─── Services and seats ─────────────────────────────────────────────────────────

const ROLE_TYPE_NAMES = ["sunday_role", "saturday_role", "special_role"];

/**
 * IF2-26 rows → IF2-10 `LedgerService`s. A row that is not an object, lacks a string
 * `_id` or carries another `_type` is a malformed read (R3). A row whose stored date
 * is not a calendar day is dropped — the ledger drops it too (LG-1). `date` is the
 * normalised `YYYY-MM-DD` (`serviceDayKey`, the C2 plan's date normaliser).
 */
export function toLedgerServices(rows: unknown): LedgerService[] {
  if (!Array.isArray(rows)) throw new ReadFailure("services");
  const refs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x !== "") : []);
  const out: LedgerService[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object" || Array.isArray(row)) throw new ReadFailure("services");
    const r = row as Record<string, unknown>;
    if (typeof r._id !== "string" || !ROLE_TYPE_NAMES.includes(String(r._type))) throw new ReadFailure("services");
    const day = serviceDayKey(r.date);
    if (day === null) continue;
    out.push({
      _id: r._id,
      _type: r._type as LedgerService["_type"],
      date: day,
      ...(typeof r.time === "string" ? { time: r.time } : {}),
      ...(typeof r.published === "boolean" ? { published: r.published } : {}),
      ...(typeof r.countsForFairness === "boolean" ? { countsForFairness: r.countsForFairness } : {}),
      Lead: refs(r.Lead),
      BGVs: refs(r.BGVs),
      Chorus: refs(r.Chorus),
    });
  }
  return out.sort((a, b) => compareCodepoint(a.date, b.date) || compareCodepoint(a._id, b._id));
}

export type SeatJoins = Map<string, Partial<Record<Line, { month: string; firstSeatDate: string }>>>;

/**
 * R5: per person and line, the month (and date) of the earliest KEPT seat at a counted
 * service in the join window — C2's IF2-11 `kept` only, so a second seat, a seat in a
 * duplicated weekend document or one in an uncounted service never sets a join month.
 */
export function seatJoinMonths(joinWindow: readonly LedgerService[]): SeatJoins {
  const joins: SeatJoins = new Map();
  for (const seat of keepVoiceSeats([...joinWindow]).kept) {
    const line = ROLE_LINE[seat.roleKey];
    const entry = joins.get(seat.memberId) ?? {};
    const prior = entry[line];
    if (!prior || seat.date < prior.firstSeatDate) entry[line] = { month: seat.date.slice(0, 7), firstSeatDate: seat.date };
    joins.set(seat.memberId, entry);
  }
  return joins;
}

export interface CountedDay {
  id: string;
  date: string;
  /** Sunday class: a `sunday_role`, or a counted special dated on a Sunday (C2 LG-4). */
  sunday: boolean;
  weekend: boolean;
}

/**
 * The counted services of a list, with their day class — composed from C1's read rule
 * and C2's exported seat step (its duplicate targets) and civil weekday; no second
 * rule. Used for R13's «first counted service of the line» and the presence check.
 */
export function countedServiceDays(services: readonly LedgerService[]): CountedDay[] {
  const dropped = new Set(keepVoiceSeats([...services]).duplicateTargets.flatMap((d) => d.roleIds));
  return services
    .filter((s) => !s._id.startsWith("drafts.") && !dropped.has(s._id) && countsForFairness(s))
    .map((s) => ({
      id: s._id,
      date: s.date,
      sunday: s._type === "sunday_role" || (s._type === "special_role" && civilDayOfWeek(s.date) === 0),
      weekend: s._type !== "special_role",
    }))
    .sort((a, b) => compareCodepoint(a.date, b.date) || compareCodepoint(a.id, b.id));
}

// ─── R5–R8 ──────────────────────────────────────────────────────────────────────

export interface TransformResult {
  /** The transformed body, people by member id, every list in canonical order. */
  body: FairnessMonthBody;
  /** Per person and role: the reason code and the «corregido» mark (R11). */
  cells: Map<string, PersonCells>;
  corrections: Correction[];
  /** Effective join month per line (seat-derived, or corrected) — the table's column. */
  joins: Map<string, Partial<Record<Line, string>>>;
  /** `rule_split` and `person_added` (R13). */
  anomalies: Anomaly[];
  /** `replacement_incomplete` (R8). */
  refusals: RunRefusal[];
}

const clonePerson = (p: Person): Person => ({
  memberId: p.memberId,
  roles: { ...p.roles },
  exactRules: p.exactRules.map((r) => ({ roles: [...r.roles], count: r.count })),
  ...(p.sundayCadence === "alternate" ? { sundayCadence: "alternate" as const } : {}),
  exempt: p.exempt,
  blocks: p.blocks.map((b) => ({ date: b.date, unavailable: b.unavailable, excludedRoles: [...b.excludedRoles] })),
});

const cellsOf = (reason: (k: RoleKey) => CellReason): PersonCells =>
  Object.fromEntries(ROLE_KEYS.map((k) => [k, { reason: reason(k), corrected: false }])) as PersonCells;

/** RES-4's block for each stored `unavailableDates` entry inside the month — for a person a correction adds (R8). */
function storedUnavailableBlocks(member: RosterRow, month: string): Person["blocks"] {
  const dates = new Set<string>();
  for (const raw of member.unavailableDates ?? []) {
    const date = typeof raw === "string" ? raw.slice(0, 10) : "";
    if (isValidServiceDate(date) && date.slice(0, 7) === month) dates.add(date);
  }
  return [...dates].sort(compareCodepoint).map((date) => ({ date, unavailable: true, excludedRoles: [] }));
}

export function transformMonth(input: {
  month: string;
  body: FairnessMonthBody;
  roster: readonly RosterRow[];
  seatJoins: SeatJoins;
  overrides: readonly MemberOverride[];
}): TransformResult {
  const { month } = input;
  const byId = new Map(input.roster.map((m) => [m._id, m]));
  const overrideOf = new Map(input.overrides.map((o) => [o.memberId, o]));
  const people = new Map(input.body.people.map((p) => [p.memberId, clonePerson(p)]));
  const cells = new Map<string, PersonCells>();
  const corrections: Correction[] = [];
  const anomalies: Anomaly[] = [];
  const refusals: RunRefusal[] = [];
  const joins = new Map<string, Partial<Record<Line, string>>>();

  const effectiveJoins = (memberId: string): Partial<Record<Line, string>> => {
    const seat = input.seatJoins.get(memberId) ?? {};
    const override = overrideOf.get(memberId);
    const out: Partial<Record<Line, string>> = {};
    for (const line of LINES) {
      const joined = override?.joinMonths[line] ?? seat[line]?.month;
      if (joined !== undefined) out[line] = joined;
    }
    return out;
  };
  const mark = (memberId: string, field: Correction["field"]) => {
    if (!corrections.some((c) => c.memberId === memberId && c.field === field)) corrections.push({ memberId, field });
  };

  // Reasons as Tipo and today's rules left each cell (R11), before any transform.
  for (const p of people.values()) {
    const member = byId.get(p.memberId);
    cells.set(
      p.memberId,
      cellsOf((k) => {
        if (!memberFitsRoleKey(member, k)) return "sin_tipo";
        return p.roles[k] === "exact" ? "fija" : p.roles[k] === "out" ? "regla" : "tipo";
      }),
    );
  }

  // R5 + R6 — join bounds only narrow; the cadence line is never join-bounded.
  for (const p of people.values()) {
    const override = overrideOf.get(p.memberId);
    const cadence = override?.sundayCadence ? override.sundayCadence === "alternate" : p.sundayCadence === "alternate";
    const effective = effectiveJoins(p.memberId);
    joins.set(p.memberId, effective);
    const personCells = cells.get(p.memberId)!;
    const cut = new Set<RoleKey>();
    for (const line of LINES) {
      if (line === "DL" && cadence) continue;
      const joined = effective[line];
      if (joined !== undefined && joined <= month) continue;
      for (const k of LINE_ROLES[line]) {
        if (p.roles[k] === "out") continue;
        p.roles[k] = "out";
        personCells[k] = { reason: "linea", corrected: false };
        cut.add(k);
      }
    }
    if (cut.size === 0) continue;
    const kept: Person["exactRules"] = [];
    for (const rule of p.exactRules) {
      if (!rule.roles.some((k) => cut.has(k))) {
        kept.push(rule);
        continue;
      }
      // «Exact rules stay whole»: the cut removes the rule for this month; a joined role it also covered is plainly "in".
      const freed = rule.roles.filter((k) => !cut.has(k) && p.roles[k] === "exact");
      for (const k of freed) {
        p.roles[k] = "in";
        personCells[k] = { reason: "partida", corrected: false };
      }
      if (freed.length > 0) anomalies.push({ code: "rule_split", month, memberId: p.memberId, roles: canonicalRoles(freed) });
    }
    p.exactRules = kept;
  }

  // R6–R8 — Frank's corrections win over every inferred value.
  for (const o of input.overrides) {
    const entry = o.months[month] ?? o.months[ALL_MONTHS];
    const setsRole = !!entry && (Object.keys(entry.roles).length > 0 || entry.exactRules.length > 0);
    let p = people.get(o.memberId);
    if (!p) {
      const member = byId.get(o.memberId);
      if (!setsRole || !member) continue;
      // «Adding a person»: a worship member the resolver did not list (no `voz` today).
      p = {
        memberId: o.memberId,
        roles: Object.fromEntries(ROLE_KEYS.map((k) => [k, "out"])) as Record<RoleKey, Status>,
        exactRules: [],
        exempt: false,
        blocks: storedUnavailableBlocks(member, month),
      };
      people.set(o.memberId, p);
      cells.set(o.memberId, cellsOf(() => "sin_tipo"));
      joins.set(o.memberId, effectiveJoins(o.memberId));
      anomalies.push({ code: "person_added", month, memberId: o.memberId });
      mark(o.memberId, "added");
    }
    const personCells = cells.get(o.memberId)!;
    if (entry) {
      // The replacement rule (A38): a correction that sets a role replaces, whole, every
      // exact rule covering it; each other role such a rule covers must be set too.
      const setRoles = new Set<RoleKey>([...(Object.keys(entry.roles) as RoleKey[]), ...entry.exactRules.flatMap((r) => r.roles)]);
      const remaining: Person["exactRules"] = [];
      for (const rule of p.exactRules) {
        if (!rule.roles.some((k) => setRoles.has(k))) {
          remaining.push(rule);
          continue;
        }
        const missing = rule.roles.filter((k) => !setRoles.has(k));
        if (missing.length > 0) {
          refusals.push({
            reason: "replacement_incomplete",
            kind: "corrección",
            rules: [{ ordinal: `entrada ${o.ordinal} del archivo`, key: null }],
            month,
            memberIds: [o.memberId],
            detail: `La corrección cambia un rol que una regla fija de hoy cubre junto con ${missing.join(", ")}; una corrección reemplaza la regla entera (A38).`,
            fix: `Indica también ${missing.join(", ")} para ${month} en la misma entrada (un estado o una regla fija).`,
          });
        }
      }
      p.exactRules = remaining;
      for (const [k, status] of Object.entries(entry.roles) as Array<[RoleKey, "in" | "out"]>) {
        p.roles[k] = status;
        personCells[k] = { reason: "correccion", corrected: true };
        mark(o.memberId, k);
      }
      for (const rule of entry.exactRules) {
        p.exactRules.push({ roles: canonicalRoles(rule.roles), count: rule.count });
        for (const k of rule.roles) {
          p.roles[k] = "exact";
          personCells[k] = { reason: "correccion", corrected: true };
          mark(o.memberId, k);
        }
      }
    }
    if (o.exempt !== null) {
      p.exempt = o.exempt;
      mark(o.memberId, "exempt");
    }
    if (o.sundayCadence === "alternate") {
      p.sundayCadence = "alternate";
      mark(o.memberId, "sundayCadence");
    } else if (o.sundayCadence === "normal") {
      delete p.sundayCadence;
      mark(o.memberId, "sundayCadence");
    }
    const dates = o.blockedDates.filter((d) => d.date.slice(0, 7) === month);
    for (const d of dates) {
      let block = p.blocks.find((b) => b.date === d.date);
      if (!block) {
        block = { date: d.date, unavailable: false, excludedRoles: [] };
        p.blocks.push(block);
      }
      if (d.roles === null) block.unavailable = true;
      else block.excludedRoles = canonicalRoles([...block.excludedRoles, ...d.roles]);
    }
    if (dates.length > 0) mark(o.memberId, "blocks");
  }

  const body: FairnessMonthBody = {
    month,
    people: [...people.values()]
      .sort((a, b) => compareCodepoint(a.memberId, b.memberId))
      .map((p) => ({
        ...p,
        exactRules: [...p.exactRules].sort((a, b) => compareCodepoint(a.roles.join(","), b.roles.join(","))),
        blocks: [...p.blocks].sort((a, b) => compareCodepoint(a.date, b.date)),
      })),
    presence: input.body.presence.map((r) => ({ ruleKey: r.ruleKey, roles: [...r.roles], members: [...r.members], exclusive: r.exclusive })),
  };
  corrections.sort((a, b) => compareCodepoint(a.memberId, b.memberId) || compareCodepoint(a.field, b.field));
  return { body, cells, corrections, joins, anomalies, refusals };
}

// ─── R13 — refusals ─────────────────────────────────────────────────────────────

const RESOLVER_TEXT: Record<string, { detail: string; fix: string }> = {
  unresolved: { detail: "Un nombre de las reglas no coincide con ningún miembro de alabanza.", fix: "Corrige el nombre en el panel de reglas." },
  ambiguous: { detail: "Un nombre de las reglas coincide con más de un miembro de alabanza.", fix: "Usa un nombre o alias único en el panel de reglas." },
  no_tipo: { detail: "Una regla nombra a un miembro sin Tipo.", fix: "Dale un Tipo en /admin o quita la regla." },
  cadence_and_exact: {
    detail: "«Mes por medio» y una cuenta fija de Sun.Lead para la misma persona (A11).",
    fix: "Quita uno de los dos en el panel de reglas; una corrección no lo resuelve (D11).",
  },
  overlapping_exact: { detail: "Dos cuentas fijas cubren el mismo rol para la misma persona (A38).", fix: "Deja una sola en el panel de reglas." },
  exact_count_range: { detail: "Una cuenta fija (==) no es un entero de 0 a 31 en este mes.", fix: "Corrige el valor en el panel de reglas." },
  presence_member_not_listed: { detail: "Una regla de presencia nombra a alguien sin voz en su Tipo.", fix: "Corrige la regla o el Tipo." },
  no_people: { detail: "Ningún miembro de alabanza tiene voz en su Tipo.", fix: "Revisa los Tipos en /admin." },
  too_many_people: { detail: "Más de 100 personas con voz: el registro no las admite.", fix: "Revisa los Tipos en /admin." },
  too_many_presence: { detail: "Más de 20 reglas de presencia.", fix: "Quita reglas de presencia en el panel." },
  presence_rule_id: { detail: "Una regla de presencia tiene un id inválido o repetido.", fix: "Vuelve a guardar la regla desde el panel." },
  presence_roles: { detail: "Una regla de presencia no cubre ningún rol.", fix: "Corrige el patrón de la regla." },
  presence_members: { detail: "Una regla de presencia no tiene de 2 a 12 miembros distintos.", fix: "Corrige los miembros de la regla." },
};
const FALLBACK_TEXT = { detail: "El resolvedor de C2 rechazó las reglas de hoy.", fix: "Corrige el panel de reglas." };

/**
 * The config ordinals of the rules a person-refusal is about (R12, R13). IF2-15's
 * refusals carry only the rule's `person` text, so the run finds every rule whose own
 * text is that string, filtered by reason, and prints their ORDINALS; the text and
 * the raw keys go to the private report only.
 */
export function rulesNaming(config: SolverConfig, person: string, reason: string): Array<{ ordinal: string; key: string }> {
  const out: Array<{ ordinal: string; key: string }> = [];
  const names = reason === "unresolved" || reason === "ambiguous" || reason === "no_tipo";
  config.restrictions.forEach((r, i) => {
    if (r.person !== person) return;
    const base = `restricción ${i + 1} de ${config.restrictions.length}`;
    const exactCaps = r.caps.map((c, j) => ({ c, j })).filter(({ c }) => c.op === "==");
    if (reason === "overlapping_exact" || reason === "exact_count_range") {
      for (const { c, j } of exactCaps) out.push({ ordinal: `${base}, tope ${j + 1}`, key: c.id });
    } else if (reason === "cadence_and_exact") {
      if (r.sundayCadence === "alternate") out.push({ ordinal: base, key: r.id });
      for (const { c, j } of exactCaps) {
        if (rolesOfPatternV3(c.pattern).includes("Sun.Lead")) out.push({ ordinal: `${base}, tope ${j + 1}`, key: c.id });
      }
    } else if (names) {
      out.push({ ordinal: base, key: r.id });
    }
  });
  if (names) {
    config.conflicts.forEach((c, i) => {
      if (c.personA === person || c.personB === person) out.push({ ordinal: `conflicto ${i + 1} de ${config.conflicts.length}`, key: c.id });
    });
  }
  if (names || reason === "presence_member_not_listed") {
    config.presence.forEach((p, i) => {
      if (p.persons.includes(person)) out.push({ ordinal: `presencia ${i + 1} de ${config.presence.length}`, key: p.id });
    });
  }
  return out;
}

function kindOf(reason: string, rules: ReadonlyArray<{ ordinal: string }>): RefusalKind {
  if (reason === "cadence_and_exact") return "mes por medio";
  if (reason === "overlapping_exact" || reason === "exact_count_range") return "regla fija";
  if (reason === "presence_member_not_listed") return "presencia";
  const first = rules[0]?.ordinal ?? "";
  return first.startsWith("conflicto") ? "conflicto" : first.startsWith("presencia") ? "presencia" : "restricción";
}

/** Every IF2-15 `ok: false` — each refusal and each issue — as one refusal of the run (R13; terminal, D11). */
export function resolverRefusals(
  result: Extract<EligibilityResult, { ok: false }>,
  config: SolverConfig,
  roster: readonly RosterRow[],
  month: string,
): RunRefusal[] {
  const out: RunRefusal[] = [];
  for (const issue of result.issues) {
    const text = RESOLVER_TEXT[issue.code] ?? FALLBACK_TEXT;
    if (issue.ruleKey !== undefined) {
      const i = config.presence.findIndex((r) => r.id === issue.ruleKey);
      out.push({
        reason: issue.code,
        kind: "presencia",
        rules: [{ ordinal: i >= 0 ? `presencia ${i + 1} de ${config.presence.length}` : "presencia", key: issue.ruleKey }],
        month,
        detail: text.detail,
        fix: text.fix,
      });
    } else {
      out.push({ reason: issue.code, kind: issue.code === "too_many_presence" ? "presencia" : "personas", rules: [], month, detail: text.detail, fix: text.fix });
    }
  }
  for (const refusal of result.refusals) {
    const text = RESOLVER_TEXT[refusal.reason] ?? FALLBACK_TEXT;
    const rules = rulesNaming(config, refusal.person, refusal.reason);
    const resolved = resolveRulePersonId(refusal.person, [...roster] as RosterMember[]);
    out.push({
      reason: refusal.reason,
      kind: kindOf(refusal.reason, rules),
      rules,
      month,
      person: refusal.person,
      memberIds: resolved.ok ? [resolved.id] : resolved.matches,
      detail: text.detail,
      fix: text.fix,
    });
  }
  return out;
}

/**
 * IF2-18 refused a transformed body. By RES-8 an untransformed body always passes, so
 * the cause is a correction (an A11 pair, an A38 overlap) — the issues are index-based
 * and printable; the members and their entries go to the report.
 */
export function validatorRefusal(
  month: string,
  body: FairnessMonthBody,
  issues: Array<{ path: string; message: string }>,
  overrides: readonly MemberOverride[],
): RunRefusal {
  const ids = new Set<string>();
  for (const issue of issues) {
    const m = /^people\[(\d+)\]/.exec(issue.path);
    const found = m ? body.people[Number(m[1])] : undefined;
    if (found) ids.add(found.memberId);
  }
  return {
    reason: "invalid_body",
    kind: "corrección",
    rules: overrides.filter((o) => ids.has(o.memberId)).map((o) => ({ ordinal: `entrada ${o.ordinal} del archivo`, key: null })),
    month,
    issues,
    memberIds: [...ids].sort(compareCodepoint),
    detail:
      "El registro corregido no pasa el validador del registro (IF2-18): una corrección lo contradice — por ejemplo «Mes por medio» junto a una cuenta fija de Sun.Lead (A11), o dos cuentas fijas para un rol (A38).",
    fix: "Corrige esa entrada (p. ej. «sundayCadence» \"normal\", o Sun.Lead \"in\", que reemplaza la regla fija) y vuelve a correr el dry run.",
  };
}

/** One line per distinct refusal across months (the earliest month kept). */
export function dedupeRefusals(list: readonly RunRefusal[]): RunRefusal[] {
  const seen = new Set<string>();
  return list.filter((r) => {
    const key = `${r.reason}\u0000${r.person ?? ""}\u0000${r.rules.map((x) => x.key ?? x.ordinal).join(",")}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
