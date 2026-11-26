// app/appAuth/__tests__/songsRoute.test.ts — `GET /api/app/v1/songs` and `/songs/[slug]` behind the
// app guard (and `/songs/[slug]/mixes/[key]`, a mix's audio address): a worship member gets the catalogue and one song; the slug travels as a GROQ
// parameter; a slug with no song is 404; someone outside Alabanza is refused before any read; a
// Sanity failure is a retry, never a sign-out. The shaping is `app/utils/__tests__/appSongs.test.ts`.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const loadAppGrant = vi.hoisted(() => vi.fn());
vi.mock("@/app/appAuth/grantStore", () => ({
  APP_REVOKE_REASON: { signOut: "app_sign_out", member: "member_revoked", admin: "admin_revoked" },
  loadAppGrant,
}));

const getMemberAccess = vi.fn();
vi.mock("@/app/utils/memberAccess", () => ({
  getMemberAccess: (...a: unknown[]) => getMemberAccess(...a),
  fetchMemberAccessFresh: vi.fn(),
}));

const operationalFetch = vi.fn();
vi.mock("@/sanity/lib/operationalClient", () => ({ operationalClient: { fetch: (...a: unknown[]) => operationalFetch(...a) } }));

import { GET as LIST } from "@/app/api/app/v1/songs/route";
import { GET as ONE } from "@/app/api/app/v1/songs/[slug]/route";
import { GET as MIX } from "@/app/api/app/v1/songs/[slug]/mixes/[key]/route";
import { signAppAccessToken } from "../tokens";

const SECRET = "s".repeat(40);
const KEY = new TextEncoder().encode(SECRET);
const ORIGIN = "http://localhost:3000";
const GRANT_ID = "appAuthGrant.3b241101-e2bb-4255-8caf-4136c566a962";
const WORSHIP = { active: true, role: "member", ministries: ["worship"], managesMinistries: [], ministryRoles: [] };

