// One ministry at a time in the nav (Frank, 2026-10-29): which section a page
// belongs to and where a switch lands — the derivation both nav surfaces share.
import { describe, expect, it } from "vitest";
import { availableSections, currentSection, navAccess, sectionHome } from "../navSections";

const user = (p: Record<string, unknown>) => navAccess({ role: "member", ...p });

describe("navSections", () => {
  it("absent ministries are worship (the session copy's contract)", () => {
    expect(availableSections(user({}))).toEqual(["worship"]);
  });
  it("a super-admin has both; a Jóvenes-only member has none yet", () => {
    expect(availableSections(user({ role: "super-admin" }))).toEqual(["worship", "kids"]);
    expect(availableSections(user({ ministries: ["jovenes"] }))).toEqual([]);
    expect(currentSection("/", user({ ministries: ["jovenes"] }))).toBeNull();
  });
  it("a Kids manager outside Kids still has the Kids section, landing on the planner", () => {
    const a = user({ ministries: ["jovenes"], managesMinistries: ["kids"] });
    expect(availableSections(a)).toEqual(["kids"]);
    expect(sectionHome("kids", a)).toBe("/kids/admin");
    expect(sectionHome("kids", user({ ministries: ["kids"] }))).toBe("/kids");
  });
  it("/kids… is Kids; any other page is the person's first section", () => {
    const both = user({ ministries: ["worship", "kids"] });
    expect(currentSection("/kids", both)).toBe("kids");
    expect(currentSection("/kids/admin", both)).toBe("kids");
    expect(currentSection("/kidsfoo", both)).toBe("worship");
    for (const p of ["/", "/schedule", "/admin", "/me", "/super-admin"]) expect(currentSection(p, both), p).toBe("worship");
    expect(currentSection("/me", user({ ministries: ["kids"] }))).toBe("kids");
  });
  it("a worship-only member on /kids stays in worship (no Kids section to show)", () => {
    expect(currentSection("/kids", user({ ministries: ["worship"] }))).toBe("worship");
  });
});
