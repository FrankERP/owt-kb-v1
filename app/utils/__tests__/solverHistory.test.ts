// The solver's fairness history, derived from stored weekend role documents
// (spec 2026-09-23-solver-history-derivation-design.md, R1–R7). Every test below
// pins one requirement; the R12 equivalence against `historyEntryFromDrafts`
// lives beside it in `solverHistoryEquivalence.test.ts`.
//
// Fixture names are deliberately fake: this repository is public.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { historyForRequest } from "@/app/components/admin/plannerModel";
import { indexUniqueByKey } from "@/app/utils/serviceReadSelect";
import {
  DERIVED_HISTORY_ROLE_KEYS,
  deriveSolverHistory,
  historyWindow,
  indexMembersById,
  roleSeatContributions,
  type SolverHistoryMember,
} from "@/app/utils/solverHistory";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const ANA = { _id: "m-ana", member_name: "Ana Prueba" };
const BETO = { _id: "m-beto", member_name: "Beto Ensayo" };
const CARO = { _id: "m-caro", member_name: "Caro Muestra" };
const DANI = { _id: "m-dani", member_name: "Dani Ficticio" };
const MEMBERS: SolverHistoryMember[] = [ANA, BETO, CARO, DANI];

let keySeq = 0;
const ref = (id: string) => ({ _key: `k${++keySeq}`, _type: "reference", _ref: id });
const slot = (id: string, label: string, type: "instrument_slot" | "foh_slot") => ({
  _key: `k${++keySeq}`,
  _type: type,
  ...(type === "instrument_slot" ? { instrument: label } : { role: label }),
  person: { _type: "reference", _ref: id },
});

interface RowInput {
  _id: string;
  _type?: string;
  week?: string | null;
  date?: string | null;
  published?: boolean | null;
  Lead?: string[];
  BGVs?: string[];
  Chorus?: string[];
  instruments?: string[];
  foh?: string[];
}

/** A row shaped like `ROLE_PROJECTION` returns it: every projected field present, `null` when unset. */
function row(input: RowInput): Record<string, unknown> {
  const type = input._type ?? "sunday_role";
  return {
    _id: input._id,
    _rev: `rev-${input._id}`,
    _type: type,
    published: input.published === undefined ? false : input.published,
    week: input.week ?? null,
    date: input.date ?? null,
    service_name: type === "special_role" ? "Servicio de prueba" : null,
    time: null,
    format: null,
    creationReceiptId: null,
    creationFingerprint: null,
    Lead: (input.Lead ?? []).map(ref),
    BGVs: (input.BGVs ?? []).map(ref),
    Chorus: (input.Chorus ?? []).map(ref),
    instruments: (input.instruments ?? []).map((id) => slot(id, "Bajo", "instrument_slot")),
    foh_team: (input.foh ?? []).map((id) => slot(id, "Audio", "foh_slot")),
    songs: null,
  };
}

const NOV_2026 = { year: 2026, month: 11 };

// ─── historyWindow ───────────────────────────────────────────────────────────

describe("historyWindow", () => {
  it("November 2026 gives August, September, October — oldest first, unpadded keys", () => {
    expect(historyWindow(NOV_2026)).toEqual([
      { key: "2026-8", year: 2026, month: 8 },
      { key: "2026-9", year: 2026, month: 9 },
      { key: "2026-10", year: 2026, month: 10 },
    ]);
  });

  it("January 2027 gives October, November, December 2026", () => {
    expect(historyWindow({ year: 2027, month: 1 })).toEqual([
      { key: "2026-10", year: 2026, month: 10 },
      { key: "2026-11", year: 2026, month: 11 },
      { key: "2026-12", year: 2026, month: 12 },
    ]);
  });

  it("borrows a year in the middle of the window (March 2027)", () => {
    expect(historyWindow({ year: 2027, month: 3 }).map((m) => m.key)).toEqual([
      "2026-12",
      "2027-1",
      "2027-2",
    ]);
  });

  it("refuses a target that is not a real month rather than inventing one", () => {
    for (const bad of [
      { year: 2026, month: 0 },
      { year: 2026, month: 13 },
      { year: 2026, month: 1.5 },
      { year: Number.NaN, month: 5 },
      { year: 2026.5, month: 5 },
    ]) {
      expect(() => historyWindow(bad)).toThrow(RangeError);
    }
  });
});

