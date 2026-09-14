import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import { readFileSync } from "node:fs";

const h = vi.hoisted(() => ({
  requireActiveManager: vi.fn(),
  fetch: vi.fn(),
  sets: [] as Record<string, unknown>[],
  patchedIds: [] as string[],
  created: [] as Record<string, unknown>[],
  commit: vi.fn(),
  revalidateSongViews: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("@/app/utils/authGuards", () => ({
  requireActiveManager: () => h.requireActiveManager(),
}));

vi.mock("@/sanity/lib/serverClient", () => {
  const chain: Record<string, unknown> = {};
  chain.set = (v: Record<string, unknown>) => { h.sets.push(v); return chain; };
  chain.commit = () => h.commit();
  return {
    serverClient: { fetch: (...a: unknown[]) => h.fetch(...a) },
    writeClient: {
      fetch: (...a: unknown[]) => h.fetch(...a),
      patch: (id: string) => { h.patchedIds.push(id); return chain; },
      create: (doc: Record<string, unknown>) => {
        h.created.push(doc);
        return Promise.resolve({ _id: "new-song" });
      },
    },
  };
});

vi.mock("@/app/utils/revalidate", () => ({
  revalidateSongViews: () => h.revalidateSongViews(),
}));

const { PATCH } = await import("@/app/api/content/posts/[id]/route");
const { POST } = await import("@/app/api/content/posts/route");

function req(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

beforeEach(() => {
  h.sets.length = 0;
  h.patchedIds.length = 0;
  h.created.length = 0;
  h.commit.mockReset().mockResolvedValue({ _id: "song-1" });
  h.fetch.mockReset().mockResolvedValue({ _type: "post" });
  h.requireActiveManager.mockReset().mockResolvedValue({ user: { role: "admin" } });
  h.revalidateSongViews.mockReset();
});

describe("PATCH /api/content/posts/[id] chords", () => {
  it("preserves _key for existing charts, mints for new ones, and revalidates", async () => {
    const res = await PATCH(
      req({
        chords: [
          { _key: "k-g", key: "G", content: "[G]Grande" },
          { key: "A", content: "[A]Grande" },
        ],
      }),
      { params: Promise.resolve({ id: "song-1" }) },
    );
    expect(res.status).toBe(200);
    expect(h.patchedIds).toEqual(["song-1"]);
    const chords = h.sets[0].chords as Array<{ _key: string; key: string; content: string }>;
    expect(chords).toHaveLength(2);
    expect(chords[0]).toEqual({
      _type: "chord_chart",
      _key: "k-g",
      key: "G",
      content: "[G]Grande",
    });
    expect(chords[1]._key).toEqual(expect.any(String));
    expect(chords[1]._key).not.toBe("k-g");
    expect(chords[1]).toMatchObject({ _type: "chord_chart", key: "A", content: "[A]Grande" });
    expect(h.revalidateSongViews).toHaveBeenCalledOnce();
  });

  it("rejects colliding _key values with 4xx and does not commit", async () => {
    const res = await PATCH(
      req({
        chords: [
          { _key: "dup", key: "G", content: "[G]a" },
          { _key: "dup", key: "A", content: "[A]b" },
        ],
      }),
      { params: Promise.resolve({ id: "song-1" }) },
    );
    expect(res.status).toBe(400);
    expect(h.patchedIds).toEqual([]);
    expect(h.revalidateSongViews).not.toHaveBeenCalled();
    const body = await res.json();
    expect(body.error).toMatch(/_key/i);
  });

  it("rejects a chart missing content with 4xx and does not commit", async () => {
    const res = await PATCH(
      req({ chords: [{ key: "G" }] }),
      { params: Promise.resolve({ id: "song-1" }) },
    );
    expect(res.status).toBe(400);
    expect(h.patchedIds).toEqual([]);
    expect(h.revalidateSongViews).not.toHaveBeenCalled();
  });
});

describe("POST /api/content/posts chords", () => {
  it("rejects colliding _key values with 4xx and does not create", async () => {
    const res = await POST(
      req({
        title: "Grande",
        chords: [
          { _key: "dup", key: "G", content: "[G]a" },
          { _key: "dup", key: "A", content: "[A]b" },
        ],
      }),
    );
    expect(res.status).toBe(400);
    expect(h.created).toEqual([]);
    expect(h.revalidateSongViews).not.toHaveBeenCalled();
  });

  it("mints a _key for each new chart and revalidates", async () => {
    const res = await POST(
      req({
        title: "Grande",
        chords: [
          { key: "G", content: "[G]Grande" },
          { key: "A", content: "[A]Grande" },
        ],
      }),
    );
    expect(res.status).toBe(201);
    const chords = h.created[0].chords as Array<{ _key: string }>;
    expect(chords).toHaveLength(2);
    expect(new Set(chords.map((c) => c._key)).size).toBe(2);
    expect(h.revalidateSongViews).toHaveBeenCalledOnce();
  });
});

describe("GET /api/content/posts chord projection", () => {
  it("projects _key on chords so the editor can round-trip identity", () => {
    const src = readFileSync("app/api/content/posts/route.ts", "utf8");
    expect(src).toContain("chords[]{ _key, key, content }");
  });
});

describe("slug page chord projection", () => {
  it("projects _key on chords so EditSongButton can round-trip identity", () => {
    const src = readFileSync("app/(client)/posts/[slug]/page.tsx", "utf8");
    expect(src).toContain("chords[]{ _key, key, content }");
  });
});

describe("an empty link row never costs the rest of the form", () => {
  // The reported shape: the admin presses «Agregar link de referencia», types
  // nothing, and saves. `isSafeHttpUrl("")` is false, so BOTH routes used to
  // reject the whole request — lyrics, charts, tags and title with it — and the
  // editor only said "Error al actualizar."
  const blank = { label: "", url: "" };

  it("PATCH saves the rest of the form and drops the blank row", async () => {
    const res = await PATCH(
      req({
        title: "Grande es tu fidelidad",
        lyrics: "Grande es tu fidelidad",
        referenceLinks: [{ label: "Spotify", url: "https://open.spotify.com/x" }, blank],
      }),
      { params: Promise.resolve({ id: "song-1" }) },
    );
    expect(res.status).toBe(200);
    const links = h.sets[0].referenceLinks as Array<{ label: string; url: string }>;
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ label: "Spotify", url: "https://open.spotify.com/x" });
    // The point of the fix: the edit made in the same save survived.
    expect(h.sets[0].title).toBe("Grande es tu fidelidad");
    expect(h.sets[0].body).toBeTruthy();
  });

  it("PATCH drops a blank TUTORIAL row too", async () => {
    const res = await PATCH(
      req({ tutorials: [{ title: "Teclado", url: "https://t.test" }, { title: "", url: "" }] }),
      { params: Promise.resolve({ id: "song-1" }) },
    );
    expect(res.status).toBe(200);
    const tutorials = h.sets[0].tutorials2 as Array<{ title: string }>;
    expect(tutorials).toHaveLength(1);
    expect(tutorials[0]).toMatchObject({ _type: "tutorial", title: "Teclado" });
  });

  it("POST drops it on create", async () => {
    const res = await POST(
      req({ title: "Nueva", referenceLinks: [blank, { label: "YouTube", url: "https://youtu.be/y" }] }),
    );
    expect(res.status).toBe(201);
    const links = h.created[0].referenceLinks as Array<{ label: string }>;
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ label: "YouTube" });
  });

  it("still refuses a row the admin typed a label into, and names it", async () => {
    const res = await PATCH(
      req({ referenceLinks: [{ label: "Spotify", url: "" }] }),
      { params: Promise.resolve({ id: "song-1" }) },
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("Spotify");
    expect(h.sets).toHaveLength(0);
  });

  it("still refuses a non-http URL — the protocol guard is untouched", async () => {
    const res = await PATCH(
      req({ referenceLinks: [{ label: "X", url: "javascript:alert(1)" }] }),
      { params: Promise.resolve({ id: "song-1" }) },
    );
    expect(res.status).toBe(400);
    expect(h.sets).toHaveLength(0);
  });
});

describe("the protocol guard is wired on every list, not just the one that was reported", () => {
  // Both of these passed with the guard DELETED until they existed — the fix
  // moved `isSafeHttpUrl` into one module used by three lists across two
  // production writers, and only the PATCH reference-links path was pinned.
  it("POST refuses a javascript: reference link and writes nothing", async () => {
    const res = await POST(req({ title: "X", referenceLinks: [{ label: "X", url: "javascript:alert(1)" }] }));
    expect(res.status).toBe(400);
    expect(h.created).toHaveLength(0);
  });

  it("PATCH refuses a javascript: TUTORIAL url and writes nothing", async () => {
    const res = await PATCH(
      req({ tutorials: [{ title: "X", url: "javascript:alert(1)" }] }),
      { params: Promise.resolve({ id: "song-1" }) },
    );
    expect(res.status).toBe(400);
    expect(h.sets).toHaveLength(0);
  });

  it("PATCH refuses a data: tutorial url too", async () => {
    const res = await PATCH(
      req({ tutorials: [{ title: "X", url: "data:text/html,<script>" }] }),
      { params: Promise.resolve({ id: "song-1" }) },
    );
    expect(res.status).toBe(400);
    expect(h.sets).toHaveLength(0);
  });
});
