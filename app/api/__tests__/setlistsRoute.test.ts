import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

// operationalClient is `import "server-only"` guarded; neutralize the marker so
// the route module loads under vitest's node environment.
vi.mock("server-only", () => ({}));

const requireActiveManagerMock = vi.fn();
const operationalFetch = vi.fn();
const rawFetch = vi.fn();

vi.mock("@/app/utils/authGuards", () => ({
  requireActiveManager: () => requireActiveManagerMock(),
}));

vi.mock("@/sanity/lib/operationalClient", () => ({
  operationalClient: { fetch: (...a: unknown[]) => operationalFetch(...a) },
  rawIntegrityClient: { fetch: (...a: unknown[]) => rawFetch(...a) },
}));

vi.mock("@/sanity/lib/serverClient", () => ({
  serverClient: { fetch: vi.fn() },
  writeClient: { patch: vi.fn(), create: vi.fn() },
}));

vi.mock("@/app/utils/revalidate", () => ({ revalidateServiceViews: vi.fn() }));
vi.mock("@/app/utils/push", () => ({ sendPush: vi.fn() }));

import { GET } from "@/app/api/admin/setlists/route";

const ADMIN = { user: { role: "admin" } };

function req(query: Record<string, string>): NextRequest {
  const url = new URL("http://localhost/api/admin/setlists");
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  return { nextUrl: url } as unknown as NextRequest;
}

type RecentLists = Record<"sunday" | "saturday" | "special", { week: string; songs: unknown[] }[]>;

const EMPTY_RECENT: RecentLists = { sunday: [], saturday: [], special: [] };

function song(over: Record<string, unknown> = {}) {
  return {
    _key: "k1",
    play_key: "G",
    songRef: "song-1",
    song: { _id: "song-1", title: "Sólo en Jesús", author: "OWT", key: "G", slug: "solo" },
    ...over,
  };
}

/** Weekend GET: operational fetches are [recentSongs, canonical setlists]; raw is [drafts]. */
function weekendReads(canonical: unknown[], drafts: unknown[] = [], recent = EMPTY_RECENT) {
  operationalFetch.mockResolvedValueOnce(recent);
  operationalFetch.mockResolvedValueOnce(canonical);
  rawFetch.mockResolvedValueOnce(drafts);
}

/** Special GET: operational fetches are [special role, recentSongs]; raw is [role drafts]. */
function specialReads(roles: unknown[], drafts: unknown[] = [], recent = EMPTY_RECENT) {
  operationalFetch.mockResolvedValueOnce(roles);
  operationalFetch.mockResolvedValueOnce(recent);
  rawFetch.mockResolvedValueOnce(drafts);
}

beforeEach(() => {
  requireActiveManagerMock.mockReset();
  operationalFetch.mockReset();
  rawFetch.mockReset();
  requireActiveManagerMock.mockResolvedValue(ADMIN);
});

describe("GET /api/admin/setlists authorization", () => {
  it("denies an unauthenticated / inactive session (403)", async () => {
    requireActiveManagerMock.mockResolvedValue(null);
    const res = await GET(req({ type: "sunday", week: "2026-07-26" }));
    expect(res.status).toBe(403);
    expect(operationalFetch).not.toHaveBeenCalled();
  });

  it("denies content-editor (403)", async () => {
    requireActiveManagerMock.mockResolvedValue({ user: { role: "content-editor" } });
    const res = await GET(req({ type: "sunday", week: "2026-07-26" }));
    expect(res.status).toBe(403);
    expect(operationalFetch).not.toHaveBeenCalled();
  });
});

