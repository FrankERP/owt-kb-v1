// app/utils/solverConfigWriteRequest.ts
//
// The ONE validator/normalizer for the shared planner rule document
// (`sanity/schemas/solverConfig.ts`). Pure — no network, no Sanity client, no
// `server-only` — so the admin route AND the `--apply`-guarded seed script both
// go through it and cannot drift.
//
// ─── Why this module exists at all ───────────────────────────────────────────
//
// **`_key` minting belongs in the ONGOING write path, not only in the seed.**
// Every rule the UI creates comes from `uid()` (`MonthGenerator.tsx:183`) and
// carries an `id`, never a `_key`; `SolverConfig` (`plannerModel.ts:196-241`)
// has no `_key` field at ANY of its five array levels. Without minting here,
// the first save after adding a rule persists a keyless array item — breaking
// CLAUDE.md's array-of-object invariant on the one document that governs hard
// enforcement for every admin on both surfaces.
//
// **The `_key` IS the `id`, not a second identifier.** `mintedKey` asserts it,
// `solverConfigFromDocument` reads `id` back, and the round-trip test pins that
// a rule minted by `uid()` survives write→read with the same `id`. Storing both
// names for one value is deliberate: `id` is the app's field (it is what
// `RuleBuilder`'s edit/delete handlers key on) and `_key` is Sanity's, and a
// reader that had to derive one from the other would be one refactor away from
// silently renaming every rule.
//
// ─── Why validation REJECTS rather than coerces ──────────────────────────────
//
// A rule with a blank `person`, an unknown `fairness`, or a duplicate `id` is
// not a rule the UI can produce. Coercing it to a default would write a
// DIFFERENT rule than the admin wrote, silently, into the shared document — and
// a hard block that silently changed meaning is exactly the failure the whole
// enforcement chain is built to avoid. So: reject with an issue path, and let
// the caller show it. The one exception is unknown EXTRA fields, which are
// dropped: the posted body is a `SolverConfig` plus whatever a future version
// adds, and refusing to save because the client is newer helps nobody HERE —
// this parser is lenient on purpose. The counterweight is one level up:
// `SOLVER_CONFIG_VERSION` (below). The route refuses a body whose
// `configVersion` is not exactly its own, a newer client's (e.g. 3) included,
// so on the route this parser never sees a body written for another shape.

import { normalizeLabel } from "./normalizeLabel";
import { normalizeMinistries } from "@/app/ministries";
import { displayMemberName, rulePersonNamesMember } from "./memberRuleNames";
import { resolveRulePersonId, type RosterMember } from "./sundayCadence";
// A RUNTIME import since C3: `rolesOfPattern` is the ONE solver-synced pattern →
// role map (`patternRolesSync.test.ts`). `plannerModel` is neutral — no
// "use client", no `server-only` — and does not import this module, so the
// route, the seed script (`npx tsx`) and the client all load it.
import {
  rolesOfPattern,
  type ConflictRule,
  type PersonRestriction,
  type PresenceRule,
  type RestrictionCap,
  type SolverConfig,
  type WeekExclusion,
} from "@/app/components/admin/plannerModel";

/**
 * The singleton document id. Deterministic on purpose: "the route may only
 * UPDATE" and "the seed refuses if it exists" are both undefined without one.
 */
export const SOLVER_CONFIG_DOC_ID = "solverConfig";

/** The stored `_type`. Same string as the id; they are independent choices. */
export const SOLVER_CONFIG_TYPE = "solverConfig";

/**
 * The document shape this bundle understands (solver v3 C3 §6.2). Every body a
 * pre-C3 client sends is version 1 (it carries none). The rules POST refuses any
 * other value after auth and the body's JSON/shape check, before the stored
 * document is read or `config` is parsed, because the leniency below
 * ("unknown extra fields are dropped") is exactly how an OLDER tab erases a
 * field it cannot see: its reader drops it, and its whole-document save writes
 * the result.
 *
 * **The bump rule.** A change that adds a field, OR an allowed value, that an
 * older client would drop or rewrite bumps this in the same change.
 * `solverConfigVersion.test.ts` pins the key set at every level and the accepted
 * values of `sundayCadence`, `fairness` and cap `op` for each version.
 */
export const SOLVER_CONFIG_VERSION = 2;

