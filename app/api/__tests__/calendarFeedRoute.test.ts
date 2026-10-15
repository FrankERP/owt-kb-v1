// `GET /api/calendar/<memberId>/<generation>/<token>.ics` — the member calendar feed (ADR-0057),
// and `POST /api/me/calendar-feed`, the rotation that revokes it.
//
// The property that matters most is the ORDER (spec D3, CF2): a caller without a valid signature
// must cost ZERO Sanity requests. The dataset is on the Free plan and shared with the production
// app, so an anonymous route whose Sanity cost scales with junk traffic could spend the whole
// app's quota. Every refusal test below therefore asserts the fetch spies were never called.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));

const h = vi.hoisted(() => ({
  serverFetch: vi.fn(),
  operationalFetch: vi.fn(),
  requireActiveSession: vi.fn(),
  getMemberAccess: vi.fn(),
  txOps: [] as Array<{ op: string; arg: unknown }>,
  commit: vi.fn(),
}));

vi.mock("@/sanity/lib/serverClient", () => ({
  serverClient: { fetch: (...a: unknown[]) => h.serverFetch(...a) },
  writeClient: {
    transaction: () => {
      const tx: Record<string, unknown> = {};
      tx.createIfNotExists = (doc: unknown) => { h.txOps.push({ op: "createIfNotExists", arg: doc }); return tx; };
      tx.patch = (id: string, fn: (p: unknown) => unknown) => {
        const patch: Record<string, unknown> = {};
        const ops: Record<string, unknown> = {};
        patch.inc = (v: unknown) => { ops.inc = v; return patch; };
        patch.set = (v: unknown) => { ops.set = v; return patch; };
        fn(patch);
        h.txOps.push({ op: "patch", arg: { id, ...ops } });
        return tx;
      };
      tx.commit = (opts: unknown) => h.commit(opts);
      return tx;
    },
  },
}));
vi.mock("@/sanity/lib/operationalClient", () => ({
  operationalClient: { fetch: (...a: unknown[]) => h.operationalFetch(...a) },
}));
vi.mock("@/app/utils/authGuards", () => ({ requireActiveSession: () => h.requireActiveSession() }));
vi.mock("@/app/utils/memberAccess", () => ({ getMemberAccess: (id: string) => h.getMemberAccess(id) }));

const { GET } = await import("@/app/api/calendar/[memberId]/[generation]/[token]/route");
const { POST } = await import("@/app/api/me/calendar-feed/route");
const { signFeedToken } = await import("@/app/utils/calendarFeedToken");

const SECRET = "s".repeat(40);
const MEMBER = "member-1";

// A request as Next hands it to the handler: `nextUrl`/`url` keep the RAW path (percent-escapes
// as sent), while `params` arrive DECODED — the route must not trust the decoded params alone.
function feedReq(rawPath: string, search = ""): NextRequest {
  const url = `https://owt-backstage.vercel.app${rawPath}${search}`;
  return { url, nextUrl: new URL(url) } as unknown as NextRequest;
}
function call(opts: { member?: string; generation?: string; token?: string; search?: string; rawPath?: string } = {}) {
  const member = opts.member ?? MEMBER;
  const generation = opts.generation ?? "0";
  const token = opts.token ?? `${signFeedToken(SECRET, member, Number(generation))}.ics`;
  const rawPath = opts.rawPath ?? `/api/calendar/${encodeURIComponent(member)}/${generation}/${token}`;
  return GET(feedReq(rawPath, opts.search), { params: Promise.resolve({ memberId: member, generation, token }) });
}

const SCHEDULE = {
  sundays: [{
    _id: "sun-1", date: "2026-10-18", seated: true, isLead: false, myInstrument: "Bajo",
    Lead: [{ member_name: "Ana" }], instruments: [{ instrument: "Bajo", member_name: "Yo" }],
    setlists: [{ songs: [{ title: "Gracia", play_key: "G" }] }],
  }],
  saturdays: [],
  specials: [],
};

function stubAll({ gate = { member: { disabled: false }, generation: null } as unknown } = {}) {
  h.serverFetch.mockResolvedValue(gate);
  h.operationalFetch.mockResolvedValue(SCHEDULE);
}

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv("CALENDAR_FEED_SECRET", SECRET);
  vi.stubEnv("SANITY_API_READ_TOKEN", "read-token");
  vi.stubEnv("VERCEL_ENV", "production");
  h.serverFetch.mockReset();
  h.operationalFetch.mockReset();
  h.requireActiveSession.mockReset();
  h.getMemberAccess.mockReset().mockResolvedValue({ active: true, role: "member", ministries: ["worship"], managesMinistries: [] });
  h.commit.mockReset();
  h.txOps.length = 0;
});