describe("GET /api/admin/setlists request identity validation", () => {
  it.each([
    ["missing type", {}],
    ["unknown type", { type: "midweek", week: "2026-07-26" }],
    ["empty type", { type: "", week: "2026-07-26" }],
    ["missing week", { type: "sunday" }],
    ["empty week", { type: "sunday", week: "" }],
    ["malformed week", { type: "sunday", week: "26-07-2026" }],
    ["unpadded week", { type: "saturday", week: "2026-7-1" }],
    ["impossible calendar day", { type: "sunday", week: "2026-02-30" }],
    ["datetime instead of a date", { type: "sunday", week: "2026-07-26T12:00:00Z" }],
    ["special without roleId", { type: "special", week: "2026-07-26" }],
    ["special with an empty roleId", { type: "special", week: "2026-07-26", roleId: "" }],
  ])("rejects %s with 400 before any target read", async (_label, query) => {
    const res = await GET(req(query as Record<string, string>));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBeTruthy();
    // A malformed request identity is never an absent target.
    expect(body.targetState).toBeUndefined();
    expect(operationalFetch).not.toHaveBeenCalled();
    expect(rawFetch).not.toHaveBeenCalled();
  });

  it("rejects a special roleId that resolves to no canonical special_role (400)", async () => {
    operationalFetch.mockResolvedValueOnce([]);
    const res = await GET(req({ type: "special", week: "2026-07-26", roleId: "role-x" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.targetState).toBeUndefined();
    // No recentSongs / target read happened after the identity failure.
    expect(operationalFetch).toHaveBeenCalledTimes(1);
    expect(rawFetch).not.toHaveBeenCalled();
  });

  it("rejects a special role whose date does not match the requested service date (400)", async () => {
    operationalFetch.mockResolvedValueOnce([
      { _id: "role-1", _rev: "r1", _type: "special_role", date: "2026-08-02", hasSongs: true, songs: [] },
    ]);
    const res = await GET(req({ type: "special", week: "2026-07-26", roleId: "role-1" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.targetState).toBeUndefined();
    expect(operationalFetch).toHaveBeenCalledTimes(1);
  });

  it("rejects a special role with a malformed stored date (400)", async () => {
    operationalFetch.mockResolvedValueOnce([
      { _id: "role-1", _rev: "r1", _type: "special_role", date: "nope", hasSongs: true, songs: [] },
    ]);
    const res = await GET(req({ type: "special", week: "2026-07-26", roleId: "role-1" }));
    expect(res.status).toBe(400);
  });

  it("rejects an ambiguous special role group (400) rather than picking one", async () => {
    operationalFetch.mockResolvedValueOnce([
      { _id: "role-1", _rev: "r1", _type: "special_role", date: "2026-07-26", hasSongs: true, songs: [] },
      { _id: "role-1", _rev: "r2", _type: "special_role", date: "2026-07-26", hasSongs: true, songs: [] },
    ]);
    const res = await GET(req({ type: "special", week: "2026-07-26", roleId: "role-1" }));
    expect(res.status).toBe(400);
  });
});

describe("GET /api/admin/setlists weekend contract", () => {
  it("returns a Sunday singleton with the preserved additive fields", async () => {
    weekendReads(
      [{ _id: "sl-1", _rev: "rev-1", _type: "featuredSongs", week: "2026-07-26", hasSongs: true, songs: [song()] }],
      [],
      { sunday: [{ week: "2026-07-12", songs: [song()] }], saturday: [], special: [] },
    );

    const res = await GET(req({ type: "sunday", week: "2026-07-26" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.targetState).toBe("single");
    expect(body.contentState).toBe("ready");
    expect(body.observed).toEqual({ state: "single", id: "sl-1", rev: "rev-1" });
    expect(body.setlistId).toBe("sl-1");
    expect(body.songs).toHaveLength(1);
    expect(body.songs[0].song.title).toBe("Sólo en Jesús");
    expect(body.recentSongs).toEqual({ "song-1": "2026-07-12" });
  });

  it("queries the Saturday setlist as `saturdarSongs` (deliberate stored typo)", async () => {
    weekendReads([]);
    await GET(req({ type: "saturday", week: "2026-07-25" }));
    const [, params] = operationalFetch.mock.calls[1];
    expect(params.setlistType).toBe("saturdarSongs");
    expect(params.week).toBe("2026-07-25");
  });

  it("returns none for a week with no canonical setlist", async () => {
    weekendReads([]);
    const res = await GET(req({ type: "sunday", week: "2026-07-26" }));
    const body = await res.json();
    expect(body.targetState).toBe("none");
    expect(body.observed).toEqual({ state: "none" });
    expect(body.setlistId).toBeNull();
    expect(body.songs).toEqual([]);
    expect(body.recentSongs).toEqual({});
  });

  it("returns duplicate (never an arbitrary pick) with a null/empty target", async () => {
    weekendReads([
      { _id: "sl-1", _rev: "r1", _type: "featuredSongs", week: "2026-07-26", hasSongs: true, songs: [song()] },
      { _id: "sl-2", _rev: "r2", _type: "featuredSongs", week: "2026-07-26", hasSongs: true, songs: [song()] },
    ]);
    const res = await GET(req({ type: "sunday", week: "2026-07-26" }));
    const body = await res.json();
    expect(body.targetState).toBe("duplicate");
    expect(body.conflictingIds).toEqual(["sl-1", "sl-2"]);
    expect(body.draftIds).toEqual([]);
    expect(body.setlistId).toBeNull();
    expect(body.songs).toEqual([]);
    expect(body.recentSongs).toBeDefined();
  });

  it("returns draft_conflict when a raw draft overlays the week's setlist", async () => {
    weekendReads(
      [{ _id: "sl-1", _rev: "r1", _type: "featuredSongs", week: "2026-07-26", hasSongs: true, songs: [song()] }],
      [{ _id: "drafts.sl-1" }],
    );
    const res = await GET(req({ type: "sunday", week: "2026-07-26" }));
    const body = await res.json();
    expect(body.targetState).toBe("draft_conflict");
    expect(body.draftIds).toEqual(["drafts.sl-1"]);
    expect(body.canonicalIds).toEqual(["sl-1"]);
    expect(body.setlistId).toBeNull();
    expect(body.songs).toEqual([]);
    expect(body.recentSongs).toBeDefined();
  });

  it("returns draft_conflict for a draft-only setlist (zero live targets)", async () => {
    weekendReads([], [{ _id: "drafts.sl-9" }]);
    const res = await GET(req({ type: "sunday", week: "2026-07-26" }));
    const body = await res.json();
    expect(body.targetState).toBe("draft_conflict");
    expect(body.draftIds).toEqual(["drafts.sl-9"]);
    expect(body.canonicalIds).toEqual([]);
  });

  it("returns targetState invalid for a malformed canonical record", async () => {
    weekendReads([{ _id: "sl-1", _rev: "", _type: "featuredSongs", week: "2026-07-26", hasSongs: true, songs: [] }]);
    const res = await GET(req({ type: "sunday", week: "2026-07-26" }));
    const body = await res.json();
    expect(body.targetState).toBe("invalid");
    expect(body.reason).toBeTruthy();
    expect(body.recordIds).toEqual(["sl-1"]);
    expect(body.setlistId).toBeNull();
    expect(body.songs).toEqual([]);
  });

  it("reports incomplete content when a play_key is blank", async () => {
    weekendReads([
      {
        _id: "sl-1",
        _rev: "r1",
        _type: "featuredSongs",
        week: "2026-07-26",
        hasSongs: true,
        songs: [song(), song({ _key: "k2", play_key: "" })],
      },
    ]);
    const res = await GET(req({ type: "sunday", week: "2026-07-26" }));
    const body = await res.json();
    expect(body.targetState).toBe("single");
    expect(body.contentState).toBe("incomplete");
  });

  it("reports invalid content for a dangling song reference, never incomplete", async () => {
    weekendReads([
      {
        _id: "sl-1",
        _rev: "r1",
        _type: "featuredSongs",
        week: "2026-07-26",
        hasSongs: true,
        songs: [song({ song: null })],
      },
    ]);
    const res = await GET(req({ type: "sunday", week: "2026-07-26" }));
    const body = await res.json();
    expect(body.targetState).toBe("single");
    expect(body.contentState).toBe("invalid");
  });

  it("treats a setlist doc with no songs field as an empty singleton", async () => {
    weekendReads([{ _id: "sl-1", _rev: "r1", _type: "featuredSongs", week: "2026-07-26", hasSongs: false, songs: null }]);
    const res = await GET(req({ type: "sunday", week: "2026-07-26" }));
    const body = await res.json();
    expect(body.targetState).toBe("single");
    expect(body.contentState).toBe("empty");
    expect(body.songs).toEqual([]);
  });
});

describe("GET /api/admin/setlists special contract", () => {
  const role = (over: Record<string, unknown> = {}) => ({
    _id: "role-1",
    _rev: "role-rev-1",
    _type: "special_role",
    date: "2026-07-26",
    hasSongs: true,
    songs: [song()],
    ...over,
  });

  it("uses the special-role id/revision for the singleton observation", async () => {
    specialReads([role()]);
    const res = await GET(req({ type: "special", week: "2026-07-26", roleId: "role-1" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.targetState).toBe("single");
    expect(body.contentState).toBe("ready");
    expect(body.observed).toEqual({ state: "single", id: "role-1", rev: "role-rev-1" });
    expect(body.setlistId).toBe("role-1");
    expect(body.songs).toHaveLength(1);
    expect(body.recentSongs).toEqual({});
  });

  it("returns none for a special role that carries no songs field yet", async () => {
    specialReads([role({ hasSongs: false, songs: null })]);
    const res = await GET(req({ type: "special", week: "2026-07-26", roleId: "role-1" }));
    const body = await res.json();
    expect(body.targetState).toBe("none");
    expect(body.observed).toEqual({ state: "none" });
    expect(body.setlistId).toBeNull();
    expect(body.songs).toEqual([]);
    expect(body.recentSongs).toBeDefined();
  });

  it("returns draft_conflict when the special role has a raw draft overlay", async () => {
    specialReads([role()], [{ _id: "drafts.role-1" }]);
    const res = await GET(req({ type: "special", week: "2026-07-26", roleId: "role-1" }));
    const body = await res.json();
    expect(body.targetState).toBe("draft_conflict");
    expect(body.draftIds).toEqual(["drafts.role-1"]);
    expect(body.canonicalIds).toEqual(["role-1"]);
    expect(body.setlistId).toBeNull();
    expect(body.songs).toEqual([]);
    expect(body.recentSongs).toBeDefined();
  });

  it("returns recentSongs built from all three service kinds, excluding the current date", async () => {
    specialReads([role()], [], {
      sunday: [{ week: "2026-07-26", songs: [song({ songRef: "song-9", song: { _id: "song-9" } })] }],
      saturday: [{ week: "2026-07-11", songs: [song()] }],
      special: [{ week: "2026-07-18", songs: [song()] }],
    });
    const res = await GET(req({ type: "special", week: "2026-07-26", roleId: "role-1" }));
    const body = await res.json();
    // song-9 is only used on the current service date → not a repeat warning.
    expect(body.recentSongs["song-9"]).toBeUndefined();
    // song-1 keeps the most recent past use.
    expect(body.recentSongs["song-1"]).toBe("2026-07-18");
  });
});

describe("GET /api/admin/setlists failure handling", () => {
  it("turns a Sanity read failure into a 500, never an empty clean result", async () => {
    operationalFetch.mockRejectedValueOnce(new Error("network"));
    const res = await GET(req({ type: "sunday", week: "2026-07-26" }));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBeTruthy();
    expect(body.targetState).toBeUndefined();
    expect(body.songs).toBeUndefined();
  });

  it("turns a raw-draft read failure into a 500", async () => {
    operationalFetch.mockResolvedValueOnce(EMPTY_RECENT);
    operationalFetch.mockResolvedValueOnce([]);
    rawFetch.mockRejectedValueOnce(new Error("network"));
    const res = await GET(req({ type: "sunday", week: "2026-07-26" }));
    expect(res.status).toBe(500);
  });
});