/**
 * The accepted values of the three enumerated fields. Exported for the version
 * tripwire (`solverConfigVersion.test.ts`), which pins them: a value an older
 * client would read as something else is a document-shape change and bumps
 * `SOLVER_CONFIG_VERSION` in the same change (C3 §6.2).
 */
export const FAIRNESS_VALUES = ["none", "exempt", "slack"] as const;
export const CAP_OPS = ["<=", ">=", "=="] as const;
/** «Mes por medio». Absence is «Normal»; «Normal» is never a stored value (C3 §6.1). */
export const SUNDAY_CADENCE_VALUES = ["alternate"] as const;

export type SolverConfigWriteFields = Record<string, unknown>;

export type ParsedSolverConfigWrite =
  | { ok: true; value: { config: SolverConfig; fields: SolverConfigWriteFields } }
  | { ok: false; issues: string[] };

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * A stored rule identifier, normalized. `normalizeLabel` and NOT `.toLowerCase()`
 * — the repo has exactly one label normalizer and lowercasing is wrong for every
 * user-facing string in this document (`normalizeLabel.ts` explains why case and
 * accents are meaningful; the same rule applies to a rule's person name).
 */
function idOf(raw: unknown): string | null {
  return normalizeLabel(raw);
}

/** A person's name as a rule spells it — an ALIAS, resolved at evaluation time. */
function personOf(raw: unknown): string | null {
  return normalizeLabel(raw);
}

function stringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    const v = normalizeLabel(item);
    if (v !== null && !out.includes(v)) out.push(v);
  }
  return out;
}

function finiteNumber(raw: unknown): number | null {
  return typeof raw === "number" && Number.isFinite(raw) ? raw : null;
}

/**
 * Walk one array level: validate each item, enforce a present and UNIQUE `id`,
 * and hand the caller the id it must mint a `_key` from.
 *
 * Uniqueness is per array INSTANCE, which is what Sanity requires of `_key`
 * (each `weekExclusions` array is its own key space, not shared across
 * restrictions).
 */
function mapItems<T>(
  raw: unknown,
  path: string,
  issues: string[],
  build: (item: Record<string, unknown>, id: string, itemPath: string) => T | null,
): T[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    issues.push(path);
    return [];
  }
  const out: T[] = [];
  const seen = new Set<string>();
  raw.forEach((item, i) => {
    const itemPath = `${path}[${i}]`;
    if (!isObj(item)) {
      issues.push(itemPath);
      return;
    }
    const id = idOf(item.id);
    if (id === null) {
      issues.push(`${itemPath}.id:missing`);
      return;
    }
    if (seen.has(id)) {
      issues.push(`${itemPath}.id:duplicate`);
      return;
    }
    seen.add(id);
    const built = build(item, id, itemPath);
    if (built !== null) out.push(built);
  });
  return out;
}

/**
 * Validate a posted rule set and produce BOTH the canonical `SolverConfig` (what
 * the client reads back) and the document fields to `set()` (every array item
 * carrying its `_key`).
 *
 * `ok: false` lists issue paths — `restrictions[2].id:duplicate`,
 * `conflicts[0].pattern` — and NOTHING is written.
 */
