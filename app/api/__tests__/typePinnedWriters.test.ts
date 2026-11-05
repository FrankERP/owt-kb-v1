// W9 (ADR-0081; plan `docs/superpowers/plans/2026-10-30-jovenes-events-access.md` §5 W9): the
// routes that write a client-supplied id refuse an id of any other type with a 404, before any
// write. Before the pin, the song DELETE deleted ANY document for a worship admin and the member
// photo / set-password routes patched any id — writers outside `ministryEventCommit.ts` for a
// private Jóvenes event. (The member PATCH/DELETE rows live with their own route tests.)
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));

const EVENT_ID = "ministryEvent.0f8e6a52-1c1b-4d7e-9a43-6a2b1c0d9e11";

const h = vi.hoisted(() => ({
  requireActiveManager: vi.fn(),
  storedFetch: vi.fn(),
  txOps: [] as Array<[string, string, string | undefined]>,
  txCommit: vi.fn(),
  patchedIds: [] as string[],
  patchCommit: vi.fn(),
  upload: vi.fn(),
  revalidateSongViews: vi.fn(),
}));

vi.mock("@/app/utils/authGuards", () => ({
  requireActiveManager: () => h.requireActiveManager(),
}));

vi.mock("@/sanity/lib/serverClient", () => {
  const patchChain: Record<string, unknown> = {};
  patchChain.set = () => patchChain;
  patchChain.commit = () => h.patchCommit();
  const tx: Record<string, unknown> = {};
  tx.patch = (id: string, build: (p: { ifRevisionId: (r: string) => unknown; set: () => unknown }) => unknown) => {
    let rev: string | undefined;
    const p = { ifRevisionId: (r: string) => { rev = r; return p; }, set: () => p };
    build(p);
    h.txOps.push(["patch", id, rev]);
    return tx;
  };
  tx.delete = (id: string) => { h.txOps.push(["delete", id, undefined]); return tx; };
  tx.commit = () => h.txCommit();
  return {
    serverClient: { fetch: (...a: unknown[]) => h.storedFetch(...a) },
    writeClient: {
      transaction: () => tx,
      patch: (id: string) => { h.patchedIds.push(id); return patchChain; },
      assets: { upload: (...a: unknown[]) => h.upload(...a) },
    },
  };
});

vi.mock("@/app/utils/revalidate", () => ({
  revalidateSongViews: () => h.revalidateSongViews(),
}));

const { DELETE: SONG_DELETE } = await import("@/app/api/content/posts/[id]/route");
const { POST: PHOTO_POST } = await import("@/app/api/admin/members/[id]/photo/route");
const { POST: SET_PASSWORD } = await import("@/app/api/admin/set-password/route");
const { storedRevisionOfType } = await import("@/app/utils/typePin");

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  h.txOps.length = 0;
  h.patchedIds.length = 0;
  h.requireActiveManager.mockReset().mockResolvedValue({ user: { role: "super-admin" } });
  h.storedFetch.mockReset().mockResolvedValue("rev-1");
  h.txCommit.mockReset().mockResolvedValue({});
  h.patchCommit.mockReset().mockResolvedValue({});
  h.upload.mockReset().mockResolvedValue({ _id: "image-1", url: "https://x/y.png" });
  h.revalidateSongViews.mockReset();
});

describe("storedRevisionOfType", () => {
  it("asks for the id AND the type, and answers the revision", async () => {
    expect(await storedRevisionOfType("song-1", "post")).toBe("rev-1");
    expect(h.storedFetch).toHaveBeenCalledWith("*[_type == $type && _id == $id][0]._rev", { id: "song-1", type: "post" });
  });

  it.each([[null], [undefined], [{ _rev: "x" }], [42]])("answers null for a stored %j", async (stored) => {
    h.storedFetch.mockResolvedValue(stored);
    expect(await storedRevisionOfType("song-1", "post")).toBeNull();
  });

  it.each([[""], [undefined], [7]])("reads nothing for an id of %j", async (id) => {
    expect(await storedRevisionOfType(id, "post")).toBeNull();
    expect(h.storedFetch).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/content/posts/[id] deletes songs only", () => {
  it("refuses a Jóvenes event id with 404 and writes nothing", async () => {
    h.storedFetch.mockResolvedValue(null);
    const res = await SONG_DELETE({} as NextRequest, ctx(EVENT_ID));
    expect(res.status).toBe(404);
    expect(h.storedFetch.mock.calls[0][1]).toEqual({ id: EVENT_ID, type: "post" });
    expect(h.txOps).toEqual([]);
    expect(h.revalidateSongViews).not.toHaveBeenCalled();
  });

  it("deletes a song under the revision it read, in one transaction", async () => {
    const res = await SONG_DELETE({} as NextRequest, ctx("song-1"));
    expect(res.status).toBe(200);
    expect(h.txOps).toEqual([["patch", "song-1", "rev-1"], ["delete", "song-1", undefined]]);
    expect(h.revalidateSongViews).toHaveBeenCalledTimes(1);
  });

  it("answers 409 when the song changed between the read and the delete", async () => {
    h.txCommit.mockRejectedValue({
      statusCode: 409,
      details: { type: "mutationError", items: [{ error: { type: "documentRevisionIDDoesNotMatchError" } }] },
    });
    const res = await SONG_DELETE({} as NextRequest, ctx("song-1"));
    expect(res.status).toBe(409);
    expect(h.revalidateSongViews).not.toHaveBeenCalled();
  });

  it("still refuses a content-editor before reading anything", async () => {
    h.requireActiveManager.mockResolvedValue({ user: { role: "content-editor" } });
    const res = await SONG_DELETE({} as NextRequest, ctx("song-1"));
    expect(res.status).toBe(403);
    expect(h.storedFetch).not.toHaveBeenCalled();
  });
});

describe("the member photo and set-password routes write members only", () => {
  it("photo: an id that is not a member answers 404 before any upload", async () => {
    h.storedFetch.mockResolvedValue(null);
    const formData = vi.fn();
    const res = await PHOTO_POST({ formData } as unknown as NextRequest, ctx(EVENT_ID));
    expect(res.status).toBe(404);
    expect(h.storedFetch.mock.calls[0][1]).toEqual({ id: EVENT_ID, type: "teamMembers" });
    expect(formData).not.toHaveBeenCalled();
    expect(h.upload).not.toHaveBeenCalled();
    expect(h.patchedIds).toEqual([]);
  });

  it("set-password: an id that is not a member answers 404 and patches nothing", async () => {
    h.storedFetch.mockResolvedValue(null);
    const res = await SET_PASSWORD({ json: async () => ({ sanityMemberId: EVENT_ID, password: "longenough" }) } as unknown as NextRequest);
    expect(res.status).toBe(404);
    expect(h.storedFetch.mock.calls[0][1]).toEqual({ id: EVENT_ID, type: "teamMembers" });
    expect(h.patchedIds).toEqual([]);
  });

  it("set-password: a member still gets the hash", async () => {
    const res = await SET_PASSWORD({ json: async () => ({ sanityMemberId: "member-1", password: "longenough" }) } as unknown as NextRequest);
    expect(res.status).toBe(200);
    expect(h.patchedIds).toEqual(["member-1"]);
  });
});
