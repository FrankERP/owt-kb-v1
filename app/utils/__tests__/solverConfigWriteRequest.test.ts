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
  parseSolverConfigWrite,
  solverConfigFields,
  solverConfigFromDocument,
} from "../solverConfigWriteRequest";
import type { SolverConfig } from "@/app/components/admin/plannerModel";

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
