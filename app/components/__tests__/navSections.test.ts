// One ministry at a time in the nav (Frank, 2026-10-29): which section a page
// belongs to and where a switch lands — the derivation both nav surfaces share.
import { beforeEach, describe, expect, it, vi } from "vitest";

// The real registry by default (Jóvenes open to every pastor since 2026-11-12); one test closes
// the nav's copy of it, so the section stays tied to the rollout whatever the registry says.
const nav = vi.hoisted(() => ({ closedToPastors: false }));
vi.mock("@/app/utils/rollout", async (orig) => {
  const real = await orig<typeof import("@/app/utils/rollout")>();
  return {
    ...real,
    navRolloutAllows: (f: never, isSuper: boolean) => (nav.closedToPastors ? isSuper : real.navRolloutAllows(f, isSuper)),
  };
});

import { availableSections, currentSection, navAccess, sectionHome } from "../navSections";

beforeEach(() => {
  nav.closedToPastors = false;
});

const user = (p: Record<string, unknown>) => navAccess({ role: "member", ...p });

describe("navSections", () => {
  it("absent ministries are worship (the session copy's contract)", () => {
    expect(availableSections(user({}))).toEqual(["worship"]);
  });
  // Jóvenes is a section as far as its meetings' rollout reaches (`rollout.ts`, stage `all` since
  // 2026-11-12): the super-admin has all three, a pastor has Jóvenes, and nobody outside it does.
  it("a super-admin has all three; a Jóvenes-only pastor has Jóvenes, and it is where every page lands", () => {
    expect(availableSections(user({ role: "super-admin" }))).toEqual(["worship", "kids", "jovenes"]);
    expect(availableSections(user({ ministries: ["jovenes"] }))).toEqual(["jovenes"]);
    expect(currentSection("/", user({ ministries: ["jovenes"] }))).toBe("jovenes");
    expect(currentSection("/me", user({ ministries: ["jovenes"] }))).toBe("jovenes");
    // Membership still decides: the rollout opens the section to nobody outside Jóvenes.
    expect(availableSections(user({ ministries: ["worship"] }))).toEqual(["worship"]);
    expect(availableSections(user({ role: "admin", ministries: ["worship", "kids"] }))).toEqual(["worship", "kids"]);
  });
  it("while the rollout does not reach pastors, only the super-admin has the Jóvenes section", () => {
    nav.closedToPastors = true;
    expect(availableSections(user({ role: "super-admin" }))).toEqual(["worship", "kids", "jovenes"]);
    expect(availableSections(user({ ministries: ["jovenes"] }))).toEqual([]);
    expect(currentSection("/", user({ ministries: ["jovenes"] }))).toBeNull();
    expect(currentSection("/jovenes", user({ ministries: ["worship", "jovenes"] }))).toBe("worship");
  });
  it("/jovenes… is Jóvenes for whoever has the section, and switching there lands on /jovenes", () => {
    const sup = user({ role: "super-admin" });
    expect(currentSection("/jovenes", sup)).toBe("jovenes");
    expect(currentSection("/jovenes/admin", sup)).toBe("jovenes");
    expect(currentSection("/jovenesx", sup)).toBe("worship");
    expect(sectionHome("jovenes", sup)).toBe("/jovenes");
    // A pastor who is also in Alabanza: Jóvenes on its pages, worship everywhere else.
    const both = user({ ministries: ["worship", "jovenes"] });
    expect(currentSection("/jovenes", both)).toBe("jovenes");
    expect(currentSection("/schedule", both)).toBe("worship");
    // Without the section, the page falls back to the person's first one.
    expect(currentSection("/jovenes", user({ ministries: ["worship"] }))).toBe("worship");
  });
  it("a Kids manager outside Kids still has the Kids section, landing on the planner", () => {
    const a = user({ ministries: ["jovenes"], managesMinistries: ["kids"] });
    expect(availableSections(a)).toEqual(["kids", "jovenes"]);
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
