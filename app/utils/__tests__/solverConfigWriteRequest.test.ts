// The shared rule document's validator/normalizer.
//
// The property that matters is NOT "the config round-trips" — a keyless document
// round-trips perfectly, which is exactly why "survives a hard reload" could
// never have caught the bug this module exists to prevent. The property is that
// every array-of-object item at all FIVE levels leaves here carrying a `_key`,
// minted from the `id` the UI's `uid()` already put on the rule, and that a body
// which cannot supply one is REJECTED rather than written keyless.

import { describe, expect, it } from "vitest";

import {
  SOLVER_CONFIG_DOC_ID,
  buildSolverConfigDocument,
  exactCapOverlaps,
  parseSolverConfigWrite,
  solverConfigFields,
  solverConfigFromDocument,
} from "../solverConfigWriteRequest";
import { DEFAULT_SOLVER_CONFIG } from "@/app/components/admin/solverConfigDefaults";
import type { PersonRestriction, RestrictionCap, SolverConfig } from "@/app/components/admin/plannerModel";

/** The UI's own id factory (`MonthGenerator.tsx`), copied so the test is honest
 *  about what a freshly added rule actually carries. */
const uid = () => Math.random().toString(36).slice(2, 9);

function fullConfig(): SolverConfig {
  return {
    sundayLeads: ["Frank", "Lucía"],
    saturdayLeads: ["Mkz"],
    support: ["Niza"],
    restrictions: [
      {
        id: uid(),
        person: "Frank",
        excludedPatterns: ["Sat.*", "Sun.BGV"],
        fairness: "exempt",
        fairnessSlack: 1,
        weekExclusions: [{ id: uid(), week: 3, pattern: "*.*" }],
        caps: [
          { id: uid(), pattern: "Sun.BGV", op: "<=", value: 0, relative: true, relOffset: 2 },
        ],
      },
    ],
    conflicts: [{ id: uid(), personA: "Lucía", personB: "Niza", pattern: "*.LeadBGV" }],
    presence: [{ id: uid(), persons: ["Hugo", "Jakey"], pattern: "Sun.BGV" }],
  };
}

/** Every array-of-object item in a document payload, with the path it sits at. */
function arrayItems(fields: Record<string, unknown>): { path: string; item: Record<string, unknown> }[] {
  const out: { path: string; item: Record<string, unknown> }[] = [];
  const restrictions = fields.restrictions as Record<string, unknown>[];
  restrictions.forEach((r, i) => {
    out.push({ path: `restrictions[${i}]`, item: r });
    (r.weekExclusions as Record<string, unknown>[]).forEach((we, j) =>
      out.push({ path: `restrictions[${i}].weekExclusions[${j}]`, item: we }),
    );
    (r.caps as Record<string, unknown>[]).forEach((c, j) =>
      out.push({ path: `restrictions[${i}].caps[${j}]`, item: c }),
    );
  });
  (fields.conflicts as Record<string, unknown>[]).forEach((c, i) =>
    out.push({ path: `conflicts[${i}]`, item: c }),
  );
  (fields.presence as Record<string, unknown>[]).forEach((p, i) =>
    out.push({ path: `presence[${i}]`, item: p }),
  );
  return out;
}

