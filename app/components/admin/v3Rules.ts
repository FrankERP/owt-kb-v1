// app/components/admin/v3Rules.ts
//
// Solver v3 C6 RQ-5 — rules, per month, from one source:
//   · `==` count rules = the month source's `exactRules` (a bound month's record, otherwise IF2-15's
//     body); an on-screen `==` cap is never sent itself — it only lends its id and label to the
//     item covering the same person and canonical role set (RQ-5 (c));
//   · presence = the month source's `presence`, always MONTH-SCOPED (C5-16), one id per ruleKey;
//   · `<=`/`>=` caps and pairs come from the SCREEN for every month: roles only from IF2-16, values
//     only from IF2-17 per month (relative caps against the month's full Sunday count). IF2-17
//     `ok:false` refuses Auto before the fetch, one line per cap naming its card; nothing is rounded,
//     clamped, dropped or sent as 0 in its place. A relative cap that resolves to 0 is sent as 0 and
//     noticed. Every person resolves through C3's `resolveRulePersonId` — exactly one or Auto refuses;
//   · week exclusions and `!in` patterns reach the solver ONLY as eligibility (A15, C5-2); a week a
//     month solved from the screen does not have is noticed, never refused.
// A cap or pair whose pattern expands to [] constrains no role and is not sent (the form cannot
// produce one; only a hand-edited config can).

import { resolveRulePersonId, type RosterMember } from "@/app/utils/sundayCadence";
import { canonicalRoles, compareCodepoint, type FairnessLedgerResponse, type RoleKey } from "@/app/utils/fairnessVocabulary";
import { rolesOfPatternV3, trailingSaturday, type SolverConfig } from "./plannerModel";
import { capValueForMonth, completeSundaySpine } from "./serviceRuleContext";
import type { MonthSource } from "./v3MonthSources";
import { V3_CAP_REFUSAL, V3_LINES, V3_RESOLVER_REFUSAL } from "./v3Copy";
import {
  capCardLabel, capOrdinal, conflictCardLabel, conflictOrdinal, presenceCardLabel, presenceOrdinal,
  sinTarjetaExact, sinTarjetaPresence, weekExclusionLabel, type MintInput, type MintedIds, type RuleRefEntry,
} from "./v3RuleIds";
import type { V3Rule } from "./v3Wire";

export interface CollectedRules {
  caps: Array<{ ri: number; ci: number; person: string; roles: RoleKey[]; op: "<=" | ">="; values: Array<{ month: string; value: number }> }>;
  exact: Array<{ month: string; memberId: string; roles: RoleKey[]; count: number; card: { ri: number; ci: number } | null }>;
  presence: Array<{ month: string; ruleKey: string; persons: string[]; roles: RoleKey[]; exclusive: boolean }>;
  pairs: Array<{ index: number; persons: [string, string]; roles: RoleKey[] }>;
}

const sameRoles = (a: readonly RoleKey[], b: readonly RoleKey[]) => canonicalRoles(a).join(",") === canonicalRoles(b).join(",");

