import { describe, it, expect, vi, beforeEach } from "vitest";

const fetchMock = vi.fn();
vi.mock("@/sanity/lib/serverClient", () => ({
  serverClient: { fetch: (...a: unknown[]) => fetchMock(...a) },
}));

import { isMemberActive, __clearMemberAccessCache } from "../memberAccess";

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
