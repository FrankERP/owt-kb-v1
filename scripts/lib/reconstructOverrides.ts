// scripts/lib/reconstructOverrides.ts
//
// R8 — Frank's corrections file, parsed and validated IN FULL before any record is
// built (solver v3 C4). Keyed by member `_id` (D8), with a schema version; a typo
// refuses the whole run (exit 2). Entries are numbered by their position in
// `members` («entrada 2 del archivo») — the only way stdout may point at one (R12).
// A free-text note is printed in the private table and never written to Sanity.
//
// Shape (version 1):
//   { "schemaVersion": 1,
//     "members": {
//       "<member _id>": {
//         "note": "…",                                  optional, private
//         "exempt": true | false,                       optional, every month of the run
//         "sundayCadence": "alternate" | "normal",      optional, every month of the run
//         "joinMonths": { "BGV": "2026-09" },           optional; replaces the seat-derived month of that line
//         "blockedDates": [{ "date": "2026-09-06" }, { "date": "2026-09-13", "roles": ["Sun.BGV"] }],
//                                                       no roles = unavailable that day; roles = excluded from them
//         "months": { "*" | "YYYY-MM": { "roles": { "Sun.BGV": "in" },
//                                         "exactRules": [{ "roles": ["Sun.BGV"], "count": 2 }] } } } } }
// An entry uses "*" (every month of the run) or named months, never both. Whether a
// correction leaves half of one of TODAY's exact rules (the replacement rule, A38)
// depends on the resolver's body, so `transformMonth` checks it — still before any
// table or plan is written.

import { createHash } from "node:crypto";

import { canonicalRoles, isMonthString, isRoleKey, type RoleKey } from "../../app/utils/fairnessVocabulary";
import { isValidServiceDate } from "../../app/utils/serviceReadModel";
import { LINES, type Line, type RunRefusal } from "./reconstructTypes";

export const OVERRIDES_SCHEMA_VERSION = 1;
/** The month key that means «every month of the run». */
export const ALL_MONTHS = "*";

export interface MonthOverride {
  roles: Partial<Record<RoleKey, "in" | "out">>;
  exactRules: Array<{ roles: RoleKey[]; count: number }>;
}

export interface MemberOverride {
  /** 1-based position in the file's `members` object. */
  ordinal: number;
  memberId: string;
  note: string | null;
  exempt: boolean | null;
  sundayCadence: "alternate" | "normal" | null;
  joinMonths: Partial<Record<Line, string>>;
  blockedDates: Array<{ date: string; roles: RoleKey[] | null }>;
  /** `"*"` or `YYYY-MM` → that month's statuses and exact rules. */
  months: Record<string, MonthOverride>;
}

export interface Overrides {
  /** SHA-256 of the file's bytes — bound into the plan (R15). */
  hash: string;
  members: MemberOverride[];
}

const MEMBER_KEYS = new Set(["note", "exempt", "sundayCadence", "joinMonths", "blockedDates", "months"]);
const MONTH_KEYS = new Set(["roles", "exactRules"]);
const FIX = "Corrige el archivo de correcciones y vuelve a correr el dry run.";

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const distinctRoles = (v: unknown, max: number): v is RoleKey[] =>
  Array.isArray(v) && v.length >= 1 && v.length <= max && v.every((k) => isRoleKey(k)) && new Set(v).size === v.length;

export function overridesHash(text: string): string {
  return `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`;
}

