import { describe, it, expect, vi, beforeEach } from "vitest";

const getServerSession = vi.fn();
vi.mock("next-auth", () => ({ getServerSession: (...a: unknown[]) => getServerSession(...a) }));
vi.mock("@/auth", () => ({ authOptions: {} }));
const getMemberAccess = vi.fn();
vi.mock("../memberAccess", () => ({
  isMemberActive: async (id: string) => (await getMemberAccess(id)).active,
  getMemberAccess: (...a: unknown[]) => getMemberAccess(...a),
}));

import { requireMinistryMember, requireMinistryManager } from "../authGuards";

function sessionFor(role: string) {
  return { user: { role, sanityId: "m1", email: "x@y.z" } };
}
function accessOf(p: Partial<{ active: boolean; role: string | null; ministries: string[]; managesMinistries: string[] }>) {
  getMemberAccess.mockResolvedValue({
    active: true, role: "member", ministries: ["worship"], managesMinistries: [], ...p,
  });
}
beforeEach(() => { getServerSession.mockReset(); getMemberAccess.mockReset(); });

describe("requireMinistryManager", () => {
  it("passes super-admin for any ministry", async () => {
    getServerSession.mockResolvedValue(sessionFor("super-admin"));
    accessOf({ role: "super-admin" });
    expect(await requireMinistryManager("kids")).not.toBeNull();
    expect(await requireMinistryManager("worship")).not.toBeNull();
  });
  it("REJECTS plain admin for kids (two-way isolation)", async () => {
    getServerSession.mockResolvedValue(sessionFor("admin"));
    accessOf({ role: "admin" });
    expect(await requireMinistryManager("kids")).toBeNull();
  });
  it("passes a member whose managesMinistries names the ministry", async () => {
    getServerSession.mockResolvedValue(sessionFor("member"));
    accessOf({ managesMinistries: ["kids"], ministries: ["kids"] });
    expect(await requireMinistryManager("kids")).not.toBeNull();
  });
  it("rejects a kids manager for worship", async () => {
    getServerSession.mockResolvedValue(sessionFor("member"));
    accessOf({ managesMinistries: ["kids"], ministries: ["kids"] });
    expect(await requireMinistryManager("worship")).toBeNull();
  });
  it("rejects disabled members even with managesMinistries", async () => {
    getServerSession.mockResolvedValue(sessionFor("member"));
    accessOf({ active: false, managesMinistries: ["kids"] });
    expect(await requireMinistryManager("kids")).toBeNull();
  });
  it("rejects no session", async () => {
    getServerSession.mockResolvedValue(null);
    expect(await requireMinistryManager("kids")).toBeNull();
  });
});

describe("requireMinistryMember", () => {
  it("legacy member (normalized worship) passes worship, not kids", async () => {
    getServerSession.mockResolvedValue(sessionFor("member"));
    accessOf({});
    expect(await requireMinistryMember("worship")).not.toBeNull();
    expect(await requireMinistryMember("kids")).toBeNull();
  });
  it("kids-only member passes kids, not worship — worship admin role does not rescue", async () => {
    getServerSession.mockResolvedValue(sessionFor("member"));
    accessOf({ ministries: ["kids"] });
    expect(await requireMinistryMember("kids")).not.toBeNull();
    expect(await requireMinistryMember("worship")).toBeNull();
  });
  it("dual-ministry member passes both", async () => {
    getServerSession.mockResolvedValue(sessionFor("member"));
    accessOf({ ministries: ["worship", "kids"] });
    expect(await requireMinistryMember("worship")).not.toBeNull();
    expect(await requireMinistryMember("kids")).not.toBeNull();
  });
  it("super-admin passes both regardless of ministries", async () => {
    getServerSession.mockResolvedValue(sessionFor("super-admin"));
    accessOf({ role: "super-admin", ministries: ["worship"] });
    expect(await requireMinistryMember("kids")).not.toBeNull();
  });
});
