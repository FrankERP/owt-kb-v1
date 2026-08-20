import { describe, it, expect } from "vitest";
import { MINISTRIES, ALL_MINISTRY_IDS, isMinistryId, normalizeMinistries, validateMinistryWrite } from "@/app/ministries";

describe("ministry registry", () => {
  it("registers worship and kids with Spanish display names", () => {
    expect(MINISTRIES.worship).toEqual({ id: "worship", name: "Alabanza" });
    expect(MINISTRIES.kids).toEqual({ id: "kids", name: "Oasis Kids" });
    expect(ALL_MINISTRY_IDS).toEqual(["worship", "kids"]);
  });
  it("narrows ids", () => {
    expect(isMinistryId("kids")).toBe(true);
    expect(isMinistryId("worship")).toBe(true);
    expect(isMinistryId("youth")).toBe(false);
    expect(isMinistryId(undefined)).toBe(false);
  });
  it("normalizes stored values — the ONE rule every reader shares", () => {
    expect(normalizeMinistries(undefined)).toEqual(["worship"]);   // legacy member
    expect(normalizeMinistries([])).toEqual(["worship"]);          // emptied array
    expect(normalizeMinistries(["kids"])).toEqual(["kids"]);
    expect(normalizeMinistries(["worship", "kids"])).toEqual(["worship", "kids"]);
    expect(normalizeMinistries("worship")).toEqual(["worship"]);   // non-array junk
    expect(normalizeMinistries(["toString"])).toEqual(["worship"]); // unknown ids dropped
  });
  it("REJECTS prototype keys — an `in` check would accept all of these", () => {
    // `"constructor" in MINISTRIES` is true. This function validates an auth
    // field; a member stored as a member of `toString` belongs to nothing.
    for (const key of ["constructor", "toString", "__proto__", "hasOwnProperty", "valueOf"]) {
      expect(isMinistryId(key), `${key} must not validate`).toBe(false);
    }
  });
  it("rejects an explicitly empty ministries array at the write boundary", () => {
    // `[].every(isMinistryId)` is vacuously true, so a naive validator accepts
    // it and normalizeMinistries reads it back as full worship access.
    expect(validateMinistryWrite("ministries", [])).toBe("Elige al menos un ministerio.");
    expect(validateMinistryWrite("ministries", ["kids"])).toBeNull();
    expect(validateMinistryWrite("ministries", ["youth"])).toBe("Invalid ministry");
    expect(validateMinistryWrite("ministries", "kids")).toBe("Invalid ministry");
    // "manages nothing" is a real state — the only way to revoke management.
    expect(validateMinistryWrite("managesMinistries", [])).toBeNull();
    expect(validateMinistryWrite("managesMinistries", ["worship"])).toBe("Invalid ministry");
  });
});