export function parseSolverConfigWrite(body: unknown): ParsedSolverConfigWrite {
  if (!isObj(body)) return { ok: false, issues: ["body"] };
  const issues: string[] = [];

  const restrictions = mapItems<PersonRestriction>(
    body.restrictions,
    "restrictions",
    issues,
    (item, id, itemPath) => {
      const person = personOf(item.person);
      if (person === null) {
        issues.push(`${itemPath}.person`);
        return null;
      }
      const fairnessRaw = typeof item.fairness === "string" ? item.fairness : "none";
      if (!(FAIRNESS_VALUES as readonly string[]).includes(fairnessRaw)) {
        issues.push(`${itemPath}.fairness`);
        return null;
      }
      // C3 §6.2: absent ⇒ «Normal» (no key anywhere); `"alternate"` ⇒ kept;
      // anything else — `null`, `"normal"`, a different case — is refused, like
      // every value the UI cannot produce.
      const cadence = item.sundayCadence;
      if (cadence !== undefined && !(SUNDAY_CADENCE_VALUES as readonly unknown[]).includes(cadence)) {
        issues.push(`${itemPath}.sundayCadence`);
        return null;
      }
      const slack = finiteNumber(item.fairnessSlack) ?? 1;
      const weekExclusions = mapItems<WeekExclusion>(
        item.weekExclusions,
        `${itemPath}.weekExclusions`,
        issues,
        (we, weId, wePath) => {
          const week = finiteNumber(we.week);
          const pattern = normalizeLabel(we.pattern);
          if (week === null || !Number.isInteger(week) || week < 1) {
            issues.push(`${wePath}.week`);
            return null;
          }
          if (pattern === null) {
            issues.push(`${wePath}.pattern`);
            return null;
          }
          return { id: weId, week, pattern };
        },
      );
      const caps = mapItems<RestrictionCap>(
        item.caps,
        `${itemPath}.caps`,
        issues,
        (cap, capId, capPath) => {
          const pattern = normalizeLabel(cap.pattern);
          const op = typeof cap.op === "string" ? cap.op : "";
          const value = finiteNumber(cap.value);
          const relOffset = finiteNumber(cap.relOffset) ?? 0;
          if (pattern === null) {
            issues.push(`${capPath}.pattern`);
            return null;
          }
          if (!(CAP_OPS as readonly string[]).includes(op)) {
            issues.push(`${capPath}.op`);
            return null;
          }
          if (value === null) {
            issues.push(`${capPath}.value`);
            return null;
          }
          return {
            id: capId,
            pattern,
            op: op as RestrictionCap["op"],
            value,
            relative: cap.relative === true,
            relOffset,
          };
        },
      );
      return {
        id,
        person,
        excludedPatterns: stringArray(item.excludedPatterns),
        fairness: fairnessRaw as PersonRestriction["fairness"],
        fairnessSlack: slack,
        weekExclusions,
        caps,
        ...(cadence === "alternate" ? { sundayCadence: "alternate" as const } : {}),
      };
    },
  );

  const conflicts = mapItems<ConflictRule>(body.conflicts, "conflicts", issues, (item, id, p) => {
    const personA = personOf(item.personA);
    const personB = personOf(item.personB);
    const pattern = normalizeLabel(item.pattern);
    if (personA === null) issues.push(`${p}.personA`);
    if (personB === null) issues.push(`${p}.personB`);
    if (pattern === null) issues.push(`${p}.pattern`);
    if (personA === null || personB === null || pattern === null) return null;
    return { id, personA, personB, pattern };
  });

  const presence = mapItems<PresenceRule>(body.presence, "presence", issues, (item, id, p) => {
    const persons = stringArray(item.persons);
    const pattern = normalizeLabel(item.pattern);
    if (persons.length === 0) issues.push(`${p}.persons`);
    if (pattern === null) issues.push(`${p}.pattern`);
    if (persons.length === 0 || pattern === null) return null;
    return { id, persons, pattern };
  });

  if (issues.length) return { ok: false, issues };

  // Parent A38: one exact count per person per role. Run ONLY after the early
  // return above: every refused item pushes an issue there, so past this line no
  // item was dropped and `restrictions[i].caps[j]` are the BODY's own indices —
  // the ones the client maps the refusal back through.
  const overlapIssues: string[] = [];
  for (const o of exactCapOverlaps({ restrictions })) {
    const path = `restrictions[${o.later.restriction}].caps[${o.later.cap}]:exact_overlap`;
    if (!overlapIssues.includes(path)) overlapIssues.push(path);
  }
  if (overlapIssues.length) return { ok: false, issues: overlapIssues };

  const config: SolverConfig = {
    sundayLeads: stringArray(body.sundayLeads),
    saturdayLeads: stringArray(body.saturdayLeads),
    support: stringArray(body.support),
    restrictions,
    conflicts,
    presence,
  };
  return { ok: true, value: { config, fields: solverConfigFields(config) } };
}

/** A cap's position in a config, in document order (C3 §7 item 3). */
export type CapRef = { restriction: number; cap: number };

/** Two `==` caps that fix a common role for one person (parent A38). */
export interface ExactCapOverlap {
  /** The earlier cap of the pair, in document order. */
  first: CapRef;
  /** The later cap — the one the parser's issue names. */
  later: CapRef;
  /** The earlier restriction's `person`, as written. */
  person: string;
  /** The common role keys, in `rolesOfPattern`'s order. */
  roles: string[];
}

