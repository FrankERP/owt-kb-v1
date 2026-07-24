import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const requireActiveSessionMock = vi.fn();
const fetchMock = vi.fn();       // serverClient — the post/song read
const opFetchMock = vi.fn();     // operationalClient — the canonical history read

vi.mock("server-only", () => ({}));

vi.mock("@/app/utils/authGuards", () => ({
  requireActiveSession: () => requireActiveSessionMock(),
}));

vi.mock("@/sanity/lib/serverClient", () => ({
  serverClient: { fetch: (...args: unknown[]) => fetchMock(...args) },
}));

vi.mock("@/sanity/lib/operationalClient", () => ({
  operationalClient: { fetch: (...args: unknown[]) => opFetchMock(...args) },
  rawIntegrityClient: { fetch: vi.fn() },
}));

import { GET } from "@/app/api/song/[id]/route";

beforeEach(() => {
  requireActiveSessionMock.mockReset();
  fetchMock.mockReset();
  opFetchMock.mockReset();
});

describe("/api/song/[id]", () => {
  it("keeps SongSheet history past-only in America/Mexico_City", async () => {
    requireActiveSessionMock.mockResolvedValue({ user: { sanityId: "member-1" } });
    fetchMock.mockResolvedValueOnce({ _id: "song-1", title: "Sólo en Jesús" });
    opFetchMock.mockResolvedValueOnce([{ week: "2026-07-12", _type: "featuredSongs" }]);

    const response = await GET({} as NextRequest, { params: Promise.resolve({ id: "song-1" }) });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      _id: "song-1",
      title: "Sólo en Jesús",
      history: [{ week: "2026-07-12", _type: "featuredSongs" }],
    });
    const [historyQuery, historyParams] = opFetchMock.mock.calls[0];
    expect(historyQuery).toContain("week < $today");
    expect(historyParams).toEqual({ id: "song-1", today: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) });
  });

  it("drops an ambiguous (duplicate-week) setlist from history — no double count", async () => {
    requireActiveSessionMock.mockResolvedValue({ user: { sanityId: "member-1" } });
    fetchMock.mockResolvedValueOnce({ _id: "song-1", title: "Sólo en Jesús" });
    opFetchMock.mockResolvedValueOnce([
      { week: "2026-07-12", _type: "featuredSongs", play_key: "G" },
      { week: "2026-07-12", _type: "featuredSongs", play_key: "A" }, // duplicate target
      { week: "2026-06-21", _type: "featuredSongs", play_key: "C" },
    ]);

    const response = await GET({} as NextRequest, { params: Promise.resolve({ id: "song-1" }) });
    const body = await response.json();
    expect(body.history).toEqual([{ week: "2026-06-21", _type: "featuredSongs", play_key: "C" }]);
  });
});