describe("parseSolverConfigWrite — `_key` minting", () => {
  it("mints a `_key` on every array-of-object item at all five levels", () => {
    const config = fullConfig();
    const parsed = parseSolverConfigWrite(config);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const items = arrayItems(parsed.value.fields);
    // Five levels: restriction, weekExclusion, cap, conflict, presence.
    expect(items.map((x) => x.path)).toEqual([
      "restrictions[0]",
      "restrictions[0].weekExclusions[0]",
      "restrictions[0].caps[0]",
      "conflicts[0]",
      "presence[0]",
    ]);
    for (const { path, item } of items) {
      expect(typeof item._key, `${path} must carry a _key`).toBe("string");
      expect(String(item._key).length, `${path} _key must be non-empty`).toBeGreaterThan(0);
    }
  });

  it("uses the rule's OWN `id` as its `_key`, never a second identifier", () => {
    const config = fullConfig();
    const parsed = parseSolverConfigWrite(config);
    if (!parsed.ok) throw new Error("expected ok");
    for (const { path, item } of arrayItems(parsed.value.fields)) {
      expect(item._key, `${path} _key must equal its id`).toBe(item.id);
    }
    // And the ids are the ones the caller supplied, not regenerated.
    const r = (parsed.value.fields.restrictions as Record<string, unknown>[])[0];
    expect(r._key).toBe(config.restrictions[0].id);
    expect((r.weekExclusions as Record<string, unknown>[])[0]._key).toBe(
      config.restrictions[0].weekExclusions[0].id,
    );
  });

  it("a freshly `uid()`ed rule added in the UI stores WITH a `_key`", () => {
    // The exact shape a new conflict arrives in: an `id` from `uid()`, no `_key`
    // anywhere, `SolverConfig` having no `_key` field at any level.
    const fresh = { id: uid(), personA: "Hugo", personB: "Jakey", pattern: "*.Lead" };
    expect(fresh).not.toHaveProperty("_key");
    const parsed = parseSolverConfigWrite({ ...fullConfig(), conflicts: [fresh] });
    if (!parsed.ok) throw new Error("expected ok");
    const stored = (parsed.value.fields.conflicts as Record<string, unknown>[])[0];
    expect(stored._key).toBe(fresh.id);
    expect(stored.personA).toBe("Hugo");
  });
});

describe("parseSolverConfigWrite — rejection", () => {
  const bad: [string, unknown, string][] = [
    ["a missing id", { restrictions: [{ person: "Frank" }] }, "restrictions[0].id:missing"],
    ["a blank id", { restrictions: [{ id: "   ", person: "Frank" }] }, "restrictions[0].id:missing"],
    [
      "a duplicate id in the same array",
      {
        restrictions: [
          { id: "same", person: "Frank" },
          { id: "same", person: "Gaby" },
        ],
      },
      "restrictions[1].id:duplicate",
    ],
    [
      "a duplicate id nested in weekExclusions",
      {
        restrictions: [
          {
            id: "r1",
            person: "Frank",
            weekExclusions: [
              { id: "w", week: 1, pattern: "*.*" },
              { id: "w", week: 2, pattern: "*.*" },
            ],
          },
        ],
      },
      "restrictions[0].weekExclusions[1].id:duplicate",
    ],
    [
      "a duplicate id nested in caps",
      {
        restrictions: [
          {
            id: "r1",
            person: "Frank",
            caps: [
              { id: "c", pattern: "Sun.BGV", op: "<=", value: 1 },
              { id: "c", pattern: "Sun.Lead", op: "<=", value: 1 },
            ],
          },
        ],
      },
      "restrictions[0].caps[1].id:duplicate",
    ],
    ["a duplicate conflict id", {
      conflicts: [
        { id: "x", personA: "A", personB: "B", pattern: "*.Lead" },
        { id: "x", personA: "C", personB: "D", pattern: "*.BGV" },
      ],
    }, "conflicts[1].id:duplicate"],
    ["a missing presence id", { presence: [{ persons: ["Hugo"], pattern: "Sun.BGV" }] }, "presence[0].id:missing"],
    ["a blank person", { restrictions: [{ id: "r1", person: "  " }] }, "restrictions[0].person"],
    [
      "an unknown fairness value",
      { restrictions: [{ id: "r1", person: "Frank", fairness: "always" }] },
      "restrictions[0].fairness",
    ],
    [
      "an unknown cap operator",
      { restrictions: [{ id: "r1", person: "Frank", caps: [{ id: "c", pattern: "Sun.BGV", op: "!=", value: 1 }] }] },
      "restrictions[0].caps[0].op",
    ],
    [
      "a week that is not a positive integer",
      { restrictions: [{ id: "r1", person: "Frank", weekExclusions: [{ id: "w", week: 0, pattern: "*.*" }] }] },
      "restrictions[0].weekExclusions[0].week",
    ],
    ["a conflict with no pattern", { conflicts: [{ id: "c1", personA: "A", personB: "B" }] }, "conflicts[0].pattern"],
    ["a presence rule naming nobody", { presence: [{ id: "p1", persons: [], pattern: "Sun.BGV" }] }, "presence[0].persons"],
    ["a non-object body", "not a config", "body"],
    ["a non-array restrictions field", { restrictions: { id: "r1" } }, "restrictions"],
  ];

  for (const [label, body, issue] of bad) {
    it(`rejects ${label} instead of writing it`, () => {
      const parsed = parseSolverConfigWrite(body);
      expect(parsed.ok).toBe(false);
      if (parsed.ok) return;
      expect(parsed.issues).toContain(issue);
    });
  }

  it("drops unknown extra fields rather than refusing a newer client's body", () => {
    const parsed = parseSolverConfigWrite({ ...fullConfig(), somethingNew: { a: 1 } });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.fields).not.toHaveProperty("somethingNew");
  });
});

