// A committed edit returns the stored role at its NEW revision. The panel must
// adopt that revision even when the follow-up reload fails, or it keeps the
// pre-write `_rev` and the operator's very next save is a guaranteed 409 — a
// conflict caused entirely by us, on a card whose data is actually fine.
import { describe, expect, it } from "vitest";

import { applyRefreshedRole, refreshedRoleFromResponse } from "../applyRefreshedRole";

const role = (over: Record<string, unknown> = {}) => ({
  _id: "sunday-role-1",
  _rev: "rev-OLD",
  _type: "sunday_role",
  week: "2026-08-02",
  Lead: [{ _key: "k1", _type: "reference", _ref: "m1" }],
  ...over,
});

describe("refreshedRoleFromResponse", () => {
  it("accepts the committed document the route returns", () => {
    const body = { ...role({ _rev: "rev-NEW" }), ok: true };
    expect(refreshedRoleFromResponse(body)).toMatchObject({ _id: "sunday-role-1", _rev: "rev-NEW" });
  });

  it("rejects a body with no revision — there is nothing to adopt", () => {
    // This is the pre-fix shape: an echo with `ok` but no committed revision.
    expect(refreshedRoleFromResponse({ _id: "sunday-role-1", _type: "sunday_role", ok: true })).toBeNull();
  });

  it("rejects a body with no id", () => {
    expect(refreshedRoleFromResponse({ _rev: "rev-NEW", ok: true })).toBeNull();
  });

  it("rejects a non-object, an array, and null", () => {
    for (const body of [null, undefined, "ok", 7, [role()]]) {
      expect(refreshedRoleFromResponse(body)).toBeNull();
    }
  });

  it("rejects a document whose _type is not a role type", () => {
    expect(refreshedRoleFromResponse({ ...role({ _rev: "r" }), _type: "post" })).toBeNull();
  });
});

describe("applyRefreshedRole", () => {
  it("replaces only the matching role, at the new revision", () => {
    const roles = [role(), role({ _id: "other", _rev: "rev-X" })];
    const next = applyRefreshedRole(roles, { ...role({ _rev: "rev-NEW" }), Lead: [] });
    expect(next[0]).toMatchObject({ _id: "sunday-role-1", _rev: "rev-NEW" });
    expect(next[0].Lead).toEqual([]);
    // The untouched role keeps its identity AND its object reference.
    expect(next[1]).toBe(roles[1]);
  });

  it("returns the SAME array when nothing matches, so React skips a re-render", () => {
    const roles = [role()];
    expect(applyRefreshedRole(roles, role({ _id: "not-present", _rev: "r" }))).toBe(roles);
  });

  it("returns the same array for a null refresh", () => {
    const roles = [role()];
    expect(applyRefreshedRole(roles, null)).toBe(roles);
  });

  it("never invents a role that was not already loaded", () => {
    expect(applyRefreshedRole([], role({ _rev: "rev-NEW" }))).toEqual([]);
  });

  it("adopts the refreshed document wholesale, not a merge", () => {
    // A merge would preserve a seat the commit actually removed, so the card
    // would show an assignment the server no longer has.
    const roles = [role({ Chorus: [{ _key: "c1", _type: "reference", _ref: "m9" }] })];
    const next = applyRefreshedRole(roles, role({ _rev: "rev-NEW" }));
    expect(next[0]).not.toHaveProperty("Chorus");
  });
});
