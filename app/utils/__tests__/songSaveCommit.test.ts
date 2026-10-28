// The chat's half of the song writer (admin parity phase 3, S3): `createSong` / `patchSong` with
// `opts`. The routes' half (no `opts`) is `contentPostsWriteRoute.test.ts`. Proved here: the chat's
// writes are ONE transaction carrying the new authors beside the song, the create is keyed by the
// token's id (`createIfNotExists`), the edit asserts the checked revision, and a lost race writes no
// author.
import { beforeEach, describe, expect, it, vi } from "vitest";

type Op = { kind: string; doc?: Record<string, unknown>; id?: string; ifRevisionId?: string; set?: unknown; unset?: unknown };

const h = vi.hoisted(() => ({
  fetch: vi.fn(),
  ops: [] as Op[][],
  commit: vi.fn(),
  revalidateSongViews: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/app/utils/revalidate", () => ({ revalidateSongViews: () => h.revalidateSongViews() }));
vi.mock("@/sanity/lib/serverClient", () => {
  const transaction = () => {
    const ops: Op[] = [];
    const tx = {
      createIfNotExists: (doc: Record<string, unknown>) => { ops.push({ kind: "createIfNotExists", doc }); return tx; },
      patch: (id: string, build: (p: unknown) => unknown) => {
        const op: Op = { kind: "patch", id };
        const p = {
          ifRevisionId: (rev: string) => { op.ifRevisionId = rev; return p; },
          set: (v: unknown) => { op.set = v; return p; },
          unset: (v: unknown) => { op.unset = v; return p; },
        };
        build(p);
        ops.push(op);
        return tx;
      },
      commit: async () => { h.ops.push(ops); return h.commit(ops); },
    };
    return tx;
  };
  return {
    serverClient: { fetch: (...a: unknown[]) => h.fetch(...a) },
    writeClient: { fetch: (...a: unknown[]) => h.fetch(...a), transaction },
  };
});

const { createSong, patchSong, resolveSongAuthors } = await import("@/app/utils/songSaveCommit");

const NEW = { _id: "author-elevation-worship", name: "Elevation Worship", slug: "elevation-worship" };

function conflict() {
  return Object.assign(new Error("Document has been modified"), {
    statusCode: 409,
    details: { type: "mutationError", items: [{ error: { type: "documentRevisionIDDoesNotMatchError" } }] },
  });
}

beforeEach(() => {
  h.ops.length = 0;
  h.fetch.mockReset();
  h.commit.mockReset();
  h.revalidateSongViews.mockReset();
});

describe("createSong with the chat's options", () => {
  it("creates the new authors and the song, under the token's id, in one transaction", async () => {
    h.fetch.mockResolvedValue([{ _id: "author-sinach", name: "Sinach" }]);
    h.commit.mockResolvedValue({ transactionId: "tx-1", results: [{ id: NEW._id, operation: "create" }, { id: "post-mcp-1", operation: "create" }] });
    const out = await createSong(
      { title: "Nueva", authorIds: ["author-sinach", NEW._id], lyrics: "Hola", chords: [], tagIds: [] },
      { id: "post-mcp-1", newAuthors: [NEW] },
    );
    expect(out).toMatchObject({ ok: true, effects: { id: "post-mcp-1", rev: "tx-1", created: true } });
    expect(h.ops).toHaveLength(1);
    const [author, songOp] = h.ops[0]!;
    expect(author).toEqual({ kind: "createIfNotExists", doc: { _id: NEW._id, _type: "author", name: NEW.name, slug: { _type: "slug", current: NEW.slug } } });
    expect(songOp).toMatchObject({ kind: "createIfNotExists", doc: { _id: "post-mcp-1", _type: "post", title: "Nueva" } });
    // The writer's own author read cannot see the author the transaction creates; the name comes from newAuthors.
    expect(songOp!.doc!.author).toBe("Sinach, Elevation Worship");
    expect(songOp!.doc!.authors).toEqual([
      expect.objectContaining({ _type: "reference", _ref: "author-sinach" }),
      expect.objectContaining({ _type: "reference", _ref: NEW._id }),
    ]);
    expect(h.revalidateSongViews).toHaveBeenCalledOnce();
  });

  it("reports created: false when the id already existed (a retry that lost the race)", async () => {
    h.fetch.mockResolvedValue([]);
    h.commit.mockResolvedValue({ transactionId: "tx-2", results: [{ id: "post-mcp-1", operation: "none" }] });
    const out = await createSong({ title: "Nueva" }, { id: "post-mcp-1", newAuthors: [] });
    expect(out).toMatchObject({ ok: true, effects: { created: false } });
  });

  it("refuses a missing title before any write", async () => {
    const out = await createSong({ title: " " }, { id: "post-mcp-1", newAuthors: [] });
    expect(out.ok).toBe(false);
    expect(h.ops).toHaveLength(0);
  });
});

describe("patchSong with the chat's options", () => {
  it("asserts the checked revision on the song, beside the new authors, in one transaction", async () => {
    h.fetch.mockImplementation(async (query: string) => (query.includes("_type }") ? { _type: "post" } : []));
    h.commit.mockResolvedValue({ transactionId: "tx-3", results: [] });
    const out = await patchSong("post-1", { authorIds: [NEW._id], musicalReferenceUrl: "" }, { ifRevisionId: "rev-1", newAuthors: [NEW] });
    expect(out).toMatchObject({ ok: true, effects: { id: "post-1", rev: "tx-3" } });
    const [author, songOp] = h.ops[0]!;
    expect(author).toMatchObject({ kind: "createIfNotExists", doc: { _id: NEW._id } });
    expect(songOp).toMatchObject({ kind: "patch", id: "post-1", ifRevisionId: "rev-1", unset: ["musicalReferenceUrl"] });
    expect(songOp!.set).toMatchObject({ author: "Elevation Worship", authors: [expect.objectContaining({ _ref: NEW._id })] });
  });

  it("answers a Content Lake 409 as stale_revision: the whole transaction failed, so no author was created", async () => {
    h.fetch.mockImplementation(async (query: string) => (query.includes("_type }") ? { _type: "post" } : []));
    h.commit.mockRejectedValue(conflict());
    const out = await patchSong("post-1", { authorIds: [NEW._id] }, { ifRevisionId: "rev-old", newAuthors: [NEW] });
    expect(out).toMatchObject({ ok: false, status: 409 });
    expect(h.revalidateSongViews).not.toHaveBeenCalled();
  });

  it("lets any other commit failure through as itself (the tool then answers an unknown outcome)", async () => {
    h.fetch.mockImplementation(async (query: string) => (query.includes("_type }") ? { _type: "post" } : []));
    h.commit.mockRejectedValue(new Error("socket hang up"));
    await expect(patchSong("post-1", { title: "X" }, { ifRevisionId: "rev-1", newAuthors: [] })).rejects.toThrow(/socket/);
  });

  it("refuses a document that is not a song before any write", async () => {
    h.fetch.mockResolvedValue({ _type: "teamMembers" });
    const out = await patchSong("member-1", { title: "X" }, { ifRevisionId: "rev-1", newAuthors: [] });
    expect(out).toMatchObject({ ok: false, status: 400 });
    expect(h.ops).toHaveLength(0);
  });
});

describe("resolveSongAuthors", () => {
  it("names authors in the order given, from the read rows and the ones being created; drops an id neither knows", () => {
    expect(resolveSongAuthors([{ _id: "author-sinach", name: "Sinach" }], [NEW], [NEW._id, "author-ghost", "author-sinach"], () => "k")).toEqual({
      author: "Elevation Worship, Sinach",
      authors: [
        { _type: "reference", _ref: NEW._id, _key: "k" },
        { _type: "reference", _ref: "author-sinach", _key: "k" },
      ],
    });
  });
});