describe("solverConfigFromDocument — the read half", () => {
  it("round-trips a config through the document shape, ids intact", () => {
    const config = fullConfig();
    const parsed = parseSolverConfigWrite(config);
    if (!parsed.ok) throw new Error("expected ok");
    const back = solverConfigFromDocument({
      _id: SOLVER_CONFIG_DOC_ID,
      _type: "solverConfig",
      ...parsed.value.fields,
    });
    expect(back).toEqual(config);
  });

  it("recovers an item's id from its `_key` when `id` was never stored", () => {
    // The `_key` IS the id, so a document written with only the Sanity name is
    // still readable — the rule keeps its identity instead of becoming a new one
    // whose edit/delete handlers address nothing.
    const back = solverConfigFromDocument({
      conflicts: [{ _key: "k1", personA: "Hugo", personB: "Jakey", pattern: "*.Lead" }],
    });
    expect(back.conflicts).toEqual([
      { id: "k1", personA: "Hugo", personB: "Jakey", pattern: "*.Lead" },
    ]);
  });

  it("returns all six fields as arrays for a document missing every one of them", () => {
    // This is the read-side twin of `MonthGenerator`'s hydration normaliser: the
    // config step iterates all six raw during its own first render, so a
    // partially-undefined object here white-screens the panel.
    const back = solverConfigFromDocument({ _id: SOLVER_CONFIG_DOC_ID });
    expect(back).toEqual({
      sundayLeads: [],
      saturdayLeads: [],
      support: [],
      restrictions: [],
      conflicts: [],
      presence: [],
    });
    for (const v of Object.values(back)) expect(Array.isArray(v)).toBe(true);
  });

  it("skips a stored rule that identifies nobody rather than inventing one", () => {
    const back = solverConfigFromDocument({
      conflicts: [{ _key: "k", personA: "Hugo", pattern: "*.Lead" }],
    });
    expect(back.conflicts).toEqual([]);
  });
});

describe("buildSolverConfigDocument", () => {
  it("pins the singleton id and type, and carries the minted keys", () => {
    const config = fullConfig();
    const doc = buildSolverConfigDocument({ config, now: "2026-08-01T00:00:00.000Z" });
    expect(doc._id).toBe("solverConfig");
    expect(doc._type).toBe("solverConfig");
    expect(doc.updatedAt).toBe("2026-08-01T00:00:00.000Z");
    expect((doc.restrictions as Record<string, unknown>[])[0]._key).toBe(config.restrictions[0].id);
  });

  it("is the same field payload the route writes — one minting site, no drift", () => {
    const config = fullConfig();
    const doc = buildSolverConfigDocument({ config, now: "x" });
    const fields = solverConfigFields(config);
    for (const key of Object.keys(fields)) expect(doc[key]).toEqual(fields[key]);
  });
});