export function collectV3Rules(input: {
  months: readonly string[];
  sources: readonly MonthSource[];
  config: SolverConfig;
  members: readonly RosterMember[];
}): { ok: true; rules: CollectedRules; notices: string[]; rulePersons: Set<string> } | { ok: false; lines: string[] } {
  const { months, sources, config } = input;
  const roster = [...input.members];
  const lines: string[] = [];
  const notices: string[] = [];
  const rules: CollectedRules = { caps: [], exact: [], presence: [], pairs: [] };
  const resolve = (person: string): string | null => {
    const r = resolveRulePersonId(person, roster);
    if (r.ok) return r.id;
    lines.push(V3_RESOLVER_REFUSAL[r.reason](person, months[0], null));
    return null;
  };

  // `<=` / `>=` caps from the screen.
  config.restrictions.forEach((r, ri) => {
    r.caps.forEach((c, ci) => {
      if (c.op === "==") return;
      const roles = rolesOfPatternV3(c.pattern);
      if (roles.length === 0) return;
      const person = resolve(r.person);
      const values: Array<{ month: string; value: number }> = [];
      const notWhole: string[] = [];
      let negative = false;
      for (const month of months) {
        const v = capValueForMonth(c, month);
        if (!v.ok) {
          if (v.reason === "not_whole") notWhole.push(month);
          else negative = true;
          continue;
        }
        values.push({ month, value: v.count });
        if (c.relative && v.count === 0) notices.push(V3_LINES.relativeZero(capCardLabel(config, ri, ci), month, completeSundaySpine(month).length));
      }
      if (notWhole.length > 0) lines.push(V3_CAP_REFUSAL.not_whole(capCardLabel(config, ri, ci), notWhole));
      if (negative) lines.push(V3_CAP_REFUSAL.negative(capCardLabel(config, ri, ci), months));
      if (person !== null && notWhole.length === 0 && !negative) rules.caps.push({ ri, ci, person, roles, op: c.op, values });
    });
  });

  // `==` rules and presence from each month's source. An item takes the on-screen `==` cap with the
  // same person and canonical role set (by A38 at most one covers a role key), else its own id.
  const matchCard = (memberId: string, roles: readonly RoleKey[]): { ri: number; ci: number } | null => {
    for (let ri = 0; ri < config.restrictions.length; ri++) {
      const r = config.restrictions[ri];
      for (let ci = 0; ci < r.caps.length; ci++) {
        const c = r.caps[ci];
        if (c.op !== "==") continue;
        const who = resolveRulePersonId(r.person, roster);
        if (who.ok && who.id === memberId && sameRoles(rolesOfPatternV3(c.pattern), roles)) return { ri, ci };
      }
    }
    return null;
  };
  for (const source of sources) {
    for (const p of source.body.people) {
      for (const x of p.exactRules) {
        rules.exact.push({ month: source.month, memberId: p.memberId, roles: [...x.roles], count: x.count, card: matchCard(p.memberId, x.roles) });
      }
    }
    for (const r of source.body.presence) {
      rules.presence.push({ month: source.month, ruleKey: r.ruleKey, persons: [...r.members], roles: [...r.roles], exclusive: r.exclusive });
    }
  }

  // Pairs from the screen, horizon-wide.
  config.conflicts.forEach((c, index) => {
    const roles = rolesOfPatternV3(c.pattern);
    if (roles.length === 0) return;
    const a = resolve(c.personA);
    const b = resolve(c.personB);
    if (a !== null && b !== null && a !== b) rules.pairs.push({ index, persons: [a, b], roles });
  });

  // Week exclusions: noticed for every month solved from the screen that lacks the week.
  for (const source of sources) {
    if (source.state === "bound") continue;
    const spine = completeSundaySpine(source.month);
    const weeks = spine.length + (trailingSaturday(spine) ? 1 : 0);
    for (const r of config.restrictions) {
      for (const we of r.weekExclusions) {
        if (we.week > weeks) notices.push(V3_LINES.weekNotApplicable(weekExclusionLabel(r, we), source.month, we.week));
      }
    }
  }

  if (lines.length > 0) return { ok: false, lines: [...new Set(lines)] };
  const rulePersons = new Set<string>([
    ...rules.caps.map((c) => c.person),
    ...rules.exact.map((x) => x.memberId),
    ...rules.presence.flatMap((p) => p.persons),
    ...rules.pairs.flatMap((p) => p.persons),
  ]);
  return { ok: true, rules, notices, rulePersons };
}

export function mintInputOf(rules: CollectedRules, carriedKeys: readonly string[]): MintInput {
  return {
    caps: [
      ...rules.caps.map(({ ri, ci }) => ({ ri, ci })),
      ...rules.exact.flatMap((x) => (x.card ? [x.card] : [])),
    ].filter((c, i, all) => all.findIndex((d) => d.ri === c.ri && d.ci === c.ci) === i),
    exactUnmatched: rules.exact.filter((x) => x.card === null).map((x) => ({ month: x.month, memberId: x.memberId, roles: x.roles })),
    conflicts: rules.pairs.map((p) => p.index),
    presenceKeys: [...rules.presence.map((p) => p.ruleKey), ...carriedKeys],
  };
}