// ─── DERIVED_HISTORY_ROLE_KEYS ───────────────────────────────────────────────

describe("DERIVED_HISTORY_ROLE_KEYS", () => {
  it("maps the stored seat paths to the solver's role keys, with no Saturday Chorus and no special entry", () => {
    expect(DERIVED_HISTORY_ROLE_KEYS).toEqual({
      sunday_role: { Lead: "Sun.Lead", BGVs: "Sun.BGV", Chorus: "Sun.Choir" },
      saturday_role: { Lead: "Sat.Lead", BGVs: "Sat.BGV", Chorus: null },
    });
    expect("special_role" in DERIVED_HISTORY_ROLE_KEYS).toBe(false);
  });
});

// ─── roleSeatContributions (the ONE per-document counter) ────────────────────

describe("roleSeatContributions", () => {
  const byId = indexMembersById(MEMBERS);

  it("counts every stored occurrence of a counted seat, keyed by current member_name", () => {
    const c = roleSeatContributions(
      row({ _id: "r1", week: "2026-09-06", Lead: ["m-ana"], BGVs: ["m-beto", "m-beto"], Chorus: ["m-ana"] }),
      byId,
    );
    expect(c.role_counts).toEqual({
      "Ana Prueba": { "Sun.Lead": 1, "Sun.Choir": 1 },
      "Beto Ensayo": { "Sun.BGV": 2 },
    });
    expect(c.dangling).toEqual([]);
    expect(c.unnamedMemberIds).toEqual([]);
  });

  it("returns nothing for a special, and for a type it does not know", () => {
    const empty = { role_counts: {}, dangling: [], unnamedMemberIds: [] };
    expect(
      roleSeatContributions(row({ _id: "s1", _type: "special_role", date: "2026-09-10", Lead: ["m-ana"] }), byId),
    ).toEqual(empty);
    expect(roleSeatContributions(row({ _id: "x1", _type: "constructor", week: "2026-09-06", Lead: ["m-ana"] }), byId)).toEqual(
      empty,
    );
    expect(roleSeatContributions(null, byId)).toEqual(empty);
  });

  it("reports a dangling reference with its seat path, and an unnamed member once", () => {
    const withUnnamed = indexMembersById([...MEMBERS, { _id: "m-nameless", member_name: "" }]);
    const c = roleSeatContributions(
      row({ _id: "r1", week: "2026-09-06", Lead: ["m-ghost"], BGVs: ["m-nameless"], Chorus: ["m-nameless", "m-caro"] }),
      withUnnamed,
    );
    expect(c.role_counts).toEqual({ "Caro Muestra": { "Sun.Choir": 1 } });
    expect(c.dangling).toEqual([{ path: "Lead", memberId: "m-ghost" }]);
    expect(c.unnamedMemberIds).toEqual(["m-nameless"]);
  });

  it("skips a seat item with no usable reference, and a seat field that is not an array", () => {
    const doc = {
      ...row({ _id: "r1", week: "2026-09-06", BGVs: ["m-beto"] }),
      Lead: [{ _key: "a", _type: "reference" }, { _key: "b", _type: "reference", _ref: null }, "m-ana", null],
      Chorus: null,
    };
    const c = roleSeatContributions(doc, byId);
    expect(c.role_counts).toEqual({ "Beto Ensayo": { "Sun.BGV": 1 } });
    expect(c.dangling).toEqual([]);
  });
});

// ─── deriveSolverHistory ─────────────────────────────────────────────────────

describe("deriveSolverHistory — R1 (only weekend roles count)", () => {
  it("a special in the window changes nothing, and ignoring it is not reported", () => {
    const weekend = [row({ _id: "r1", week: "2026-09-06", Lead: ["m-ana"] })];
    const special = row({
      _id: "s1",
      _type: "special_role",
      date: "2026-09-12",
      week: "2026-09-12", // even a malformed special carrying `week` is excluded by type
      Lead: ["m-beto"],
      BGVs: ["m-ghost"],
    });
    const without = deriveSolverHistory({ target: NOV_2026, roles: weekend, members: MEMBERS });
    const withSpecial = deriveSolverHistory({ target: NOV_2026, roles: [...weekend, special], members: MEMBERS });
    expect(withSpecial).toEqual(without);
  });
});

