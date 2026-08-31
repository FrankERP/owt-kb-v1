import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));

const h = vi.hoisted(() => ({
  requireActiveManager: vi.fn(),
  operationalFetch: vi.fn(),
  delete: vi.fn(),
  patch: vi.fn(),
  commit: vi.fn(),
  revalidateServiceViews: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/app/utils/authGuards", () => ({
  requireActiveManager: () => h.requireActiveManager(),
}));

vi.mock("@/sanity/lib/operationalClient", () => ({
  operationalClient: { fetch: (...a: unknown[]) => h.operationalFetch(...a) },
}));

vi.mock("@/sanity/lib/serverClient", () => {
  const chain: Record<string, unknown> = {};
  chain.ifRevisionId = () => chain;
  chain.set = () => chain;
  chain.commit = () => h.commit();
  h.patch.mockReturnValue(chain);
  return {
    serverClient: { fetch: vi.fn() },
    writeClient: {
      delete: (...a: unknown[]) => h.delete(...a),
      patch: (...a: unknown[]) => h.patch(...a),
    },
  };
});

vi.mock("@/app/utils/revalidate", () => ({
  revalidateServiceViews: (...a: unknown[]) => h.revalidateServiceViews(...a),
}));
vi.mock("next/cache", () => ({
  revalidatePath: (...a: unknown[]) => h.revalidatePath(...a),
}));

import { DELETE } from "@/app/api/admin/members/[id]/route";
import {
  MEMBER_DELETE_ERROR,
  MEMBER_HAS_REFERENCES_MESSAGE,
  MEMBER_POOL_CLEANUP_FAILED_MESSAGE,
} from "@/app/utils/memberDelete";
import { SOLVER_CONFIG_DOC_ID } from "@/app/utils/solverConfigWriteRequest";

function req(): NextRequest {
  return {} as NextRequest;
}

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

describe("DELETE /api/admin/members/[id] (P2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.requireActiveManager.mockResolvedValue({ user: { role: "super-admin" } });
    h.delete.mockResolvedValue(undefined);
    h.commit.mockResolvedValue({ ok: true });
    h.operationalFetch.mockResolvedValue(null);
  });

  it("rejects non-super-admin (R13)", async () => {
    h.requireActiveManager.mockResolvedValue({ user: { role: "admin" } });
    const res = await DELETE(req(), ctx("m1"));
    expect(res.status).toBe(403);
    expect(h.delete).not.toHaveBeenCalled();
  });

  it("returns member_has_references on referential integrity error (R8)", async () => {
    h.delete.mockRejectedValueOnce({
      statusCode: 409,
      message: 'Document "m1" cannot be deleted as there are references to it from "role-1"',
    });
    const res = await DELETE(req(), ctx("m1"));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body).toMatchObject({
      error: MEMBER_DELETE_ERROR.HAS_REFERENCES,
      message: MEMBER_HAS_REFERENCES_MESSAGE,
      offerRetire: true,
    });
    expect(h.revalidateServiceViews).not.toHaveBeenCalled();
    expect(h.revalidatePath).not.toHaveBeenCalled();
  });

  it("deletes and skips pool cleanup when solverConfig absent", async () => {
    h.operationalFetch.mockResolvedValueOnce(null);
    const res = await DELETE(req(), ctx("m1"));
    expect(res.status).toBe(200);
    expect(h.delete).toHaveBeenCalledWith("m1");
    expect(h.patch).not.toHaveBeenCalled();
    expect(h.revalidateServiceViews).toHaveBeenCalled();
    expect(h.revalidatePath).toHaveBeenCalledWith("/me");
  });

  it("deletes and revision-guards pool cleanup (R9)", async () => {
    h.operationalFetch.mockResolvedValueOnce({
      _rev: "rev-1",
      sundayLeads: ["m1", "other"],
      saturdayLeads: [],
      support: [],
    });
    const res = await DELETE(req(), ctx("m1"));
    expect(res.status).toBe(200);
    expect(h.patch).toHaveBeenCalledWith(SOLVER_CONFIG_DOC_ID);
    expect(h.commit).toHaveBeenCalled();
    expect(h.revalidateServiceViews).toHaveBeenCalled();
  });

  it("returns member_deleted_pool_cleanup_failed without revalidate when cleanup fails (R9b)", async () => {
    h.operationalFetch.mockResolvedValueOnce({
      _rev: "rev-1",
      sundayLeads: ["m1"],
      saturdayLeads: [],
      support: [],
    });
    h.commit.mockRejectedValueOnce({
      statusCode: 409,
      details: {
        type: "mutationError",
        items: [{ error: { type: "documentRevisionIDDoesNotMatchError" } }],
      },
    });
    const res = await DELETE(req(), ctx("m1"));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body).toMatchObject({
      error: MEMBER_DELETE_ERROR.POOL_CLEANUP_FAILED,
      message: MEMBER_POOL_CLEANUP_FAILED_MESSAGE,
      deleted: true,
      kind: "stale_revision",
    });
    expect(h.delete).toHaveBeenCalledWith("m1");
    expect(h.revalidateServiceViews).not.toHaveBeenCalled();
    expect(h.revalidatePath).not.toHaveBeenCalled();
  });

  it("does not revert delete on stale_revision during cleanup (R9/R12)", async () => {
    h.operationalFetch.mockResolvedValueOnce({
      _rev: "rev-stale",
      sundayLeads: ["m1"],
      saturdayLeads: [],
      support: [],
    });
    h.commit.mockRejectedValueOnce({
      statusCode: 409,
      details: {
        type: "mutationError",
        items: [{ error: { type: "documentRevisionIDDoesNotMatchError" } }],
      },
    });
    await DELETE(req(), ctx("m1"));
    expect(h.delete).toHaveBeenCalledTimes(1);
    expect(h.delete).toHaveBeenCalledWith("m1");
  });
});