// ─── Solver v3 C3 · step zero — the pre-C3 serializer, frozen ────────────────
//
// Written and asserted on the UNCHANGED serializer, before any C3 code lands
// (C3 §6.1, T2): a document C3 writes for a config with no «Mes por medio» must
// be byte-identical to what the pre-C3 code writes for the same config. A red
// literal here is a finding about the change, never a value to re-capture.
const FROZEN_CONFIG: SolverConfig = {
  sundayLeads: ["m-ana", "m-carla"],
  saturdayLeads: ["m-bruno"],
  support: ["m-diana"],
  restrictions: [
    {
      id: "r-ana", person: "Ana", excludedPatterns: ["Sat.*"], fairness: "exempt", fairnessSlack: 1,
      weekExclusions: [{ id: "w-1", week: 2, pattern: "*.*" }],
      caps: [{ id: "c-1", pattern: "Sun.Lead", op: "==", value: 2, relative: false, relOffset: 0 }],
    },
    { id: "r-bruno", person: "Bruno", excludedPatterns: [], fairness: "slack", fairnessSlack: 2, weekExclusions: [], caps: [] },
  ],
  conflicts: [{ id: "x-1", personA: "Ana", personB: "Bruno", pattern: "*.Lead" }],
  presence: [{ id: "p-1", persons: ["Carla", "Diana"], pattern: "Sun.BGV" }],
};

const FROZEN_FIELDS_JSON =
  '{"sundayLeads":["m-ana","m-carla"],"saturdayLeads":["m-bruno"],"support":["m-diana"],' +
  '"restrictions":[{"_type":"solverRestriction","_key":"r-ana","id":"r-ana","person":"Ana",' +
  '"excludedPatterns":["Sat.*"],"fairness":"exempt","fairnessSlack":1,' +
  '"weekExclusions":[{"_type":"solverWeekExclusion","_key":"w-1","id":"w-1","week":2,"pattern":"*.*"}],' +
  '"caps":[{"_type":"solverCap","_key":"c-1","id":"c-1","pattern":"Sun.Lead","op":"==","value":2,"relative":false,"relOffset":0}]},' +
  '{"_type":"solverRestriction","_key":"r-bruno","id":"r-bruno","person":"Bruno","excludedPatterns":[],' +
  '"fairness":"slack","fairnessSlack":2,"weekExclusions":[],"caps":[]}],' +
  '"conflicts":[{"_type":"solverConflict","_key":"x-1","id":"x-1","personA":"Ana","personB":"Bruno","pattern":"*.Lead"}],' +
  '"presence":[{"_type":"solverPresence","_key":"p-1","id":"p-1","persons":["Carla","Diana"],"pattern":"Sun.BGV"}]}';

describe("C3 step zero — a cadence-free config serializes byte-identically to pre-C3", () => {
  it("solverConfigFields matches the frozen pre-C3 JSON, key order included", () => {
    expect(JSON.stringify(solverConfigFields(FROZEN_CONFIG))).toBe(FROZEN_FIELDS_JSON);
  });

  it("the parser's stored fields for the same body are the same bytes", () => {
    const parsed = parseSolverConfigWrite(FROZEN_CONFIG);
    if (!parsed.ok) throw new Error(parsed.issues.join(", "));
    expect(JSON.stringify(parsed.value.fields)).toBe(FROZEN_FIELDS_JSON);
  });
});

// ─── Solver v3 C3 · «Mes por medio» (`sundayCadence`) — T1, T2, T3 ───────────
//
// Absent = «Normal», `"alternate"` = «Mes por medio», and nothing else is ever
// stored (C3 §6.1–§6.3). «Normal» is never a key: a document without the
// cadence stays byte-identical to what pre-C3 code writes (step zero above).
function cadenceBody(sundayCadence: unknown, withKey = true) {
  const restriction: Record<string, unknown> = {
    id: "r-ana", person: "Ana", excludedPatterns: [], fairness: "none", fairnessSlack: 1,
    weekExclusions: [], caps: [],
  };
  if (withKey) restriction.sundayCadence = sundayCadence;
  return { sundayLeads: [], saturdayLeads: [], support: [], restrictions: [restriction], conflicts: [], presence: [] };
}