describe("GET /api/calendar — configuration fails closed", () => {
  it("503s without CALENDAR_FEED_SECRET, before any read", async () => {
    vi.stubEnv("CALENDAR_FEED_SECRET", "");
    const res = await call();
    expect(res.status).toBe(503);
    expect(h.serverFetch).not.toHaveBeenCalled();
  });

  it("503s with a secret shorter than 32 bytes", async () => {
    vi.stubEnv("CALENDAR_FEED_SECRET", "short");
    expect((await call()).status).toBe(503);
    expect(h.serverFetch).not.toHaveBeenCalled();
  });

  it("503s without SANITY_API_READ_TOKEN — a token-less read of the dotted counter would answer 0 and resurrect revoked URLs", async () => {
    vi.stubEnv("SANITY_API_READ_TOKEN", "");
    expect((await call()).status).toBe(503);
    expect(h.serverFetch).not.toHaveBeenCalled();
  });
});

describe("GET /api/calendar — no I/O before the signature verifies", () => {
  const cases: Array<[string, Parameters<typeof call>[0]]> = [
    ["a tampered token", { token: `${"A".repeat(43)}.ics` }],
    ["a token for another member", { token: `${signFeedToken(SECRET, "member-2", 0)}.ics` }],
    ["a token signed for another generation", { token: `${signFeedToken(SECRET, MEMBER, 1)}.ics` }],
    ["a short token", { token: "abc.ics" }],
    ["no .ics suffix", { token: signFeedToken(SECRET, MEMBER, 0) }],
    ["a non-canonical generation", { generation: "00" }],
    ["a negative generation", { generation: "-1" }],
    ["an extra query string (cache bypass)", { search: "?solo=mios&x=1" }],
    ["an unknown query string", { search: "?x=1" }],
    ["a bare trailing ? (another edge-cache key)", { search: "?" }],
    ["a percent-encoded .ics suffix (Next decodes params; the raw path is pinned)", {
      rawPath: `/api/calendar/${MEMBER}/0/${signFeedToken(SECRET, MEMBER, 0)}%2Eics`,
    }],
    ["a percent-encoded member id character", {
      rawPath: `/api/calendar/member%2D1/0/${signFeedToken(SECRET, MEMBER, 0)}.ics`,
    }],
  ];
  for (const [name, opts] of cases) {
    it(`404s ${name} with zero Sanity requests`, async () => {
      stubAll();
      const res = await call(opts);
      expect(res.status).toBe(404);
      expect(await res.text()).toBe("Not found");
      expect(h.serverFetch).not.toHaveBeenCalled();
      expect(h.operationalFetch).not.toHaveBeenCalled();
    });
  }
});

describe("GET /api/calendar — after the signature", () => {
  it("serves the calendar for an active worship member at the current generation", async () => {
    stubAll();
    const res = await call();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/calendar; charset=utf-8");
    expect(res.headers.get("cache-control")).toBe("private, max-age=300");
    expect(res.headers.get("vercel-cdn-cache-control")).toBe("max-age=3600");
    const body = await res.text();
    expect(body).toContain("BEGIN:VCALENDAR");
    expect(body).toContain("SUMMARY:⭐ Domingo · Bajo · Oasis Worship");
    expect(body).toContain("UID:sun-1@owt-backstage");
    // One combined gate read, then one schedule read with the member id and CDMX window.
    expect(h.serverFetch).toHaveBeenCalledTimes(1);
    expect(h.serverFetch.mock.calls[0][1]).toEqual({ id: MEMBER, feedId: `calendarFeed.${MEMBER}` });
    expect(h.operationalFetch).toHaveBeenCalledTimes(1);
    expect(h.operationalFetch.mock.calls[0][1]).toMatchObject({ id: MEMBER });
    expect(h.operationalFetch.mock.calls[0][0]).not.toContain("team_notes");
  });

  it("?solo=mios reads only the member's own services", async () => {
    stubAll();
    const res = await call({ search: "?solo=mios" });
    expect(res.status).toBe(200);
    expect(h.operationalFetch.mock.calls[0][0]).toContain("$id in foh_team[].person._ref");
    expect(await res.text()).toContain("X-WR-CALNAME:Oasis Worship · mis servicios");
  });

  it("404s a revoked URL (the stored generation moved on), before the schedule read", async () => {
    stubAll({ gate: { member: { disabled: false }, generation: 2 } });
    const res = await call({ generation: "1" });
    expect(res.status).toBe(404);
    expect(h.operationalFetch).not.toHaveBeenCalled();
  });

  it("serves the new URL after a rotation", async () => {
    stubAll({ gate: { member: { disabled: false }, generation: 2 } });
    expect((await call({ generation: "2" })).status).toBe(200);
  });

  for (const [name, gate] of [
    ["an unknown member", { member: null, generation: null }],
    ["a disabled member", { member: { disabled: true }, generation: null }],
    ["a kids-only member", { member: { disabled: false, ministries: ["kids"] }, generation: null }],
  ] as const) {
    it(`404s ${name} with the same body, before the schedule read`, async () => {
      stubAll({ gate });
      const res = await call();
      expect(res.status).toBe(404);
      expect(await res.text()).toBe("Not found");
      expect(h.operationalFetch).not.toHaveBeenCalled();
    });
  }

  it("treats an absent ministries field as worship", async () => {
    stubAll({ gate: { member: { disabled: false, ministries: null }, generation: null } });
    expect((await call()).status).toBe(200);
  });

  it("503s on a corrupt stored generation instead of reading it as 0", async () => {
    stubAll({ gate: { member: { disabled: false }, generation: "0" } });
    expect((await call()).status).toBe(503);
    expect(h.operationalFetch).not.toHaveBeenCalled();
  });

  it("503s when the gate read throws", async () => {
    h.serverFetch.mockRejectedValue(new Error("boom"));
    expect((await call()).status).toBe(503);
  });

  it("503s when the schedule read throws", async () => {
    h.serverFetch.mockResolvedValue({ member: { disabled: false }, generation: null });
    h.operationalFetch.mockRejectedValue(new Error("boom"));
    expect((await call()).status).toBe(503);
  });
});