describe("deriveSolverHistory — R2 (stored state at derivation time)", () => {
  it("a swapped month derives the post-swap counts", () => {
    const created = row({ _id: "r1", week: "2026-09-06", Lead: ["m-ana"], BGVs: ["m-beto"] });
    // A swap patches one seat item's `_ref` in place (roleWriteRequest.seatPersonPatchPath).
    const swapped = { ...created, Lead: [{ ...(created.Lead as { _ref: string }[])[0], _ref: "m-caro" }] };
    const { entries } = deriveSolverHistory({ target: NOV_2026, roles: [swapped], members: MEMBERS });
    expect(entries[1].role_counts).toEqual({
      "Caro Muestra": { "Sun.Lead": 1 },
      "Beto Ensayo": { "Sun.BGV": 1 },
    });
    expect(entries[1].role_counts["Ana Prueba"]).toBeUndefined();
  });
});

describe("deriveSolverHistory — R3 (drafts count in full)", () => {
  it("an all-draft month — published false, and published absent — counts exactly as a published one", () => {
    const seats = { Lead: ["m-ana"], BGVs: ["m-beto"], Chorus: ["m-caro"] };
    const month = (published: boolean | null) => [
      row({ _id: "r1", week: "2026-09-06", published, ...seats }),
      row({ _id: "r2", _type: "saturday_role", week: "2026-09-12", published, Lead: ["m-dani"] }),
    ];
    const published = deriveSolverHistory({ target: NOV_2026, roles: month(true), members: MEMBERS });
    const drafts = deriveSolverHistory({ target: NOV_2026, roles: month(false), members: MEMBERS });
    const legacy = month(null).map((r) => {
      const copy = { ...r };
      delete copy.published;
      return copy;
    });
    const absent = deriveSolverHistory({ target: NOV_2026, roles: legacy, members: MEMBERS });
    expect(drafts).toEqual(published);
    expect(absent).toEqual(published);
    expect(published.entries[1].total_counts).toEqual({
      "Ana Prueba": 1,
      "Beto Ensayo": 1,
      "Caro Muestra": 1,
      "Dani Ficticio": 1,
    });
  });

  it("never reads `published` (the field is not named in the module)", () => {
    const source = readFileSync(resolve(__dirname, "../solverHistory.ts"), "utf8");
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(code).not.toMatch(/\bpublished\b/);
  });
});

