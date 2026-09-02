import { describe, expect, it } from "vitest";
import { buildVerifierDoc, VERIFIER_ID } from "../lib/dev-verify/seedDoc";

describe("dev-verify seed doc", () => {
  it("builds the spec §3.1 member exactly", () => {
    expect(buildVerifierDoc({ email: "v@example.com", passwordHash: "$2a$10$hash" })).toEqual({
      _id: VERIFIER_ID,
      _type: "teamMembers",
      member_name: "Verificador (bot)",
      alias: "Verificador",
      slug: { _type: "slug", current: "verificador-bot" },
      email: "v@example.com",
      role: "admin",
      ministries: ["worship"],
      managesMinistries: ["kids"],
      retiredFrom: ["worship"],
      notifPrefs: {
        assignments: false,
        email: false,
        emailAssigned: false,
        emailRemoved: false,
        emailRoleChanged: false,
        emailSetlist: false,
        emailProposals: false,
        setlist: "off",
        proposals: false,
        reminders: false,
      },
      passwordHash: "$2a$10$hash",
    });
  });

  it("never sets memberType, disabled, or super-admin", () => {
    const doc = buildVerifierDoc({ email: "v@example.com", passwordHash: "h" }) as unknown as Record<string, unknown>;
    expect(doc.memberType).toBeUndefined();
    expect(doc.disabled).toBeUndefined();
    expect(doc.role).toBe("admin");
  });

  it("uses a deterministic, non-dotted id so re-seeding patches rather than duplicates", () => {
    expect(VERIFIER_ID).toBe("member-dev-verify");
    expect(VERIFIER_ID).not.toContain(".");
  });

  it("is a worship member only: kids reads ignore retiredFrom, so kids membership would seat the bot", () => {
    const doc = buildVerifierDoc({ email: "v@example.com", passwordHash: "h" });
    expect(doc.ministries).toEqual(["worship"]);
    expect(doc.managesMinistries).toEqual(["kids"]);
  });
});