export function parseOverrides(
  text: string,
  rosterIds: ReadonlySet<string>,
): { ok: true; overrides: Overrides } | { ok: false; refusals: RunRefusal[] } {
  const refusals: RunRefusal[] = [];
  const refuse = (ordinal: number | null, reason: string, detail: string, memberId?: string) => {
    refusals.push({
      reason,
      kind: "corrección",
      rules: ordinal === null ? [] : [{ ordinal: `entrada ${ordinal} del archivo`, key: null }],
      ...(memberId !== undefined ? { memberIds: [memberId] } : {}),
      detail,
      fix: FIX,
    });
  };

  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    refuse(null, "override_json", "El archivo de correcciones no es JSON válido.");
    return { ok: false, refusals };
  }
  if (!isObj(doc)) {
    refuse(null, "override_schema", "El archivo debe ser un objeto con «schemaVersion» y «members».");
    return { ok: false, refusals };
  }
  for (const key of Object.keys(doc)) {
    if (key !== "schemaVersion" && key !== "members") refuse(null, "override_schema", `Clave desconocida en la raíz: «${key}».`);
  }
  if (doc.schemaVersion !== OVERRIDES_SCHEMA_VERSION) {
    refuse(null, "override_version", `«schemaVersion» debe ser ${OVERRIDES_SCHEMA_VERSION}.`);
  }
  if (!isObj(doc.members)) {
    refuse(null, "override_schema", "«members» debe ser un objeto cuyas claves son el _id de cada miembro.");
    return { ok: false, refusals };
  }

  const members: MemberOverride[] = [];
  Object.entries(doc.members).forEach(([memberId, raw], index) => {
    const ordinal = index + 1;
    const bad = (reason: string, detail: string) => refuse(ordinal, reason, detail, memberId);
    if (!rosterIds.has(memberId)) bad("override_member_unknown", "Ese _id no está en el equipo de alabanza que se leyó (IF2-27).");
    if (!isObj(raw)) {
      bad("override_schema", "La entrada debe ser un objeto.");
      return;
    }
    for (const key of Object.keys(raw)) if (!MEMBER_KEYS.has(key)) bad("override_schema", `Clave desconocida: «${key}».`);
    const entry: MemberOverride = {
      ordinal,
      memberId,
      note: null,
      exempt: null,
      sundayCadence: null,
      joinMonths: {},
      blockedDates: [],
      months: {},
    };
    if (raw.note !== undefined) {
      if (typeof raw.note === "string") entry.note = raw.note;
      else bad("override_schema", "«note» debe ser texto.");
    }
    if (raw.exempt !== undefined) {
      if (typeof raw.exempt === "boolean") entry.exempt = raw.exempt;
      else bad("override_schema", "«exempt» debe ser true o false.");
    }
    if (raw.sundayCadence !== undefined) {
      if (raw.sundayCadence === "alternate" || raw.sundayCadence === "normal") entry.sundayCadence = raw.sundayCadence;
      else bad("override_schema", "«sundayCadence» debe ser \"alternate\" o \"normal\".");
    }
    if (raw.joinMonths !== undefined) {
      if (!isObj(raw.joinMonths)) bad("override_schema", "«joinMonths» debe ser un objeto por línea.");
      else {
        for (const [line, month] of Object.entries(raw.joinMonths)) {
          if (!(LINES as readonly string[]).includes(line)) bad("override_schema", `Línea desconocida en «joinMonths»: «${line}».`);
          else if (!isMonthString(month)) bad("override_month", `«joinMonths.${line}» debe ser YYYY-MM.`);
          else entry.joinMonths[line as Line] = month;
        }
      }
    }
    if (raw.blockedDates !== undefined) {
      if (!Array.isArray(raw.blockedDates)) bad("override_schema", "«blockedDates» debe ser una lista.");
      else {
        raw.blockedDates.forEach((item, i) => {
          if (!isObj(item)) {
            bad("override_schema", `«blockedDates[${i}]» debe ser un objeto.`);
            return;
          }
          for (const key of Object.keys(item)) {
            if (key !== "date" && key !== "roles") bad("override_schema", `Clave desconocida en «blockedDates[${i}]»: «${key}».`);
          }
          if (!isValidServiceDate(item.date)) {
            bad("override_date", `«blockedDates[${i}].date» debe ser una fecha YYYY-MM-DD real.`);
            return;
          }
          if (item.roles !== undefined && !distinctRoles(item.roles, 6)) {
            bad("override_role", `«blockedDates[${i}].roles» debe listar roles distintos (Sun.Lead … Sat.Choir).`);
            return;
          }
          entry.blockedDates.push({ date: item.date, roles: item.roles === undefined ? null : canonicalRoles(item.roles as RoleKey[]) });
        });
      }
    }
    if (raw.months !== undefined) {
      if (!isObj(raw.months)) bad("override_schema", "«months» debe ser un objeto por mes.");
      else {
        const keys = Object.keys(raw.months);
        if (keys.includes(ALL_MONTHS) && keys.length > 1) {
          bad("override_scope", "Una entrada usa \"*\" (todos los meses de la corrida) o meses con nombre, nunca los dos.");
        }
        for (const [key, value] of Object.entries(raw.months)) {
          if (key !== ALL_MONTHS && !isMonthString(key)) {
            bad("override_month", `Mes inválido en «months»: «${key}».`);
            continue;
          }
          const parsed = parseMonthOverride(value, key, bad);
          if (parsed) entry.months[key] = parsed;
        }
      }
    }
    members.push(entry);
  });

  if (refusals.length > 0) return { ok: false, refusals };
  return { ok: true, overrides: { hash: overridesHash(text), members } };
}

