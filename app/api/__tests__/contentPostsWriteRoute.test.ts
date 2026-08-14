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