describe("deriveSolverHistory — R4 (the three calendar months before the target)", () => {
  it("solving November yields August, September, October in order; an empty month is present and empty", () => {
    const roles = [
      row({ _id: "aug", week: "2026-08-02", Lead: ["m-ana"] }),
      row({ _id: "oct", week: "2026-10-04", Lead: ["m-beto"] }),
    ];
    const { entries, months } = deriveSolverHistory({ target: NOV_2026, roles, members: MEMBERS });
    expect(entries.map((e) => e.key)).toEqual(["2026-8", "2026-9", "2026-10"]);
    expect(entries[1]).toEqual({ key: "2026-9", year: 2026, month: 9, total_counts: {}, role_counts: {} });
    expect(months).toEqual([
      { key: "2026-8", year: 2026, month: 8, services: 1 },
      { key: "2026-9", year: 2026, month: 9, services: 0 },
      { key: "2026-10", year: 2026, month: 10, services: 1 },
    ]);
  });

  it("solving January yields October, November, December of the previous year", () => {
    const roles = [row({ _id: "dec", week: "2026-12-06", Lead: ["m-ana"] })];
    const { entries } = deriveSolverHistory({ target: { year: 2027, month: 1 }, roles, members: MEMBERS });
    expect(entries.map((e) => [e.year, e.month])).toEqual([
      [2026, 10],
      [2026, 11],
      [2026, 12],
    ]);
    expect(entries[2].total_counts).toEqual({ "Ana Prueba": 1 });
  });

  it("a role in the target month or later, or before the window, is ignored", () => {
    const roles = [
      row({ _id: "jul", week: "2026-07-26", Lead: ["m-ana"] }),
      row({ _id: "nov", week: "2026-11-01", Lead: ["m-ana"] }),
      row({ _id: "nov-sat", _type: "saturday_role", week: "2026-11-28", Lead: ["m-ana"] }),
      row({ _id: "dec", week: "2026-12-06", Lead: ["m-ana"] }),
      row({ _id: "next-year", week: "2027-09-05", Lead: ["m-ana"] }),
    ];
    const { entries, months } = deriveSolverHistory({ target: NOV_2026, roles, members: MEMBERS });
    for (const e of entries) {
      expect(e.total_counts).toEqual({});
      expect(e.role_counts).toEqual({});
    }
    expect(months.map((m) => m.services)).toEqual([0, 0, 0]);
  });

  it("a role with no valid `week` has no month and is ignored", () => {
    const roles = [
      row({ _id: "none", week: null, Lead: ["m-ana"] }),
      row({ _id: "bad", week: "2026-09-31", Lead: ["m-ana"] }),
    ];
    const { entries } = deriveSolverHistory({ target: NOV_2026, roles, members: MEMBERS });
    expect(entries.every((e) => Object.keys(e.total_counts).length === 0)).toBe(true);
  });

  it("a `drafts.*` overlay is ignored, and does not make its published twin a duplicate target", () => {
    const roles = [
      row({ _id: "r1", week: "2026-09-06", Lead: ["m-ana"] }),
      row({ _id: "drafts.r1", week: "2026-09-06", Lead: ["m-beto"] }),
      row({ _id: "drafts.r9", week: "2026-09-13", Lead: ["m-caro"] }),
    ];
    const { entries, diagnostics } = deriveSolverHistory({ target: NOV_2026, roles, members: MEMBERS });
    expect(entries[1].role_counts).toEqual({ "Ana Prueba": { "Sun.Lead": 1 } });
    expect(diagnostics.duplicateTargets).toEqual([]);
  });
});

describe("deriveSolverHistory — R5 (month by the service's own stored date)", () => {
  it("a 31 October Saturday counts in October and a 1 November Sunday in November", () => {
    const roles = [
      row({ _id: "sat", _type: "saturday_role", week: "2026-10-31", Lead: ["m-ana"] }),
      row({ _id: "sun", week: "2026-11-01", Lead: ["m-beto"] }),
    ];
    const { entries } = deriveSolverHistory({ target: { year: 2026, month: 12 }, roles, members: MEMBERS });
    expect(entries.map((e) => e.key)).toEqual(["2026-9", "2026-10", "2026-11"]);
    expect(entries[1].role_counts).toEqual({ "Ana Prueba": { "Sat.Lead": 1 } });
    expect(entries[2].role_counts).toEqual({ "Beto Ensayo": { "Sun.Lead": 1 } });
  });
});

describe("deriveSolverHistory — R6 (counting rules unchanged)", () => {
  const roles = [
    row({
      _id: "sun1",
      week: "2026-09-06",
      Lead: ["m-ana"],
      BGVs: ["m-beto"],
      Chorus: ["m-caro"],
      instruments: ["m-dani"],
      foh: ["m-dani"],
    }),
    row({ _id: "sun2", week: "2026-09-13", Lead: ["m-ana"], Chorus: ["m-beto"] }),
    row({ _id: "sat1", _type: "saturday_role", week: "2026-09-12", Lead: ["m-beto"], BGVs: ["m-ana"], Chorus: ["m-caro"] }),
  ];
  const { entries } = deriveSolverHistory({ target: NOV_2026, roles, members: MEMBERS });
  const sep = entries[1];

  it("uses the solver's role keys; Saturday Chorus is ignored", () => {
    expect(sep.role_counts).toEqual({
      "Ana Prueba": { "Sun.Lead": 2, "Sat.BGV": 1 },
      "Beto Ensayo": { "Sun.BGV": 1, "Sun.Choir": 1, "Sat.Lead": 1 },
      "Caro Muestra": { "Sun.Choir": 1 },
    });
    expect(Object.values(sep.role_counts).some((c) => "Sat.Choir" in c)).toBe(false);
  });

  it("instruments and FOH never count, so a member seated only there is omitted (zero seats)", () => {
    expect(sep.role_counts["Dani Ficticio"]).toBeUndefined();
    expect(sep.total_counts["Dani Ficticio"]).toBeUndefined();
  });

  it("total_counts is the per-member sum of role_counts", () => {
    expect(sep.total_counts).toEqual({ "Ana Prueba": 3, "Beto Ensayo": 3, "Caro Muestra": 1 });
    for (const [name, counts] of Object.entries(sep.role_counts)) {
      expect(sep.total_counts[name]).toBe(Object.values(counts).reduce((a, b) => a + b, 0));
    }
  });

  it("the key is `${year}-${month}`, unpadded", () => {
    expect(sep.key).toBe("2026-9");
    expect(sep.year).toBe(2026);
    expect(sep.month).toBe(9);
  });
});