/**
 * Every pair of `==` caps whose `rolesOfPattern` sets intersect — on one
 * restriction, or on two whose `person` texts are equal case-insensitively after
 * trimming (the rule-name criterion, `rulePersonNamesMember`). Pairs are ordered
 * by their later cap, then their earlier one. Value, `relative` and `relOffset`
 * play no part, and `<=`/`>=` caps never pair.
 *
 * Shared by the parser (which refuses each `later` once), the rule form, the
 * panel and the client's refusal mapping, so the form's check and the route's
 * refusal cannot disagree. Person and pattern go through `normalizeLabel` first
 * — the parser stores them that way — so a raw on-screen config and the parsed
 * body give the same pairs.
 *
 * Sees `person` TEXT only: two spellings of one member, and an overlap on
 * `Sat.Choir` alone (not one of the five keys), are C2's to refuse by member id
 * at build time (C3 §6.2).
 */
export function exactCapOverlaps(
  config: Pick<SolverConfig, "restrictions">,
  // ADR-0092: the writer passes the identity on an id-keyed config, so two spellings of one
  // member that resolved to one id pair, and two ids are never folded by case.
  keyOf: (person: string) => string | null = (person) => normalizeLabel(person)?.toLowerCase() ?? null,
): ExactCapOverlap[] {
  const exact: Array<{ ref: CapRef; key: string; person: string; roles: string[] }> = [];
  (config.restrictions ?? []).forEach((r, ri) => {
    const key = keyOf(r.person);
    if (key === null) return;
    (r.caps ?? []).forEach((c, ci) => {
      if (c.op !== "==") return;
      const roles: string[] = rolesOfPattern(normalizeLabel(c.pattern) ?? "");
      if (roles.length === 0) return;
      exact.push({ ref: { restriction: ri, cap: ci }, key, person: r.person, roles });
    });
  });
  const out: ExactCapOverlap[] = [];
  for (let j = 1; j < exact.length; j++) {
    for (let i = 0; i < j; i++) {
      if (exact[i].key !== exact[j].key) continue;
      const roles = exact[i].roles.filter((role) => exact[j].roles.includes(role));
      if (roles.length) out.push({ first: exact[i].ref, later: exact[j].ref, person: exact[i].person, roles });
    }
  }
  return out;
}

/**
 * The document fields for a validated config, every array-of-object item
 * carrying its `_key`.
 *
 * `_key: item.id` — the SAME identifier under Sanity's name, at all five levels.
 * Separate from `parseSolverConfigWrite` only so the round-trip test can feed it
 * a hand-built `SolverConfig` and assert the keys directly.
 */
export function solverConfigFields(config: SolverConfig): SolverConfigWriteFields {
  return {
    sundayLeads: [...config.sundayLeads],
    saturdayLeads: [...config.saturdayLeads],
    support: [...config.support],
    restrictions: config.restrictions.map((r) => ({
      _type: "solverRestriction",
      _key: r.id,
      id: r.id,
      person: r.person,
      excludedPatterns: [...r.excludedPatterns],
      fairness: r.fairness,
      fairnessSlack: r.fairnessSlack,
      weekExclusions: r.weekExclusions.map((we) => ({
        _type: "solverWeekExclusion",
        _key: we.id,
        id: we.id,
        week: we.week,
        pattern: we.pattern,
      })),
      caps: r.caps.map((c) => ({
        _type: "solverCap",
        _key: c.id,
        id: c.id,
        pattern: c.pattern,
        op: c.op,
        value: c.value,
        relative: c.relative,
        relOffset: c.relOffset,
      })),
      // «Normal» writes NO key, so a cadence-free document stays byte-identical
      // to what pre-C3 code writes (C3 §6.1; pinned by the step-zero literal).
      ...(r.sundayCadence === "alternate" ? { sundayCadence: "alternate" } : {}),
    })),
    conflicts: config.conflicts.map((c) => ({
      _type: "solverConflict",
      _key: c.id,
      id: c.id,
      personA: c.personA,
      personB: c.personB,
      pattern: c.pattern,
    })),
    presence: config.presence.map((p) => ({
      _type: "solverPresence",
      _key: p.id,
      id: p.id,
      persons: [...p.persons],
      pattern: p.pattern,
    })),
  };
}

