/**
 * Soft retirement by ministry — roster axis (P1).
 *
 * Absent `retiredFrom` ⇒ serves in every ministry they belong to. Selection
 * filters at the point of use; resolution (`_id in $ids`, id→name) never does.
 */
import type { MinistryId } from "@/app/ministries";
import { isMinistryId, normalizeMinistries } from "@/app/ministries";
import type {
  ConflictRule,
  PersonRestriction,
  PresenceRule,
  SolverConfig,
} from "@/app/components/admin/plannerModel";

/** GROQ arm: member is NOT retired from worship. Composed only on audiences that filter. */
export const WORSHIP_NOT_RETIRED_GROQ_FILTER =
  '(!defined(retiredFrom) || !("worship" in retiredFrom))';

export interface RetirableMember {
  _id: string;
  member_name?: string;
  alias?: string;
  retiredFrom?: MinistryId[] | null;
}

export function isRetiredFrom(ministry: MinistryId, retiredFrom: unknown): boolean {
  if (!Array.isArray(retiredFrom) || retiredFrom.length === 0) return false;
  return retiredFrom.filter(isMinistryId).includes(ministry);
}

/**
 * Members eligible for NEW selection in a ministry. Resolution paths pass the
 * full list through unchanged.
 */
export function filterMembersForSelection<T extends { _id: string; retiredFrom?: unknown }>(
  members: T[],
  ministry: MinistryId,
  opts?: { keepIds?: Iterable<string> },
): T[] {
  const keep = opts?.keepIds ? new Set(opts.keepIds) : null;
  return members.filter(
    (m) => !isRetiredFrom(ministry, m.retiredFrom) || (keep?.has(m._id) ?? false),
  );
}

/** Rejects retiring from a ministry the stored doc does not belong to (R11). */
export function validateRetirement(
  stored: { ministries?: unknown },
  ministry: MinistryId,
): string | null {
  if (!normalizeMinistries(stored.ministries).includes(ministry)) {
    return ministry === "kids"
      ? "Este miembro no pertenece a Oasis Kids."
      : "Este miembro no pertenece a Alabanza.";
  }
  return null;
}

export function displayMemberName(m: { member_name?: string; alias?: string }): string {
  return m.alias?.trim() || m.member_name || "";
}

/**
 * Persona dropdown options: selectable members plus any names that must stay
 * visible while editing an existing rule (controlled `<select>` contract).
 */
export function personNameOptions(
  members: Array<{ _id: string; member_name: string; alias?: string; retiredFrom?: unknown }>,
  ministry: MinistryId,
  preserveNames: string[] = [],
): string[] {
  const out = new Set(filterMembersForSelection(members, ministry).map(displayMemberName));
  for (const n of preserveNames) {
    const t = n.trim();
    if (t) out.add(t);
  }
  return [...out];
}

/** Same name-matching criterion as `resolveToMemberName` / planner `dn()`. */
export function rulePersonNamesMember(
  rulePerson: string,
  member: { member_name: string; alias?: string },
): boolean {
  const lo = rulePerson.toLowerCase().trim();
  if (!lo) return false;
  if (member.member_name.toLowerCase().trim() === lo) return true;
  return member.alias?.trim().toLowerCase() === lo;
}

function restrictionNamesMember(r: PersonRestriction, member: { member_name: string; alias?: string }): boolean {
  return rulePersonNamesMember(r.person, member);
}

function conflictNamesMember(c: ConflictRule, member: { member_name: string; alias?: string }): boolean {
  return rulePersonNamesMember(c.personA, member) || rulePersonNamesMember(c.personB, member);
}

function presenceNamesMember(p: PresenceRule, member: { member_name: string; alias?: string }): boolean {
  return p.persons.some((name) => rulePersonNamesMember(name, member));
}

