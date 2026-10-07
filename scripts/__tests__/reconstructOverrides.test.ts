// Solver v3 C4 R8 — Frank's corrections file: schema v1, keyed by member `_id`,
// validated in full; any typo refuses the whole run. Entries are named on stdout by
// their position in the file, never by id (R12). Every name is fictitious.
import { describe, expect, it } from "vitest";

import { outOfRunEntries, parseOverrides } from "../lib/reconstructOverrides";

const ROSTER = new Set(["m-ana", "m-beto", "m-fausto"]);
const parse = (doc: unknown) => parseOverrides(JSON.stringify(doc), ROSTER);
const reasons = (doc: unknown) => {
  const parsed = parse(doc);
  return parsed.ok ? [] : parsed.refusals.map((r) => r.reason);
};
const one = (member: Record<string, unknown>) => ({ schemaVersion: 1, members: { "m-ana": member } });

describe("parsing (R8)", () => {
  it("reads every field and numbers the entries by their position in the file", () => {
    const parsed = parse({
      schemaVersion: 1,
      members: {
        "m-beto": { months: { "2026-08": { exactRules: [{ roles: ["Sat.BGV", "Sun.BGV"], count: 2 }] } } },
        "m-fausto": {
          note: "Cantó en septiembre.",
          exempt: false,
          sundayCadence: "normal",
          joinMonths: { BGV: "2026-09" },
          blockedDates: [{ date: "2026-09-06" }, { date: "2026-09-13", roles: ["Sat.BGV", "Sun.BGV"] }],
          months: { "*": { roles: { "Sun.BGV": "in" } } },
        },
      },
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.overrides.hash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(parsed.overrides.members.map((m) => [m.ordinal, m.memberId])).toEqual([
      [1, "m-beto"],
      [2, "m-fausto"],
    ]);
    expect(parsed.overrides.members[0].months["2026-08"]).toEqual({
      roles: {},
      exactRules: [{ roles: ["Sun.BGV", "Sat.BGV"], count: 2 }],
    });
    expect(parsed.overrides.members[1]).toEqual({
      ordinal: 2,
      memberId: "m-fausto",
      note: "Cantó en septiembre.",
      exempt: false,
      sundayCadence: "normal",
      joinMonths: { BGV: "2026-09" },
      blockedDates: [
        { date: "2026-09-06", roles: null },
        { date: "2026-09-13", roles: ["Sun.BGV", "Sat.BGV"] },
      ],
      months: { "*": { roles: { "Sun.BGV": "in" }, exactRules: [] } },
    });
  });

  it("refuses text that is not JSON", () => {
    const parsed = parseOverrides("{", ROSTER);
    expect(parsed.ok ? [] : parsed.refusals.map((r) => r.reason)).toEqual(["override_json"]);
  });

  it.each<[string, unknown, string]>([
    ["another schema version", { schemaVersion: 2, members: {} }, "override_version"],
    ["an unknown root key", { schemaVersion: 1, members: {}, extra: true }, "override_schema"],
    ["members that is not an object", { schemaVersion: 1, members: [] }, "override_schema"],
    ["an id off the worship roster", { schemaVersion: 1, members: { "m-greta": {} } }, "override_member_unknown"],
    ["an unknown member key", one({ colour: "azul" }), "override_schema"],
    ["a malformed month key", one({ months: { "2026-8": { roles: { "Sun.BGV": "in" } } } }), "override_month"],
    ["«*» beside a named month", one({ months: { "*": { roles: {} }, "2026-08": { roles: {} } } }), "override_scope"],
    ["an unknown role", one({ months: { "2026-08": { roles: { "Sun.Bajo": "in" } } } }), "override_role"],
    ["a status other than in/out", one({ months: { "2026-08": { roles: { "Sun.BGV": "exact" } } } }), "override_status"],
    ["a count of 0", one({ months: { "2026-08": { exactRules: [{ roles: ["Sun.BGV"], count: 0 }] } } }), "override_count"],
    ["a count of 32", one({ months: { "2026-08": { exactRules: [{ roles: ["Sun.BGV"], count: 32 }] } } }), "override_count"],
    ["a fractional count", one({ months: { "2026-08": { exactRules: [{ roles: ["Sun.BGV"], count: 1.5 }] } } }), "override_count"],
    [
      "two of the file's own rules covering one role (A38)",
      one({ months: { "2026-08": { exactRules: [{ roles: ["Sun.BGV", "Sat.BGV"], count: 2 }, { roles: ["Sun.BGV"], count: 1 }] } } }),
      "override_overlap",
    ],
    [
      "a status and an exact rule for one role",
      one({ months: { "2026-08": { roles: { "Sun.BGV": "in" }, exactRules: [{ roles: ["Sun.BGV"], count: 1 }] } } }),
      "override_contradiction",
    ],
    ["an impossible blocked date", one({ blockedDates: [{ date: "2026-09-31" }] }), "override_date"],
    ["an unknown line", one({ joinMonths: { DLX: "2026-09" } }), "override_schema"],
    ["a malformed join month", one({ joinMonths: { BGV: "septiembre" } }), "override_month"],
    ["a non-boolean exempt", one({ exempt: "sí" }), "override_schema"],
    ["an unknown cadence value", one({ sundayCadence: "siempre" }), "override_schema"],
  ])("refuses %s", (_label, doc, reason) => {
    expect(reasons(doc)).toContain(reason);
  });

  it("names a refused entry by its position on stdout and keeps the id for the private report", () => {
    const parsed = parse({ schemaVersion: 1, members: { "m-ana": {}, "m-greta": {} } });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.refusals).toEqual([
      expect.objectContaining({
        reason: "override_member_unknown",
        kind: "corrección",
        rules: [{ ordinal: "entrada 2 del archivo", key: null }],
        memberIds: ["m-greta"],
      }),
    ]);
  });

  it("lists entries for valid months outside the run as «no aplica»", () => {
    const parsed = parse({
      schemaVersion: 1,
      members: {
        "m-ana": { months: { "2026-10": { roles: { "Sat.BGV": "in" } } } },
        "m-beto": { blockedDates: [{ date: "2026-11-01" }, { date: "2026-08-02" }] },
      },
    });
    if (!parsed.ok) throw new Error("expected a valid file");
    expect(outOfRunEntries(parsed.overrides, ["2026-08", "2026-09"])).toEqual([
      { ordinal: 1, memberId: "m-ana", month: "2026-10" },
      { ordinal: 2, memberId: "m-beto", month: "2026-11" },
    ]);
  });
});

describe("duplicate keys (R8: nothing is silently dropped)", () => {
  const dupRefusals = (text: string) => {
    const parsed = parseOverrides(text, ROSTER);
    return parsed.ok ? [] : parsed.refusals.map((r) => [r.reason, r.rules[0]?.ordinal ?? null]);
  };

  it("refuses one member _id named twice, pointing at the repeat's position", () => {
    const text = '{"schemaVersion":1,"members":{"m-ana":{"exempt":true},"m-beto":{},"m-ana":{"note":"x"}}}';
    expect(dupRefusals(text)).toEqual([["override_duplicate", "entrada 3 del archivo"]]);
  });

  it("refuses a repeated month key and a repeated role key inside an entry", () => {
    const month = '{"schemaVersion":1,"members":{"m-ana":{},"m-beto":{"months":{"2026-08":{},"2026-08":{}}}}}';
    expect(dupRefusals(month)).toEqual([["override_duplicate", "entrada 2 del archivo"]]);
    const role = '{"schemaVersion":1,"members":{"m-ana":{"months":{"*":{"roles":{"Sun.BGV":"in","Sun.BGV":"out"}}}}}}';
    expect(dupRefusals(role)).toEqual([["override_duplicate", "entrada 1 del archivo"]]);
  });

  it("refuses a repeated root key without naming an entry", () => {
    expect(dupRefusals('{"schemaVersion":1,"members":{},"members":{}}')).toEqual([["override_duplicate", null]]);
  });

  it("does not mistake equal keys in different objects, string values or escapes for repeats", () => {
    const text = JSON.stringify({
      schemaVersion: 1,
      members: {
        "m-ana": { note: 'a "note": {"x":1,"x":2} \\', months: { "*": { roles: { "Sun.BGV": "in" } } } },
        "m-beto": { months: { "*": { roles: { "Sun.BGV": "out" } } } },
      },
    });
    expect(parseOverrides(text, ROSTER).ok).toBe(true);
  });
});
