// app/utils/sundayCadence.ts
//
// «Domingo: Mes por medio» — who it names, exactly (solver v3 C3 §6.5–§6.7,
// §7 items 4–5). Neutral on purpose (ADR-0028): no "use client", no
// `server-only`, no I/O, so C2's eligibility resolver, the rule panel and C6's
// planner — and, through C2, C4's script and C7's rehearsal — import the same
// code. The names below are a contract C2, C4, C6 and C7 restate; never rename
// one without them.
//
// ─── Exactly one ─────────────────────────────────────────────────────────────
//
// v2 resolves a rule name to its FIRST match (`resolveToMemberName`) and keeps
// doing so (parent A7, A35). Wherever v3 resolves a rule name it uses
// `resolveRulePersonId` instead: the same matching criterion
// (`rulePersonNamesMember` — case-insensitive, trimmed, `member_name` or
// `alias`) plus one condition, exactly one match. Zero is `unresolved`, two or
// more `ambiguous`; neither is ever guessed.
//
// ─── Over which roster ───────────────────────────────────────────────────────
//
// The UNFILTERED worship roster: no `voz`, pool or Tipo filter, because each
// can hide a true namesake and turn an ambiguous name into a resolved one. But
// every function here drops non-worship members ITSELF (`normalizeMinistries`,
// the one reader of the storage contract): the planner's `members` is
// worship-only for a worship admin and everyone, kids-only included, for a
// super-admin (C3 E25), and one config must resolve the same for both. Callers
// pass members with their stored `ministries` as read — a list stripped of the
// field would read as all-worship (absent = worship).

import { normalizeMinistries } from "@/app/ministries";
import { displayMemberName, rulePersonNamesMember } from "./memberRuleNames";
import { MEMBER_TYPE_LABEL } from "./memberTypes";
import { memberFitsPool, type SolverConfig } from "@/app/components/admin/plannerModel";

/** A roster member as read. `ministries` is the stored value; absent or empty means worship. */
export type RosterMember = {
  _id: string;
  member_name: string;
  alias?: string;
  memberType?: string[];
  ministries?: unknown;
};

/** Why a name does not name exactly one worship member. */
export type NameRefusal = { person: string; reason: "unresolved" | "ambiguous"; matches: string[] };

export type CadenceOutsideReason = "not_ticked" | "no_sunday_lead_tipo";

const worshipOnly = (roster: RosterMember[]) =>
  roster.filter((m) => normalizeMinistries(m.ministries).includes("worship"));

/**
 * The one member a rule name names, or why not. `matches` holds the matching
 * ids, unique and sorted (empty for `unresolved`).
 */
export function resolveRulePersonId(
  person: string,
  roster: RosterMember[],
):
  | { ok: true; id: string }
  | { ok: false; reason: "unresolved" | "ambiguous"; matches: string[] } {
  const matches = [
    ...new Set(
      worshipOnly(roster)
        // `member_name` is not required by the Studio schema: absent never matches.
        .filter((m) => rulePersonNamesMember(person, { member_name: m.member_name ?? "", alias: m.alias }))
        .map((m) => m._id),
    ),
  ].sort();
  if (matches.length === 1) return { ok: true, id: matches[0] };
  return { ok: false, reason: matches.length === 0 ? "unresolved" : "ambiguous", matches };
}

/**
 * The members every «Mes por medio» restriction names — the union, each id once,
 * sorted — and one refusal per distinct `person` text that does not name exactly
 * one worship member. The consumer decides what a refusal blocks (C2 refuses
 * the whole v3 build; C6 refuses Auto); a save never does (C3 §6.5).
 */
export function cadenceMembers(
  config: Pick<SolverConfig, "restrictions">,
  roster: RosterMember[],
): { ids: string[]; refusals: NameRefusal[] } {
  const ids = new Set<string>();
  const refusals: NameRefusal[] = [];
  for (const r of config.restrictions) {
    if (r.sundayCadence !== "alternate") continue;
    const resolved = resolveRulePersonId(r.person, roster);
    if (resolved.ok) ids.add(resolved.id);
    else if (!refusals.some((x) => x.person === r.person)) {
      refusals.push({ person: r.person, reason: resolved.reason, matches: resolved.matches });
    }
  }
  return { ids: [...ids].sort(), refusals };
}

/**
 * Resolved cadence members WITH a Tipo who are outside the effective Sunday pool
 * (C3 §6.7), in id order:
 * - `not_ticked` — fits «Líderes Domingo» by Tipo (`memberFitsPool`: `voz` AND
 *   `sunday_lead`) but is not ticked there;
 * - `no_sunday_lead_tipo` — has a Tipo that does not fit it, ticked or not: a
 *   stale tick does not put her in the effective pool.
 * A member with no Tipo is never listed: C2's resolver refuses the whole v3
 * build for her (`no_tipo`) and C6 names her before any solve. Refused names are
 * not listed either; they have their own surfaces.
 *
 * Rendered only under v3, behind the panel's explicit gate (C3 §7 item 6): under
 * v2 the cadence members sit in «Líderes Sábado» by design, and ticking them into
 * «Líderes Domingo» would change v2.
 */
export function cadenceOutsideSundayPool(
  config: Pick<SolverConfig, "restrictions" | "sundayLeads">,
  roster: RosterMember[],
): Array<{ id: string; name: string; reason: CadenceOutsideReason }> {
  const byId = new Map(worshipOnly(roster).map((m) => [m._id, m]));
  const out: Array<{ id: string; name: string; reason: CadenceOutsideReason }> = [];
  for (const id of cadenceMembers(config, roster).ids) {
    const m = byId.get(id);
    if (!m || (m.memberType ?? []).length === 0) continue;
    const name = displayMemberName(m);
    if (!memberFitsPool(m, "sundayLeads")) out.push({ id, name, reason: "no_sunday_lead_tipo" });
    else if (!config.sundayLeads.includes(id)) out.push({ id, name, reason: "not_ticked" });
  }
  return out;
}

// ─── Copy (C3 §6.6–§6.7, §7 item 5) ──────────────────────────────────────────
//
// Exported so C6 gates exactly these strings and every test asserts one wording.

/** Beside the «Mes por medio» chip. Rendered unconditionally by C3; C6 hides it under v3 (CTL-1). */
export const CADENCE_V2_NOTE = "aplica con el nuevo solver";

/** Beside «holgura N» — true under both engines (parent A10, Q2). */
export const SLACK_V3_NOTE = "no aplica con el nuevo solver";

/** The warning's heading. */
export const CADENCE_OUTSIDE_HEADING = "Mes por medio fuera de Líderes Domingo";

/** The warning's two sentences, by reason. Both describe parent A14's `out` state. */
export const CADENCE_OUTSIDE_SENTENCE: Readonly<Record<CadenceOutsideReason, (name: string) => string>> = {
  not_ticked: (name) =>
    `${name} no está en Líderes Domingo: descansa este mes, sin domingo y sin sábado de compensación.`,
  no_sunday_lead_tipo: (name) =>
    `${name} no tiene «${MEMBER_TYPE_LABEL.voz}» y «${MEMBER_TYPE_LABEL.sunday_lead}» a la vez en su Tipo: ` +
    "descansa este mes, sin domingo y sin sábado de compensación.",
};