/** True when a live `solverConfig` rule names this member (R10 deferral). */
export function hasLiveRuleNamingMember(
  config: SolverConfig,
  member: { member_name: string; alias?: string },
): boolean {
  return (
    config.restrictions.some((r) => restrictionNamesMember(r, member))
    || config.conflicts.some((c) => conflictNamesMember(c, member))
    || config.presence.some((p) => presenceNamesMember(p, member))
  );
}

/**
 * Worship-retired member ids excluded from the solve request (R10 plena).
 * Defers while a live rule still names the retiree.
 */
export function worshipRetireeIdsExcludedFromSolve(
  members: Array<{ _id: string; member_name: string; alias?: string; retiredFrom?: unknown }>,
  config: SolverConfig,
): Set<string> {
  const out = new Set<string>();
  for (const m of members) {
    if (isRetiredFrom("worship", m.retiredFrom) && !hasLiveRuleNamingMember(config, m)) {
      out.add(m._id);
    }
  }
  return out;
}

export interface RetirementRuleChange {
  kind: "delete" | "edit_presence";
  ruleType: "restriction" | "conflict" | "presence";
  ruleId: string;
  /** Spanish summary for confirmation UI. */
  summary: string;
  /** Other people named by the rule (display names as stored). */
  affectedOthers: string[];
  /** Present when `kind === "edit_presence"`: survivors after removing retiree. */
  editedPersons?: string[];
}

export interface WorshipRetirementRulePlan {
  /** Rules naming only the retiree — applied without confirmation (R15). */
  auto: RetirementRuleChange[];
  /** Rules naming someone else — require explicit confirmation (R15). */
  confirm: RetirementRuleChange[];
}

function otherPersonsInPresence(p: PresenceRule, member: { member_name: string; alias?: string }): string[] {
  return p.persons.filter((name) => !rulePersonNamesMember(name, member));
}

function otherPersonInConflict(c: ConflictRule, member: { member_name: string; alias?: string }): string {
  return rulePersonNamesMember(c.personA, member) ? c.personB : c.personA;
}

/** Plan R15 rule resolution when retiring from worship. */
export function planWorshipRetirementRules(
  config: SolverConfig,
  member: { member_name: string; alias?: string },
): WorshipRetirementRulePlan {
  const auto: RetirementRuleChange[] = [];
  const confirm: RetirementRuleChange[] = [];
  const display = displayMemberName(member);

  for (const r of config.restrictions) {
    if (!restrictionNamesMember(r, member)) continue;
    auto.push({
      kind: "delete",
      ruleType: "restriction",
      ruleId: r.id,
      summary: `Eliminar restricción de ${display}.`,
      affectedOthers: [],
    });
  }

  for (const c of config.conflicts) {
    if (!conflictNamesMember(c, member)) continue;
    const other = otherPersonInConflict(c, member);
    confirm.push({
      kind: "delete",
      ruleType: "conflict",
      ruleId: c.id,
      summary: `Eliminar conflicto entre ${display} y ${other} (${c.pattern}).`,
      affectedOthers: [other],
    });
  }

  for (const p of config.presence) {
    if (!presenceNamesMember(p, member)) continue;
    const others = otherPersonsInPresence(p, member);
    if (others.length === 0) {
      auto.push({
        kind: "delete",
        ruleType: "presence",
        ruleId: p.id,
        summary: `Eliminar presencia de ${display}.`,
        affectedOthers: [],
      });
    } else if (others.length === 1) {
      confirm.push({
        kind: "delete",
        ruleType: "presence",
        ruleId: p.id,
        summary: `Eliminar presencia conjunta de ${display} y ${others[0]} (${p.pattern}).`,
        affectedOthers: others,
      });
    } else {
      const remaining = others.join(", ");
      const editedPersons = otherPersonsInPresence(p, member);
      confirm.push({
        kind: "edit_presence",
        ruleType: "presence",
        ruleId: p.id,
        summary: `Quitar a ${display} de presencia con ${remaining} (${p.pattern}); la regla sigue para los demás.`,
        affectedOthers: others,
        editedPersons,
      });
    }
  }

  return { auto, confirm };
}