/**
 * The complete document a CREATE commits, at the fixed singleton id.
 *
 * Exported for the seed script alone — the admin route never calls it, because
 * "only the seed may create" is the property that stops a browser holding no
 * rules from minting the shared document out of `DEFAULT_SOLVER_CONFIG`.
 */
export function buildSolverConfigDocument(input: {
  config: SolverConfig;
  now: string;
  updatedBy?: string | null;
}): Record<string, unknown> {
  return {
    _id: SOLVER_CONFIG_DOC_ID,
    _type: SOLVER_CONFIG_TYPE,
    ...solverConfigFields(input.config),
    updatedAt: input.now,
    ...(input.updatedBy ? { updatedBy: input.updatedBy } : {}),
  };
}

/**
 * A stored document back to the in-memory `SolverConfig` the components hold.
 *
 * Total and defensive by design: this is the READ half of a document that may
 * have been written by an older version of this module, and every one of the six
 * fields is iterated raw by the config step's own first render (`MemberPool`,
 * `RuleBuilder`). Returning a partially-`undefined` object here would white-screen
 * the panel — the same failure `MonthGenerator`'s `localStorage` hydration
 * normaliser exists to prevent, arriving by a different door.
 */
export function solverConfigFromDocument(doc: unknown): SolverConfig {
  const d = isObj(doc) ? doc : {};
  const restrictions: PersonRestriction[] = [];
  for (const item of Array.isArray(d.restrictions) ? d.restrictions : []) {
    if (!isObj(item)) continue;
    const id = storedId(item);
    const person = personOf(item.person);
    if (id === null || person === null) continue;
    const fairness = typeof item.fairness === "string" ? item.fairness : "none";
    restrictions.push({
      id,
      person,
      excludedPatterns: stringArray(item.excludedPatterns),
      fairness: ((FAIRNESS_VALUES as readonly string[]).includes(fairness)
        ? fairness
        : "none") as PersonRestriction["fairness"],
      fairnessSlack: finiteNumber(item.fairnessSlack) ?? 1,
      weekExclusions: (Array.isArray(item.weekExclusions) ? item.weekExclusions : [])
        .filter(isObj)
        .flatMap((we) => {
          const weId = storedId(we);
          const week = finiteNumber(we.week);
          const pattern = normalizeLabel(we.pattern);
          return weId !== null && week !== null && pattern !== null
            ? [{ id: weId, week, pattern }]
            : [];
        }),
      caps: (Array.isArray(item.caps) ? item.caps : []).filter(isObj).flatMap((c) => {
        const capId = storedId(c);
        const pattern = normalizeLabel(c.pattern);
        const op = typeof c.op === "string" && (CAP_OPS as readonly string[]).includes(c.op)
          ? (c.op as RestrictionCap["op"])
          : null;
        const value = finiteNumber(c.value);
        return capId !== null && pattern !== null && op !== null && value !== null
          ? [
              {
                id: capId,
                pattern,
                op,
                value,
                relative: c.relative === true,
                relOffset: finiteNumber(c.relOffset) ?? 0,
              },
            ]
          : [];
      }),
      // Total and defensive, like `fairness`: only `"alternate"` reads as «Mes
      // por medio»; a value a FUTURE version writes reads as «Normal» here — and
      // that version's bump refuses this one's saves, so it is never erased.
      ...(item.sundayCadence === "alternate" ? { sundayCadence: "alternate" as const } : {}),
    });
  }

  const conflicts: ConflictRule[] = [];
  for (const item of Array.isArray(d.conflicts) ? d.conflicts : []) {
    if (!isObj(item)) continue;
    const id = storedId(item);
    const personA = personOf(item.personA);
    const personB = personOf(item.personB);
    const pattern = normalizeLabel(item.pattern);
    if (id === null || personA === null || personB === null || pattern === null) continue;
    conflicts.push({ id, personA, personB, pattern });
  }

  const presence: PresenceRule[] = [];
  for (const item of Array.isArray(d.presence) ? d.presence : []) {
    if (!isObj(item)) continue;
    const id = storedId(item);
    const persons = stringArray(item.persons);
    const pattern = normalizeLabel(item.pattern);
    if (id === null || persons.length === 0 || pattern === null) continue;
    presence.push({ id, persons, pattern });
  }

  return {
    sundayLeads: stringArray(d.sundayLeads),
    saturdayLeads: stringArray(d.saturdayLeads),
    support: stringArray(d.support),
    restrictions,
    conflicts,
    presence,
  };
}