describe("deriveSolverHistory — R7 (identity)", () => {
  it("a renamed member's past seats count under the current name", () => {
    const roles = [row({ _id: "r1", week: "2026-09-06", Lead: ["m-ana"] })];
    const renamed = [{ _id: "m-ana", member_name: "Ana Renombrada" }, BETO];
    const { entries } = deriveSolverHistory({ target: NOV_2026, roles, members: renamed });
    expect(entries[1].role_counts).toEqual({ "Ana Renombrada": { "Sun.Lead": 1 } });
  });

  it("a dangling reference is reported and never counted — no raw-id fallback", () => {
    // Only seats that COUNT can drop anything: a dangling instrument, FOH or
    // Saturday Chorus seat changes no count, so it is not reported.
    const roles = [
      row({ _id: "r2", week: "2026-10-04", BGVs: ["m-ghost"], Lead: ["m-ana"], instruments: ["m-ghost3"], foh: ["m-ghost4"] }),
      row({ _id: "r1", _type: "saturday_role", week: "2026-09-12", Lead: ["m-ghost"], Chorus: ["m-ghost2"] }),
    ];
    const { entries, diagnostics } = deriveSolverHistory({ target: NOV_2026, roles, members: MEMBERS });
    expect(diagnostics.danglingSeats).toEqual([
      { roleId: "r1", day: "2026-09-12", path: "Lead", memberId: "m-ghost" },
      { roleId: "r2", day: "2026-10-04", path: "BGVs", memberId: "m-ghost" },
    ]);
    for (const e of entries) {
      expect(e.role_counts["m-ghost"]).toBeUndefined();
      expect(e.role_counts["m-ghost2"]).toBeUndefined();
    }
    expect(entries[2].role_counts).toEqual({ "Ana Prueba": { "Sun.Lead": 1 } });
  });

  it("two members sharing a name are reported when one of them is seated, and their counts merge", () => {
    const twins = [...MEMBERS, { _id: "m-ana-2", member_name: "Ana Prueba" }];
    const roles = [
      row({ _id: "r1", week: "2026-09-06", Lead: ["m-ana"] }),
      row({ _id: "r2", week: "2026-09-13", BGVs: ["m-ana-2"] }),
    ];
    const { entries, diagnostics } = deriveSolverHistory({ target: NOV_2026, roles, members: twins });
    expect(diagnostics.duplicateNames).toEqual([{ name: "Ana Prueba", memberIds: ["m-ana", "m-ana-2"] }]);
    expect(entries[1].role_counts).toEqual({ "Ana Prueba": { "Sun.Lead": 1, "Sun.BGV": 1 } });
    expect(entries[1].total_counts).toEqual({ "Ana Prueba": 2 });
  });

  it("two members sharing a name are NOT reported when neither is seated in the window", () => {
    const twins = [...MEMBERS, { _id: "m-beto-2", member_name: "Beto Ensayo" }];
    const roles = [
      row({ _id: "r1", week: "2026-09-06", Lead: ["m-ana"], instruments: ["m-beto"] }),
      row({ _id: "late", week: "2026-11-01", Lead: ["m-beto"] }),
    ];
    const { diagnostics } = deriveSolverHistory({ target: NOV_2026, roles, members: twins });
    expect(diagnostics.duplicateNames).toEqual([]);
  });

  it("duplicate targets are counted by neither copy and reported; another day still counts", () => {
    const roles = [
      row({ _id: "r-b", week: "2026-09-06", Lead: ["m-ana"], BGVs: ["m-ghost"] }),
      row({ _id: "r-a", week: "2026-09-06", Lead: ["m-beto"] }),
      row({ _id: "r-c", _type: "saturday_role", week: "2026-09-06", Lead: ["m-caro"] }),
      row({ _id: "r-d", week: "2026-09-13", Lead: ["m-dani"] }),
    ];
    const { entries, months, diagnostics } = deriveSolverHistory({ target: NOV_2026, roles, members: MEMBERS });
    expect(diagnostics.duplicateTargets).toEqual([{ type: "sunday_role", day: "2026-09-06", roleIds: ["r-a", "r-b"] }]);
    // A different TYPE on the same day is a different target.
    expect(entries[1].role_counts).toEqual({
      "Caro Muestra": { "Sat.Lead": 1 },
      "Dani Ficticio": { "Sun.Lead": 1 },
    });
    // The dropped copies feed no identity diagnostic and no service count.
    expect(diagnostics.danglingSeats).toEqual([]);
    expect(months[1].services).toBe(2);
  });

  it("agrees with the read model's `indexUniqueByKey` on which targets are ambiguous", () => {
    const roles = [
      row({ _id: "a1", week: "2026-09-06" }),
      row({ _id: "a2", week: "2026-09-06" }),
      row({ _id: "a3", week: "2026-09-06" }),
      row({ _id: "b1", _type: "saturday_role", week: "2026-09-12" }),
      row({ _id: "b2", _type: "saturday_role", week: "2026-09-12" }),
      row({ _id: "c1", week: "2026-09-13" }),
      row({ _id: "c2", _type: "saturday_role", week: "2026-09-13" }),
    ];
    const keyOf = (r: Record<string, unknown>) => `${r._type}:${r.week}`;
    const unique = indexUniqueByKey(roles, keyOf);
    const { diagnostics, months } = deriveSolverHistory({ target: NOV_2026, roles, members: MEMBERS });
    const ambiguous = new Set(diagnostics.duplicateTargets.map((d) => `${d.type}:${d.day}`));
    for (const r of roles) expect(unique.has(keyOf(r))).toBe(!ambiguous.has(keyOf(r)));
    expect(diagnostics.duplicateTargets.map((d) => d.roleIds)).toEqual([["a1", "a2", "a3"], ["b1", "b2"]]);
    expect(months[1].services).toBe(unique.size);
  });

  it("a seated member with no usable member_name is reported and not counted; an unseated one is not reported", () => {
    const members = [
      ...MEMBERS,
      { _id: "m-empty", member_name: "" },
      { _id: "m-null", member_name: null },
      { _id: "m-absent" },
      { _id: "m-unseated", member_name: null },
    ];
    const roles = [
      row({ _id: "r1", week: "2026-09-06", Lead: ["m-empty"], BGVs: ["m-null", "m-null"], Chorus: ["m-absent", "m-caro"] }),
      row({ _id: "r2", week: "2026-09-13", instruments: ["m-unseated"] }),
    ];
    const { entries, diagnostics } = deriveSolverHistory({ target: NOV_2026, roles, members });
    expect(diagnostics.unnamedMembers).toEqual([{ memberId: "m-absent" }, { memberId: "m-empty" }, { memberId: "m-null" }]);
    expect(entries[1].role_counts).toEqual({ "Caro Muestra": { "Sun.Choir": 1 } });
    expect(entries[1].role_counts[""]).toBeUndefined();
  });

  it("a member_name of `__proto__` is an ordinary key, not a prototype write", () => {
    const members = [{ _id: "m-odd", member_name: "__proto__" }];
    const roles = [row({ _id: "r1", week: "2026-09-06", Lead: ["m-odd"] })];
    const { entries } = deriveSolverHistory({ target: NOV_2026, roles, members });
    expect(Object.keys(entries[1].role_counts)).toEqual(["__proto__"]);
    expect(Object.getOwnPropertyDescriptor(entries[1].total_counts, "__proto__")?.value).toBe(1);
    expect(({} as Record<string, unknown>)["Sun.Lead"]).toBeUndefined();
  });
});