function parseMonthOverride(
  value: unknown,
  key: string,
  bad: (reason: string, detail: string) => void,
): MonthOverride | null {
  const where = `months.${key}`;
  if (!isObj(value)) {
    bad("override_schema", `«${where}» debe ser un objeto.`);
    return null;
  }
  for (const k of Object.keys(value)) if (!MONTH_KEYS.has(k)) bad("override_schema", `Clave desconocida en «${where}»: «${k}».`);
  const out: MonthOverride = { roles: {}, exactRules: [] };
  let ok = true;
  if (value.roles !== undefined) {
    if (!isObj(value.roles)) {
      bad("override_schema", `«${where}.roles» debe ser un objeto.`);
      ok = false;
    } else {
      for (const [role, status] of Object.entries(value.roles)) {
        if (!isRoleKey(role)) {
          bad("override_role", `Rol desconocido en «${where}.roles»: «${role}».`);
          ok = false;
        } else if (status !== "in" && status !== "out") {
          bad("override_status", `«${where}.roles.${role}» debe ser "in" o "out" (una cuenta fija va en «exactRules»).`);
          ok = false;
        } else out.roles[role] = status;
      }
    }
  }
  if (value.exactRules !== undefined) {
    if (!Array.isArray(value.exactRules)) {
      bad("override_schema", `«${where}.exactRules» debe ser una lista.`);
      ok = false;
    } else {
      value.exactRules.forEach((rule, i) => {
        const at = `${where}.exactRules[${i}]`;
        if (!isObj(rule)) {
          bad("override_schema", `«${at}» debe ser un objeto.`);
          ok = false;
          return;
        }
        for (const k of Object.keys(rule)) if (k !== "roles" && k !== "count") bad("override_schema", `Clave desconocida en «${at}»: «${k}».`);
        if (!distinctRoles(rule.roles, 6)) {
          bad("override_role", `«${at}.roles» debe listar de 1 a 6 roles distintos.`);
          ok = false;
          return;
        }
        if (!(typeof rule.count === "number" && Number.isInteger(rule.count) && rule.count >= 1 && rule.count <= 31)) {
          bad("override_count", `«${at}.count» debe ser un entero de 1 a 31.`);
          ok = false;
          return;
        }
        out.exactRules.push({ roles: canonicalRoles(rule.roles as RoleKey[]), count: rule.count });
      });
    }
  }
  // Inside the file, exactly what IF2-18 would refuse: two exact counts for one role
  // key (A38), or a role given both a status and an exact rule.
  const covered = new Map<RoleKey, number>();
  for (const rule of out.exactRules) for (const k of rule.roles) covered.set(k, (covered.get(k) ?? 0) + 1);
  for (const [k, n] of covered) {
    if (n > 1) {
      bad("override_overlap", `«${where}»: dos reglas fijas cubren ${k} (A38: una sola cuenta fija por rol).`);
      ok = false;
    }
    if (out.roles[k] !== undefined) {
      bad("override_contradiction", `«${where}»: ${k} tiene un estado y una regla fija a la vez.`);
      ok = false;
    }
  }
  return ok ? out : null;
}

/** «no aplica a esta corrida» (R8): valid months outside `--months`, listed in the private table only. */
export function outOfRunEntries(
  overrides: Overrides,
  months: readonly string[],
): Array<{ ordinal: number; memberId: string; month: string }> {
  const inRun = new Set(months);
  const out: Array<{ ordinal: number; memberId: string; month: string }> = [];
  for (const o of overrides.members) {
    const named = new Set<string>([
      ...Object.keys(o.months).filter((k) => k !== ALL_MONTHS),
      ...o.blockedDates.map((d) => d.date.slice(0, 7)),
    ]);
    for (const month of [...named].sort()) if (!inRun.has(month)) out.push({ ordinal: o.ordinal, memberId: o.memberId, month });
  }
  return out;
}
