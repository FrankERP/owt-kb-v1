import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const requireActiveSessionMock = vi.fn();
const fetchMock = vi.fn();

vi.mock("@/app/utils/authGuards", () => ({
  requireActiveSession: () => requireActiveSessionMock(),
}));

vi.mock("@/sanity/lib/serverClient", () => ({
  serverClient: { fetch: (...args: unknown[]) => fetchMock(...args) },
}));

import { GET } from "@/app/api/song/[id]/route";

beforeEach(() => {
  requireActiveSessionMock.mockReset();
  fetchMock.mockReset();
});

describe("/api/song/[id]", () => {
  it("keeps SongSheet history past-only in America/Mexico_City", async () => {
    requireActiveSessionMock.mockResolvedValue({ user: { sanityId: "member-1" } });
    fetchMock.mockResolvedValueOnce({ _id: "song-1", title: "Sólo en Jesús" });
    fetchMock.mockResolvedValueOnce([{ week: "2026-07-12", _type: "featuredSongs" }]);

    const response = await GET({} as NextRequest, { params: Promise.resolve({ id: "song-1" }) });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      _id: "song-1",
      title: "Sólo en Jesús",
      history: [{ week: "2026-07-12", _type: "featuredSongs" }],
    });
    const [historyQuery, historyParams] = fetchMock.mock.calls[1];
    expect(historyQuery).toContain("week < $today");
    expect(historyParams).toEqual({ id: "song-1", today: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) });
  });
});
