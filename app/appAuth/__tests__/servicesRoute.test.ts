// app/appAuth/__tests__/servicesRoute.test.ts — `GET /api/app/v1/services` behind the app guard:
// a worship member gets the window's services with their own seats decided by the token's subject;
// someone outside Alabanza is refused before any read; a Sanity failure is a retry, never a
// sign-out. The shaping itself is `app/utils/__tests__/appServices.test.ts`.
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

import { GET } from "@/app/api/app/v1/services/route";
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

async function call(): Promise<Response> {
  const { token } = await signAppAccessToken({ key: KEY, origin: ORIGIN, sub: "m1", grantId: GRANT_ID });
  return GET(new Request(`${ORIGIN}/api/app/v1/services`, { headers: { host: "localhost:3000", authorization: `Bearer ${token}` } }));
}

describe("GET /api/app/v1/services", () => {
  it("answers today and the services, with the caller's seats by the token's subject, no-store", async () => {
    operationalFetch.mockResolvedValueOnce({
      sundays: [{ _id: "sun-1", _type: "sunday_role", week: "2099-01-04", Lead: [{ _id: "m1", member_name: "Ana", alias: null, photo: null }] }],
    });
    const res = await call();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("no-store");
    const body = await res.json();
    expect(body.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(body.services).toHaveLength(1);
    expect(body.services[0]).toMatchObject({ id: "sun-1", mySeats: ["Lead"] });
    // The window is bound as parameters, starting today in CDMX.
    const [, params] = operationalFetch.mock.calls[0]!;
    expect(params).toMatchObject({ from: body.today });
  });

  it("answers an empty list when the read returns null", async () => {
    operationalFetch.mockResolvedValueOnce(null);
    expect((await (await call()).json()).services).toEqual([]);
  });

  it("refuses someone outside Alabanza (403) before reading anything", async () => {
    getMemberAccess.mockResolvedValueOnce({ ...WORSHIP, ministries: ["jovenes"] });
    expect((await call()).status).toBe(403);
    expect(operationalFetch).not.toHaveBeenCalled();
  });

  it("answers 503 (retry, not a sign-out) when Sanity fails", async () => {
    operationalFetch.mockRejectedValueOnce(new Error("down"));
    const res = await call();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "temporarily_unavailable" });
  });

  it("401s without a token", async () => {
    const res = await GET(new Request(`${ORIGIN}/api/app/v1/services`, { headers: { host: "localhost:3000" } }));
    expect(res.status).toBe(401);
  });
});
