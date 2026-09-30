// app/components/admin/pinViolations.ts
//
// What the solver set aside to honour the pins (ADR-0041 `pin_violations`), in the admin's
// words (spec 2026-09-29 §3.3). Each entry is parsed per its six forms, mapped back to the rule
// in the config it came from, and named the way the rules card names it. An entry that does not
// parse or match renders one generic line — never dropped.

import type { RankMember } from "./candidateRanking";
import {
  capLabel,
  resolvedCapValue,
  resolvedNameOrRaw,
  saturdayForWeek,
  type SolverConfig,
} from "./plannerModel";
import { serviceDayLabel, serviceOfRole, type Pin } from "./pinModel";
import { parsePattern } from "./ruleEnforcement";

export type ParsedViolation =
  | { kind: "count"; person: string; source: string }
  | { kind: "presence"; week: number; source: string }
  | { kind: "pair"; week: number; service: "Sun" | "Sat"; source: string }
  | { kind: "consecutive"; week: number; person: string; source: string }
  | { kind: "mandatoryLead"; week: number; service: "Sun" | "Sat" }
  | { kind: "satAnchor"; week: number };

export function parsePinViolation(entry: string): ParsedViolation | null {
  let m = /^builtin:mandatory_lead:W(\d+):(Sun|Sat)$/.exec(entry);
  if (m) return { kind: "mandatoryLead", week: Number(m[1]), service: m[2] as "Sun" | "Sat" };
  m = /^builtin:sat_anchor:W(\d+)$/.exec(entry);
  if (m) return { kind: "satAnchor", week: Number(m[1]) };
  if (entry.startsWith("builtin:")) return null;
  m = /^W(\d+)-(\d+) (.+?): (.+)$/.exec(entry);
  if (m) {
    return Number(m[2]) === Number(m[1]) + 1
      ? { kind: "consecutive", week: Number(m[1]), person: m[3], source: m[4] }
      : null;
  }
  m = /^W(\d+) (Sun|Sat): (.+)$/.exec(entry);
  if (m) return { kind: "pair", week: Number(m[1]), service: m[2] as "Sun" | "Sat", source: m[3] };
  m = /^W(\d+): (.+)$/.exec(entry);
  if (m) return { kind: "presence", week: Number(m[1]), source: m[2] };
  m = /^(.+?): (.+)$/.exec(entry);
  if (m) return { kind: "count", person: m[1], source: m[2] };
  return null;
}

const CAUSED = " — por lo que ya estaba puesto.";
const CEDED = " — lo cedió el solver para acomodar lo que ya estaba puesto.";
const CAVEAT = "Puede que el solver haya cedido más reglas de las necesarias: no alcanzó a comprobarlo.";
const generic = (entry: string) =>
  `El solver dejó de cumplir una regla para acomodar lo que ya estaba puesto (${entry}).`;

/** A count clause's tail; the person's name, when the clause carries one, sits before it. */
const COUNT_TAIL = /(?:^|\s)(\S+)\s*(==|>=|<=)\s*(\d+)\s*$/;
const PAIR = /^(.+?)\s+!with\s+(.+?)\s+on\s+(\S+)\s*$/;
const PRESENCE = /^any_of\((.+)\)\s+on\s+(\S+)\s+each_week\s*$/i;
const ROW_OF_FIELD: Record<string, string> = { Lead: "lead", BGV: "bgv", Choir: "coro" };

/** Whether `pattern` binds the role a pin holds — the rules card's own parser (`parsePattern`). */
function patternBindsRole(pattern: string, role: Pin["role"]): boolean {
  const parsed = parsePattern(pattern);
  if (!parsed) return false;
  const service = serviceOfRole(role);
  return parsed.rows.includes(ROW_OF_FIELD[role.slice(4)]) && (parsed.service === "*" || parsed.service === service);
}

