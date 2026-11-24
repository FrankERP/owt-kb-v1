// D6 and D12: a person's name and the rules that name them by text (slice M, §7.1).

import { describe, expect, it } from "vitest";

import { nameTakenBy, namesChanged, orphanRuleWarnings, planRuleRename, type RosterRow } from "../memberRuleRename";

function restriction(key: string, person: string, extra: Record<string, unknown> = {}) {
  return { _type: "solverRestriction", _key: key, id: key, person, excludedPatterns: ["Sat.*"], fairness: "none", fairnessSlack: 1, weekExclusions: [], caps: [], ...extra };
}

const roster: RosterRow[] = [
  { _id: "vale", member_name: "Valentina Sosa", alias: "Vale" },
  { _id: "pau", member_name: "Paula Ríos", alias: "Pau" },
  { _id: "tony", member_name: "Antonio", alias: "Tony" },
];

function rules(extra: Record<string, unknown> = {}) {
  return {
    _id: "solverConfig",
    _rev: "rules-1",
    sundayLeads: ["vale"],
    restrictions: [restriction("r1", "Vale"), restriction("r2", "Pau")],
    conflicts: [{ _type: "solverConflict", _key: "c1", id: "c1", personA: "Pau", personB: "Vale", pattern: "Sun.*" }],
    presence: [{ _type: "solverPresence", _key: "p1", id: "p1", persons: ["Tony", "Vale"], pattern: "Sun.BGV" }],
    ...extra,
  };
}

const vale = { member_name: "Valentina Sosa", alias: "Vale" };

