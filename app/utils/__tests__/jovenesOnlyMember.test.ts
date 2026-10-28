// A member of Jóvenes only (`ministries: ["jovenes"]`) sees nothing of worship
// (ADR-0075; access plan §5). Under code that predates the `jovenes` registry
// entry this exact member read as WORSHIP — unknown ids were dropped and an
// empty list fell back to worship — which is why the read side ships first.
// The calendar feed's 404 for this member lives in calendarFeedRoute.test.ts.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { evaluate, parse } from "groq-js";

const h = vi.hoisted(() => ({ getServerSession: vi.fn(), fetch: vi.fn() }));
vi.mock("next-auth", () => ({ getServerSession: () => h.getServerSession() }));
vi.mock("@/auth", () => ({ authOptions: {} }));
vi.mock("@/sanity/lib/serverClient", () => ({ serverClient: { fetch: (...a: unknown[]) => h.fetch(...a) } }));
class RedirectSignal extends Error {
  constructor(readonly target: string) { super(target); }
}
vi.mock("next/navigation", () => ({
  redirect: (t: string) => { throw new RedirectSignal(t); },
}));

import { requireMinistryManager, requireMinistryMember } from "../authGuards";
import { requireWorshipPage } from "../worshipPageGate";
import { __clearMemberAccessCache } from "../memberAccess";
import { WORSHIP_AUDIENCE_GROQ_FILTER } from "@/app/ministries";

const JOVENES_ADMIN = {
  _id: "m-jov", disabled: false, role: "member", ministries: ["jovenes"],
  ministryRoles: [{ _key: "jovenes", ministry: "jovenes", level: "admin", groups: [] }],
};

beforeEach(() => {
  __clearMemberAccessCache();
  h.getServerSession.mockResolvedValue({ user: { sanityId: "m-jov", role: "member" } });
  h.fetch.mockResolvedValue(JOVENES_ADMIN);
});

describe("a Jóvenes-only member (even a Jóvenes admin)", () => {
  it("passes no worship or kids guard, and manages Jóvenes", async () => {
    expect(await requireMinistryMember("worship")).toBeNull();
    expect(await requireMinistryManager("worship")).toBeNull();
    expect(await requireMinistryMember("kids")).toBeNull();
    expect(await requireMinistryManager("kids")).toBeNull();
    expect(await requireMinistryManager("jovenes")).not.toBeNull();
  });

  it("is sent from a worship page to /me, not /kids (the redirect terminates)", async () => {
    await expect(requireWorshipPage("/")).rejects.toMatchObject({ target: "/me" });
  });

  it("is outside the worship notification audience", async () => {
    const dataset = [
      { _id: "m-legacy", _type: "teamMembers" },
      { _id: "m-jov", _type: "teamMembers", ministries: ["jovenes"] },
      { _id: "m-both", _type: "teamMembers", ministries: ["worship", "jovenes"] },
    ];
    const q = `*[_type == "teamMembers" && ${WORSHIP_AUDIENCE_GROQ_FILTER}]._id`;
    const ids = await (await evaluate(parse(q), { dataset })).get();
    expect(ids).toEqual(["m-legacy", "m-both"]);
  });
});