describe("parseSolverConfigWrite — `sundayCadence` (C3 T1)", () => {
  it("absent ⇒ «Normal»: no key in the canonical config and none in the stored fields", () => {
    const parsed = parseSolverConfigWrite(cadenceBody(undefined, false));
    if (!parsed.ok) throw new Error(parsed.issues.join(", "));
    expect(parsed.value.config.restrictions[0]).not.toHaveProperty("sundayCadence");
    const stored = (parsed.value.fields.restrictions as Record<string, unknown>[])[0];
    expect(stored).not.toHaveProperty("sundayCadence");
  });

  it('`"alternate"` is kept in the config and stored', () => {
    const parsed = parseSolverConfigWrite(cadenceBody("alternate"));
    if (!parsed.ok) throw new Error(parsed.issues.join(", "));
    expect(parsed.value.config.restrictions[0].sundayCadence).toBe("alternate");
    const stored = (parsed.value.fields.restrictions as Record<string, unknown>[])[0];
    expect(stored.sundayCadence).toBe("alternate");
  });

  it("a restriction carrying ONLY the cadence is a valid rule (no clause needed)", () => {
    const parsed = parseSolverConfigWrite(cadenceBody("alternate"));
    expect(parsed.ok).toBe(true);
  });

  for (const bad of ["normal", "Alternate", true, null, 1, "", "alternate "]) {
    it(`refuses ${JSON.stringify(bad)} at restrictions[0].sundayCadence, writing nothing`, () => {
      const parsed = parseSolverConfigWrite(cadenceBody(bad));
      expect(parsed.ok).toBe(false);
      if (parsed.ok) return;
      expect(parsed.issues).toEqual(["restrictions[0].sundayCadence"]);
    });
  }
});

describe("solverConfigFields — `sundayCadence` (C3 T2)", () => {
  it("emits no `sundayCadence` key for a «Normal» restriction", () => {
    const fields = solverConfigFields(FROZEN_CONFIG);
    for (const r of fields.restrictions as Record<string, unknown>[]) {
      expect(r).not.toHaveProperty("sundayCadence");
    }
  });

  it('emits `sundayCadence: "alternate"` after `caps`, and only on the restriction that carries it', () => {
    const config: SolverConfig = {
      ...FROZEN_CONFIG,
      restrictions: [{ ...FROZEN_CONFIG.restrictions[0], sundayCadence: "alternate" }, FROZEN_CONFIG.restrictions[1]],
    };
    const [ana, bruno] = solverConfigFields(config).restrictions as Record<string, unknown>[];
    expect(Object.keys(ana).slice(-2)).toEqual(["caps", "sundayCadence"]);
    expect(ana.sundayCadence).toBe("alternate");
    expect(bruno).not.toHaveProperty("sundayCadence");
  });
});

describe("solverConfigFromDocument — `sundayCadence` (C3 T3)", () => {
  const stored = (sundayCadence: unknown) => ({
    restrictions: [{ _key: "r-ana", id: "r-ana", person: "Ana", fairness: "none", sundayCadence }],
  });

  it('reads `"alternate"` back as «Mes por medio»', () => {
    expect(solverConfigFromDocument(stored("alternate")).restrictions[0].sundayCadence).toBe("alternate");
  });

  it("reads any other stored value as «Normal» — total and defensive, like `fairness`", () => {
    for (const v of ["normal", "biweekly", null, true, 1, undefined]) {
      expect(solverConfigFromDocument(stored(v)).restrictions[0], JSON.stringify(v)).not.toHaveProperty("sundayCadence");
    }
  });

  it("write → read keeps the field and every id", () => {
    const config: SolverConfig = {
      ...FROZEN_CONFIG,
      restrictions: [{ ...FROZEN_CONFIG.restrictions[0], sundayCadence: "alternate" }, FROZEN_CONFIG.restrictions[1]],
    };
    const parsed = parseSolverConfigWrite(config);
    if (!parsed.ok) throw new Error(parsed.issues.join(", "));
    const back = solverConfigFromDocument({ _id: SOLVER_CONFIG_DOC_ID, ...parsed.value.fields });
    expect(back).toEqual(config);
    expect(back.restrictions[0].sundayCadence).toBe("alternate");
    expect(back.restrictions[1]).not.toHaveProperty("sundayCadence");
  });
});

