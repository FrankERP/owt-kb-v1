import { describe, expect, it } from "vitest";
import { NOTIFY_PREF_FIELD, wantsNotification } from "../notifyPrefs";

describe("wantsNotification", () => {
  it("defaults to true when nothing is set", () => {
    expect(wantsNotification({}, "assigned")).toBe(true);
    expect(wantsNotification(undefined, "setlist")).toBe(true);
  });

  it("uses the specific field when it is a boolean", () => {
    expect(wantsNotification({ emailAssigned: false }, "assigned")).toBe(false);
    expect(wantsNotification({ emailAssigned: true, email: false }, "assigned")).toBe(true);
  });

  it("falls back to the legacy email field when the specific one is unset", () => {
    // A member who opted out before per-type toggles existed stays opted out of
    // all five. Nobody starts receiving mail they had switched off.
    for (const kind of ["assigned", "removed", "roleChanged", "setlist", "proposals"] as const) {
      expect(wantsNotification({ email: false }, kind)).toBe(false);
      expect(wantsNotification({ email: true }, kind)).toBe(true);
    }
  });

  it("treats a non-boolean specific field as unset", () => {
    expect(wantsNotification({ emailSetlist: "yes", email: false }, "setlist")).toBe(false);
  });

  it("maps every kind to its stored field name", () => {
    expect(NOTIFY_PREF_FIELD).toEqual({
      assigned: "emailAssigned",
      removed: "emailRemoved",
      roleChanged: "emailRoleChanged",
      setlist: "emailSetlist",
      proposals: "emailProposals",
    });
  });
});
