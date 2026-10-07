// app/utils/fairnessEligibility.ts
//
// THE v3 eligibility resolver (solver v3 C2 RES-1 … RES-8, spec IF2-15; parent A7): the
// single definition of "what eligibility a month was solved with". It turns the
// ON-SCREEN planner state — the rule set (unsaved edits included) and the planner's
// member list — into one month's record body. «Registrar» calls it; C6 builds both its
// solve request's per-role eligibility and its confirm body from one call of it; C4 and
// C7 run it over the worship roster read and the stored rule set.
//
// NEUTRAL AND CLIENT-CALLABLE (ADR-0028): no "use client", no `server-only`, no I/O and
// no `node:crypto` — so it is NOT in the write-request module, which hashes. Because a
// client cannot run the record validator, the resolver guarantees its output instead
// (RES-8, parent A38): an `ok: true` body, completed with `source` and `expectedRev`,
// always passes `validateFairnessMonthWrite`; every input that would not answers
// `ok: false`, naming each refused person and each issue. Nothing is dropped or
// repaired silently.
//
// Names resolve to EXACTLY ONE worship member through C3's `resolveRulePersonId` and
// `cadenceMembers` (never v2's first match), over the roster after this module drops
// every non-worship member itself (RES-5) — so one config gives one body whoever is
// viewing. Members are handed on with `ministries` as read.

import { normalizeMinistries } from "@/app/ministries";
import {
  memberFitsPool,
  memberFitsRoleKey,
  rolesOfPatternV3,
  saturdayForWeek,
  type SolverConfig,
} from "@/app/components/admin/plannerModel";
import { capValueForMonth, completeSundaySpine, ruleContextForTarget } from "@/app/components/admin/serviceRuleContext";
import {
  PRESENCE_RULE_KEY_RE,
  RECORD_LIMITS,
  ROLE_KEYS,
  SATURDAY_KEYS,
  SUNDAY_KEYS,
  canonicalRoles,
  compareCodepoint,
  type FairnessMonthBody,
  type RoleKey,
  type Status,
} from "./fairnessVocabulary";
import { isValidServiceDate } from "./serviceReadModel";
import { cadenceMembers, resolveRulePersonId, type RosterMember } from "./sundayCadence";

export type EligibilityIssueCode =
  | "no_people"
  | "too_many_people"
  | "too_many_presence"
  | "presence_rule_id"
  | "presence_roles"
  | "presence_members";

export type EligibilityRefusalReason =
  | "unresolved"
  | "ambiguous"
  | "no_tipo"
  | "cadence_and_exact"
  | "overlapping_exact"
  | "exact_count_range"
  | "presence_member_not_listed";

export type EligibilityMember = {
  _id: string;
  member_name: string;
  alias?: string;
  memberType?: string[];
  ministries?: unknown;
  unavailableDates?: string[];
};

export type EligibilityResult =
  | { ok: true; body: FairnessMonthBody }
  | {
      ok: false;
      issues: Array<{ code: EligibilityIssueCode; ruleKey?: string }>;
      refusals: Array<{ person: string; reason: EligibilityRefusalReason }>;
    };

interface Item {
  roles: Record<RoleKey, Status>;
  exactRules: Array<{ roles: RoleKey[]; count: number }>;
  cadence: boolean;
  exempt: boolean;
  blocks: Map<string, { unavailable: boolean; excluded: Set<RoleKey> }>;
}

/** The weekend dates of week `week` of `month` by the planner's own numbering (RES-4). */
function weekendDatesOfWeek(month: string, week: number): Array<{ date: string; keys: readonly RoleKey[] }> {
  const spine = completeSundaySpine(month);
  const candidates: Array<{ date: string; type: "sunday_role" | "saturday_role"; keys: readonly RoleKey[] }> = [];
  if (week >= 1 && week <= spine.length) candidates.push({ date: spine[week - 1], type: "sunday_role", keys: SUNDAY_KEYS });
  const saturday = saturdayForWeek(week, spine);
  if (saturday) candidates.push({ date: saturday, type: "saturday_role", keys: SATURDAY_KEYS });
  return candidates.filter((c) => {
    if (c.date.slice(0, 7) !== month) return false;
    const context = ruleContextForTarget(c.type, c.date);
    return context !== null && context.month === month && context.week === week;
  });
}

