import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ fetch: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/sanity/lib/operationalClient", () => ({ operationalClient: { fetch: (...a: unknown[]) => h.fetch(...a) } }));

const { loadPendingSetlistBefore } = await import("../pendingSetlistNotice");
const { sameSetlistSongs } = await import("@/app/utils/outboxClassify");
const { songRowsFrom } = await import("@/app/utils/outboxNotice");

beforeEach(() => h.fetch.mockReset());

describe("loadPendingSetlistBefore", () => {
  it("is null when no setlist notice is waiting", async () => {
    h.fetch.mockResolvedValue(null);
    expect(await loadPendingSetlistBefore("role-1")).toBeNull();
  });

  it("normalizes the stored rows as the flush does, so the same songs compare equal to live rows", async () => {
    // Stored rows carry no `group` for a standalone song; `songRowsFrom` writes `group: null`.
    h.fetch.mockResolvedValue({ before: { beforeSongs: [{ _key: "a", ref: "song-1", key: "G" }] } });
    const pending = await loadPendingSetlistBefore("role-1");
    expect(pending).toEqual([{ _key: "a", ref: "song-1", key: "G", group: null }]);
    const live = songRowsFrom([{ _key: "a", song: { _ref: "song-1" }, play_key: "G" }]);
    expect(sameSetlistSongs(pending!, live)).toBe(true);
  });

  it("reads an empty or missing snapshot as no songs (the whole team at flush)", async () => {
    h.fetch.mockResolvedValue({ before: {} });
    expect(await loadPendingSetlistBefore("role-1")).toEqual([]);
  });
});
