import { describe, expect, it } from "vitest";
import {
  ROLE_TYPES,
  isValidServiceDate,
  roleTargetKey,
  setlistTargetKey,
  proposalTargetKey,
  validateRole,
} from "@/app/utils/serviceReadModel";

// ── A minimally valid role fixture, overridable per case ─────────────────────
function roleDoc(over: Record<string, unknown> = {}) {
  return {
    _id: "role-1",
    _rev: "rev-1",
    _type: "sunday_role",
    week: "2026-07-26",
    Lead: [{ _key: "k1", _type: "reference", _ref: "m1" }],
    BGVs: [{ _key: "k2", _type: "reference", _ref: "m2" }],
    Chorus: [{ _key: "k3", _type: "reference", _ref: "m3" }],
    instruments: [
      { _key: "k4", _type: "instrument_slot", instrument: "Piano", person: { _type: "reference", _ref: "m4" } },
    ],
    foh_team: [
      { _key: "k5", _type: "foh_slot", role: "Sonido", person: { _type: "reference", _ref: "m5" } },
    ],
    ...over,
  };
}

describe("isValidServiceDate", () => {
  it.each([
    ["2026-07-26", true],
    ["2026-12-01", true],
    ["2026-7-26", false],
    ["2026-13-01", false],
    ["2026-02-30", false],
    ["", false],
    ["not-a-date", false],
    ["2026-07-26T12:00:00", false],
  ])("%s -> %s", (input, expected) => {
    expect(isValidServiceDate(input)).toBe(expected);
  });
});

describe("target key helpers", () => {
  it("weekend role target keys use type:week", () => {
    expect(roleTargetKey(roleDoc({ _type: "sunday_role", week: "2026-07-26" }))).toBe("sunday_role:2026-07-26");
    expect(roleTargetKey(roleDoc({ _type: "saturday_role", week: "2026-07-25" }))).toBe("saturday_role:2026-07-25");
  });

  it("special role target key is its own id", () => {
    expect(roleTargetKey(roleDoc({ _type: "special_role", _id: "sp-9", week: undefined, date: "2026-07-30" }))).toBe("sp-9");
  });

  it("live setlist target keys mirror the setlist doc types", () => {
    expect(setlistTargetKey("sunday_role", "2026-07-26", "role-1")).toBe("featuredSongs:2026-07-26");
    expect(setlistTargetKey("saturday_role", "2026-07-25", "role-1")).toBe("saturdarSongs:2026-07-25");
    expect(setlistTargetKey("special_role", undefined, "sp-9")).toBe("sp-9");
  });

  it("proposal target keys use the service kind and date/ref", () => {
    expect(proposalTargetKey("sunday", "2026-07-26", "role-1")).toBe("sunday:2026-07-26");
    expect(proposalTargetKey("saturday", "2026-07-25", "role-1")).toBe("saturday:2026-07-25");
    expect(proposalTargetKey("special", "2026-07-30", "sp-9")).toBe("special:sp-9");
  });
});

describe("validateRole", () => {
  it("accepts a well-formed weekend role and extracts all five seat paths", () => {
    const r = validateRole(roleDoc());
    expect(r.groupable).toBe(true);
    expect(r.issues).toEqual([]);
    expect(r.targetKey).toBe("sunday_role:2026-07-26");
    expect(new Set(r.assignedRefs)).toEqual(new Set(["m1", "m2", "m3", "m4", "m5"]));
  });

  it("accepts a special role dated by `date`", () => {
    const r = validateRole(roleDoc({ _type: "special_role", _id: "sp-9", week: undefined, date: "2026-07-30" }));
    expect(r.groupable).toBe(true);
    expect(r.targetKey).toBe("sp-9");
  });

  for (const type of ROLE_TYPES) {
    it(`recognizes role type ${type}`, () => {
      const dated = type === "special_role" ? { date: "2026-07-30", week: undefined } : {};
      expect(validateRole(roleDoc({ _type: type, ...dated })).groupable).toBe(true);
    });
  }

  it("rejects an unknown _type", () => {
    const r = validateRole(roleDoc({ _type: "post" }));
    expect(r.groupable).toBe(false);
    expect(r.issues).toContain("type");
  });

  it.each([["_id"], ["_rev"]])("rejects a role missing %s", (field) => {
    const r = validateRole(roleDoc({ [field]: "" }));
    expect(r.groupable).toBe(false);
    expect(r.issues).toContain("identity");
  });

  it("rejects a weekend role with a malformed week", () => {
    const r = validateRole(roleDoc({ week: "2026-7-26" }));
    expect(r.groupable).toBe(false);
    expect(r.issues).toContain("date");
  });

  it("rejects a special role with no date", () => {
    const r = validateRole(roleDoc({ _type: "special_role", _id: "sp-9", week: undefined, date: undefined }));
    expect(r.groupable).toBe(false);
    expect(r.issues).toContain("date");
  });

  it("rejects a non-array seat field", () => {
    const r = validateRole(roleDoc({ Lead: { _ref: "m1" } }));
    expect(r.groupable).toBe(false);
    expect(r.issues).toContain("seat:Lead");
  });

  it("rejects a reference seat item with no _ref", () => {
    const r = validateRole(roleDoc({ BGVs: [{ _key: "k2", _type: "reference", _ref: "" }] }));
    expect(r.groupable).toBe(false);
    expect(r.issues).toContain("seat:BGVs");
  });

  it("rejects an instrument slot missing person._ref", () => {
    const r = validateRole(roleDoc({ instruments: [{ _key: "k4", _type: "instrument_slot", instrument: "Piano", person: { _type: "reference", _ref: "" } }] }));
    expect(r.groupable).toBe(false);
    expect(r.issues).toContain("seat:instruments");
  });

  it("rejects an foh slot missing person._ref", () => {
    const r = validateRole(roleDoc({ foh_team: [{ _key: "k5", _type: "foh_slot", role: "Sonido", person: null }] }));
    expect(r.groupable).toBe(false);
    expect(r.issues).toContain("seat:foh_team");
  });

  it("rejects a seat item with a missing _key", () => {
    const r = validateRole(roleDoc({ Chorus: [{ _type: "reference", _ref: "m3" }] }));
    expect(r.groupable).toBe(false);
    expect(r.issues).toContain("seat:Chorus");
  });

  it("rejects duplicate _keys within a seat array", () => {
    const r = validateRole(roleDoc({ Lead: [
      { _key: "dup", _type: "reference", _ref: "m1" },
      { _key: "dup", _type: "reference", _ref: "m2" },
    ] }));
    expect(r.groupable).toBe(false);
    expect(r.issues).toContain("seat:Lead");
  });

  it("treats missing (undefined) seat arrays as invalid, not empty", () => {
    const base = roleDoc();
    delete (base as Record<string, unknown>).instruments;
    const r = validateRole(base);
    expect(r.groupable).toBe(false);
    expect(r.issues).toContain("seat:instruments");
  });
});