/**
 * A stored item's identifier: `id` if present, else its `_key`.
 *
 * The fallback is not hypothetical tidiness — it is the recovery path for a
 * document written by anything that set `_key` without `id`, and it is what
 * makes "the `_key` IS the `id`" true on the read side as well as the write.
 */
function storedId(item: Record<string, unknown>): string | null {
  return idOf(item.id) ?? idOf(item._key);
}

// ─── C1: rule people are member ids in storage, names everywhere else (ADR-0092) ───
//
// The four person fields (`restrictions[].person`, `conflicts[].personA/personB`,
// `presence[].persons[]`) hold a member's `_id` once the document carries
// `personTokens: "id"`, which only the consented script `scripts/rekey-solver-rule-people.ts`
// sets. Exactly two functions translate, and nothing else ever sees an id:
//
//   · `rulePeopleToNames` at every READ (`solverConfigGetBody`, the writer's own judging view,
//     the reconstruction script): each id becomes a label that resolves (`resolveRulePersonId`)
//     to exactly that member, or to nobody;
//   · `rulePeopleToIds` at the WRITE (`solverConfigWrite.ts`, the one writer core): each name
//     becomes the id it resolves to, or the token its label came from (`back`), or the save is
//     refused with nothing written.
//
// Without the marker both are the identity, so shipping this changes no stored byte. Why
// boundary translation and not a label at every printer: two plan reviews each found printers
// an inventory missed; a translation at the boundary needs no printer to remember anything.
// The roster is `rulePeopleRosterQuery()` (every published member, any ministry, with
// `ministries`: an absent field reads as worship, so a roster without it would make everyone
// look like worship).

/** The marker value. Anything else (absent included) means the four fields hold names. */
export const PERSON_TOKENS_ID = "id" as const;

/** The label of an id that is no member any more. Resolves to nobody (v3 refuses it loudly). */
export const RULE_PERSON_GONE = "persona que ya no está en Alabanza";
const OUTSIDE_ALABANZA = "(fuera de Alabanza)";
const REPEATED_PERSON = "(persona repetida)";
const NAMELESS = "persona sin nombre";

/** A roster row as `rulePeopleRosterQuery()` projects it. */
export interface RulePeopleRosterMember {
  _id: string;
  member_name?: unknown;
  alias?: unknown;
  ministries?: unknown;
}

/** Does this stored document key its rule people by member id? */
export function storesPersonIds(doc: unknown): boolean {
  return isObj(doc) && doc.personTokens === PERSON_TOKENS_ID;
}

/** Is this rule person the label of a member who is gone (any numbered variant)? */
export function isGoneRulePerson(person: string): boolean {
  return person.startsWith(RULE_PERSON_GONE);
}

/** The four person fields of a config, mapped with their issue paths (the parser's own paths). */
function mapRulePeople(config: SolverConfig, f: (token: string, path: string) => string): SolverConfig {
  return {
    ...config,
    restrictions: config.restrictions.map((r, i) => ({ ...r, person: f(r.person, `restrictions[${i}].person`) })),
    conflicts: config.conflicts.map((c, i) => ({
      ...c,
      personA: f(c.personA, `conflicts[${i}].personA`),
      personB: f(c.personB, `conflicts[${i}].personB`),
    })),
    presence: config.presence.map((p, i) => ({ ...p, persons: p.persons.map((t, j) => f(t, `presence[${i}].persons[${j}]`)) })),
  };
}

/** Every person token of a config, in document order (repeats kept). */
export function rulePeopleOf(config: SolverConfig): string[] {
  const out: string[] = [];
  mapRulePeople(config, (t) => (out.push(t), t));
  return out;
}

function asRoster(roster: readonly RulePeopleRosterMember[]): RosterMember[] {
  return roster.map((m) => ({
    _id: m._id,
    member_name: typeof m.member_name === "string" ? m.member_name : "",
    ...(typeof m.alias === "string" ? { alias: m.alias } : {}),
    ministries: m.ministries,
  }));
}