export function resolveMonthEligibility(input: {
  month: string;
  config: SolverConfig;
  members: EligibilityMember[];
}): EligibilityResult {
  const { month, config } = input;
  // RES-5 — the worship filter first; members keep every field, `ministries` included.
  const roster = input.members.filter((m) => normalizeMinistries(m.ministries).includes("worship"));
  const byId = new Map(roster.map((m) => [m._id, m]));

  const refusals: Array<{ person: string; reason: EligibilityRefusalReason }> = [];
  const issues: Array<{ code: EligibilityIssueCode; ruleKey?: string }> = [];
  const refuse = (person: string, reason: EligibilityRefusalReason) => {
    if (!refusals.some((r) => r.person === person && r.reason === reason)) refusals.push({ person, reason });
  };
  // RES-7 — exactly one worship member, with a Tipo, or a named refusal.
  const resolve = (person: string): string | null => {
    const found = resolveRulePersonId(person, roster as RosterMember[]);
    if (!found.ok) {
      refuse(person, found.reason);
      return null;
    }
    if ((byId.get(found.id)?.memberType ?? []).length === 0) {
      refuse(person, "no_tipo");
      return null;
    }
    return found.id;
  };

  // People: every worship member whose Tipo includes `voz` (RES-5), all roles out at first.
  const items = new Map<string, Item>();
  for (const m of [...roster].sort((a, b) => compareCodepoint(a._id, b._id))) {
    if (!(m.memberType ?? []).includes("voz")) continue;
    const roles = Object.fromEntries(ROLE_KEYS.map((k) => [k, "out"])) as Record<RoleKey, Status>;
    // RES-1 — pools → roles: the EFFECTIVE pool (ticked and fitting by current Tipo), each
    // role only when the Tipo fits it. A stale tick puts nobody anywhere.
    const sunday = config.sundayLeads.includes(m._id) && memberFitsPool(m, "sundayLeads");
    const saturday = config.saturdayLeads.includes(m._id) && memberFitsPool(m, "saturdayLeads");
    const support = config.support.includes(m._id) && memberFitsPool(m, "support");
    for (const k of ROLE_KEYS) {
      const pooled = k === "Sun.Lead" ? sunday : k === "Sat.Lead" ? sunday || saturday : sunday || saturday || support;
      if (pooled && memberFitsRoleKey(m, k)) roles[k] = "in";
    }
    items.set(m._id, { roles, exactRules: [], cadence: false, exempt: false, blocks: new Map() });
  }
  const block = (item: Item, date: string) => {
    const found = item.blocks.get(date) ?? { unavailable: false, excluded: new Set<RoleKey>() };
    item.blocks.set(date, found);
    return found;
  };

  // Cadence (RES-7): the setting on each listed id `cadenceMembers` returns.
  const cadence = cadenceMembers(config, roster as RosterMember[]);
  for (const r of cadence.refusals) refuse(r.person, r.reason);

  // Restrictions: exclusions, «Exenta», week exclusions; `==` caps collected per member.
  const caps = new Map<string, Array<{ person: string; roles: RoleKey[]; count: number | null }>>();
  for (const r of config.restrictions) {
    const id = resolve(r.person);
    if (id === null) continue;
    for (const cap of r.caps) {
      if (cap.op !== "==") continue;
      const value = capValueForMonth(cap, month);
      const inRange = value.ok && value.count <= RECORD_LIMITS.exactCountMax;
      if (!inRange) refuse(r.person, "exact_count_range"); // RES-3: judged on the cap itself
      caps.set(id, [...(caps.get(id) ?? []), { person: r.person, roles: rolesOfPatternV3(cap.pattern), count: inRange && value.ok ? value.count : null }]);
    }
    const item = items.get(id);
    if (!item) continue; // no `voz`: nothing to record for her
    for (const pattern of r.excludedPatterns) for (const k of rolesOfPatternV3(pattern)) item.roles[k] = "out";
    if (r.fairness === "exempt") item.exempt = true;
    for (const ex of r.weekExclusions) {
      const roles = rolesOfPatternV3(ex.pattern);
      for (const { date, keys } of weekendDatesOfWeek(month, ex.week)) {
        const excluded = keys.filter((k) => roles.includes(k));
        if (excluded.length) for (const k of excluded) block(item, date).excluded.add(k);
      }
    }
  }
  for (const id of cadence.ids) {
    const item = items.get(id);
    if (item) item.cadence = true;
  }

  // RES-3 — the exact rules: overlaps and «Mes por medio» judged on the expansions.
  for (const [id, list] of caps) {
    const seen = new Set<RoleKey>();
    let overlapping = false;
    for (const cap of list) {
      if (cap.roles.some((k) => seen.has(k))) overlapping = true;
      for (const k of cap.roles) seen.add(k);
    }
    if (overlapping) refuse(list[0].person, "overlapping_exact");
    if (cadence.ids.includes(id)) {
      const covering = list.find((cap) => cap.roles.includes("Sun.Lead"));
      if (covering) refuse(covering.person, "cadence_and_exact");
    }
    const item = items.get(id);
    if (!item || overlapping) continue;
    for (const cap of list) {
      if (cap.count === null) continue;
      const covered = canonicalRoles(cap.roles.filter((k) => item.roles[k] === "in"));
      if (covered.length === 0) continue;
      if (cap.count === 0) for (const k of covered) item.roles[k] = "out";
      else {
        for (const k of covered) item.roles[k] = "exact";
        item.exactRules.push({ roles: covered, count: cap.count });
      }
    }
  }

  // Unavailable dates inside the month (RES-4).
  for (const [id, item] of items) {
    for (const raw of byId.get(id)?.unavailableDates ?? []) {
      const date = typeof raw === "string" ? raw.slice(0, 10) : "";
      if (isValidServiceDate(date) && date.slice(0, 7) === month) block(item, date).unavailable = true;
    }
  }

  // RES-6 — presence.
  if (config.presence.length > RECORD_LIMITS.presenceRules) issues.push({ code: "too_many_presence" });
  const idCount = new Map<string, number>();
  for (const rule of config.presence) idCount.set(rule.id, (idCount.get(rule.id) ?? 0) + 1);
  const conflicts = config.conflicts.map((c) => ({ a: resolve(c.personA), b: resolve(c.personB), roles: rolesOfPatternV3(c.pattern) }));
  const presence: FairnessMonthBody["presence"] = [];
  for (const rule of config.presence) {
    const badId = !PRESENCE_RULE_KEY_RE.test(rule.id) || (idCount.get(rule.id) ?? 0) > 1;
    if (badId && !issues.some((i) => i.code === "presence_rule_id" && i.ruleKey === rule.id)) {
      issues.push({ code: "presence_rule_id", ruleKey: rule.id });
    }
    const members: string[] = [];
    for (const person of rule.persons) {
      const id = resolve(person);
      if (id === null) continue;
      if (!items.has(id)) refuse(person, "presence_member_not_listed");
      else if (!members.includes(id)) members.push(id);
    }
    const roles = rolesOfPatternV3(rule.pattern);
    if (roles.length === 0) issues.push({ code: "presence_roles", ruleKey: rule.id });
    if (members.length < RECORD_LIMITS.presenceMembersMin || members.length > RECORD_LIMITS.presenceMembersMax) {
      issues.push({ code: "presence_members", ruleKey: rule.id });
    }
    members.sort(compareCodepoint);
    const exclusive = members.every((a, i) =>
      members.slice(i + 1).every((b) =>
        conflicts.some((c) => ((c.a === a && c.b === b) || (c.a === b && c.b === a)) && roles.every((k) => c.roles.includes(k))),
      ),
    );
    presence.push({ ruleKey: rule.id, roles, members, exclusive });
  }

  if (items.size === 0) issues.push({ code: "no_people" });
  if (items.size > RECORD_LIMITS.people) issues.push({ code: "too_many_people" });
  if (refusals.length > 0 || issues.length > 0) return { ok: false, issues, refusals };

  return {
    ok: true,
    body: {
      month,
      people: [...items].map(([memberId, item]) => ({
        memberId,
        roles: item.roles,
        exactRules: [...item.exactRules].sort((a, b) => compareCodepoint(a.roles.join(","), b.roles.join(","))),
        ...(item.cadence ? { sundayCadence: "alternate" as const } : {}),
        exempt: item.exempt,
        blocks: [...item.blocks]
          .filter(([, b]) => b.unavailable || b.excluded.size > 0)
          .sort(([a], [b]) => compareCodepoint(a, b))
          .map(([date, b]) => ({ date, unavailable: b.unavailable, excludedRoles: canonicalRoles(b.excluded) })),
      })),
      presence: presence.sort((a, b) => compareCodepoint(a.ruleKey, b.ruleKey)),
    },
  };
}