describe("deriveSolverHistory — determinism", () => {
  it("shuffled roles and members give byte-identical output", () => {
    const members = [...MEMBERS, { _id: "m-ana-2", member_name: "Ana Prueba" }, { _id: "m-empty", member_name: "" }];
    const roles = [
      row({ _id: "r1", week: "2026-08-02", Lead: ["m-ana"], BGVs: ["m-beto", "m-caro"], Chorus: ["m-dani"] }),
      row({ _id: "r2", _type: "saturday_role", week: "2026-08-08", Lead: ["m-dani"], BGVs: ["m-ana-2"] }),
      row({ _id: "r3", week: "2026-09-13", Lead: ["m-caro"], BGVs: ["m-ghost"], Chorus: ["m-empty"] }),
      row({ _id: "r4", week: "2026-09-06", Lead: ["m-beto"] }),
      row({ _id: "r5", week: "2026-09-06", Lead: ["m-ana"] }),
      row({ _id: "r6", week: "2026-10-04", Lead: ["m-beto"], Chorus: ["m-ghost-2", "m-ana"] }),
      row({ _id: "r7", _type: "saturday_role", week: "2026-10-03", BGVs: ["m-caro"] }),
      row({ _id: "s1", _type: "special_role", date: "2026-10-10", Lead: ["m-ana"] }),
    ];
    const base = deriveSolverHistory({ target: NOV_2026, roles, members });
    const reversed = deriveSolverHistory({
      target: NOV_2026,
      roles: [...roles].reverse(),
      members: [...members].reverse(),
    });
    const rotated = deriveSolverHistory({
      target: NOV_2026,
      roles: [...roles.slice(3), ...roles.slice(0, 3)],
      members: [...members.slice(2), ...members.slice(0, 2)],
    });
    expect(JSON.stringify(reversed)).toBe(JSON.stringify(base));
    expect(JSON.stringify(rotated)).toBe(JSON.stringify(base));
    // The fixture really exercises every diagnostic, so the equality above is not vacuous.
    expect(base.diagnostics.duplicateTargets).toHaveLength(1);
    expect(base.diagnostics.danglingSeats).toHaveLength(2);
    expect(base.diagnostics.unnamedMembers).toEqual([{ memberId: "m-empty" }]);
    expect(base.diagnostics.duplicateNames).toHaveLength(1);
  });
});