const isWorship = (m: RosterMember) => normalizeMinistries(m.ministries).includes("worship");
const foldKey = (s: string) => s.toLowerCase();
const byString = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * A label for each id token, unique case-insensitively against each other and `reserved`.
 *
 * A worship member's label is the text that resolves to them (display name, else
 * `member_name`); two worship members sharing both texts get «(persona repetida)»; a name
 * that only fails to resolve through spacing or Unicode form is its normalised display name.
 * A member outside Alabanza is «<nombre> (fuera de Alabanza)» (never the bare name: a worship
 * namesake would receive the rule); an id that is no member is `RULE_PERSON_GONE`. Every
 * non-resolving label that collides, or that names any roster member, takes « (2)», « (3)»…
 * in the order of the stored token strings, so reordering rules moves no suffix (deleting the rule of a
 * lower-sorted token can; the save still finds each label in the fresh `back`, ADR-0092).
 */
function labelIds(tokens: readonly string[], roster: RosterMember[], reserved: readonly string[] = []): Map<string, string> {
  const byId = new Map(roster.map((m) => [m._id, m]));
  const labels = new Map<string, string>();
  const used = new Set(reserved.map(foldKey));
  const pending: Array<{ token: string; base: string }> = [];
  const resolvesTo = (text: string | null, id: string) => {
    if (text === null) return false;
    const r = resolveRulePersonId(text, roster);
    return r.ok && r.id === id;
  };
  for (const token of [...new Set(tokens)].sort(byString)) {
    const m = byId.get(token);
    if (!m) {
      pending.push({ token, base: RULE_PERSON_GONE });
      continue;
    }
    const display = normalizeLabel(displayMemberName(m));
    if (!isWorship(m)) {
      pending.push({ token, base: `${display ?? NAMELESS} ${OUTSIDE_ALABANZA}` });
      continue;
    }
    const name = normalizeLabel(m.member_name);
    const own = resolvesTo(display, token) ? display : resolvesTo(name, token) ? name : null;
    if (own !== null) {
      labels.set(token, own);
      used.add(foldKey(own));
      continue;
    }
    const repeated = roster.some(
      (o) => o._id !== token && isWorship(o) && [displayMemberName(m), m.member_name].some((t) => rulePersonNamesMember(t, o)),
    );
    pending.push({ token, base: repeated ? `${display ?? NAMELESS} ${REPEATED_PERSON}` : display ?? NAMELESS });
  }
  const namesAnyone = (label: string) => roster.some((o) => rulePersonNamesMember(label, o));
  for (const { token, base } of pending) {
    let label = normalizeLabel(base) ?? NAMELESS;
    for (let n = 2; used.has(foldKey(label)) || namesAnyone(label); n++) label = normalizeLabel(`${base} (${n})`) ?? NAMELESS;
    used.add(foldKey(label));
    labels.set(token, label);
  }
  return labels;
}

/**
 * READ: the stored document as names (ADR-0092). `back` maps every label it produced, folded
 * to lower case, to the stored token it came from (the write's step 2); empty in names mode,
 * where `config` is `solverConfigFromDocument(doc)` unchanged.
 */
export function rulePeopleToNames(
  doc: unknown,
  roster: readonly RulePeopleRosterMember[],
): { config: SolverConfig; back: Map<string, string> } {
  const config = solverConfigFromDocument(doc);
  const back = new Map<string, string>();
  if (!storesPersonIds(doc)) return { config, back };
  const labels = labelIds(rulePeopleOf(config), asRoster(roster));
  for (const [token, label] of labels) back.set(foldKey(label), token);
  return { config: mapRulePeople(config, (t) => labels.get(t) ?? t), back };
}

/**
 * Why a save may not store a rule person. Each is the refused save's issue suffix
 * (`<path>:<reason>`), except `person_changed`, which the rules POST answers as a 409
 * `stale_revision` (`details.detail: "person_changed"`): the rename race (a tab read «Vale»,
 * Studio renamed her, the tab saves) refuses instead of detaching her.
 */
export type RulePersonRefusalReason = "ambiguous_person" | "not_worship" | "name_unmatched" | "person_changed" | "exact_overlap";