// ─── Solver v3 C3 · one exact count per person per role (parent A38) — T14 ────
//
// Two `==` caps that cover a common role (`rolesOfPattern`, the five v2 keys) for
// one `person` text are refused at save — within one restriction and across
// restrictions whose `person` is equal case-insensitively after trimming. The
// issue names the LATER cap of each pair, once, with the `:exact_overlap` suffix.
let capSeq = 0;
const cap = (pattern: string, op: RestrictionCap["op"], value = 1, extra: Partial<RestrictionCap> = {}): RestrictionCap => ({
  id: `c-${++capSeq}`, pattern, op, value, relative: false, relOffset: 0, ...extra,
});
const rule = (id: string, person: string, caps: RestrictionCap[]): PersonRestriction => ({
  id, person, excludedPatterns: [], fairness: "none", fairnessSlack: 1, weekExclusions: [], caps,
});
const withRules = (...restrictions: PersonRestriction[]): SolverConfig => ({
  sundayLeads: [], saturdayLeads: [], support: [], restrictions, conflicts: [], presence: [],
});
const refusedAt = (config: SolverConfig): string[] => {
  const parsed = parseSolverConfigWrite(config);
  return parsed.ok ? [] : parsed.issues;
};

describe("exactCapOverlaps + the parser — one exact count per role (C3 T14)", () => {
  it("refuses two `==` caps on one restriction covering Sun.Lead, at the later cap", () => {
    const config = withRules(rule("r-ana", "Ana", [cap("Sun.Lead", "==", 2), cap("Sun.*", "==", 3)]));
    expect(exactCapOverlaps(config)).toEqual([
      { first: { restriction: 0, cap: 0 }, later: { restriction: 0, cap: 1 }, person: "Ana", roles: ["Sun.Lead"] },
    ]);
    expect(refusedAt(config)).toEqual(["restrictions[0].caps[1]:exact_overlap"]);
  });

  it("three mutually overlapping caps report each later cap once", () => {
    const config = withRules(rule("r-ana", "Ana", [cap("Sun.Lead", "=="), cap("*.Lead", "=="), cap("*.*", "==")]));
    expect(exactCapOverlaps(config).map((o) => [o.first.cap, o.later.cap])).toEqual([[0, 1], [0, 2], [1, 2]]);
    expect(refusedAt(config)).toEqual([
      "restrictions[0].caps[1]:exact_overlap",
      "restrictions[0].caps[2]:exact_overlap",
    ]);
  });

  it("looks ACROSS restrictions whose person differs only in case and surrounding spaces", () => {
    const config = withRules(
      rule("r-1", "Ana", [cap("Sun.Lead", "==", 2)]),
      rule("r-2", "Bruno", [cap("Sun.Lead", "==", 1)]),
      rule("r-3", "  aNA ", [cap("*.Lead", "==", 1)]),
    );
    expect(exactCapOverlaps(config)).toEqual([
      { first: { restriction: 0, cap: 0 }, later: { restriction: 2, cap: 0 }, person: "Ana", roles: ["Sun.Lead"] },
    ]);
    expect(refusedAt(config)).toEqual(["restrictions[2].caps[0]:exact_overlap"]);
  });

  it("`Sat.* == 1` with `*.Lead == 1` is refused on Sat.Lead", () => {
    const config = withRules(rule("r-ana", "Ana", [cap("Sat.*", "=="), cap("*.Lead", "==")]));
    expect(exactCapOverlaps(config)[0].roles).toEqual(["Sat.Lead"]);
    expect(refusedAt(config)).toEqual(["restrictions[0].caps[1]:exact_overlap"]);
  });

  it("the value plays no part: equal values, and relative values, are still refused", () => {
    expect(refusedAt(withRules(rule("r", "Ana", [cap("Sun.BGV", "==", 2), cap("Sun.BGV", "==", 2)])))).toEqual([
      "restrictions[0].caps[1]:exact_overlap",
    ]);
    expect(refusedAt(withRules(rule("r", "Ana", [
      cap("Sat.BGV", "==", 0, { relative: true, relOffset: 2 }),
      cap("Sat.*", "==", 0, { relative: true, relOffset: 9 }),
    ])))).toEqual(["restrictions[0].caps[1]:exact_overlap"]);
  });

  it("`==` beside `>=` or `<=` on the same role is accepted, as today", () => {
    const config = withRules(rule("r", "Ana", [cap("Sun.Lead", "==", 2), cap("Sun.Lead", ">=", 1), cap("Sun.*", "<=", 3)]));
    expect(exactCapOverlaps(config)).toEqual([]);
    expect(parseSolverConfigWrite(config).ok).toBe(true);
  });

  it("two DIFFERENT person texts (a name and an alias of one member) pass the save — C2 judges by id", () => {
    const config = withRules(
      rule("r-1", "Ana", [cap("Sun.Lead", "==", 2)]),
      rule("r-2", "Ana Karen Villalobos", [cap("Sun.Lead", "==", 1)]),
    );
    expect(exactCapOverlaps(config)).toEqual([]);
    expect(parseSolverConfigWrite(config).ok).toBe(true);
  });

  it("`Sat.* ==` with `*.Choir ==` passes: the five-key map has no Sat.Choir (the documented gap)", () => {
    const config = withRules(rule("r", "Ana", [cap("Sat.*", "=="), cap("*.Choir", "==")]));
    expect(exactCapOverlaps(config)).toEqual([]);
    expect(parseSolverConfigWrite(config).ok).toBe(true);
  });

  it("only runs once every item parsed, so its indices are the body's own", () => {
    // A bad cap on restriction 0 is refused by itself; the overlap on
    // restriction 1 is not reported in the same answer (review item 17).
    const config = withRules(
      rule("r-1", "Bruno", [{ ...cap("Sun.BGV", "<="), op: "!=" as RestrictionCap["op"] }]),
      rule("r-2", "Ana", [cap("Sun.Lead", "=="), cap("Sun.Lead", "==")]),
    );
    expect(refusedAt(config)).toEqual(["restrictions[0].caps[0].op"]);
  });

  it("normalises the way the parser does, so client and route agree on a raw body", () => {
    // Inner whitespace and NFC are `normalizeLabel`'s; case and trim are the
    // rule-name criterion's (`rulePersonNamesMember`).
    const config = withRules(
      rule("r-1", "Ana  Karen", [cap(" Sun.Lead ", "==")]),
      rule("r-2", "ana karen", [cap("Sun.Lead", "==")]),
    );
    expect(exactCapOverlaps(config)).toHaveLength(1);
    expect(refusedAt(config)).toEqual(["restrictions[1].caps[0]:exact_overlap"]);
  });

  it("no existing fixture of this file and not DEFAULT_SOLVER_CONFIG overlaps", () => {
    for (const c of [fullConfig(), FROZEN_CONFIG, DEFAULT_SOLVER_CONFIG]) {
      expect(exactCapOverlaps(c)).toEqual([]);
      expect(parseSolverConfigWrite(c).ok).toBe(true);
    }
  });

  it("DEFAULT_SOLVER_CONFIG is unchanged by C3: no restriction carries the cadence (§6.9)", () => {
    expect(DEFAULT_SOLVER_CONFIG.restrictions.filter((r) => r.sundayCadence !== undefined)).toEqual([]);
  });
});