export function emitV3Rules(rules: CollectedRules, ids: MintedIds): V3Rule[] {
  const out: V3Rule[] = [];
  for (const c of rules.caps) {
    for (const { month, value } of c.values) {
      out.push({ kind: "count", id: ids.cap(c.ri, c.ci), person: c.person, roles: c.roles, op: c.op, month, value });
    }
  }
  for (const x of rules.exact) {
    out.push({
      kind: "count",
      id: x.card ? ids.cap(x.card.ri, x.card.ci) : ids.exact(x.month, x.memberId, x.roles),
      person: x.memberId, roles: x.roles, op: "==", month: x.month, value: x.count,
    });
  }
  for (const p of rules.presence) {
    out.push({ kind: "presence", id: ids.presence(p.ruleKey), persons: p.persons, roles: p.roles, exclusive: p.exclusive, month: p.month });
  }
  for (const p of rules.pairs) {
    out.push({ kind: "pair", id: ids.pair(p.index), persons: p.persons, roles: p.roles });
  }
  return out;
}

const KIND_ORDER: Record<string, number> = { c: 0, x: 1, p: 2, r: 3 };
const wireOrder = (wire: string) => {
  const bare = wire.startsWith("P:") ? wire.slice(2) : wire;
  return [KIND_ORDER[bare[0]] ?? 9, Number(bare.slice(1)), wire.startsWith("P:") ? 1 : 0] as const;
};

/** The in-memory id → card label map (§7) and KH-3's name-free table, one entry per wire id and `P:` key. */
export function ruleReferences(
  rules: CollectedRules, ids: MintedIds, config: SolverConfig, ledger: FairnessLedgerResponse, carriedKeys: readonly string[],
): { labels: Map<string, string>; table: RuleRefEntry[] } {
  const labels = new Map<string, string>();
  const table = new Map<string, RuleRefEntry>();
  const add = (wire: string, kind: RuleRefEntry["kind"], ordinal: string, label: string) => {
    if (!table.has(wire)) table.set(wire, { wire, kind, ordinal });
    const bare = wire.startsWith("P:") ? wire.slice(2) : wire;
    if (!labels.has(bare)) labels.set(bare, label);
  };
  for (const c of rules.caps) add(ids.cap(c.ri, c.ci), "count", capOrdinal(c.ri, c.ci), capCardLabel(config, c.ri, c.ci));
  for (const x of rules.exact) {
    if (x.card) add(ids.cap(x.card.ri, x.card.ci), "count", capOrdinal(x.card.ri, x.card.ci), capCardLabel(config, x.card.ri, x.card.ci));
    else add(ids.exact(x.month, x.memberId, x.roles), "count", sinTarjetaExact(x.month, x.memberId, x.roles), V3_LINES.recordedExactLabel(x.month));
  }
  for (const p of rules.pairs) add(ids.pair(p.index), "pair", conflictOrdinal(p.index), conflictCardLabel(config, p.index));
  const presenceOf = (ruleKey: string) => {
    const ordinal = presenceOrdinal(config, ruleKey);
    const card = config.presence.find((r) => r.id === ruleKey);
    return {
      ordinal: ordinal ?? sinTarjetaPresence(ruleKey, ledger),
      label: card ? presenceCardLabel(card) : V3_LINES.recordedPresenceLabel,
    };
  };
  for (const ruleKey of new Set(rules.presence.map((p) => p.ruleKey))) {
    const { ordinal, label } = presenceOf(ruleKey);
    add(ids.presence(ruleKey), "presence", ordinal, label);
  }
  for (const ruleKey of [...new Set(carriedKeys)].sort(compareCodepoint)) {
    const { ordinal, label } = presenceOf(ruleKey);
    add(`P:${ids.presence(ruleKey)}`, "presence", ordinal, label);
  }
  const entries = [...table.values()].sort((a, b) => {
    const [ka, na, pa] = wireOrder(a.wire);
    const [kb, nb, pb] = wireOrder(b.wire);
    return ka - kb || na - nb || pa - pb;
  });
  return { labels, table: entries };
}
