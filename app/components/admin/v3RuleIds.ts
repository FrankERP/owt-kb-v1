// app/components/admin/v3RuleIds.ts
//
// Solver v3 C6 RQ-5 «Rule ids — minted, never a key», KH-1 and KH-3.
//
// No config key and no `ruleKey` is ever sent as a rule id: config keys are normalised labels
// unique only within one array, and seed-era keys spell members' first names. Every id is a kind
// prefix + a 1-based ordinal over the request's rules of that kind, in codepoint order of their
// source keys (ties — possible only with duplicate keys in a hand-edited config — by config
// ordinal):
//   c<n>  an on-screen cap (any op; an `==` cap also names a matched `exactRules` item)
//   x<n>  an `exactRules` item with no matching on-screen `==` cap
//   p<n>  an on-screen pair (`conflicts[i]`)
//   r<n>  a presence `ruleKey` — over the request's presence rules AND every carried `P:` key
// (i) each matches `[A-Za-z0-9_-]{1,64}` and none is `mandatory_lead`; (ii) the same inputs give the
// same ids; (iii) an ordinal carries no substring or digest of its key.
//
// The id → label map and every source key stay in memory with the plan. KH-3's table maps each
// wire id to its KIND and CONFIG ORDINAL only — the one id map that may be shown (in «Ver etapas»).

import { capLabel, type PersonRestriction, type PresenceRule, type SolverConfig, type WeekExclusion } from "./plannerModel";
import { compareCodepoint, type FairnessLedgerResponse, type RoleKey } from "@/app/utils/fairnessVocabulary";

export type V3RuleKind = "count" | "pair" | "presence";

export interface MintInput {
  caps: ReadonlyArray<{ ri: number; ci: number }>;
  exactUnmatched: ReadonlyArray<{ month: string; memberId: string; roles: readonly RoleKey[] }>;
  conflicts: readonly number[];
  presenceKeys: readonly string[];
}

export interface MintedIds {
  cap(ri: number, ci: number): string;
  exact(month: string, memberId: string, roles: readonly RoleKey[]): string;
  pair(index: number): string;
  presence(ruleKey: string): string;
}

const exactKey = (month: string, memberId: string, roles: readonly RoleKey[]) => `${month}\u0000${memberId}\u0000${roles.join(",")}`;

/** Ordinals by (source key in codepoint order, then tie). Returns handle → minted id. */
function mint<H>(prefix: string, items: ReadonlyArray<{ handle: H; key: string; tie: number }>): Map<H, string> {
  const sorted = [...items].sort((a, b) => compareCodepoint(a.key, b.key) || a.tie - b.tie);
  return new Map(sorted.map((item, i) => [item.handle, `${prefix}${i + 1}`]));
}

function must(map: Map<string, string>, handle: string, what: string): string {
  const id = map.get(handle);
  if (id === undefined) throw new Error(`v3RuleIds: no minted id for this ${what}`);
  return id;
}

export function mintRuleIds(config: SolverConfig, input: MintInput): MintedIds {
  const caps = mint("c", input.caps.map(({ ri, ci }) => ({
    handle: `${ri}.${ci}`,
    key: `${config.restrictions[ri].id}\u0000${config.restrictions[ri].caps[ci].id}`,
    tie: ri * 10_000 + ci,
  })));
  const exactHandles = new Map<string, { handle: string; key: string; tie: number }>();
  input.exactUnmatched.forEach((x, i) => {
    const k = exactKey(x.month, x.memberId, x.roles);
    if (!exactHandles.has(k)) exactHandles.set(k, { handle: k, key: k, tie: i });
  });
  const exact = mint("x", [...exactHandles.values()]);
  const pairs = mint("p", input.conflicts.map((i) => ({ handle: String(i), key: config.conflicts[i].id, tie: i })));
  const presence = mint("r", [...new Set(input.presenceKeys)].map((k, i) => ({ handle: k, key: k, tie: i })));
  return {
    cap: (ri, ci) => must(caps, `${ri}.${ci}`, "cap"),
    exact: (month, memberId, roles) => must(exact, exactKey(month, memberId, roles), "exact rule"),
    pair: (index) => must(pairs, String(index), "pair"),
    presence: (ruleKey) => must(presence, ruleKey, "presence rule"),
  };
}

// ─── Card labels (the only way a rule id is rendered, §7) ───────────────────

export function capCardLabel(config: SolverConfig, ri: number, ci: number): string {
  const r = config.restrictions[ri];
  return `${r.person} · ${capLabel(r.caps[ci])}`;
}

export function conflictCardLabel(config: SolverConfig, index: number): string {
  const c = config.conflicts[index];
  return `${c.personA} ≠ ${c.personB} en ${c.pattern}`;
}

export function presenceCardLabel(rule: PresenceRule): string {
  return `${rule.persons.join(", ")} en ${rule.pattern} c/sem`;
}

export function weekExclusionLabel(r: PersonRestriction, we: WeekExclusion): string {
  return `${r.person} · sem.${we.week} ${we.pattern}`;
}

// ─── KH-3: the rule reference table ─────────────────────────────────────────

export interface RuleRefEntry {
  /** The wire id, or `P:` + id for a rewritten carried key. */
  wire: string;
  kind: V3RuleKind;
  /** `restrictions[i].caps[j]`, `conflicts[i]`, `presence[i]`, or a «sin tarjeta» reason. */
  ordinal: string;
}

export const capOrdinal = (ri: number, ci: number) => `restrictions[${ri}].caps[${ci}]`;
export const conflictOrdinal = (i: number) => `conflicts[${i}]`;

export function presenceOrdinal(config: SolverConfig, ruleKey: string): string | null {
  const i = config.presence.findIndex((p) => p.id === ruleKey);
  return i === -1 ? null : `presence[${i}]`;
}

/**
 * A presence id or carried-only `P:` key whose `ruleKey` has no on-screen card: its position, in
 * codepoint order, among the distinct `ruleKey`s of the run's GET body (its `window` `P:` keys and
 * every `horizon[].record.presence[].ruleKey`) — recomputable privately from a captured GET.
 */
export function sinTarjetaPresence(ruleKey: string, ledger: FairnessLedgerResponse): string {
  const keys = new Set<string>();
  for (const person of ledger.people) {
    for (const line of Object.keys(person.window ?? {})) if (line.startsWith("P:")) keys.add(line.slice(2));
  }
  for (const h of ledger.horizon) for (const p of h.record?.presence ?? []) keys.add(p.ruleKey);
  const index = [...keys].sort(compareCodepoint).indexOf(ruleKey);
  return `sin tarjeta, posición ${index} entre las reglas de presencia de la lectura`;
}

/** An `exactRules` item with no matching card: its own wire facts (month, member id, role set). */
export function sinTarjetaExact(month: string, memberId: string, roles: readonly RoleKey[]): string {
  return `sin tarjeta, ${month} ${memberId} ${roles.join(",")}`;
}

/** One copyable, name-free block headed by the run's `request_id`; tab-separated rows. */
export function renderRuleRefTable(requestId: string, entries: readonly RuleRefEntry[]): string {
  return [`request_id ${requestId}`, ...entries.map((e) => `${e.wire}\t${e.kind}\t${e.ordinal}`)].join("\n");
}