export function pinViolationNotices(input: {
  violations: string[];
  /** `violation_ceiling_proven`; `false` adds one caveat line, and only when a rule was set aside. */
  ceilingProven: boolean | undefined;
  config: SolverConfig;
  members: RankMember[];
  pins: Pin[];
  /** The FULL month spine — week numbers are positional over it. */
  sundayDates: string[];
}): string[] {
  const { violations, ceilingProven, config, members, pins, sundayDates } = input;
  const res = (name: string) => resolvedNameOrRaw(name, members);
  const weeks = sundayDates.length;
  const dayOf = (week: number, service: "Sun" | "Sat") => {
    const iso = service === "Sun" ? sundayDates[week - 1] : saturdayForWeek(week, sundayDates);
    return iso ? serviceDayLabel(service === "Sun" ? "sunday_role" : "saturday_role", iso) : null;
  };
  const tail = (caused: boolean) => (caused ? CAUSED : CEDED);

  const lines = violations.map((entry) => {
    const v = parsePinViolation(entry);
    if (!v) return generic(entry);
    switch (v.kind) {
      case "count": {
        const t = COUNT_TAIL.exec(v.source);
        if (!t || /[!&]/.test(v.source)) return generic(entry);
        const [, pattern, op, n] = t;
        for (const r of config.restrictions) {
          if (res(r.person) !== v.person) continue;
          const cap = r.caps.find((c) => c.pattern === pattern && c.op === op && resolvedCapValue(c, weeks) === Number(n));
          if (!cap) continue;
          const caused = pins.some((p) => p.person === v.person && patternBindsRole(pattern, p.role));
          return `No se cumplió «${capLabel(cap)}» de ${r.person}${tail(caused)}`;
        }
        return generic(entry);
      }
      case "pair": {
        const p = PAIR.exec(v.source);
        const day = dayOf(v.week, v.service);
        if (!p || !day) return generic(entry);
        const [, a, b, pattern] = p;
        const rule = config.conflicts.find((c) =>
          c.pattern === pattern
          && ((res(c.personA) === a && res(c.personB) === b) || (res(c.personA) === b && res(c.personB) === a)));
        if (!rule) return generic(entry);
        const caused = pins.some((x) => x.week === v.week && serviceOfRole(x.role) === v.service && (x.person === a || x.person === b));
        return `No se cumplió «${rule.personA} ≠ ${rule.personB} en ${rule.pattern}» (${day})${tail(caused)}`;
      }
      case "presence": {
        const p = PRESENCE.exec(v.source);
        if (!p) return generic(entry);
        const names = p[1].split(",").map((s) => s.trim()).filter(Boolean);
        const pattern = p[2];
        const rule = config.presence.find((r) => {
          const mine = r.persons.map(res);
          return r.pattern === pattern && mine.length === names.length && mine.every((x) => names.includes(x));
        });
        if (!rule) return generic(entry);
        const caused = pins.some((x) => x.week === v.week && names.includes(x.person));
        return `No se cumplió «${rule.persons.join(", ")} en ${rule.pattern} c/sem» (semana ${v.week})${tail(caused)}`;
      }
      case "consecutive":
        // `SolverConfig` has no consecutive rule form: nothing to name it after.
        return generic(entry);
      case "mandatoryLead": {
        const day = dayOf(v.week, v.service);
        if (!day) return generic(entry);
        const lead = v.service === "Sun" ? "Sun.Lead" : "Sat.Lead";
        const caused = pins.some((x) => x.week === v.week && x.role === lead);
        return `El ${day} quedó sin líder${tail(caused)}`;
      }
      case "satAnchor": {
        const day = dayOf(v.week, "Sat");
        if (!day) return generic(entry);
        const caused = pins.some((x) => x.week === v.week && x.role === "Sat.Lead");
        return `El ${day} quedó sin líder de sábado${tail(caused)}`;
      }
    }
  });
  if (ceilingProven === false && violations.length > 0) lines.push(CAVEAT);
  return lines;
}