export interface RulePersonRefusal {
  /** The parser's issue path: `restrictions[0].person`, `presence[1].persons[2]`, `restrictions[0].caps[1]`. */
  path: string;
  /** The text the save carried (a name, never an id read from storage). */
  person: string;
  reason: RulePersonRefusalReason;
}

/** The issue a refusal adds to an `invalid_request` (every reason but `person_changed`). */
export function rulePersonIssue(refusal: RulePersonRefusal): string {
  return `${refusal.path}:${refusal.reason}`;
}

function whyNotStored(token: string, resolved: ReturnType<typeof resolveRulePersonId>, roster: RosterMember[]): RulePersonRefusalReason {
  if (!resolved.ok && resolved.reason === "ambiguous") return "ambiguous_person";
  if (roster.some((m) => !isWorship(m) && rulePersonNamesMember(token, m))) return "not_worship";
  const folded = foldKey(normalizeLabel(token) ?? "");
  const normalisedMatch = (t: string | undefined) => !!t && foldKey(normalizeLabel(t) ?? "") === folded;
  if (folded && roster.some((m) => isWorship(m) && (normalisedMatch(m.member_name) || normalisedMatch(m.alias)))) return "name_unmatched";
  return "person_changed";
}

/**
 * WRITE: a names config (as the panel, the chat or the parser holds it) to what is stored
 * (ADR-0092). The mode is the TARGET's: `setMarker` when passed (`"id"` = the migration,
 * `null` = its `--to-names` rollback), else the stored document's marker.
 *
 *   · names mode: names are written as given; a token that is a roster `_id` (only reachable
 *     from an id document) is written as its `rulePeopleToNames` label, never an id;
 *   · id mode: each token that resolves to one worship member → that `_id`; else a label in
 *     `back` (recomputed from `stored`, the FRESH read) → the token it came from; else the whole
 *     save is refused. Then a `presence` list keeps each id once, and two `==` caps that now fix
 *     a common role for one id refuse the save (`exact_overlap`), so a stored document always
 *     re-reads lossless.
 *
 * An unchanged names view round-trips byte-identical: a label resolves to its own id or to
 * nobody, and then `back` (a bijection) returns its token.
 */
export function rulePeopleToIds(
  config: SolverConfig,
  stored: unknown,
  roster: readonly RulePeopleRosterMember[],
  setMarker?: typeof PERSON_TOKENS_ID | null,
): { ok: true; config: SolverConfig } | { ok: false; refusal: RulePersonRefusal } {
  const people = asRoster(roster);
  const toIds = setMarker === undefined ? storesPersonIds(stored) : setMarker === PERSON_TOKENS_ID;
  if (!toIds) {
    const ids = new Set(people.map((m) => m._id));
    const tokens = rulePeopleOf(config);
    const idTokens = tokens.filter((t) => ids.has(t));
    if (!idTokens.length) return { ok: true, config };
    const labels = labelIds(idTokens, people, tokens.filter((t) => !ids.has(t)));
    return { ok: true, config: mapRulePeople(config, (t) => labels.get(t) ?? t) };
  }

  const { back } = rulePeopleToNames(stored, roster);
  let refusal = null as RulePersonRefusal | null; // `as`: set inside the callback below
  const keyed = mapRulePeople(config, (token, path) => {
    if (refusal) return token;
    const resolved = resolveRulePersonId(token, people);
    if (resolved.ok) return resolved.id;
    const stored = back.get(foldKey(normalizeLabel(token) ?? token));
    if (stored !== undefined) return stored;
    refusal = { path, person: token, reason: whyNotStored(token, resolved, people) };
    return token;
  });
  if (refusal) return { ok: false, refusal };

  const deduped: SolverConfig = { ...keyed, presence: keyed.presence.map((p) => ({ ...p, persons: [...new Set(p.persons)] })) };
  const overlap = exactCapOverlaps(deduped, (id) => id)[0];
  if (overlap) {
    return {
      ok: false,
      refusal: {
        path: `restrictions[${overlap.later.restriction}].caps[${overlap.later.cap}]`,
        person: config.restrictions[overlap.later.restriction]?.person ?? "",
        reason: "exact_overlap",
      },
    };
  }
  return { ok: true, config: deduped };
}