describe("deriveSolverHistory — the request passes through", () => {
  it("historyForRequest(entries, year, month) returns the derived entries unchanged, so buildSolveRequest sends them as-is", () => {
    const roles = [
      row({ _id: "r1", week: "2026-08-02", Lead: ["m-ana"] }),
      row({ _id: "r2", week: "2026-10-04", BGVs: ["m-beto"] }),
    ];
    const { entries } = deriveSolverHistory({ target: NOV_2026, roles, members: MEMBERS });
    expect(historyForRequest(entries, NOV_2026.year, NOV_2026.month)).toEqual(entries);
  });
});

describe("solverHistory.ts stays a neutral module (ADR-0028; ruling P2-R2)", () => {
  it("imports no server-only, Sanity, node or writer module, and plannerModel only as a type", () => {
    const source = readFileSync(resolve(__dirname, "../solverHistory.ts"), "utf8");
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    const specifiers = [
      ...[...code.matchAll(/\bfrom\s+["']([^"']+)["']/g)].map((m) => m[1]),
      ...[...code.matchAll(/^\s*import\s+["']([^"']+)["']/gm)].map((m) => m[1]),
    ];
    expect(specifiers.length).toBeGreaterThan(0);
    for (const spec of specifiers) {
      expect(spec).not.toMatch(/server-only|sanity|^node:|roleWriteRequest|roleCreationReceipt/);
    }
    expect(code).not.toMatch(/\brequire\(|\bimport\(/);
    const plannerImports = [...code.matchAll(/^\s*import\s+([^;]*?)from\s+["'][^"']*plannerModel["']/gm)];
    expect(plannerImports.length).toBe(1);
    expect(plannerImports[0][1].trim()).toMatch(/^type\s/);
  });
});
