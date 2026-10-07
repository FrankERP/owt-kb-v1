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
export function exactCapOverlaps(config: Pick<SolverConfig, "restrictions">): ExactCapOverlap[] {
  const exact: Array<{ ref: CapRef; key: string; person: string; roles: string[] }> = [];
  (config.restrictions ?? []).forEach((r, ri) => {
    const name = normalizeLabel(r.person);
    if (name === null) return;
    (r.caps ?? []).forEach((c, ci) => {
      if (c.op !== "==") return;
      const roles: string[] = rolesOfPattern(normalizeLabel(c.pattern) ?? "");
      if (roles.length === 0) return;
      exact.push({ ref: { restriction: ri, cap: ci }, key: name.toLowerCase(), person: r.person, roles });
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