const saved: Record<string, string | undefined> = {};
beforeAll(() => {
  for (const k of ["APP_AUTH_SECRET", "APP_AUTH_DISABLED", "VERCEL_ENV"]) saved[k] = process.env[k];
  process.env.APP_AUTH_SECRET = SECRET;
  delete process.env.APP_AUTH_DISABLED;
  delete process.env.VERCEL_ENV;
});
afterAll(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

beforeEach(() => {
  loadAppGrant.mockReset().mockResolvedValue({
    ok: true,
    grant: { _id: GRANT_ID, _rev: "r1", sub: "m1", clientId: "backstage-ios", platform: "ios", origin: ORIGIN, revoked: false },
  });
  getMemberAccess.mockReset().mockResolvedValue(WORSHIP);
  operationalFetch.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

async function bearer(): Promise<Record<string, string>> {
  const { token } = await signAppAccessToken({ key: KEY, origin: ORIGIN, sub: "m1", grantId: GRANT_ID });
  return { host: "localhost:3000", authorization: `Bearer ${token}` };
}
async function list(): Promise<Response> {
  return LIST(new Request(`${ORIGIN}/api/app/v1/songs`, { headers: await bearer() }));
}
async function one(slug: string, headers?: Record<string, string>): Promise<Response> {
  return ONE(new Request(`${ORIGIN}/api/app/v1/songs/${slug}`, { headers: headers ?? (await bearer()) }), { params: Promise.resolve({ slug }) });
}

const ROW = { _id: "s1", title: "Cordero y León (Lion and The Lamb)", slug: "cordero-y-leon", key: "G", bpm: 90 };

describe("GET /api/app/v1/songs", () => {
  it("answers the catalogue, no-store", async () => {
    operationalFetch.mockResolvedValueOnce([ROW]);
    const res = await list();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect((await res.json()).songs).toMatchObject([{ id: "s1", slug: "cordero-y-leon", title: "Cordero y León", original: "Lion and The Lamb" }]);
  });

  it("answers an empty list when the read returns null", async () => {
    operationalFetch.mockResolvedValueOnce(null);
    expect((await (await list()).json()).songs).toEqual([]);
  });

  it("refuses someone outside Alabanza (403) before reading anything", async () => {
    getMemberAccess.mockResolvedValueOnce({ ...WORSHIP, ministries: ["jovenes"] });
    expect((await list()).status).toBe(403);
    expect(operationalFetch).not.toHaveBeenCalled();
  });

  it("answers 503 (retry, not a sign-out) when Sanity fails", async () => {
    operationalFetch.mockRejectedValueOnce(new Error("down"));
    const res = await list();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "temporarily_unavailable" });
  });

  it("401s without a token", async () => {
    expect((await LIST(new Request(`${ORIGIN}/api/app/v1/songs`, { headers: { host: "localhost:3000" } }))).status).toBe(401);
  });
});

describe("GET /api/app/v1/songs/[slug]", () => {
  it("answers the song, with the slug bound as a parameter", async () => {
    operationalFetch.mockResolvedValueOnce({ ...ROW, chords: [{ key: "G", content: "[G]Santo" }] });
    const res = await one("cordero-y-leon");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect((await res.json()).song).toMatchObject({ slug: "cordero-y-leon", charts: [{ key: "G", chordPro: true }] });
    const [query, params] = operationalFetch.mock.calls[0]!;
    expect(params).toEqual({ slug: "cordero-y-leon", me: "m1" }); // the token's member, never a client value
    expect(query).not.toContain("cordero-y-leon");
  });

  it("answers 404 for a slug with no song", async () => {
    operationalFetch.mockResolvedValueOnce(null);
    const res = await one("nada");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
  });

  it("refuses someone outside Alabanza (403) before reading anything", async () => {
    getMemberAccess.mockResolvedValueOnce({ ...WORSHIP, ministries: ["kids"] });
    expect((await one("cordero-y-leon")).status).toBe(403);
    expect(operationalFetch).not.toHaveBeenCalled();
  });

  it("answers 503 when Sanity fails, 401 without a token", async () => {
    operationalFetch.mockRejectedValueOnce(new Error("down"));
    expect((await one("cordero-y-leon")).status).toBe(503);
    expect((await one("cordero-y-leon", { host: "localhost:3000" })).status).toBe(401);
  });
});

describe("GET /api/app/v1/songs/[slug]/mixes/[key]", () => {
  const CDN = "https://cdn.sanity.io/files/p/d/abc.mp3";
  async function mix(slug: string, key: string, headers?: Record<string, string>): Promise<Response> {
    return MIX(new Request(`${ORIGIN}/api/app/v1/songs/${slug}/mixes/${key}`, { headers: headers ?? (await bearer()) }), {
      params: Promise.resolve({ slug, key }),
    });
  }

  it("answers the CDN address, no-store, with slug and key bound as parameters", async () => {
    operationalFetch.mockResolvedValueOnce(CDN);
    const res = await mix("cordero-y-leon", "k1");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(await res.json()).toEqual({ url: CDN });
    const [query, params] = operationalFetch.mock.calls[0]!;
    expect(params).toEqual({ slug: "cordero-y-leon", key: "k1" });
    expect(query).not.toContain("cordero-y-leon");
    expect(query).not.toContain("k1");
  });

  it("answers 404 for no mix, and for an address that is not Sanity's CDN over https", async () => {
    for (const stored of [null, "", "https://evil.example/a.mp3", "http://cdn.sanity.io/files/a.mp3", { url: CDN }]) {
      operationalFetch.mockResolvedValueOnce(stored);
      const res = await mix("cordero-y-leon", "k1");
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "not_found" });
    }
  });

  it("refuses someone outside Alabanza (403) and a missing token (401) before reading anything", async () => {
    getMemberAccess.mockResolvedValueOnce({ ...WORSHIP, ministries: ["jovenes"] });
    expect((await mix("cordero-y-leon", "k1")).status).toBe(403);
    expect((await mix("cordero-y-leon", "k1", { host: "localhost:3000" })).status).toBe(401);
    expect(operationalFetch).not.toHaveBeenCalled();
  });

  it("answers 503 (retry, not a sign-out) when Sanity fails", async () => {
    operationalFetch.mockRejectedValueOnce(new Error("down"));
    expect((await mix("cordero-y-leon", "k1")).status).toBe(503);
  });
});