/** Apply R15 rule changes to an in-memory `SolverConfig`. */
export function applyRetirementRuleChanges(
  config: SolverConfig,
  changes: RetirementRuleChange[],
): SolverConfig {
  if (changes.length === 0) return config;
  const deleteIds = new Set(
    changes.filter((c) => c.kind === "delete").map((c) => c.ruleId),
  );
  const edits = new Map(
    changes
      .filter((c): c is RetirementRuleChange & { editedPersons: string[] } =>
        c.kind === "edit_presence" && Array.isArray(c.editedPersons))
      .map((c) => [c.ruleId, c.editedPersons!]),
  );

  return {
    ...config,
    restrictions: config.restrictions.filter((r) => !deleteIds.has(r.id)),
    conflicts: config.conflicts.filter((c) => !deleteIds.has(c.id)),
    presence: config.presence
      .filter((p) => !deleteIds.has(p.id))
      .map((p) => {
        const edited = edits.get(p.id);
        return edited ? { ...p, persons: edited } : p;
      }),
  };
}

/** Retired-from-worship members still listed in solver pools (R16). */
export function retiredInSolverPools(
  config: SolverConfig,
  members: Array<{ _id: string; member_name: string; alias?: string; retiredFrom?: unknown }>,
): Array<{ _id: string; member_name: string; alias?: string; retiredFrom?: unknown }> {
  const poolIds = new Set([
    ...config.sundayLeads,
    ...config.saturdayLeads,
    ...config.support,
  ]);
  return members.filter(
    (m) => poolIds.has(m._id) && isRetiredFrom("worship", m.retiredFrom),
  );
}

export const RETIREMENT_UI_COPY = {
  worshipRetire:
    "Retirar de Alabanza lo saca de las listas de selección. Sigue en servicios ya asignados; el solver deja de rotarlo cuando no queden reglas que lo nombren (puede seguir en los pools almacenados).",
  kidsRetire:
    "Registrar retiro de Oasis Kids es solo un hecho administrativo: la rotación de parejas no cambia hasta que se desactive la pareja.",
  poolWarning:
    "Miembros retirados que siguen en los pools almacenados (excluidos del solve salvo reglas vivas que los nombren):",
  futureOccupant:
    "Retirado de Alabanza — sigue en este servicio futuro hasta que lo cambies.",
  ruleConfirmTitle: "Reglas del solver afectadas",
  ruleConfirmBody:
    "Estas reglas nombran a otra persona además del retirado. Confirma para aplicar los cambios; no se pueden deshacer.",
} as const;

export function mexicoCityTodayIso(): string {
  return new Date().toLocaleDateString("sv", { timeZone: "America/Mexico_City" });
}

/** True when a service date is today or later in America/Mexico_City (R6). */
export function isFutureOrTodayServiceDate(isoDate: string, today = mexicoCityTodayIso()): boolean {
  return isoDate.slice(0, 10) >= today;
}

export function memberIdsRetiredOnFutureService(
  memberIds: string[],
  serviceDate: string,
  members: Array<{ _id: string; retiredFrom?: unknown }>,
  today = mexicoCityTodayIso(),
): string[] {
  if (!isFutureOrTodayServiceDate(serviceDate, today)) return [];
  const byId = new Map(members.map((m) => [m._id, m]));
  return memberIds.filter((id) => {
    const m = byId.get(id);
    return m && isRetiredFrom("worship", m.retiredFrom);
  });
}

/** Next `retiredFrom` after toggling one ministry. */
export function nextRetiredFrom(
  current: unknown,
  ministry: MinistryId,
  retire: boolean,
): MinistryId[] | undefined {
  const existing = Array.isArray(current) ? current.filter(isMinistryId) : [];
  if (retire) {
    if (existing.includes(ministry)) return existing.length ? existing : undefined;
    const next = [...existing, ministry];
    return next;
  }
  const next = existing.filter((m) => m !== ministry);
  return next.length ? next : undefined;
}
