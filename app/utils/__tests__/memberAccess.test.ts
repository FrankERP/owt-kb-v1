import { describe, it, expect, vi, beforeEach } from "vitest";

const fetchMock = vi.fn();
vi.mock("@/sanity/lib/serverClient", () => ({
  serverClient: { fetch: (...a: unknown[]) => fetchMock(...a) },
}));

import { isMemberActive, getMemberAccess, __clearMemberAccessCache } from "../memberAccess";

beforeEach(() => { fetchMock.mockReset(); __clearMemberAccessCache(); });

describe("isMemberActive", () => {
  it("returns true for an existing, non-disabled member", async () => {
    fetchMock.mockResolvedValueOnce({ _id: "m1", disabled: false });
    expect(await isMemberActive("m1")).toBe(true);
  });

  it("returns false when disabled is true", async () => {
    fetchMock.mockResolvedValueOnce({ _id: "m1", disabled: true });
    expect(await isMemberActive("m1")).toBe(false);
  });

  it("returns false when the member no longer exists", async () => {
    fetchMock.mockResolvedValueOnce(null);
    expect(await isMemberActive("gone")).toBe(false);
  });

  it("caches within the TTL (one fetch for two calls)", async () => {
    fetchMock.mockResolvedValue({ _id: "m1", disabled: false });
    await isMemberActive("m1");
    await isMemberActive("m1");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("treats a missing id as inactive without fetching", async () => {
    expect(await isMemberActive("")).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("getMemberAccess", () => {
  it("returns the member's current role alongside active", async () => {
    fetchMock.mockResolvedValueOnce({ _id: "m1", disabled: false, role: "admin" });
    expect(await getMemberAccess("m1")).toEqual({
      active: true, role: "admin", ministries: ["worship"], managesMinistries: [],
    });
  });

  it("reflects a demotion: the live role is returned, not a stale one", async () => {
    // Simulates the JWT role-refresh path — a former admin now stored as member.
    fetchMock.mockResolvedValueOnce({ _id: "m1", disabled: false, role: "member" });
    const { role } = await getMemberAccess("m1");
    expect(role).toBe("member");
  });

  it("returns role null when the doc has no role field", async () => {
    fetchMock.mockResolvedValueOnce({ _id: "m1", disabled: false });
    expect(await getMemberAccess("m1")).toEqual({
      active: true, role: null, ministries: ["worship"], managesMinistries: [],
    });
  });

  it("returns inactive + null role when the member is gone", async () => {
    // Fail-closed: a deleted member gets NO ministries, not the legacy
    // ["worship"] default — absence of a document is not legacy membership.
    fetchMock.mockResolvedValueOnce(null);
    expect(await getMemberAccess("gone")).toEqual({
      active: false, role: null, ministries: [], managesMinistries: [],
    });
  });

  it("shares the 30s cache with isMemberActive (one fetch)", async () => {
    fetchMock.mockResolvedValue({
      _id: "m1", disabled: false, role: "content-editor",
      ministries: ["kids"], managesMinistries: ["kids"],
    });
    await getMemberAccess("m1");
    expect(await isMemberActive("m1")).toBe(true);
    expect((await getMemberAccess("m1")).role).toBe("content-editor");
    // The CACHE-HIT path must carry the ministries too: tsc only forces
    // *something* onto that return, not the stored values.
    const cached = await getMemberAccess("m1");
    expect(cached.ministries).toEqual(["kids"]);
    expect(cached.managesMinistries).toEqual(["kids"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("treats a missing id as inactive without fetching", async () => {
    expect(await getMemberAccess("")).toEqual({
      active: false, role: null, ministries: [], managesMinistries: [],
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("normalizes absent ministries to worship (legacy members keep today's access)", async () => {
    fetchMock.mockResolvedValueOnce({ _id: "m1", disabled: false, role: "member" });
    expect((await getMemberAccess("m1")).ministries).toEqual(["worship"]);
  });

  it("normalizes an EMPTY ministries array to worship too", async () => {
    fetchMock.mockResolvedValueOnce({ _id: "m1", disabled: false, role: "member", ministries: [] });
    expect((await getMemberAccess("m1")).ministries).toEqual(["worship"]);
  });

  it("passes stored ministries and managesMinistries through", async () => {
    fetchMock.mockResolvedValueOnce({
      _id: "m2", disabled: false, role: "member",
      ministries: ["kids"], managesMinistries: ["kids"],
    });
    const a = await getMemberAccess("m2");
    expect(a.ministries).toEqual(["kids"]);
    expect(a.managesMinistries).toEqual(["kids"]);
  });

  it("defaults managesMinistries to empty", async () => {
    fetchMock.mockResolvedValueOnce({ _id: "m3", disabled: false, role: "admin" });
    expect((await getMemberAccess("m3")).managesMinistries).toEqual([]);
  });
});