describe("POST /api/me/calendar-feed", () => {
  const SESSION = { user: { sanityId: MEMBER, isImpersonating: false } };

  it("401s without a session", async () => {
    h.requireActiveSession.mockResolvedValue(null);
    expect((await POST()).status).toBe(401);
    expect(h.commit).not.toHaveBeenCalled();
  });

  it("403s while impersonating, and writes nothing", async () => {
    h.requireActiveSession.mockResolvedValue({ user: { sanityId: MEMBER, isImpersonating: true } });
    expect((await POST()).status).toBe(403);
    expect(h.commit).not.toHaveBeenCalled();
  });

  it("403s a kids-only member", async () => {
    h.requireActiveSession.mockResolvedValue(SESSION);
    h.getMemberAccess.mockResolvedValue({ active: true, role: "member", ministries: ["kids"], managesMinistries: [] });
    expect((await POST()).status).toBe(403);
    expect(h.commit).not.toHaveBeenCalled();
  });

  it("503s without the secret", async () => {
    vi.stubEnv("CALENDAR_FEED_SECRET", "");
    h.requireActiveSession.mockResolvedValue(SESSION);
    expect((await POST()).status).toBe(503);
    expect(h.commit).not.toHaveBeenCalled();
  });

  it("bumps the counter atomically and signs the URLs with the generation the transaction returned", async () => {
    h.requireActiveSession.mockResolvedValue(SESSION);
    h.commit.mockResolvedValue([
      { _id: `calendarFeed.${MEMBER}`, generation: 0 },
      { _id: `calendarFeed.${MEMBER}`, generation: 3 },
    ]);
    const res = await POST();
    expect(res.status).toBe(200);
    expect(h.txOps[0]).toEqual({
      op: "createIfNotExists",
      arg: {
        _id: `calendarFeed.${MEMBER}`,
        _type: "calendarFeed",
        member: { _type: "reference", _ref: MEMBER, _weak: true },
        generation: 0,
      },
    });
    expect(h.txOps[1]).toMatchObject({ op: "patch", arg: { id: `calendarFeed.${MEMBER}`, inc: { generation: 1 } } });
    expect(h.commit).toHaveBeenCalledWith({ returnDocuments: true });
    const { urls } = await res.json();
    expect(urls.all).toBe(
      `https://owt-backstage.vercel.app/api/calendar/${MEMBER}/3/${signFeedToken(SECRET, MEMBER, 3)}.ics`,
    );
    expect(urls.mine).toBe(`${urls.all}?solo=mios`);
    expect(urls.webcalAll.startsWith("webcal://owt-backstage.vercel.app/")).toBe(true);
    expect(urls.googleAll).toBe(`https://calendar.google.com/calendar/r?cid=${encodeURIComponent(urls.webcalAll)}`);
  });

  it("503s (JSON) when the commit throws", async () => {
    h.requireActiveSession.mockResolvedValue(SESSION);
    h.commit.mockRejectedValue(new Error("boom"));
    const res = await POST();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "Calendar feed unavailable" });
  });

  it("503s instead of returning a URL when the transaction result carries no new generation", async () => {
    h.requireActiveSession.mockResolvedValue(SESSION);
    h.commit.mockResolvedValue([]);
    expect((await POST()).status).toBe(503);
  });
});
