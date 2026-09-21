// The rehearsal-mix redirect (spec 2026-09-20-rehearsal-mixes §8.1, decision D2):
// it protects DISCOVERY — no page ever holds a cdn.sanity.io URL and a
// non-member gets nothing — and nothing more. Bytes never pass through here.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const h = vi.hoisted(() => ({
  requireMinistryMember: vi.fn(),
  fetch: vi.fn(),
}));

vi.mock("@/app/utils/authGuards", () => ({
  requireMinistryMember: (m: string) => h.requireMinistryMember(m),
}));
vi.mock("@/sanity/lib/serverClient", () => ({
  serverClient: { fetch: (q: string, p: unknown) => h.fetch(q, p) },
}));

import { GET } from "@/app/api/audio/[songId]/[key]/route";

const params = (songId = "post-1", key = "abc123") => Promise.resolve({ songId, key });
const req = (url: string) => ({ nextUrl: new URL(url), url } as unknown as NextRequest);

beforeEach(() => {
  h.requireMinistryMember.mockReset();
  h.fetch.mockReset();
});

describe("GET /api/audio/[songId]/[key]", () => {
  it("403s without worship membership and never reads Sanity", async () => {
    h.requireMinistryMember.mockResolvedValue(null);
    const res = await GET(req("http://x/api/audio/post-1/abc123"), { params: params() });
    expect(res.status).toBe(403);
    expect(h.requireMinistryMember).toHaveBeenCalledWith("worship");
    expect(h.fetch).not.toHaveBeenCalled();
  });

  it("404s when the key is not on the song", async () => {
    h.requireMinistryMember.mockResolvedValue({ user: { sanityId: "m1" } });
    h.fetch.mockResolvedValue(null);
    const res = await GET(req("http://x/api/audio/post-1/nope"), { params: params("post-1", "nope") });
    expect(res.status).toBe(404);
    expect(h.fetch.mock.calls[0][1]).toEqual({ id: "post-1", key: "nope" });
  });

  it("302s to the CDN URL, private and uncacheable", async () => {
    h.requireMinistryMember.mockResolvedValue({ user: { sanityId: "m1" } });
    h.fetch.mockResolvedValue({ url: "https://cdn.sanity.io/files/p/d/aaa.mp3", filename: "Amor - EG 1 UP.mp3" });
    const res = await GET(req("http://x/api/audio/post-1/abc123"), { params: params() });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://cdn.sanity.io/files/p/d/aaa.mp3");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });

  it("?download=1 asks the CDN for a content-disposition with the original filename", async () => {
    h.requireMinistryMember.mockResolvedValue({ user: { sanityId: "m1" } });
    h.fetch.mockResolvedValue({ url: "https://cdn.sanity.io/files/p/d/aaa.mp3", filename: "Amor - EG 1 UP.mp3" });
    const res = await GET(req("http://x/api/audio/post-1/abc123?download=1"), { params: params() });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://cdn.sanity.io/files/p/d/aaa.mp3?dl=Amor%20-%20EG%201%20UP.mp3");
  });

  it("refuses to redirect anywhere but cdn.sanity.io", async () => {
    h.requireMinistryMember.mockResolvedValue({ user: { sanityId: "m1" } });
    h.fetch.mockResolvedValue({ url: "https://evil.example/x.mp3", filename: "x.mp3" });
    const res = await GET(req("http://x/api/audio/post-1/abc123"), { params: params() });
    expect(res.status).toBe(404);
  });
});
