import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const h = vi.hoisted(() => ({
  requireActiveManager: vi.fn(),
  getToken: vi.fn(),
  fetch: vi.fn(),
  transaction: vi.fn(),
  patch: vi.fn(),
  commit: vi.fn(),
}));

vi.mock("@/app/utils/authGuards", () => ({
  requireActiveManager: () => h.requireActiveManager(),
}));

vi.mock("next-auth/jwt", () => ({
  getToken: (...a: unknown[]) => h.getToken(...a),
}));

vi.mock("@/sanity/lib/serverClient", () => {
  const chain: Record<string, unknown> = {};
  chain.ifRevisionId = () => chain;
  chain.set = () => chain;
  chain.unset = () => chain;
  chain.commit = () => h.commit();
  h.patch.mockReturnValue(chain);
  const tx: Record<string, unknown> = {};
  tx.patch = (...args: unknown[]) => {
    h.patch(...args);
    return tx;
  };
  tx.commit = () => h.commit();
  h.transaction.mockReturnValue(tx);
  return {
    serverClient: { fetch: (...a: unknown[]) => h.fetch(...a) },
    writeClient: {
      patch: (...a: unknown[]) => h.patch(...a),
      transaction: () => h.transaction(),
    },
  };
});

vi.mock("@/app/utils/revalidate", () => ({ revalidateServiceViews: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { PATCH as disablePATCH } from "@/app/api/admin/members/[id]/disable/route";
import { PATCH as retirePATCH } from "@/app/api/admin/members/[id]/retire/route";

function req(body: unknown): NextRequest {
  return { json: async () => body } as NextRequest;
}

describe("PATCH /api/admin/members/[id]/retire", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.fetch.mockReset();
    h.requireActiveManager.mockResolvedValue({ user: { role: "super-admin" } });
  });

  it("rejects kids retire when stored ministries absent (R11)", async () => {
    h.fetch.mockResolvedValueOnce({ _id: "m1", _rev: "r1", ministries: undefined, retiredFrom: undefined });
    const res = await retirePATCH(req({ ministry: "kids", retire: true }), {
      params: Promise.resolve({ id: "m1" }),
    });
    expect(res.status).toBe(400);
    expect(h.patch).not.toHaveBeenCalled();
  });

  it("allows worship retire when ministries absent", async () => {
    h.fetch.mockResolvedValueOnce({ _id: "m1", _rev: "r1", ministries: undefined, retiredFrom: undefined });
    h.commit.mockResolvedValueOnce({ _id: "m1", retiredFrom: ["worship"] });
    const res = await retirePATCH(req({ ministry: "worship", retire: true }), {
      params: Promise.resolve({ id: "m1" }),
    });
    expect(res.status).toBe(200);
  });
});

function setupWriteMocks() {
  const chain: Record<string, unknown> = {};
  chain.ifRevisionId = () => chain;
  chain.set = () => chain;
  chain.unset = () => chain;
  chain.commit = () => h.commit();
  h.patch.mockReturnValue(chain);
  const tx: Record<string, unknown> = {};
  tx.patch = (...args: unknown[]) => {
    h.patch(...args);
    return tx;
  };
  tx.commit = () => h.commit();
  h.transaction.mockReturnValue(tx);
}

describe("PATCH /api/admin/members/[id]/disable (R14)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.fetch.mockReset();
    setupWriteMocks();
    h.requireActiveManager.mockResolvedValue({ user: { role: "super-admin", sanityId: "op" } });
    h.getToken.mockResolvedValue({ sanityId: "op", __realAdmin: { sanityId: "real-op" } });
    h.commit.mockResolvedValue({ ok: true });
  });

  it("rejects disabling the effective operator", async () => {
    const res = await disablePATCH(req({ disabled: true }), {
      params: Promise.resolve({ id: "op" }),
    });
    expect(res.status).toBe(409);
  });

  it("rejects disabling the real admin during impersonation", async () => {
    const res = await disablePATCH(req({ disabled: true }), {
      params: Promise.resolve({ id: "real-op" }),
    });
    expect(res.status).toBe(409);
  });

  it("rejects disabling the last enabled super-admin", async () => {
    h.fetch
      .mockResolvedValueOnce([{ _id: "only", _rev: "r1" }])
      .mockResolvedValueOnce({ _id: "only", _rev: "r1", disabled: undefined });
    const res = await disablePATCH(req({ disabled: true }), {
      params: Promise.resolve({ id: "only" }),
    });
    expect(res.status).toBe(409);
  });

  it("write-backs other enabled super-admins on disable", async () => {
    h.fetch
      .mockResolvedValueOnce([
        { _id: "target", _rev: "rt", disabled: undefined },
        { _id: "other", _rev: "ro", disabled: undefined },
      ])
      .mockResolvedValueOnce({ _id: "target", _rev: "rt", disabled: undefined });
    const res = await disablePATCH(req({ disabled: true }), {
      params: Promise.resolve({ id: "target" }),
    });
    expect(res.status).toBe(200);
    expect(h.transaction).toHaveBeenCalled();
    expect(h.patch.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("retries once after revision conflict", async () => {
    h.fetch
      .mockResolvedValueOnce([
        { _id: "target", _rev: "rt1", disabled: undefined },
        { _id: "other", _rev: "ro1", disabled: undefined },
      ])
      .mockResolvedValueOnce({ _id: "target", _rev: "rt1", disabled: undefined })
      .mockResolvedValueOnce({ _id: "target", _rev: "rt2", disabled: undefined })
      .mockResolvedValueOnce([{ _id: "other", _rev: "ro2", disabled: undefined }]);
    h.commit.mockRejectedValueOnce(new Error("409")).mockResolvedValueOnce({ ok: true });
    const res = await disablePATCH(req({ disabled: true }), {
      params: Promise.resolve({ id: "target" }),
    });
    expect(res.status).toBe(200);
    expect(h.commit).toHaveBeenCalledTimes(2);
  });
});
