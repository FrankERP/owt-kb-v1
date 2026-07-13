import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const requireActiveSessionMock = vi.fn();
const requireActiveManagerMock = vi.fn();
vi.mock("@/app/utils/authGuards", () => ({
  requireActiveSession: () => requireActiveSessionMock(),
  requireActiveManager: () => requireActiveManagerMock(),
}));

const fetchMock = vi.fn();
const createMock = vi.fn();
const patchSets: Array<{ id: string; value: Record<string, unknown> }> = [];
const patchMock = vi.fn((id: string) => {
  const chain = {
    ifRevisionId: vi.fn(() => chain),
    set: vi.fn((value: Record<string, unknown>) => {
      patchSets.push({ id, value });
      return chain;
    }),
    commit: vi.fn().mockResolvedValue({}),
  };
  return chain;
});
vi.mock("@/sanity/lib/serverClient", () => ({
  serverClient: { fetch: (...args: unknown[]) => fetchMock(...args) },
  writeClient: {
    create: (...args: unknown[]) => createMock(...args),
    patch: (id: string) => patchMock(id),
    delete: vi.fn(),
  },
}));

vi.mock("@/app/utils/proposalNotify", () => ({ notifyProposalSubmitted: vi.fn() }));
vi.mock("@/app/utils/push", () => ({ sendPush: vi.fn() }));
const revalidateServiceViewsMock = vi.fn();
vi.mock("@/app/utils/revalidate", () => ({
  revalidateServiceViews: () => revalidateServiceViewsMock(),
}));

import { POST } from "@/app/api/me/proposals/route";
import { PATCH } from "@/app/api/admin/proposals/[id]/route";

beforeEach(() => {
  requireActiveSessionMock.mockReset();
  requireActiveManagerMock.mockReset();
  fetchMock.mockReset();
  createMock.mockReset();
  patchMock.mockClear();
  patchSets.length = 0;
  revalidateServiceViewsMock.mockReset();
});

describe("proposal team message", () => {
  it("stores the team message separately from the private review note", async () => {
    requireActiveSessionMock.mockResolvedValue({ user: { sanityId: "lead-1" } });
    fetchMock
      .mockResolvedValueOnce({ _id: "role-1", _type: "sunday_role", week: "2026-07-19" })
      .mockResolvedValueOnce(null);
    createMock.mockResolvedValue({ _id: "proposal-1", _rev: "rev-1" });

    const req = {
      json: async () => ({
        roleId: "role-1",
        songs: [{ songId: "song-1", play_key: "D" }],
        leadNotes: "Solo para admins",
        teamNotes: "Salmo 100:2",
        status: "draft",
      }),
    } as NextRequest;

    const response = await POST(req);

    expect(response.status).toBe(200);
    expect(createMock).toHaveBeenCalledWith(expect.objectContaining({
      lead_notes: "Solo para admins",
      team_notes: "Salmo 100:2",
    }));
  });

  it("publishes only the team message with the approved setlist", async () => {
    requireActiveManagerMock.mockResolvedValue({ user: { role: "admin" } });
    fetchMock
      .mockResolvedValueOnce({
        _id: "proposal-1",
        _rev: "rev-1",
        service_type: "sunday",
        service_date: "2026-07-19",
        service_ref_id: "role-1",
        status: "pending",
        lead_notes: "Solo para admins",
        team_notes: "Salmo 100:2",
        songs: [{ _key: "p1", song_id: "song-1", play_key: "D" }],
      })
      .mockResolvedValueOnce("setlist-1")
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce({ lead: null, contributors: [] });

    const req = { json: async () => ({ action: "approve" }) } as NextRequest;
    const response = await PATCH(req, { params: Promise.resolve({ id: "proposal-1" }) });

    expect(response.status).toBe(200);
    const published = patchSets.find((entry) => entry.id === "setlist-1")?.value;
    expect(published).toEqual(expect.objectContaining({ team_notes: "Salmo 100:2" }));
    expect(published).not.toHaveProperty("lead_notes");
    expect(revalidateServiceViewsMock).toHaveBeenCalledOnce();
  });
});