describe("planRuleRename (D6)", () => {
  it("renames exactly the person paths that would stop matching, in the raw document", () => {
    const plan = planRuleRename({ rulesDoc: rules(), roster, selfId: "vale", before: vale, after: { ...vale, alias: "Valeria" } });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.sets).toEqual({
      'restrictions[_key=="r1"].person': "Valeria",
      'conflicts[_key=="c1"].personB': "Valeria",
      'presence[_key=="p1"].persons': ["Tony", "Valeria"],
    });
    expect(plan.renamed).toBe(3);
    expect(plan.lines[0]).toMatch(/^Regla: «Vale: .*» → «Valeria: /);
  });

  it("a text that still names the person (their unchanged name) is left alone", () => {
    const doc = rules({ restrictions: [restriction("r1", "Valentina Sosa")], conflicts: [], presence: [] });
    const plan = planRuleRename({ rulesDoc: doc, roster, selfId: "vale", before: vale, after: { ...vale, alias: "Valeria" } });
    expect(plan.ok && plan.renamed).toBe(0);
  });

  it("an unknown fairness, an unknown cadence and an extra field never enter the patch", () => {
    const doc = rules({ restrictions: [restriction("r1", "Vale", { fairness: "future", sundayCadence: "weird", extra: 1 })], conflicts: [], presence: [] });
    const plan = planRuleRename({ rulesDoc: doc, roster, selfId: "vale", before: vale, after: { ...vale, alias: "Valeria" } });
    expect(plan.ok).toBe(true);
    if (plan.ok) expect(plan.sets).toEqual({ 'restrictions[_key=="r1"].person': "Valeria" });
  });

  it("a text that also names another member is left and reported", () => {
    const withTwin: RosterRow[] = [...roster, { _id: "vale2", member_name: "Vale" }];
    const plan = planRuleRename({ rulesDoc: rules(), roster: withTwin, selfId: "vale", before: vale, after: { ...vale, alias: "Valeria" } });
    expect(plan.ok).toBe(true);
    if (plan.ok) {
      expect(plan.renamed).toBe(0);
      expect(plan.ambiguous).toEqual(["Vale"]);
    }
  });

  it("refuses a keyless item, and a raw value written differently from how it reads", () => {
    const keyless = rules({ restrictions: [{ ...restriction("r1", "Vale"), _key: undefined }], conflicts: [], presence: [] });
    const a = planRuleRename({ rulesDoc: keyless, roster, selfId: "vale", before: vale, after: { ...vale, alias: "Valeria" } });
    expect(!a.ok && a.reason).toBe("keyless");
    const spaced = rules({ restrictions: [restriction("r1", " Vale ")], conflicts: [], presence: [] });
    const b = planRuleRename({ rulesDoc: spaced, roster, selfId: "vale", before: vale, after: { ...vale, alias: "Valeria" } });
    expect(!b.ok && b.reason).toBe("raw_mismatch");
  });

  it("writes the reader's own normalization of the new display name (§7.1)", () => {
    const plan = planRuleRename({ rulesDoc: rules(), roster, selfId: "vale", before: vale, after: { ...vale, alias: " Valeria " } });
    expect(plan.ok && plan.sets['restrictions[_key=="r1"].person']).toBe("Valeria");
  });

  it("refuses a rename that raises a NEW parse issue (two exact caps converging), not a pre-existing one", () => {
    const cap = (id: string) => ({ _type: "solverCap", _key: id, id, pattern: "Sun.Lead", op: "==", value: 1, relative: false, relOffset: 0 });
    const doc = rules({
      restrictions: [restriction("r1", "Vale", { caps: [cap("k1")] }), restriction("r2", "Valentina Sosa", { caps: [cap("k2")] })],
      conflicts: [],
      presence: [],
    });
    // Renaming the alias to the name makes «Vale» become «Valentina Sosa»: two exact caps on one person.
    const plan = planRuleRename({ rulesDoc: doc, roster, selfId: "vale", before: vale, after: { member_name: "Valentina Sosa", alias: "" } });
    expect(!plan.ok && plan.reason).toBe("new_issue");
  });

  it("a NEW overlap is refused even when the stored rules already carry an unrelated item issue", () => {
    const cap = (id: string) => ({ _type: "solverCap", _key: id, id, pattern: "Sun.Lead", op: "==", value: 1, relative: false, relOffset: 0 });
    const doc = rules({
      restrictions: [
        restriction("r1", "Vale", { caps: [cap("k1")] }),
        restriction("r2", "Valentina Sosa", { caps: [cap("k2")] }),
        restriction("r3", "Pau", { weekExclusions: [{ _type: "solverWeekExclusion", _key: "w1", id: "w1", week: 1.5, pattern: "Sun.*" }] }),
      ],
      conflicts: [],
      presence: [],
    });
    const plan = planRuleRename({ rulesDoc: doc, roster, selfId: "vale", before: vale, after: { member_name: "Valentina Sosa", alias: "" } });
    expect(!plan.ok && plan.reason).toBe("new_issue");
  });

  it("no rules document, or no name change → nothing to write", () => {
    expect(planRuleRename({ rulesDoc: null, roster, selfId: "vale", before: vale, after: { ...vale, alias: "X" } })).toMatchObject({ ok: true, renamed: 0 });
    expect(planRuleRename({ rulesDoc: rules(), roster, selfId: "vale", before: vale, after: { ...vale, alias: "VALE" } })).toMatchObject({ ok: true, renamed: 0 });
  });
});

describe("D12 helpers", () => {
  it("namesChanged compares as the rule matcher: trimmed, case-insensitive", () => {
    expect(namesChanged(vale, { ...vale, alias: " vale " })).toBe(false);
    expect(namesChanged(vale, { ...vale, alias: "Valeria" })).toBe(true);
  });

  it("nameTakenBy finds another member's name or alias, never the person's own", () => {
    expect(nameTakenBy(roster, "vale", ["pau"])?.other._id).toBe("pau");
    expect(nameTakenBy(roster, "vale", ["Valentina Sosa"])).toBeNull();
    expect(nameTakenBy(roster, null, ["Antonio "])?.other._id).toBe("tony");
  });

  it("orphanRuleWarnings reports a rule text that names nobody and would name the new person", () => {
    const doc = rules({ restrictions: [restriction("r9", "Gaby")], conflicts: [], presence: [] });
    const names = roster.map((r) => ({ member_name: String(r.member_name), alias: r.alias as string }));
    expect(orphanRuleWarnings(doc, names, [{ member_name: "Gabriela", alias: "Gaby" }])).toEqual([
      "Ojo: la regla «Gaby: Nunca en sábado» hoy no nombra a nadie y empezaría a aplicarle.",
    ]);
    expect(orphanRuleWarnings(doc, names, [{ member_name: "Gabriela" }])).toEqual([]);
  });
});
